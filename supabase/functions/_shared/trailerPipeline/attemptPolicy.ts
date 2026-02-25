/**
 * Trailer Clip Attempt — retry policy, prompt hashing, best-attempt selection.
 * Shared between edge functions. No runtime deps beyond Web Crypto.
 */

// ─── Constants ───

export const MAX_ATTEMPTS = 3;
export const PASS_THRESHOLD = 0.75;

/** Failures that trigger an escalated retry regardless of score. */
export const FAILURE_ESCALATE_SET = new Set([
  "FLATLINE",
  "LOW_CONTRAST",
  "NO_ESCALATION",
  "PACING_MISMATCH",
  "TONAL_WHIPLASH",
  "ENERGY_DROP",
]);

/** Detail-bump instruction appended on escalation retries. */
const DETAIL_BUMP = `
IMPORTANT: The previous attempt scored below the quality threshold.
Apply stronger visual specificity: sharper lighting cues, more precise camera angles,
explicit motion choreography, and tighter continuity with surrounding beats.
Do NOT change the core narrative intent — only increase cinematic precision.
`.trim();

// ─── Prompt Hashing ───

export function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function computePromptHash(
  prompt: string,
  settings: Record<string, unknown>,
): Promise<string> {
  const payload = JSON.stringify({
    p: normalizePrompt(prompt),
    s: settings,
  });
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Retry Decision ───

export interface RetryInput {
  evalScore: number | null;
  failures: string[];
  attemptIndex: number;
  maxAttempts?: number;
}

export function shouldRetry(input: RetryInput): boolean {
  const max = input.maxAttempts ?? MAX_ATTEMPTS;
  if (input.attemptIndex + 1 >= max) return false;
  if (input.evalScore == null) return false; // no eval → don't auto-retry
  if (input.evalScore < PASS_THRESHOLD) return true;
  for (const f of input.failures) {
    if (FAILURE_ESCALATE_SET.has(f)) return true;
  }
  return false;
}

// ─── Escalation Ladder ───

export interface EscalationPlan {
  attemptIndex: number;
  model: string;
  promptSuffix: string;
  settingsPatch: Record<string, unknown>;
}

/**
 * Given the current attempt index, return the next escalation plan.
 * Models are specified as symbolic keys — caller maps to actual model strings.
 */
export function nextAttemptPlan(
  currentAttemptIndex: number,
  basePrompt: string,
  baseSettings: Record<string, unknown>,
): EscalationPlan {
  const next = currentAttemptIndex + 1;
  if (next === 1) {
    return {
      attemptIndex: next,
      model: "BALANCED",
      promptSuffix: DETAIL_BUMP,
      settingsPatch: {},
    };
  }
  // attempt 2+
  return {
    attemptIndex: next,
    model: "PRO",
    promptSuffix: DETAIL_BUMP,
    settingsPatch: {},
  };
}

// ─── Best Attempt Selection ───

export interface AttemptRecord {
  id: string;
  attempt_index: number;
  eval_score: number | null;
  completed_at: string | null;
  created_at: string;
  status: string;
}

/**
 * Deterministically pick the best attempt from a list.
 * Priority: highest eval_score → earliest completed_at → earliest created_at → lowest attempt_index.
 * Only considers completed attempts with non-null eval_score.
 * Falls back to latest completed attempt if none have scores.
 */
export function selectBestAttempt(
  attempts: AttemptRecord[],
): AttemptRecord | null {
  const completed = attempts.filter((a) => a.status === "complete");
  if (completed.length === 0) return null;

  const scored = completed.filter((a) => a.eval_score != null);
  const pool = scored.length > 0 ? scored : completed;

  pool.sort((a, b) => {
    // Higher score first
    const sa = a.eval_score ?? -1;
    const sb = b.eval_score ?? -1;
    if (sa !== sb) return sb - sa;
    // Earlier completed_at
    const ca = a.completed_at || "";
    const cb = b.completed_at || "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    // Earlier created_at
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    // Lower attempt_index
    return a.attempt_index - b.attempt_index;
  });

  return pool[0];
}
