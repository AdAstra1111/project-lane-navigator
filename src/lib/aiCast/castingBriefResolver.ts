/**
 * castingBriefResolver — Phase 17.2 (Hardened): Character → Casting Brief Separation.
 *
 * Strictly separates character canon (story truth) from casting brief (visual performer requirements).
 * Actor creation, recommendations, and matching must consume the casting brief only.
 *
 * HARDENING RULES:
 * - Actor criteria fields populated ONLY from explicit visual/performer-safe allowlists.
 * - Unknown predicates NEVER populate actor criteria.
 * - Regex sanitization is a DEFENSIVE LAYER, not the primary classifier.
 * - Primary classifier is the VISUAL_PREDICATE_ALLOWLIST.
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

// ── AUTHORITARIAN ALLOWLISTS (PRIMARY CLASSIFIER) ───────────────────────────
// These are the ONLY predicates that may populate actor criteria fields.
// Everything else goes to story context or is ignored.

/** Predicates whose object value goes into appearance_markers / actor criteria */
const VISUAL_PREDICATE_ALLOWLIST = new Set([
  'age', 'gender', 'appearance', 'ethnicity', 'nationality', 'cultural_appearance',
  'hair', 'hair_color', 'hair_style', 'hair_length',
  'eyes', 'eye_color', 'eye_shape',
  'skin', 'skin_tone', 'complexion',
  'height', 'build', 'physique', 'body', 'body_type',
  'face', 'facial_features', 'face_shape',
  'beauty', 'silhouette',
  'clothing', 'wardrobe', 'costume', 'outfit',
  'posture', 'bearing', 'gait',
  'style', 'fashion',
  'weight', 'stature',
  'tattoo', 'scar', 'piercing', 'birthmark',
  'makeup', 'grooming',
]);

/** Predicates that are ALWAYS story-only — never actor criteria */
const STORY_PREDICATE_DENYLIST = new Set([
  'role', 'goal', 'goals', 'motivation', 'motivations',
  'relationship', 'relationships', 'backstory', 'background',
  'conflict', 'arc', 'secret', 'secrets', 'desire', 'desires',
  'personality', 'trait', 'character_trait',
  'description', 'is_character',
  'fear', 'fears', 'flaw', 'flaws', 'strength', 'strengths',
  'weakness', 'weaknesses', 'belief', 'beliefs',
  'occupation', 'profession', 'job', 'title',
  'status', 'rank', 'family', 'origin', 'hometown',
  'philosophy', 'ideology', 'values',
  'catchphrase', 'speech_pattern', 'voice',
]);

/**
 * Classify a predicate. Returns 'visual', 'story', or 'unknown'.
 * UNKNOWN predicates are NEVER allowed into actor criteria.
 */
function classifyPredicate(predicate: string): 'visual' | 'story' | 'unknown' {
  const norm = predicate.toLowerCase().trim();
  if (VISUAL_PREDICATE_ALLOWLIST.has(norm)) return 'visual';
  if (STORY_PREDICATE_DENYLIST.has(norm)) return 'story';
  return 'unknown';
}

// ── PERFORMER-SAFE PRESENCE MARKERS ─────────────────────────────────────────
// Only externally perceivable casting-language terms.
// These are what a casting director would write on a brief.

const PERFORMER_PRESENCE_ALLOWLIST = new Set([
  'poised', 'guarded', 'warm', 'severe', 'elegant', 'magnetic',
  'graceful', 'intense', 'commanding', 'gentle', 'stoic', 'regal',
  'brooding', 'charismatic', 'dignified', 'ethereal', 'delicate',
  'rugged', 'weathered', 'youthful', 'mature', 'androgynous',
  'athletic', 'lithe', 'statuesque', 'petite', 'imposing',
  'refined', 'fierce', 'serene', 'stern', 'luminous',
  'sharp', 'angular', 'soft', 'hardened', 'wiry', 'compact',
  'tall', 'short', 'lean', 'muscular', 'slender', 'curvy',
  'vulnerable', 'resilient', 'formidable', 'approachable',
  'striking', 'unassuming', 'bold', 'quiet', 'assertive',
]);

/** Non-visual personality terms that must NEVER enter performance_vibe */
const PERSONALITY_DENYLIST = new Set([
  'ambitious', 'manipulative', 'grieving', 'conflicted', 'loyal',
  'jealous', 'traumatized', 'secretive', 'revenge-driven', 'vengeful',
  'in love', 'heartbroken', 'obsessed', 'paranoid', 'deceptive',
  'cunning', 'ruthless', 'compassionate', 'idealistic', 'cynical',
  'rebellious', 'obedient', 'defiant', 'submissive', 'dominant',
  'protective', 'selfish', 'selfless', 'honorable', 'dishonest',
  'brave', 'cowardly', 'wise', 'foolish', 'naive', 'innocent',
  'corrupt', 'virtuous', 'treacherous', 'faithful', 'devout',
  'power-hungry', 'humble', 'arrogant', 'proud', 'ashamed',
]);

/**
 * Check if a term is a performer-safe presence marker.
 * Uses strict allowlist — NOT regex heuristics.
 */
function isPerformerSafePresence(term: string): boolean {
  const norm = term.toLowerCase().trim();
  if (PERSONALITY_DENYLIST.has(norm)) return false;
  if (PERFORMER_PRESENCE_ALLOWLIST.has(norm)) return true;
  return false;
}

// ── Plot-language blocklist (DEFENSIVE LAYER ONLY) ──────────────────────────
// This is a SECONDARY defense. Primary classification uses allowlists above.

const PLOT_LANGUAGE_PATTERNS = [
  /\bbetray/i, /\brevenge\b/i, /\bguilt\b/i, /\bsecre(?:t|cy)\b/i,
  /\bduty\b/i, /\bforbidden\b/i, /\bwound(?:ed|s)?\b/i, /\btrauma\b/i,
  /\bconflict\b/i, /\bmotivat/i, /\bdesire\b/i, /\blove\b/i,
  /\bhate\b/i, /\bfear\b/i, /\bjealous/i, /\banger\b/i,
  /\btorn between\b/i, /\bhides?\b/i, /\bchoose\b/i, /\bchosen\b/i,
  /\bstruggl/i, /\bloss\b/i, /\babandone?d?\b/i, /\bredemption\b/i,
  /\bpolitical\b/i, /\bpower\b/i, /\bfate\b/i, /\bdestiny\b/i,
  /\bprotest/i, /\brebel/i, /\boppressed/i, /\bmanipulat/i,
  /\bpurpose\b/i, /\barc\b/i, /\bgoals?\b/i, /\bmurder/i,
  /\bblackmail/i, /\bkill/i, /\bdeath\b/i, /\bmarriage\b/i,
  /\bdivorce\b/i, /\bpregnant/i, /\binherit/i, /\bwill\b/i,
  /\bbelie(?:ve|f)/i, /\bideolog/i,
];

/**
 * DEFENSIVE sanitizer: removes sentences containing plot language.
 * Applied as a SECONDARY defense after allowlist classification.
 */
export function sanitizePlotLanguage(text: string): string {
  if (!text) return '';
  const sentences = text.split(/[.!?,;]+/).map(s => s.trim()).filter(Boolean);
  const safe = sentences.filter(sentence =>
    !PLOT_LANGUAGE_PATTERNS.some(pat => pat.test(sentence))
  );
  return safe.join(', ').trim();
}

// ── Canonical Character Identity Resolution ─────────────────────────────────
// Single deterministic resolution path for character identity across all sources.

interface ResolvedCharacterIdentity {
  normalizedKey: string;
  displayName: string;
  /** The exact subject string found in canon_facts, if any */
  canonFactsSubject: string | null;
  /** The exact character name found in character_visual_dna, if any */
  dnaCharacterName: string | null;
}

/**
 * Resolve character identity deterministically across all canonical sources.
 * Uses normalized key comparison consistently. Returns the best available
 * display name and source-specific lookup keys.
 */
async function resolveCanonicalCharacterIdentity(
  projectId: string,
  characterKey: string,
): Promise<ResolvedCharacterIdentity> {
  const normalizedKey = normalizeCharacterKey(characterKey);
  let displayName = characterKey;
  let canonFactsSubject: string | null = null;
  let dnaCharacterName: string | null = null;

  // 1. canon_facts subject lookup
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
    canonFactsSubject = matchedSubject.subject;
    displayName = matchedSubject.subject;
  }

  // 2. character_visual_dna lookup — use normalized comparison, not display string
  const { data: dnaRows } = await (supabase as any)
    .from('character_visual_dna')
    .select('character_name')
    .eq('project_id', projectId)
    .eq('is_current', true);

  const matchedDna = (dnaRows || []).find(
    (d: any) => normalizeCharacterKey(d.character_name) === normalizedKey,
  );
  if (matchedDna) {
    dnaCharacterName = matchedDna.character_name;
    // Prefer canon_facts display name, fallback to DNA name
    if (!canonFactsSubject) displayName = matchedDna.character_name;
  }

  // 3. project_images fallback for display name
  if (!canonFactsSubject && !dnaCharacterName) {
    const { data: imgSubjects } = await (supabase as any)
      .from('project_images')
      .select('subject')
      .eq('project_id', projectId)
      .in('shot_type', ['identity_headshot', 'identity_full_body'])
      .not('subject', 'is', null);

    const matchedImage = (imgSubjects || []).find(
      (d: any) => normalizeCharacterKey(d.subject) === normalizedKey,
    );
    if (matchedImage) {
      displayName = matchedImage.subject;
    }
  }

  return { normalizedKey, displayName, canonFactsSubject, dnaCharacterName };
}

// ── DNA trait classification ────────────────────────────────────────────────

/** DNA trait categories that are safe for actor criteria */
const DNA_VISUAL_CATEGORIES = new Set([
  'face', 'body', 'hair', 'skin', 'physique', 'height', 'build',
  'eyes', 'complexion', 'weight', 'stature', 'silhouette',
  'tattoo', 'scar', 'piercing', 'birthmark', 'makeup', 'grooming',
]);

const DNA_STYLING_CATEGORIES = new Set([
  'costume', 'wardrobe', 'styling', 'period', 'fashion', 'clothing', 'outfit',
]);

const DNA_PRESENCE_CATEGORIES = new Set([
  'posture', 'energy', 'presence', 'vibe', 'bearing', 'gait',
]);

// ── Core Function ────────────────────────────────────────────────────────────

export async function buildCharacterCastingBrief(
  projectId: string,
  characterKey: string,
): Promise<CharacterCastingBriefResult> {
  // ── 0. Canonical identity resolution ────────────────────────────────────
  const identity = await resolveCanonicalCharacterIdentity(projectId, characterKey);
  const { normalizedKey, displayName, canonFactsSubject, dnaCharacterName } = identity;

  // Collect separated data
  const storyNotes: string[] = [];
  const visualMarkers: string[] = [];
  const presenceMarkers: string[] = [];
  const stylingCues: string[] = [];
  const tags: string[] = [];
  let ageHint: string | null = null;
  let genderPresentation: string | null = null;
  let ethnicityHint: string | null = null;
  let roleInStory: string | null = null;

  // ── 1. canon_facts ──────────────────────────────────────────────────────

  if (canonFactsSubject) {
    const { data: allFacts } = await supabase
      .from('canon_facts')
      .select('predicate, object, value')
      .eq('project_id', projectId)
      .eq('subject', canonFactsSubject)
      .eq('is_active', true);

    for (const fact of allFacts || []) {
      const pred = fact.predicate?.toLowerCase()?.trim() || '';
      const obj = fact.object || '';
      if (!obj) continue;

      // Special-case demographic fields first
      if (pred === 'age') {
        ageHint = obj;
        tags.push(obj.toLowerCase());
        continue;
      }
      if (pred === 'gender') {
        genderPresentation = obj;
        tags.push(obj.toLowerCase());
        continue;
      }
      if (pred === 'ethnicity' || pred === 'nationality' || pred === 'cultural_appearance') {
        ethnicityHint = obj;
        continue;
      }

      // Classify predicate using authoritarian allowlist
      const classification = classifyPredicate(pred);

      if (classification === 'visual') {
        // Allowed into actor criteria — apply defensive sanitizer too
        const sanitized = sanitizePlotLanguage(obj);
        if (sanitized) {
          visualMarkers.push(sanitized);
          tags.push(sanitized.toLowerCase());
        }
      } else if (classification === 'story') {
        // Story-only — goes to context, NEVER actor criteria
        storyNotes.push(obj);
      } else {
        // UNKNOWN predicate — goes to story context ONLY
        // IEL: unknown predicates MUST NOT influence actor criteria
        storyNotes.push(obj);
      }
    }
  }

  // ── 2. canon_json.characters ────────────────────────────────────────────
  // ALL canon_json.characters fields go to STORY CONTEXT ONLY.
  // They are narrative descriptions, not visual performer criteria.

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
      if (matched.role && !roleInStory) {
        roleInStory = matched.role;
      }
      // ALL of these go to story context — never actor criteria
      if (matched.role) storyNotes.push(`Role: ${matched.role}`);
      if (matched.traits) storyNotes.push(`Traits: ${matched.traits}`);
      if (matched.goals) storyNotes.push(`Goals: ${matched.goals}`);
      if (matched.secrets) storyNotes.push(`Secrets: ${matched.secrets}`);
      if (matched.relationships) storyNotes.push(`Relationships: ${matched.relationships}`);
    }
  }

  // ── 3. character_visual_dna ─────────────────────────────────────────────
  // Use resolved DNA character name for lookup, not raw displayName

  if (dnaCharacterName) {
    const { data: dnaRow } = await (supabase as any)
      .from('character_visual_dna')
      .select('visual_prompt_block, traits_json')
      .eq('project_id', projectId)
      .eq('character_name', dnaCharacterName)
      .eq('is_current', true)
      .maybeSingle();

    if (dnaRow) {
      // visual_prompt_block: apply defensive sanitizer since it's from visual DNA
      if (dnaRow.visual_prompt_block) {
        const sanitized = sanitizePlotLanguage(dnaRow.visual_prompt_block);
        if (sanitized) visualMarkers.push(sanitized);
      }

      // traits_json: classify each trait by its category using strict allowlists
      if (dnaRow.traits_json && Array.isArray(dnaRow.traits_json)) {
        for (const trait of dnaRow.traits_json) {
          if (!trait?.label || !trait?.category) continue;
          const cat = trait.category?.toLowerCase()?.trim();

          if (DNA_VISUAL_CATEGORIES.has(cat)) {
            visualMarkers.push(trait.label);
            tags.push(trait.label.toLowerCase());
          } else if (DNA_STYLING_CATEGORIES.has(cat)) {
            stylingCues.push(trait.label);
          } else if (DNA_PRESENCE_CATEGORIES.has(cat)) {
            // Presence traits must pass performer-safe check
            if (isPerformerSafePresence(trait.label)) {
              presenceMarkers.push(trait.label);
            }
            // Non-performer-safe presence traits are silently dropped from actor criteria
          }
          // All other DNA categories are ignored for actor criteria
        }
      }
    }
  }

  // ── 4. project_images subjects ──────────────────────────────────────────
  // Only used for display name resolution (already handled in identity resolver)
  // No additional actor criteria derived from project_images

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

  // Visual archetype: derived from presence markers (performer-safe only)
  const visualArchetype = presenceMarkers.length > 0
    ? presenceMarkers.slice(0, 3).join(', ')
    : null;

  // Build actor description from VISUAL data only
  const descParts: string[] = [];
  if (genderPresentation) descParts.push(genderPresentation);
  if (ageHint) descParts.push(ageHint);
  if (ethnicityHint) descParts.push(ethnicityHint);
  if (visualMarkers.length > 0) descParts.push(...visualMarkers.slice(0, 5));
  if (presenceMarkers.length > 0) descParts.push(...presenceMarkers.slice(0, 3));
  if (stylingCues.length > 0) descParts.push(...stylingCues.slice(0, 2));

  // Final defensive sanitization on assembled description
  const actorDescription = sanitizePlotLanguage(
    [...new Set(descParts)].filter(Boolean).join(', ')
  );

  // Build negative exclusions from project world/style (NOT character story)
  const negativeExclusions = buildNegativeExclusions(canonRow?.canon_json);

  // Deduplicate tags — only tags that entered through visual allowlist paths
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
    performance_vibe: [...new Set(presenceMarkers)].slice(0, 5),
    negative_exclusions: negativeExclusions,
    suggested_actor_name: displayName,
    actor_description: actorDescription,
    actor_tags: uniqueTags.slice(0, 15),
  };

  return { context, brief };
}

// ── Negative exclusion derivation ────────────────────────────────────────────
// Derived from PROJECT world/style only — never from character story facts.

function buildNegativeExclusions(canonJson: any): string[] {
  const exclusions: string[] = [
    'celebrity likeness',
    'real person',
    'cartoon',
    'anime',
  ];

  if (!canonJson) return exclusions;

  // Period drama detection from project world rules
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

// ── Exported helpers for testing ─────────────────────────────────────────────

export const _testHelpers = {
  classifyPredicate,
  isPerformerSafePresence,
  sanitizePlotLanguage,
  VISUAL_PREDICATE_ALLOWLIST,
  STORY_PREDICATE_DENYLIST,
  PERFORMER_PRESENCE_ALLOWLIST,
  PERSONALITY_DENYLIST,
};
