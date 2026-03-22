/**
 * castingBriefResolver — Phase 17.4: Actor Identity Composer.
 *
 * Strictly separates character canon (story truth) from casting brief (visual performer requirements).
 * Actor creation, recommendations, and matching must consume the casting brief only.
 *
 * HARDENING RULES:
 * - Actor criteria fields populated ONLY from explicit visual/performer-safe allowlists.
 * - Unknown predicates NEVER populate actor criteria.
 * - Regex sanitization is a DEFENSIVE LAYER, not the primary classifier.
 * - Primary classifier is the VISUAL_PREDICATE_ALLOWLIST.
 * - Phase 17.4: Extracted signals are classified into explicit identity buckets,
 *   then deterministically composed into generation-ready actor descriptions.
 *
 * DETERMINISTIC. READ-ONLY. No LLM enrichment.
 *
 * Sources (priority order):
 * 1. canon_facts
 * 2. Document-enriched appearance signals (character_bible, character_profile)
 * 3. character_visual_dna
 * 4. canon_json.characters (story context only)
 * 5. Document support signals (treatment, story_outline, scripts)
 * 6. World bible styling cues
 * 7. project_images character descriptors
 * 8. minimal fallback
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

// ── Document-Aware Enrichment Helpers ────────────────────────────────────────
// Reads project_documents + project_document_versions for appearance-safe signals.
// Character Bible > character_profile > treatment > scripts > world_bible.

/** Doc types ranked by priority for character appearance enrichment */
const DOC_TYPE_PRIORITY_FOR_APPEARANCE: string[] = [
  'character_bible',
  'character_profile',
  'treatment',
  'story_outline',
  'feature_script',
  'episode_script',
  'screenplay_draft',
  'season_script',
];

const DOC_TYPE_STYLING_ONLY: string[] = [
  'world_bible',
  'series_bible',
  'story_bible',
];

/**
 * Appearance-safe extraction patterns.
 * Each regex targets a visual descriptor class; matched content is a candidate signal.
 */
const APPEARANCE_EXTRACTION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'age', pattern: /\b(?:early|mid|late)\s*(?:teens|twenties|thirties|forties|fifties|sixties|seventies|eighties)\b/gi },
  { label: 'age', pattern: /\b(?:\d{1,2}[\s-]*(?:year[\s-]*old|years[\s-]*old|yo))\b/gi },
  { label: 'hair', pattern: /\b(?:(?:dark|light|blonde?|auburn|red|black|white|grey|gray|silver|brown|chestnut|raven|platinum|copper|golden|jet[\s-]*black)\s+hair\w*)\b/gi },
  { label: 'hair', pattern: /\b(?:hair\s+(?:is|was)\s+\w+(?:\s+\w+)?)\b/gi },
  { label: 'hair', pattern: /\b(?:cropped|shaved|braided|curly|wavy|straight|long|short)\s+hair\b/gi },
  { label: 'eyes', pattern: /\b(?:(?:dark|light|blue|green|brown|hazel|grey|gray|amber|black|bright|piercing|deep[\s-]*set|almond[\s-]*shaped|wide[\s-]*set|narrow|hooded)\s+eyes?)\b/gi },
  { label: 'build', pattern: /\b(?:(?:slender|lean|stocky|muscular|athletic|petite|tall|short|heavyset|wiry|compact|broad[\s-]*shouldered|lithe|thin|slight|imposing|statuesque)\s+(?:build|frame|figure|physique|stature)?)\b/gi },
  { label: 'skin', pattern: /\b(?:(?:dark|light|olive|pale|fair|tanned|sun[\s-]*kissed|brown|ebony|ivory|porcelain|weathered|freckled)\s+(?:skin|complexion|tone)?)\b/gi },
  { label: 'face', pattern: /\b(?:(?:angular|round|oval|square|heart[\s-]*shaped|chiseled|gaunt|broad|high|sharp|prominent|delicate|soft)\s+(?:face|jaw|cheekbones?|features?|chin|brow|forehead)?)\b/gi },
  { label: 'height', pattern: /\b(?:(?:tall|short|petite|statuesque|towering|diminutive)\s*(?:woman|man|person|figure|frame)?)\b/gi },
  { label: 'scar', pattern: /\b(?:scar\w*(?:\s+(?:across|on|over|down)\s+\w+(?:\s+\w+)?)?)\b/gi },
  { label: 'tattoo', pattern: /\btattoo\w*\b/gi },
  { label: 'clothing', pattern: /\b(?:wears?|dressed\s+in|wearing|clad\s+in)\s+[\w\s,]+(?:dress|suit|uniform|coat|kimono|gown|robe|tunic|armor|cloak|vest|jacket|shirt)\b/gi },
];

/** Styling-only patterns for world-bible enrichment */
const STYLING_EXTRACTION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'period', pattern: /\b(?:Victorian|Edwardian|Regency|Georgian|Medieval|Renaissance|Art[\s-]*Deco|Art[\s-]*Nouveau|Meiji|Edo|Taisho|1920s|1930s|1940s|1950s|1960s|1970s|1980s)\b/gi },
  { label: 'material', pattern: /\b(?:silk|linen|cotton|wool|leather|velvet|satin|lace|brocade|tweed|denim|fur|muslin)\b/gi },
  { label: 'class', pattern: /\b(?:aristocrat\w*|working[\s-]*class|upper[\s-]*class|nobility|peasant|bourgeois|royal|courtly|servant|elite)\b/gi },
];

interface DocumentCandidate {
  doc_type: string;
  plaintext: string;
}

/**
 * Load project document plaintext candidates for a project, ordered by appearance-enrichment priority.
 * Returns the latest/current version plaintext for each relevant doc type.
 */
async function loadCharacterDocumentCandidates(
  projectId: string,
  docTypes: string[],
): Promise<DocumentCandidate[]> {
  // Fetch docs of relevant types
  const { data: docs } = await supabase
    .from('project_documents')
    .select('id, doc_type, plaintext, extracted_text')
    .eq('project_id', projectId)
    .in('doc_type', docTypes);

  if (!docs || docs.length === 0) return [];

  const candidates: DocumentCandidate[] = [];
  const docIds = docs.map(d => d.id);

  // Fetch current/latest version plaintext for these docs
  const { data: versions } = await (supabase as any)
    .from('project_document_versions')
    .select('document_id, plaintext, is_current, version_number')
    .in('document_id', docIds)
    .order('version_number', { ascending: false });

  // Build map: doc_id → best plaintext
  const versionMap: Record<string, string> = {};
  for (const v of versions || []) {
    // Prefer current version, otherwise latest
    if (!versionMap[v.document_id] || v.is_current) {
      if (v.plaintext && v.plaintext.trim().length > 20) {
        versionMap[v.document_id] = v.plaintext;
      }
    }
  }

  for (const doc of docs) {
    const text = versionMap[doc.id] || doc.plaintext || doc.extracted_text || '';
    if (text.trim().length < 20) continue;
    candidates.push({ doc_type: doc.doc_type, plaintext: text });
  }

  // Sort by priority
  candidates.sort((a, b) => {
    const allTypes = [...docTypes];
    return allTypes.indexOf(a.doc_type) - allTypes.indexOf(b.doc_type);
  });

  return candidates;
}

/**
 * Extract character-specific paragraphs/lines from document plaintext.
 * Returns only passages that mention the character name.
 */
function extractCharacterPassages(text: string, displayName: string, characterKey: string): string[] {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 15);
  const namePatterns = [
    new RegExp(`\\b${escapeRegex(displayName)}\\b`, 'i'),
    new RegExp(`\\b${escapeRegex(characterKey)}\\b`, 'i'),
  ];

  // Find lines mentioning the character
  const matches = lines.filter(line =>
    namePatterns.some(pat => pat.test(line))
  );

  // Prioritize early introduction-style passages (first 30% of doc)
  const earlyThreshold = Math.floor(lines.length * 0.3);
  const earlyMatches = matches.filter(m => {
    const idx = lines.indexOf(m);
    return idx >= 0 && idx < earlyThreshold;
  });

  // Return early matches first, then rest, limited
  const ordered = [...earlyMatches, ...matches.filter(m => !earlyMatches.includes(m))];
  return ordered.slice(0, 15);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract appearance-safe visual signals from character-relevant passages.
 * Returns only signals that pass through visual allowlists and plot sanitization.
 */
function extractAppearanceSignalsFromPassages(passages: string[]): {
  visualMarkers: string[];
  ageSignals: string[];
  stylingSignals: string[];
  presenceSignals: string[];
} {
  const visualMarkers: string[] = [];
  const ageSignals: string[] = [];
  const stylingSignals: string[] = [];
  const presenceSignals: string[] = [];

  const combined = passages.join(' ');

  for (const { label, pattern } of APPEARANCE_EXTRACTION_PATTERNS) {
    const matches = combined.match(pattern) || [];
    for (const m of matches) {
      const cleaned = m.trim();
      if (!cleaned || cleaned.length < 3) continue;
      // Apply plot-language sanitizer
      const sanitized = sanitizePlotLanguage(cleaned);
      if (!sanitized) continue;

      if (label === 'age') {
        ageSignals.push(sanitized);
      } else if (label === 'clothing') {
        stylingSignals.push(sanitized);
      } else {
        visualMarkers.push(sanitized);
      }
    }
  }

  // Extract performer presence terms from passages
  const words = combined.toLowerCase().split(/[\s,;.!?()]+/).filter(Boolean);
  for (const w of words) {
    if (isPerformerSafePresence(w) && !presenceSignals.includes(w)) {
      presenceSignals.push(w);
    }
  }

  return { visualMarkers, ageSignals, stylingSignals, presenceSignals };
}

/**
 * Extract styling-only signals from world bible type documents.
 */
function extractStylingSignalsFromText(text: string): string[] {
  const signals: string[] = [];
  for (const { pattern } of STYLING_EXTRACTION_PATTERNS) {
    const matches = text.match(pattern) || [];
    for (const m of matches) {
      const cleaned = m.trim();
      if (cleaned && cleaned.length >= 3 && !signals.includes(cleaned.toLowerCase())) {
        signals.push(cleaned);
      }
    }
  }
  return signals;
}
// ── Phase 17.4: Actor Identity Buckets & Composer ────────────────────────────

/**
 * Structured identity buckets for deterministic actor description composition.
 * Signals are classified into explicit physical/visual categories before composition.
 */
interface ActorIdentityBuckets {
  age: string[];
  gender: string[];
  ethnicity: string[];
  build: string[];
  height: string[];
  face: string[];
  hair: string[];
  eyes: string[];
  skin: string[];
  scars_marks: string[];
  styling: string[];
  presence: string[];
  archetype: string[];
}

function createEmptyBuckets(): ActorIdentityBuckets {
  return {
    age: [], gender: [], ethnicity: [], build: [], height: [],
    face: [], hair: [], eyes: [], skin: [], scars_marks: [],
    styling: [], presence: [], archetype: [],
  };
}

/**
 * Map a visual marker string into the appropriate identity bucket.
 * Uses keyword detection to classify — deterministic, no LLM.
 */
function classifyIntoBucket(signal: string, buckets: ActorIdentityBuckets): void {
  const lower = signal.toLowerCase();

  // Age patterns
  if (/\b(?:early|mid|late)\s*(?:teens|twenties|thirties|forties|fifties|sixties|seventies|eighties)\b/i.test(signal)
    || /\b\d{1,2}[\s-]*(?:year|yo)\b/i.test(signal)) {
    buckets.age.push(signal);
    return;
  }

  // Hair
  if (/\bhair\b/i.test(lower) || /\bbraid/i.test(lower) || /\bcropped\b/i.test(lower)
    || /\bshaved\b/i.test(lower) || /\blocks\b/i.test(lower) || /\bbun\b/i.test(lower)) {
    buckets.hair.push(signal);
    return;
  }

  // Eyes
  if (/\beyes?\b/i.test(lower) || /\bgaze\b/i.test(lower)) {
    buckets.eyes.push(signal);
    return;
  }

  // Skin / complexion
  if (/\bskin\b/i.test(lower) || /\bcomplexion\b/i.test(lower) || /\btone\b/i.test(lower)
    || /\bfreckle/i.test(lower) || /\bpale\b/i.test(lower) || /\bolive\b/i.test(lower)
    || /\bporcelain\b/i.test(lower) || /\bebony\b/i.test(lower) || /\bivory\b/i.test(lower)) {
    buckets.skin.push(signal);
    return;
  }

  // Scars / marks / tattoos
  if (/\bscar\b/i.test(lower) || /\btattoo\b/i.test(lower) || /\bpiercing\b/i.test(lower)
    || /\bbirthmark\b/i.test(lower)) {
    buckets.scars_marks.push(signal);
    return;
  }

  // Height
  if (/\b(?:tall|short|petite|statuesque|towering|diminutive)\b/i.test(lower)
    && !/\b(?:features?|face|jaw|cheekbones?)\b/i.test(lower)) {
    buckets.height.push(signal);
    return;
  }

  // Build / physique
  if (/\b(?:slender|lean|stocky|muscular|athletic|heavyset|wiry|compact|lithe|broad|thin|slight|curvy)\b/i.test(lower)
    || /\bbuild\b/i.test(lower) || /\bframe\b/i.test(lower) || /\bphysique\b/i.test(lower)
    || /\bfigure\b/i.test(lower)) {
    buckets.build.push(signal);
    return;
  }

  // Face / facial features
  if (/\b(?:face|jaw|cheekbone|chin|brow|forehead|features?)\b/i.test(lower)
    || /\b(?:angular|chiseled|gaunt|round|oval|square|heart-shaped)\b/i.test(lower)) {
    buckets.face.push(signal);
    return;
  }

  // Styling / costume / clothing
  if (/\b(?:wears?|dressed|wearing|clad|dress|suit|uniform|coat|kimono|gown|robe|tunic|armor|cloak|silk|linen|velvet|satin|lace|wool|leather|costume|wardrobe|period|victorian|edwardian|regency|medieval|meiji|edo|taisho|aristocrat|working.class|upper.class|nobility|courtly|royal)\b/i.test(lower)) {
    buckets.styling.push(signal);
    return;
  }

  // Default: check if it's a presence term
  const words = lower.split(/[\s,]+/).filter(Boolean);
  const hasPresence = words.some(w => isPerformerSafePresence(w));
  if (hasPresence && words.length <= 3) {
    buckets.presence.push(signal);
    return;
  }

  // Remaining visual markers go to archetype
  buckets.archetype.push(signal);
}

/** Known contradictory pairs — if both appear, keep the first (higher-trust source) */
const CONTRADICTION_PAIRS: Array<[RegExp, RegExp]> = [
  [/\btall\b/i, /\bpetite\b/i],
  [/\btall\b/i, /\bshort\b/i],
  [/\bslender\b/i, /\bstocky\b/i],
  [/\bslender\b/i, /\bheavyset\b/i],
  [/\bmuscular\b/i, /\bthin\b/i],
  [/\bangular\b/i, /\bround\b/i],
  [/\bsharp features\b/i, /\bsoft features\b/i],
  [/\bdark hair\b/i, /\bblonde? hair\b/i],
  [/\bblack hair\b/i, /\bblonde? hair\b/i],
  [/\byouthful\b/i, /\bweathered\b/i],
];

/**
 * Deduplicate and resolve contradictions within a bucket.
 * Items are ordered by insertion (source trust priority).
 */
function dedupeAndResolveConflicts(items: string[]): string[] {
  // Dedupe by normalized form
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of items) {
    const norm = item.toLowerCase().trim();
    if (norm.length < 2) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    unique.push(item.trim());
  }

  // Resolve contradictions: keep the first (higher-trust) of each pair
  const result: string[] = [];
  const removed = new Set<number>();
  for (let i = 0; i < unique.length; i++) {
    if (removed.has(i)) continue;
    for (let j = i + 1; j < unique.length; j++) {
      if (removed.has(j)) continue;
      for (const [patA, patB] of CONTRADICTION_PAIRS) {
        if ((patA.test(unique[i]) && patB.test(unique[j]))
          || (patB.test(unique[i]) && patA.test(unique[j]))) {
          removed.add(j); // Keep i (higher trust), remove j
        }
      }
    }
    result.push(unique[i]);
  }
  return result;
}

/**
 * Compose a structured, generation-ready actor identity description from identity buckets.
 *
 * Output order (deterministic):
 * 1. ethnicity/cultural appearance (if explicit)
 * 2. gender + age
 * 3. height + build
 * 4. face features
 * 5. eyes
 * 6. hair
 * 7. skin
 * 8. scars/marks
 * 9. presence
 * 10. styling/costume
 *
 * This produces a casting-ready description, not raw tag soup.
 */
function composeActorDescriptionFromBuckets(buckets: ActorIdentityBuckets): string {
  const parts: string[] = [];

  // 1. Ethnicity (if explicit)
  const ethnicity = dedupeAndResolveConflicts(buckets.ethnicity);
  if (ethnicity.length > 0) parts.push(ethnicity[0]);

  // 2. Gender + Age
  const gender = dedupeAndResolveConflicts(buckets.gender);
  const age = dedupeAndResolveConflicts(buckets.age);
  const genderAge: string[] = [];
  if (gender.length > 0) genderAge.push(gender[0]);
  if (age.length > 0) genderAge.push(age[0]);
  if (genderAge.length > 0) parts.push(genderAge.join(', '));

  // 3. Height + Build
  const height = dedupeAndResolveConflicts(buckets.height);
  const build = dedupeAndResolveConflicts(buckets.build);
  const physique = [...height.slice(0, 1), ...build.slice(0, 2)];
  if (physique.length > 0) parts.push(physique.join(' '));

  // 4. Face
  const face = dedupeAndResolveConflicts(buckets.face);
  if (face.length > 0) parts.push(face.slice(0, 2).join(', '));

  // 5. Eyes
  const eyes = dedupeAndResolveConflicts(buckets.eyes);
  if (eyes.length > 0) parts.push(eyes[0]);

  // 6. Hair
  const hair = dedupeAndResolveConflicts(buckets.hair);
  if (hair.length > 0) parts.push(hair[0]);

  // 7. Skin
  const skin = dedupeAndResolveConflicts(buckets.skin);
  if (skin.length > 0) parts.push(skin[0]);

  // 8. Scars / marks
  const marks = dedupeAndResolveConflicts(buckets.scars_marks);
  if (marks.length > 0) parts.push(marks.slice(0, 2).join(', '));

  // 9. Presence (performer-safe only)
  const presence = dedupeAndResolveConflicts(buckets.presence);
  if (presence.length > 0) {
    parts.push(presence.slice(0, 3).join(', ') + ' presence');
  }

  // 10. Styling
  const styling = dedupeAndResolveConflicts(buckets.styling);
  if (styling.length > 0) parts.push(styling.slice(0, 2).join(', '));

  return parts.filter(p => p.trim().length > 0).join(', ');
}

/**
 * Compose clean, concise actor tags from identity buckets.
 * Tags are lowercase, underscore-separated, deduped, reusable.
 */
function composeActorTagsFromBuckets(
  buckets: ActorIdentityBuckets,
  genderHint: string | null,
): string[] {
  const raw: string[] = [];

  if (genderHint) raw.push(genderHint);

  // Flatten all buckets into tag candidates
  const allBuckets = [
    buckets.age, buckets.ethnicity, buckets.build, buckets.height,
    buckets.face, buckets.hair, buckets.eyes, buckets.skin,
    buckets.presence, buckets.styling, buckets.archetype,
  ];

  for (const bucket of allBuckets) {
    for (const item of bucket) {
      // Split compound phrases into individual tag tokens
      const tokens = item.toLowerCase()
        .replace(/[,;.!?()]+/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2 && t.length < 25);
      raw.push(...tokens);
    }
  }

  // Dedupe and filter
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const r of raw) {
    const norm = r.replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
    if (!norm || norm.length < 3 || norm.length > 25) continue;
    if (seen.has(norm)) continue;
    // Final personality check — reject any personality terms that snuck through
    if (PERSONALITY_DENYLIST.has(norm.replace(/_/g, ' '))) continue;
    seen.add(norm);
    tags.push(norm);
  }

  return tags.slice(0, 15);
}

/**
 * Compose a concise negative prompt from project world/style constraints.
 * Conservative — never bloated.
 */
function composeNegativePrompt(canonJson: any): string[] {
  const exclusions: string[] = [
    'celebrity likeness',
    'real person',
    'cartoon',
    'anime',
  ];

  if (!canonJson) return exclusions;

  const toneStyle = typeof canonJson.tone_style === 'string' ? canonJson.tone_style.toLowerCase() : '';
  const worldRules = typeof canonJson.world_rules === 'string' ? canonJson.world_rules.toLowerCase() : '';
  const combined = toneStyle + ' ' + worldRules;

  if (/period|histori|19th|18th|medieval|victorian|edo|meiji|taisho|regency/i.test(combined)) {
    exclusions.push('modern fashion', 'contemporary clothing');
  }

  if (/sci-?fi|futuris|cyberpunk|space/i.test(combined)) {
    exclusions.push('period costume', 'historical clothing');
  }

  if (/realis|grounded|naturalis/i.test(combined)) {
    exclusions.push('fantasy elements', 'stylized', 'exaggerated features');
  }

  return [...new Set(exclusions)];
}


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

  // ── 1b. Document-enriched appearance signals (character_bible, profile, etc.) ──
  // Priority source #2: richer than canon_json, read from project_documents.
  {
    const docCandidates = await loadCharacterDocumentCandidates(
      projectId,
      DOC_TYPE_PRIORITY_FOR_APPEARANCE,
    );

    for (const doc of docCandidates) {
      const passages = extractCharacterPassages(doc.plaintext, displayName, characterKey);
      if (passages.length === 0) continue;

      const signals = extractAppearanceSignalsFromPassages(passages);

      // Age: only set if not already resolved from canon_facts
      if (!ageHint && signals.ageSignals.length > 0) {
        ageHint = signals.ageSignals[0];
        tags.push(signals.ageSignals[0].toLowerCase());
      }

      // Visual markers: add unique values
      for (const vm of signals.visualMarkers) {
        if (!visualMarkers.includes(vm)) {
          visualMarkers.push(vm);
          tags.push(vm.toLowerCase());
        }
      }

      // Styling from clothing mentions
      for (const sc of signals.stylingSignals) {
        if (!stylingCues.includes(sc)) {
          stylingCues.push(sc);
        }
      }

      // Presence markers from document text
      for (const pm of signals.presenceSignals) {
        if (!presenceMarkers.includes(pm)) {
          presenceMarkers.push(pm);
        }
      }

      // Also enrich story context from character bible passages
      if (doc.doc_type === 'character_bible' || doc.doc_type === 'character_profile') {
        // Find the richest intro passage for story context
        const introPassage = passages[0];
        if (introPassage && storyNotes.length < 5) {
          const sanitizedForContext = introPassage.length > 200
            ? introPassage.slice(0, 200) + '…'
            : introPassage;
          storyNotes.push(sanitizedForContext);
        }
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

  // ── 5. World bible styling enrichment (styling_cues + negative_exclusions only) ──
  {
    const worldDocs = await loadCharacterDocumentCandidates(
      projectId,
      DOC_TYPE_STYLING_ONLY,
    );

    for (const doc of worldDocs) {
      const signals = extractStylingSignalsFromText(doc.plaintext);
      for (const s of signals) {
        if (!stylingCues.includes(s)) {
          stylingCues.push(s);
        }
      }
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
