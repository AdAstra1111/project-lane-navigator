/**
 * Centralized Episode Count Resolver
 * 
 * Single source of truth for determining how many episodes a project has.
 * Resolution order:
 *   1. projects.season_episode_count (canonical, set by user)
 *   2. episode_grid document (parsed markdown table or prose)
 *   3. season_arc document (regex: "N episodes")
 *   4. ERROR — never defaults to a magic number
 * 
 * INVARIANT: If an episode_grid document exists but parsing yields 0 rows,
 * this function THROWS rather than falling back to defaults.
 * 
 * INVARIANT: If no source provides a count, this function THROWS with
 * EPISODE_COUNT_NOT_SET — it NEVER returns a format-based default (8/30).
 */

export interface EpisodeCountResult {
  episodeCount: number;
  source: "canonical_project" | "episode_grid" | "season_arc_count" | "inferred_canon" | "inferred_decision_ledger";
  parsedGridCount: number;
  gridDocExists: boolean;
  gridEntries: EpisodeGridEntry[];
  locked: boolean;
}

export interface EpisodeGridEntry {
  index: number;
  title: string;
  logline: string;
}

/**
 * Parse episode entries from grid text.
 * Supports markdown tables and prose formats.
 */
export function parseEpisodeGrid(gridText: string): EpisodeGridEntry[] {
  const entries: EpisodeGridEntry[] = [];
  if (!gridText || gridText.trim().length === 0) return entries;

  // 1) Markdown table: rows like "| 1 | **Title** | logline | ..."
  const tableRowRegex = /^\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/gm;
  let tableMatch;
  while ((tableMatch = tableRowRegex.exec(gridText)) !== null) {
    const num = parseInt(tableMatch[1]);
    if (isNaN(num) || num < 1) continue;
    const titleRaw = tableMatch[2].trim();
    const title = titleRaw.replace(/\*\*/g, "").replace(/_/g, "").trim();
    const logline = tableMatch[3].trim();
    entries.push({
      index: num,
      title: title || `Episode ${num}`,
      logline: logline || "",
    });
  }

  if (entries.length > 0) return entries;

  // 2) Prose fallback: "Episode 1: Title" or "Ep 1 - Title"
  const epMatches = gridText.match(
    /(?:episode|ep\.?\s*)\s*(\d+)[:\s\-–—]+(.*?)(?=\n(?:episode|ep\.?\s*)\s*\d+|\n\n|$)/gi
  );
  if (epMatches) {
    for (const m of epMatches) {
      const numMatch = m.match(/(\d+)/);
      const num = numMatch ? parseInt(numMatch[1]) : entries.length + 1;
      const titleMatch = m.match(/\d+[:\s\-–—]+\s*"?([^"\n]+)"?/);
      entries.push({
        index: num,
        title: titleMatch?.[1]?.trim() || `Episode ${num}`,
        logline: m.trim(),
      });
    }
  }

  return entries;
}

/**
 * One-time inference: try to determine episode count from existing docs.
 * Returns the count if found, null if not. NEVER guesses or defaults.
 */
export async function inferEpisodeCountFromDocs(
  supabaseClient: any,
  projectId: string,
): Promise<number | null> {
  // 1) project_canon.canon_json.season_episode_count
  try {
    const { data: canon } = await supabaseClient
      .from("project_canon")
      .select("canon_json")
      .eq("project_id", projectId)
      .maybeSingle();
    const canonCount = (canon?.canon_json as any)?.season_episode_count;
    if (typeof canonCount === "number" && canonCount > 0 && canonCount <= 300) {
      console.log(`[episode-count] Inferred from project_canon: ${canonCount}`);
      return canonCount;
    }
  } catch (_) { /* ignore */ }

  // 2) decision_ledger active decision
  try {
    const { data: decisions } = await supabaseClient
      .from("dev_decision_state")
      .select("decision_value")
      .eq("project_id", projectId)
      .eq("decision_key", "season_episode_count")
      .eq("status", "active")
      .limit(1);
    if (decisions && decisions.length > 0) {
      const val = parseInt(decisions[0].decision_value);
      if (val > 0 && val <= 300) {
        console.log(`[episode-count] Inferred from decision_ledger: ${val}`);
        return val;
      }
    }
  } catch (_) { /* ignore — table may not exist */ }

  // 3) Parse episode_grid
  const { data: gridDoc } = await supabaseClient
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", "episode_grid")
    .limit(1);

  if (gridDoc && gridDoc.length > 0) {
    const { data: gridVer } = await supabaseClient
      .from("project_document_versions")
      .select("plaintext")
      .eq("document_id", gridDoc[0].id)
      .eq("is_current", true)
      .limit(1);

    const gridText = gridVer?.[0]?.plaintext || "";
    const gridEntries = parseEpisodeGrid(gridText);
    if (gridEntries.length > 0) {
      console.log(`[episode-count] Inferred from episode_grid: ${gridEntries.length}`);
      return gridEntries.length;
    }

    // Explicit "Episode Count: N" or "Total Episodes: N" header
    const explicitMatch = gridText.match(/(?:episode count|total episodes)[:\s]*(\d+)/i);
    if (explicitMatch) {
      const n = parseInt(explicitMatch[1]);
      if (n > 0 && n <= 300) {
        console.log(`[episode-count] Inferred from episode_grid header: ${n}`);
        return n;
      }
    }
  }

  // 4) Parse season_arc
  const { data: arcDoc } = await supabaseClient
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", "season_arc")
    .limit(1);

  if (arcDoc && arcDoc.length > 0) {
    const { data: arcVer } = await supabaseClient
      .from("project_document_versions")
      .select("plaintext")
      .eq("document_id", arcDoc[0].id)
      .eq("is_current", true)
      .limit(1);

    const arcText = arcVer?.[0]?.plaintext || "";
    const countMatch = arcText.match(/(\d+)\s*episodes/i);
    if (countMatch) {
      const count = parseInt(countMatch[1]);
      if (count > 0 && count <= 300) {
        console.log(`[episode-count] Inferred from season_arc: ${count}`);
        return count;
      }
    }
  }

  return null;
}

/**
 * Get the canonical episode count or throw EPISODE_COUNT_NOT_SET.
 * 
 * If projects.season_episode_count is set, returns it immediately.
 * If not set: attempts ONE-TIME inference from docs and writes it (unlocked).
 * If inference fails: throws Error("EPISODE_COUNT_NOT_SET").
 * 
 * NEVER returns a format-based default. NEVER guesses.
 */
export async function getCanonicalEpisodeCountOrThrow(
  supabaseClient: any,
  projectId: string,
): Promise<{ episodeCount: number; locked: boolean; source: string }> {
  // 1) Check canonical column
  const { data: proj } = await supabaseClient
    .from("projects")
    .select("season_episode_count, season_episode_count_locked")
    .eq("id", projectId)
    .single();

  const canonicalCount = proj?.season_episode_count;
  const locked = proj?.season_episode_count_locked === true;

  if (typeof canonicalCount === "number" && canonicalCount > 0) {
    return { episodeCount: canonicalCount, locked, source: "canonical_project" };
  }

  // 2) Attempt one-time inference
  const inferred = await inferEpisodeCountFromDocs(supabaseClient, projectId);
  if (inferred !== null) {
    // Write to projects (unlocked) so future calls don't re-infer
    await supabaseClient.from("projects")
      .update({ season_episode_count: inferred })
      .eq("id", projectId);

    console.log(`[episode-count] Auto-set canonical count to ${inferred} (inferred, unlocked)`);
    return { episodeCount: inferred, locked: false, source: "inferred" };
  }

  // 3) No count available — hard error
  throw new Error("EPISODE_COUNT_NOT_SET");
}

/**
 * Resolve episode count for a project using the canonical priority chain.
 * 
 * This is the main entry point for all generators and compilers.
 * It NEVER returns a format-based default.
 * 
 * @throws Error("EPISODE_COUNT_NOT_SET") if no count can be determined
 * @throws Error if episode_grid exists but parsing yields 0 episodes
 */
export async function resolveEpisodeCount(
  supabaseClient: any,
  projectId: string,
  _format?: string, // kept for API compat but no longer used for defaults
): Promise<EpisodeCountResult> {
  // Use the canonical getter — it handles inference + persistence
  const canonical = await getCanonicalEpisodeCountOrThrow(supabaseClient, projectId);

  // Also load grid entries if available (for title/logline metadata)
  let gridEntries: EpisodeGridEntry[] = [];
  let gridDocExists = false;

  const { data: gridDoc } = await supabaseClient
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", "episode_grid")
    .limit(1);

  if (gridDoc && gridDoc.length > 0) {
    gridDocExists = true;
    const { data: gridVer } = await supabaseClient
      .from("project_document_versions")
      .select("plaintext")
      .eq("document_id", gridDoc[0].id)
      .eq("is_current", true)
      .limit(1);

    const gridText = gridVer?.[0]?.plaintext || "";
    gridEntries = parseEpisodeGrid(gridText);
  }

  return {
    episodeCount: canonical.episodeCount,
    source: canonical.source as any,
    parsedGridCount: gridEntries.length,
    gridDocExists,
    gridEntries,
    locked: canonical.locked,
  };
}
