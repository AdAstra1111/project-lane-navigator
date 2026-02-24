/**
 * Shared LLM wrapper for all IFFY edge functions.
 * Centralizes AI gateway calls, system prompt composition, and JSON parsing.
 */

// ─── Constants ───

export const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export const MODELS = {
  PRO: "google/gemini-2.5-pro",
  BALANCED: "google/gemini-3-flash-preview",
  FAST: "google/gemini-2.5-flash",
  FAST_LITE: "google/gemini-2.5-flash-lite",
} as const;

// ─── Types ───

export interface ComposeSystemOptions {
  baseSystem: string;
  guardrailsBlock?: string;
  conditioningBlock?: string;
  corpusBlock?: string;
  additionalBlocks?: string[];
}

export interface CallLLMOptions {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  retries?: number;
  tools?: any[];
  toolChoice?: any;
}

export interface CallLLMResult {
  content: string;
  toolCalls?: any[];
  raw: any;
}

// ─── System Prompt Composer ───

/**
 * Compose a system prompt from base + guardrails + conditioning + corpus blocks.
 * Each block is separated by a newline. Null/empty blocks are skipped.
 */
export function composeSystem(opts: ComposeSystemOptions): string {
  const parts = [
    opts.baseSystem,
    opts.guardrailsBlock,
    opts.conditioningBlock,
    opts.corpusBlock,
    ...(opts.additionalBlocks || []),
  ].filter((p): p is string => !!p && p.trim().length > 0);

  return parts.join("\n\n");
}

// ─── JSON Extraction ───

/**
 * Extract JSON from AI response text, handling markdown fences, preamble, and truncation.
 */
export function extractJSON(raw: string): string {
  let c = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
  if (!c.trim().startsWith("{") && !c.trim().startsWith("[")) {
    const i = c.indexOf("{");
    if (i >= 0) c = c.slice(i);
  }
  const last = c.lastIndexOf("}");
  if (last >= 0) c = c.slice(0, last + 1);
  return c.trim();
}

/**
 * Safely parse JSON from AI output. Falls back to AI-powered repair if initial parse fails.
 * @deprecated Use parseAiJson / callLLMWithJsonRetry for new code.
 * TODO: Remove after all call sites migrated. Search: parseJsonSafe(
 */
export async function parseJsonSafe(raw: string, apiKey?: string): Promise<any> {
  try {
    return JSON.parse(extractJSON(raw));
  } catch {
    if (!apiKey) throw new Error("Unparseable JSON and no apiKey for repair");
    const repairResult = await callLLM({
      apiKey,
      model: MODELS.FAST,
      system: "Fix this malformed JSON. Return ONLY valid JSON, no commentary.",
      user: raw.slice(0, 6000),
      temperature: 0,
      maxTokens: 4000,
    });
    return JSON.parse(extractJSON(repairResult.content));
  }
}

// ─── Robust AI JSON Parsing (v2) ───

function logParseTelemetry(raw: string, handler: string, model: string, phase: string, repairAttempted: boolean, retryTriggered: boolean) {
  console.error(JSON.stringify({
    type: "AI_JSON_PARSE_ERROR",
    phase, handler, model,
    responseLength: raw.length,
    excerptStart: raw.slice(0, 300),
    excerptEnd: raw.slice(-300),
    repairAttempted, retryTriggered,
  }));
}

/**
 * Extract + structurally repair JSON from raw LLM text.
 * Handles: markdown fences, preamble, trailing commas, truncation, unbalanced brackets.
 */
function extractAndRepairJson(raw: string): any {
  let c = raw.replace(/```(?:json)?\s*\n?/gi, "").replace(/\n?```\s*$/g, "").trim();

  const arrStart = c.indexOf("[");
  const objStart = c.indexOf("{");
  if (arrStart === -1 && objStart === -1) throw new Error("No JSON structure found");
  const start = arrStart === -1 ? objStart : objStart === -1 ? arrStart : Math.min(arrStart, objStart);
  c = c.slice(start);

  // First attempt
  try { return JSON.parse(c); } catch { /* repair */ }

  // Repair: trailing commas, control chars
  c = c.replace(/,\s*([}\]])/g, "$1");
  c = c.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Truncation: if braces unbalanced, trim to last complete }
  if ((c.match(/{/g) || []).length > (c.match(/}/g) || []).length) {
    const last = c.lastIndexOf("}");
    if (last > 0) c = c.slice(0, last + 1).replace(/,\s*$/, "");
  }
  // Close remaining open brackets
  let missing = (c.match(/\[/g) || []).length - (c.match(/\]/g) || []).length;
  while (missing-- > 0) c += "]";
  missing = (c.match(/{/g) || []).length - (c.match(/}/g) || []).length;
  while (missing-- > 0) c += "}";

  return JSON.parse(c); // throws if still invalid
}

/** Structured error thrown on all AI JSON parse/validation failures. */
export interface AiJsonParseError {
  type: "AI_JSON_PARSE_ERROR";
  handler: string;
  model: string;
  phase: string;
  responseLength: number;
  excerptStart: string;
  excerptEnd: string;
}

function makeParseError(raw: string, handler: string, model: string, phase: string, detail: string): Error & AiJsonParseError {
  const e = new Error(`AI_JSON_PARSE_ERROR [${handler}]: ${detail}`) as Error & AiJsonParseError;
  e.type = "AI_JSON_PARSE_ERROR";
  e.handler = handler;
  e.model = model;
  e.phase = phase;
  e.responseLength = raw.length;
  e.excerptStart = raw.slice(0, 300);
  e.excerptEnd = raw.slice(-300);
  return e;
}

/**
 * parseAiJson<T> — Centralized robust AI JSON parser with optional schema validation.
 */
export function parseAiJson<T = any>(
  raw: string,
  opts?: { handler?: string; model?: string; validate?: (data: any) => data is T },
): T {
  const handler = opts?.handler || "unknown";
  const model = opts?.model || "unknown";

  let parsed: any;
  try {
    parsed = extractAndRepairJson(raw);
  } catch (err: any) {
    logParseTelemetry(raw, handler, model, "extract_repair", true, false);
    throw makeParseError(raw, handler, model, "extract_repair", err.message);
  }

  if (opts?.validate && !opts.validate(parsed)) {
    logParseTelemetry(raw, handler, model, "schema_validation", false, false);
    throw makeParseError(raw, handler, model, "schema_validation", "schema validation failed");
  }

  return parsed as T;
}

/**
 * callLLMWithJsonRetry<T> — Call LLM, parse JSON, validate schema.
 * Max 1 retry with stricter prompt on failure. Never infinite.
 */
export async function callLLMWithJsonRetry<T = any>(
  llmOpts: CallLLMOptions,
  parseOpts: { handler: string; validate?: (data: any) => data is T },
): Promise<T> {
  const { handler, validate } = parseOpts;
  const model = llmOpts.model;

  // Attempt 1
  const r1 = await callLLM(llmOpts);
  try {
    return parseAiJson<T>(r1.content, { handler, model, validate });
  } catch {
    logParseTelemetry(r1.content, handler, model, "attempt_1_failed", true, true);
  }

  // Attempt 2 — stricter instruction
  const r2 = await callLLM({
    ...llmOpts,
    system: llmOpts.system + "\n\nCRITICAL: Return ONLY valid minified JSON. No markdown. No commentary. No backticks. Start with { or [.",
  });
  return parseAiJson<T>(r2.content, { handler, model, validate });
}

// ─── Chunked LLM Calls (Input Batching) ───

export interface ChunkedLLMOptions<TItem, TResult> {
  /** Base LLM options (system prompt, model, etc). user field is ignored — built per batch. */
  llmOpts: Omit<CallLLMOptions, "user">;
  /** All input items to process. */
  items: TItem[];
  /** Max items per batch. */
  batchSize: number;
  /** Hard cap on number of batches (prevents runaway). Default 8. */
  maxBatches?: number;
  /** Build the user prompt for a batch of items. */
  buildUserPrompt: (batch: TItem[], batchIndex: number, totalBatches: number) => string;
  /** Validate each batch result. */
  validate: (data: any) => data is TResult;
  /** Extract the array of items from a batch result. */
  extractItems: (result: TResult) => any[];
  /** Handler name for telemetry. */
  handler: string;
  /** Extract a unique key from each output item. Enables deduplication. */
  getKey?: (item: any) => string;
  /** When getKey is provided, deduplicate items. First-write-wins. Default true. */
  dedupe?: boolean;
  /** Called after each batch with extracted items for custom validation/telemetry. */
  onBatchResult?: (batchIndex: number, extractedItems: any[]) => void;
  /** Post-process all combined items before returning. */
  finalize?: (allItems: any[]) => any[];
}

/**
 * callLLMChunked — Splits input into batches, calls LLM per batch with retry,
 * combines results. Prevents truncation by keeping each call small.
 * Hard-capped at maxBatches (default 8).
 */
export async function callLLMChunked<TItem, TResult>(
  opts: ChunkedLLMOptions<TItem, TResult>,
): Promise<any[]> {
  const { llmOpts, items, batchSize, handler, validate, extractItems, buildUserPrompt } = opts;
  const maxBatches = opts.maxBatches ?? 8;

  if (items.length === 0) return [];

  const batches: TItem[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  if (batches.length > maxBatches) {
    throw new Error(`${handler}: input requires ${batches.length} batches but max is ${maxBatches}. Reduce input size.`);
  }

  const { getKey, dedupe = true, onBatchResult, finalize } = opts;
  const allItems: any[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const userPrompt = buildUserPrompt(batch, i, batches.length);

    console.error(JSON.stringify({
      type: "CHUNKED_LLM_BATCH",
      handler,
      model: llmOpts.model,
      batch: i + 1,
      totalBatches: batches.length,
      batchItemCount: batch.length,
    }));

    const result = await callLLMWithJsonRetry<TResult>(
      { ...llmOpts, user: userPrompt } as CallLLMOptions,
      { handler: `${handler}_batch_${i + 1}`, validate },
    );

    const extracted = extractItems(result);

    if (onBatchResult) onBatchResult(i, extracted);

    if (getKey && dedupe) {
      for (const item of extracted) {
        const key = getKey(item);
        if (seenKeys.has(key)) {
          console.error(JSON.stringify({
            type: "CHUNKED_LLM_DUPLICATE",
            handler,
            model: llmOpts.model,
            duplicateKey: key,
            batch: i + 1,
          }));
          continue; // first-write-wins
        }
        seenKeys.add(key);
        allItems.push(item);
      }
    } else {
      allItems.push(...extracted);
    }
  }

  return finalize ? finalize(allItems) : allItems;
}

// ─── Core LLM Caller ───

/**
 * Unified fetch wrapper for the Lovable AI Gateway.
 * Handles retries with exponential backoff for 500+ errors and empty responses.
 * Surfaces 429/402 as typed errors for upstream handling.
 */
export async function callLLM(opts: CallLLMOptions): Promise<CallLLMResult> {
  const { apiKey, model, system, user, temperature = 0.3, maxTokens = 6000, retries = 3, tools, toolChoice } = opts;

  for (let attempt = 0; attempt < retries; attempt++) {
    const body: any = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    };
    if (tools) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;

    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) throw new Error("RATE_LIMIT");
    if (response.status === 402) throw new Error("PAYMENT_REQUIRED");

    if (response.ok) {
      const text = await response.text();
      if (!text || text.trim().length === 0) {
        console.error(`Empty AI response (attempt ${attempt + 1}/${retries})`);
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
          continue;
        }
        throw new Error("AI returned empty response after retries");
      }

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        // Try recovering truncated JSON
        const lastBrace = text.lastIndexOf("}");
        if (lastBrace > 0) {
          try {
            data = JSON.parse(text.substring(0, lastBrace + 1));
            console.warn("Recovered truncated JSON from AI response");
          } catch {
            throw new Error("AI returned unparseable response");
          }
        } else {
          throw new Error("AI returned unparseable response");
        }
      }

      const msg = data.choices?.[0]?.message;
      return {
        content: msg?.content || "",
        toolCalls: msg?.tool_calls,
        raw: data,
      };
    }

    const errText = await response.text();
    console.error(`AI error (attempt ${attempt + 1}/${retries}):`, response.status, errText);
    if (response.status >= 500 && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
      continue;
    }
    throw new Error(`AI call failed: ${response.status}`);
  }
  throw new Error("AI call failed after retries");
}
