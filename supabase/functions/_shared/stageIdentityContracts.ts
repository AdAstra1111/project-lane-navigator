/**
 * stageIdentityContracts.ts — Deterministic stage-identity validation.
 *
 * Single source of truth for document stage shape rules.
 * Prevents cross-stage contamination: idea → concept_brief bleed,
 * screenplay formatting in non-script stages, etc.
 *
 * INVARIANT: Every generated document MUST pass its stage identity
 * check before being accepted into the pipeline.
 */

// ── Violation Types ──

export type StageIdentityViolation =
  | "IDEA_STAGE_SHAPE_VIOLATION"       // screenplay/scene formatting in idea
  | "IDEA_TOO_EXPANDED"                // idea resembles concept_brief (too long/dense)
  | "IDEA_STAGE_IDENTITY_VIOLATION"    // general stage identity failure for idea
  | "CONCEPT_BRIEF_STAGE_SHAPE_VIOLATION" // screenplay formatting in concept_brief
  | "STAGE_IDENTITY_PASS";

export interface StageIdentityResult {
  pass: boolean;
  violation: StageIdentityViolation;
  details: {
    doc_type: string;
    char_count: number;
    word_count: number;
    section_count: number;
    has_screenplay_formatting: boolean;
    has_scene_headings: boolean;
    has_dialogue_cues: boolean;
    has_parentheticals: boolean;
    has_vo_os: boolean;
    density_class: "idea" | "concept_brief" | "treatment_plus" | "unknown";
    violations: string[];
  };
  repair_hint?: string;
}

// ── Constants ──

// IDEA: short, proposition-led, high-signal
const IDEA_MAX_CHARS = 4000;
const IDEA_MAX_WORDS = 600;
const IDEA_MAX_SECTIONS = 6;  // title + logline + premise + genre + usp + maybe 1 more

// CONCEPT_BRIEF: expanded development articulation
const CONCEPT_BRIEF_MAX_CHARS = 12000;
const CONCEPT_BRIEF_MIN_CHARS = 800;

// Screenplay detection patterns
const SCENE_HEADING_RE = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s/m;
const DIALOGUE_CUE_RE = /^[A-Z][A-Z\s.'-]{1,30}\s*(\(.*?\))?\s*$/m;
const PARENTHETICAL_RE = /^\s*\(.*?\)\s*$/m;
const VO_OS_RE = /\(V\.O\.\)|\(O\.S\.\)|\(O\.C\.\)|\(CONT'D\)/i;
const SLUGLINE_INTENSIVE_RE = /(?:^|\n)(?:INT\.|EXT\.|INT\/EXT\.).*(?:\n|$)/g;

// Section heading detection (markdown ##)
const SECTION_HEADING_RE = /^#{1,3}\s+\S/gm;

// ── Helpers ──

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function countSections(text: string): number {
  return (text.match(SECTION_HEADING_RE) || []).length;
}

function hasScreenplayFormatting(text: string): {
  scene_headings: boolean;
  dialogue_cues: boolean;
  parentheticals: boolean;
  vo_os: boolean;
  scene_heading_count: number;
} {
  const lines = text.split("\n");
  let scene_heading_count = 0;
  let dialogue_cue_count = 0;
  let parenthetical_count = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (SCENE_HEADING_RE.test(trimmed)) scene_heading_count++;
    if (DIALOGUE_CUE_RE.test(trimmed) && trimmed.length < 40 && trimmed === trimmed.toUpperCase()) dialogue_cue_count++;
    if (PARENTHETICAL_RE.test(trimmed) && trimmed.startsWith("(")) parenthetical_count++;
  }

  return {
    scene_headings: scene_heading_count >= 1,
    dialogue_cues: dialogue_cue_count >= 2,
    parentheticals: parenthetical_count >= 1,
    vo_os: VO_OS_RE.test(text),
    scene_heading_count,
  };
}

function classifyDensity(charCount: number, wordCount: number, sectionCount: number): StageIdentityResult["details"]["density_class"] {
  if (wordCount <= IDEA_MAX_WORDS && sectionCount <= IDEA_MAX_SECTIONS) return "idea";
  if (wordCount <= 2000 && sectionCount <= 12) return "concept_brief";
  return "treatment_plus";
}

// ── Public Validators ──

/**
 * Validate that an idea document has correct stage identity.
 * Rejects screenplay formatting and concept-brief-level expansion.
 */
export function validateIdeaStageIdentity(plaintext: string): StageIdentityResult {
  const text = (plaintext || "").trim();
  const charCount = text.length;
  const wordCount = countWords(text);
  const sectionCount = countSections(text);
  const screenplay = hasScreenplayFormatting(text);
  const densityClass = classifyDensity(charCount, wordCount, sectionCount);
  const violations: string[] = [];

  const baseDetails = {
    doc_type: "idea",
    char_count: charCount,
    word_count: wordCount,
    section_count: sectionCount,
    has_screenplay_formatting: screenplay.scene_headings || screenplay.dialogue_cues,
    has_scene_headings: screenplay.scene_headings,
    has_dialogue_cues: screenplay.dialogue_cues,
    has_parentheticals: screenplay.parentheticals,
    has_vo_os: screenplay.vo_os,
    density_class: densityClass,
    violations,
  };

  // 1. SCREENPLAY CONTAMINATION — hard fail
  if (screenplay.scene_headings || screenplay.dialogue_cues || screenplay.vo_os) {
    if (screenplay.scene_headings) violations.push(`Found ${screenplay.scene_heading_count} scene heading(s) (INT./EXT.)`);
    if (screenplay.dialogue_cues) violations.push("Contains screenplay dialogue cues");
    if (screenplay.vo_os) violations.push("Contains V.O./O.S. annotations");
    if (screenplay.parentheticals) violations.push("Contains parenthetical directions");
    return {
      pass: false,
      violation: "IDEA_STAGE_SHAPE_VIOLATION",
      details: baseDetails,
      repair_hint: "Strip all screenplay formatting. Rewrite as concise concept-stage prose: logline + premise + commercial framing only.",
    };
  }

  // 2. OVER-EXPANSION — idea looks like concept_brief or larger
  if (charCount > IDEA_MAX_CHARS || wordCount > IDEA_MAX_WORDS || sectionCount > IDEA_MAX_SECTIONS) {
    if (charCount > IDEA_MAX_CHARS) violations.push(`Char count ${charCount} exceeds idea max ${IDEA_MAX_CHARS}`);
    if (wordCount > IDEA_MAX_WORDS) violations.push(`Word count ${wordCount} exceeds idea max ${IDEA_MAX_WORDS}`);
    if (sectionCount > IDEA_MAX_SECTIONS) violations.push(`Section count ${sectionCount} exceeds idea max ${IDEA_MAX_SECTIONS}`);
    return {
      pass: false,
      violation: "IDEA_TOO_EXPANDED",
      details: baseDetails,
      repair_hint: "Compress to idea-stage density: concise logline, brief premise (2-3 paragraphs max), minimal genre/commercial framing. Remove extended development sections.",
    };
  }

  // 3. DENSITY CLASS MISMATCH — idea with concept_brief density
  if (densityClass !== "idea" && densityClass !== "unknown") {
    violations.push(`Density class '${densityClass}' exceeds idea-stage expectations`);
    return {
      pass: false,
      violation: "IDEA_STAGE_IDENTITY_VIOLATION",
      details: baseDetails,
      repair_hint: "Document structure resembles a concept brief. Reduce to proposition-led idea with fewer sections and less development detail.",
    };
  }

  return { pass: true, violation: "STAGE_IDENTITY_PASS", details: baseDetails };
}

/**
 * Validate that a concept_brief document has correct stage identity.
 * Rejects screenplay formatting.
 */
export function validateConceptBriefStageIdentity(plaintext: string): StageIdentityResult {
  const text = (plaintext || "").trim();
  const charCount = text.length;
  const wordCount = countWords(text);
  const sectionCount = countSections(text);
  const screenplay = hasScreenplayFormatting(text);
  const densityClass = classifyDensity(charCount, wordCount, sectionCount);
  const violations: string[] = [];

  const baseDetails = {
    doc_type: "concept_brief",
    char_count: charCount,
    word_count: wordCount,
    section_count: sectionCount,
    has_screenplay_formatting: screenplay.scene_headings || screenplay.dialogue_cues,
    has_scene_headings: screenplay.scene_headings,
    has_dialogue_cues: screenplay.dialogue_cues,
    has_parentheticals: screenplay.parentheticals,
    has_vo_os: screenplay.vo_os,
    density_class: densityClass,
    violations,
  };

  // SCREENPLAY CONTAMINATION — hard fail
  if (screenplay.scene_heading_count >= 3 || screenplay.dialogue_cues || screenplay.vo_os) {
    if (screenplay.scene_headings) violations.push(`Found ${screenplay.scene_heading_count} scene heading(s)`);
    if (screenplay.dialogue_cues) violations.push("Contains screenplay dialogue cues");
    if (screenplay.vo_os) violations.push("Contains V.O./O.S. annotations");
    return {
      pass: false,
      violation: "CONCEPT_BRIEF_STAGE_SHAPE_VIOLATION",
      details: baseDetails,
      repair_hint: "Strip screenplay formatting. Concept brief should be structured development prose, not scenic dramatization.",
    };
  }

  return { pass: true, violation: "STAGE_IDENTITY_PASS", details: baseDetails };
}

/**
 * Dispatch validation based on doc_type.
 * Returns null for doc types without stage identity contracts.
 */
export function validateStageIdentity(docType: string, plaintext: string): StageIdentityResult | null {
  switch (docType) {
    case "idea": return validateIdeaStageIdentity(plaintext);
    case "concept_brief": return validateConceptBriefStageIdentity(plaintext);
    default: return null;
  }
}

// ── Prompt Blocks ──

/**
 * Returns a binding prompt block enforcing stage identity for the given doc type.
 * Inject into system prompt during generation.
 */
export function getStageIdentityPromptBlock(docType: string): string | null {
  switch (docType) {
    case "idea":
      return `
═══════════════════════════════════════
## STAGE IDENTITY CONTRACT: IDEA (MANDATORY — VIOLATIONS CAUSE REJECTION)
═══════════════════════════════════════

You are writing an IDEA document — the earliest, most concise stage artifact.

### WHAT AN IDEA IS:
- A short, high-signal, concept-stage artifact
- Premise-led and commercially legible
- Communicates the core proposition quickly
- Maximum ~500 words total

### WHAT AN IDEA IS NOT:
- NOT a concept brief (no extended development sections)
- NOT a treatment (no scene-by-scene unfolding)
- NOT a screenplay (no INT./EXT., no dialogue cues, no V.O./O.S.)
- NOT a development memo (no extensive structural breakdown)

### ALLOWED SECTIONS (max 5-6 total):
- Title
- Logline (1-2 sentences)
- Premise (2-3 paragraphs max — the core hook and dramatic engine)
- Genre/tone (brief — 1-2 lines)
- Commercial hook or unique selling point (1 paragraph)
- Optional: brief protagonist/stakes reference if essential

### FORBIDDEN:
- Screenplay formatting of any kind (scene headings, dialogue blocks, V.O., O.S.)
- Scene-by-scene execution or dramatization
- Extended character breakdowns (that's character_bible territory)
- Detailed plot architecture (that's story_outline territory)
- Section proliferation beyond 6 headings
- Documents exceeding 600 words or 4000 characters

### STAGE BOUNDARY RULE:
If your output starts resembling a concept brief (multiple structured development sections, protagonist/antagonist/stakes/tone breakdowns), STOP and compress back to idea density. An idea should feel like a pitch — not a development document.
`;

    case "concept_brief":
      return `
═══════════════════════════════════════
## STAGE IDENTITY CONTRACT: CONCEPT BRIEF (MANDATORY)
═══════════════════════════════════════

You are writing a CONCEPT BRIEF — an expanded development articulation of the idea.

### WHAT A CONCEPT BRIEF IS:
- More structured and development-oriented than an idea
- Expanded concept summary with protagonist, antagonist, stakes, tone, world, comps, audience
- Development-oriented articulation — the "what and why" of the project
- Typically 800-2500 words

### WHAT A CONCEPT BRIEF IS NOT:
- NOT a screenplay (no INT./EXT., no dialogue cues, no V.O./O.S.)
- NOT a treatment (no scene-by-scene narrative)
- NOT a beat sheet (no sequential plot beats)

### FORBIDDEN:
- Screenplay formatting of any kind
- Scene dramatization or scenic execution
- Beat-by-beat plot unfolding
- Treatment-level narrative detail
`;

    default:
      return null;
  }
}

// ── Diagnostics ──

export interface StageIdentityDiagnostic {
  doc_type: string;
  violation: StageIdentityViolation;
  pass: boolean;
  char_count: number;
  word_count: number;
  section_count: number;
  screenplay_contamination: boolean;
  density_class: string;
  repair_invoked: boolean;
  violations: string[];
}

export function buildDiagnostic(result: StageIdentityResult, repairInvoked = false): StageIdentityDiagnostic {
  return {
    doc_type: result.details.doc_type,
    violation: result.violation,
    pass: result.pass,
    char_count: result.details.char_count,
    word_count: result.details.word_count,
    section_count: result.details.section_count,
    screenplay_contamination: result.details.has_screenplay_formatting,
    density_class: result.details.density_class,
    repair_invoked: repairInvoked,
    violations: result.details.violations,
  };
}
