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
