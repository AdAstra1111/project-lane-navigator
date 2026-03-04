/**
 * Character Pressure Matrix v1 (CPM_V1)
 * Feature-flagged OFF by default. When ON, enriches Episode Grid
 * generation, evaluation, and repair with character-driven structure.
 *
 * No schema drift: all outputs are plaintext fields within existing
 * Episode Grid format.
 */

// ── Feature Flag (runtime-toggleable via env var) ──
// Set Edge secret CHARACTER_PRESSURE_MATRIX_V1=true to enable. No code edits needed.
export function isCPMEnabled(): boolean {
  try {
    return Deno.env.get("CHARACTER_PRESSURE_MATRIX_V1") === "true";
  } catch {
    return false;
  }
}

// ── Required CP fields per episode ──
export const CP_FIELDS = [
  "pressure_source",
  "internal_dilemma",
  "relationship_shift",
  "micro_transformation",
  "cliffhanger_cause",
] as const;

export type CPField = typeof CP_FIELDS[number];

export const CP_FIELD_DESCRIPTIONS: Record<CPField, string> = {
  pressure_source: "Who or what applies pressure on the protagonist(s) in this episode",
  internal_dilemma: "The want-vs-need or moral conflict the character faces",
  relationship_shift: "How a key relationship changes (ally/enemy, trust shift, triangle move)",
  micro_transformation: "What belief or behavior shifts by the end of this episode",
  cliffhanger_cause: "A consequence of a character CHOICE (not random event) that hooks into next episode",
};

// ── Generation prompt block (injected into system prompt when flag ON) ──
export const CPM_GENERATION_PROMPT_BLOCK = `
## CHARACTER PRESSURE MATRIX (MANDATORY FOR EVERY EPISODE)

For EACH episode in the grid, you MUST include ALL of the following labeled fields:

- **EPISODE FUNCTION**: One sentence stating why this episode exists in the season arc (what it accomplishes structurally).
- **pressure_source**: ${CP_FIELD_DESCRIPTIONS.pressure_source}
- **internal_dilemma**: ${CP_FIELD_DESCRIPTIONS.internal_dilemma}
- **relationship_shift**: ${CP_FIELD_DESCRIPTIONS.relationship_shift}
- **micro_transformation**: ${CP_FIELD_DESCRIPTIONS.micro_transformation}
- **cliffhanger_cause**: ${CP_FIELD_DESCRIPTIONS.cliffhanger_cause}

RULES:
1. Every episode row MUST contain all 5 CP fields + EPISODE FUNCTION. No exceptions.
2. Do NOT use generic plot summaries without these labeled fields.
3. Each field must be specific to this episode — no placeholder text.
4. pressure_source must name a specific character or force from the canon.
5. cliffhanger_cause must stem from a CHARACTER CHOICE, not coincidence or external random events.
6. Preserve all canon decisions (decision_ledger active entries). Do NOT invent new named entities not in the canon.
`;

// ── Evaluation prompt extension (injected into eval system prompt when flag ON) ──
export const CPM_EVAL_PROMPT_EXTENSION = `
Additionally, evaluate CHARACTER PRESSURE MATRIX compliance:
- Does EVERY episode include: pressure_source, internal_dilemma, relationship_shift, micro_transformation, cliffhanger_cause, and EPISODE FUNCTION?
- Are pressure_sources specific named characters/forces (not generic)?
- Are cliffhanger_causes driven by character choices (not random events)?
- Do micro_transformations show genuine belief/behavior shifts?
Score harshly if ANY episode is missing CP fields. Missing CP fields = blocking issue.
`;

// ── Repair targeting ──

export interface CPMissingFieldReport {
  episodeIndex: number;
  episodeLabel: string;
  missingFields: CPField[];
}

/**
 * Scan evaluator blockers/notes for CP-related deficiencies.
 * Returns targeted repair instructions for specific episodes.
 * Returns null if blockers are empty (fail-closed: no freeform repair).
 */
export function buildCPRepairDirections(
  blockers: any[],
  highImpactNotes: any[],
): { directions: string[]; failClosed: boolean; reason?: string } {
  if (!blockers.length && !highImpactNotes.length) {
    return {
      directions: [],
      failClosed: true,
      reason: "MISSING_BLOCKERS_FOR_CP_REPAIR",
    };
  }

  const allNotes = [...blockers, ...highImpactNotes];
  const directions: string[] = [
    "CHARACTER PRESSURE MATRIX REPAIR — TARGETED FIXES ONLY:",
    "For each episode flagged below, add or strengthen the missing/weak CP fields.",
    "Do NOT remove already-strong CP fields from any episode.",
    "Apply minimal edits: patch only the flagged episodes/rows when possible.",
    "",
  ];

  // Extract episode-specific mentions from blockers
  const epMentions = new Set<string>();
  for (const note of allNotes) {
    const text = typeof note === "string" ? note : (note?.text || note?.note || note?.detail || JSON.stringify(note));
    // Look for episode references
    const epMatches = text.match(/episode\s*(\d+)/gi);
    if (epMatches) {
      for (const m of epMatches) epMentions.add(m);
    }
    // Look for CP field references
    for (const field of CP_FIELDS) {
      if (text.toLowerCase().includes(field.replace(/_/g, " ")) || text.toLowerCase().includes(field)) {
        directions.push(`- Fix: ${field} — ${text.slice(0, 200)}`);
      }
    }
  }

  if (epMentions.size > 0) {
    directions.push(`Episodes requiring attention: ${[...epMentions].join(", ")}`);
  }

  // Generic CP strengthening if no specific field mentions found
  if (directions.length <= 5) {
    directions.push(
      "Ensure ALL episodes have complete CP fields: pressure_source, internal_dilemma, relationship_shift, micro_transformation, cliffhanger_cause.",
      "Ensure every episode has an EPISODE FUNCTION statement.",
      "Make cliffhanger_cause derive from a CHARACTER CHOICE, not coincidence.",
    );
  }

  return { directions, failClosed: false };
}

/**
 * IEL log helper for CPM events.
 */
export function logCPM(tag: string, data: Record<string, unknown>): void {
  console.log(`[narrative][IEL] ${tag} ${JSON.stringify(data)}`);
}
