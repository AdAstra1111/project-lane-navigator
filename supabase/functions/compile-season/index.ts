/**
 * compile-season — Builds a master season script document from all episode scripts.
 * POST { project_id, season_number?, use_approved, episode_ids?, include_episode_titles }
 * Returns { doc_id, version_id, sources, skipped }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      project_id,
      season_number,
      use_approved = false,
      episode_ids,
      include_episode_titles = true,
    } = await req.json();

    if (!project_id) throw new Error("project_id required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Auth
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    let userId: string | null = null;
    if (token) {
      const sbAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: { user } } = await sbAuth.auth.getUser(token);
      userId = user?.id || null;
    }
    if (!userId) throw new Error("Not authenticated");

    // Fetch project info
    const { data: project } = await sb
      .from("projects")
      .select("title, season_episode_count")
      .eq("id", project_id)
      .single();

    // Fetch episodes ordered by episode_number
    let epQuery = sb
      .from("series_episodes")
      .select("id, episode_number, title, logline, script_id, locked_at, status")
      .eq("project_id", project_id)
      .is("deleted_at", null)
      .order("episode_number", { ascending: true });

    if (episode_ids && episode_ids.length > 0) {
      epQuery = epQuery.in("id", episode_ids);
    }

    const { data: episodes, error: epErr } = await epQuery;
    if (epErr) throw epErr;
    if (!episodes || episodes.length === 0) throw new Error("No episodes found");

    const sources: Array<{ episode_id: string; episode_number: number; script_id: string | null; version_id: string | null; source_type: string }> = [];
    const skipped: Array<{ episode_number: number; reason: string }> = [];

    // Helper: get script text for an episode
    const getScriptText = async (ep: any): Promise<{ text: string | null; script_id: string | null; version_id: string | null; source_type: string }> => {
      if (!ep.script_id) {
        return { text: null, script_id: null, version_id: null, source_type: "missing" };
      }

      // If use_approved: check for an approved project_document_version for this episode's script
      if (use_approved) {
        // Look for a project_document linking to this script that has an approved/final version
        const { data: docVersions } = await sb
          .from("project_document_versions")
          .select("id, plaintext, status")
          .eq("script_id" as any, ep.script_id)
          .eq("status", "final")
          .order("version_number", { ascending: false })
          .limit(1);

        if (docVersions && docVersions.length > 0) {
          const ver = docVersions[0];
          return {
            text: ver.plaintext as string,
            script_id: ep.script_id,
            version_id: ver.id,
            source_type: "approved",
          };
        }
        // No approved version found, fall through to latest
      }

      // Fallback: use script.text_content directly
      const { data: script } = await sb
        .from("scripts")
        .select("text_content")
        .eq("id", ep.script_id)
        .single();

      return {
        text: script?.text_content || null,
        script_id: ep.script_id,
        version_id: null,
        source_type: use_approved ? "latest_fallback" : "latest",
      };
    };

    // Build master text
    const projectTitle = project?.title || "Season";
    const seasonLabel = season_number ? `Season ${season_number}` : "Season";
    const compiledAt = new Date().toISOString();

    const headerBlock = [
      `${"=".repeat(60)}`,
      `${projectTitle.toUpperCase()} — ${seasonLabel.toUpperCase()} MASTER SCRIPT`,
      `Compiled: ${new Date(compiledAt).toLocaleString("en-US", { timeZoneName: "short" })}`,
      `Episodes: ${episodes.length}`,
      `Source mode: ${use_approved ? "Approved versions (with fallback to latest)" : "Latest versions"}`,
      `${"=".repeat(60)}`,
      "",
    ].join("\n");

    // TOC
    const tocLines = [`TABLE OF CONTENTS\n${"─".repeat(40)}`];
    for (const ep of episodes) {
      const title = include_episode_titles && ep.title ? ep.title : `Episode ${ep.episode_number}`;
      const epNum = String(ep.episode_number).padStart(2, "0");
      const hasScript = !!ep.script_id;
      tocLines.push(`  EP${epNum}  ${title}${hasScript ? "" : "  [MISSING]"}`);
    }
    tocLines.push("");

    const episodeBlocks: string[] = [];

    for (const ep of episodes) {
      const { text, script_id, version_id, source_type } = await getScriptText(ep);
      const epNum = String(ep.episode_number).padStart(2, "0");
      const title = include_episode_titles && ep.title ? ep.title : `Episode ${ep.episode_number}`;

      sources.push({
        episode_id: ep.id,
        episode_number: ep.episode_number,
        script_id,
        version_id,
        source_type,
      });

      const divider = `${"=".repeat(60)}\nEPISODE ${ep.episode_number}: ${title.toUpperCase()}\n${"=".repeat(60)}`;

      if (!text) {
        skipped.push({ episode_number: ep.episode_number, reason: "no_script" });
        episodeBlocks.push([
          divider,
          "",
          "[MISSING SCRIPT TEXT]",
          "This episode has not yet been written or its script could not be retrieved.",
          "",
          `\f`, // page break marker
        ].join("\n"));
        continue;
      }

      episodeBlocks.push([
        divider,
        "",
        text.trim(),
        "",
        `\f`, // page break marker
      ].join("\n"));
    }

    const masterText = [
      headerBlock,
      tocLines.join("\n"),
      ...episodeBlocks,
    ].join("\n");

    // Persist as project_document + version with doc_type = 'season_master_script'
    const docTitle = `${projectTitle} — ${seasonLabel} Master Script`;

    // Build a slug-safe file_path (column name in project_documents)
    const slugTitle = (projectTitle || "project")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const slugSeason = season_number ? `season-${season_number}` : "season";
    const dateStr = new Date(compiledAt).toISOString().slice(0, 10);
    const filePath = `${userId}/${project_id}/${slugTitle}_${slugSeason}_master-season-script_${dateStr}.md`;

    if (!filePath) throw new Error("Could not generate file_path for master script document");

    // Check if a season_master_script doc already exists
    const { data: existingDoc } = await sb
      .from("project_documents")
      .select("id, title")
      .eq("project_id", project_id)
      .eq("doc_type", "season_master_script")
      .maybeSingle();

    let docId: string;
    if (existingDoc) {
      docId = existingDoc.id;
    } else {
      const { data: newDoc, error: docErr } = await sb
        .from("project_documents")
        .insert({
          project_id,
          user_id: userId,
          doc_type: "season_master_script",
          title: docTitle,
          file_path: filePath,
          file_name: filePath.split("/").pop()!,
        } as any)
        .select("id")
        .single();
      if (docErr) throw docErr;
      docId = newDoc.id;
    }

    // Get current max version number for this doc
    const { data: versions } = await sb
      .from("project_document_versions")
      .select("version_number")
      .eq("document_id", docId)
      .order("version_number", { ascending: false })
      .limit(1);

    const nextVersion = ((versions?.[0]?.version_number as number) || 0) + 1;

    // Insert new version
    const { data: newVersion, error: verErr } = await sb
      .from("project_document_versions")
      .insert({
        document_id: docId,
        user_id: userId,
        version_number: nextVersion,
        plaintext: masterText,
        status: "draft",
        metadata: {
          doc_type: "season_master_script",
          season_number: season_number || null,
          compiled_at: compiledAt,
          use_approved,
          include_episode_titles,
          sources,
          skipped,
          episode_count: episodes.length,
        },
      } as any)
      .select("id")
      .single();
    if (verErr) throw verErr;

    // Update doc latest_version_id
    await sb
      .from("project_documents")
      .update({ latest_version_id: newVersion.id } as any)
      .eq("id", docId);

    return new Response(
      JSON.stringify({
        doc_id: docId,
        version_id: newVersion.id,
        version_number: nextVersion,
        sources,
        skipped,
        episode_count: episodes.length,
        compiled_at: compiledAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("compile-season error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
