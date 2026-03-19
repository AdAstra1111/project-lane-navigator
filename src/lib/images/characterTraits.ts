/**
 * Character Trait Model — Structured, source-tagged VISUAL traits only.
 * 
 * VISUAL PURITY RULE: A trait is valid for Character Visual Identity
 * ONLY if it is directly renderable in an image.
 * 
 * Psychology, motivation, emotional conflict, and abstract role descriptors
 * are explicitly excluded from this system.
 */

// ── Types ──

export type TraitCategory = 'age' | 'gender' | 'build' | 'face' | 'hair' | 'skin' | 'clothing' | 'posture' | 'marker' | 'other';
export type TraitSource = 'script' | 'inferred' | 'narrative' | 'user' | 'evidence';
export type TraitConfidence = 'high' | 'medium' | 'low';
export type TraitConstraint = 'locked' | 'protected' | 'flexible' | 'user';

export interface CharacterTrait {
  label: string;
  category: TraitCategory;
  source: TraitSource;
  confidence: TraitConfidence;
  constraint: TraitConstraint;
}

// ── Binding Marker Types ──

export type MarkerType = 'tattoo' | 'scar' | 'wound' | 'prosthetic' | 'birthmark' | 'deformity' | 'glasses' | 'eyepatch' | 'missing_limb' | 'burn' | 'piercing' | 'branding' | 'accessory' | 'other';
export type MarkerStatus = 'detected' | 'pending_resolution' | 'approved' | 'rejected' | 'archived';

export interface BindingMarker {
  id: string;
  markerType: MarkerType;
  label: string;
  bodyRegion: string;
  laterality: 'left' | 'right' | 'center' | 'bilateral' | 'unknown';
  size: 'small' | 'medium' | 'large' | 'unknown';
  visibility: 'always_visible' | 'contextual' | 'covered' | 'unknown';
  attributes: Record<string, string>;
  status: MarkerStatus;
  requiresUserDecision: boolean;
  unresolvedFields: string[];
  confidence: TraitConfidence;
  evidenceSource: string;
  evidenceExcerpt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

/** Pattern registry for detecting binding markers from text */
const MARKER_PATTERNS: { pattern: RegExp; type: MarkerType; bodyRegionExtractor?: RegExp }[] = [
  { pattern: /\btattoo(?:ed|s)?\b/i, type: 'tattoo', bodyRegionExtractor: /(?:on|across|covering|over)\s+(?:his|her|their)?\s*([\w\s]+?)(?:\.|,|;|$)/i },
  { pattern: /\bscar(?:red|s)?\b/i, type: 'scar', bodyRegionExtractor: /(?:on|across|over)\s+(?:his|her|their)?\s*([\w\s]+?)(?:\.|,|;|$)/i },
  { pattern: /\b(?:wound|wounded|injury|injured)\b/i, type: 'wound' },
  { pattern: /\bprosthetic\b/i, type: 'prosthetic', bodyRegionExtractor: /prosthetic\s+([\w\s]+?)(?:\.|,|;|$)/i },
  { pattern: /\bbirthmark\b/i, type: 'birthmark' },
  { pattern: /\b(?:deform|disfigure)[a-z]*\b/i, type: 'deformity' },
  { pattern: /\b(?:glasses|spectacles|monocle)\b/i, type: 'glasses' },
  { pattern: /\beyepatch\b/i, type: 'eyepatch' },
  { pattern: /\b(?:missing\s+(?:arm|leg|hand|finger|eye|limb|ear))\b/i, type: 'missing_limb' },
  { pattern: /\b(?:burn(?:ed|s)?|burn\s+mark)\b/i, type: 'burn' },
  { pattern: /\b(?:piercing|pierced)\b/i, type: 'piercing' },
  { pattern: /\bbranded\b/i, type: 'branding' },
];

/**
 * Detect binding markers from a text string.
 * Returns candidate markers with resolution state.
 */
export function detectBindingMarkers(
  text: string,
  evidenceSource: string,
): BindingMarker[] {
  if (!text || !text.trim()) return [];
  const markers: BindingMarker[] = [];

  for (const { pattern, type, bodyRegionExtractor } of MARKER_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    let bodyRegion = 'unspecified';
    if (bodyRegionExtractor) {
      const regionMatch = text.match(bodyRegionExtractor);
      if (regionMatch?.[1]) {
        bodyRegion = regionMatch[1].trim().toLowerCase();
      }
    }

    let laterality: BindingMarker['laterality'] = 'unknown';
    const lateralityMatch = text.match(/\b(left|right)\b/i);
    if (lateralityMatch) {
      laterality = lateralityMatch[1].toLowerCase() as 'left' | 'right';
    }

    const unresolvedFields: string[] = [];
    if (laterality === 'unknown' && /arm|leg|hand|eye|ear|shoulder|cheek/i.test(bodyRegion)) {
      unresolvedFields.push('laterality');
    }
    if (bodyRegion === 'unspecified') {
      unresolvedFields.push('body_region');
    }

    const matchIndex = text.indexOf(match[0]);
    const excerptStart = Math.max(0, matchIndex - 40);
    const excerptEnd = Math.min(text.length, matchIndex + match[0].length + 60);
    const excerpt = text.slice(excerptStart, excerptEnd).trim();

    markers.push({
      id: `marker_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      markerType: type,
      label: `${type}${bodyRegion !== 'unspecified' ? ` on ${bodyRegion}` : ''}`,
      bodyRegion,
      laterality,
      size: 'unknown',
      visibility: 'always_visible',
      attributes: {},
      status: unresolvedFields.length > 0 ? 'pending_resolution' : 'detected',
      requiresUserDecision: unresolvedFields.length > 0,
      unresolvedFields,
      confidence: 'high',
      evidenceSource,
      evidenceExcerpt: excerpt.slice(0, 120),
      approvedAt: null,
      approvedBy: null,
    });
  }

  return markers;
}

/** Categories that are valid for visual identity */
const VISUAL_CATEGORIES: Set<TraitCategory> = new Set([
  'age', 'gender', 'build', 'face', 'hair', 'skin', 'clothing', 'posture', 'marker',
]);

// ── Non-Visual Rejection ──

/**
 * Phrases/keywords that indicate psychology, motivation, or narrative function.
 * These MUST be rejected from visual traits.
 */
const NON_VISUAL_PATTERNS = /\b(shrewd|calculating|conflicted|ambitious|brooding|strategic|loyal|guilty|manipulative|grief.?stricken|morally|cunning|ruthless|compassionate|vengeful|obsessed|haunted|tormented|desperate|determined|fearless|courageous|cowardly|jealous|bitter|resentful|trusting|suspicious|idealistic|pragmatic|naive|cynical|remorseful|prideful|humble|arrogant|empathetic|cold.?hearted|warm.?hearted|selfish|selfless|conflicted|motivated|driven|power.?hungry|ashamed|charismatic|enigmatic|mysterious|secretive|deceptive|honest|deceitful|protective|nurturing|volatile|explosive|patient|impatient|stubborn|flexible|resilient|fragile|complex|troubled|tormented|conflicted|repressed|suppressed|yearning|longing|restless|serene|turbulent|fierce|gentle|meek|domineering|submissive|rebellious|obedient|independent|dependent|reckless|cautious|impulsive|methodical|intuitive|analytical|emotional|stoic|passionate|indifferent|devoted|detached|sensitive|thick.?skinned|insecure|confident|paranoid|trusting|romantic|practical|sentimental|hardened|world.?weary|innocent|jaded|optimistic|pessimistic|fatalistic|hopeful|despairing|content|dissatisfied|grateful|ungrateful|forgiving|unforgiving|merciful|merciless|diplomatic|confrontational|aggressive|passive|assertive|timid|bold|shy|outgoing|withdrawn|sociable|antisocial|amiable|hostile|gracious|rude|polite|crude|eloquent|inarticulate|witty|dull|perceptive|oblivious|observant|absent.?minded|wise|foolish|learned|ignorant|sophisticated|simple|refined|vulgar|cultured|uncouth|pious|irreverent|devout|skeptical|spiritual|materialistic|principled|unprincipled|moral|immoral|ethical|unethical|just|unjust|fair|unfair|honorable|dishonorable|noble|ignoble|virtuous|corrupt|integrity|duplicity|sincerity|hypocrisy|authenticity|pretense)\b/i;

/**
 * Additional sentence-level patterns that indicate non-visual narrative content.
 */
const NON_VISUAL_SENTENCE_PATTERNS = /\b(wants to|needs to|struggles with|driven by|motivated by|torn between|haunted by|seeks|desires|fears|believes|knows that|must|should|feels|thinks|remembers|regrets|hopes|plans to|intends to|refuses to|willing to|unable to|forced to|chosen to|decides to|discovers|learns that|realizes|understands|conflicts with|loyal to|betrays|manipulates|deceives|controls|dominates|serves|obeys|defies|resists|opposes|supports|allies with|enemies|rivals|mentor|protégé|nemesis|foil|antagonist|protagonist|arc|journey|transformation|redemption|downfall|rise|fall|backstory|history|past|secret|hidden|concealed motivation|inner|internal|psycholog|emotional|mental|intellectual|moral|ethical|philosophical|ideological|political|social|cultural|religious|spiritual)\b/i;

/**
 * Hard filter: returns true ONLY if the phrase describes something visually renderable.
 */
function isVisuallyRenderable(phrase: string): boolean {
  const lower = phrase.toLowerCase().trim();
  
  // Reject if it matches non-visual psychology/narrative patterns
  if (NON_VISUAL_PATTERNS.test(lower)) return false;
  if (NON_VISUAL_SENTENCE_PATTERNS.test(lower)) return false;
  
  // Reject very long phrases (likely narrative sentences, not trait descriptors)
  if (lower.split(/\s+/).length > 8) return false;
  
  // Must match at least one visual category pattern
  return hasVisualContent(lower);
}

/**
 * Check if text contains any visually meaningful content.
 */
function hasVisualContent(text: string): boolean {
  return VISUAL_CONTENT_PATTERN.test(text);
}

const VISUAL_CONTENT_PATTERN = /\b(age|aged?|young|old|elderly|teen|teenager|child|kid|middle.?aged|mature|senior|youthful|twenties|thirties|forties|fifties|sixties|mid.?\d+s?|early.?\d+s?|late.?\d+s?|\d+.?years?.?old|male|female|woman|man|masculine|feminine|non.?binary|androgynous|lean|thin|slim|slender|wiry|heavy|large|stocky|muscular|bulky|heavyset|petite|athletic|tall|short|broad|narrow|towering|compact|lanky|stout|curvy|robust|face|facial|jaw|jawline|cheek|cheekbone|nose|eye|eyes|brow|forehead|chin|lip|lips|mouth|scar|freckle|dimple|wrinkle|angular|round.?face|oval|square|sharp.?features|soft.?features|hard.?features|chiseled|hair|bald|balding|shaved|buzz|crew.?cut|long.?hair|short.?hair|curly|straight|wavy|braided|dreadlocks|ponytail|blonde|brunette|redhead|grey|gray|silver|black.?hair|brown.?hair|auburn|receding|skin|complexion|dark.?skinned?|light.?skinned?|pale|tan|tanned|olive|freckled|weathered|scarred|tattooed|wrinkled|clothing|clothes|wardrobe|suit|dress|uniform|jeans|shirt|jacket|coat|boots|shoes|hat|cap|scarf|tie|casual|formal|military|period|costume|attire|garb|outfit|utilitarian|plain|elegant|posture|stance|gait|hunched|upright|slouch|rigid|relaxed|imposing|commanding|bearing|scar|wound|tattoo|missing|blind|limp|prosthetic|birthmark|distinctive|disfigured|patch|hook|cane|wheelchair|glasses|spectacles|monocle|beard|moustache|mustache|goatee|stubble|clean.?shaven|piercing|earring|ring|necklace|bracelet|watch|gloves|apron|armor|armour|robes|cloak|cape|hood|veil|mask|bandage|bandana|headband|turban|crown|tiara|helmet|visor)\b/i;

// ── Category Detection (visual categories only) ──

const CATEGORY_PATTERNS: Record<Exclude<TraitCategory, 'other'>, RegExp> = {
  age: /\b(age|aged?|young|old|elderly|teen|teenager|child|kid|middle.?aged|mature|senior|youthful|twenties|thirties|forties|fifties|sixties|mid.?\d+s?|early.?\d+s?|late.?\d+s?|\d+.?years?.?old)\b/i,
  gender: /\b(male|female|woman|man|masculine|feminine|non.?binary|androgynous|gender|he\/him|she\/her|they\/them)\b/i,
  build: /\b(lean|thin|slim|slender|wiry|heavy|large|stocky|muscular|bulky|heavyset|petite|athletic|tall|short|broad|narrow|towering|compact|lanky|stout|curvy|robust)\b/i,
  face: /\b(face|facial|jaw|jawline|cheek|cheekbone|nose|eye|eyes|brow|forehead|chin|lip|lips|mouth|freckle|dimple|wrinkle|angular|round.?face|oval|square|sharp|soft.?features|hard.?features|chiseled)\b/i,
  hair: /\b(hair|bald|balding|shaved|buzz|crew.?cut|long.?hair|short.?hair|curly|straight|wavy|braided|dreadlocks|ponytail|blonde|brunette|redhead|grey|gray|silver|black.?hair|brown.?hair|auburn|receding|beard|moustache|mustache|goatee|stubble|clean.?shaven)\b/i,
  skin: /\b(skin|complexion|dark.?skinned?|light.?skinned?|pale|tan|tanned|olive|freckled|weathered|wrinkled)\b/i,
  clothing: /\b(clothing|clothes|wardrobe|suit|dress|uniform|jeans|shirt|jacket|coat|boots|shoes|hat|cap|scarf|tie|casual|formal|military|period|costume|attire|garb|outfit|utilitarian|plain|elegant|armor|armour|robes|cloak|cape|hood|veil|mask|apron|gloves)\b/i,
  posture: /\b(posture|stance|gait|hunched|upright|slouch|rigid|relaxed|imposing|commanding|bearing)\b/i,
  marker: /\b(scar|wound|tattoo|tattooed|missing|blind|limp|prosthetic|birthmark|disfigured|scarred|patch|hook|cane|wheelchair|glasses|spectacles|monocle|piercing|earring|bandage|bandana)\b/i,
};

function detectCategory(text: string): TraitCategory {
  const lower = text.toLowerCase();
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (pattern.test(lower)) return cat as TraitCategory;
  }
  return 'other';
}

// ── Extraction ──

/**
 * Split a descriptive string into atomic trait phrases.
 */
function splitIntoTraitPhrases(text: string): string[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/[,;.\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 2 && s.length < 80)
    // Filter out structural/meta labels
    .filter(s => !/^(role|backstory|act\s|fatal\s|season|name|goals?|secrets?|relationships?)\b/i.test(s));
}

/**
 * Extract structured VISUAL traits from canon character data.
 * Only visually renderable phrases survive.
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
        if (!isVisuallyRenderable(phrase)) continue;
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

  // Traits field — ONLY extract visually renderable content
  const traitsStr = String(canonCharacter.traits || '');
  if (traitsStr.trim()) {
    for (const phrase of splitIntoTraitPhrases(traitsStr)) {
      if (!isVisuallyRenderable(phrase)) continue;
      const cat = detectCategory(phrase);
      if (!VISUAL_CATEGORIES.has(cat)) continue;
      traits.push({
        label: phrase,
        category: cat,
        source: 'script',
        confidence: 'high',
        constraint: 'locked',
      });
    }
  }

  // Description — ONLY extract visually renderable content
  const desc = String(canonCharacter.description || '');
  if (desc.trim()) {
    for (const phrase of splitIntoTraitPhrases(desc)) {
      if (!isVisuallyRenderable(phrase)) continue;
      const cat = detectCategory(phrase);
      if (!VISUAL_CATEGORIES.has(cat)) continue;
      traits.push({
        label: phrase,
        category: cat,
        source: 'script',
        confidence: 'high',
        constraint: 'locked',
      });
    }
  }

  return deduplicateTraits(traits);
}

/**
 * Derive VISUAL traits from role/world context → inferred source.
 */
export function deriveTraitsFromContext(
  canonCharacter: Record<string, unknown> | null,
  canonJson: Record<string, unknown> | null,
): CharacterTrait[] {
  if (!canonCharacter && !canonJson) return [];
  const traits: CharacterTrait[] = [];

  // Role-based visual inferences only
  const role = String(canonCharacter?.role || '').toLowerCase();
  if (role.includes('soldier') || role.includes('military') || role.includes('warrior')) {
    traits.push({ label: 'Military bearing', category: 'posture', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
    traits.push({ label: 'Athletic or combat-ready build', category: 'build', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
  }
  if (role.includes('aristocrat') || role.includes('royal') || role.includes('noble')) {
    traits.push({ label: 'Refined upright posture', category: 'posture', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
    traits.push({ label: 'Elegant formal attire', category: 'clothing', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
  }
  if (role.includes('doctor') || role.includes('scientist') || role.includes('professor')) {
    traits.push({ label: 'Professional attire', category: 'clothing', source: 'inferred', confidence: 'low', constraint: 'flexible' });
  }
  if (role.includes('laborer') || role.includes('farmer') || role.includes('worker')) {
    traits.push({ label: 'Worn utilitarian clothing', category: 'clothing', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
    traits.push({ label: 'Weathered complexion', category: 'skin', source: 'inferred', confidence: 'low', constraint: 'flexible' });
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
  if (worldRules.includes('victorian') || timeline.includes('victorian')) {
    traits.push({ label: 'Victorian-era clothing', category: 'clothing', source: 'inferred', confidence: 'medium', constraint: 'flexible' });
  }

  return traits;
}

/**
 * Extract narrative-critical VISIBLE markers only.
 * Only traits with a direct physical manifestation qualify.
 * Psychology, motivation, and abstract narrative function are excluded.
 */
export function extractNarrativeTraits(
  canonCharacter: Record<string, unknown> | null,
): CharacterTrait[] {
  if (!canonCharacter) return [];
  const traits: CharacterTrait[] = [];

  // ONLY search fields that may contain visible markers
  const searchFields = ['traits', 'description', 'appearance', 'physical'];
  const visibleNarrativeMarkers = /\b(scar|wound|tattoo|tattooed|missing|blind|limp|prosthetic|birthmark|distinctive|disfigured|branded|marked|patch|hook|cane|wheelchair|glasses|spectacles|bandage)\b/i;

  for (const field of searchFields) {
    const val = String(canonCharacter[field] || '');
    if (visibleNarrativeMarkers.test(val)) {
      for (const phrase of splitIntoTraitPhrases(val)) {
        if (!visibleNarrativeMarkers.test(phrase)) continue;
        if (!isVisuallyRenderable(phrase)) continue;
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

  return traits;
}

/**
 * Parse user identity notes into structured VISUAL traits.
 * Non-visual phrases are filtered out.
 */
export function parseUserNotes(notes: string): CharacterTrait[] {
  if (!notes || !notes.trim()) return [];
  return splitIntoTraitPhrases(notes)
    .filter(phrase => isVisuallyRenderable(phrase))
    .map(phrase => ({
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
  const SOURCE_PRIORITY: Record<TraitSource, number> = { script: 0, narrative: 1, inferred: 2, user: 3, evidence: 4 };
  
  for (const t of traits) {
    const key = t.label.toLowerCase().trim();
    const existing = seen.get(key);
    if (!existing || SOURCE_PRIORITY[t.source] < SOURCE_PRIORITY[existing.source]) {
      seen.set(key, t);
    }
  }
  return Array.from(seen.values());
}

// ── Full Resolution (VISUAL TRAITS ONLY) ──

/**
 * Resolve all VISUAL traits for a character from all sources.
 * Returns a deduplicated, source-tagged list of ONLY visually renderable traits.
 * Non-visual content (psychology, motivation, narrative function) is excluded.
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
  // Final safety filter: only visual categories
  const visualOnly = all.filter(t => VISUAL_CATEGORIES.has(t.category));
  return deduplicateTraits(visualOnly);
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
 * Detect trait-level contradictions between user VISUAL traits and authoritative VISUAL traits.
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

// ── Prompt Formatting (VISUAL ONLY) ──

const SOURCE_PRIORITY_ORDER: TraitSource[] = ['script', 'narrative', 'inferred', 'user'];

/**
 * Format VISUAL traits into a structured prompt block for image generation.
 * Only visually renderable traits are included.
 * Respects strict priority order: BINDING MARKERS > SCRIPT > NARRATIVE > INFERRED > USER.
 */
export function formatTraitsForPrompt(traits: CharacterTrait[], bindingMarkers?: BindingMarker[]): string {
  const visualTraits = traits.filter(t => VISUAL_CATEGORIES.has(t.category));
  
  const lines: string[] = ['[CHARACTER VISUAL TRAITS — SOURCE-TAGGED, VISUALLY RENDERABLE ONLY]'];

  // Inject approved binding markers FIRST — highest enforcement priority
  const approvedMarkers = (bindingMarkers || []).filter(m => m.status === 'approved');
  if (approvedMarkers.length > 0) {
    lines.push('  BINDING MARKERS (MANDATORY — must appear when body region visible):');
    for (const m of approvedMarkers) {
      const lateralStr = m.laterality !== 'unknown' ? ` (${m.laterality})` : '';
      const regionStr = m.bodyRegion !== 'unspecified' ? ` on ${m.bodyRegion}` : '';
      lines.push(`    - ${m.markerType.toUpperCase()}${regionStr}${lateralStr} — MUST be present if region is visible`);
    }
  }

  if (visualTraits.length === 0 && approvedMarkers.length === 0) return '';

  for (const source of SOURCE_PRIORITY_ORDER) {
    const group = visualTraits.filter(t => t.source === source);
    if (group.length === 0) continue;

    const label = source === 'script' ? 'SCRIPT (locked — from source material)' :
                  source === 'narrative' ? 'NARRATIVE (protected — visible story markers)' :
                  source === 'inferred' ? 'INFERRED (flexible — derived from role/world)' :
                  'USER (guidance — supplementary visual notes)';
    
    lines.push(`  ${label}:`);
    for (const t of group) {
      lines.push(`    - ${t.label} [${t.category}]`);
    }
  }

  return lines.join('\n');
}
