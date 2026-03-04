/**
 * CI Blocker Gate v1 — Prevents promotion when CI < threshold OR unresolved blockers/high-impact notes exist.
 * Feature flag: CI_BLOCKER_GATE_V1 (default: false)
 * 
 * Usage: call evaluateCIBlockerGate() BEFORE any promotion path, AFTER ensuring fresh review exists.
 */

// ── Feature Flag ──
export function isCIBlockerGateEnabled(): boolean {
  return Deno.env.get("CI_BLOCKER_GATE_V1") === "true";
}

// ── Plateau V2 Feature Flag ──
export function isPlateauV2Enabled(): boolean {
  return Deno.env.get("CI_PLATEAU_V2") === "true";
}

// ── Rewrite Targeting Feature Flag ──
export function isRewriteTargetingEnabled(): boolean {
  return Deno.env.get("REWRITE_TARGETING_V1") === "true";
}

// ── Character Bible Depth Feature Flag ──
export function isCharBibleDepthEnabled(): boolean {
  return Deno.env.get("CHARACTER_BIBLE_DEPTH_V1") === "true";
}

// ── Types ──
export interface CIBlockerGateResult {
  pass: boolean;
  ci: number;
  gp: number;
  gap: number;
  blockerCount: number;
  highImpactCount: number;
  blockReasons: string[];
  provenance: string; // where data came from
}

export interface ReviewPayload {
  ci: number;
  gp: number;
  gap: number;
  blockers: any[];
  highImpactNotes: any[];
  trajectory: string | null;
}

/**
 * Parse the latest review step for the active version from auto_run_steps.
 * Returns structured review payload or null if not found / malformed.
 */
export async function parseLatestReviewForActiveVersion(
  supabase: any,
  jobId: string,
  docType: string,
  activeVersionId: string | null,
): Promise<ReviewPayload | null> {
  // Get latest review step for this doc_type in this job
  const { data: reviewSteps } = await supabase
    .from("auto_run_steps")
    .select("ci, gp, gap, output_ref, output_text, summary")
    .eq("job_id", jobId)
    .eq("document", docType)
    .eq("action", "review")
    .not("ci", "is", null)
    .order("step_index", { ascending: false })
    .limit(5);

  if (!reviewSteps || reviewSteps.length === 0) return null;

  // Find the review for the active version if possible
  let bestReview = reviewSteps[0]; // fallback to latest
  if (activeVersionId) {
    for (const r of reviewSteps) {
      const ref = r.output_ref || {};
      const reviewVersionId = ref.output_version_id || ref.version_id || ref.input_version_id;
      if (reviewVersionId === activeVersionId) {
        bestReview = r;
        break;
      }
    }
  }

  const ref = bestReview.output_ref || {};
  const blockers = ref.blocking_issues || ref.blockers || [];
  const highImpactNotes = ref.high_impact_notes || ref.high_impact || [];
  const trajectory = ref.trajectory || null;

  return {
    ci: bestReview.ci ?? 0,
    gp: bestReview.gp ?? 0,
    gap: bestReview.gap ?? 0,
    blockers: Array.isArray(blockers) ? blockers : [],
    highImpactNotes: Array.isArray(highImpactNotes) ? highImpactNotes : [],
    trajectory,
  };
}

/**
 * Evaluate CI Blocker Gate.
 * Returns pass=false if:
 *   (a) CI < minCI, OR
 *   (b) any blocking_issues with apply_timing="now" exist, OR
 *   (c) high_impact_notes count > highImpactThreshold
 * 
 * Fail-closed: if review payload is missing required fields, returns pass=false.
 */
export function evaluateCIBlockerGateFromPayload(
  review: ReviewPayload | null,
  minCI: number = 90,
  highImpactThreshold: number = 3,
): CIBlockerGateResult {
  if (!review) {
    return {
      pass: false,
      ci: 0, gp: 0, gap: 0,
      blockerCount: 0,
      highImpactCount: 0,
      blockReasons: ["fail_closed:no_review_payload"],
      provenance: "missing",
    };
  }

  const blockReasons: string[] = [];

  // (a) CI threshold
  if (review.ci < minCI) {
    blockReasons.push(`ci_below_threshold:${review.ci}<${minCI}`);
  }

  // (b) Blockers with apply_timing="now" (or no timing specified = default now)
  const nowBlockers = review.blockers.filter((b: any) => {
    const timing = b?.apply_timing || "now";
    return timing === "now";
  });
  if (nowBlockers.length > 0) {
    blockReasons.push(`active_blockers:${nowBlockers.length}`);
  }

  // (c) High impact notes above threshold
  const nowHighImpact = review.highImpactNotes.filter((n: any) => {
    const timing = n?.apply_timing || "now";
    return timing === "now";
  });
  if (nowHighImpact.length > highImpactThreshold) {
    blockReasons.push(`high_impact_above_threshold:${nowHighImpact.length}>${highImpactThreshold}`);
  }

  return {
    pass: blockReasons.length === 0,
    ci: review.ci,
    gp: review.gp,
    gap: review.gap,
    blockerCount: nowBlockers.length,
    highImpactCount: nowHighImpact.length,
    blockReasons,
    provenance: "auto_run_steps_review",
  };
}

// ── Plateau V2: Composite plateau check ──
export interface PlateauV2Result {
  isPlateaued: boolean;
  ciDelta: number;
  blockerCountDelta: number;
  highImpactCountDelta: number;
  currentCI: number;
  currentBlockerCount: number;
  currentHighImpactCount: number;
  reason: string;
}

/**
 * Composite plateau check: plateau only when CI not improving AND notes not shrinking.
 * Requires at least 2 review steps to evaluate.
 */
export async function checkPlateauV2(
  supabase: any,
  jobId: string,
  docType: string,
  minCI: number,
  windowSize: number = 2,
): Promise<PlateauV2Result> {
  const { data: recentReviews } = await supabase
    .from("auto_run_steps")
    .select("ci, output_ref, step_index")
    .eq("job_id", jobId)
    .eq("document", docType)
    .eq("action", "review")
    .not("ci", "is", null)
    .order("step_index", { ascending: false })
    .limit(windowSize + 2);

  if (!recentReviews || recentReviews.length < 2) {
    return {
      isPlateaued: false,
      ciDelta: 0, blockerCountDelta: 0, highImpactCountDelta: 0,
      currentCI: recentReviews?.[0]?.ci ?? 0,
      currentBlockerCount: 0, currentHighImpactCount: 0,
      reason: "insufficient_data",
    };
  }

  const current = recentReviews[0];
  const previous = recentReviews[1];

  const currentCI = current.ci ?? 0;
  const previousCI = previous.ci ?? 0;
  const ciDelta = currentCI - previousCI;

  // Extract blocker/high-impact counts from output_ref
  const extractCounts = (step: any) => {
    const ref = step?.output_ref || {};
    const blockers = ref.blocking_issues || ref.blockers || [];
    const highImpact = ref.high_impact_notes || ref.high_impact || [];
    return {
      blockerCount: Array.isArray(blockers) ? blockers.filter((b: any) => (b?.apply_timing || "now") === "now").length : 0,
      highImpactCount: Array.isArray(highImpact) ? highImpact.filter((n: any) => (n?.apply_timing || "now") === "now").length : 0,
    };
  };

  const currentCounts = extractCounts(current);
  const previousCounts = extractCounts(previous);

  const blockerCountDelta = currentCounts.blockerCount - previousCounts.blockerCount;
  const highImpactCountDelta = currentCounts.highImpactCount - previousCounts.highImpactCount;

  // Plateau = CI not improving AND (blockers not decreasing AND high-impact not decreasing)
  const ciNotImproving = ciDelta < 1; // less than CI_MIN_DELTA
  const notesNotShrinking = blockerCountDelta >= 0 && highImpactCountDelta >= 0;

  // Check consecutive non-improving window
  let consecutiveNonImproving = 0;
  for (let i = 0; i < recentReviews.length - 1; i++) {
    if ((recentReviews[i].ci ?? 0) < (recentReviews[i + 1].ci ?? 0) + 1) {
      consecutiveNonImproving++;
    } else {
      break;
    }
  }

  const isPlateaued = currentCI < minCI && ciNotImproving && notesNotShrinking && consecutiveNonImproving >= windowSize;

  return {
    isPlateaued,
    ciDelta,
    blockerCountDelta,
    highImpactCountDelta,
    currentCI,
    currentBlockerCount: currentCounts.blockerCount,
    currentHighImpactCount: currentCounts.highImpactCount,
    reason: isPlateaued
      ? `plateau_v2:ci_delta=${ciDelta},blocker_delta=${blockerCountDelta},hi_delta=${highImpactCountDelta},window=${consecutiveNonImproving}`
      : "not_plateaued",
  };
}

// ── Rewrite Targeting Compiler ──
export interface RewriteDirective {
  index: number;
  noteId: string;
  category: string;
  severity: string;
  directive: string;
  episodeIndex?: number; // for episode_grid row targeting
}

/**
 * Compile evaluator blockers + highImpactNotes into deterministic rewrite directives.
 * Fail-closed: returns empty array + failClosed=true if notes are absent.
 */
export function compileRewriteDirectives(
  blockers: any[],
  highImpactNotes: any[],
  docType: string,
): { directives: RewriteDirective[]; failClosed: boolean; reason: string } {
  if (!Array.isArray(blockers) && !Array.isArray(highImpactNotes)) {
    return { directives: [], failClosed: true, reason: "no_notes_arrays_provided" };
  }

  const allNotes = [
    ...(blockers || []).map((b: any) => ({ ...b, severity: "blocker" })),
    ...(highImpactNotes || []).map((n: any) => ({ ...n, severity: "high" })),
  ].filter((n: any) => (n?.apply_timing || "now") === "now");

  if (allNotes.length === 0) {
    return { directives: [], failClosed: false, reason: "no_actionable_notes" };
  }

  const directives: RewriteDirective[] = allNotes.map((note: any, i: number) => {
    const directive: RewriteDirective = {
      index: i,
      noteId: note.id || note.note_key || `note_${i}`,
      category: note.category || "general",
      severity: note.severity,
      directive: note.description || note.note || "Fix this issue",
    };

    // Episode-specific targeting for episode_grid
    if (docType === "episode_grid" && note.description) {
      const epMatch = note.description.match(/[Ee]pisode\s*(\d+)/);
      if (epMatch) {
        directive.episodeIndex = parseInt(epMatch[1], 10);
      }
    }

    return directive;
  });

  return { directives, failClosed: false, reason: "compiled" };
}

/**
 * Format compiled directives into rewrite direction strings.
 */
export function formatDirectivesAsDirections(directives: RewriteDirective[], docType: string): string[] {
  if (directives.length === 0) return [];

  const lines: string[] = [
    "TARGETED REWRITE DIRECTIVES (from evaluator — address each specifically):",
  ];

  for (const d of directives) {
    const prefix = d.severity === "blocker" ? "🔴 BLOCKER" : "🟡 HIGH-IMPACT";
    const epTag = d.episodeIndex != null ? ` [Episode ${d.episodeIndex}]` : "";
    lines.push(`${prefix} [${d.category}]${epTag}: ${d.directive}`);
  }

  lines.push("Do NOT rewrite sections not mentioned above unless structurally necessary.");

  return lines;
}

// ── Character Bible Depth Checklist ──
export const CHARACTER_BIBLE_DEPTH_PROMPT_BLOCK = `
## CHARACTER DEPTH CHECKLIST (MANDATORY — each named character MUST have ALL of these)
For EVERY significant character in the bible, you MUST explicitly address:
1. **Clear Wants/Needs** — What do they consciously want vs what they truly need? These must conflict.
2. **Core Contradiction** — What internal contradiction defines them? (e.g., craves connection but sabotages intimacy)
3. **Wound/Backstory** — What formative wound drives their behavior? Be specific, not vague.
4. **Masks/Public Self** — How do they present to the world vs who they really are?
5. **Key Relationships** — Map their dynamic with at least 2 other characters. Show power dynamics, tensions, dependencies.
6. **Pressure Patterns** — How do they respond under pressure? What's their default coping mechanism?
7. **Escalation Arc** — How do they change across the season? What's the trajectory from pilot to finale?
8. **Distinctive Voice** — What makes their dialogue recognizable? Speech patterns, verbal tics, register.
9. **Physicality** — How do they carry themselves? What's their relationship with their body/space?
10. **Moral Line** — What line won't they cross? And what would make them cross it?
11. **Secrets** — What do they hide from other characters? From the audience (if any)?
12. **Thematic Function** — What theme or question does this character embody in the story?

Missing ANY of these for a major character is a structural failure. Minor/recurring characters need at least items 1, 2, 5, 7, 8.
`;

// ── Character Bible Depth Eval Extension ──
export const CHARACTER_BIBLE_DEPTH_EVAL_BLOCK = `
## CHARACTER DEPTH SCORING (MANDATORY for character_bible evaluation)
For each major character, check the Character Depth Checklist:
- wants_needs, contradiction, wound, masks, relationships, pressure_patterns, escalation_arc, voice, physicality, moral_line, secrets, thematic_function
- If ANY major character is missing 3+ items: this is a BLOCKER (severity: blocker, category: character)
- If ANY major character is missing 1-2 items: this is HIGH-IMPACT (severity: high, category: character)  
- Score CI harshly: missing depth items = direct CI penalty. A character bible with shallow characters cannot score above 75 CI regardless of other qualities.
- In your blocking_issues or high_impact_notes, specify WHICH character and WHICH items are missing.
`;
