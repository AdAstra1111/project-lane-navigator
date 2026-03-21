/**
 * requirementExecutor — Processes LookBook requirements in domain passes.
 *
 * Executes generation per requirement, tracks satisfaction, and produces
 * a working set of generated candidates for election.
 *
 * This replaces gap-driven generation for fresh_from_scratch mode.
 *
 * Controls:
 * - Hard identity lock enforcement for character generation
 * - Slide-type visual guardrails injected into every prompt
 * - Scene diversity scoring to prevent visual repetition
 * - Deterministic requirement-origin matching when metadata exists
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage } from '@/lib/images/types';
import { resolvePromptTemplate, buildPromptFromTemplate, type PromptContext } from '@/lib/images/slotPromptRegistry';
import { classifyOrientation } from '@/lib/images/orientationUtils';
import type { BuildWorkingSet, WorkingSetEntry } from '@/lib/images/lookbookImageOrchestrator';
import type { LookBookRequirement, RequirementPass, RequirementResult, RequirementSet, SatisfactionStatus } from './requirementBuilder';
import type { RequirementProgress, PipelineProgressCallback } from './types';
import { PipelineStage } from './types';
import { buildConstraintPromptSuffix } from './slideTypeConstraints';

// ── Execution Result ─────────────────────────────────────────────────────────

export interface RequirementExecutionResult {
  results: RequirementResult[];
  workingSet: BuildWorkingSet;
  totalGenerated: number;
  totalFailed: number;
  totalSatisfied: number;
  totalPartial: number;
  totalBlocked: number;
}

// ── Identity Anchor Cache ────────────────────────────────────────────────────

interface CharacterAnchorSet {
  headshot?: string; // storage_path
  fullBody?: string; // storage_path
  hasAnchors: boolean;
}

/**
 * Resolve identity anchors for all characters in a project.
 * Returns a map of characterName(lowercase) → anchor paths.
 */
async function resolveCharacterAnchors(projectId: string): Promise<Map<string, CharacterAnchorSet>> {
  const map = new Map<string, CharacterAnchorSet>();

  try {
    const { data: anchorImages } = await (supabase as any)
      .from('project_images')
      .select('subject, shot_type, storage_path, is_primary, generation_config, curation_state')
      .eq('project_id', projectId)
      .eq('asset_group', 'character')
      .eq('is_primary', true)
      .in('shot_type', ['identity_headshot', 'identity_full_body'])
      .in('curation_state', ['active', 'approved', 'locked']);

    for (const img of anchorImages || []) {
      const name = (img.subject || '').toLowerCase().trim();
      if (!name) continue;

      if (!map.has(name)) {
        map.set(name, { hasAnchors: false });
      }
      const entry = map.get(name)!;

      if (img.shot_type === 'identity_headshot' && img.storage_path) {
        entry.headshot = img.storage_path;
        entry.hasAnchors = true;
      }
      if (img.shot_type === 'identity_full_body' && img.storage_path) {
        entry.fullBody = img.storage_path;
        entry.hasAnchors = true;
      }
    }
  } catch (e) {
    console.warn('[ReqExecutor] Failed to resolve character anchors:', (e as Error).message);
  }

  return map;
}

// ── Pass order (deterministic) ───────────────────────────────────────────────

const PASS_ORDER: RequirementPass[] = ['character', 'world', 'key_moments', 'atmosphere', 'poster'];

// ── Constants ────────────────────────────────────────────────────────────────

/** Max images per single edge function call */
const BATCH_SIZE = 4;
/** Max generation calls per section to prevent runaway loops */
const MAX_CALLS_PER_SECTION = 5;
/** Max consecutive failures before aborting a section */
const MAX_CONSECUTIVE_FAILURES = 2;

// ── Executor ─────────────────────────────────────────────────────────────────

/**
 * Execute all requirements in pass order.
 * Each pass generates images for its requirements in batched loops until
 * demand is met or failure thresholds are reached.
 */
export async function executeRequirements(
  projectId: string,
  requirementSet: RequirementSet,
  narrativeContext: { projectTitle: string; genre: string; tone: string },
  onProgress?: PipelineProgressCallback,
  logs?: string[],
): Promise<RequirementExecutionResult> {
  const log = (msg: string) => {
    logs?.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(`[ReqExecutor] ${msg}`);
  };

  const results: RequirementResult[] = [];
  const allEntries: WorkingSetEntry[] = [];
  let totalGenerated = 0;
  let totalFailed = 0;

  // Build progress entries for UI
  const progressReqs: RequirementProgress[] = requirementSet.requirements.map(r => ({
    id: r.id,
    label: r.label,
    slideType: r.slideType,
    status: 'pending' as const,
    generatedCount: 0,
    selectedCount: 0,
  }));

  const reportReqs = (stage: PipelineStage, message: string, percent?: number) => {
    onProgress?.({
      currentStage: stage,
      stageStatus: 'running',
      message,
      percent,
      logs: logs || [],
      requirements: progressReqs,
    });
  };

  // Track all generation call metadata for matching
  const generationBatches: GenerationBatchRecord[] = [];

  // ── RESOLVE CHARACTER IDENTITY ANCHORS ──
  // This MUST happen before any generation to enforce identity lock
  log('Resolving character identity anchors...');
  const characterAnchors = await resolveCharacterAnchors(projectId);
  log(`Identity anchors resolved: ${characterAnchors.size} characters with anchors`);
  for (const [name, anchors] of characterAnchors) {
    if (anchors.hasAnchors) {
      log(`  ✓ ${name}: headshot=${!!anchors.headshot} fullBody=${!!anchors.fullBody}`);
    }
  }

  // Process each pass in order
  for (const pass of PASS_ORDER) {
    const passReqs = requirementSet.byPass[pass];
    if (!passReqs || passReqs.length === 0) continue;

    log(`── PASS: ${pass.toUpperCase()} (${passReqs.length} requirements) ──`);

    // Mark requirements as planning
    for (const req of passReqs) {
      const pIdx = progressReqs.findIndex(p => p.id === req.id);
      if (pIdx >= 0) progressReqs[pIdx].status = 'planning';
    }
    reportReqs(PipelineStage.GENERATION, `Planning ${pass} pass...`, 30);

    // Group requirements by section for batched generation
    const bySection = new Map<string, LookBookRequirement[]>();
    for (const req of passReqs) {
      const existing = bySection.get(req.section) || [];
      existing.push(req);
      bySection.set(req.section, existing);
    }

    for (const [section, sectionReqs] of bySection) {
      // Mark as generating
      for (const req of sectionReqs) {
        const pIdx = progressReqs.findIndex(p => p.id === req.id);
        if (pIdx >= 0) progressReqs[pIdx].status = 'generating';
      }
      reportReqs(PipelineStage.GENERATION, `Generating ${pass}: ${section}...`, 50);

      const totalNeeded = sectionReqs.reduce((sum, r) => sum + r.preferred, 0);
      let totalGeneratedForSection = 0;
      let consecutiveFailures = 0;
      let callCount = 0;

      // ── BATCHED GENERATION LOOP ──
      // Loop until we have enough images or hit failure thresholds
      while (
        totalGeneratedForSection < totalNeeded &&
        callCount < MAX_CALLS_PER_SECTION &&
        consecutiveFailures < MAX_CONSECUTIVE_FAILURES
      ) {
        const remaining = totalNeeded - totalGeneratedForSection;
        const count = Math.min(remaining, BATCH_SIZE);
        callCount++;

        // Rotate through requirements for prompt diversity
        const reqIndex = (callCount - 1) % sectionReqs.length;
        const targetReq = sectionReqs[reqIndex];

        const promptCtx: PromptContext = {
          projectTitle: narrativeContext.projectTitle,
          genre: narrativeContext.genre,
          tone: narrativeContext.tone,
          ...targetReq.promptContext,
        };

        const template = resolvePromptTemplate(targetReq.subjectType as any, targetReq.shotType);
        let { prompt } = buildPromptFromTemplate(template, promptCtx);

        // ── SLIDE-TYPE VISUAL GUARDRAILS ──
        // Inject positive/negative constraints based on slide editorial purpose
        const constraintSuffix = buildConstraintPromptSuffix(targetReq.slideType);
        if (constraintSuffix) {
          prompt = `${prompt} ${constraintSuffix}`;
        }

        // ── Append hard negatives from requirement ──
        if (targetReq.hardNegatives.length > 0) {
          prompt = `${prompt} NEGATIVE: ${targetReq.hardNegatives.join(', ')}.`;
        }

        log(`[${section}] batch ${callCount}: generating ${count} (${totalGeneratedForSection}/${totalNeeded} done, req=${targetReq.id})`);

        // ── IDENTITY LOCK ENFORCEMENT ──
        // Resolve identity anchors for character requirements
        let identityPayload: Record<string, unknown> = {};
        if (targetReq.subjectType === 'character' && targetReq.promptContext.characterName) {
          const charNameKey = targetReq.promptContext.characterName.toLowerCase().trim();
          const anchors = characterAnchors.get(charNameKey);

          if (anchors?.hasAnchors) {
            identityPayload = {
              identity_mode: true,
              identity_anchor_paths: {
                headshot: anchors.headshot || null,
                fullBody: anchors.fullBody || null,
              },
              identity_notes: targetReq.promptContext.characterTraits || null,
            };
            log(`[${section}] Identity LOCKED for "${targetReq.promptContext.characterName}" (headshot=${!!anchors.headshot}, fullBody=${!!anchors.fullBody})`);
          } else {
            log(`[${section}] No identity anchors for "${targetReq.promptContext.characterName}" — generating without lock`);
          }
        }

        try {
          const { data, error } = await (supabase as any).functions.invoke('generate-lookbook-image', {
            body: {
              project_id: projectId,
              section,
              count,
              asset_group: targetReq.assetGroup,
              pack_mode: true,
              forced_shot_type: targetReq.shotType,
              // Identity lock fields (empty object if not character)
              ...identityPayload,
              auto_complete_context: {
                prompt_override: prompt,
                requirement_ids: sectionReqs.map(r => r.id),
                target_requirement_id: targetReq.id,
                orientations: sectionReqs.map(r => r.orientation),
                batch_index: callCount,
                slide_type: targetReq.slideType,
                pass,
                requested_shot_type: targetReq.shotType,
              },
            },
          });

          if (error) {
            log(`[${section}] batch ${callCount} FAILED: ${error.message || error}`);
            totalFailed += count;
            consecutiveFailures++;
            continue;
          }

          const genResults = data?.results || [];
          const successCount = genResults.filter((r: any) => r.status === 'ready').length;
          totalGenerated += successCount;
          totalGeneratedForSection += successCount;
          totalFailed += (count - successCount);

          if (successCount > 0) {
            consecutiveFailures = 0; // Reset on success
          } else {
            consecutiveFailures++;
          }

          // Record batch metadata for matching
          generationBatches.push({
            section,
            pass,
            batchIndex: callCount,
            targetRequirementId: targetReq.id,
            slideType: targetReq.slideType,
            shotType: targetReq.shotType,
            subjectType: targetReq.subjectType,
            characterName: targetReq.promptContext.characterName,
            generatedAt: new Date().toISOString(),
            successCount,
          });

          log(`[${section}] batch ${callCount}: ${successCount}/${count} ok (total ${totalGeneratedForSection}/${totalNeeded})`);
        } catch (e: any) {
          log(`[${section}] batch ${callCount} ERROR: ${e.message}`);
          totalFailed += count;
          consecutiveFailures++;
        }
      }

      if (totalGeneratedForSection < totalNeeded) {
        log(`[${section}] WARNING: under-generated ${totalGeneratedForSection}/${totalNeeded} (${callCount} calls, ${consecutiveFailures} failures)`);
      }

      // Update per-requirement progress
      const perReqShare = sectionReqs.length > 0 ? Math.ceil(totalGeneratedForSection / sectionReqs.length) : 0;
      for (const req of sectionReqs) {
        const pIdx = progressReqs.findIndex(p => p.id === req.id);
        if (pIdx >= 0) {
          progressReqs[pIdx].generatedCount = perReqShare;
          progressReqs[pIdx].status = totalGeneratedForSection > 0 ? 'generated' : 'blocked';
          if (totalGeneratedForSection === 0) progressReqs[pIdx].blockingReason = 'No images generated';
        }
      }
    }

    reportReqs(PipelineStage.GENERATION, `${pass} pass complete`, 70);
  }

  // ── Harvest generated candidates ──
  // Use 15-minute window to account for multi-pass generation time
  log('Harvesting recently generated candidates...');
  const harvestWindowMs = 15 * 60 * 1000;
  const harvestCutoff = new Date(Date.now() - harvestWindowMs).toISOString();
  const { data: recentCandidates } = await (supabase as any)
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)
    .eq('curation_state', 'candidate')
    .gte('created_at', harvestCutoff)
    .order('created_at', { ascending: false })
    .limit(200);

  const candidates = (recentCandidates || []) as ProjectImage[];

  // Hydrate signed URLs
  await Promise.all(candidates.map(async (img) => {
    if (!img.signedUrl && img.storage_path) {
      try {
        const bucket = img.storage_bucket || 'project-posters';
        const { data: signed } = await supabase.storage
          .from(bucket)
          .createSignedUrl(img.storage_path, 3600);
        img.signedUrl = signed?.signedUrl || '';
      } catch { /* skip */ }
    }
  }));

  log(`Harvested ${candidates.length} candidate images`);

  // ── Track selected scene signatures for diversity control ──
  const selectedSignatures = new Map<string, number>(); // slideType → signature count

  // ── Match candidates to requirements with strengthened scoring ──
  for (const req of requirementSet.requirements) {
    const gc_field = 'generation_config';

    // ── DETERMINISTIC REQUIREMENT-ORIGIN MATCHING ──
    // If any candidates have our exact target_requirement_id, ONLY use those
    const directMatches = candidates.filter(c => {
      if (!c.signedUrl) return false;
      const gc = (c as any)[gc_field] as Record<string, unknown> | null;
      const autoCtx = gc?.auto_complete_context as Record<string, unknown> | null;
      return autoCtx?.target_requirement_id === req.id;
    });

    const useDirectOnly = directMatches.length > 0;
    const pool = useDirectOnly ? directMatches : candidates.filter(c => {
      if (!c.signedUrl) return false;
      // Asset group filter — but allow through if no asset_group on image
      if ((c as any).asset_group && (c as any).asset_group !== req.assetGroup) return false;
      return true;
    });

    if (useDirectOnly) {
      log(`[Match] ${req.id}: using ${directMatches.length} direct requirement-origin matches (deterministic)`);
    }

    const scored = pool.map(img => {
      let score = 0;

      // ── Requirement-origin matching (strongest signal) ──
      const gc = (img as any).generation_config as Record<string, unknown> | null;
      const autoCtx = gc?.auto_complete_context as Record<string, unknown> | null;
      if (autoCtx?.target_requirement_id === req.id) {
        score += 25; // Direct requirement match
      } else if (!useDirectOnly) {
        // Only apply weaker matching when no direct matches exist
        if (autoCtx?.slide_type === req.slideType) {
          score += 12; // Same slide type
        } else if (autoCtx?.pass === req.pass) {
          score += 6; // Same pass
        }
      }

      // ── Orientation match ──
      const orient = classifyOrientation(img.width, img.height);
      if (req.orientation === 'any' || orient === req.orientation) score += 10;
      else if (orient === 'square') score += 3;

      // ── Shot type match (with compatibility normalization) ──
      if (img.shot_type === req.shotType) score += 8;
      else if (areShotTypesCompatible(img.shot_type, req.shotType)) score += 6;
      else if (autoCtx?.requested_shot_type === req.shotType) score += 5;

      // ── Entity/provenance match ──
      if (img.entity_id || img.location_ref || img.moment_ref) score += 6;

      // ── Character name match ──
      if (req.promptContext.characterName && img.subject) {
        if ((img.subject as string).toLowerCase().includes(req.promptContext.characterName.toLowerCase())) {
          score += 15;
        }
      }

      // ── Batch metadata match (fallback for when generation_config isn't populated) ──
      if (!useDirectOnly) {
        const batchMatch = generationBatches.find(b =>
          b.targetRequirementId === req.id &&
          b.section === req.section
        );
        if (batchMatch && batchMatch.successCount > 0) {
          const imgCreated = (img as any).created_at;
          if (imgCreated && batchMatch.generatedAt && Math.abs(new Date(imgCreated).getTime() - new Date(batchMatch.generatedAt).getTime()) < 30000) {
            score += 8;
          }
        }
      }

      // ── SCENE DIVERSITY PENALTY ──
      // Penalize images that look like already-selected compositions for this slide
      const sig = computeSceneSignature(img);
      const slideKey = req.slideType;
      const existingCount = selectedSignatures.get(`${slideKey}:${sig}`) || 0;
      if (existingCount > 0) {
        score -= 10 * existingCount; // Progressive penalty for repeated scenes
      }
      // Extra penalty for same character + same location + same composition
      if (req.promptContext.characterName && img.subject && img.location_ref) {
        const dupKey = `${slideKey}:${(img.subject as string).toLowerCase()}:${img.location_ref}:${img.shot_type}`;
        const dupCount = selectedSignatures.get(dupKey) || 0;
        if (dupCount > 0) {
          score -= 15;
        }
      }

      return { img, score, sig };
    });
    scored.sort((a, b) => b.score - a.score);

    // Take best matches up to preferred count
    const winners = scored.slice(0, req.preferred);
    const satisfiedCount = winners.length;

    // Record selected signatures for diversity tracking
    for (const w of winners) {
      const slideKey = req.slideType;
      const sigKey = `${slideKey}:${w.sig}`;
      selectedSignatures.set(sigKey, (selectedSignatures.get(sigKey) || 0) + 1);
      // Also track character+location combos
      if (req.promptContext.characterName && w.img.subject && w.img.location_ref) {
        const dupKey = `${slideKey}:${(w.img.subject as string).toLowerCase()}:${w.img.location_ref}:${w.img.shot_type}`;
        selectedSignatures.set(dupKey, (selectedSignatures.get(dupKey) || 0) + 1);
      }
    }

    // Determine satisfaction
    let status: SatisfactionStatus;
    let blockingReason: string | undefined;
    if (satisfiedCount >= req.minRequired) {
      status = 'satisfied';
    } else if (satisfiedCount > 0) {
      status = 'partial';
      blockingReason = `${satisfiedCount}/${req.minRequired} minimum met`;
    } else {
      status = 'blocked';
      blockingReason = 'No matching images generated';
    }

    results.push({
      requirement: req,
      status,
      generatedCount: satisfiedCount,
      selectedCount: winners.length,
      blockingReason,
    });

    // Update progress
    const pIdx = progressReqs.findIndex(p => p.id === req.id);
    if (pIdx >= 0) {
      progressReqs[pIdx].selectedCount = winners.length;
      progressReqs[pIdx].generatedCount = satisfiedCount;
      progressReqs[pIdx].status = status === 'satisfied' ? 'selected' : (status === 'partial' ? 'generated' : 'blocked');
      if (blockingReason) progressReqs[pIdx].blockingReason = blockingReason;
    }

    // Add to working set
    for (let i = 0; i < winners.length; i++) {
      const { img, score } = winners[i];
      allEntries.push({
        slideId: `${req.slideType}:main`,
        slideType: req.slideType,
        slotId: `req_${req.id}_${i}`,
        image: img,
        source: 'generated',
        score,
        signedUrl: img.signedUrl!,
      });
    }
  }

  // Build working set
  const bySlotKey = new Map<string, WorkingSetEntry>();
  for (const entry of allEntries) {
    const key = `${entry.slideId}:${entry.slotId}`;
    const existing = bySlotKey.get(key);
    if (!existing || entry.score > existing.score) {
      bySlotKey.set(key, entry);
    }
  }

  const totalSatisfied = results.filter(r => r.status === 'satisfied').length;
  const totalPartial = results.filter(r => r.status === 'partial').length;
  const totalBlocked = results.filter(r => r.status === 'blocked').length;

  log(`Requirement fulfillment: ${totalSatisfied} satisfied, ${totalPartial} partial, ${totalBlocked} blocked (${totalGenerated} generated, ${totalFailed} failed)`);

  reportReqs(PipelineStage.GENERATION, `${totalSatisfied}/${results.length} requirements satisfied`, 100);

  return {
    results,
    workingSet: { entries: allEntries, bySlotKey },
    totalGenerated,
    totalFailed,
    totalSatisfied,
    totalPartial,
    totalBlocked,
  };
}

// ── Scene Diversity ──────────────────────────────────────────────────────────

/**
 * Compute a lightweight scene signature for diversity control.
 * Uses location_ref, subject, shot_type, and composition hints.
 */
function computeSceneSignature(img: ProjectImage): string {
  const parts: string[] = [];
  if (img.location_ref) parts.push(`loc:${img.location_ref}`);
  if (img.subject) parts.push(`subj:${(img.subject as string).toLowerCase()}`);
  if (img.shot_type) parts.push(`shot:${img.shot_type}`);
  // If no distinguishing metadata, use a generic signature
  if (parts.length === 0) return 'generic';
  return parts.join('|');
}

// ── Shot-type compatibility mapping ──────────────────────────────────────────
// Identity shot types map to their requirement equivalents for matching

const SHOT_TYPE_COMPAT: Record<string, string[]> = {
  identity_headshot: ['close_up', 'portrait'],
  identity_profile: ['three_quarter', 'close_up', 'profile'],
  identity_full_body: ['medium', 'full_body'],
  close_up: ['identity_headshot', 'portrait'],
  medium: ['identity_full_body'],
  full_body: ['identity_full_body'],
  three_quarter: ['identity_profile', 'profile'],
  profile: ['identity_profile', 'three_quarter'],
};

function areShotTypesCompatible(actual: string | null, requested: string): boolean {
  if (!actual) return false;
  if (actual === requested) return true;
  const compatList = SHOT_TYPE_COMPAT[actual];
  return compatList ? compatList.includes(requested) : false;
}

// ── Internal types ───────────────────────────────────────────────────────────

interface GenerationBatchRecord {
  section: string;
  pass: string;
  batchIndex: number;
  targetRequirementId: string;
  slideType: string;
  shotType: string;
  subjectType: string;
  characterName?: string;
  generatedAt: string;
  successCount: number;
}
