/**
 * Centralized Episode Count Resolver
 * 
 * Single source of truth for determining how many episodes a project has.
 * Resolution order:
 *   1. projects.season_episode_count (canonical, set by user)
 *   2. episode_grid document (parsed markdown table or prose)
 *   3. season_arc document (regex: "N episodes")
 *   4. Format default (vertical_drama=30, series=8) — with warning
 * 
 * INVARIANT: If an episode_grid document exists but parsing yields 0 rows,
 * this function THROWS rather than falling back to defaults.
 */

export interface EpisodeCountResult {
  episodeCount: number;
  source: "canonical_project" | "episode_grid" | "season_arc_count" | "default";
  parsedGridCount: number;
  gridDocExists: boolean;
  gridEntries: EpisodeGridEntry[];
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
 * Resolve episode count for a project using the canonical priority chain.
 * 
 * @throws Error if episode_grid exists but parsing yields 0 episodes
 */
export async function resolveEpisodeCount(
  supabaseClient: any,
  projectId: string,
  format: string,
): Promise<EpisodeCountResult> {
  const isVertical = format.includes("vertical");

  // 1) Canonical: projects.season_episode_count
  const { data: proj } = await supabaseClient
    .from("projects")
    .select("season_episode_count")
    .eq("id", projectId)
    .single();

  const canonicalCount = proj?.season_episode_count;
  if (typeof canonicalCount === "number" && canonicalCount > 0) {
    console.log(`[episode-count] Resolved from canonical_project: ${canonicalCount}`);
    return {
      episodeCount: canonicalCount,
      source: "canonical_project",
      parsedGridCount: 0,
      gridDocExists: false,
      gridEntries: [],
    };
  }

  // 2) episode_grid document
  const { data: gridDoc } = await supabaseClient
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", "episode_grid")
    .limit(1);

  const gridDocExists = !!(gridDoc && gridDoc.length > 0);
  let gridEntries: EpisodeGridEntry[] = [];

  if (gridDocExists) {
    const { data: gridVer } = await supabaseClient
      .from("project_document_versions")
      .select("plaintext")
      .eq("document_id", gridDoc[0].id)
      .eq("is_current", true)
      .limit(1);

    const gridText = gridVer?.[0]?.plaintext || "";
    gridEntries = parseEpisodeGrid(gridText);

    if (gridEntries.length === 0) {
      throw new Error(
        `Episode grid document exists but zero episodes were parsed. ` +
        `Check markdown table format. Grid doc id: ${gridDoc[0].id}`
      );
    }

    const parsedCount = gridEntries.length;
    console.log(`[episode-count] Resolved from episode_grid: ${parsedCount} episodes`);
    return {
      episodeCount: parsedCount,
      source: "episode_grid",
      parsedGridCount: parsedCount,
      gridDocExists: true,
      gridEntries,
    };
  }

  // 3) season_arc: regex "N episodes"
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
      if (count > 0) {
        console.log(`[episode-count] Resolved from season_arc_count: ${count}`);
        return {
          episodeCount: count,
          source: "season_arc_count",
          parsedGridCount: 0,
          gridDocExists: false,
          gridEntries: [],
        };
      }
    }
  }

  // 4) Format default — with warning
  const defaultCount = isVertical ? 30 : 8;
  console.warn(
    `[episode-count] WARNING: No canonical count, no episode_grid, no season_arc count found. ` +
    `Falling back to format default: ${defaultCount} (format=${format})`
  );
  return {
    episodeCount: defaultCount,
    source: "default",
    parsedGridCount: 0,
    gridDocExists: false,
    gridEntries: [],
  };
}
