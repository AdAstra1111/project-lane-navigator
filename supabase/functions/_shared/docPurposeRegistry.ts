/**
 * Document Purpose Registry v1
 *
 * IFFY treats documents according to what they are FOR, not just what stage they occupy.
 *
 * Purpose classes define:
 *   - the primary scoring axis (CI vs GP, and what each measures for this doc type)
 *   - the rewrite goal (depth/architecture vs commercial readiness)
 *   - how notes should be scoped and framed
 *
 * This registry is the single source of truth. buildAnalyzeSystem and buildRewriteSystem
 * MUST consult it — never hard-code purpose logic per doc type elsewhere.
 *
 * INVARIANT: unknown doc types fall back to PREMISE_POSITIONING (safe generic default).
 *
 * Architecture-Strict Mode: determinism overrides convenience.
 * No silent fallback to generic CI/GP for docs that have an explicit purpose class.
 */

// ── Purpose Classes ──

export type DocPurposeClass =
  /** Internal creative architecture. Job: improve story quality, depth, structural completeness.
   *  Score on: depth, craft, internal coherence, development utility.
   *  NOT on: market positioning, packaging magnetism, castability. */
  | "DEVELOPMENT_ARCHITECTURE"

  /** Concept / viability bridge. Job: establish premise strength and commercial clarity.
   *  Score on: premise originality, hook clarity, genre legibility, commercial viability.
   *  Balanced CI/GP — both matter. */
  | "PREMISE_POSITIONING"

  /** Commercial-facing outputs. Job: communicate market promise and finance readiness.
   *  GP is primary. CI reflects clarity and quality of the commercial argument.
   *  NOT scored on narrative depth. */
  | "PACKAGING_COMMERCIAL"

  /** Executable story delivery. Job: produce a script or production-ready document.
   *  Score on: craft, format compliance, scene quality, production feasibility. */
  | "SCRIPT_EXECUTION";


// ── Purpose Map ──

export const DOC_PURPOSE_MAP: Record<string, DocPurposeClass> = {
  // DEVELOPMENT_ARCHITECTURE — internal creative architecture
  character_bible:          "DEVELOPMENT_ARCHITECTURE",
  story_outline:            "DEVELOPMENT_ARCHITECTURE",
  beat_sheet:               "DEVELOPMENT_ARCHITECTURE",
  season_arc:               "DEVELOPMENT_ARCHITECTURE",
  vertical_episode_beats:   "DEVELOPMENT_ARCHITECTURE",
  episode_grid:             "DEVELOPMENT_ARCHITECTURE",
  episode_beats:            "DEVELOPMENT_ARCHITECTURE",

  // PREMISE_POSITIONING — concept / viability bridge
  idea:                     "PREMISE_POSITIONING",
  concept_brief:            "PREMISE_POSITIONING",
  treatment:                "PREMISE_POSITIONING",
  format_rules:             "PREMISE_POSITIONING",
  topline_narrative:        "PREMISE_POSITIONING",

  // PACKAGING_COMMERCIAL — market / finance outputs
  market_sheet:             "PACKAGING_COMMERCIAL",
  deck:                     "PACKAGING_COMMERCIAL",
  vertical_market_sheet:    "PACKAGING_COMMERCIAL",
  trailer_script:           "PACKAGING_COMMERCIAL",
  project_overview:         "PACKAGING_COMMERCIAL",
  market_positioning:       "PACKAGING_COMMERCIAL",

  // SCRIPT_EXECUTION — executable story delivery
  feature_script:           "SCRIPT_EXECUTION",
  episode_script:           "SCRIPT_EXECUTION",
  season_script:            "SCRIPT_EXECUTION",
  production_draft:         "SCRIPT_EXECUTION",
  season_master_script:     "SCRIPT_EXECUTION",
  documentary_outline:      "SCRIPT_EXECUTION",
};


// ── Public Lookup ──

/**
 * Returns the purpose class for a doc type.
 * Fails safe to PREMISE_POSITIONING for unknown types.
 */
export function getDocPurposeClass(docType: string): DocPurposeClass {
  return DOC_PURPOSE_MAP[docType] ?? "PREMISE_POSITIONING";
}


// ── Purpose-Aware CI/GP Scoring Rubrics ──
// These REPLACE the generic universal CI/GP block for each purpose class.
// They are injected into buildAnalyzeSystem after the deliverable rubric.

export const PURPOSE_SCORING_RUBRICS: Record<DocPurposeClass, string> = {

  DEVELOPMENT_ARCHITECTURE: `SCORING RUBRIC (PURPOSE: DEVELOPMENT_ARCHITECTURE):
This document is an internal creative architecture tool. Its job is to improve story quality,
structural completeness, and development readiness. It is NOT evaluated as a market product.

CI (Creative Integrity) evaluates — for this purpose class:
- Depth and specificity of the creative material (characters, structure, beats, arcs)
- Internal coherence and thematic integration
- Structural completeness appropriate to the document type
- Craft quality relative to what this document needs to do in the development pipeline

GP (Development Readiness) evaluates — for this purpose class:
- Does this document unblock the next development stage?
- Is the material specific and actionable enough to generate the next doc?
- Are the critical architecture decisions in place (arcs, beats, relationships, turning points)?
- Completeness: are there gaps that would force the next document to invent rather than develop?

CRITICAL SCORING RULES for DEVELOPMENT_ARCHITECTURE:
- Do NOT score packaging magnetism, castability, or talkability for these documents.
- Do NOT score market positioning or commercial viability.
- Do NOT penalise a character bible or beat sheet for lacking audience hook language.
- GP here means "development readiness" — how ready is this doc to drive the next stage.
- A character bible with deep, specific characters and clear arcs should score CI:80+ and GP:75+
  even if it reads like an internal working document rather than a pitch-facing asset.
- A beat sheet with structural completeness, clear turning points, and Act 3 fully developed
  should score CI:78+ and GP:75+ regardless of commercial language.`,

  PREMISE_POSITIONING: `SCORING RUBRIC (PURPOSE: PREMISE_POSITIONING):
This document bridges creative vision and commercial viability.

CI (Creative Integrity) evaluates:
- Originality and distinctiveness of the premise
- Emotional conviction and character truth at premise level
- Thematic coherence and genre clarity
- Structural integrity of the concept

GP (Greenlight Probability) evaluates:
- Audience clarity and hook strength
- Market positioning within declared lane
- Concept legibility (can a buyer understand what this is in one read?)
- Development viability (does this premise generate enough story?)
- Alignment with monetisation lane expectations

Both CI and GP matter equally for this purpose class.
Do NOT penalise for lacking scene-level craft detail — this is a concept/framing document.`,

  PACKAGING_COMMERCIAL: `SCORING RUBRIC (PURPOSE: PACKAGING_COMMERCIAL):
This document is a commercial-facing output. Its job is to communicate market promise,
positioning, and finance/pitch readiness.

GP (Commercial Viability) is the PRIMARY scoring axis:
- Audience targeting clarity and specificity
- Market positioning — is the unique angle and gap clearly articulated?
- Comparable titles — are comps current, genuinely comparable, and used to make an argument?
- Budget alignment and production feasibility
- Distribution strategy and platform fit
- Revenue model and monetisation logic

CI (Clarity and Argument Quality) is secondary:
- Is the commercial argument clear and internally consistent?
- Is the language precise and pitch-ready?
- Does the document make the case it sets out to make?

Do NOT score narrative craft, character depth, or thematic complexity for packaging documents.
Do NOT penalise a market sheet or deck for lacking character development.`,

  SCRIPT_EXECUTION: `SCORING RUBRIC (PURPOSE: SCRIPT_EXECUTION):
This document is executable story delivery in script or production-ready form.

CI (Creative Integrity) evaluates:
- Dialogue craft, scene dynamics, character voice
- Structural integrity and pacing
- Thematic coherence and emotional conviction
- Visual storytelling and dramatic impact

GP (Greenlight Probability) evaluates:
- Production feasibility relative to stated budget and format
- Audience clarity and hook strength
- Packaging magnetism (castability, concept clarity for this format)
- Commercial viability of the produced work

Both CI and GP matter. Score relative to the declared format and lane.`,
};


// ── Purpose-Aware Rewrite Goals ──
// Replaces the universal "Strengthen escalation and improve packaging magnetism organically"
// with a purpose-appropriate rewrite objective.

export const PURPOSE_REWRITE_GOALS: Record<DocPurposeClass, string> = {

  DEVELOPMENT_ARCHITECTURE:
    `- Deepen the creative architecture: character specificity, structural clarity, thematic integration, arc completeness.
- Resolve the structural and developmental issues in the approved notes exactly as directed.
- Do NOT introduce packaging language, commercial framing, or pitch-facing language — this is an internal development document.
- Do NOT flatten creative specificity for commercial legibility.
- Strengthen what is already strong; repair what the notes identify as weak.
- OUTPUT THE COMPLETE DOCUMENT — all sections, all characters/beats/acts — do not truncate.`,

  PREMISE_POSITIONING:
    `- Strengthen premise clarity, hook specificity, and commercial legibility.
- Deepen emotional conviction and thematic coherence at concept level.
- Apply approved notes to improve both creative integrity and market viability.
- Strengthen escalation logic and concept viability.
- Do not flatten voice for minor commercial gain.`,

  PACKAGING_COMMERCIAL:
    `- Sharpen commercial argument, positioning clarity, and market specificity.
- Strengthen comps, audience targeting, and distribution logic.
- Apply approved notes to improve commercial viability and pitch readiness.
- Improve packaging magnetism and buyer-facing clarity organically.
- Do NOT introduce narrative depth or character backstory unless explicitly requested.`,

  SCRIPT_EXECUTION:
    `- Strengthen dialogue craft, scene dynamics, and dramatic impact.
- Improve pacing, character voice, and structural integrity.
- Apply approved notes to improve script quality and production readiness.
- Strengthen escalation and improve packaging magnetism organically.
- Maintain proper format for the deliverable type (screenplay, episode script, etc.).`,
};
