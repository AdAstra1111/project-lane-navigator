/**
 * Shared lane prefs + team voice loader for edge functions.
 */

export async function loadLanePrefs(
  supabase: any,
  projectId: string,
  lane: string,
): Promise<any> {
  try {
    const { data } = await supabase
      .from("project_lane_prefs")
      .select("prefs")
      .eq("project_id", projectId)
      .eq("lane", lane)
      .maybeSingle();
    return data?.prefs || {};
  } catch {
    return {};
  }
}

export async function loadTeamVoiceProfile(
  supabase: any,
  teamVoiceId: string,
): Promise<{ label: string; profile_json: any } | null> {
  try {
    const { data } = await supabase
      .from("team_voices")
      .select("label, profile_json")
      .eq("id", teamVoiceId)
      .single();
    if (!data?.profile_json) return null;
    return { label: data.label, profile_json: data.profile_json };
  } catch {
    return null;
  }
}
