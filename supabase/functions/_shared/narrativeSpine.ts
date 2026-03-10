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
