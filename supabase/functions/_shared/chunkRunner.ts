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
import { validateEpisodicChunk, validateEpisodicContent, validateSectionedContent, hasBannedSummarizationLanguage, hasScreenplayFormat } from "./chunkValidator.ts";

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

const GATEWAY_URL = "https://openrouter.ai/api/v1/chat/completions";
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
  const { apiKey, upstreamContent, projectTitle, docType, additionalContext, model, plan } = opts;
  let systemPrompt = opts.systemPrompt;
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

    // ── Per-section length targets for all sectioned doc types ─────────────
    // Without explicit targets the model defaults to a "complete" but short
    // section. These targets enforce minimum output for every doc type that
    // goes through the sectioned chunk strategy. No document should ever be
    // shortened — if a section is worth generating, it is worth generating in full.
    const sectionKey = chunk.sectionId || chunk.chunkKey;
    let lengthGuidance = "";

    // ── Feature-length screenplay types ──────────────────────────────────────
    if (["feature_script", "production_draft", "screenplay_draft"].includes(docType)) {
      const PER_ACT_TARGETS: Record<string, string> = {
        "act_1":  "25–30 pages (approximately 6,000–7,500 words). Opens the world, establishes protagonist + goal, lands the Inciting Incident, ends with the Break Into Two.",
        "act_2a": "28–32 pages (approximately 7,000–8,000 words). Rising action, B Story launch, Fun & Games / Promise of the Premise section, builds to Midpoint.",
        "act_2b": "28–32 pages (approximately 7,000–8,000 words). Bad Guys Close In, All Is Lost, Dark Night of the Soul, ends at the Break Into Three.",
        "act_3":  "22–28 pages (approximately 5,500–7,000 words). Finale, climax, resolution, final image.",
      };
      const actTarget = PER_ACT_TARGETS[sectionKey] ?? "25–30 pages (approximately 6,000–7,500 words)";
      lengthGuidance = `
FEATURE SCREENPLAY LENGTH — MANDATORY:
- A feature film screenplay is 95–115 pages (approximately 24,000–28,000 words total across all 4 acts).
- This act (${sectionLabel}) must reach: ${actTarget}
- Write EVERY scene in FULL: INT./EXT. slugline, action paragraph(s), complete dialogue.
- Do NOT compress, summarise, or skip any scene.
- Do NOT stop writing until you have reached the page/word target above.
- Every scene in the story outline or beat sheet is important enough to be written in full here.
`;

    // ── Treatment (standard) ─────────────────────────────────────────────────
    } else if (docType === "treatment") {
      const PER_ACT_TARGETS: Record<string, string> = {
        "act_1_setup":           "3–5 pages (approximately 750–1,250 words). Introduce the world, protagonist, ordinary life, and the inciting incident that disrupts everything.",
        "act_2a_rising_action":  "4–6 pages (approximately 1,000–1,500 words). Protagonist commits to the journey. Rising stakes, early obstacles, key relationships forged or strained.",
        "act_2b_complications":  "4–6 pages (approximately 1,000–1,500 words). Complications escalate. Midpoint turn, reversals, the protagonist pushed to their limit. Dark night of the soul.",
        "act_3_climax_resolution": "3–5 pages (approximately 750–1,250 words). Climax, final confrontation, resolution. Thematic statement landed. Closing image.",
      };
      const actTarget = PER_ACT_TARGETS[sectionKey] ?? "4–6 pages (approximately 1,000–1,500 words)";
      lengthGuidance = `
TREATMENT LENGTH — MANDATORY:
- A feature film treatment is 14–22 pages (approximately 3,500–5,500 words total across all 4 sections).
- This section (${sectionLabel}) must reach: ${actTarget}
- Write in vivid present-tense prose. Describe scenes, action, and emotional beats — not summaries.
- Do NOT compress or skip story beats. Every beat in the outline belongs in the treatment.
- Do NOT stop writing until you have reached the word target above.
`;

    // ── Long treatment ───────────────────────────────────────────────────────
    } else if (docType === "long_treatment") {
      const PER_ACT_TARGETS: Record<string, string> = {
        "act_1_setup":           "6–10 pages (approximately 1,500–2,500 words). Full establishment of world, protagonist psychology, stakes, and inciting incident with scene-level texture.",
        "act_2a_rising_action":  "8–12 pages (approximately 2,000–3,000 words). Scene-level rising action, key set-pieces, relationship dynamics, midpoint build.",
        "act_2b_complications":  "8–12 pages (approximately 2,000–3,000 words). Full complications, reversals, midpoint consequence, all-is-lost sequence.",
        "act_3_climax_resolution": "6–10 pages (approximately 1,500–2,500 words). Full climax sequence, resolution, thematic close, final image.",
      };
      const actTarget = PER_ACT_TARGETS[sectionKey] ?? "8–12 pages (approximately 2,000–3,000 words)";
      lengthGuidance = `
LONG TREATMENT LENGTH — MANDATORY:
- A long treatment is 28–44 pages (approximately 7,000–11,000 words total across all 4 sections).
- This section (${sectionLabel}) must reach: ${actTarget}
- Write in vivid present-tense prose with full scene-level texture. Not a summary — a reading experience.
- Every scene, set-piece, and emotional beat must be rendered in full.
- Do NOT compress or skip. Do NOT stop writing until you have reached the word target above.
`;

    // ── Story Outline ────────────────────────────────────────────────────────
    } else if (docType === "story_outline") {
      const PER_ACT_TARGETS: Record<string, string> = {
        "act_1_setup":         "12–16 scenes (approximately 1,800–3,000 words). Each scene: slug line, 2–4 sentence description, dramatic purpose. Covers world establishment through inciting incident to end of Act 1.",
        "act_2a_complication": "14–18 scenes (approximately 2,200–3,600 words). Rising action, B story introduction, Fun & Games section, build to Midpoint. Each scene fully described.",
        "act_2b_crisis":       "14–18 scenes (approximately 2,200–3,600 words). Post-midpoint complications, All Is Lost, Dark Night of the Soul. Every scene fully described.",
        "act_3_resolution":    "10–14 scenes (approximately 1,500–2,600 words). Break Into Three, finale sequence, climax, resolution, final image. Every scene fully described.",
      };
      const actTarget = PER_ACT_TARGETS[sectionKey] ?? "12–16 scenes (approximately 2,000–3,000 words)";
      lengthGuidance = `
STORY OUTLINE LENGTH — MANDATORY:
- A feature film story outline is 50–80 scenes (approximately 8,000–13,000 words total across all 4 acts).
- This act (${sectionLabel}) must contain: ${actTarget}
- Each scene entry MUST include: location/time slug, 2–4 sentence action description, and dramatic purpose.
- Do NOT summarise multiple scenes into one entry. Every scene is its own entry.
- Do NOT skip scenes to save space. Do NOT stop writing until you have reached the scene count and word target above.
`;

    // ── Beat Sheet ───────────────────────────────────────────────────────────
    } else if (docType === "beat_sheet") {
      const PER_ACT_TARGETS: Record<string, string> = {
        "act_1_beats":  "10–14 named beats (approximately 900–1,400 words). Opening Image through Break Into Two. Each beat: name, 2–3 sentence description, page number, emotional/dramatic function.",
        "act_2a_beats": "10–14 named beats (approximately 900–1,400 words). B Story through Midpoint. Each beat fully described.",
        "act_2b_beats": "10–14 named beats (approximately 900–1,400 words). Bad Guys Close In through Dark Night of the Soul. Each beat fully described.",
        "act_3_beats":  "8–12 named beats (approximately 700–1,100 words). Break Into Three through Final Image. Each beat fully described.",
      };
      const actTarget = PER_ACT_TARGETS[sectionKey] ?? "10–14 named beats (approximately 900–1,400 words)";
      lengthGuidance = `
BEAT SHEET LENGTH — MANDATORY:
- A feature film beat sheet has 38–54 named beats (approximately 3,500–5,000 words total across all 4 acts).
- This act (${sectionLabel}) must contain: ${actTarget}
- Each beat MUST include: beat name (e.g. "Opening Image"), page number, 2–3 sentence description, dramatic/emotional function.
- Do NOT merge multiple beats into one. Do NOT skip beats to save space.
- Do NOT stop writing until you have reached the beat count and word target above.
`;

    // ── Character Bible ──────────────────────────────────────────────────────
    } else if (docType === "character_bible" || docType === "long_character_bible") {
      const isLong = docType === "long_character_bible";
      const PER_SECTION_TARGETS: Record<string, string> = isLong ? {
        "protagonists":              "Minimum 800–1,200 words per protagonist. Cover: full backstory, psychology, wound, want vs need, voice, arc, relationships, contradictions.",
        "antagonists":               "Minimum 600–1,000 words per antagonist. Cover: motivation, ideology, relationship to protagonist, how they embody the theme's dark mirror.",
        "supporting_cast":           "Minimum 400–600 words per supporting character. Cover: role in story, relationship to protagonist, arc, distinct voice.",
        "relationships_and_dynamics": "Minimum 800–1,200 words total. Map all key relationships: power dynamics, history, how each relationship tests the protagonist's arc.",
      } : {
        "protagonists":              "Minimum 500–800 words per protagonist. Cover: backstory, psychology, want vs need, voice, arc.",
        "antagonists":               "Minimum 400–600 words per antagonist. Cover: motivation, relationship to protagonist, thematic role.",
        "supporting_cast":           "Minimum 250–400 words per supporting character. Cover: role, relationship to protagonist, distinct voice.",
        "relationships_and_dynamics": "Minimum 500–800 words total. Map key relationships and how they drive the story.",
      };
      const sectionTarget = PER_SECTION_TARGETS[sectionKey] ?? "Minimum 500 words per character. Full profiles — do not truncate.";
      lengthGuidance = `
CHARACTER BIBLE LENGTH — MANDATORY:
- Every character profile must be COMPLETE. Do NOT truncate or summarise any character.
- This section (${sectionLabel}): ${sectionTarget}
- For each character: write the FULL profile to the word target. A short entry means a shortchanged character.
- Do NOT use placeholder text, bullet-point stubs, or "see above" references.
- Do NOT stop writing until EVERY character in this section has a complete profile.
`;
    }

    chunkPrompt = `You are generating the "${sectionLabel}" section for the project "${projectTitle}".
Document type: ${docType.replace(/_/g, " ")}
${lengthGuidance}
CRITICAL RULES:
- Output ONLY the "${sectionLabel}" section.
- Write full, complete content — do NOT summarize or abbreviate.
- Do NOT skip scenes, beats, or details.
- Maintain professional formatting appropriate for ${docType}.

${additionalContext ? `CREATIVE DIRECTION:\n${additionalContext}\n` : ""}
${previousChunkEnding ? `PREVIOUS SECTION ENDING (for continuity):\n...${previousChunkEnding}\n` : ""}
UPSTREAM CONTEXT:
${upstreamContent}

Generate the "${sectionLabel}" section now. Write to the full page target specified above.`;
  } else {
    chunkPrompt = `Generate chunk ${chunk.chunkIndex + 1} (${chunk.label}) for "${projectTitle}".
${upstreamContent}`;
  }

  // ── Season script: one episode per chunk, plain-text screenplay ──────────
  // JSON transport is unreliable for screenplay content — quotes and colons in
  // dialogue break JSON parsers. Each chunk is one episode (batchSize=1),
  // generated as raw screenplay markdown and stored directly to DB.
  if (docType === "season_script" && chunk.episodeStart != null && chunk.episodeStart === chunk.episodeEnd) {
    const epNum = chunk.episodeStart;
    const totalEps = opts.episodeCount ?? epNum;
    const SEASON_SCRIPT_SYSTEM = `You are writing ONE EPISODE of a vertical drama screenplay.
Output ONLY the raw screenplay text — no JSON, no markdown code blocks, no preamble.

Format exactly:
## EPISODE [N]: [EPISODE TITLE]
*Duration: 120–180 seconds*

COLD OPEN
[Action line: scroll-stopping hook — 2-3 lines max]

SCENE 1 — [SCENE HEADING]
[Action line]
CHARACTER NAME
(parenthetical if needed)
Dialogue line.
[Action / reaction]
CHARACTER NAME
Dialogue line.

[Repeat for 2-4 more scenes]

EPISODE END
[Final image + micro-cliffhanger pulling viewer to next episode]

---

Rules:
- Use ONLY characters, story events, and locations from the upstream documents below
- Write REAL dialogue — character-specific, subtext-loaded, personality-revealing
- Every scene must have a clear dramatic function
- End on an unresolved micro-cliffhanger that pulls to the next episode
- 400–600 words of scripted content per episode
- Do NOT include character descriptions, beat summaries, or metadata`;
    const epPrompt = `Write Episode ${epNum} of ${totalEps} for "${projectTitle}".

UPSTREAM CONTEXT (episode beats, character bible, season arc — use these as canon):
${upstreamContent.slice(0, 9000)}

${previousChunkEnding ? `PREVIOUS EPISODE ENDING (for continuity):\n...${previousChunkEnding}\n\n` : ""}Write Episode ${epNum} now. Start directly with "## EPISODE ${epNum}:".`;
    const raw = await callChunkLLM(apiKey, SEASON_SCRIPT_SYSTEM, epPrompt, "google/gemini-2.5-pro", 4000);
    return raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();
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
          // Check for banned summarization language
          const hasBanned = hasBannedSummarizationLanguage(content);
          // Check for screenplay format in prose-only doc types
          const hasScript = hasScreenplayFormat(content, docType);
          chunkPassed = !hasBanned && !hasScript;
          if (!chunkPassed && attempt < maxChunkRepairs) {
            if (hasScript) {
              console.warn(`[chunkRunner] Chunk ${chunk.chunkKey} contains screenplay format (INT./EXT. sluglines) in prose doc type "${docType}" — retrying with stronger instruction`);
              // Inject a stronger instruction on retry to override screenplay habit
              systemPrompt = systemPrompt + `\n\nCRITICAL RETRY INSTRUCTION: Your previous attempt used INT./EXT. scene headings (screenplay format). This is STRICTLY FORBIDDEN for a ${docType}. Write ONLY in prose narrative paragraphs. No sluglines. No character cues. No dialogue blocks. Start directly with descriptive prose.`;
            } else {
              console.warn(`[chunkRunner] Chunk ${chunk.chunkKey} contains banned language, retrying`);
            }
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

  // 4. If any chunks are missing (failed with no content), reset them to "pending"
  // so the repair loop below will regenerate them. Do NOT silently skip gaps.
  const missingIndexes: number[] = [];
  for (let i = 0; i < plan.totalChunks; i++) {
    if (!chunkContents[i]) {
      missingIndexes.push(i);
      console.warn(`[chunkRunner] Chunk ${i} has no content — resetting to pending for repair`);
      await supabase
        .from("project_document_chunks")
        .update({ status: "pending", error: null })
        .eq("document_id", documentId)
        .eq("version_id", versionId)
        .eq("chunk_index", i);
    }
  }

  // If there are missing chunks, regenerate them now before assembly
  if (missingIndexes.length > 0) {
    console.log(`[chunkRunner] Regenerating ${missingIndexes.length} missing chunk(s): [${missingIndexes.join(", ")}]`);
    for (const idx of missingIndexes) {
      const chunk = plan.chunks[idx];
      if (!chunk) continue;
      const previousEnding = idx > 0 ? (chunkContents[idx - 1] || "").slice(-500) : undefined;
      try {
        const regenContent = await generateSingleChunk(opts, chunk, previousEnding);
        if (regenContent) {
          chunkContents[idx] = regenContent;
          await supabase
            .from("project_document_chunks")
            .update({ status: "done", content: regenContent, char_count: regenContent.length, error: null })
            .eq("document_id", documentId)
            .eq("version_id", versionId)
            .eq("chunk_index", idx);
          console.log(`[chunkRunner] Missing chunk ${idx} recovered: ${regenContent.length} chars`);
        }
      } catch (err: any) {
        console.error(`[chunkRunner] Recovery regen for chunk ${idx} failed:`, err.message);
        await supabase
          .from("project_document_chunks")
          .update({ status: "failed", error: `Recovery failed: ${err.message?.slice(0, 300)}` })
          .eq("document_id", documentId)
          .eq("version_id", versionId)
          .eq("chunk_index", idx);
      }
    }
  }

  // Assemble — use placeholder for any still-missing chunks so gaps are visible
  let assembledContent = chunkContents
    .map((c, i) => c || `[SECTION ${i + 1} GENERATION FAILED — REGENERATE THIS DOCUMENT]`)
    .join("\n\n");
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
