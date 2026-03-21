/**
 * requirementExecutor — Processes LookBook requirements in domain passes.
 *
 * Executes generation per requirement, tracks satisfaction, and produces
 * a working set of generated candidates for election.
 *
 * Selection truth order:
 * 1. Hard slot-purpose validity (slotPurposeValidator)
 * 2. Identity correctness
 * 3. Requirement-origin / target_requirement_id
 * 4. Shot / orientation / provenance / timing / other heuristics
 *
 * Controls:
 * - Hard identity lock enforcement for character generation
 * - Slide-type visual guardrails injected into every prompt
 * - Slot-purpose rejection BEFORE final winner admission
 * - Scene diversity scoring to prevent visual repetition
 * - Deterministic requirement-origin matching when metadata exists
 * - Deck-level overuse penalty for repeated room/setup across editorial slides
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
import { validateCandidateForSlidePurpose, isEditorialSlide } from './slotPurposeValidator';
import { resolveProjectCastIdentity, type ActorIdentityAnchors } from '@/lib/aiCast/resolveActorIdentity';

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

// ── Identity Anchor Adapter ──────────────────────────────────────────────────
// Adapts the canonical ActorIdentityAnchors to the internal CharacterAnchorSet
// shape consumed by the rest of this file.

interface CharacterAnchorSet {
  headshot?: string;
  fullBody?: string;
  hasAnchors: boolean;
  /** Source of identity resolution — actor_bound, fallback_project_images, or unresolved */
  source: ActorIdentityAnchors['source'];
  /** AI Actor ID if actor-bound */
  aiActorId?: string | null;
  /** Additional reference URLs from actor assets */
  additionalRefs?: string[];
}

/**
 * Resolve identity anchors using the canonical actor-aware resolver.
 * Checks project_ai_cast → actor assets first, falls back to project_images.
 */
async function resolveCharacterAnchors(projectId: string): Promise<Map<string, CharacterAnchorSet>> {
  const canonicalMap = await resolveProjectCastIdentity(projectId);
  const map = new Map<string, CharacterAnchorSet>();

  for (const [key, anchors] of canonicalMap) {
    map.set(key, {
      headshot: anchors.headshot || undefined,
      fullBody: anchors.fullBody || undefined,
      hasAnchors: anchors.hasAnchors,
      source: anchors.source,
      aiActorId: anchors.aiActorId,
      additionalRefs: anchors.additionalRefs,
    });
  }

  return map;
}

// ── Pass order (deterministic) ───────────────────────────────────────────────

const PASS_ORDER: RequirementPass[] = ['character', 'world', 'key_moments', 'atmosphere', 'poster'];

// ── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 4;
const MAX_CALLS_PER_SECTION = 5;
const MAX_CONSECUTIVE_FAILURES = 2;
/** Max times the same scene signature can appear across editorial slides */
const EDITORIAL_FAMILY_CAP = 1;

// ── ANY slide that can contain named principal characters ──
const CHARACTER_BEARING_SLIDES = new Set([
  'characters', 'cover', 'poster_directions', 'key_moments', 'story_engine',
  'creative_statement', 'themes', 'closing',
]);

// ── Executor ─────────────────────────────────────────────────────────────────

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

  const generationBatches: GenerationBatchRecord[] = [];

  // ── RESOLVE CHARACTER IDENTITY ANCHORS ──
  log('Resolving character identity anchors...');
  const characterAnchors = await resolveCharacterAnchors(projectId);
  log(`Identity anchors resolved: ${characterAnchors.size} characters with anchors`);
  for (const [name, anchors] of characterAnchors) {
    if (anchors.hasAnchors) {
      log(`  ✓ ${name}: source=${anchors.source} headshot=${!!anchors.headshot} fullBody=${!!anchors.fullBody}${anchors.aiActorId ? ` actor=${anchors.aiActorId}` : ''}${anchors.additionalRefs?.length ? ` +${anchors.additionalRefs.length} refs` : ''}`);
    } else if (anchors.source === 'actor_bound') {
      log(`  ⚠ ${name}: actor-bound but no usable anchors (actor=${anchors.aiActorId})`);
    }
  }

  // ── DECK-LEVEL DIVERSITY TRACKING ──
  // Track scene signatures across ALL slides for deck-wide overuse detection
  const deckSignatureUsage = new Map<string, { count: number; slides: string[] }>();
  // Track per-slide signatures for within-slide diversity
  const perSlideSignatures = new Map<string, Map<string, number>>();

  // Process each pass in order
  for (const pass of PASS_ORDER) {
    const passReqs = requirementSet.byPass[pass];
    if (!passReqs || passReqs.length === 0) continue;

    log(`── PASS: ${pass.toUpperCase()} (${passReqs.length} requirements) ──`);

    for (const req of passReqs) {
      const pIdx = progressReqs.findIndex(p => p.id === req.id);
      if (pIdx >= 0) progressReqs[pIdx].status = 'planning';
    }
    reportReqs(PipelineStage.GENERATION, `Planning ${pass} pass...`, 30);

    const bySection = new Map<string, LookBookRequirement[]>();
    for (const req of passReqs) {
      const existing = bySection.get(req.section) || [];
      existing.push(req);
      bySection.set(req.section, existing);
    }

    for (const [section, sectionReqs] of bySection) {
      for (const req of sectionReqs) {
        const pIdx = progressReqs.findIndex(p => p.id === req.id);
        if (pIdx >= 0) progressReqs[pIdx].status = 'generating';
      }
      reportReqs(PipelineStage.GENERATION, `Generating ${pass}: ${section}...`, 50);

      const totalNeeded = sectionReqs.reduce((sum, r) => sum + r.preferred, 0);
      let totalGeneratedForSection = 0;
      let consecutiveFailures = 0;
      let callCount = 0;

      while (
        totalGeneratedForSection < totalNeeded &&
        callCount < MAX_CALLS_PER_SECTION &&
        consecutiveFailures < MAX_CONSECUTIVE_FAILURES
      ) {
        const remaining = totalNeeded - totalGeneratedForSection;
        const count = Math.min(remaining, BATCH_SIZE);
        callCount++;

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
        const constraintSuffix = buildConstraintPromptSuffix(targetReq.slideType);
        if (constraintSuffix) {
          prompt = `${prompt} ${constraintSuffix}`;
        }

        if (targetReq.hardNegatives.length > 0) {
          prompt = `${prompt} NEGATIVE: ${targetReq.hardNegatives.join(', ')}.`;
        }

        log(`[${section}] batch ${callCount}: generating ${count} (${totalGeneratedForSection}/${totalNeeded} done, req=${targetReq.id})`);

        // ── GLOBAL IDENTITY LOCK ENFORCEMENT ──
        // Applies to ANY requirement that references known characters
        let identityPayload: Record<string, unknown> = {};
        const allCharNames = resolveAllCharacterNamesFromReq(targetReq);
        const resolvedAnchors: Record<string, { headshot: string | null; fullBody: string | null }> = {};
        let identityCharCount = 0;

        for (const cn of allCharNames) {
          const key = cn.toLowerCase().trim();
          const anchors = characterAnchors.get(key);
          if (anchors?.hasAnchors) {
            resolvedAnchors[cn] = {
              headshot: anchors.headshot || null,
              fullBody: anchors.fullBody || null,
            };
            identityCharCount++;
          }
        }

        if (identityCharCount > 0) {
          // Single vs multi-character payload
          if (identityCharCount === 1) {
            const [name, anch] = Object.entries(resolvedAnchors)[0];
            identityPayload = {
              identity_mode: true,
              identity_locked: true,
              identity_anchor_paths: anch,
              identity_notes: targetReq.promptContext.characterTraits || null,
              identity_mode_used: true,
              identity_character_count: 1,
            };
            log(`[${section}] Identity LOCKED for "${name}" (headshot=${!!anch.headshot}, fullBody=${!!anch.fullBody})`);
          } else {
            identityPayload = {
              identity_mode: true,
              identity_locked: true,
              identity_anchor_paths: resolvedAnchors,
              identity_notes: `Maintain exact facial identity consistency for all characters based on provided references. ${targetReq.promptContext.characterTraits || ''}`.trim(),
              identity_mode_used: true,
              identity_character_count: identityCharCount,
            };
            log(`[${section}] Multi-character identity LOCKED for ${Object.keys(resolvedAnchors).join(', ')} (${identityCharCount} chars)`);
          }
        } else if (allCharNames.length > 0) {
          identityPayload = {
            identity_mode_used: false,
            identity_character_count: 0,
          };
          log(`[${section}] No identity anchors for characters [${allCharNames.join(', ')}] — generating without lock`);
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
            consecutiveFailures = 0;
          } else {
            consecutiveFailures++;
          }

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

  // ── REQUIREMENT MATCHING + SELECTION ──
  for (const req of requirementSet.requirements) {
    log(`[ReqSelect] ── req=${req.id} slide=${req.slideType} pass=${req.pass} ──`);

    // ── Step 1: Find direct requirement-origin pool ──
    const directPool = candidates.filter(c => {
      if (!c.signedUrl) return false;
      const gc = (c as any).generation_config as Record<string, unknown> | null;
      const autoCtx = gc?.auto_complete_context as Record<string, unknown> | null;
      return autoCtx?.target_requirement_id === req.id;
    });

    // ── Step 2: Apply HARD SLOT-PURPOSE VALIDATION to direct pool ──
    let validDirectPool: ProjectImage[] = [];
    let rejectedDirectCount = 0;
    for (const img of directPool) {
      const validation = validateCandidateForSlidePurpose(img, req.slideType);
      if (validation.allowed) {
        validDirectPool.push(img);
      } else {
        rejectedDirectCount++;
        log(`[Match:reject] req=${req.id} candidate=${(img as any).id || 'unknown'} reason=slot-purpose-invalid: ${validation.reasons.join('; ')}`);
      }
    }

    if (rejectedDirectCount > 0) {
      log(`[ReqSelect] req=${req.id} directPool=${directPool.length} rejectedForPurpose=${rejectedDirectCount} validAfterGuardrails=${validDirectPool.length}`);
    }

    // ── Step 3: Determine pool — use valid direct matches first, then fallback ──
    const useDirectOnly = validDirectPool.length > 0;
    const pool = useDirectOnly ? validDirectPool : candidates.filter(c => {
      if (!c.signedUrl) return false;
      if ((c as any).asset_group && (c as any).asset_group !== req.assetGroup) return false;
      // Apply slot-purpose validation to fallback pool too
      const validation = validateCandidateForSlidePurpose(c, req.slideType);
      return validation.allowed;
    });

    if (useDirectOnly) {
      log(`[ReqSelect] req=${req.id} using ${validDirectPool.length} direct requirement-origin matches (deterministic, slot-validated)`);
    } else {
      log(`[ReqSelect] req=${req.id} using fallback pool (${pool.length} candidates after slot-purpose filter)`);
    }

    // ── Step 4: Score candidates ──
    const scored = pool.map(img => {
      let score = 0;
      const gc = (img as any).generation_config as Record<string, unknown> | null;
      const autoCtx = gc?.auto_complete_context as Record<string, unknown> | null;

      // Slot-purpose penalty (soft adjustments for allowed-but-imperfect)
      const purposeValidation = validateCandidateForSlidePurpose(img, req.slideType);
      score += purposeValidation.penalty;

      // ── Requirement-origin matching ──
      if (autoCtx?.target_requirement_id === req.id) {
        score += 25;
      } else if (!useDirectOnly) {
        if (autoCtx?.slide_type === req.slideType) score += 12;
        else if (autoCtx?.pass === req.pass) score += 6;
      }

      // ── Identity consistency bonus/penalty ──
      if (req.promptContext.characterName) {
        const reqCharLower = req.promptContext.characterName.toLowerCase();

        // Strong bonus: generated with identity lock for correct character
        if (gc?.identity_locked || gc?.identity_mode) {
          const resolvedNames = gc?.resolved_character_names;
          if (Array.isArray(resolvedNames) && resolvedNames.some((n: string) => n.toLowerCase().includes(reqCharLower))) {
            score += 15; // Identity-locked + correct character
          } else if (img.subject && (img.subject as string).toLowerCase().includes(reqCharLower)) {
            score += 12; // Subject name match with identity lock
          }
        }

        // identity_mode_used bonus (from our generation metadata)
        if (gc?.identity_mode_used === true) {
          score += 5;
        }

        // Character name match (general)
        if (img.subject && (img.subject as string).toLowerCase().includes(reqCharLower)) {
          score += 15;
        }

        // ── IDENTITY DRIFT PENALTY (STRONG) ──
        // Candidate has NO identity metadata at all for a character requirement
        if (!gc?.identity_mode && !gc?.identity_locked && !gc?.identity_mode_used) {
          score -= 20; // No identity context = strong penalty
          log(`[Match:no-identity] req=${req.id} candidate has no identity metadata for character "${req.promptContext.characterName}"`);
        }

        // Candidate is for WRONG character
        if (img.subject && !(img.subject as string).toLowerCase().includes(reqCharLower)) {
          const subjectLower = (img.subject as string).toLowerCase();
          if (subjectLower.length > 2 && !subjectLower.includes('character') && !subjectLower.includes('unknown')) {
            score -= 25; // Wrong character identity — heavy penalty
            log(`[Match:identity-drift] req=${req.id} candidate subject="${img.subject}" doesn't match required "${req.promptContext.characterName}"`);
          }
        }
      }

      // ── Orientation match ──
      const orient = classifyOrientation(img.width, img.height);
      if (req.orientation === 'any' || orient === req.orientation) score += 10;
      else if (orient === 'square') score += 3;

      // ── Shot type match ──
      if (img.shot_type === req.shotType) score += 8;
      else if (areShotTypesCompatible(img.shot_type, req.shotType)) score += 6;
      else if (autoCtx?.requested_shot_type === req.shotType) score += 5;

      // ── Entity/provenance match ──
      if (img.entity_id || img.location_ref || img.moment_ref) score += 6;

      // ── Batch metadata match (fallback) ──
      if (!useDirectOnly) {
        const batchMatch = generationBatches.find(b =>
          b.targetRequirementId === req.id && b.section === req.section
        );
        if (batchMatch && batchMatch.successCount > 0) {
          const imgCreated = (img as any).created_at;
          if (imgCreated && batchMatch.generatedAt &&
            Math.abs(new Date(imgCreated).getTime() - new Date(batchMatch.generatedAt).getTime()) < 30000) {
            score += 8;
          }
        }
      }

      // ── SCENE DIVERSITY PENALTY (per-slide) ──
      const sig = computeSceneSignature(img);
      const slideKey = req.slideType;
      const slideSigs = perSlideSignatures.get(slideKey) || new Map<string, number>();
      const sigCount = slideSigs.get(sig) || 0;
      if (sigCount > 0) {
        score -= 10 * sigCount;
      }

      // ── DECK-LEVEL OVERUSE PENALTY (editorial slides) ──
      if (isEditorialSlide(req.slideType)) {
        const deckUsage = deckSignatureUsage.get(sig);
        if (deckUsage && deckUsage.count >= EDITORIAL_FAMILY_CAP) {
          score -= 15; // Already used this scene family on another editorial slide
          log(`[Match:diversity] req=${req.id} sig="${sig}" already used on ${deckUsage.slides.join(',')} — deck overuse penalty`);
        }
      }

      // Character+location duplicate penalty
      if (req.promptContext.characterName && img.subject && img.location_ref) {
        const dupKey = `${slideKey}:${(img.subject as string).toLowerCase()}:${img.location_ref}:${img.shot_type}`;
        const dupCount = slideSigs.get(dupKey) || 0;
        if (dupCount > 0) score -= 15;
      }

      return { img, score, sig };
    });
    scored.sort((a, b) => b.score - a.score);

    // Take best matches up to preferred count
    const winners = scored.slice(0, req.preferred);
    const satisfiedCount = winners.length;

    // Record selected signatures for diversity tracking
    if (!perSlideSignatures.has(req.slideType)) {
      perSlideSignatures.set(req.slideType, new Map());
    }
    const slideSigs = perSlideSignatures.get(req.slideType)!;
    for (const w of winners) {
      slideSigs.set(w.sig, (slideSigs.get(w.sig) || 0) + 1);
      // Update deck-level tracking
      const deckEntry = deckSignatureUsage.get(w.sig) || { count: 0, slides: [] };
      deckEntry.count++;
      if (!deckEntry.slides.includes(req.slideType)) deckEntry.slides.push(req.slideType);
      deckSignatureUsage.set(w.sig, deckEntry);
      // Character+location tracking
      if (req.promptContext.characterName && w.img.subject && w.img.location_ref) {
        const dupKey = `${req.slideType}:${(w.img.subject as string).toLowerCase()}:${w.img.location_ref}:${w.img.shot_type}`;
        slideSigs.set(dupKey, (slideSigs.get(dupKey) || 0) + 1);
      }
    }

    // Log selection decision
    const topRejected = scored.slice(req.preferred, req.preferred + 3);
    log(`[ReqSelect] req=${req.id} directPool=${directPool.length} validAfterGuardrails=${validDirectPool.length} ` +
      `fallbackPool=${useDirectOnly ? 0 : pool.length} selected=${winners.length}/${req.preferred} ` +
      `identityLocked=${!!Object.keys(identityPayloadForReq(req, characterAnchors)).length} ` +
      `topScores=[${winners.map(w => w.score).join(',')}] ` +
      `nextRejected=[${topRejected.map(r => r.score).join(',')}]`);

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
      // Provide specific blocking reason for character requirements
      if (req.subjectType === 'character' && req.promptContext.characterName) {
        const key = req.promptContext.characterName.toLowerCase().trim();
        const anchors = characterAnchors.get(key);
        if (anchors?.hasAnchors) {
          blockingReason = `Identity anchors present for "${req.promptContext.characterName}" but no compliant generations matched`;
        } else {
          blockingReason = `No identity anchors and no matching images for "${req.promptContext.characterName}"`;
        }
      } else {
        blockingReason = 'No matching images generated';
      }
    }

    results.push({
      requirement: req,
      status,
      generatedCount: satisfiedCount,
      selectedCount: winners.length,
      blockingReason,
    });

    const pIdx = progressReqs.findIndex(p => p.id === req.id);
    if (pIdx >= 0) {
      progressReqs[pIdx].selectedCount = winners.length;
      progressReqs[pIdx].generatedCount = satisfiedCount;
      progressReqs[pIdx].status = status === 'satisfied' ? 'selected' : (status === 'partial' ? 'generated' : 'blocked');
      if (blockingReason) progressReqs[pIdx].blockingReason = blockingReason;
    }

    // Add to working set — normalize character slide slot ids for richer assembly
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract ALL character names referenced by a requirement.
 * Checks characterName, characters array, and prompt context hints.
 */
function resolveAllCharacterNamesFromReq(req: LookBookRequirement): string[] {
  const names: string[] = [];
  if (req.promptContext.characterName) {
    names.push(req.promptContext.characterName);
  }
  // Support comma-separated characters field
  if (req.promptContext.characters) {
    for (const n of req.promptContext.characters.split(',')) {
      const trimmed = n.trim();
      if (trimmed && !names.some(x => x.toLowerCase() === trimmed.toLowerCase())) {
        names.push(trimmed);
      }
    }
  }
  return names;
}

/** Check if a requirement would get identity payload */
function identityPayloadForReq(
  req: LookBookRequirement,
  anchors: Map<string, CharacterAnchorSet>,
): Record<string, unknown> {
  const allNames = resolveAllCharacterNamesFromReq(req);
  if (allNames.length === 0) return {};
  for (const n of allNames) {
    const a = anchors.get(n.toLowerCase().trim());
    if (a?.hasAnchors) return { identity_mode: true };
  }
  return {};
}


function computeSceneSignature(img: ProjectImage): string {
  const parts: string[] = [];
  if (img.location_ref) parts.push(`loc:${img.location_ref}`);
  if (img.subject) parts.push(`subj:${(img.subject as string).toLowerCase()}`);
  if (img.shot_type) parts.push(`shot:${img.shot_type}`);
  // Use generation prompt hints for better signature when metadata is sparse
  const gc = (img as any).generation_config as Record<string, unknown> | null;
  const autoCtx = gc?.auto_complete_context as Record<string, unknown> | null;
  if (!img.location_ref && autoCtx?.slide_type) {
    parts.push(`stype:${autoCtx.slide_type}`);
  }
  if (parts.length === 0) return `generic_${(img as any).id || Math.random().toString(36).slice(2, 8)}`;
  return parts.join('|');
}

// ── Shot-type compatibility mapping ──────────────────────────────────────────

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
