/**
 * generateLookBookData — Assembles Look Book slides from canonical project state.
 * Uses resolveAllCanonImages for section-accurate image resolution,
 * matching the same DB queries as the workspace panels.
 *
 * Every slide gets a deterministic slide_id for stable identity across rebuilds.
 *
 * CINEMATIC MODE: Resolves background images per slide and assigns
 * composition modes for premium full-bleed cinematic presentation.
 */
import { supabase } from '@/integrations/supabase/client';
import { getCanonicalProjectState } from '@/lib/canon/getCanonicalProjectState';
import type { LookBookData, LookBookVisualIdentity, SlideContent, SlideImageProvenance, LookBookColorSystem, SlideUserDecisions, SlideComposition } from './types';
import { resolveAllCanonImages } from './resolveCanonImages';
import type { ResolvedImageProvenance, SectionImageResult } from './resolveCanonImages';
import { isVerticalDrama as checkVD } from '@/lib/format-helpers';
import { normalizeCanonText } from './normalizeCanonText';
import { resolveLookbookLayoutFamily, summarizeOrientations, type LayoutFamilyKey } from './lookbookLayoutFamilies';
import { matchImagesToSlots, type ImageCandidate } from './lookbookSlotMatcher';
import type { ProjectImage } from '@/lib/images/types';
import { classifyOrientation } from '@/lib/images/orientationUtils';

/**
 * Generate a deterministic semantic slide_id from a kind and optional variant.
 * Semantic IDs are stable across rebuilds regardless of slide ordering.
 * 
 * Examples: 'cover:main', 'characters:main', 'key_moments:act1'
 * 
 * Do NOT use ordinals. If a variant is needed, use a semantic discriminator.
 */
export function makeSemanticSlideId(kind: string, variant: string = 'main'): string {
  return `${kind}:${variant}`;
}

/**
 * Legacy ordinal-to-semantic migration map.
 * Maps old ordinal IDs (from prior builds) to their new semantic equivalents.
 * Used only during mergeUserDecisions for one-time forward migration.
 */
const LEGACY_ORDINAL_TO_SEMANTIC: Record<string, string> = {
  'cover': 'cover:main',
  'overview': 'overview:main',
  'world': 'world:main',
  'characters': 'characters:main',
  'themes': 'themes:main',
  'visual_language': 'visual_language:main',
  'story_engine': 'story_engine:main',
  'key_moments': 'key_moments:main',
  'comparables': 'comparables:main',
  'creative_statement': 'creative_statement:main',
  'closing': 'closing:main',
};

/**
 * Merge forward valid user decisions from a previous build into freshly generated slides.
 * Matches by slide_id for stability. Drops decisions that reference invalid/unsupported layouts.
 */
export function mergeUserDecisions(
  freshSlides: SlideContent[],
  previousSlides: SlideContent[],
): { merged: SlideContent[]; preservedCount: number; droppedCount: number; dropReasons: string[]; migratedCount: number } {
  const prevBySlideId = new Map<string, SlideUserDecisions>();
  for (const s of previousSlides) {
    if (s.slide_id && s.user_decisions && Object.keys(s.user_decisions).length > 0) {
      prevBySlideId.set(s.slide_id, s.user_decisions);
    }
  }

  if (prevBySlideId.size === 0) {
    return { merged: freshSlides, preservedCount: 0, droppedCount: 0, dropReasons: [], migratedCount: 0 };
  }

  let preservedCount = 0;
  let droppedCount = 0;
  let migratedCount = 0;
  const dropReasons: string[] = [];

  const merged = freshSlides.map(slide => {
    // 1. Try exact semantic slide_id match first
    let prevDecisions = prevBySlideId.get(slide.slide_id);
    let matchSource = 'exact';

    // 2. If not found, try legacy ordinal-to-semantic migration
    if (!prevDecisions) {
      for (const [legacyId, semanticId] of Object.entries(LEGACY_ORDINAL_TO_SEMANTIC)) {
        if (semanticId === slide.slide_id && prevBySlideId.has(legacyId)) {
          prevDecisions = prevBySlideId.get(legacyId);
          matchSource = 'legacy_migration';
          migratedCount++;
          console.log(`[LookBook merge] migrated legacy ID '${legacyId}' → '${slide.slide_id}'`);
          break;
        }
      }
    }

    if (!prevDecisions) return slide;

    // If slide has unresolved images, do not preserve layout override
    if (slide._has_unresolved && prevDecisions.layout_family) {
      droppedCount++;
      dropReasons.push(`${slide.slide_id}: dropped layout_family (unresolved images, match=${matchSource})`);
      return slide;
    }

    // Preserve valid decisions
    const effectiveFamily = prevDecisions.layout_family || slide.layoutFamily || 'landscape_standard';
    preservedCount++;
    console.log(`[LookBook merge] preserved user_decisions for '${slide.slide_id}' (match=${matchSource})`);
    return {
      ...slide,
      user_decisions: { ...prevDecisions },
      layoutFamilyOverride: prevDecisions.layout_family || null,
      layoutFamilyOverrideSource: prevDecisions.layout_family ? 'user' as const : null,
      layoutFamilyEffective: effectiveFamily,
    };
  });

  console.log(`[LookBook merge] result: preserved=${preservedCount}, dropped=${droppedCount}, migrated=${migratedCount}`);
  return { merged, preservedCount, droppedCount, dropReasons, migratedCount };
}
// ── Color palettes by tone/genre ──
const COLOR_PALETTES: Record<string, LookBookColorSystem> = {
  dark: {
    bg: '#0A0A0F', bgSecondary: '#131318',
    text: '#F0EDE8', textMuted: '#8A8680',
    accent: '#C4913A', accentMuted: 'rgba(196, 145, 58, 0.25)',
    gradientFrom: '#0A0A0F', gradientTo: '#1A1510',
  },
  thriller: {
    bg: '#070B12', bgSecondary: '#0D1420',
    text: '#E8ECF0', textMuted: '#6B7B8D',
    accent: '#4A90D9', accentMuted: 'rgba(74, 144, 217, 0.2)',
    gradientFrom: '#070B12', gradientTo: '#0A1525',
  },
  warm: {
    bg: '#100A06', bgSecondary: '#1A1208',
    text: '#F0E8DD', textMuted: '#9A8A72',
    accent: '#D4874A', accentMuted: 'rgba(212, 135, 74, 0.2)',
    gradientFrom: '#100A06', gradientTo: '#1F1508',
  },
  prestige: {
    bg: '#08080C', bgSecondary: '#111118',
    text: '#EEEEF2', textMuted: '#7A7A88',
    accent: '#B89A5A', accentMuted: 'rgba(184, 154, 90, 0.2)',
    gradientFrom: '#08080C', gradientTo: '#151218',
  },
  horror: {
    bg: '#0A0506', bgSecondary: '#160A0C',
    text: '#F0E5E5', textMuted: '#8A6565',
    accent: '#C44040', accentMuted: 'rgba(196, 64, 64, 0.2)',
    gradientFrom: '#0A0506', gradientTo: '#1A0A0A',
  },
  verdant: {
    bg: '#060C08', bgSecondary: '#0C180E',
    text: '#E8F0EA', textMuted: '#6A8A70',
    accent: '#5AAE6A', accentMuted: 'rgba(90, 174, 106, 0.2)',
    gradientFrom: '#060C08', gradientTo: '#0A1A0C',
  },
  oceanic: {
    bg: '#06090E', bgSecondary: '#0A1018',
    text: '#E5ECF5', textMuted: '#6580A0',
    accent: '#3A8ABF', accentMuted: 'rgba(58, 138, 191, 0.2)',
    gradientFrom: '#06090E', gradientTo: '#081520',
  },
};

function resolveColorPalette(tone?: string, genre?: string): LookBookColorSystem {
  const t = (tone || '').toLowerCase();
  const g = (genre || '').toLowerCase();
  if (t.includes('dark') || t.includes('noir') || g.includes('drama')) return COLOR_PALETTES.dark;
  if (g.includes('thriller') || g.includes('crime') || t.includes('cold')) return COLOR_PALETTES.thriller;
  if (g.includes('horror') || t.includes('horror')) return COLOR_PALETTES.horror;
  if (t.includes('warm') || g.includes('romance') || g.includes('comedy')) return COLOR_PALETTES.warm;
  if (g.includes('adventure') || g.includes('nature') || g.includes('fantasy')) return COLOR_PALETTES.verdant;
  if (g.includes('sci-fi') || g.includes('scifi')) return COLOR_PALETTES.oceanic;
  return COLOR_PALETTES.prestige;
}

interface NormalizedLookBookCanonText {
  logline: string;
  premise: string;
  world_rules: string;
  locations: string;
  timeline: string;
  tone_style: string;
  format_constraints: string;
  comparables: string;
}

function normalizeLookBookCanon(canon: Record<string, unknown>): NormalizedLookBookCanonText {
  return {
    logline: normalizeCanonText(canon.logline, 'logline'),
    premise: normalizeCanonText(canon.premise, 'premise'),
    world_rules: normalizeCanonText(canon.world_rules, 'world_rules'),
    locations: normalizeCanonText(canon.locations, 'locations'),
    timeline: normalizeCanonText(canon.timeline, 'timeline'),
    tone_style: normalizeCanonText(canon.tone_style, 'tone_style'),
    format_constraints: normalizeCanonText(canon.format_constraints, 'format_constraints'),
    comparables: normalizeCanonText(canon.comparables, 'comparables'),
  };
}

function resolveIdentity(toneStyle: string, genre?: string): LookBookVisualIdentity {
  const colors = resolveColorPalette(toneStyle, genre);
  const t = toneStyle.toLowerCase();
  return {
    colors,
    typography: {
      titleFont: 'Fraunces',
      bodyFont: 'DM Sans',
      titleUppercase: t.includes('thriller') || t.includes('action') || t.includes('horror'),
    },
    imageStyle: t.includes('cold') || t.includes('thriller') ? 'cinematic-cold'
      : t.includes('vintage') || t.includes('period') ? 'vintage'
      : t.includes('dark') ? 'high-contrast'
      : 'cinematic-warm',
  };
}

function parseComparables(text?: string): Array<{ title: string; reason: string }> {
  if (!text) return [];
  return text.split('\n').filter(Boolean).slice(0, 4).map(line => {
    const match = line.match(/^[•\-*]?\s*(.+?)(?:\s*[-–—:]\s*(.+))?$/);
    if (match) return { title: match[1].trim(), reason: match[2]?.trim() || '' };
    return { title: line.trim(), reason: '' };
  });
}

/* ── Content-strengthening helpers ── */

function buildVisualLanguageCopy(
  canon: NormalizedLookBookCanonText,
  genre: string,
  tone: string,
  imageStyle: string,
): { body: string; bullets: string[] } {
  const period = canon.world_rules.match(/\b(19\d{2}|20\d{2}|18\d{2}|contemporary|modern|medieval|victorian|future|futuristic)\b/i)?.[0] || '';
  const worldRules = canon.world_rules;
  const toneStyle = canon.tone_style || tone || '';

  const fragments: string[] = [];
  if (period) {
    fragments.push(`rooted in the texture and light of ${period.toLowerCase().includes('19') || period.toLowerCase().includes('18') ? `the ${period}s` : period.toLowerCase()}`);
  }
  if (toneStyle) fragments.push(`carrying the emotional weight of ${toneStyle.toLowerCase()}`);
  if (genre) fragments.push(`filtered through the grammar of ${genre.toLowerCase()}`);

  const body = fragments.length > 0
    ? `A deliberate visual system ${fragments.join(', ')}. Every frame is designed to immerse the audience in the world before a single word is spoken — atmosphere, texture, and light do the storytelling.`
    : 'A unified visual philosophy where atmosphere, colour, and composition serve the narrative. The image system is designed to be felt before it is understood — each frame functions as emotional evidence.';

  const bullets: string[] = [];
  const styleLabel = imageStyle.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());

  if (worldRules && worldRules.length > 20) {
    const worldSnippet = worldRules.slice(0, 80).replace(/[.!]?\s*$/, '');
    bullets.push(`World-grounded palette: ${worldSnippet}`);
  } else {
    bullets.push(`${styleLabel} tonality — naturalistic colour, controlled contrast, cinematic depth of field`);
  }

  if (toneStyle) {
    bullets.push(`Emotional register: ${toneStyle} — every lighting choice and composition reinforces this`);
  }

  if (period) {
    bullets.push('Period authenticity in production design, costume texture, and environmental detail');
  } else {
    bullets.push('Consistent environmental design language across all locations and scenes');
  }

  bullets.push('Visual continuity between marketing materials, key art, and in-narrative imagery');

  return { body, bullets };
}

function buildStoryEngineCopy(
  canon: NormalizedLookBookCanonText,
  format: string,
  genre: string,
): { body: string; bodySecondary: string; bullets: string[] } {
  const formatConstraints = canon.format_constraints;
  const toneStyle = canon.tone_style;
  const isSeries = format.includes('series') || format.includes('vertical') || format.includes('limited');

  let body: string;
  if (formatConstraints && formatConstraints.length > 30) {
    body = formatConstraints.slice(0, 400);
  } else if (isSeries) {
    body = 'A serialised narrative engineered for sustained emotional investment. The dramatic architecture is designed so that each episode compounds tension, deepens character, and raises the stakes — the audience is always leaning forward.';
  } else {
    body = 'A tightly structured narrative built around escalating dramatic pressure. The story is designed to sustain audience engagement from the opening image to the final frame through careful emotional calibration and narrative momentum.';
  }

  let bodySecondary = '';
  if (toneStyle) {
    bodySecondary = `The tonal register — ${toneStyle.toLowerCase()} — governs pacing, revelation timing, and the balance between tension and release across the full narrative arc.`;
  }

  const bullets: string[] = [];
  if (isSeries) {
    bullets.push('Episode-end hooks create compulsive viewing momentum');
    bullets.push('Character arcs calibrated across the full season trajectory');
    bullets.push('Escalating dramatic stakes with controlled revelation pacing');
    if (genre.toLowerCase().includes('thriller') || genre.toLowerCase().includes('crime')) {
      bullets.push('Investigative or procedural spine sustains episodic structure');
    } else {
      bullets.push('Thematic deepening rewards sustained audience attention');
    }
  } else {
    bullets.push('Three-act escalation with controlled tonal shifts');
    bullets.push('Character transformation as the primary engine of dramatic momentum');
    bullets.push('Audience alignment shifts create re-watch value');
  }

  return { body, bodySecondary, bullets };
}

function buildThemesCopy(
  canon: NormalizedLookBookCanonText,
  genre: string,
  tone: string,
): { body: string; bodySecondary: string } {
  const toneStyle = canon.tone_style || tone || '';
  const worldRules = canon.world_rules;
  const logline = canon.logline;

  let body = toneStyle;
  if (toneStyle.length < 60) {
    const enrichments: string[] = [];
    if (genre) enrichments.push(`operating within the conventions of ${genre.toLowerCase()}`);
    if (worldRules && worldRules.length > 20) enrichments.push('shaped by the pressures and rules of its world');
    body = toneStyle + (enrichments.length ? ` — ${enrichments.join(', ')}.` : '.');
  }

  let bodySecondary = '';
  if (logline) {
    bodySecondary = 'At its core, the project explores the tension between what characters want and what the world allows them to have. The thematic architecture operates beneath the surface of genre, giving the audience something to feel long after the credits.';
  }

  return { body, bodySecondary };
}

function normalizeCharacterSlides(
  rawCharacters: unknown,
  characterImageMap: Map<string, string>,
  characterNameImageMap: Map<string, string>,
): NonNullable<SlideContent['characters']> {
  if (!Array.isArray(rawCharacters)) return [];

  return rawCharacters.slice(0, 6).map((rawCharacter, index) => {
    const character = rawCharacter && typeof rawCharacter === 'object'
      ? rawCharacter as Record<string, unknown>
      : {};

    const id = normalizeCanonText(character.id, `characters.${index}.id`);
    const name = normalizeCanonText(character.name, `characters.${index}.name`) || 'Unnamed';
    const role = normalizeCanonText(character.role, `characters.${index}.role`) || normalizeCanonText(character.archetype, `characters.${index}.archetype`);
    const descriptionParts = [
      normalizeCanonText(character.goals, `characters.${index}.goals`),
      normalizeCanonText(character.traits, `characters.${index}.traits`),
      normalizeCanonText(character.description, `characters.${index}.description`),
    ].filter(Boolean);

    const imageUrl =
      (id && characterImageMap.get(id)) ||
      characterNameImageMap.get(name.toLowerCase()) ||
      undefined;

    return {
      name,
      role,
      description: (descriptionParts.join(' — ') || 'Role to be defined.').slice(0, 200),
      imageUrl,
    };
  });
}

export interface GenerateLookBookOptions {
  companyName: string | null;
  companyLogoUrl: string | null;
  /** Temporary working set overlay — fills gaps without promoting to canon */
  workingSet?: import('@/lib/images/lookbookImageOrchestrator').BuildWorkingSet | null;
}

export async function generateLookBookData(
  projectId: string,
  branding: GenerateLookBookOptions,
): Promise<LookBookData> {
  /** Helper: is this a vertical-drama project? Checks both format and lane. */
  const isVerticalDrama = (fmt: string, lane: string) =>
    checkVD(fmt) || fmt.includes('vertical') || lane === 'vertical_drama';

  // Helper: convert ResolvedImageProvenance[] → SlideImageProvenance[]
  const toSlideProvenance = (result: SectionImageResult): SlideImageProvenance[] =>
    result.provenance.map(p => ({
      imageId: p.imageId,
      source: p.source,
      complianceClass: p.complianceClass,
      actualWidth: p.actualWidth,
      actualHeight: p.actualHeight,
    }));

  // 1. Load project metadata
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('title, genres, format, tone, assigned_lane, comparable_titles, target_audience')
    .eq('id', projectId)
    .maybeSingle();

  if (projectErr) throw new Error('Could not load project data: ' + projectErr.message);
  if (!project) throw new Error('Project not found — check access permissions');
  console.log('[LookBook] ✓ project loaded:', (project as any).title);

  const genre = Array.isArray((project as any).genres)
    ? (project as any).genres.map((value: unknown, index: number) => normalizeCanonText(value, `project.genres.${index}`)).filter(Boolean).join(', ')
    : normalizeCanonText((project as any).genres, 'project.genres');
  const formatLabel = normalizeCanonText((project as any).format, 'project.format');
  const format = formatLabel.toLowerCase();
  const tone = normalizeCanonText((project as any).tone, 'project.tone');
  const targetAudience = normalizeCanonText((project as any).target_audience, 'project.target_audience');
  const assignedLane = normalizeCanonText((project as any).assigned_lane, 'project.assigned_lane');
  const comparableTitles = normalizeCanonText((project as any).comparable_titles, 'project.comparable_titles');

  // 2. Load canonical state
  const canonicalState = await getCanonicalProjectState(projectId);
  const canon = canonicalState.state;
  const normalizedCanon = normalizeLookBookCanon(canon);
  console.log('[LookBook] ✓ canon loaded, source:', canonicalState.source);

  // 3. Load document versions for synopsis/statement
  const { data: docs } = await supabase
    .from('project_documents')
    .select('doc_type, latest_version_id')
    .eq('project_id', projectId)
    .in('doc_type', ['concept_brief', 'topline_narrative', 'treatment', 'blueprint']);

  let synopsis = '';
  let creativeStatement = '';
  if (docs?.length) {
    const versionIds = docs.map((d: any) => d.latest_version_id).filter(Boolean);
    if (versionIds.length) {
      const { data: versions } = await supabase
        .from('project_document_versions')
        .select('plaintext, deliverable_type, is_current')
        .in('id', versionIds)
        .eq('is_current', true);
      for (const v of versions || []) {
        const text = (v as any).plaintext || '';
        if (text.length > synopsis.length && (v as any).deliverable_type !== 'treatment') {
          synopsis = text.slice(0, 800);
        }
        if ((v as any).deliverable_type === 'treatment' || (v as any).deliverable_type === 'blueprint') {
          creativeStatement = text.slice(0, 600);
        }
      }
      if (!synopsis && !creativeStatement) {
        const { data: fallbackVersions } = await supabase
          .from('project_document_versions')
          .select('plaintext, deliverable_type')
          .in('id', versionIds);
        for (const v of fallbackVersions || []) {
          const text = (v as any).plaintext || '';
          if (text.length > synopsis.length && (v as any).deliverable_type !== 'treatment') {
            synopsis = text.slice(0, 800);
          }
          if ((v as any).deliverable_type === 'treatment' || (v as any).deliverable_type === 'blueprint') {
            creativeStatement = text.slice(0, 600);
          }
        }
      }
    }
  }

  // 4. Resolve canonical images per section
  // For vertical-drama: STRICT DECK MODE — winners only, no candidate fallback
  const isVD = isVerticalDrama(format, assignedLane);
  const effectiveLane = isVD ? 'vertical_drama' : (assignedLane || null);
  const canonImages = await resolveAllCanonImages(
    projectId,
    effectiveLane,
    isVD, // strictDeckMode = true for VD
    format,
    assignedLane,
  );
  console.log(`[LookBook] ✓ images resolved (strictDeckMode=${isVD})`);

  const coverImageUrl =
    canonImages.poster_directions.images.find(i => i.role === 'poster_primary')?.signedUrl ||
    canonImages.poster_directions.images[0]?.signedUrl ||
    '';

  const worldImages = canonImages.world_locations.images;
  const worldImageUrl = worldImages[0]?.signedUrl || '';
  const atmosphereImages = canonImages.atmosphere_lighting.images;
  const textureImages = canonImages.texture_detail.images;
  const motifImages = canonImages.symbolic_motifs.images;
  const keyMomentImages = canonImages.key_moments.images;

  // Build character image maps — pick ONE best image per character (primary preferred)
  const charImages = canonImages.character_identity.images;
  const characterImageMap = new Map<string, string>();
  for (const img of charImages) {
    if (img.entity_id && img.signedUrl && !characterImageMap.has(img.entity_id)) {
      characterImageMap.set(img.entity_id, img.signedUrl);
    }
  }
  // Name-based map: prefer primary close_up/medium/full_body for best card representation
  // Enhanced scoring: primary > identity-locked > narrative-bound > preferred shot type
  const characterNameImageMap = new Map<string, string>();
  const charNameScoreMap = new Map<string, number>();
  const PREFERRED_CARD_SHOTS = ['close_up', 'medium', 'full_body', 'emotional_variant', 'profile'];
  for (const img of charImages) {
    if (!img.subject || !img.signedUrl) continue;
    const key = img.subject.toLowerCase();
    let score = 0;
    // Primary status (strongest signal)
    if (img.is_primary) score += 20;
    // Identity-locked generation (trust these more)
    const gc = img.generation_config as Record<string, unknown> | null;
    if (gc?.identity_locked) score += 10;
    // Narrative truth (bound to actual entity)
    if (img.entity_id) score += 5;
    // Preferred shot type for card display
    if (PREFERRED_CARD_SHOTS.includes(img.shot_type || '')) score += 3;
    // Portrait orientation bonus (better for character cards)
    if (classifyOrientation(img.width, img.height) === 'portrait') score += 2;
    // Recency
    score += Math.max(0, 2 - Math.floor((Date.now() - new Date(img.created_at || 0).getTime()) / (1000 * 60 * 60 * 24)));

    const prev = charNameScoreMap.get(key) ?? -1;
    if (score > prev) {
      characterNameImageMap.set(key, img.signedUrl);
      charNameScoreMap.set(key, score);
    }
  }

  // ── Section-scoped image pools — prevent cross-contamination ──
  // Each slide type gets its own curated pool. Global fallback is LAST RESORT only.
  const sectionPools = {
    world: canonImages.world_locations.images,
    atmosphere: canonImages.atmosphere_lighting.images,
    texture: canonImages.texture_detail.images,
    motifs: canonImages.symbolic_motifs.images,
    keyMoments: canonImages.key_moments.images,
    poster: canonImages.poster_directions.images,
  };

  // ── Working Set Overlay: inject provisional images into pools ──
  // These are candidate/generated images chosen by Auto Complete
  // They participate in image selection but do NOT modify canon
  //
  // DETERMINISTIC OVERRIDE: working-set entries also populate a direct
  // per-slide-type URL map so they bypass pool competition for their target slide.
  const workingSet = branding.workingSet;
  const workingSetDirectOverrides = new Map<string, { url: string; source: import('@/lib/images/lookbookImageOrchestrator').WorkingSetSource; imageId: string }>();

  console.log('[LookBook] workingSet received:', {
    hasWorkingSet: !!workingSet,
    entryCount: workingSet?.entries?.length ?? 0,
    slotKeys: workingSet ? Array.from(workingSet.bySlotKey.keys()) : [],
  });

  if (workingSet && workingSet.bySlotKey.size > 0) {
    console.log(`[LookBook] Applying working set overlay (${workingSet.bySlotKey.size} entries)`);
    
    // Map slide types to section pool keys — uses EXPLICIT slideType, never parsed slideId
    const SLIDE_TO_POOL: Record<string, keyof typeof sectionPools> = {
      cover: 'poster', closing: 'poster',
      world: 'world',
      themes: 'atmosphere', creative_statement: 'atmosphere',
      visual_language: 'texture',
      key_moments: 'keyMoments', story_engine: 'keyMoments',
    };

    for (const [, entry] of workingSet.bySlotKey) {
      // Create a synthetic image with the signed URL
      const syntheticImg: ProjectImage = {
        ...entry.image,
        signedUrl: entry.signedUrl,
        // Mark as working-set source for diagnostics
        _workingSetSource: entry.source as any,
      } as any;

      // Use EXPLICIT slideType — never parse slideId
      const slideType = entry.slideType || entry.slideId.split(':')[0]; // slideType is primary, split is legacy fallback only
      const poolKey = SLIDE_TO_POOL[slideType] || 'atmosphere';
      if (sectionPools[poolKey]) {
        sectionPools[poolKey].push(syntheticImg);
      }

      // DETERMINISTIC OVERRIDE: register this URL for direct slide injection
      // This ensures the working-set image is used even if it would lose pool competition
      const overrideKey = `${slideType}:${entry.slotId}`;
      const existingOverride = workingSetDirectOverrides.get(overrideKey);
      if (!existingOverride || entry.score > 0) {
        workingSetDirectOverrides.set(overrideKey, {
          url: entry.signedUrl,
          source: entry.source,
          imageId: entry.image.id,
        });
      }

      // Also inject character images into the character maps
      if (entry.image.subject && entry.image.entity_id) {
        const charKey = entry.image.subject.toLowerCase();
        if (!characterNameImageMap.has(charKey)) {
          characterNameImageMap.set(charKey, entry.signedUrl);
        }
        if (!characterImageMap.has(entry.image.entity_id)) {
          characterImageMap.set(entry.image.entity_id, entry.signedUrl);
        }
      }
    }

    console.log(`[LookBook] Working set: ${workingSetDirectOverrides.size} deterministic overrides registered`);
  }

  // Broad fallback pool — used ONLY when section pool is empty
  const allSectionImages = [
    ...sectionPools.world,
    ...sectionPools.atmosphere,
    ...sectionPools.keyMoments,
    ...sectionPools.texture,
    ...sectionPools.motifs,
  ];

  /** Section affinity — which section pools are appropriate for each slide type */
  const SLIDE_SECTION_AFFINITY: Record<string, Array<keyof typeof sectionPools>> = {
    cover: ['poster', 'world', 'keyMoments'],
    creative_statement: ['atmosphere', 'world'],
    world: ['world'],
    key_moments: ['keyMoments'],
    characters: [],
    visual_language: ['texture', 'motifs', 'atmosphere'],
    themes: ['atmosphere', 'world'],
    story_engine: ['keyMoments', 'motifs'],
    comparables: ['atmosphere', 'world'],
    closing: ['poster', 'world', 'atmosphere'],
  };

  // ── Deck-Level Image Budget ──
  // Tracks every image URL used across the entire deck to penalize/block reuse
  const deckImageUsage = new Map<string, { count: number; usedOnSlides: string[] }>();

  function trackImageUsage(url: string, slideType: string) {
    const entry = deckImageUsage.get(url);
    if (entry) {
      entry.count++;
      entry.usedOnSlides.push(slideType);
    } else {
      deckImageUsage.set(url, { count: 1, usedOnSlides: [slideType] });
    }
  }

  function getReusePenalty(url: string): number {
    const usage = deckImageUsage.get(url);
    if (!usage || usage.count === 0) return 0;
    // First reuse: -30, second: -60, etc. — heavy enough to prefer ANY unique image
    return usage.count * -30;
  }

  /** Score an image for section relevance + visual suitability */
  function scoreImageForSlide(img: ProjectImage, slideType: string, applyReusePenalty = true): number {
    let score = 0;
    const hasNarrative = !!(img.entity_id || img.location_ref || img.moment_ref || img.subject_ref);
    const isLandscape = classifyOrientation(img.width, img.height) === 'landscape';

    // Narrative truth bonus (highest priority)
    if (hasNarrative) score += 20;

    // Primary bonus
    if (img.is_primary) score += 10;

    // Landscape bonus for background slots
    if (isLandscape) score += 8;

    // Section-specific scoring
    const shotType = img.shot_type || '';
    switch (slideType) {
      case 'world':
        if (['wide', 'atmospheric', 'establishing'].includes(shotType)) score += 15;
        if (img.asset_group === 'world') score += 12;
        if (img.location_ref) score += 10;
        // Penalize texture/craft detail on world slides
        if (['texture_ref', 'detail', 'composition_ref', 'color_ref'].includes(shotType)) score -= 15;
        if (img.asset_group === 'visual_language' && !img.location_ref) score -= 10;
        break;
      case 'themes':
        if (['atmospheric', 'time_variant', 'lighting_ref'].includes(shotType)) score += 15;
        if (img.asset_group === 'visual_language') score += 8;
        // Penalize literal craft/object detail
        if (['texture_ref', 'detail'].includes(shotType) && !img.location_ref) score -= 8;
        break;
      case 'visual_language':
        if (['texture_ref', 'detail', 'composition_ref', 'color_ref', 'lighting_ref'].includes(shotType)) score += 15;
        break;
      case 'key_moments':
        if (['tableau', 'medium', 'close_up', 'wide'].includes(shotType)) score += 15;
        if (img.asset_group === 'key_moment') score += 12;
        if (img.moment_ref) score += 10;
        // Penalize texture/craft on key moments
        if (['texture_ref', 'detail', 'composition_ref', 'color_ref'].includes(shotType)) score -= 15;
        break;
      case 'story_engine':
        if (img.moment_ref) score += 12;
        if (img.asset_group === 'key_moment') score += 8;
        if (['texture_ref', 'detail'].includes(shotType)) score -= 10;
        break;
      case 'cover':
        if (img.role === 'poster_primary') score += 20;
        if (img.role === 'poster_variant') score += 10;
        // Penalize texture/craft on cover
        if (['texture_ref', 'detail', 'composition_ref'].includes(shotType)) score -= 20;
        break;
      case 'closing':
        if (img.role === 'poster_primary') score += 20;
        if (img.role === 'poster_variant') score += 10;
        if (['texture_ref', 'detail'].includes(shotType)) score -= 15;
        break;
      case 'creative_statement':
        if (['atmospheric', 'wide'].includes(shotType)) score += 10;
        if (['texture_ref', 'detail'].includes(shotType)) score -= 12;
        break;
    }

    // Recency tiebreaker (small bonus for newer images)
    const age = Date.now() - new Date(img.created_at || 0).getTime();
    score += Math.max(0, 3 - Math.floor(age / (1000 * 60 * 60 * 24))); // +3 for today, +2 for yesterday, etc.

    // Deck-level reuse penalty — strongly prefer unique images
    if (applyReusePenalty && img.signedUrl) {
      score += getReusePenalty(img.signedUrl);
    }

    return score;
  }

  /** Pick the best N foreground images from a pool, with deck-level dedup.
   *  Returns unique URLs only, scored and sorted. */
  function pickForegroundImages(
    pool: ProjectImage[],
    slideType: string,
    maxCount: number,
    excludeUrls: string[] = [],
  ): string[] {
    const seen = new Set(excludeUrls);
    const scored = pool
      .filter(img => img.signedUrl && !seen.has(img.signedUrl!))
      .map(img => ({ img, score: scoreImageForSlide(img, slideType) }))
      .sort((a, b) => b.score - a.score);

    const result: string[] = [];
    for (const { img } of scored) {
      if (result.length >= maxCount) break;
      if (seen.has(img.signedUrl!)) continue;
      seen.add(img.signedUrl!);
      result.push(img.signedUrl!);
    }
    return result;
  }

  /** Pick the best background image from section-appropriate pools.
   *  Uses section affinity to prevent cross-contamination.
   *  Falls back to global pool ONLY when all affinity pools are empty.
   */
  function pickBackgroundImage(
    primaryPool: ProjectImage[],
    fallbackPool: ProjectImage[] = [],
    excludeUrls: string[] = [],
    slideType: string = '',
  ): string | undefined {
    const isExcluded = (img: ProjectImage) => !img.signedUrl || excludeUrls.includes(img.signedUrl!);

    // Build affinity-ordered pool from section pools
    const affinityKeys = SLIDE_SECTION_AFFINITY[slideType] || [];
    const affinityPool: ProjectImage[] = [];
    for (const key of affinityKeys) {
      for (const img of sectionPools[key]) {
        if (!isExcluded(img) && !affinityPool.includes(img)) {
          affinityPool.push(img);
        }
      }
    }

    // Merge primary + affinity, removing duplicates
    const combinedPrimary = [...primaryPool.filter(i => !isExcluded(i))];
    for (const img of affinityPool) {
      if (!combinedPrimary.includes(img)) combinedPrimary.push(img);
    }

    // Score and sort all candidates (with reuse penalty)
    const scored = combinedPrimary.map(img => ({
      img,
      score: scoreImageForSlide(img, slideType),
    }));
    scored.sort((a, b) => b.score - a.score);

    // Pick best landscape first, then any
    const bestLandscape = scored.find(s => classifyOrientation(s.img.width, s.img.height) === 'landscape');
    if (bestLandscape) return bestLandscape.img.signedUrl!;
    if (scored.length > 0) return scored[0].img.signedUrl!;

    // Global fallback — LAST RESORT only
    const globalFallback = (fallbackPool.length > 0 ? fallbackPool : allSectionImages)
      .filter(i => !isExcluded(i))
      .map(img => ({ img, score: scoreImageForSlide(img, slideType) }));
    globalFallback.sort((a, b) => b.score - a.score);
    const globalLandscape = globalFallback.find(s => classifyOrientation(s.img.width, s.img.height) === 'landscape');
    if (globalLandscape) return globalLandscape.img.signedUrl!;
    if (globalFallback.length > 0) return globalFallback[0].img.signedUrl!;

    return undefined;
  }

  /** Determine cinematic composition mode */
  function resolveComposition(
    slideType: string,
    hasBackground: boolean,
    hasForegroundImages: boolean,
    imageCount: number,
  ): SlideComposition {
    if (slideType === 'characters') return 'character_feature';
    if (slideType === 'key_moments' && imageCount >= 2) return 'montage_grid';
    if (slideType === 'cover' || slideType === 'closing') return 'full_bleed_hero';
    if (slideType === 'creative_statement') return hasBackground ? 'text_over_atmosphere' : 'gradient_only';
    if (slideType === 'comparables') return hasBackground ? 'text_over_atmosphere' : 'editorial_panel';
    if (!hasBackground && !hasForegroundImages) return 'gradient_only';
    if (hasBackground && hasForegroundImages) return 'split_cinematic';
    if (hasBackground) return 'text_over_atmosphere';
    return 'editorial_panel';
  }

  // 5. Build identity
  const identity = resolveIdentity(normalizedCanon.tone_style || tone, genre);
  const logline = normalizedCanon.logline;
  const title = normalizeCanonText((project as any).title, 'project.title') || 'Untitled Project';
  const writerCredit = 'Written by Sebastian Street';
  const companyName = branding.companyName || 'Paradox House';

  // Track used background URLs to avoid repeating the same image across slides
  const usedBackgroundUrls: string[] = [];

  // 6. Build slides in premium vertical-drama sequence
  const slides: SlideContent[] = [];

  // ── 1. COVER ──
  const coverBg = coverImageUrl || pickBackgroundImage(worldImages, [], usedBackgroundUrls, 'cover') || undefined;
  slides.push({
    type: 'cover',
    slide_id: makeSemanticSlideId('cover'),
    title,
    subtitle: logline || undefined,
    credit: writerCredit,
    companyName,
    companyLogoUrl: branding.companyLogoUrl || null,
    imageUrl: coverImageUrl || undefined,
    backgroundImageUrl: coverBg,
    composition: 'full_bleed_hero',
    _debug_image_ids: canonImages.poster_directions.imageIds.slice(0, 1),
    _debug_provenance: toSlideProvenance(canonImages.poster_directions).slice(0, 1),
    _has_unresolved: canonImages.poster_directions.unresolvedCount > 0,
  });
  if (coverBg) { usedBackgroundUrls.push(coverBg); trackImageUsage(coverBg, 'cover'); }
  if (coverImageUrl && coverImageUrl !== coverBg) trackImageUsage(coverImageUrl, 'cover');

  // ── 2. CREATIVE VISION (merged with Overview content) ──
  {
    const cvPrimary = creativeStatement?.slice(0, 500)
      || normalizedCanon.premise
      || logline
      || synopsis.slice(0, 300)
      || '';
    const cvBullets = [
      genre ? `Genre: ${genre}` : '',
      formatLabel ? `Format: ${formatLabel}` : '',
      normalizedCanon.tone_style ? `Tone: ${normalizedCanon.tone_style}` : '',
      targetAudience ? `Audience: ${targetAudience}` : '',
    ].filter(Boolean);
    const cvSecondary = creativeStatement && normalizedCanon.premise && normalizedCanon.premise !== creativeStatement
      ? normalizedCanon.premise.slice(0, 300)
      : undefined;
    const cvBg = pickBackgroundImage(atmosphereImages, [], usedBackgroundUrls, 'creative_statement');
    if (cvBg) { usedBackgroundUrls.push(cvBg); trackImageUsage(cvBg, 'creative_statement'); }
    slides.push({
      type: 'creative_statement',
      slide_id: makeSemanticSlideId('creative_statement'),
      title: 'Creative Vision',
      body: cvPrimary,
      bodySecondary: cvSecondary,
      bullets: cvBullets.length > 0 ? cvBullets : undefined,
      credit: writerCredit,
      backgroundImageUrl: cvBg,
      composition: cvBg ? 'text_over_atmosphere' : 'gradient_only',
    });
  }

  // ── 3. WORLD ──
  if (normalizedCanon.world_rules || normalizedCanon.locations || normalizedCanon.timeline || worldImages.length > 0) {
    const worldBg = pickBackgroundImage(worldImages, [], usedBackgroundUrls, 'world');
    if (worldBg) { usedBackgroundUrls.push(worldBg); trackImageUsage(worldBg, 'world'); }
    const worldForeground = pickForegroundImages(worldImages, 'world', 4, worldBg ? [worldBg] : []);
    worldForeground.forEach(u => trackImageUsage(u, 'world'));
    slides.push({
      type: 'world',
      slide_id: makeSemanticSlideId('world'),
      title: 'The World',
      body: normalizedCanon.world_rules || undefined,
      bodySecondary: normalizedCanon.locations || undefined,
      quote: normalizedCanon.timeline || undefined,
      imageUrl: worldForeground[0] || undefined,
      imageUrls: worldForeground,
      backgroundImageUrl: worldBg,
      composition: resolveComposition('world', !!worldBg, worldForeground.length > 1, worldForeground.length),
      _debug_image_ids: canonImages.world_locations.imageIds,
      _debug_provenance: toSlideProvenance(canonImages.world_locations),
      _has_unresolved: canonImages.world_locations.unresolvedCount > 0,
    });
  }

  // ── 4. KEY MOMENTS ──
  {
    const keyMomentBody = keyMomentImages.length > 0
      ? 'The defining visual beats — the frames that sell the story, anchor the trailer, and live in the audience\'s memory.'
      : 'Key visual moments will be populated as the project\'s visual canon develops. These are the frames that define the trailer, the poster, and the audience\'s first impression.';
    const kmForeground = pickForegroundImages(keyMomentImages, 'key_moments', 6);
    kmForeground.forEach(u => trackImageUsage(u, 'key_moments'));
    slides.push({
      type: 'key_moments',
      slide_id: makeSemanticSlideId('key_moments'),
      title: 'Key Moments',
      body: keyMomentBody,
      imageUrl: keyMomentImages[0]?.signedUrl || undefined,
      imageUrls: kmForeground,
      composition: resolveComposition('key_moments', false, kmForeground.length > 0, kmForeground.length),
      _debug_image_ids: canonImages.key_moments.imageIds,
      _debug_provenance: toSlideProvenance(canonImages.key_moments),
      _has_unresolved: canonImages.key_moments.unresolvedCount > 0,
    });
  }

  // ── 5. CHARACTERS ──
  const normalizedCharacters = normalizeCharacterSlides(canon.characters, characterImageMap, characterNameImageMap);
  if (normalizedCharacters.length > 0) {
    slides.push({
      type: 'characters',
      slide_id: makeSemanticSlideId('characters'),
      title: 'Characters',
      characters: normalizedCharacters,
      composition: 'character_feature',
      _debug_image_ids: canonImages.character_identity.imageIds,
      _debug_provenance: toSlideProvenance(canonImages.character_identity),
      _has_unresolved: canonImages.character_identity.unresolvedCount > 0,
    });
  }

  // ── 6. VISUAL LANGUAGE ──
  const vlImages = [...textureImages, ...motifImages];
  const vlCopy = buildVisualLanguageCopy(normalizedCanon, genre, tone, identity.imageStyle);
  const vlBg = pickBackgroundImage(vlImages, atmosphereImages, usedBackgroundUrls, 'visual_language');
  if (vlBg) { usedBackgroundUrls.push(vlBg); trackImageUsage(vlBg, 'visual_language'); }
  const vlForeground = pickForegroundImages(vlImages, 'visual_language', 4, vlBg ? [vlBg] : []);
  vlForeground.forEach(u => trackImageUsage(u, 'visual_language'));
  slides.push({
    type: 'visual_language',
    slide_id: makeSemanticSlideId('visual_language'),
    title: 'Visual Language',
    body: vlCopy.body,
    imageUrl: vlImages[0]?.signedUrl || undefined,
    imageUrls: vlForeground,
    backgroundImageUrl: vlBg,
    composition: resolveComposition('visual_language', !!vlBg, vlForeground.length > 1, vlForeground.length),
    bullets: vlCopy.bullets,
    _debug_image_ids: [...canonImages.texture_detail.imageIds, ...canonImages.symbolic_motifs.imageIds].slice(0, 4),
    _debug_provenance: [...toSlideProvenance(canonImages.texture_detail), ...toSlideProvenance(canonImages.symbolic_motifs)].slice(0, 4),
    _has_unresolved: (canonImages.texture_detail.unresolvedCount + canonImages.symbolic_motifs.unresolvedCount) > 0,
  });

  // ── 7. THEMES & TONE ──
  const themesRaw = normalizedCanon.tone_style || tone || '';
  if (themesRaw) {
    const themesCopy = buildThemesCopy(normalizedCanon, genre, tone);
    const themesUnresolved = canonImages.atmosphere_lighting.unresolvedCount;
    const themesBg = pickBackgroundImage(atmosphereImages, worldImages, usedBackgroundUrls, 'themes');
    if (themesBg) { usedBackgroundUrls.push(themesBg); trackImageUsage(themesBg, 'themes'); }
    const themesForeground = pickForegroundImages(atmosphereImages, 'themes', 4, themesBg ? [themesBg] : []);
    themesForeground.forEach(u => trackImageUsage(u, 'themes'));
    slides.push({
      type: 'themes',
      slide_id: makeSemanticSlideId('themes'),
      title: 'Themes & Tone',
      body: themesCopy.body || undefined,
      bodySecondary: themesCopy.bodySecondary || undefined,
      imageUrl: themesForeground[0] || undefined,
      imageUrls: themesForeground,
      backgroundImageUrl: themesBg,
      composition: resolveComposition('themes', !!themesBg, themesForeground.length > 1, themesForeground.length),
      _debug_image_ids: canonImages.atmosphere_lighting.imageIds.slice(0, 4),
      _debug_provenance: toSlideProvenance(canonImages.atmosphere_lighting).slice(0, 4),
      _has_unresolved: themesUnresolved > 0,
    });
  }

  // ── OPTIONAL: STORY ENGINE ──
  if (format.includes('series') || format.includes('vertical') || format.includes('limited') || format.includes('feature') || format.includes('film') || logline) {
    const seCopy = buildStoryEngineCopy(normalizedCanon, format, genre);
    const seImages = keyMomentImages.length > 2 ? keyMomentImages.slice(2, 6) : motifImages;
    const seBg = pickBackgroundImage(seImages, keyMomentImages, usedBackgroundUrls, 'story_engine');
    if (seBg) { usedBackgroundUrls.push(seBg); trackImageUsage(seBg, 'story_engine'); }
    const seForeground = pickForegroundImages(seImages, 'story_engine', 3, seBg ? [seBg] : []);
    seForeground.forEach(u => trackImageUsage(u, 'story_engine'));
    slides.push({
      type: 'story_engine',
      slide_id: makeSemanticSlideId('story_engine'),
      title: 'Story Engine',
      body: seCopy.body,
      bodySecondary: seCopy.bodySecondary || undefined,
      bullets: seCopy.bullets,
      imageUrl: seForeground[0] || undefined,
      imageUrls: seForeground,
      backgroundImageUrl: seBg,
      composition: resolveComposition('story_engine', !!seBg, seForeground.length > 1, seForeground.length),
      _debug_image_ids: seImages.map(i => i.id).slice(0, 3),
      _debug_provenance: seImages.map(img => ({
        imageId: img.id,
        source: (img as any).is_primary && (img as any).curation_state === 'active' ? 'winner_primary' as const : 'active_non_primary' as const,
        complianceClass: 'n/a',
        actualWidth: img.width || null,
        actualHeight: img.height || null,
      })).slice(0, 3),
      _has_unresolved: seImages.length === 0 && canonImages.symbolic_motifs.unresolvedCount > 0,
    });
  }

  // ── OPTIONAL: COMPARABLES ──
  const comps = parseComparables(normalizedCanon.comparables || comparableTitles);
  if (comps.length > 0) {
    const compBg = pickBackgroundImage([], [], usedBackgroundUrls, 'comparables');
    if (compBg) { usedBackgroundUrls.push(compBg); trackImageUsage(compBg, 'comparables'); }
    slides.push({
      type: 'comparables',
      slide_id: makeSemanticSlideId('comparables'),
      title: 'Comparables',
      comparables: comps,
      backgroundImageUrl: compBg,
      composition: compBg ? 'text_over_atmosphere' : 'gradient_only',
    });
  }

  // ── OPTIONAL: POSTER DIRECTIONS ──
  const posterImages = canonImages.poster_directions.images;
  if (posterImages.length > 1) {
    const posterForeground = pickForegroundImages(posterImages, 'cover', 4);
    posterForeground.forEach(u => trackImageUsage(u, 'poster_directions'));
    slides.push({
      type: 'key_moments' as any,
      slide_id: makeSemanticSlideId('key_moments', 'poster_directions'),
      title: 'Poster Directions',
      body: 'Key art explorations — the visual identity that anchors the marketing campaign and defines the audience\'s first impression.',
      imageUrl: posterImages[0]?.signedUrl || undefined,
      imageUrls: posterForeground,
      composition: 'montage_grid',
      _debug_image_ids: canonImages.poster_directions.imageIds.slice(0, 4),
      _debug_provenance: toSlideProvenance(canonImages.poster_directions).slice(0, 4),
      _has_unresolved: false,
    });
  }

  // ── 8. CLOSING ──
  const closingBg = coverImageUrl || pickBackgroundImage(worldImages, [], usedBackgroundUrls, 'closing');
  slides.push({
    type: 'closing',
    slide_id: makeSemanticSlideId('closing'),
    title,
    subtitle: logline || undefined,
    credit: writerCredit,
    companyName,
    companyLogoUrl: branding.companyLogoUrl || null,
    imageUrl: coverImageUrl || undefined,
    backgroundImageUrl: closingBg,
    composition: 'full_bleed_hero',
  });

  // ── Enrich slides with layout family metadata (landscape decks only) ──
  const deckFormat = isVD ? 'portrait' as const : 'landscape' as const;

  if (deckFormat === 'landscape') {
    for (const slide of slides) {
      const slideImages: Array<{ width?: number | null; height?: number | null; signedUrl?: string }> = [];

      // Collect image dimensions from provenance
      if (slide._debug_provenance?.length) {
        for (const p of slide._debug_provenance) {
          const url = slide.imageUrls?.find((_, i) => slide._debug_image_ids?.[i] === p.imageId)
            || (slide._debug_image_ids?.[0] === p.imageId ? slide.imageUrl : undefined);
          slideImages.push({ width: p.actualWidth, height: p.actualHeight, signedUrl: url || undefined });
        }
      }

      // Resolve layout family
      const resolved = resolveLookbookLayoutFamily({
        slideType: slide.type,
        images: slideImages,
        lane: assignedLane || null,
        format,
        isCharacterSection: slide.type === 'characters',
      });

      slide.layoutFamily = resolved.familyKey;
      slide.layoutFamilyReason = resolved.reason;
      slide.layoutFamilyEffective = resolved.familyKey;
      slide.imageOrientationSummary = summarizeOrientations(slideImages);

      // Run slot matcher for image-bearing slides
      if (slideImages.length > 0) {
        const candidates: ImageCandidate[] = slideImages.map((img, i) => ({
          url: slide.imageUrls?.[i] || slide.imageUrl || '',
          width: img.width,
          height: img.height,
          rankIndex: i,
        })).filter(c => c.url);

        const matchResult = matchImagesToSlots(resolved, candidates);
        slide.slotAssignments = matchResult.assignments;
      }
    }

    console.log('[LookBook] ✓ layout families resolved:',
      slides.filter(s => s.layoutFamily).map(s => `${s.type}→${s.layoutFamily}`).join(', '));
  }

  // ── Working Set Deterministic Overrides — apply after all pool-based selection ──
  // Overrides can FILL empty slots AND REPLACE weaker pool-selected images.
  // A working-set entry wins over an existing selection when it has a positive score,
  // meaning the orchestrator already evaluated it as a strong match for this slot.
  if (workingSetDirectOverrides.size > 0) {
    const overrideDiag: string[] = [];

    for (const slide of slides) {
      const ws = (key: string) => workingSetDirectOverrides.get(key);
      const ensureWS = () => { slide._workingSetSources = slide._workingSetSources || {}; };

      // ── Background slot ──
      const bgKey = `${slide.type}:background`;
      const bgOverride = ws(bgKey);
      if (bgOverride) {
        const currentBg = slide.backgroundImageUrl;
        // Apply if empty OR if the override is a different (presumably better) image
        if (!currentBg || (currentBg !== bgOverride.url)) {
          const action = currentBg ? 'replaced' : 'filled';
          slide.backgroundImageUrl = bgOverride.url;
          ensureWS();
          (slide._workingSetSources as any).background = bgOverride.source;
          slide.composition = resolveComposition(
            slide.type, true,
            (slide.imageUrls?.length || 0) > 0,
            (slide.imageUrls?.length || 0),
          );
          overrideDiag.push(`${slide.type}:bg ${action} (${bgOverride.source})`);
        }
      }

      // ── Hero / primary slot ──
      const heroKey = `${slide.type}:hero`;
      const heroOverride = ws(heroKey);
      if (heroOverride) {
        const currentHero = slide.imageUrl;
        if (!currentHero || (currentHero !== heroOverride.url)) {
          const action = currentHero ? 'replaced' : 'filled';
          slide.imageUrl = heroOverride.url;
          ensureWS();
          (slide._workingSetSources as any).hero = heroOverride.source;
          overrideDiag.push(`${slide.type}:hero ${action} (${heroOverride.source})`);
        }
      }

      // ── Foreground / gallery slots ──
      for (const [key, override] of workingSetDirectOverrides) {
        if (key.startsWith(`${slide.type}:`) && !key.endsWith(':background') && !key.endsWith(':hero')) {
          if (!slide.imageUrls?.includes(override.url)) {
            slide.imageUrls = slide.imageUrls || [];
            slide.imageUrls.push(override.url);
            ensureWS();
            const slotName = key.split(':')[1] || 'slot';
            (slide._workingSetSources as any)[slotName] = override.source;
            overrideDiag.push(`${slide.type}:${slotName} added (${override.source})`);
          }
        }
      }
    }

    if (overrideDiag.length > 0) {
      console.log(`[LookBook] ✓ working-set overrides: ${overrideDiag.join(' | ')}`);
    } else {
      console.log('[LookBook] ✓ working-set: no overrides needed (pool selections matched)');
    }
  }

  // ── Selection diagnostics — log WHY each slide got its images ──
  const selectionDiagnostics: string[] = [];
  for (const slide of slides) {
    const parts = [`${slide.type}:`];
    if (slide.backgroundImageUrl) parts.push(`bg=✓`);
    else parts.push(`bg=✗`);
    if (slide.imageUrls?.length) parts.push(`fg=${slide.imageUrls.length}`);
    if (slide._debug_image_ids?.length) parts.push(`ids=${slide._debug_image_ids.length}`);
    if (slide._has_unresolved) parts.push('UNRESOLVED');
    // Working-set provenance
    if (slide._workingSetSources && Object.keys(slide._workingSetSources as any).length > 0) {
      const wsSources = Object.entries(slide._workingSetSources as any)
        .map(([slot, src]) => `${slot}=${src}`)
        .join(',');
      parts.push(`WS[${wsSources}]`);
    }
    selectionDiagnostics.push(parts.join(' '));
  }
  console.log('[LookBook] ✓ slide image selection:', selectionDiagnostics.join(' | '));

  // Debug provenance — strict deck mode audit
  const unresolvedSlides = slides.filter(s => s._has_unresolved);
  const provenanceSummary = slides
    .filter(s => s._debug_image_ids?.length)
    .map(s => `${s.type}: ${s._debug_image_ids!.length} images`)
    .join(', ');
  console.log('[LookBook] ✓ generation complete — slides:', slides.length, '| images:', provenanceSummary);
  if (isVD && unresolvedSlides.length > 0) {
    console.warn(`[LookBook] ⚠ STRICT VD: ${unresolvedSlides.length} slides have unresolved image slots:`,
      unresolvedSlides.map(s => s.type).join(', '));
  }

  console.log(`[LookBook] ✓ deck format: ${deckFormat} (strictMode=${isVD}, lane=${assignedLane || 'none'}, format=${format})`);

  const totalImageRefs = slides.reduce((acc, s) => acc + (s._debug_image_ids?.length || 0), 0);

  // Collect all resolved image IDs sorted for deterministic change detection  
  const resolvedImageIds = (canonImages._diagnostics?.resolvedImageIds || []).slice().sort();

  // Unique build fingerprint — crypto.randomUUID or fallback
  const buildId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    projectId,
    projectTitle: title,
    identity,
    slides,
    deckFormat,
    generatedAt: new Date().toISOString(),
    writerCredit,
    companyName,
    companyLogoUrl: branding.companyLogoUrl || null,
    buildId,
    totalImageRefs,
    resolvedImageIds,
  };
}
