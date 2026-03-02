/**
 * Embedding provider using Lovable AI Gateway (same pattern as embed-corpus).
 * Uses tool-calling to extract 1536-dim vectors deterministically.
 */

import { GATEWAY_URL, MODELS } from "./llm.ts";

const DIMENSION = 64;
const EMBEDDING_MODEL = "llm-tool-call-64d"; // logical name for provenance
const MAX_RETRIES = 2;

export { DIMENSION, EMBEDDING_MODEL };

/**
 * Generate a single 1536-dimensional embedding vector.
 * Uses Lovable AI gateway with structured tool output.
 */
export async function createEmbedding(
  text: string,
  apiKey: string,
): Promise<number[]> {
  const truncated = text.slice(0, 12000); // keep payload sane

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODELS.FAST_LITE,
          messages: [
            {
              role: "system",
              content: `You are a semantic fingerprint generator. Produce exactly ${DIMENSION} floating-point numbers between -1 and 1 that capture the semantic meaning of the input text. Each number represents a different semantic axis. Return via the tool call. Output ONLY numbers, no text.`,
            },
            {
              role: "user",
              content: `Generate exactly ${DIMENSION} numbers for this text:\n\n${truncated}`,
            },
          ],
          temperature: 0,
          tools: [
            {
              type: "function",
              function: {
                name: "store_embedding",
                description: "Store a single embedding vector",
                parameters: {
                  type: "object",
                  properties: {
                    embedding: {
                      type: "array",
                      description: `A ${DIMENSION}-dimensional embedding vector`,
                      items: { type: "number" },
                    },
                  },
                  required: ["embedding"],
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "store_embedding" } },
        }),
      });

      if (resp.status === 429) throw new Error("RATE_LIMIT");
      if (resp.status === 402) throw new Error("PAYMENT_REQUIRED");

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Embedding API error (${resp.status}): ${errText}`);
      }

      const data = await resp.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("No tool call in embedding response");

      const parsed = JSON.parse(toolCall.function.arguments);
      const vec = parsed.embedding;

      if (!Array.isArray(vec) || vec.length !== DIMENSION) {
        throw new Error(`Wrong embedding dimension: got ${vec?.length ?? 0}, expected ${DIMENSION}`);
      }

      return vec;
    } catch (e: any) {
      if (e.message === "RATE_LIMIT" || e.message === "PAYMENT_REQUIRED") throw e;
      if (attempt < MAX_RETRIES) {
        console.error(`[embeddingProvider] attempt ${attempt + 1} failed: ${e.message}, retrying...`);
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
      throw e;
    }
  }
  throw new Error("createEmbedding failed after retries");
}
