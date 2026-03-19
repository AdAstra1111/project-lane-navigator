/**
 * Character Trait Model — Structured, source-tagged visual traits.
 * 
 * Every trait is atomic, categorized, and traceable to its origin.
 * Used for: identity generation, contradiction detection, audit.
 */

// ── Types ──

export type TraitCategory = 'age' | 'gender' | 'build' | 'face' | 'hair' | 'skin' | 'clothing' | 'posture' | 'vibe' | 'other';
export type TraitSource = 'script' | 'inferred' | 'narrative' | 'user';
export type TraitConfidence = 'high' | 'medium' | 'low';
export type TraitConstraint = 'locked' | 'protected' | 'flexible' | 'user';

export interface CharacterTrait {
  label: string;
  category: TraitCategory;
  source: TraitSource;
  confidence: TraitConfidence;
  constraint: TraitConstraint;
}

// ── Category Detection ──

const CATEGORY_PATTERNS: Record<TraitCategory, RegExp> = {
  age: /\b(age|aged?|young|old|elderly|teen|teenager|child|kid|middle.?aged|mature|senior|youthful|twenties|thirties|forties|fifties|sixties|mid.?\d+s?|early.?\d+s?|late.?\d+s?|\d+.?years?.?old)\b/i,
  gender: /\b(male|female|woman|man|masculine|feminine|non.?binary|androgynous|gender|he\/him|she\/her|they\/them)\b/i,
  build: /\b(lean|thin|slim|slender|wiry|heavy|large|stocky|muscular|bulky|heavyset|petite|athletic|tall|short|broad|narrow|towering|compact|lanky|stout|curvy|robust)\b/i,
  face: /\b(face|facial|jaw|jawline|cheek|cheekbone|nose|eye|eyes|brow|forehead|chin|lip|lips|mouth|scar|freckle|dimple|wrinkle|angular|round.?face|oval|square|sharp|soft.?features|hard.?features|chiseled)\b/i,
  hair: /\b(hair|bald|balding|shaved|buzz|crew.?cut|long.?hair|short.?hair|curly|straight|wavy|braided|dreadlocks|ponytail|blonde|brunette|redhead|grey|gray|silver|black.?hair|brown.?hair|auburn|receding)\b/i,
  skin: /\b(skin|complexion|dark.?skinned?|light.?skinned?|pale|tan|tanned|olive|freckled|weathered|scarred|tattooed|wrinkled)\b/i,
  clothing: /\b(clothing|clothes|wardrobe|suit|dress|uniform|jeans|shirt|jacket|coat|boots|shoes|hat|cap|scarf|tie|casual|formal|military|period|costume|attire|garb|outfit|utilitarian|plain|elegant)\b/i,
  posture: /\b(posture|stance|gait|hunched|upright|confident|slouch|rigid|relaxed|imposing|commanding)\b/i,
  vibe: /\b(vibe|energy|aura|presence|demeanor|intimidat|gentle|fierce|warm|cold|severe|aristocratic|resilient|tough|soft|charismatic|brooding|mysterious|approachable|aloof)\b/i,
  other: /./,
};

function detectCategory(text: string): TraitCategory {
  const lower = text.toLowerCase();
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (cat === 'other') continue;
    if (pattern.test(lower)) return cat as TraitCategory;
  }
  return 'other';
}

// ── Extraction ──

/**
 * Split a descriptive string into atomic trait phrases.
 * Handles comma-separated, semicolon-separated, and sentence fragments.
 */
function splitIntoTraitPhrases(text: string): string[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/[,;.\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 2 && s.length < 120)
    // Filter out structural/meta labels
    .filter(s => !/^(role|backstory|act\s|fatal\s|season|name|goals?|secrets?|relationships?)\b/i.test(s));
}

/**
 * Extract structured traits from canon character data.
 * Fields like traits, appearance, description, physical, age become SCRIPT-source traits.
 */
export function extractTraitsFromCanon(
  canonCharacter: Record<string, unknown> | null,
): CharacterTrait[] {
  if (!canonCharacter) return [];
  const traits: CharacterTrait[] = [];

  // Direct appearance fields → script source, high confidence, locked
  const scriptFields = ['appearance', 'physical', 'age', 'gender', 'ethnicity', 'build', 'hair', 'skin'];
  for (const field of scriptFields) {
    const val = canonCharacter[field];
    if (typeof val === 'string' && val.trim()) {
      for (const phrase of splitIntoTraitPhrases(val)) {
        traits.push({
          label: phrase,
          category: detectCategory(phrase),
          source: 'script',
          confidence: 'high',
          constraint: 'locked',
        });
      }
    }
  }

  // Traits field — may contain personality + physical mixed
  const traitsStr = String(canonCharacter.traits || '');
  if (traitsStr.trim()) {
    for (const phrase of splitIntoTraitPhrases(traitsStr)) {
      const cat = detectCategory(phrase);
      // Physical-category traits from traits field are script-locked
      const isPhysical = ['age', 'build', 'face', 'hair', 'skin', 'gender'].includes(cat);
      traits.push({
        label: phrase,
        category: cat,
        source: isPhysical ? 'script' : 'inferred',
        confidence: isPhysical ? 'high' : 'medium',
        constraint: isPhysical ? 'locked' : 'flexible',
      });
    }
  }

  // Description — visual cues extracted as script
  const desc = String(canonCharacter.description || '');
  if (desc.trim()) {
    for (const phrase of splitIntoTraitPhrases(desc)) {
      const cat = detectCategory(phrase);
      const isVisual = cat !== 'other' && cat !== 'vibe';
      traits.push({
        label: phrase,
        category: cat,
        source: isVisual ? 'script' : 'inferred',
        confidence: isVisual ? 'high' : 'medium',
        constraint: isVisual ? 'locked' : 'flexible',
      });
    }
  }

  return deduplicateTraits(traits);
}

/**
 * Derive traits from role/world context → inferred source.
 */
export function deriveTraitsFromContext(
  canonCharacter: Record<string, unknown> | null,
  canonJson: Record<string, unknown> | null,
): CharacterTrait[] {
  if (!canonCharacter && !canonJson) return [];
  const traits: CharacterTrait[] = [];

  // Role-based inferences
  const role = String(canonCharacter?.role || '').toLowerCase();
  if (role.includes('soldier') || role.includes('military') || role.includes('warrior')) {
    traits.push({ label: 'Military bearing', category: 'posture', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
    traits.push({ label: 'Athletic or combat-ready build', category: 'build', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
  }
  if (role.includes('aristocrat') || role.includes('royal') || role.includes('noble')) {
    traits.push({ label: 'Refined posture', category: 'posture', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
    traits.push({ label: 'Elegant attire', category: 'clothing', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
  }

  // World/period context
  const worldRules = String(canonJson?.world_rules || '').toLowerCase();
  const timeline = String(canonJson?.timeline || '').toLowerCase();
  if (worldRules.includes('medieval') || timeline.includes('medieval')) {
    traits.push({ label: 'Period-appropriate medieval clothing', category: 'clothing', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
  }
  if (worldRules.includes('futuristic') || worldRules.includes('sci-fi')) {
    traits.push({ label: 'Futuristic attire', category: 'clothing', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
  }

  return traits;
}

/**
 * Extract narrative-critical traits — traits that are plot-relevant.
 */
export function extractNarrativeTraits(
  canonCharacter: Record<string, unknown> | null,
): CharacterTrait[] {
  if (!canonCharacter) return [];
  const traits: CharacterTrait[] = [];

  // Look for narrative markers in various fields
  const searchFields = ['traits', 'description', 'appearance', 'physical', 'secrets', 'goals'];
  const narrativeMarkers = /\b(scar|wound|tattoo|missing|blind|limp|prosthetic|birthmark|distinctive|recognizable|memorable|iconic|signature|branded|marked|disfigured|hidden|concealed)\b/i;

  for (const field of searchFields) {
    const val = String(canonCharacter[field] || '');
    if (narrativeMarkers.test(val)) {
      for (const phrase of splitIntoTraitPhrases(val)) {
        if (narrativeMarkers.test(phrase)) {
          traits.push({
            label: phrase,
            category: detectCategory(phrase),
            source: 'narrative',
            confidence: 'high',
            constraint: 'protected',
          });
        }
      }
    }
  }

  return traits;
}

/**
 * Parse user identity notes into structured traits.
 */
export function parseUserNotes(notes: string): CharacterTrait[] {
  if (!notes || !notes.trim()) return [];
  return splitIntoTraitPhrases(notes).map(phrase => ({
    label: phrase,
    category: detectCategory(phrase),
    source: 'user' as TraitSource,
    confidence: 'medium' as TraitConfidence,
    constraint: 'user' as TraitConstraint,
  }));
}

// ── Deduplication ──

function deduplicateTraits(traits: CharacterTrait[]): CharacterTrait[] {
  const seen = new Map<string, CharacterTrait>();
  const SOURCE_PRIORITY: Record<TraitSource, number> = { script: 0, narrative: 1, inferred: 2, user: 3 };
  
  for (const t of traits) {
    const key = t.label.toLowerCase().trim();
    const existing = seen.get(key);
    if (!existing || SOURCE_PRIORITY[t.source] < SOURCE_PRIORITY[existing.source]) {
      seen.set(key, t);
    }
  }
  return Array.from(seen.values());
}

// ── Full Resolution ──

/**
 * Resolve all traits for a character from all sources.
 * Returns a deduplicated, source-tagged list.
 */
export function resolveCharacterTraits(
  canonCharacter: Record<string, unknown> | null,
  canonJson: Record<string, unknown> | null,
  userNotes: string,
): CharacterTrait[] {
  const scriptTraits = extractTraitsFromCanon(canonCharacter);
  const inferredTraits = deriveTraitsFromContext(canonCharacter, canonJson);
  const narrativeTraits = extractNarrativeTraits(canonCharacter);
  const userTraits = parseUserNotes(userNotes);

  const all = [...scriptTraits, ...narrativeTraits, ...inferredTraits, ...userTraits];
  return deduplicateTraits(all);
}

// ── Trait-Level Contradiction Detection ──

export interface TraitContradiction {
  userTrait: CharacterTrait;
  conflictsWith: CharacterTrait;
  severity: 'contradiction' | 'warning';
  message: string;
}

const CONTRADICTION_PAIRS: Array<{ a: RegExp; b: RegExp; category: TraitCategory }> = [
  { a: /\b(young|youthful|teen|child|kid)\b/i, b: /\b(old|elderly|aged|senior|mature|middle.?aged)\b/i, category: 'age' },
  { a: /\b(lean|thin|slim|slender|wiry|petite)\b/i, b: /\b(heavy|large|stocky|bulky|heavyset|stout)\b/i, category: 'build' },
  { a: /\b(tall|towering|lanky)\b/i, b: /\b(short|compact|petite)\b/i, category: 'build' },
  { a: /\b(masculine|male|rugged|bearded)\b/i, b: /\b(feminine|female|delicate)\b/i, category: 'gender' },
  { a: /\b(bald|balding|shaved)\b/i, b: /\b(long.?hair|flowing.?hair|braided|ponytail|curly.?hair)\b/i, category: 'hair' },
  { a: /\b(blonde|blond)\b/i, b: /\b(brunette|black.?hair|dark.?hair)\b/i, category: 'hair' },
  { a: /\b(pale|light.?skin)\b/i, b: /\b(dark.?skin|deeply.?tanned)\b/i, category: 'skin' },
];

/**
 * Detect trait-level contradictions between user traits and script/narrative traits.
 */
export function detectTraitContradictions(
  allTraits: CharacterTrait[],
): TraitContradiction[] {
  const userTraits = allTraits.filter(t => t.source === 'user');
  const authoritative = allTraits.filter(t => t.source === 'script' || t.source === 'narrative');
  
  if (userTraits.length === 0 || authoritative.length === 0) return [];

  const contradictions: TraitContradiction[] = [];

  for (const ut of userTraits) {
    for (const at of authoritative) {
      // Only compare same or related categories
      if (ut.category !== at.category) continue;

      for (const pair of CONTRADICTION_PAIRS) {
        if (pair.category !== ut.category) continue;
        const utLabel = ut.label.toLowerCase();
        const atLabel = at.label.toLowerCase();

        if ((pair.a.test(utLabel) && pair.b.test(atLabel)) ||
            (pair.b.test(utLabel) && pair.a.test(atLabel))) {
          contradictions.push({
            userTrait: ut,
            conflictsWith: at,
            severity: at.source === 'script' ? 'contradiction' : 'warning',
            message: `"${ut.label}" [USER] conflicts with "${at.label}" [${at.source.toUpperCase()}]`,
          });
        }
      }
    }
  }

  return contradictions;
}

// ── Prompt Formatting ──

const SOURCE_PRIORITY_ORDER: TraitSource[] = ['script', 'narrative', 'inferred', 'user'];

/**
 * Format traits into a structured prompt block for image generation.
 * Respects strict priority order: SCRIPT > NARRATIVE > INFERRED > USER.
 */
export function formatTraitsForPrompt(traits: CharacterTrait[]): string {
  const lines: string[] = ['[CHARACTER VISUAL TRAITS — SOURCE-TAGGED]'];

  for (const source of SOURCE_PRIORITY_ORDER) {
    const group = traits.filter(t => t.source === source);
    if (group.length === 0) continue;

    const label = source === 'script' ? 'SCRIPT (locked)' :
                  source === 'narrative' ? 'NARRATIVE (protected)' :
                  source === 'inferred' ? 'INFERRED (flexible)' :
                  'USER (guidance)';
    
    lines.push(`  ${label}:`);
    for (const t of group) {
      lines.push(`    - ${t.label} [${t.category}]`);
    }
  }

  return lines.join('\n');
}
