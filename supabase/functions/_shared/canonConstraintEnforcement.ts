/**
 * Canon Constraint Enforcement (CCE) — Phase 2
 *
 * Anti-drift architecture for IFFY. Ensures downstream document generation
 * cannot silently mutate canonical project truth.
 *
 * Three responsibilities:
 *   1. extractCanonConstraints() — deterministic extraction from canon_json
 *   2. buildCanonConstraintBlock() — prompt injection block for LLM generation
 *   3. detectCanonDrift() — post-generation semantic validation against constraints
 *
 * INVARIANTS:
 *   - Deterministic: same canon → same constraints → same drift results
 *   - Single source of truth: canon_json from project_canon (via narrativeContextResolver)
 *   - No silent fallbacks: drift always surfaces explicitly
 *   - No duplicated logic: this module is the sole authority for constraint enforcement
 *
 * Phase 2 upgrades:
 *   - Semantic fact extraction from generated text (not just name presence)
 *   - Protagonist role/profession/background contradiction detection
 *   - Relationship meaning drift (not just character name presence)
 *   - Graduated world-rule escalation detection
 *   - Active tone classification comparison
 *   - Core incident fact contradiction detection
 *   - Forbidden change active checking
 *   - All findings include canonical_expected + observed_conflict
 */

// ── Types ──

export interface CanonConstraints {
  /** Protagonist identity facts */
  protagonist: {
    name: string | null;
    role: string | null;
    profession: string | null;
    background: string | null;
  };
  /** Key relationship facts — pairs of (character, relationship) */
  relationships: Array<{ character: string; relation: string }>;
  /** World rule classification */
  worldRuleMode: {
    supernatural: "none" | "ambiguous" | "present" | "unknown";
    rules: string[];
  };
  /** Tone classification */
  toneClass: string | null;
  /** Core incident / inciting event facts */
  coreIncidentFacts: string[];
  /** Hard "must not change" facts from canon */
  forbiddenChanges: string[];
  /** All canonical character names (for identity anchor) */
  canonicalCharacterNames: string[];
  /** Logline / premise as identity anchor */
  logline: string | null;
  premise: string | null;
  /** Extraction provenance */
  extractedFrom: "canon_json" | "empty";
  extractedAt: string;
}

export interface DriftFinding {
  domain: "identity" | "relationship" | "world_rule" | "tone" | "core_event" | "scope_escalation" | "forbidden_change";
  severity: "warning" | "violation";
  detail: string;
  evidence: string;
  /** What canon says */
  canonical_expected?: string;
  /** What the generated text asserts */
  observed_conflict?: string;
}

export interface DriftResult {
  passed: boolean;
  findings: DriftFinding[];
  constraintsUsed: boolean;
  checkedAt: string;
  domains_checked: string[];
}

// ── Constants ──

const SUPERNATURAL_KEYWORDS = [
  "ghost", "spirit", "demon", "angel", "magic", "spell", "curse", "prophecy",
  "supernatural", "paranormal", "telekinesis", "psychic", "witch", "wizard",
  "vampire", "werewolf", "zombie", "undead", "possession", "exorcism",
  "shapeshif", "teleport", "immortal", "resurrection", "afterlife",
  "reincarnation", "divine", "miracle", "sorcery", "enchant",
];

const SCOPE_ESCALATION_PATTERNS = [
  /\b(ancient prophecy|chosen one|destined to|the prophecy)\b/i,
  /\b(save the world|fate of (?:the )?(?:universe|humanity|mankind|civilization))\b/i,
  /\b(global conspiracy|secret society|illuminati|shadow government)\b/i,
  /\b(interdimensional|multiverse|parallel (?:universe|dimension|world))\b/i,
  /\b(alien invasion|extraterrestrial|first contact)\b/i,
  /\b(nuclear (?:war|apocalypse|launch)|world war|genocide)\b/i,
  /\b(superpower|superhuman|supernatur)\b/i,
];

/** Profession/role extraction patterns for generated text analysis */
const PROFESSION_PATTERNS = [
  /\b(?:works? as|is|was|becomes?|serves? as|employed as|practicing|retired)\s+(?:an?\s+)?([a-z][a-z\s-]{2,30}?)(?:[.,;:!?\s—\-]|who\b|that\b|and\b|but\b|with\b|\bin\b)/gi,
  /\b(?:profession|occupation|job|career|calling|trade|vocation)[:\s]+([a-z][a-z\s-]{2,30}?)(?:[.,;:!?\n])/gi,
];

/** Relationship type keywords for semantic comparison */
const RELATIONSHIP_TYPES: Record<string, string[]> = {
  parent: ["father", "mother", "dad", "mom", "parent", "papa", "mama", "mum", "daddy", "mommy"],
  child: ["son", "daughter", "child", "kid", "offspring", "boy", "girl"],
  sibling: ["brother", "sister", "sibling", "twin"],
  spouse: ["husband", "wife", "spouse", "partner", "married", "fiancé", "fiancee", "betrothed"],
  romantic: ["lover", "girlfriend", "boyfriend", "romantic", "affair", "love interest", "ex-girlfriend", "ex-boyfriend"],
  friend: ["friend", "companion", "ally", "confidant", "confidante", "best friend", "mate"],
  enemy: ["enemy", "rival", "nemesis", "antagonist", "adversary", "foe", "opponent"],
  mentor: ["mentor", "teacher", "master", "guide", "instructor", "tutor"],
  professional: ["colleague", "boss", "employee", "coworker", "partner", "associate", "client", "patient"],
};

/** Tone register keywords */
const TONE_REGISTERS: Record<string, string[]> = {
  dark: ["dark", "bleak", "grim", "harrowing", "brutal", "unflinching", "stark", "noir", "nihilistic"],
  light: ["light", "comedic", "playful", "whimsical", "fun", "upbeat", "cheerful", "breezy"],
  tense: ["tense", "suspenseful", "thriller", "gripping", "pulse-pounding", "edge-of-seat"],
  dramatic: ["dramatic", "emotional", "poignant", "heartfelt", "moving", "intense", "passionate"],
  satirical: ["satirical", "ironic", "sardonic", "darkly comic", "black comedy", "absurdist", "wry"],
  lyrical: ["lyrical", "poetic", "meditative", "contemplative", "ethereal", "dreamlike"],
  grounded: ["grounded", "realistic", "naturalistic", "restrained", "understated", "observational"],
};

// ── Helper: Sentence extraction around a name ──

function extractSentencesAround(text: string, keyword: string, windowChars = 400): string[] {
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const results: string[] = [];
  let idx = 0;
  while (true) {
    const pos = lower.indexOf(kw, idx);
    if (pos === -1) break;
    const start = Math.max(0, pos - windowChars);
    const end = Math.min(text.length, pos + kw.length + windowChars);
    const chunk = text.slice(start, end);
    // Extract sentences containing the keyword
    const sentences = chunk.split(/[.!?\n]+/).filter(s => s.toLowerCase().includes(kw));
    results.push(...sentences.map(s => s.trim()).filter(Boolean));
    idx = pos + kw.length;
  }
  return results;
}

/** Extract what role/profession the text asserts for a named character */
function extractAssertedProfessions(text: string, charName: string): string[] {
  const sentences = extractSentencesAround(text, charName, 300);
  const context = sentences.join(". ").toLowerCase();
  const professions: string[] = [];
  
  for (const pat of PROFESSION_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(context)) !== null) {
      const prof = m[1].trim().toLowerCase();
      // Filter structural noise
      if (prof.length > 2 && prof.length < 35 && !prof.match(/^(the|this|that|very|quite|also|even|just|still|yet|been|being|would|could|should|going|having|looking|trying|about|after|before|since|while|where|which|their|there|these|those|every|other|another|anyone|someone|everyone|not|actually|now|then|once|already|really|truly|merely|simply|perhaps|possibly|seemingly|apparently|destined|forced|caught|torn|chosen|doomed|collapsing|revealed|discovered|supposed|meant|said|told|known|thought|believed)$/)) {
        professions.push(prof);
      }
    }
  }
  return [...new Set(professions)];
}

/** Classify the relationship type from free text */
function classifyRelationshipType(relText: string): string[] {
  const lower = relText.toLowerCase();
  const types: string[] = [];
  for (const [type, keywords] of Object.entries(RELATIONSHIP_TYPES)) {
    if (keywords.some(k => lower.includes(k))) {
      types.push(type);
    }
  }
  return types;
}

/** Check if two relationship type sets are contradictory */
function areRelationshipsContradictory(canonTypes: string[], observedTypes: string[]): { contradicts: boolean; reason: string } {
  if (canonTypes.length === 0 || observedTypes.length === 0) return { contradicts: false, reason: "" };
  
  // Contradictory pairs: if canon says X, observed saying Y is a contradiction
  const contradictions: [string, string][] = [
    ["parent", "child"], // parent becoming child or vice versa is wrong direction, but parent↔child could mean the rel is described from either side
    ["spouse", "sibling"], 
    ["friend", "enemy"],
    ["parent", "spouse"],
    ["parent", "romantic"],
    ["sibling", "romantic"],
    ["sibling", "spouse"],
    ["child", "spouse"],
    ["child", "romantic"],
    ["mentor", "child"],
  ];
  
  for (const ct of canonTypes) {
    for (const ot of observedTypes) {
      if (ct === ot) continue; // Same type, no contradiction
      for (const [a, b] of contradictions) {
        if ((ct === a && ot === b) || (ct === b && ot === a)) {
          return { contradicts: true, reason: `Canon: ${ct}, Observed: ${ot}` };
        }
      }
    }
  }
  return { contradicts: false, reason: "" };
}

/** Extract the dominant supernatural classification from generated text */
function classifyGeneratedSupernatural(text: string): { level: "none" | "ambiguous" | "present"; keywords: string[]; confirmations: string[] } {
  const lower = text.toLowerCase();
  const found = SUPERNATURAL_KEYWORDS.filter(k => lower.includes(k));
  
  // Look for disambiguation/confirmation patterns
  const confirmPatterns = [
    /\b(?:the ghost (?:is|was) real)\b/i,
    /\b(?:confirmed to be supernatural)\b/i,
    /\b(?:is actually (?:a |an )?(?:ghost|spirit|demon|angel|witch|wizard))\b/i,
    /\b(?:reveals? (?:their|his|her) (?:true |supernatural )?(?:powers?|abilities|nature))\b/i,
    /\b(?:(?:uses?|unleash(?:es)?|summon(?:s)?) (?:their |his |her )?(?:magic|powers?|supernatural abilities))\b/i,
    /\b(?:transforms? into|shapeshifts? into|teleports? (?:to|away|across))\b/i,
    /\b(?:casts? (?:a )?spell|performs? (?:a )?ritual|invokes? (?:the )?(?:spirits?|dead|demon))\b/i,
    /\b(?:risen? from the dead|comes? back to life|returns? from (?:the )?(?:dead|grave|afterlife))\b/i,
    /\b(?:the (?:curse|prophecy|spell) (?:is|was|proves?) real)\b/i,
    /\b(?:truly haunted|actual(?:ly)? possessed|genuine(?:ly)? supernatural)\b/i,
  ];
  
  // Look for ambiguity-preserving patterns
  const ambiguousPatterns = [
    /\b(?:might be|could be|possibly|perhaps|seemingly|apparently|allegedly)\s+(?:supernatural|haunted|cursed|magical|possessed)\b/i,
    /\b(?:imagin(?:es?|ing|ation)|hallucin(?:ates?|ation)|delusion|psycho(?:sis|logical|somatic))\b/i,
    /\b(?:or (?:is it|was it|could it be)\s+(?:just|merely|simply))\b/i,
    /\b(?:rational explanation|logical explanation|explained by|attribut(?:es?|ed) to)\b/i,
  ];
  
  const confirmations: string[] = [];
  for (const pat of confirmPatterns) {
    const m = text.match(pat);
    if (m) confirmations.push(m[0]);
  }
  
  const hasAmbiguity = ambiguousPatterns.some(p => p.test(text));
  
  if (confirmations.length > 0 && !hasAmbiguity) return { level: "present", keywords: found, confirmations };
  if (found.length >= 3 && !hasAmbiguity) return { level: "present", keywords: found, confirmations };
  if (found.length >= 1 || confirmations.length > 0) return { level: "ambiguous", keywords: found, confirmations };
  return { level: "none", keywords: found, confirmations };
}

/** Classify the dominant tone register of a text */
function classifyToneRegister(text: string): string[] {
  const lower = text.toLowerCase();
  const scores: [string, number][] = [];
  
  for (const [register, keywords] of Object.entries(TONE_REGISTERS)) {
    const count = keywords.reduce((sum, k) => sum + (lower.split(k).length - 1), 0);
    if (count > 0) scores.push([register, count]);
  }
  
  scores.sort((a, b) => b[1] - a[1]);
  return scores.slice(0, 3).map(([r]) => r);
}

/** Check if observed tone contradicts canonical tone */
function isToneContradiction(canonTone: string, observedRegisters: string[]): { contradicts: boolean; reason: string } {
  const canonLower = canonTone.toLowerCase();
  
  // Map canon tone descriptions to expected registers
  const canonRegisters = classifyToneRegister(canonTone);
  
  // Check for hard contradictions
  const toneContradictions: [string[], string[]][] = [
    [["dark", "grim", "bleak"], ["light", "comedic", "playful", "whimsical"]],
    [["light", "comedic", "playful"], ["dark", "bleak", "grim", "noir", "nihilistic"]],
    [["grounded", "realistic", "naturalistic"], ["whimsical", "fantastical", "dreamlike"]],
    [["tense", "suspenseful"], ["breezy", "light", "playful"]],
  ];
  
  for (const [canonGroup, conflictGroup] of toneContradictions) {
    const canonMatch = canonGroup.some(t => canonLower.includes(t));
    const observedMatch = observedRegisters.some(r => conflictGroup.includes(r));
    if (canonMatch && observedMatch) {
      return { contradicts: true, reason: `Canon tone "${canonTone}" conflicts with observed registers: ${observedRegisters.join(", ")}` };
    }
  }
  
  return { contradicts: false, reason: "" };
}

/** Check if a canonical fact is contradicted in generated text */
function checkFactContradiction(generatedText: string, canonFact: string): { contradicted: boolean; evidence: string } {
  // Extract key entities/assertions from the canonical fact
  const factLower = canonFact.toLowerCase();
  const textLower = generatedText.toLowerCase();
  
  // Extract subject-verb-object triples from fact (simple heuristic)
  // Look for negation of key fact elements
  const factWords = factLower.split(/\s+/).filter(w => w.length > 3);
  const keyNouns = factWords.filter(w => !w.match(/^(that|this|with|from|into|have|been|were|when|what|which|where|there|their|these|those|about|after|before|could|would|should|being|having|doing|going|other|another|every|never|always|often|still|also|just|even|very|much|many|some|such|most|only|than|more|less|each|both)$/));
  
  if (keyNouns.length < 2) return { contradicted: false, evidence: "" };
  
  // Check if text contains negation or replacement of key fact elements
  // e.g., "X is NOT a Y" when canon says "X is a Y"
  const negationPatterns = [
    /\b(?:not|never|no longer|isn't|wasn't|aren't|weren't|hasn't|haven't|hadn't|doesn't|didn't|won't|wouldn't|can't|couldn't|shouldn't)\b/i,
  ];
  
  // Get sentences containing at least 2 key nouns from the fact
  const sentences = generatedText.split(/[.!?\n]+/);
  for (const sentence of sentences) {
    const sentLower = sentence.toLowerCase();
    const matchedNouns = keyNouns.filter(n => sentLower.includes(n));
    if (matchedNouns.length >= 2) {
      // This sentence references the same entities as the fact
      // Check for negation
      const hasNegation = negationPatterns.some(p => p.test(sentence));
      if (hasNegation) {
        return { contradicted: true, evidence: sentence.trim().slice(0, 200) };
      }
    }
  }
  
  return { contradicted: false, evidence: "" };
}

/** Check if a specific fact from forbidden_changes is violated */
function checkForbiddenChangeViolation(text: string, forbiddenFact: string): { violated: boolean; evidence: string } {
  const factLower = forbiddenFact.toLowerCase();
  const textLower = text.toLowerCase();
  
  // Parse the forbidden change to understand what must NOT change
  // Common patterns: "X must remain Y", "do not change X", "X stays Y", "never alter X"
  const preservePatterns = [
    /(?:must (?:remain|stay|be|keep)|always (?:is|be|remains?)|do not (?:change|alter|modify|remove)|never (?:change|alter|modify|remove))\s+(.+)/i,
    /(.+?)(?:\s+must not\s+|\s+cannot\s+|\s+should not\s+)(?:change|be changed|be altered|be modified)/i,
  ];
  
  let protectedSubject: string | null = null;
  for (const pat of preservePatterns) {
    const m = forbiddenFact.match(pat);
    if (m) { protectedSubject = m[1].trim().toLowerCase(); break; }
  }
  
  // If we can't parse the forbidden change, do negation check
  if (!protectedSubject) {
    const fc = checkFactContradiction(text, forbiddenFact);
    return { violated: fc.contradicted, evidence: fc.evidence };
  }
  
  // Check if the protected subject's state has been altered
  const sentences = text.split(/[.!?\n]+/);
  for (const s of sentences) {
    const sLower = s.toLowerCase();
    if (sLower.includes(protectedSubject.slice(0, 20))) {
      // Found reference to protected subject — check for state change language
      if (/\b(now|becomes?|changed|turned|transformed|no longer|formerly|once was|used to be|switched|converted|evolved|shifted)\b/i.test(s)) {
        return { violated: true, evidence: s.trim().slice(0, 200) };
      }
    }
  }
  
  return { violated: false, evidence: "" };
}

// ── 1. Constraint Extraction ──

/**
 * Extract canonical constraints from canon_json.
 * Deterministic: same input → same output.
 */
export function extractCanonConstraints(
  canonJson: Record<string, unknown>,
): CanonConstraints {
  const characters = Array.isArray(canonJson.characters) ? canonJson.characters : [];
  const protagonist = findProtagonist(characters);

  // Relationships — extract from explicit relationships field, role field, and description
  const relationships: CanonConstraints["relationships"] = [];
  const protagonistName = protagonist.name || "";
  for (const char of characters) {
    const c = char as Record<string, any>;
    const charName = c.name || "unknown";
    
    // Explicit relationships field
    if (c.relationships && typeof c.relationships === "string") {
      relationships.push({ character: charName, relation: c.relationships });
    }
    
    // Derive relationship from role field (e.g., "Love Interest", "Hana's Handler", "Mentor")
    const role = (c.role || "") as string;
    if (role && charName !== protagonistName) {
      const roleLower = role.toLowerCase();
      // Check for relationship-indicating keywords in role
      const relIndicators = [
        { pattern: /love interest/i, relation: `love interest / romantic partner of ${protagonistName}` },
        { pattern: /handler/i, relation: `handler / supervisor of ${protagonistName}` },
        { pattern: /mentor/i, relation: `mentor to ${protagonistName}` },
        { pattern: /(?:mother|father|parent|dad|mom)\b/i, relation: `parent of ${protagonistName}` },
        { pattern: /(?:brother|sister|sibling)\b/i, relation: `sibling of ${protagonistName}` },
        { pattern: /(?:husband|wife|spouse)\b/i, relation: `spouse of ${protagonistName}` },
        { pattern: /(?:friend|companion|ally)\b/i, relation: `friend / ally of ${protagonistName}` },
        { pattern: /(?:rival|enemy|nemesis|antagonist|adversary)\b/i, relation: `antagonist / rival of ${protagonistName}` },
      ];
      for (const { pattern, relation } of relIndicators) {
        if (pattern.test(roleLower)) {
          relationships.push({ character: charName, relation });
          break;
        }
      }
    }
    
    // Derive from description mentioning protagonist by name
    const desc = (c.description || "") as string;
    if (desc && protagonistName && desc.toLowerCase().includes(protagonistName.toLowerCase())) {
      // Already captured via role? Check if we have this character
      const alreadyCaptured = relationships.some(r => r.character === charName);
      if (!alreadyCaptured) {
        // Extract relationship description near protagonist name
        const sentences = desc.split(/[.!]+/).filter(s => s.toLowerCase().includes(protagonistName.toLowerCase()));
        if (sentences.length > 0) {
          relationships.push({ character: charName, relation: sentences[0].trim() });
        }
      }
    }
  }

  // World rule mode
  const worldRules: string[] = [];
  if (Array.isArray(canonJson.world_rules)) {
    worldRules.push(...(canonJson.world_rules as string[]).filter(r => typeof r === "string"));
  } else if (typeof canonJson.world_rules === "string" && (canonJson.world_rules as string).trim()) {
    worldRules.push(canonJson.world_rules as string);
  }

  const supernaturalMode = classifySupernatural(worldRules, canonJson);

  // Tone
  const toneClass = (canonJson.tone as string) || (canonJson.tone_style as string) || null;

  // Core incident facts from premise/logline
  const coreIncidentFacts: string[] = [];
  if (canonJson.premise && typeof canonJson.premise === "string") {
    coreIncidentFacts.push(canonJson.premise as string);
  }
  if (canonJson.logline && typeof canonJson.logline === "string") {
    coreIncidentFacts.push(canonJson.logline as string);
  }

  // Forbidden changes
  const forbiddenChanges: string[] = [];
  if (Array.isArray(canonJson.forbidden_changes)) {
    forbiddenChanges.push(...(canonJson.forbidden_changes as string[]).filter(f => typeof f === "string"));
  } else if (typeof canonJson.forbidden_changes === "string" && (canonJson.forbidden_changes as string).trim()) {
    forbiddenChanges.push(canonJson.forbidden_changes as string);
  }

  const canonicalCharacterNames = characters
    .map((c: any) => c.name)
    .filter((n: any) => typeof n === "string" && n.trim());

  const hasContent = !!(
    protagonist.name || relationships.length > 0 || worldRules.length > 0 ||
    toneClass || coreIncidentFacts.length > 0 || canonicalCharacterNames.length > 0
  );

  return {
    protagonist,
    relationships,
    worldRuleMode: { supernatural: supernaturalMode, rules: worldRules },
    toneClass,
    coreIncidentFacts,
    forbiddenChanges,
    canonicalCharacterNames,
    logline: (canonJson.logline as string) || null,
    premise: (canonJson.premise as string) || null,
    extractedFrom: hasContent ? "canon_json" : "empty",
    extractedAt: new Date().toISOString(),
  };
}

function findProtagonist(characters: unknown[]): CanonConstraints["protagonist"] {
  const result = { name: null as string | null, role: null as string | null, profession: null as string | null, background: null as string | null };
  for (const char of characters) {
    const c = char as Record<string, any>;
    const role = (c.role || "").toLowerCase();
    if (role.includes("protagonist") || role.includes("lead") || role.includes("main character") || role.includes("hero")) {
      result.name = c.name || null;
      result.role = c.role || null;
      const detail = [c.traits, c.goals, c.description].filter(Boolean).join(" ");
      result.profession = extractProfession(detail) || extractProfessionFromRole(c.role) || extractProfessionFromDescription(c.description);
      result.background = c.backstory || c.background || null;
      return result;
    }
  }
  if (characters.length > 0) {
    const c = characters[0] as Record<string, any>;
    result.name = c.name || null;
    result.role = c.role || null;
    const detail = [c.traits, c.goals, c.description].filter(Boolean).join(" ");
    result.profession = extractProfession(detail) || extractProfessionFromRole(c.role) || extractProfessionFromDescription(c.description);
    result.background = c.backstory || c.background || null;
  }
  return result;
}

/** Extract profession from role field like "Lead Protagonist, Courtesan & Spy" */
function extractProfessionFromRole(role: string | null): string | null {
  if (!role) return null;
  // Remove meta-role labels and extract actual profession terms
  const metaLabels = /\b(lead|protagonist|main character|hero|heroine|antagonist|supporting|secondary|love interest|villain)\b/gi;
  const cleaned = role.replace(metaLabels, "").replace(/[,&;/]+/g, ",").split(",").map(s => s.trim()).filter(s => s.length > 1);
  return cleaned.length > 0 ? cleaned.join(" & ") : null;
}

/** Extract profession from description like "A young courtesan trained..." */
function extractProfessionFromDescription(desc: string | null): string | null {
  if (!desc) return null;
  // Pattern: "A/An [adjective*] <profession> [who/that/trained/...]"
  const m = desc.match(/^(?:A|An|The)\s+(?:\w+\s+){0,3}?([a-z][a-z\s-]{2,25}?)(?:\s+(?:who|that|trained|working|living|seeking|struggling|caught|forced|torn|secretly|from|in|with)\b)/i);
  return m ? m[1].trim() : null;
}

function extractProfession(text: string | null): string | null {
  if (!text) return null;
  const profMatch = text.match(/\b(?:works as|profession:|is a|career as)\s+(?:an?\s+)?([a-zA-Z\s]+?)(?:[.,;]|$)/i);
  return profMatch ? profMatch[1].trim() : null;
}

function classifySupernatural(worldRules: string[], canonJson: Record<string, unknown>): "none" | "ambiguous" | "present" | "unknown" {
  const allText = [
    ...worldRules,
    (canonJson.premise as string) || "",
    (canonJson.logline as string) || "",
    (canonJson.genre as string) || "",
  ].join(" ").toLowerCase();

  if (!allText.trim()) return "unknown";

  if (allText.includes("no supernatural") || allText.includes("grounded realism") || allText.includes("purely realistic")) return "none";
  if (allText.includes("ambiguous supernatural") || allText.includes("magical realism") || allText.includes("may or may not be real")) return "ambiguous";

  const supCount = SUPERNATURAL_KEYWORDS.filter(k => allText.includes(k)).length;
  if (supCount >= 2) return "present";
  if (supCount === 1) return "ambiguous";

  return "none";
}

// ── 2. Prompt Block Builder ──

/**
 * Build the Canon Constraint Enforcement block for LLM prompt injection.
 * This is the binding anti-drift instruction set.
 */
export function buildCanonConstraintBlock(constraints: CanonConstraints): string {
  if (constraints.extractedFrom === "empty") {
    return "";
  }

  const sections: string[] = [];
  sections.push("═══ CANON CONSTRAINT ENFORCEMENT (BINDING — violations will cause rejection) ═══");
  sections.push("The following canonical facts are LOCKED. You MUST preserve them exactly. Violations trigger automatic drift detection and rejection.");

  // Protagonist identity
  if (constraints.protagonist.name) {
    const parts = [`Protagonist name: ${constraints.protagonist.name}`];
    if (constraints.protagonist.role) parts.push(`Role: ${constraints.protagonist.role}`);
    if (constraints.protagonist.profession) parts.push(`Profession: ${constraints.protagonist.profession}`);
    if (constraints.protagonist.background) parts.push(`Background: ${constraints.protagonist.background}`);
    sections.push(`\nPROTAGONIST IDENTITY (LOCKED):\n${parts.join("\n")}`);
    sections.push("• Do NOT rename, replace, or alter the protagonist's identity, profession, or core background.");
  }

  // Relationships
  if (constraints.relationships.length > 0) {
    const relLines = constraints.relationships.map(r => `  - ${r.character}: ${r.relation}`);
    sections.push(`\nCANONICAL RELATIONSHIPS (LOCKED):\n${relLines.join("\n")}`);
    sections.push("• Do NOT add, remove, or alter canonical family/relationship facts unless the canon explicitly supports them.");
  }

  // Character names
  if (constraints.canonicalCharacterNames.length > 0) {
    sections.push(`\nCANONICAL CHARACTER ROSTER: ${constraints.canonicalCharacterNames.join(", ")}`);
    sections.push("• Do NOT rename any canonical character. Use exact canonical spellings.");
  }

  // World rule mode
  if (constraints.worldRuleMode.supernatural !== "unknown") {
    const modeLabel = {
      none: "GROUNDED REALISM — no supernatural elements permitted",
      ambiguous: "AMBIGUOUS — supernatural elements may exist but must remain unconfirmed/debatable",
      present: "SUPERNATURAL PRESENT — supernatural elements are established canon",
    }[constraints.worldRuleMode.supernatural];
    sections.push(`\nWORLD RULE MODE (LOCKED): ${modeLabel}`);
    sections.push("• Do NOT escalate or alter the world-rule mode. If grounded, stay grounded. If ambiguous, stay ambiguous.");
  }
  if (constraints.worldRuleMode.rules.length > 0) {
    sections.push(`World rules: ${constraints.worldRuleMode.rules.join("; ")}`);
  }

  // Tone
  if (constraints.toneClass) {
    sections.push(`\nTONE CLASSIFICATION (LOCKED): ${constraints.toneClass}`);
    sections.push("• Do NOT shift the tonal register. Maintain the established tone throughout.");
  }

  // Core incident
  if (constraints.coreIncidentFacts.length > 0) {
    sections.push(`\nCORE NARRATIVE FACTS (LOCKED):`);
    for (const fact of constraints.coreIncidentFacts) {
      sections.push(`  • ${fact}`);
    }
    sections.push("• Do NOT contradict, replace, or expand beyond these core narrative facts.");
  }

  // Forbidden changes
  if (constraints.forbiddenChanges.length > 0) {
    sections.push(`\nFORBIDDEN CHANGES (HARD LOCK — violation = immediate rejection):`);
    for (const fc of constraints.forbiddenChanges) {
      sections.push(`  ⛔ ${fc}`);
    }
  }

  // Scope guard
  sections.push(`\nSCOPE CONSTRAINT:
• You may ELABORATE, CLARIFY, and DRAMATICALLY DEEPEN existing canon.
• You may NOT introduce broader mythology, expand the world beyond canon scope, or add elements that contradict established facts.
• You may NOT escalate stakes beyond what the canon permits.
• You may NOT invent new major plot threads that contradict the premise/logline.`);

  sections.push("═══ END CANON CONSTRAINT ENFORCEMENT ═══");

  return "\n" + sections.join("\n");
}

// ── 3. Drift Detection — Phase 2: Semantic Integrity ──

/**
 * Semantic post-generation drift detection.
 * Checks generated output against canonical constraints using structured fact comparison.
 * Returns pass/fail with explicit, decision-useful findings.
 *
 * Phase 2 upgrades over Phase 1:
 * - Identity: checks role/profession/background, not just name presence
 * - Relationship: checks relationship type contradictions, not just name presence
 * - World-rule: graduated escalation with contextual confirmation detection
 * - Tone: active tone register comparison
 * - Core event: semantic contradiction detection
 * - Forbidden changes: active fact-checking
 */
export function detectCanonDrift(
  generatedText: string,
  constraints: CanonConstraints,
): DriftResult {
  if (constraints.extractedFrom === "empty") {
    return {
      passed: true,
      findings: [],
      constraintsUsed: false,
      checkedAt: new Date().toISOString(),
      domains_checked: [],
    };
  }

  const findings: DriftFinding[] = [];
  const domainsChecked: string[] = [];
  const textLower = generatedText.toLowerCase();

  // ── Identity drift (semantic) ──
  if (constraints.protagonist.name) {
    domainsChecked.push("identity");
    const nameL = constraints.protagonist.name.toLowerCase();

    // Phase 1 check: name presence
    if (!textLower.includes(nameL)) {
      findings.push({
        domain: "identity",
        severity: "violation",
        detail: `Protagonist "${constraints.protagonist.name}" not found in output — possible identity replacement.`,
        evidence: `Canon protagonist: ${constraints.protagonist.name}`,
        canonical_expected: `Protagonist name: ${constraints.protagonist.name}`,
        observed_conflict: "Name absent from generated text",
      });
    } else {
      // Phase 2: name is present — check role/profession/background integrity
      
      // Check profession drift
      if (constraints.protagonist.profession) {
        const canonProf = constraints.protagonist.profession.toLowerCase();
        const assertedProfs = extractAssertedProfessions(generatedText, constraints.protagonist.name);
        
        if (assertedProfs.length > 0) {
          // Check if any asserted profession contradicts canon
          const matchesCanon = assertedProfs.some(p => {
            // Fuzzy match: either contains the other or shares significant words
            return p.includes(canonProf) || canonProf.includes(p) ||
              canonProf.split(/\s+/).some(w => w.length > 3 && p.includes(w));
          });
          
          if (!matchesCanon) {
            findings.push({
              domain: "identity",
              severity: "violation",
              detail: `Protagonist "${constraints.protagonist.name}" profession drifted: canon says "${constraints.protagonist.profession}" but output asserts "${assertedProfs[0]}".`,
              evidence: `Extracted professions: ${assertedProfs.join(", ")}`,
              canonical_expected: `Profession: ${constraints.protagonist.profession}`,
              observed_conflict: `Asserted: ${assertedProfs[0]}`,
            });
          }
        }
      }
      
      // Check background drift
      if (constraints.protagonist.background) {
        const bgCheck = checkFactContradiction(generatedText, `${constraints.protagonist.name} ${constraints.protagonist.background}`);
        if (bgCheck.contradicted) {
          findings.push({
            domain: "identity",
            severity: "violation",
            detail: `Protagonist "${constraints.protagonist.name}" background contradicted in output.`,
            evidence: bgCheck.evidence,
            canonical_expected: `Background: ${constraints.protagonist.background}`,
            observed_conflict: bgCheck.evidence,
          });
        }
      }
      
      // Check role drift (if a specific role like "detective", "doctor" etc is stated)
      if (constraints.protagonist.role) {
        const canonRole = constraints.protagonist.role.toLowerCase();
        // Extract role-like assertions
        const roleKeywords = canonRole.split(/[\s,;/]+/).filter(w => w.length > 3 && !w.match(/^(protagonist|lead|main|character|hero|heroine)$/));
        if (roleKeywords.length > 0) {
          const sentences = extractSentencesAround(generatedText, constraints.protagonist.name, 300);
          const context = sentences.join(" ").toLowerCase();
          // Check for explicit contradiction of role
          for (const rk of roleKeywords) {
            if (context.includes(`not a ${rk}`) || context.includes(`no longer a ${rk}`) || context.includes(`former ${rk}`) || context.includes(`ex-${rk}`)) {
              findings.push({
                domain: "identity",
                severity: "warning",
                detail: `Protagonist "${constraints.protagonist.name}" role may be contradicted — canon role "${constraints.protagonist.role}" appears negated.`,
                evidence: `Found negation of role keyword: ${rk}`,
                canonical_expected: `Role: ${constraints.protagonist.role}`,
                observed_conflict: `Negation of "${rk}" near protagonist name`,
              });
            }
          }
        }
      }
    }
  }

  // ── Relationship drift (semantic) ──
  if (constraints.relationships.length > 0) {
    domainsChecked.push("relationship");
    for (const rel of constraints.relationships) {
      const charL = rel.character.toLowerCase();
      if (charL.length <= 2) continue;

      if (!textLower.includes(charL)) {
        // Phase 1: name missing
        findings.push({
          domain: "relationship",
          severity: "warning",
          detail: `Canonical character "${rel.character}" not referenced in output.`,
          evidence: `Canon relationship: ${rel.character} — ${rel.relation}`,
          canonical_expected: `Character "${rel.character}" with relationship: ${rel.relation}`,
          observed_conflict: "Character absent from generated text",
        });
      } else {
        // Phase 2: name present — check relationship TYPE integrity
        const canonTypes = classifyRelationshipType(rel.relation);
        
        // Extract how this character is described in the generated text
        const charSentences = extractSentencesAround(generatedText, rel.character, 300);
        const charContext = charSentences.join(". ");
        const observedTypes = classifyRelationshipType(charContext);
        
        if (canonTypes.length > 0 && observedTypes.length > 0) {
          const contradictionCheck = areRelationshipsContradictory(canonTypes, observedTypes);
          if (contradictionCheck.contradicts) {
            findings.push({
              domain: "relationship",
              severity: "violation",
              detail: `Relationship for "${rel.character}" contradicts canon: ${contradictionCheck.reason}.`,
              evidence: `Canon: "${rel.relation}" → types [${canonTypes.join(",")}]. Observed types: [${observedTypes.join(",")}]`,
              canonical_expected: `Relationship: ${rel.relation} (${canonTypes.join(", ")})`,
              observed_conflict: `Observed: ${observedTypes.join(", ")}`,
            });
          }
        }
        
        // Also check for negation of the canonical relationship
        const relNegationCheck = checkFactContradiction(charContext, `${rel.character} ${rel.relation}`);
        if (relNegationCheck.contradicted) {
          findings.push({
            domain: "relationship",
            severity: "violation",
            detail: `Canonical relationship "${rel.character}: ${rel.relation}" appears contradicted in output.`,
            evidence: relNegationCheck.evidence,
            canonical_expected: `${rel.character}: ${rel.relation}`,
            observed_conflict: relNegationCheck.evidence,
          });
        }
      }
    }
  }

  // ── World-rule drift (graduated semantic) ──
  if (constraints.worldRuleMode.supernatural !== "unknown") {
    domainsChecked.push("world_rule");
    const canonLevel = constraints.worldRuleMode.supernatural;
    const observed = classifyGeneratedSupernatural(generatedText);
    
    // Escalation matrix:
    // none → ambiguous = warning, none → present = violation
    // ambiguous → present = violation (ambiguity resolved)
    // present → none = violation (de-escalation / contradiction)
    // present → ambiguous = warning (weakening established elements)
    
    if (canonLevel === "none") {
      if (observed.level === "present") {
        findings.push({
          domain: "world_rule",
          severity: "violation",
          detail: `Canon is grounded realism but output introduces confirmed supernatural elements.`,
          evidence: `Keywords: ${observed.keywords.join(", ")}. Confirmations: ${observed.confirmations.join("; ") || "high keyword density"}`,
          canonical_expected: "World mode: grounded realism (no supernatural)",
          observed_conflict: `Supernatural elements detected: ${observed.keywords.slice(0, 5).join(", ")}`,
        });
      } else if (observed.level === "ambiguous") {
        findings.push({
          domain: "world_rule",
          severity: "warning",
          detail: `Canon is grounded realism but output contains ambiguous supernatural references.`,
          evidence: `Keywords: ${observed.keywords.join(", ")}`,
          canonical_expected: "World mode: grounded realism",
          observed_conflict: `Ambiguous supernatural: ${observed.keywords.join(", ")}`,
        });
      }
    } else if (canonLevel === "ambiguous") {
      if (observed.level === "present") {
        findings.push({
          domain: "world_rule",
          severity: "violation",
          detail: `Canon classifies supernatural as ambiguous but output resolves ambiguity — supernatural is confirmed.`,
          evidence: `Confirmations: ${observed.confirmations.join("; ")}`,
          canonical_expected: "World mode: ambiguous (supernatural unconfirmed)",
          observed_conflict: `Supernatural confirmed: ${observed.confirmations.join("; ")}`,
        });
      }
    } else if (canonLevel === "present") {
      if (observed.level === "none") {
        findings.push({
          domain: "world_rule",
          severity: "warning",
          detail: `Canon establishes supernatural elements but output appears entirely grounded — possible de-escalation.`,
          evidence: "No supernatural keywords or confirmations found in output",
          canonical_expected: "World mode: supernatural present",
          observed_conflict: "Output appears fully grounded",
        });
      }
    }
  }

  // ── Scope escalation (enhanced) ──
  domainsChecked.push("scope_escalation");
  if (constraints.worldRuleMode.supernatural === "none" || constraints.worldRuleMode.supernatural === "unknown" || constraints.worldRuleMode.supernatural === "ambiguous") {
    for (const pat of SCOPE_ESCALATION_PATTERNS) {
      const match = generatedText.match(pat);
      if (match) {
        const inCanon = constraints.coreIncidentFacts.some(f => pat.test(f));
        if (!inCanon) {
          findings.push({
            domain: "scope_escalation",
            severity: "warning",
            detail: `Possible scope escalation beyond canon: "${match[0]}" — not present in canonical premise/logline.`,
            evidence: `Pattern: ${match[0]}`,
            canonical_expected: constraints.logline || constraints.premise || "No scope escalation permitted",
            observed_conflict: match[0],
          });
        }
      }
    }
  }

  // ── Core event fact drift ──
  if (constraints.coreIncidentFacts.length > 0) {
    domainsChecked.push("core_event");
    for (const fact of constraints.coreIncidentFacts) {
      const contradictionCheck = checkFactContradiction(generatedText, fact);
      if (contradictionCheck.contradicted) {
        findings.push({
          domain: "core_event",
          severity: "violation",
          detail: `Core narrative fact contradicted in output.`,
          evidence: contradictionCheck.evidence,
          canonical_expected: fact.slice(0, 200),
          observed_conflict: contradictionCheck.evidence,
        });
      }
    }
  }

  // ── Forbidden changes (active checking) ──
  if (constraints.forbiddenChanges.length > 0) {
    domainsChecked.push("forbidden_change");
    for (const fc of constraints.forbiddenChanges) {
      const violationCheck = checkForbiddenChangeViolation(generatedText, fc);
      if (violationCheck.violated) {
        findings.push({
          domain: "forbidden_change",
          severity: "violation",
          detail: `Forbidden change violated: "${fc.slice(0, 100)}"`,
          evidence: violationCheck.evidence,
          canonical_expected: `FORBIDDEN: ${fc}`,
          observed_conflict: violationCheck.evidence,
        });
      }
    }
  }

  // ── Tone drift (active comparison) ──
  if (constraints.toneClass) {
    domainsChecked.push("tone");
    const observedRegisters = classifyToneRegister(generatedText);
    if (observedRegisters.length > 0) {
      const toneCheck = isToneContradiction(constraints.toneClass, observedRegisters);
      if (toneCheck.contradicts) {
        findings.push({
          domain: "tone",
          severity: "warning",
          detail: `Tone register drift detected: ${toneCheck.reason}`,
          evidence: `Canon tone: "${constraints.toneClass}". Observed dominant registers: ${observedRegisters.join(", ")}`,
          canonical_expected: `Tone: ${constraints.toneClass}`,
          observed_conflict: `Observed: ${observedRegisters.join(", ")}`,
        });
      }
    }
  }

  const hasViolation = findings.some(f => f.severity === "violation");

  return {
    passed: !hasViolation,
    findings,
    constraintsUsed: true,
    checkedAt: new Date().toISOString(),
    domains_checked: domainsChecked,
  };
}

// ── Logging Helper ──

/**
 * Structured log for drift detection results.
 * Call after detectCanonDrift to ensure auditability.
 */
export function logDriftResult(
  tag: string,
  projectId: string,
  docType: string,
  result: DriftResult,
): void {
  const logEntry = {
    type: "CANON_DRIFT_CHECK",
    tag,
    project_id: projectId,
    doc_type: docType,
    passed: result.passed,
    constraints_used: result.constraintsUsed,
    domains_checked: result.domains_checked,
    finding_count: result.findings.length,
    violations: result.findings.filter(f => f.severity === "violation").length,
    warnings: result.findings.filter(f => f.severity === "warning").length,
    checked_at: result.checkedAt,
    findings: result.findings.map(f => ({
      domain: f.domain,
      severity: f.severity,
      detail: f.detail,
      canonical_expected: f.canonical_expected,
      observed_conflict: f.observed_conflict,
    })),
  };

  if (result.passed) {
    console.log(`[${tag}] Canon drift check PASSED`, JSON.stringify(logEntry));
  } else {
    console.error(`[${tag}][IEL] Canon drift check FAILED`, JSON.stringify(logEntry));
  }
}
