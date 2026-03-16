/**
 * Embedding provider using Lovable AI Gateway embeddings endpoint.
 * Calls /v1/embeddings with text-embedding-3-small for deterministic 1536-dim vectors.
 */

const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const DIMENSION = 1536;
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_RETRIES = 3;
/** Max input text length (chars). text-embedding-3-small supports ~8191 tokens. */
const MAX_INPUT_LEN = 8000;

export { DIMENSION, EMBEDDING_MODEL };

/**
 * Generate a single 1536-dimensional embedding vector via the embeddings endpoint.
 * Deterministic: no temperature, no tool-calls, no chat completions.
 */
export async function createEmbedding(
  text: string,
  apiKey: string,
): Promise<number[]> {
  const input = text.slice(0, MAX_INPUT_LEN);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input,
          dimensions: DIMENSION,
        }),
      });

      if (resp.status === 429) throw new Error("RATE_LIMIT");
      if (resp.status === 402) throw new Error("PAYMENT_REQUIRED");

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Embeddings API error (${resp.status}): ${errText}`);
      }

      const data = await resp.json();

      // OpenAI embeddings response: { data: [{ embedding: number[], index: 0 }], model, usage }
      const vec = data?.data?.[0]?.embedding;

      if (!Array.isArray(vec)) {
        throw new Error(`Embeddings response missing data[0].embedding`);
      }

      if (vec.length !== DIMENSION) {
        // Dimension mismatch is a hard error — do NOT retry
        throw Object.assign(
          new Error(`Wrong embedding dimension: got ${vec.length}, expected ${DIMENSION}`),
          { noRetry: true },
        );
      }

      // Validate all values are finite numbers
      for (let i = 0; i < vec.length; i++) {
        if (typeof vec[i] !== "number" || !Number.isFinite(vec[i])) {
          throw Object.assign(
            new Error(`Non-finite value at index ${i}: ${vec[i]}`),
            { noRetry: true },
          );
        }
      }

      return vec;
    } catch (e: any) {
      // Hard errors — never retry
      if (e.message === "RATE_LIMIT" || e.message === "PAYMENT_REQUIRED" || e.noRetry) throw e;

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
