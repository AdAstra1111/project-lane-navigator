/**
 * Episode Count Consistency Validator
 * 
 * Deterministic check that all season documents match the canonical
 * projects.season_episode_count. Returns a structured report.
 */

export interface EpisodeCountReport {
  ok: boolean;
  N: number | null;
  locked: boolean;
  source: string;
  episode_scripts: {
    found_count: number;
    missing: number[];
    duplicates: number[];
    extras: number[];
  };
  master: {
    exists: boolean;
    episode_count: number | null;
    missing_separators: number[];
    extra_separators: number[];
  };
}

/**
 * Validate that all episode-related documents match the canonical count.
 */
export async function validateEpisodeCount(
  supabaseClient: any,
  projectId: string,
): Promise<EpisodeCountReport> {
  // 1) Load canonical count
  const { data: proj } = await supabaseClient
    .from("projects")
    .select("season_episode_count, season_episode_count_locked")
    .eq("id", projectId)
    .single();

  const N: number | null = (typeof proj?.season_episode_count === "number" && proj.season_episode_count > 0)
    ? proj.season_episode_count
    : null;
  const locked = proj?.season_episode_count_locked === true;

  if (N === null) {
    return {
      ok: false,
      N: null,
      locked: false,
      source: "unset",
      episode_scripts: { found_count: 0, missing: [], duplicates: [], extras: [] },
      master: { exists: false, episode_count: null, missing_separators: [], extra_separators: [] },
    };
  }

  // 2) Load episode_script docs
  const { data: epDocs } = await supabaseClient
    .from("project_documents")
    .select("id, meta_json")
    .eq("project_id", projectId)
    .eq("doc_type", "episode_script");

  const indexCounts = new Map<number, number>();
  for (const d of (epDocs || [])) {
    const idx = (d.meta_json as any)?.episode_index;
    if (typeof idx === "number") {
      indexCounts.set(idx, (indexCounts.get(idx) || 0) + 1);
    }
  }

  const missing: number[] = [];
  for (let i = 1; i <= N; i++) {
    if (!indexCounts.has(i)) missing.push(i);
  }

  const duplicates: number[] = [];
  for (const [idx, count] of indexCounts) {
    if (count > 1 && idx >= 1 && idx <= N) duplicates.push(idx);
  }

  const extras: number[] = [];
  for (const idx of indexCounts.keys()) {
    if (idx < 1 || idx > N) extras.push(idx);
  }

  // 3) Check master script
  const { data: masterDoc } = await supabaseClient
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", "season_master_script")
    .limit(1);

  let masterExists = false;
  let masterEpCount: number | null = null;
  const masterMissing: number[] = [];
  const masterExtra: number[] = [];

  if (masterDoc && masterDoc.length > 0) {
    masterExists = true;
    const { data: masterVer } = await supabaseClient
      .from("project_document_versions")
      .select("plaintext")
      .eq("document_id", masterDoc[0].id)
      .eq("is_current", true)
      .limit(1);

    const masterText = masterVer?.[0]?.plaintext || "";
    // Parse separators: === EPISODE 01 ===
    const sepRegex = /=== EPISODE (\d+)/g;
    const foundSeps = new Set<number>();
    let m;
    while ((m = sepRegex.exec(masterText)) !== null) {
      foundSeps.add(parseInt(m[1]));
    }
    masterEpCount = foundSeps.size;

    for (let i = 1; i <= N; i++) {
      if (!foundSeps.has(i)) masterMissing.push(i);
    }
    for (const s of foundSeps) {
      if (s < 1 || s > N) masterExtra.push(s);
    }
  }

  const ok = missing.length === 0 && duplicates.length === 0 && extras.length === 0
    && masterMissing.length === 0 && masterExtra.length === 0;

  return {
    ok,
    N,
    locked,
    source: "canonical_project",
    episode_scripts: {
      found_count: indexCounts.size,
      missing,
      duplicates,
      extras,
    },
    master: {
      exists: masterExists,
      episode_count: masterEpCount,
      missing_separators: masterMissing,
      extra_separators: masterExtra,
    },
  };
}
