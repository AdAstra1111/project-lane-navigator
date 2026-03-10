/**
 * Narrative Spine Foundation — canonical shared types, metadata, validators, and helpers.
 * 9-axis structural story constraints locked at DevSeed level.
 *
 * Canonical location: supabase/functions/_shared/narrativeSpine.ts
 * Do NOT redefine these types elsewhere. This is the authoritative source.
 *
 * Spec: docs/narrative-spine-v1.md
 */

// ── 3 new string literal unions (story_engine / pressure_system / central_conflict reuse existing enums) ──

export const PROTAGONIST_ARCS = [
  'redemption',
  'corruption',
  'revelation',
  'survival',
  'transcendence',
  'sacrifice',
  'coming_of_age',
  'revenge',
  'acceptance',
  'disillusionment',
  'awakening',
] as const;
export type ProtagonistArc = typeof PROTAGONIST_ARCS[number];

export const MIDPOINT_REVERSALS = [
  'false_victory',
  'false_defeat',
  'revelation',
  'mirror_moment',
  'point_of_no_return',
  'betrayal',
  'ally_betrayal',
  'identity_reveal',
  'power_shift',
  'sacrifice',
] as const;
export type MidpointReversal = typeof MIDPOINT_REVERSALS[number];

export const TONAL_GRAVITIES = [
  'tragedy',
  'catharsis',
  'triumph',
  'ambiguity',
  'irony',
  'elegy',
  'satire',
  'dark',
  'bittersweet',
  'hopeful',
  'playful',
] as const;
export type TonalGravity = typeof TONAL_GRAVITIES[number];

// ── NarrativeSpine — the 9-axis structural lock ──

export interface NarrativeSpine {
  /** Repeatable narrative mechanism (maps to StoryEngine enum) */
  story_engine: string | null;
  /** Causal logic driving the drama (maps to CausalGrammar enum) */
  pressure_system: string | null;
  /** Primary conflict topology (maps to ConflictMode enum) */
  central_conflict: string | null;
  /** Category of the inciting event */
  inciting_incident: string | null;
  /** How the story ends / resolution shape */
  resolution_type: string | null;
  /** Stakes category / scale */
  stakes_class: string | null;
  /** Protagonist's transformation arc */
  protagonist_arc: ProtagonistArc | null;
  /** The structural reversal at the story midpoint */
  midpoint_reversal: MidpointReversal | null;
  /** Overall tonal gravity / emotional register */
  tonal_gravity: TonalGravity | null;
}

export const SPINE_AXES = [
  'story_engine',
  'pressure_system',
  'central_conflict',
  'inciting_incident',
  'resolution_type',
  'stakes_class',
  'protagonist_arc',
  'midpoint_reversal',
  'tonal_gravity',
] as const;
export type SpineAxis = typeof SPINE_AXES[number];

export const NARRATIVE_SPINE_EMPTY: NarrativeSpine = {
  story_engine:      null,
  pressure_system:   null,
  central_conflict:  null,
  inciting_incident: null,
  resolution_type:   null,
  stakes_class:      null,
  protagonist_arc:   null,
  midpoint_reversal: null,
  tonal_gravity:     null,
};

// ── Axis Metadata — canonical classification per spec ──

export type InheritanceClass = 'A' | 'B' | 'S' | 'C';
export type AmendmentSeverity = 'constitutional' | 'severe' | 'severe_moderate' | 'moderate' | 'light';

export interface AxisMeta {
  /** Human-readable label */
  label: string;
  /** Inheritance class per spec: A=Constitutional, B=Bounded, S=Scope-specific, C=Expressive */
  class: InheritanceClass;
  /** Constitutional severity of changing this axis after lock */
  severity: AmendmentSeverity;
  /**
   * Earliest stage that must revalidate on amendment.
   * 'next_unapproved' = caller resolves to next unapproved stage at amendment time.
   */
  revalidationFloor: string | 'next_unapproved';
  /** One-line description for UI */
  description: string;
}

export const AXIS_METADATA: Record<SpineAxis, AxisMeta> = {
  story_engine: {
    label:             'Story Engine',
    class:             'A',
    severity:          'constitutional',
    revalidationFloor: 'concept_brief',
    description:       'The dominant narrative mechanism — what drives the story forward.',
  },
  protagonist_arc: {
    label:             'Protagonist Arc',
    class:             'A',
    severity:          'constitutional',
    revalidationFloor: 'concept_brief',
    description:       'The internal transformation journey of the central protagonist.',
  },
  pressure_system: {
    label:             'Pressure System',
    class:             'B',
    severity:          'severe',
    revalidationFloor: 'concept_brief',
    description:       'The causal grammar of the conflict — how pressure is applied.',
  },
  central_conflict: {
    label:             'Central Conflict',
    class:             'B',
    severity:          'severe_moderate',
    revalidationFloor: 'character_bible',
    description:       'The dominant constitutional conflict topology of the project.',
  },
  resolution_type: {
    label:             'Resolution Type',
    class:             'B',
    severity:          'moderate',
    revalidationFloor: 'season_arc',
    description:       'The constitutional end-state promise — how the story resolves.',
  },
  stakes_class: {
    label:             'Stakes Class',
    class:             'B',
    severity:          'moderate',
    revalidationFloor: 'concept_brief',
    description:       'The emotional register of what is at risk.',
  },
  inciting_incident: {
    label:             'Inciting Incident',
    class:             'S',
    severity:          'moderate',
    revalidationFloor: 'concept_brief',
    description:       'The structural trigger category that begins the narrative engine.',
  },
  midpoint_reversal: {
    label:             'Midpoint Reversal',
    class:             'S',
    severity:          'moderate',
    revalidationFloor: 'season_arc',
    description:       'The structural pivot type at the story midpoint.',
  },
  tonal_gravity: {
    label:             'Tonal Gravity',
    class:             'C',
    severity:          'light',
    revalidationFloor: 'next_unapproved',
    description:       'The gravitational emotional register of the project.',
  },
};

// ── Validators ──

/** Returns true if all 9 axes are present as non-null strings */
export function isCompleteSpine(s: unknown): s is NarrativeSpine {
  if (!s || typeof s !== 'object') return false;
  const obj = s as Record<string, unknown>;
  return SPINE_AXES.every(axis => typeof obj[axis] === 'string' && (obj[axis] as string).length > 0);
}

/** Returns count of non-null axes */
export function countSpineAxes(s: NarrativeSpine | null | undefined): number {
  if (!s) return 0;
  return SPINE_AXES.filter(axis => s[axis] !== null && s[axis] !== undefined && s[axis] !== '').length;
}

/** Returns array of missing (null) axis names */
export function getMissingAxes(s: NarrativeSpine | null | undefined): SpineAxis[] {
  if (!s) return [...SPINE_AXES];
  return SPINE_AXES.filter(axis => !s[axis]);
}

// ── Derived Lifecycle State ──

export type SpineLifecycleState = 'none' | 'provisional' | 'confirmed' | 'locked' | 'locked_amended';

/**
 * Derives spine lifecycle state from canonical sources.
 * NO spine_state column exists — state is always computed.
 *
 * none         → no spine JSON on project
 * provisional  → spine JSON exists, no ledger entry
 * confirmed    → ledger entry with status='pending_lock', locked=false
 * locked       → ledger entry with status='active', locked=true, no superseded entries
 * locked_amended → active locked entry + ≥1 superseded entry (amendment history)
 */
export async function getSpineState(
  supabase: any,
  projectId: string
): Promise<{ state: SpineLifecycleState; spine: NarrativeSpine | null; entryId: string | null }> {
  const [{ data: project }, { data: decisions }] = await Promise.all([
    supabase
      .from('projects')
      .select('narrative_spine_json')
      .eq('id', projectId)
      .single(),
    supabase
      .from('decision_ledger')
      .select('id, locked, status, meta, created_at')
      .eq('project_id', projectId)
      .eq('decision_key', 'narrative_spine')
      .order('created_at', { ascending: false }),
  ]);

  const spine: NarrativeSpine | null = project?.narrative_spine_json ?? null;

  if (!spine) return { state: 'none', spine: null, entryId: null };

  const entries = decisions ?? [];
  const activeEntry = entries.find((d: any) => d.status === 'active' && d.locked === true);
  const pendingEntry = entries.find((d: any) => d.status === 'pending_lock' && d.locked === false);
  const supersededEntries = entries.filter((d: any) => d.status === 'superseded');

  if (!activeEntry && !pendingEntry) return { state: 'provisional', spine, entryId: null };
  if (pendingEntry && !activeEntry) return { state: 'confirmed', spine, entryId: pendingEntry.id };
  if (activeEntry && supersededEntries.length > 0) return { state: 'locked_amended', spine, entryId: activeEntry.id };
  if (activeEntry) return { state: 'locked', spine, entryId: activeEntry.id };

  return { state: 'provisional', spine, entryId: null };
}

// ── Amendment Helpers ──

/** Returns constitutional severity for a given axis */
export function getAxisSeverity(axis: SpineAxis): AmendmentSeverity {
  return AXIS_METADATA[axis].severity;
}

/**
 * Returns the stage index (in the given ladder) at which documents must be revalidated
 * when the given axis is amended. Returns -1 if floor is 'next_unapproved' (caller resolves).
 */
export function getRevalidationFloorIndex(axis: SpineAxis, ladder: string[]): number {
  const floor = AXIS_METADATA[axis].revalidationFloor;
  if (floor === 'next_unapproved') return -1; // caller resolves at amendment time
  const idx = ladder.indexOf(floor);
  return idx === -1 ? 0 : idx; // if stage not in ladder, default to start
}

// ── Prompt Injection ──

/**
 * Returns a human-readable summary of the locked spine axes for injection
 * into stage generation prompts. Only includes non-null axes.
 * Includes lifecycle state context (provisional vs locked) in the header.
 */
export function spineToPromptBlock(
  spine: NarrativeSpine | null | undefined,
  state: SpineLifecycleState = 'locked'
): string {
  if (!spine) return '';
  const lines: string[] = [];
  if (spine.story_engine)       lines.push(`- Story Engine: ${spine.story_engine}`);
  if (spine.pressure_system)    lines.push(`- Pressure System: ${spine.pressure_system}`);
  if (spine.central_conflict)   lines.push(`- Central Conflict: ${spine.central_conflict}`);
  if (spine.inciting_incident)  lines.push(`- Inciting Incident: ${spine.inciting_incident}`);
  if (spine.resolution_type)    lines.push(`- Resolution Type: ${spine.resolution_type}`);
  if (spine.stakes_class)       lines.push(`- Stakes: ${spine.stakes_class}`);
  if (spine.protagonist_arc)    lines.push(`- Protagonist Arc: ${spine.protagonist_arc}`);
  if (spine.midpoint_reversal)  lines.push(`- Midpoint Reversal: ${spine.midpoint_reversal}`);
  if (spine.tonal_gravity)      lines.push(`- Tonal Gravity: ${spine.tonal_gravity}`);
  if (lines.length === 0) return '';

  const header = (state === 'locked' || state === 'locked_amended')
    ? 'NARRATIVE SPINE (CONSTITUTIONALLY LOCKED — do not deviate from these structural constraints):'
    : 'NARRATIVE SPINE (Provisional — use as structural guidance):'

  return `\n\n${header}\n${lines.join('\n')}\n`;
}

/**
 * Returns a spine alignment check block for inclusion in reviewer prompts.
 * Only includes axes that are non-null. Tagged as spine_alignment source.
 */
export function spineToReviewerAlignmentBlock(spine: NarrativeSpine | null | undefined): string {
  if (!spine) return '';
  const checks: string[] = [];

  // Class A — Constitutional (highest priority drift risk)
  if (spine.story_engine)
    checks.push(`• [CONSTITUTIONAL] Does the story's core engine match "${spine.story_engine}"? Any deviation here is a structural violation — flag as spine_drift if not.`);
  if (spine.protagonist_arc)
    checks.push(`• [CONSTITUTIONAL] Does the protagonist's journey support the declared arc: "${spine.protagonist_arc}"? Flag as spine_drift if the arc has shifted.`);

  // Class B — Bounded modulation
  if (spine.pressure_system)
    checks.push(`• Does the pressure system driving the story match "${spine.pressure_system}"? Bounded variation is acceptable; structural replacement is not.`);
  if (spine.central_conflict)
    checks.push(`• Is the central conflict recognizably "${spine.central_conflict}"? Flag spine_drift if the conflict has been replaced rather than developed.`);
  if (spine.resolution_type)
    checks.push(`• Does the resolution shape match the declared resolution type: "${spine.resolution_type}"?`);
  if (spine.stakes_class)
    checks.push(`• Are the stakes consistent with the declared stakes class: "${spine.stakes_class}"?`);

  // Class S — Scope-specific
  if (spine.inciting_incident)
    checks.push(`• Does this document's inciting event align with the declared inciting category: "${spine.inciting_incident}"?`);
  if (spine.midpoint_reversal)
    checks.push(`• Does the structural midpoint function as a "${spine.midpoint_reversal}" reversal?`);

  // Class C — Expressive modulation (flag drift only, variation is expected)
  if (spine.tonal_gravity)
    checks.push(`• Does the document's emotional register broadly align with "${spine.tonal_gravity}"? Expressive variation is acceptable but sustained tonal drift should be flagged.`);

  if (checks.length === 0) return '';

  return `\n\nSPINE ALIGNMENT CHECK (advisory — Phase 2 enforcement):
${checks.join('\n')}

For each check above:
- If aligned: no note needed.
- If misaligned but variation is within class bounds: emit a "spine_alignment" high_impact note describing the drift.
- If a Class A axis (story_engine or protagonist_arc) has been replaced: emit a "spine_drift" blocker note — this is a constitutional violation.
All spine findings must include note_source: "spine_alignment" or "spine_drift". These are advisory in v1 — do not block promotion.\n`;
}

// ── Validator coverage registry ──
// Canonical set of spine axes that have dedicated inference-pass coverage.
// Used by the rewrite planner to classify gaps as:
//   "supported but not evaluated on this version" vs "not yet covered by any validator."
// Update this when new validator passes are added (e.g. Class S section targeting).
export const VALIDATOR_SUPPORTED_AXES: ReadonlyArray<SpineAxis> = [
  'story_engine',      // Class A — constitutional exact-match check
  'protagonist_arc',   // Class A — constitutional exact-match check
  'pressure_system',   // Class B — bounded modulation check
  'central_conflict',  // Class B — bounded modulation check
  'resolution_type',   // Class B — bounded modulation check
  'stakes_class',      // Class B — bounded modulation check
] as const;

// Axes explicitly deferred from validator coverage with rationale:
//   inciting_incident  (Class S) — section-specific; deferred until section targeting is available
//   midpoint_reversal  (Class S) — bounded context window misses the document midpoint structurally
//   tonal_gravity      (Class C) — expressive modulation expected; detection threshold too subjective at v1
export const VALIDATOR_DEFERRED_AXES: ReadonlyArray<SpineAxis> = [
  'inciting_incident',
  'midpoint_reversal',
  'tonal_gravity',
] as const;

// ── Class A Spine Check — dedicated comparison pass ──

export const CLASS_A_SPINE_CHECK_DOC_TYPES = new Set([
  'story_outline',
  'character_bible',
  'beat_sheet',
  'feature_script',
  'production_draft',
]);

export interface ClassACheckResult {
  axis: 'story_engine' | 'protagonist_arc';
  status: 'aligned' | 'contradicted' | 'unclear';
  confidence: number;
  evidence: string;
  verbatim_quote: string | null;  // L4.4: exact phrase copied verbatim from document
  suggested_note: {
    category: string;
    severity: string;
    note_source: string;
    title: string;
    instruction: string;
  } | null;
}

export interface ClassASpineCheckOutput {
  checks: ClassACheckResult[];
}

/**
 * Builds the system prompt for the Class A spine check pass.
 * This is a narrow, deterministic comparison — NOT a general review.
 */
export function buildClassASpineCheckSystemPrompt(): string {
  return `You are a constitutional narrative compliance checker.

Your ONLY task: compare a locked Narrative Spine's Class A axes against bounded document evidence and determine whether the document CONTRADICTS the locked spec.

You are NOT reviewing quality, craft, pacing, or any other aspect.
You are checking EXACT SPEC FIDELITY for two axes only:
1. story_engine — the declared narrative mechanism driving the story
2. protagonist_arc — the declared transformation arc of the protagonist

For each axis, determine:
- "aligned" — the document evidence clearly supports the locked axis value
- "contradicted" — the document evidence shows a DIFFERENT mechanism/arc that replaces the locked value
- "unclear" — insufficient evidence to determine alignment or contradiction

CRITICAL RULES:
- A document that DEVELOPS or DEEPENS the locked axis is "aligned", not contradicted.
- A document that has not yet reached the arc's conclusion is "aligned" if trajectory is consistent.
- Only mark "contradicted" when the document has REPLACED the axis with a fundamentally different one.
- Do NOT confuse narrative complexity with contradiction.
- When in doubt, return "unclear" — never invent contradictions.

Respond with ONLY valid JSON matching this exact schema:
{
  "checks": [
    {
      "axis": "story_engine" | "protagonist_arc",
      "status": "aligned" | "contradicted" | "unclear",
      "confidence": <number 0-100>,
      "evidence": "<1-2 sentence explanation>",
      "verbatim_quote": "<exact phrase or sentence copied verbatim from the document — no paraphrasing, no interpretation, punctuation preserved, ≤300 characters; null if status is unclear>",
      "suggested_note": null | {
        "category": "spine_drift",
        "severity": "blocker",
        "note_source": "spine_drift",
        "title": "<concise title>",
        "instruction": "<what must change to restore alignment>"
      }
    }
  ]
}

Rules for suggested_note:
- If status = "aligned" → suggested_note MUST be null
- If status = "unclear" → suggested_note MUST be null
- If status = "contradicted" → suggested_note MUST be present with category="spine_drift", severity="blocker", note_source="spine_drift"

Rules for verbatim_quote:
- MUST be copied character-for-character from the document text above.
- Do NOT paraphrase, summarise, or interpret.
- Must be a phrase or sentence that appears verbatim in the DOCUMENT EVIDENCE section.
- Maximum 300 characters.
- If status is "unclear" (no clear evidence) → set to null.

QUOTE SELECTION PRIORITY (L4.6):
- PREFER quotes from narrative act sections: Setup, Act 1, Inciting Incident, Rising Action, Act 2, Midpoint, Climax, Act 3, Resolution, Character Arc descriptions, Conflict scenes.
- AVOID quoting from preamble material: logline, premise, synopsis, tagline, summary, or any introductory paragraph before the narrative acts begin.
- Reason: quotes from narrative sections enable precise document targeting; preamble quotes do not.
- If ONLY preamble text supports the finding, use it — but prefer act-level evidence when both exist.`;
}

/**
 * Builds the user prompt for the Class A spine check pass.
 * Uses bounded context: last portion of document + protagonist-related sections.
 */
export function buildClassASpineCheckUserPrompt(
  spine: NarrativeSpine,
  docType: string,
  documentText: string,
  projectTitle?: string,
  lane?: string,
): string {
  const storyEngine = spine.story_engine || '(not set)';
  const protagonistArc = spine.protagonist_arc || '(not set)';

  // Bounded context: take first 3000 chars + last 5000 chars (captures setup + climax/resolution)
  const MAX_FRONT = 3000;
  const MAX_BACK = 5000;
  let boundedContext: string;
  if (documentText.length <= MAX_FRONT + MAX_BACK + 500) {
    boundedContext = documentText;
  } else {
    const front = documentText.slice(0, MAX_FRONT);
    const back = documentText.slice(-MAX_BACK);
    boundedContext = `${front}\n\n[... middle section omitted for brevity ...]\n\n${back}`;
  }

  return `LOCKED CLASS A SPINE VALUES (constitutional — these are the authoritative spec):
- Story Engine: "${storyEngine}"
- Protagonist Arc: "${protagonistArc}"

PROJECT: ${projectTitle || 'Unknown'}
LANE: ${lane || 'Unknown'}
DOCUMENT TYPE: ${docType}

DOCUMENT EVIDENCE (bounded excerpt):
${boundedContext}

Compare the document evidence against EACH locked Class A axis value above.
For each axis, determine: aligned, contradicted, or unclear.

IMPORTANT — verbatim_quote selection:
When selecting your verbatim_quote, search for supporting evidence inside the NARRATIVE ACT SECTIONS of the document (Setup, Rising Action, Midpoint, Climax, Resolution) — NOT from the logline, premise, synopsis, or preamble.
Act-level quotes anchor targeting to the actual narrative, not the summary header.
Only fall back to preamble text if no act-level evidence exists.`;
}

/**
 * Validates and parses the Class A spine check output.
 * Returns null if output is invalid.
 */
export function parseClassASpineCheckOutput(parsed: any): ClassASpineCheckOutput | null {
  if (!parsed || !Array.isArray(parsed.checks)) return null;
  const validAxes = new Set(['story_engine', 'protagonist_arc']);
  const validStatuses = new Set(['aligned', 'contradicted', 'unclear']);

  const checks: ClassACheckResult[] = [];
  for (const c of parsed.checks) {
    if (!validAxes.has(c.axis) || !validStatuses.has(c.status)) continue;
    // L4.4: validate verbatim_quote — must be a non-empty string ≤300 chars, or null
    const rawVQ = c.verbatim_quote;
    const verbatimQuote: string | null = (
      typeof rawVQ === 'string' && rawVQ.trim().length >= 5 && rawVQ.trim().length <= 300
    ) ? rawVQ.trim() : null;

    const result: ClassACheckResult = {
      axis: c.axis,
      status: c.status,
      confidence: typeof c.confidence === 'number' ? c.confidence : 50,
      evidence: typeof c.evidence === 'string' ? c.evidence : '',
      verbatim_quote: verbatimQuote,
      suggested_note: null,
    };
    if (c.status === 'contradicted' && c.suggested_note) {
      result.suggested_note = {
        category: 'spine_drift',
        severity: 'blocker',
        note_source: 'spine_drift',
        title: typeof c.suggested_note.title === 'string' ? c.suggested_note.title : `Class A violation: ${c.axis}`,
        instruction: typeof c.suggested_note.instruction === 'string' ? c.suggested_note.instruction : '',
      };
    } else if (c.status === 'contradicted' && !c.suggested_note) {
      // Force a note for contradicted results
      result.suggested_note = {
        category: 'spine_drift',
        severity: 'blocker',
        note_source: 'spine_drift',
        title: `Class A violation: ${c.axis} contradicts locked spine`,
        instruction: c.evidence || 'Realign document with locked spine axis.',
      };
    }
    // Enforce: no note for aligned/unclear
    if (c.status !== 'contradicted') {
      result.suggested_note = null;
    }
    checks.push(result);
  }
  if (checks.length === 0) return null;
  return { checks };
}

// ── Class B Spine Check — bounded modulation pass ──
// Covers pressure_system, central_conflict, resolution_type, stakes_class.
// These axes allow bounded modulation — "developed" is not "contradicted".
// Only structural replacement (fundamentally different mechanism) is a violation.
//
// Excluded axes and rationale:
//   midpoint_reversal (Class S) — bounded context (first+last) systematically misses the midpoint;
//     the middle section is explicitly omitted; confident evaluation is impossible.
//   tonal_gravity (Class C) — expressive modulation is explicitly expected; the detection
//     threshold would need to be so high (sustained drift only) that false positives
//     outweigh signal value at Phase 1.
//   inciting_incident (Class S) — deferred to Phase 2 once section-targeting is available;
//     early-document context is captured in first 3K chars but axis value is a structural
//     category that requires comparison against a specific narrative event, not prose description.

/** Class B axes evaluated in the dedicated check pass */
export const CLASS_B_SPINE_CHECK_AXES = [
  'pressure_system',
  'central_conflict',
  'resolution_type',
  'stakes_class',
] as const satisfies ReadonlyArray<SpineAxis>;

/** Doc types eligible for Class B check — same eligibility as Class A */
export const CLASS_B_SPINE_CHECK_DOC_TYPES = CLASS_A_SPINE_CHECK_DOC_TYPES;

export type ClassBAxis = typeof CLASS_B_SPINE_CHECK_AXES[number];

export interface ClassBCheckResult {
  axis: ClassBAxis;
  status: 'aligned' | 'contradicted' | 'unclear';
  confidence: number;
  evidence: string;
  verbatim_quote: string | null;  // L4.4: exact phrase copied verbatim from document
  suggested_note: {
    category: string;
    severity: string;
    note_source: string;
    title: string;
    instruction: string;
  } | null;
}

export interface ClassBSpineCheckOutput {
  checks: ClassBCheckResult[];
}

/**
 * Builds the system prompt for the Class B spine check pass.
 * Key difference from Class A: development/modulation is acceptable;
 * only structural REPLACEMENT is a violation.
 */
export function buildClassBSpineCheckSystemPrompt(): string {
  return `You are a structural narrative compliance reviewer.

Your ONLY task: compare a locked Narrative Spine's Class B axes against bounded document evidence and determine whether each axis has been REPLACED (structural violation) or remains WITHIN ACCEPTABLE BOUNDS.

You are NOT reviewing quality, craft, pacing, or any other aspect.
You are checking BOUNDED FIDELITY for up to four axes:
1. pressure_system — the causal grammar driving conflict (how pressure is applied)
2. central_conflict — the dominant conflict topology
3. resolution_type — the constitutional end-state promise (how the story resolves)
4. stakes_class — the emotional register of what is at risk

CRITICAL DISTINCTION — Class B allows bounded modulation:
- "aligned" — the document supports, develops, or modulates the locked axis value while preserving its structural core
- "contradicted" — the document evidence shows a FUNDAMENTALLY DIFFERENT mechanism that REPLACES the locked value entirely
- "unclear" — insufficient evidence in this document to determine alignment or contradiction

KEY RULES:
- DEVELOPMENT is not contradiction. A story that evolves its conflict in unexpected directions is aligned if the structural topology is preserved.
- Only mark "contradicted" when the document has REPLACED the axis with a structurally different one — not when it has elaborated, deepened, or modulated it.
- If a document type (e.g., character_bible) would not typically surface an axis (e.g., resolution_type), return "unclear" for that axis.
- When in doubt, return "unclear" — never invent contradictions.
- Only evaluate axes listed in the LOCKED SPINE VALUES section. Skip any axis not provided.
- Do not evaluate more axes than those listed.

Respond with ONLY valid JSON matching this exact schema:
{
  "checks": [
    {
      "axis": "pressure_system" | "central_conflict" | "resolution_type" | "stakes_class",
      "status": "aligned" | "contradicted" | "unclear",
      "confidence": <number 0-100>,
      "evidence": "<1-2 sentence explanation citing document evidence>",
      "verbatim_quote": "<exact phrase or sentence copied verbatim from the document — no paraphrasing, punctuation preserved, ≤300 characters; null if status is unclear>",
      "suggested_note": null | {
        "category": "spine_drift",
        "severity": "high",
        "note_source": "spine_alignment",
        "title": "<concise title>",
        "instruction": "<what must change to restore alignment>"
      }
    }
  ]
}

Rules for suggested_note:
- If status = "aligned" → suggested_note MUST be null
- If status = "unclear" → suggested_note MUST be null
- If status = "contradicted" → suggested_note MUST be present with category="spine_drift", severity="high", note_source="spine_alignment"

Rules for verbatim_quote:
- MUST be copied character-for-character from the document text above.
- Do NOT paraphrase, summarise, or interpret.
- Must appear verbatim in the DOCUMENT EVIDENCE section.
- Maximum 300 characters.
- If status is "unclear" → set to null.

QUOTE SELECTION PRIORITY (L4.6):
- PREFER quotes from narrative act sections: Setup, Act 1, Inciting Incident, Rising Action, Act 2, Midpoint, Climax, Act 3, Resolution, Character Arc descriptions, Conflict scenes, Turning Points.
- AVOID quoting from preamble material: logline, premise, synopsis, tagline, summary, or any introductory paragraph before the narrative acts begin.
- Reason: quotes from narrative sections enable precise document targeting; preamble quotes do not.
- If ONLY preamble text supports the finding, use it — but prefer act-level evidence when both exist.`;
}

/**
 * Builds the user prompt for the Class B spine check pass.
 * Only includes non-null Class B spine axes.
 * Returns empty string if no Class B axes are present (caller must check).
 */
export function buildClassBSpineCheckUserPrompt(
  spine: NarrativeSpine,
  docType: string,
  documentText: string,
  projectTitle?: string,
  lane?: string,
): string {
  const spineLines: string[] = [];
  if (spine.pressure_system)  spineLines.push(`- Pressure System: "${spine.pressure_system}"`);
  if (spine.central_conflict) spineLines.push(`- Central Conflict: "${spine.central_conflict}"`);
  if (spine.resolution_type)  spineLines.push(`- Resolution Type: "${spine.resolution_type}"`);
  if (spine.stakes_class)     spineLines.push(`- Stakes Class: "${spine.stakes_class}"`);

  if (spineLines.length === 0) return '';

  // Same bounded context window as Class A (first 3K + last 5K chars)
  const MAX_FRONT = 3000;
  const MAX_BACK = 5000;
  let boundedContext: string;
  if (documentText.length <= MAX_FRONT + MAX_BACK + 500) {
    boundedContext = documentText;
  } else {
    const front = documentText.slice(0, MAX_FRONT);
    const back = documentText.slice(-MAX_BACK);
    boundedContext = `${front}\n\n[... middle section omitted for brevity ...]\n\n${back}`;
  }

  return `LOCKED CLASS B SPINE VALUES (bounded — structural REPLACEMENT is a violation; development/modulation is acceptable):
${spineLines.join('\n')}

PROJECT: ${projectTitle || 'Unknown'}
LANE: ${lane || 'Unknown'}
DOCUMENT TYPE: ${docType}

DOCUMENT EVIDENCE (bounded excerpt):
${boundedContext}

Compare the document evidence against EACH locked Class B axis value above.
For each axis listed, determine: aligned (supported/developed/modulated), contradicted (structurally replaced), or unclear (insufficient evidence).
Only return results for the axes listed above.

IMPORTANT — verbatim_quote selection:
When selecting your verbatim_quote, search for supporting evidence inside the NARRATIVE ACT SECTIONS of the document (Setup, Rising Action, Midpoint, Climax, Resolution, Character Arc sections, Turning Points) — NOT from the logline, premise, synopsis, or preamble.
Act-level quotes anchor targeting to the actual narrative, not the summary header.
Only fall back to preamble text if no act-level evidence exists.`;
}

/**
 * Validates and parses the Class B spine check output.
 * Returns null if output is invalid or contains no valid checks.
 */
export function parseClassBSpineCheckOutput(parsed: any): ClassBSpineCheckOutput | null {
  if (!parsed || !Array.isArray(parsed.checks)) return null;
  const validAxes = new Set<string>(['pressure_system', 'central_conflict', 'resolution_type', 'stakes_class']);
  const validStatuses = new Set(['aligned', 'contradicted', 'unclear']);

  const checks: ClassBCheckResult[] = [];
  for (const c of parsed.checks) {
    if (!validAxes.has(c.axis) || !validStatuses.has(c.status)) continue;
    // L4.4: validate verbatim_quote — same rules as Class A
    const rawBVQ = c.verbatim_quote;
    const bVerbatimQuote: string | null = (
      typeof rawBVQ === 'string' && rawBVQ.trim().length >= 5 && rawBVQ.trim().length <= 300
    ) ? rawBVQ.trim() : null;

    const result: ClassBCheckResult = {
      axis: c.axis as ClassBAxis,
      status: c.status,
      confidence: typeof c.confidence === 'number' ? c.confidence : 50,
      evidence: typeof c.evidence === 'string' ? c.evidence : '',
      verbatim_quote: bVerbatimQuote,
      suggested_note: null,
    };
    if (c.status === 'contradicted' && c.suggested_note) {
      result.suggested_note = {
        category: 'spine_drift',
        severity: 'high',
        note_source: 'spine_alignment',
        title: typeof c.suggested_note.title === 'string'
          ? c.suggested_note.title
          : `Class B structural drift: ${c.axis}`,
        instruction: typeof c.suggested_note.instruction === 'string'
          ? c.suggested_note.instruction
          : '',
      };
    } else if (c.status === 'contradicted' && !c.suggested_note) {
      // Force a note for contradicted results even when model omits it
      result.suggested_note = {
        category: 'spine_drift',
        severity: 'high',
        note_source: 'spine_alignment',
        title: `Class B structural drift: ${c.axis} contradicts locked spine`,
        instruction: c.evidence || 'Realign document with the locked spine axis.',
      };
    }
    // Enforce: no note for aligned/unclear
    if (c.status !== 'contradicted') {
      result.suggested_note = null;
    }
    checks.push(result);
  }
  if (checks.length === 0) return null;
  return { checks };
}
