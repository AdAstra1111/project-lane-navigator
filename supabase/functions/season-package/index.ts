/**
 * season-package — Builds the Complete Season Script from the approved document pack.
 *
 * Path A (compile): Episode scripts exist → compile them into one master doc.
 * Path B (generate): No/few scripts → generate per-episode content from beats/grid/arc via LLM.
 *
 * POST { project_id, use_approved?, force_regenerate? }
 * Returns { doc_id, version_id, path_used, episode_count, sources, skipped, change_log, approved_pack_doc_types }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, GATEWAY_URL } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Ordered list of approved pack doc types for Vertical Drama
const PACK_DOC_TYPES = [
  "topline_narrative",
  "concept_brief",
  "vertical_market_sheet",
  "market_sheet",
  "format_rules",
  "character_bible",
  "season_arc",
  "episode_grid",
  "vertical_episode_beats",
];

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { project_id, use_approved = false, force_regenerate = false } = await req.json();
    if (!project_id) throw new Error("project_id required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // ── Auth ──
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) throw new Error("Not authenticated");
    const sbAnon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user } } = await sbAnon.auth.getUser(token);
    if (!user) throw new Error("Not authenticated");
    const userId = user.id;

    // ── 1. Project metadata ──
    const { data: project, error: projErr } = await sb
      .from("projects")
      .select("title, format, season_episode_count, episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds")
      .eq("id", project_id)
      .single();
    if (projErr) throw new Error(`Failed to fetch project: ${projErr.message}`);

    const projectTitle = project?.title || "Untitled Series";
    const format = project?.format || "vertical-drama";
    const durationMin = (project as any)?.episode_target_duration_min_seconds || project?.episode_target_duration_seconds || 120;
    const durationMax = (project as any)?.episode_target_duration_max_seconds || project?.episode_target_duration_seconds || 180;

    // ── 2. Assemble Approved Pack ──
    const approvedPack: Record<string, { doc_id: string; version_id: string; text: string; approved_at: string | null }> = {};

    const { data: allDocs } = await sb
      .from("project_documents")
      .select("id, doc_type, title")
      .eq("project_id", project_id)
      .in("doc_type", PACK_DOC_TYPES);

    for (const doc of (allDocs || [])) {
      let ver: any = null;

      if (use_approved) {
        const { data: finalVer } = await sb
          .from("project_document_versions")
          .select("id, plaintext, status, created_at")
          .eq("document_id", doc.id)
          .eq("status", "final")
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (finalVer?.plaintext) ver = finalVer;
      }

      if (!ver) {
        const { data: latestVer } = await sb
          .from("project_document_versions")
          .select("id, plaintext, status, created_at")
          .eq("document_id", doc.id)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestVer?.plaintext) ver = latestVer;
      }

      if (ver) {
        approvedPack[doc.doc_type] = {
          doc_id: doc.id,
          version_id: ver.id,
          text: ver.plaintext as string,
          approved_at: ver.status === "final" ? ver.created_at : null,
        };
      }
    }

    // ── 3. Fetch episodes (ordered) ──
    const { data: episodes, error: epErr } = await sb
      .from("series_episodes")
      .select("id, episode_number, title, logline, script_id, locked_at, status")
      .eq("project_id", project_id)
      .is("deleted_at", null)
      .order("episode_number", { ascending: true });

    if (epErr || !episodes?.length) throw new Error("No episodes found. Initialize Series Writer first.");

    // ── 4. Determine path (compile vs generate) ──
    const episodesWithScripts = episodes.filter((e) => e.script_id);
    const coveragePct = episodesWithScripts.length / episodes.length;
    const pathUsed = coveragePct >= 0.5 ? "compile" : "generate_from_beats";

    // ── 5. Gather script texts ──
    const episodeTexts: Record<number, string> = {};
    const sources: Array<{
      episode_number: number; episode_id: string; script_id: string | null;
      version_id: string | null; source_type: string; title: string;
    }> = [];
    const skipped: Array<{ episode_number: number; reason: string }> = [];

    // Fetch existing scripts
    for (const ep of episodes) {
      if (!ep.script_id) continue;

      let text: string | null = null;
      let versionId: string | null = null;
      let sourceType = "latest";

      if (use_approved) {
        const { data: finalVers } = await sb
          .from("project_document_versions")
          .select("id, plaintext")
          .eq("document_id", ep.script_id as any)
          .eq("status", "final")
          .order("version_number", { ascending: false })
          .limit(1);

        if (finalVers?.[0]?.plaintext) {
          text = finalVers[0].plaintext as string;
          versionId = finalVers[0].id;
          sourceType = "approved";
        }
      }

      if (!text) {
        const { data: script } = await sb
          .from("scripts")
          .select("text_content")
          .eq("id", ep.script_id)
          .single();
        text = (script as any)?.text_content || null;
        sourceType = use_approved ? "latest_fallback" : "latest";
      }

      if (text) {
        episodeTexts[ep.episode_number] = text;
        sources.push({
          episode_number: ep.episode_number, episode_id: ep.id,
          script_id: ep.script_id, version_id: versionId,
          source_type: sourceType, title: ep.title || `Episode ${ep.episode_number}`,
        });
      }
    }

    // ── 6. Generate missing episodes from approved pack (Path B / gap-fill) ──
    const missingEps = episodes.filter((e) => !episodeTexts[e.episode_number]);

    if (missingEps.length > 0 && apiKey) {
      const packContext = buildPackContext(approvedPack, projectTitle, durationMin, durationMax);
      const BATCH_SIZE = 5;

      for (let i = 0; i < missingEps.length; i += BATCH_SIZE) {
        const batch = missingEps.slice(i, i + BATCH_SIZE);
        const batchResult = await generateEpisodeBatch(batch, packContext, projectTitle, durationMin, durationMax, apiKey);

        for (const ep of batch) {
          const generated = batchResult[ep.episode_number];
          if (generated && generated.trim().length > 80) {
            // Reject if placeholder brackets detected
            const hasPlaceholders = /\[\d+[–\-]\d+\s*(words?|sentences?|lines?)\]/i.test(generated);
            if (hasPlaceholders) {
              skipped.push({ episode_number: ep.episode_number, reason: "placeholder_brackets_in_generated" });
            } else {
              episodeTexts[ep.episode_number] = generated;
              sources.push({
                episode_number: ep.episode_number, episode_id: ep.id,
                script_id: null, version_id: null,
                source_type: "generated_from_beats",
                title: ep.title || `Episode ${ep.episode_number}`,
              });
            }
          } else {
            skipped.push({ episode_number: ep.episode_number, reason: "generation_failed" });
          }
        }
      }
    }

    // ── 7. Build master document text ──
    const compiledAt = new Date().toISOString();
    const draftDate = new Date(compiledAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const headerBlock = [
      "=".repeat(60),
      projectTitle.toUpperCase(),
      "COMPLETE SEASON 1 SCRIPT",
      `Format: ${format === "vertical-drama" ? "Vertical Drama (9:16 Mobile-First)" : format}`,
      `Episodes: ${episodes.length}  |  Duration: ${durationMin}–${durationMax}s per episode`,
      `Draft Date: ${draftDate}`,
      `Source Mode: ${use_approved ? "Approved versions (fallback to latest)" : "Latest versions"}`,
      `Compiled: ${compiledAt}`,
      "=".repeat(60),
      "",
    ].join("\n");

    // TOC
    const tocLines = [`TABLE OF CONTENTS\n${"─".repeat(40)}`];
    for (const ep of episodes) {
      const epNum = String(ep.episode_number).padStart(2, "0");
      const hasText = !!episodeTexts[ep.episode_number];
      const srcType = sources.find((s) => s.episode_number === ep.episode_number)?.source_type || "";
      const tag = srcType === "generated_from_beats" ? "  [generated]" : hasText ? "" : "  [MISSING]";
      tocLines.push(`  EP${epNum}  ${ep.title || `Episode ${ep.episode_number}`}${tag}`);
    }
    tocLines.push("");

    // Episode blocks
    const episodeBlocks: string[] = [];
    for (const ep of episodes) {
      const text = episodeTexts[ep.episode_number];
      const epNum = String(ep.episode_number).padStart(2, "0");
      const title = ep.title || `Episode ${ep.episode_number}`;
      const divider = [
        "=".repeat(60),
        `EPISODE ${ep.episode_number}: ${title.toUpperCase()}`,
        "=".repeat(60),
      ].join("\n");

      if (!text) {
        skipped.push({ episode_number: ep.episode_number, reason: "no_content" });
        episodeBlocks.push(
          [divider, "", "[MISSING SCRIPT TEXT]", "This episode has no script and could not be generated.", "", "\f"].join("\n")
        );
      } else {
        // Fail-safe: reject obvious template placeholder brackets
        const hasPlaceholderBrackets = /\[\d+[–\-]\d+\s*(words?|sentences?|lines?|pages?)\]/i.test(text);
        if (hasPlaceholderBrackets) {
          skipped.push({ episode_number: ep.episode_number, reason: "placeholder_brackets_detected" });
          episodeBlocks.push(
            [divider, "", "[PLACEHOLDER CONTENT DETECTED — REGENERATION REQUIRED]", "", "\f"].join("\n")
          );
        } else {
          episodeBlocks.push([divider, "", text.trim(), "", "\f"].join("\n"));
        }
      }
    }

    const masterText = [headerBlock, tocLines.join("\n"), ...episodeBlocks].join("\n");

    // ── 8. Completeness check ──
    const missingEpNums = episodes
      .filter((e) => !episodeTexts[e.episode_number])
      .map((e) => e.episode_number);

    // Hard fail only if >50% missing
    if (missingEpNums.length > episodes.length * 0.5) {
      throw new Error(
        `Too many missing episodes (${missingEpNums.join(", ")}). Ensure episode scripts exist or approved beats/grid are present for generation.`
      );
    }

    // ── 9. Persist as complete_season_script ──
    const docTitle = `${projectTitle} — Complete Season 1 Script`;

    const { data: existingDoc } = await sb
      .from("project_documents")
      .select("id, latest_version_id")
      .eq("project_id", project_id)
      .eq("doc_type", "complete_season_script")
      .maybeSingle();

    let docId: string;
    let changeLog: Array<{ episode: string; change: string }> = [];

    if (existingDoc) {
      docId = existingDoc.id;

      // Build change log: compare current sources vs previous version's sources
      if (existingDoc.latest_version_id) {
        const { data: prevVer } = await sb
          .from("project_document_versions")
          .select("metadata")
          .eq("id", existingDoc.latest_version_id)
          .single();

        const prevSources: any[] = (prevVer?.metadata as any)?.sources_used || [];
        const prevMap: Record<number, string> = {};
        for (const s of prevSources) prevMap[s.episode_number] = s.version_id || s.script_id || "";

        for (const s of sources) {
          const prevId = prevMap[s.episode_number] || "";
          const curId = s.version_id || s.script_id || "";
          const label = `EP${String(s.episode_number).padStart(2, "0")}`;
          if (!prevId) {
            changeLog.push({ episode: label, change: "Added (was missing)" });
          } else if (prevId !== curId) {
            changeLog.push({ episode: label, change: `Script revised (${s.source_type})` });
          }
        }

        // Check if pack docs changed
        const prevPackVersions = (prevVer?.metadata as any)?.approved_pack_versions || {};
        for (const [docType, info] of Object.entries(approvedPack)) {
          const prevId = (prevPackVersions[docType] as any)?.version_id || "";
          if (prevId && prevId !== info.version_id) {
            changeLog.push({ episode: "SOURCE DOC", change: `${docType} updated` });
          }
        }
      }
    } else {
      const slugTitle = (projectTitle || "project")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const dateStr = new Date(compiledAt).toISOString().slice(0, 10);
      const fileName = `${slugTitle}_complete-season-script_${dateStr}.md`;
      if (!fileName) throw new Error("Could not generate file_name for season script document");

      const { data: newDoc, error: docErr } = await sb
        .from("project_documents")
        .insert({ project_id, user_id: userId, doc_type: "complete_season_script", title: docTitle, file_name: fileName } as any)
        .select("id")
        .single();
      if (docErr) throw new Error(`Failed to create doc: ${docErr.message}`);
      docId = newDoc.id;
    }

    // Next version number
    const { data: existingVersions } = await sb
      .from("project_document_versions")
      .select("version_number")
      .eq("document_id", docId)
      .order("version_number", { ascending: false })
      .limit(1);

    const nextVersion = ((existingVersions?.[0]?.version_number as number) || 0) + 1;

    const { data: newVersion, error: verErr } = await sb
      .from("project_document_versions")
      .insert({
        document_id: docId,
        user_id: userId,
        version_number: nextVersion,
        plaintext: masterText,
        status: "draft",
        metadata: {
          doc_type: "complete_season_script",
          compiled_at: compiledAt,
          path_used: pathUsed,
          use_approved,
          episode_count: episodes.length,
          sources_used: sources,
          skipped,
          change_log: changeLog,
          approved_pack_versions: Object.fromEntries(
            Object.entries(approvedPack).map(([k, v]) => [k, { version_id: v.version_id, approved_at: v.approved_at }])
          ),
          format_key_used: format,
          episode_length_targets_used: { min: durationMin, max: durationMax },
        },
      } as any)
      .select("id")
      .single();
    if (verErr) throw new Error(`Failed to save version: ${verErr.message}`);

    // Update doc's latest_version_id
    await sb
      .from("project_documents")
      .update({ latest_version_id: newVersion.id } as any)
      .eq("id", docId);

    return new Response(
      JSON.stringify({
        doc_id: docId,
        version_id: newVersion.id,
        version_number: nextVersion,
        path_used: pathUsed,
        episode_count: episodes.length,
        sources,
        skipped,
        change_log: changeLog,
        compiled_at: compiledAt,
        approved_pack_doc_types: Object.keys(approvedPack),
        script_coverage_pct: Math.round(coveragePct * 100),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("season-package error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── Approved Pack Context Builder ──────────────────────────────────────────

function buildPackContext(
  pack: Record<string, { text: string }>,
  projectTitle: string,
  durationMin: number,
  durationMax: number
): string {
  const ORDERED = ["character_bible", "season_arc", "format_rules", "episode_grid", "vertical_episode_beats", "concept_brief", "topline_narrative"];
  const blocks: string[] = [
    `PROJECT: ${projectTitle}`,
    `FORMAT: Vertical Drama — 9:16 mobile-first`,
    `EPISODE DURATION: ${durationMin}–${durationMax} seconds per episode`,
    "",
  ];
  for (const key of ORDERED) {
    if (pack[key]) {
      blocks.push(`=== ${key.toUpperCase().replace(/_/g, " ")} ===`);
      // Limit each doc to 3000 chars to avoid overflow
      blocks.push(pack[key].text.slice(0, 3000));
      blocks.push("");
    }
  }
  return blocks.join("\n");
}

// ─── Episode Batch Generator ────────────────────────────────────────────────

async function generateEpisodeBatch(
  episodes: Array<{ episode_number: number; title: string | null; logline: string | null }>,
  packContext: string,
  projectTitle: string,
  durationMin: number,
  durationMax: number,
  apiKey: string
): Promise<Record<number, string>> {
  const beatsPerEp = Math.round(((durationMin + durationMax) / 2) / 15); // ~15s per beat
  const epList = episodes
    .map((e) => `EP${String(e.episode_number).padStart(2, "0")}: ${e.title || `Episode ${e.episode_number}`}${e.logline ? ` — ${e.logline}` : ""}`)
    .join("\n");

  const system = `You are a professional vertical drama screenwriter. You write tight, scroll-stopping content for 9:16 mobile vertical format.

ABSOLUTE RULES:
- Each episode = ${durationMin}–${durationMax} seconds of screen time (~${beatsPerEp} beats at 15s/beat)
- EVERY episode MUST start with a hook (0–10 seconds) and end with a micro-cliffhanger
- Action lines must be SHORT and punchy — mobile-aware, no wide-shot descriptions
- NO placeholder brackets like [insert dialogue] or [150–300 words]
- Write COMPLETE episode scripts — no gaps, no summaries
- Format: scene sluglines (INT./EXT.), action lines, CHARACTER NAME, dialogue

OUTPUT FORMAT — use EXACT delimiters:
===EPISODE_N===
[full script for episode N]

Repeat for each episode requested.`;

  const userPrompt = `Write complete vertical drama episode scripts for "${projectTitle}":

${epList}

SEASON CONTEXT:
${packContext.slice(0, 8000)}

Requirements per episode:
- ${durationMin}–${durationMax} seconds runtime
- Hook within first 10 seconds
- Micro-cliffhanger ending
- Mobile-first action lines
- Complete screenplay format

Output each episode using ===EPISODE_N=== delimiter.`;

  try {
    const result = await callLLM({
      apiKey,
      model: MODELS.BALANCED,
      system,
      user: userPrompt,
      temperature: 0.75,
      maxTokens: 10000,
    });

    const content = result.content;
    const output: Record<number, string> = {};
    const epPattern = /===EPISODE_(\d+)===([\s\S]*?)(?====EPISODE_\d+===|$)/g;
    let match;
    while ((match = epPattern.exec(content)) !== null) {
      const epNum = parseInt(match[1]);
      const text = match[2].trim();
      if (text.length > 80) output[epNum] = text;
    }
    return output;
  } catch (err) {
    console.error("generateEpisodeBatch error:", err);
    return {};
  }
}
