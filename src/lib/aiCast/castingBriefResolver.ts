/**
 * castingBriefResolver — Phase 17.2: Character → Casting Brief Separation.
 *
 * Strictly separates character canon (story truth) from casting brief (visual performer requirements).
 * Actor creation, recommendations, and matching must consume the casting brief only.
 *
 * DETERMINISTIC. READ-ONLY. No LLM enrichment.
 *
 * Sources (priority order):
 * 1. canon_facts
 * 2. canon_json.characters (via project_canon)
 * 3. character_visual_dna
 * 4. project_images character descriptors
 * 5. minimal fallback
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CharacterContextSummary {
  character_key: string;
  display_name: string;
  story_summary: string;
  role_in_story?: string | null;
  canon_notes: string[];
}

export interface CastingBrief {
  age_hint?: string | null;
  gender_presentation?: string | null;
  ethnicity_or_cultural_appearance?: string | null;
  appearance_markers: string[];
  visual_archetype?: string | null;
  styling_cues: string[];
  performance_vibe: string[];
  negative_exclusions: string[];
  suggested_actor_name: string;
  actor_description: string;
  actor_tags: string[];
}

export interface CharacterCastingBriefResult {
  context: CharacterContextSummary;
  brief: CastingBrief;
}

// ── Plot-language blocklist ──────────────────────────────────────────────────
// These words/phrases indicate story-conflict language and must NOT appear
// in actor description fields.
const PLOT_LANGUAGE_PATTERNS = [
  /\bbetray/i, /\brevenge\b/i, /\bguilt\b/i, /\bsecre(?:t|cy)\b/i,
  /\bduty\b/i, /\bforbidden\b/i, /\bwound(?:ed|s)?\b/i, /\btrauma\b/i,
  /\bconflict\b/i, /\bmotivat/i, /\bdesire\b/i, /\blove\b/i,
  /\bhate\b/i, /\bfear\b/i, /\bjealous/i, /\banger\b/i,
  /\btorn between\b/i, /\bhides?\b/i, /\bchoose\b/i, /\bchosen\b/i,
  /\bstruggl/i, /\bloss\b/i, /\babandone?d?\b/i, /\bredemption\b/i,
  /\bpolitical\b/i, /\bpower\b/i, /\bfate\b/i, /\bdestiny\b/i,
  /\bprotest/i, /\brebel/i, /\boppressed/i, /\bmanipulat/i,
  /\bpurpose\b/i, /\barc\b/i, /\bgoals?\b/i,
];

/**
 * Remove plot-language sentences from a text intended for actor description.
 * Returns only sentences that are safe for visual identity use.
 */
function sanitizePlotLanguage(text: string): string {
  if (!text) return '';
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const safe = sentences.filter(sentence =>
    !PLOT_LANGUAGE_PATTERNS.some(pat => pat.test(sentence))
  );
  return safe.join('. ').trim();
}

// ── Visual-only predicate classification ─────────────────────────────────────

const VISUAL_PREDICATES = new Set([
  'age', 'gender', 'appearance', 'ethnicity', 'hair', 'eyes', 'skin',
  'height', 'build', 'physique', 'clothing', 'wardrobe', 'costume',
  'posture', 'beauty', 'face', 'body', 'silhouette', 'style',
]);

const STORY_PREDICATES = new Set([
  'role', 'goal', 'goals', 'motivation', 'relationship', 'backstory',
  'conflict', 'arc', 'secret', 'desire', 'personality', 'trait',
  'character_trait', 'description', 'is_character',
]);

function isVisualPredicate(predicate: string): boolean {
  return VISUAL_PREDICATES.has(predicate.toLowerCase());
}

function isStoryPredicate(predicate: string): boolean {
  return STORY_PREDICATES.has(predicate.toLowerCase());
}

// ── Core Function ────────────────────────────────────────────────────────────

export async function buildCharacterCastingBrief(
  projectId: string,
  characterKey: string,
): Promise<CharacterCastingBriefResult> {
  const normalizedKey = normalizeCharacterKey(characterKey);

  // Collect raw data
  const storyNotes: string[] = [];
  const visualMarkers: string[] = [];
  const vibeMarkers: string[] = [];
  const stylingCues: string[] = [];
  const tags: string[] = [];
  let ageHint: string | null = null;
  let genderPresentation: string | null = null;
  let ethnicityHint: string | null = null;
  let roleInStory: string | null = null;
  let displayName = characterKey;
  let visualArchetype: string | null = null;

  // ── 1. canon_facts ──────────────────────────────────────────────────────

  const { data: charTypeFacts } = await supabase
    .from('canon_facts')
    .select('subject')
    .eq('project_id', projectId)
    .eq('fact_type', 'character')
    .eq('is_active', true);

  const matchedSubject = (charTypeFacts || []).find(
    (f: any) => normalizeCharacterKey(f.subject) === normalizedKey,
  );

  if (matchedSubject) {
    displayName = matchedSubject.subject;

    const { data: allFacts } = await supabase
      .from('canon_facts')
      .select('predicate, object, value')
      .eq('project_id', projectId)
      .eq('subject', displayName)
      .eq('is_active', true);

    for (const fact of allFacts || []) {
      const pred = fact.predicate?.toLowerCase() || '';
      const obj = fact.object || '';

      if (pred === 'age') {
        ageHint = obj;
        tags.push(obj.toLowerCase());
      } else if (pred === 'gender') {
        genderPresentation = obj;
        tags.push(obj.toLowerCase());
      } else if (pred === 'ethnicity' || pred === 'nationality' || pred === 'cultural_appearance') {
        ethnicityHint = obj;
      } else if (pred === 'role') {
        roleInStory = obj;
        storyNotes.push(`Role: ${obj}`);
      } else if (isVisualPredicate(pred)) {
        visualMarkers.push(obj);
        tags.push(obj.toLowerCase());
      } else if (pred === 'character_trait') {
        // Character traits can be visual (e.g. "graceful") or story (e.g. "ambitious")
        const sanitized = sanitizePlotLanguage(obj);
        if (sanitized) {
          vibeMarkers.push(sanitized);
          tags.push(sanitized.toLowerCase());
        } else {
          storyNotes.push(obj);
        }
      } else if (isStoryPredicate(pred)) {
        storyNotes.push(obj);
      } else if (obj) {
        // Unknown predicate — attempt classification
        const sanitized = sanitizePlotLanguage(obj);
        if (sanitized) {
          vibeMarkers.push(sanitized);
        } else {
          storyNotes.push(obj);
        }
      }
    }
  }

  // ── 2. canon_json.characters ────────────────────────────────────────────

  const { data: canonRow } = await (supabase as any)
    .from('project_canon')
    .select('canon_json')
    .eq('project_id', projectId)
    .maybeSingle();

  if (canonRow?.canon_json?.characters) {
    const canonChars = canonRow.canon_json.characters as Array<{
      name?: string;
      role?: string;
      traits?: string;
      goals?: string;
      secrets?: string;
      relationships?: string;
    }>;

    const matched = canonChars.find(
      c => c.name && normalizeCharacterKey(c.name) === normalizedKey,
    );

    if (matched) {
      if (!displayName || displayName === characterKey) {
        displayName = matched.name || displayName;
      }
      if (matched.role && !roleInStory) {
        roleInStory = matched.role;
        storyNotes.push(`Role: ${matched.role}`);
      }
      if (matched.traits) storyNotes.push(`Traits: ${matched.traits}`);
      if (matched.goals) storyNotes.push(`Goals: ${matched.goals}`);
      if (matched.secrets) storyNotes.push(`Secrets: ${matched.secrets}`);
      if (matched.relationships) storyNotes.push(`Relationships: ${matched.relationships}`);
    }
  }

  // ── 3. character_visual_dna ─────────────────────────────────────────────

  const { data: dnaRow } = await (supabase as any)
    .from('character_visual_dna')
    .select('visual_prompt_block, traits_json')
    .eq('project_id', projectId)
    .eq('character_name', displayName)
    .eq('is_current', true)
    .maybeSingle();

  if (dnaRow) {
    if (dnaRow.visual_prompt_block) {
      const sanitized = sanitizePlotLanguage(dnaRow.visual_prompt_block);
      if (sanitized) visualMarkers.push(sanitized);
    }
    if (dnaRow.traits_json && Array.isArray(dnaRow.traits_json)) {
      for (const trait of dnaRow.traits_json) {
        if (trait?.label && trait?.category) {
          const cat = trait.category?.toLowerCase();
          if (['face', 'body', 'hair', 'skin', 'physique', 'height', 'build'].includes(cat)) {
            visualMarkers.push(trait.label);
            tags.push(trait.label.toLowerCase());
          } else if (['posture', 'energy', 'presence', 'vibe'].includes(cat)) {
            vibeMarkers.push(trait.label);
          } else if (['costume', 'wardrobe', 'styling', 'period'].includes(cat)) {
            stylingCues.push(trait.label);
          }
        }
      }
    }
  }

  // ── 4. project_images subjects ──────────────────────────────────────────

  if (visualMarkers.length === 0 && vibeMarkers.length === 0) {
    const { data: imageSubjects } = await (supabase as any)
      .from('project_images')
      .select('subject')
      .eq('project_id', projectId)
      .in('shot_type', ['identity_headshot', 'identity_full_body'])
      .not('subject', 'is', null);

    const matchedImage = (imageSubjects || []).find(
      (d: any) => normalizeCharacterKey(d.subject) === normalizedKey,
    );

    if (matchedImage && !displayName) {
      displayName = matchedImage.subject;
    }
  }

  // ── Build context summary ──────────────────────────────────────────────

  const storySummary = roleInStory
    ? `${displayName} — ${roleInStory}`
    : `${displayName}`;

  const context: CharacterContextSummary = {
    character_key: normalizedKey,
    display_name: displayName,
    story_summary: storySummary,
    role_in_story: roleInStory,
    canon_notes: [...new Set(storyNotes)].slice(0, 10),
  };

  // ── Build casting brief ────────────────────────────────────────────────

  // Derive visual archetype from available markers
  if (vibeMarkers.length > 0) {
    visualArchetype = vibeMarkers.slice(0, 3).join(', ');
  }

  // Build actor description from VISUAL data only
  const descParts: string[] = [];
  if (genderPresentation) descParts.push(genderPresentation);
  if (ageHint) descParts.push(ageHint);
  if (ethnicityHint) descParts.push(ethnicityHint);
  if (visualMarkers.length > 0) descParts.push(...visualMarkers.slice(0, 5));
  if (vibeMarkers.length > 0) descParts.push(...vibeMarkers.slice(0, 3));
  if (stylingCues.length > 0) descParts.push(...stylingCues.slice(0, 2));

  const actorDescription = sanitizePlotLanguage(
    [...new Set(descParts)].filter(Boolean).join(', ')
  );

  // Build negative exclusions
  const negativeExclusions = buildNegativeExclusions(canonRow?.canon_json);

  // Deduplicate tags
  const uniqueTags = [...new Set(
    tags.map(t => t.toLowerCase().trim()).filter(t => t.length > 2 && t.length < 30)
  )];

  const brief: CastingBrief = {
    age_hint: ageHint,
    gender_presentation: genderPresentation,
    ethnicity_or_cultural_appearance: ethnicityHint,
    appearance_markers: [...new Set(visualMarkers)].slice(0, 8),
    visual_archetype: visualArchetype,
    styling_cues: [...new Set(stylingCues)].slice(0, 5),
    performance_vibe: [...new Set(vibeMarkers)].slice(0, 5),
    negative_exclusions: negativeExclusions,
    suggested_actor_name: displayName,
    actor_description: actorDescription,
    actor_tags: uniqueTags.slice(0, 15),
  };

  return { context, brief };
}

// ── Negative exclusion derivation ────────────────────────────────────────────

function buildNegativeExclusions(canonJson: any): string[] {
  const exclusions: string[] = [
    'celebrity likeness',
    'real person',
    'cartoon',
    'anime',
  ];

  if (!canonJson) return exclusions;

  // Period drama detection
  const toneStyle = typeof canonJson.tone_style === 'string' ? canonJson.tone_style.toLowerCase() : '';
  const worldRules = typeof canonJson.world_rules === 'string' ? canonJson.world_rules.toLowerCase() : '';
  const combined = toneStyle + ' ' + worldRules;

  if (/period|histori|19th|18th|medieval|victorian|edo|meiji|taisho|regency/i.test(combined)) {
    exclusions.push('modern fashion', 'contemporary clothing', 'modern accessories');
  }

  if (/sci-?fi|futuris|cyberpunk|space/i.test(combined)) {
    exclusions.push('period costume', 'historical clothing');
  }

  if (/realis|grounded|naturalis/i.test(combined)) {
    exclusions.push('fantasy elements', 'stylized', 'exaggerated features');
  }

  return [...new Set(exclusions)];
}
