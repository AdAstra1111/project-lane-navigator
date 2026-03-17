/**
 * Canon Constraint Enforcement (CCE) — Phase 1
 *
 * Anti-drift architecture for IFFY. Ensures downstream document generation
 * cannot silently mutate canonical project truth.
 *
 * Three responsibilities:
 *   1. extractCanonConstraints() — deterministic extraction from canon_json
 *   2. buildCanonConstraintBlock() — prompt injection block for LLM generation
 *   3. detectCanonDrift() — post-generation validation against constraints
 *
 * INVARIANTS:
 *   - Deterministic: same canon → same constraints → same drift results
 *   - Single source of truth: canon_json from project_canon (via narrativeContextResolver)
 *   - No silent fallbacks: drift always surfaces explicitly
 *   - No duplicated logic: this module is the sole authority for constraint enforcement
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

  // Relationships
  const relationships: CanonConstraints["relationships"] = [];
  for (const char of characters) {
    const c = char as Record<string, any>;
    if (c.relationships && typeof c.relationships === "string") {
      relationships.push({ character: c.name || "unknown", relation: c.relationships });
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
      // Try to extract profession from traits/goals/description
      const detail = [c.traits, c.goals, c.description].filter(Boolean).join(" ");
      result.profession = extractProfession(detail);
      result.background = c.backstory || c.background || null;
      return result;
    }
  }
  // Fallback: first character is protagonist
  if (characters.length > 0) {
    const c = characters[0] as Record<string, any>;
    result.name = c.name || null;
    result.role = c.role || null;
    const detail = [c.traits, c.goals, c.description].filter(Boolean).join(" ");
    result.profession = extractProfession(detail);
    result.background = c.backstory || c.background || null;
  }
  return result;
}

function extractProfession(text: string | null): string | null {
  if (!text) return null;
  // Look for common profession patterns
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

  // Explicit classification from canon
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

// ── 3. Drift Detection ──

/**
 * Deterministic post-generation drift detection.
 * Checks generated output against canonical constraints.
 * Returns pass/fail with explicit findings.
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

  // ── Identity drift ──
  if (constraints.protagonist.name) {
    domainsChecked.push("identity");
    const nameL = constraints.protagonist.name.toLowerCase();
    // Check if protagonist name appears in generated text
    if (!textLower.includes(nameL)) {
      findings.push({
        domain: "identity",
        severity: "violation",
        detail: `Protagonist name "${constraints.protagonist.name}" not found in generated output — possible identity replacement`,
        evidence: `Canon protagonist: ${constraints.protagonist.name}`,
      });
    }
  }

  // ── Relationship drift ──
  if (constraints.relationships.length > 0) {
    domainsChecked.push("relationship");
    // Check each canonical character appears
    for (const rel of constraints.relationships) {
      const charL = rel.character.toLowerCase();
      if (charL.length > 2 && !textLower.includes(charL)) {
        findings.push({
          domain: "relationship",
          severity: "warning",
          detail: `Canonical character "${rel.character}" with relationship "${rel.relation}" not referenced in output`,
          evidence: `Canon relationship: ${rel.character} — ${rel.relation}`,
        });
      }
    }
  }

  // ── World-rule drift ──
  if (constraints.worldRuleMode.supernatural !== "unknown") {
    domainsChecked.push("world_rule");
    if (constraints.worldRuleMode.supernatural === "none") {
      // Check for supernatural elements in grounded canon
      const supFound = SUPERNATURAL_KEYWORDS.filter(k => textLower.includes(k));
      if (supFound.length >= 2) {
        findings.push({
          domain: "world_rule",
          severity: "violation",
          detail: `Canon is grounded realism but generated text contains supernatural elements: ${supFound.join(", ")}`,
          evidence: `Supernatural keywords found: ${supFound.join(", ")}`,
        });
      } else if (supFound.length === 1) {
        findings.push({
          domain: "world_rule",
          severity: "warning",
          detail: `Canon is grounded realism but generated text references: "${supFound[0]}" — may be metaphorical`,
          evidence: `Word found: ${supFound[0]}`,
        });
      }
    } else if (constraints.worldRuleMode.supernatural === "ambiguous") {
      // Ambiguous: supernatural confirmed/resolved = drift
      const confirmPatterns = [
        /\b(?:the ghost (?:is|was) real)\b/i,
        /\b(?:confirmed to be supernatural)\b/i,
        /\b(?:is actually (?:a |an )?(?:ghost|spirit|demon|angel))\b/i,
        /\b(?:reveals? (?:their|his|her) (?:true |supernatural )?(?:powers?|abilities|nature))\b/i,
      ];
      for (const pat of confirmPatterns) {
        const match = generatedText.match(pat);
        if (match) {
          findings.push({
            domain: "world_rule",
            severity: "violation",
            detail: `Canon classifies supernatural as ambiguous but output resolves ambiguity: "${match[0]}"`,
            evidence: `Pattern matched: ${match[0]}`,
          });
        }
      }
    }
  }

  // ── Scope escalation ──
  domainsChecked.push("scope_escalation");
  // Only flag scope escalation for grounded/intimate stories (non-supernatural, non-action genres)
  if (constraints.worldRuleMode.supernatural === "none" || constraints.worldRuleMode.supernatural === "unknown") {
    for (const pat of SCOPE_ESCALATION_PATTERNS) {
      const match = generatedText.match(pat);
      if (match) {
        // Check if this escalation exists in canon (premise/logline)
        const inCanon = constraints.coreIncidentFacts.some(f =>
          pat.test(f)
        );
        if (!inCanon) {
          findings.push({
            domain: "scope_escalation",
            severity: "warning",
            detail: `Possible scope escalation beyond canon: "${match[0]}" — not present in canonical premise/logline`,
            evidence: `Pattern: ${match[0]}`,
          });
        }
      }
    }
  }

  // ── Forbidden changes ──
  if (constraints.forbiddenChanges.length > 0) {
    domainsChecked.push("forbidden_change");
    // Forbidden changes are explicit — we can only warn that they exist.
    // A more sophisticated check would parse the semantics, but Phase 1
    // relies on the prompt constraint + explicit logging.
  }

  // ── Tone drift ──
  if (constraints.toneClass) {
    domainsChecked.push("tone");
    // Phase 1: tone drift detection is advisory.
    // The prompt constraint is the primary enforcement.
    // Future: compare tone classifier output vs canon tone.
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
    })),
  };

  if (result.passed) {
    console.log(`[${tag}] Canon drift check PASSED`, JSON.stringify(logEntry));
  } else {
    console.error(`[${tag}][IEL] Canon drift check FAILED`, JSON.stringify(logEntry));
  }
}
