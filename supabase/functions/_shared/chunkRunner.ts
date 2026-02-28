/**
 * Chunk Runner — Orchestrates chunked generation, DB storage, assembly.
 *
 * Responsible for:
 * 1. Upserting chunk plan entries in project_document_chunks (preserving existing)
 * 2. Generating each chunk via LLM
 * 3. Validating each chunk
 * 4. Assembly repair loop (regen only missing/failed chunks)
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
  systemPrompt: string;
  upstreamContent: string;
  projectTitle: string;
  additionalContext?: string;
  model?: string;
  maxChunkRepairs?: number;
  episodeCount?: number;
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

// ── Constants ──

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_ASSEMBLY_REPAIR_PASSES = 2;

// ── Token budgets per strategy/docType ──

function maxTokensForChunk(strategy: string, docType: string): number {
  if (strategy === "episodic_indexed") return 16000;
  if (docType.includes("script") || docType === "screenplay_draft" || docType === "production_draft") return 32000;
  if (docType.includes("treatment")) return 24000;
  return 16000;
}

// ── LLM Gateway ──

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

// ── Chunk Plan Initialization (UPSERT, preserving existing) ──

async function initializeChunks(
  supabase: any,
  documentId: string,
  versionId: string,
  plan: ChunkPlan
): Promise<void> {
  // Load existing chunks for this version
  const { data: existing } = await supabase
    .from("project_document_chunks")
    .select("chunk_index, status, content")
    .eq("document_id", documentId)
    .eq("version_id", versionId);

  const existingMap = new Map((existing || []).map((c: any) => [c.chunk_index, c]));

  // Only insert chunks that don't already exist
  const newRows = plan.chunks
    .filter(chunk => !existingMap.has(chunk.chunkIndex))
    .map(chunk => ({
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

  if (newRows.length > 0) {
    const { error } = await supabase
      .from("project_document_chunks")
      .insert(newRows);

    if (error) {
      console.error("[chunkRunner] Failed to initialize chunks:", error);
      throw new Error(`Failed to initialize chunks: ${error.message}`);
    }
  }

  console.log(`[chunkRunner] initializeChunks: ${newRows.length} new, ${existingMap.size} preserved`);
}

// ── Single Chunk Generation ──

async function generateSingleChunk(
  opts: ChunkRunnerOptions,
  chunk: ChunkPlanEntry,
  previousChunkEnding?: string
): Promise<string> {
  const { apiKey, systemPrompt, upstreamContent, projectTitle, docType, additionalContext, model, plan } = opts;
  const tokenBudget = maxTokensForChunk(plan.strategy, docType);

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

  return await callChunkLLM(apiKey, systemPrompt, chunkPrompt, model || "google/gemini-2.5-flash", tokenBudget);
}

// ── Determine which chunks need (re)generation ──

function chunksNeedingGeneration(
  plan: ChunkPlan,
  existingMap: Map<number, any>
): ChunkPlanEntry[] {
  return plan.chunks.filter(c => {
    const existing = existingMap.get(c.chunkIndex);
    if (!existing) return true;
    return ["pending", "failed", "failed_validation", "needs_regen"].includes(existing.status);
  });
}

// ── Main Runner ──

export async function runChunkedGeneration(opts: ChunkRunnerOptions): Promise<ChunkRunResult> {
  const {
    supabase, documentId, versionId, plan, docType,
    maxChunkRepairs = 2, episodeCount, requestId,
  } = opts;

  const rid = requestId || crypto.randomUUID();
  console.log(`[chunkRunner] Starting: ${plan.totalChunks} chunks, strategy=${plan.strategy}, rid=${rid}`);

  // 1. Upsert chunk entries (preserving existing)
  await initializeChunks(supabase, documentId, versionId, plan);

  // 2. Load current chunk state
  const { data: existingChunks } = await supabase
    .from("project_document_chunks")
    .select("*")
    .eq("document_id", documentId)
    .eq("version_id", versionId)
    .order("chunk_index", { ascending: true });

  const chunkMap = new Map((existingChunks || []).map((c: any) => [c.chunk_index, c]));

  // Pre-fill content array from existing done chunks
  const chunkContents: string[] = new Array(plan.totalChunks).fill("");
  for (const [idx, row] of chunkMap.entries()) {
    if (row.status === "done" && row.content) {
      chunkContents[idx] = row.content;
    }
  }

  // 3. Generate only chunks that need it
  const toGenerate = chunksNeedingGeneration(plan, chunkMap);
  let completedChunks = plan.totalChunks - toGenerate.length;
  let failedChunks = 0;

  for (const chunk of toGenerate) {
    const previousEnding = chunk.chunkIndex > 0
      ? chunkContents[chunk.chunkIndex - 1].slice(-500)
      : undefined;

    // Mark as running
    await supabase
      .from("project_document_chunks")
      .update({ status: "running", attempts: (chunkMap.get(chunk.chunkIndex)?.attempts || 0) + 1 })
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
            continue;
          }
          chunkPassed = validation.pass;
        } else {
          chunkPassed = !hasBannedSummarizationLanguage(content);
          if (!chunkPassed && attempt < maxChunkRepairs) {
            console.warn(`[chunkRunner] Chunk ${chunk.chunkKey} contains banned language, retrying`);
            continue;
          }
        }
        break;
      } catch (err: any) {
        console.error(`[chunkRunner] Chunk ${chunk.chunkKey} error (attempt ${attempt}):`, err.message);
        if (attempt >= maxChunkRepairs) {
          failedChunks++;
          await supabase
            .from("project_document_chunks")
            .update({
              status: "failed",
              error: err.message?.slice(0, 500),
              attempts: (chunkMap.get(chunk.chunkIndex)?.attempts || 0) + attempt + 1,
            })
            .eq("document_id", documentId)
            .eq("version_id", versionId)
            .eq("chunk_index", chunk.chunkIndex);
        }
      }
    }

    if (content) {
      chunkContents[chunk.chunkIndex] = content;

      // HONEST STATUS: done only if validation passed, failed_validation otherwise
      const finalStatus = chunkPassed ? "done" : "failed_validation";
      if (!chunkPassed) failedChunks++;
      if (chunkPassed) completedChunks++;

      await supabase
        .from("project_document_chunks")
        .update({
          status: finalStatus,
          content,
          char_count: content.length,
          error: chunkPassed ? null : "Chunk validation failed (banned language or missing episodes)",
        })
        .eq("document_id", documentId)
        .eq("version_id", versionId)
        .eq("chunk_index", chunk.chunkIndex);
    }
  }

  // 4. Assemble + validate + repair loop
  let assembledContent = chunkContents.filter(Boolean).join("\n\n");
  let validationResult: any;

  for (let repairPass = 0; repairPass <= MAX_ASSEMBLY_REPAIR_PASSES; repairPass++) {
    // Validate assembled content
    if (plan.strategy === "episodic_indexed" && episodeCount) {
      validationResult = validateEpisodicContent(assembledContent, episodeCount, docType);
    } else {
      validationResult = validateSectionedContent(
        assembledContent,
        plan.chunks.map(c => c.chunkKey),
        docType
      );
    }

    if (validationResult.pass || repairPass >= MAX_ASSEMBLY_REPAIR_PASSES) break;

    // Determine which chunks need regen based on validation failures
    const chunksToRegen: number[] = [];

    if (validationResult.missingIndices?.length > 0 && plan.strategy === "episodic_indexed") {
      // Find which chunks contain the missing episodes
      for (const missingEp of validationResult.missingIndices) {
        const owningChunk = plan.chunks.find(
          c => c.episodeStart != null && c.episodeEnd != null &&
               missingEp >= c.episodeStart && missingEp <= c.episodeEnd
        );
        if (owningChunk && !chunksToRegen.includes(owningChunk.chunkIndex)) {
          chunksToRegen.push(owningChunk.chunkIndex);
        }
      }
    } else if (validationResult.missingSections?.length > 0) {
      // Find chunks for missing sections
      for (const missingSec of validationResult.missingSections) {
        const owningChunk = plan.chunks.find(c => c.chunkKey === missingSec || c.sectionId === missingSec);
        if (owningChunk && !chunksToRegen.includes(owningChunk.chunkIndex)) {
          chunksToRegen.push(owningChunk.chunkIndex);
        }
      }
    }

    if (chunksToRegen.length === 0) break; // No actionable repair

    console.log(`[chunkRunner] Assembly repair pass ${repairPass + 1}: regenerating chunks ${chunksToRegen.join(", ")}`);

    // Mark affected chunks as needs_regen
    for (const idx of chunksToRegen) {
      await supabase
        .from("project_document_chunks")
        .update({ status: "needs_regen" })
        .eq("document_id", documentId)
        .eq("version_id", versionId)
        .eq("chunk_index", idx);
    }

    // Regenerate only those chunks
    for (const idx of chunksToRegen) {
      const chunk = plan.chunks[idx];
      const previousEnding = idx > 0 ? chunkContents[idx - 1].slice(-500) : undefined;

      await supabase
        .from("project_document_chunks")
        .update({ status: "running" })
        .eq("document_id", documentId)
        .eq("version_id", versionId)
        .eq("chunk_index", idx);

      try {
        const content = await generateSingleChunk(opts, chunk, previousEnding);
        chunkContents[idx] = content;

        const isValid = plan.strategy === "episodic_indexed" && chunk.episodeStart && chunk.episodeEnd
          ? validateEpisodicChunk(content, Array.from({ length: chunk.episodeEnd - chunk.episodeStart + 1 }, (_, i) => chunk.episodeStart! + i), docType).pass
          : !hasBannedSummarizationLanguage(content);

        await supabase
          .from("project_document_chunks")
          .update({
            status: isValid ? "done" : "failed_validation",
            content,
            char_count: content.length,
            error: isValid ? null : "Repair pass: validation still failing",
          })
          .eq("document_id", documentId)
          .eq("version_id", versionId)
          .eq("chunk_index", idx);
      } catch (err: any) {
        console.error(`[chunkRunner] Repair regen for chunk ${idx} failed:`, err.message);
        await supabase
          .from("project_document_chunks")
          .update({ status: "failed", error: err.message?.slice(0, 500) })
          .eq("document_id", documentId)
          .eq("version_id", versionId)
          .eq("chunk_index", idx);
      }
    }

    // Reassemble
    assembledContent = chunkContents.filter(Boolean).join("\n\n");
  }

  // 5. Store assembled content
  await supabase
    .from("project_document_versions")
    .update({
      plaintext: assembledContent,
      assembled_from_chunks: true,
      assembled_chunk_count: plan.totalChunks,
    })
    .eq("id", versionId);

  console.log(`[chunkRunner] Complete: ${completedChunks}/${plan.totalChunks}, validation=${validationResult.pass ? "PASS" : "FAIL"}, rid=${rid}`);

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
 * Only generates chunks that are pending/failed/failed_validation/needs_regen.
 * Does NOT call fresh init that overwrites state.
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

  // Check if any chunks need generation
  const pendingChunks = chunksNeedingGeneration(plan, chunkMap);

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

  // Ensure any missing chunk rows exist (upsert, not delete)
  await initializeChunks(supabase, documentId, versionId, plan);

  // Run the main generation (which now respects existing done chunks)
  return runChunkedGeneration(opts);
}
