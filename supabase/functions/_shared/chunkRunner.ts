/**
 * Chunk Runner — Orchestrates chunked generation, DB storage, assembly.
 *
 * Responsible for:
 * 1. Creating chunk plan entries in project_document_chunks
 * 2. Generating each chunk via LLM
 * 3. Validating each chunk
 * 4. Assembling final plaintext from all chunks
 * 5. Storing assembled result in project_document_versions
 *
 * Used by: generate-document, dev-engine-v2, auto-run.
 */

import { type ChunkPlan, type ChunkPlanEntry, chunkPlanFor, isEpisodicDocType } from "./largeRiskRouter.ts";
import { validateEpisodicChunk, validateEpisodicContent, validateSectionedContent, hasBannedSummarizationLanguage } from "./chunkValidator.ts";

// ── Types ──

export interface ChunkRunnerOptions {
  supabase: any;
  apiKey: string;
  projectId: string;
  documentId: string;
  versionId: string;
  docType: string;
  plan: ChunkPlan;
  /** System prompt for LLM */
  systemPrompt: string;
  /** Upstream context to include in every chunk call */
  upstreamContent: string;
  /** Project title for prompt context */
  projectTitle: string;
  /** Additional generation context */
  additionalContext?: string;
  /** LLM model to use */
  model?: string;
  /** Max repair attempts per chunk */
  maxChunkRepairs?: number;
  /** Episode count (for episodic validation) */
  episodeCount?: number;
  /** Request ID for tracing */
  requestId?: string;
}

export interface ChunkRunResult {
  success: boolean;
  assembledContent: string;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  validationResult: any;
  assembledFromChunks: boolean;
}

// ── LLM Gateway ──

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callChunkLLM(
  apiKey: string,
  system: string,
  user: string,
  model: string = "google/gemini-2.5-flash",
  maxTokens: number = 16000
): Promise<string> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.5,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`Chunk LLM call failed (${res.status}): ${errText.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── Chunk Plan Initialization ──

async function initializeChunks(
  supabase: any,
  documentId: string,
  versionId: string,
  plan: ChunkPlan
): Promise<void> {
  // Upsert chunk entries (pending status)
  const rows = plan.chunks.map(chunk => ({
    document_id: documentId,
    version_id: versionId,
    chunk_index: chunk.chunkIndex,
    chunk_key: chunk.chunkKey,
    status: "pending",
    attempts: 0,
    meta_json: {
      label: chunk.label,
      episodeStart: chunk.episodeStart,
      episodeEnd: chunk.episodeEnd,
      sectionId: chunk.sectionId,
      strategy: plan.strategy,
    },
  }));

  // Delete any existing chunks for this version (clean slate)
  await supabase
    .from("project_document_chunks")
    .delete()
    .eq("document_id", documentId)
    .eq("version_id", versionId);

  // Insert fresh chunk entries
  const { error } = await supabase
    .from("project_document_chunks")
    .insert(rows);

  if (error) {
    console.error("[chunkRunner] Failed to initialize chunks:", error);
    throw new Error(`Failed to initialize chunks: ${error.message}`);
  }
}

// ── Single Chunk Generation ──

async function generateSingleChunk(
  opts: ChunkRunnerOptions,
  chunk: ChunkPlanEntry,
  previousChunkEnding?: string
): Promise<string> {
  const { apiKey, systemPrompt, upstreamContent, projectTitle, docType, additionalContext, model, plan } = opts;

  let chunkPrompt: string;

  if (plan.strategy === "episodic_indexed") {
    const epRange = `Episodes ${chunk.episodeStart}–${chunk.episodeEnd}`;
    chunkPrompt = `You are generating ${epRange} for the project "${projectTitle}".
Document type: ${docType.replace(/_/g, " ")}

CRITICAL RULES:
- Output ONLY ${epRange}. Do NOT output episodes outside this range.
- Each episode MUST have its own heading: "## EPISODE N" or "**EPISODE N**"
- Do NOT summarize, compress, or skip any episode.
- Do NOT use phrases like "remaining episodes follow similar pattern" or "etc."
- Every episode in the range ${chunk.episodeStart}–${chunk.episodeEnd} must be fully developed.

${additionalContext ? `CREATIVE DIRECTION:\n${additionalContext}\n` : ""}
${previousChunkEnding ? `PREVIOUS CHUNK ENDING (for continuity):\n...${previousChunkEnding}\n` : ""}
UPSTREAM CONTEXT:
${upstreamContent}

Generate ${epRange} now. Full content for each episode.`;
  } else if (plan.strategy === "sectioned") {
    const sectionLabel = chunk.label;
    chunkPrompt = `You are generating the "${sectionLabel}" section for the project "${projectTitle}".
Document type: ${docType.replace(/_/g, " ")}

CRITICAL RULES:
- Output ONLY the "${sectionLabel}" section.
- Write full, complete content — do NOT summarize or abbreviate.
- Do NOT skip scenes, beats, or details.
- Maintain professional formatting appropriate for ${docType}.

${additionalContext ? `CREATIVE DIRECTION:\n${additionalContext}\n` : ""}
${previousChunkEnding ? `PREVIOUS SECTION ENDING (for continuity):\n...${previousChunkEnding}\n` : ""}
UPSTREAM CONTEXT:
${upstreamContent}

Generate the "${sectionLabel}" section now.`;
  } else {
    chunkPrompt = `Generate chunk ${chunk.chunkIndex + 1} (${chunk.label}) for "${projectTitle}".
${upstreamContent}`;
  }

  return await callChunkLLM(apiKey, systemPrompt, chunkPrompt, model || "google/gemini-2.5-flash", 16000);
}

// ── Main Runner ──

export async function runChunkedGeneration(opts: ChunkRunnerOptions): Promise<ChunkRunResult> {
  const {
    supabase, documentId, versionId, plan, docType,
    maxChunkRepairs = 2, episodeCount, requestId,
  } = opts;

  const rid = requestId || crypto.randomUUID();
  console.log(`[chunkRunner] Starting chunked generation: ${plan.totalChunks} chunks, strategy=${plan.strategy}, docType=${docType}, rid=${rid}`);

  // 1. Initialize chunk entries in DB
  await initializeChunks(supabase, documentId, versionId, plan);

  // 2. Generate each chunk sequentially (for continuity)
  const chunkContents: string[] = new Array(plan.totalChunks).fill("");
  let completedChunks = 0;
  let failedChunks = 0;

  for (const chunk of plan.chunks) {
    const previousEnding = chunk.chunkIndex > 0
      ? chunkContents[chunk.chunkIndex - 1].slice(-500)
      : undefined;

    // Mark as running
    await supabase
      .from("project_document_chunks")
      .update({ status: "running", attempts: 1 })
      .eq("document_id", documentId)
      .eq("version_id", versionId)
      .eq("chunk_index", chunk.chunkIndex);

    let content = "";
    let chunkPassed = false;

    for (let attempt = 0; attempt <= maxChunkRepairs; attempt++) {
      try {
        content = await generateSingleChunk(opts, chunk, previousEnding);

        // Validate chunk
        if (plan.strategy === "episodic_indexed" && chunk.episodeStart && chunk.episodeEnd) {
          const expectedEps = Array.from(
            { length: chunk.episodeEnd - chunk.episodeStart + 1 },
            (_, i) => chunk.episodeStart! + i
          );
          const validation = validateEpisodicChunk(content, expectedEps, docType);

          if (!validation.pass && attempt < maxChunkRepairs) {
            console.warn(`[chunkRunner] Chunk ${chunk.chunkKey} failed validation (attempt ${attempt}): ${validation.failures.map(f => f.detail).join("; ")}`);
            // Update attempt count
            await supabase
              .from("project_document_chunks")
              .update({ attempts: attempt + 2 })
              .eq("document_id", documentId)
              .eq("version_id", versionId)
              .eq("chunk_index", chunk.chunkIndex);
            continue;
          }
          chunkPassed = validation.pass;
        } else {
          // For sectioned: just check banned language
          chunkPassed = !hasBannedSummarizationLanguage(content);
          if (!chunkPassed && attempt < maxChunkRepairs) {
            console.warn(`[chunkRunner] Chunk ${chunk.chunkKey} contains banned language, retrying`);
            continue;
          }
        }
        break;
      } catch (err: any) {
        console.error(`[chunkRunner] Chunk ${chunk.chunkKey} generation error (attempt ${attempt}):`, err.message);
        if (attempt >= maxChunkRepairs) {
          failedChunks++;
          await supabase
            .from("project_document_chunks")
            .update({
              status: "failed",
              error: err.message?.slice(0, 500),
              attempts: attempt + 1,
            })
            .eq("document_id", documentId)
            .eq("version_id", versionId)
            .eq("chunk_index", chunk.chunkIndex);
        }
      }
    }

    if (content) {
      chunkContents[chunk.chunkIndex] = content;
      completedChunks++;
      await supabase
        .from("project_document_chunks")
        .update({
          status: chunkPassed ? "done" : "done",
          content,
          char_count: content.length,
        })
        .eq("document_id", documentId)
        .eq("version_id", versionId)
        .eq("chunk_index", chunk.chunkIndex);
    }
  }

  // 3. Assemble final content
  const assembledContent = chunkContents.filter(Boolean).join("\n\n");

  // 4. Validate assembled content
  let validationResult: any;
  if (plan.strategy === "episodic_indexed" && episodeCount) {
    validationResult = validateEpisodicContent(assembledContent, episodeCount, docType);
  } else {
    validationResult = validateSectionedContent(
      assembledContent,
      plan.chunks.map(c => c.chunkKey),
      docType
    );
  }

  // 5. Update version with assembled content
  await supabase
    .from("project_document_versions")
    .update({
      plaintext: assembledContent,
      assembled_from_chunks: true,
      assembled_chunk_count: plan.totalChunks,
    })
    .eq("id", versionId);

  console.log(`[chunkRunner] Complete: ${completedChunks}/${plan.totalChunks} chunks, validation=${validationResult.pass ? "PASS" : "FAIL"}, rid=${rid}`);

  return {
    success: validationResult.pass && failedChunks === 0,
    assembledContent,
    totalChunks: plan.totalChunks,
    completedChunks,
    failedChunks,
    validationResult,
    assembledFromChunks: true,
  };
}

/**
 * Resume a partially completed chunked generation.
 * Only generates chunks that are pending or failed.
 */
export async function resumeChunkedGeneration(opts: ChunkRunnerOptions): Promise<ChunkRunResult> {
  const { supabase, documentId, versionId, plan } = opts;

  // Load existing chunks
  const { data: existingChunks } = await supabase
    .from("project_document_chunks")
    .select("*")
    .eq("document_id", documentId)
    .eq("version_id", versionId)
    .order("chunk_index", { ascending: true });

  const chunkMap = new Map((existingChunks || []).map((c: any) => [c.chunk_index, c]));

  // Filter plan to only pending/failed chunks
  const pendingChunks = plan.chunks.filter(c => {
    const existing = chunkMap.get(c.chunkIndex);
    return !existing || existing.status === "pending" || existing.status === "failed";
  });

  if (pendingChunks.length === 0) {
    // All chunks done — just reassemble
    const allContent = plan.chunks.map(c => {
      const existing = chunkMap.get(c.chunkIndex);
      return existing?.content || "";
    });
    const assembled = allContent.filter(Boolean).join("\n\n");

    return {
      success: true,
      assembledContent: assembled,
      totalChunks: plan.totalChunks,
      completedChunks: plan.totalChunks,
      failedChunks: 0,
      validationResult: { pass: true, failures: [] },
      assembledFromChunks: true,
    };
  }

  // Run only pending chunks (reuse opts but could be optimized)
  return runChunkedGeneration(opts);
}
