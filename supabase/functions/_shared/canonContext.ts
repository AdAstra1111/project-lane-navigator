/**
 * Shared Canonical Context Fetcher — single source of truth for all edge functions
 * that need project canon in LLM prompts.
 *
 * Returns the Active Approved canon (if any), else falls back to latest canon_json.
 * Also provides a compact text summary capped to a safe token budget.
 */

export interface CanonicalContext {
  /** Full canon JSON */
  canon: Record<string, unknown>;
  /** Whether this is from an approved snapshot */
  isApproved: boolean;
  /** Compact text representation for prompt injection (capped) */
  compactText: string;
  /** Version ID if from approved version */
  versionId: string | null;
}

const MAX_COMPACT_CHARS = 8000;

/**
 * Fetch canonical context for a project.
 * Priority: Active Approved version > latest project_canon row.
 */
export async function getCanonicalContext(
  supabase: any,
  projectId: string,
): Promise<CanonicalContext> {
  // 1. Try active approved version
  const { data: approved } = await supabase
    .from('project_canon_versions')
    .select('id, canon_json')
    .eq('project_id', projectId)
    .eq('is_approved', true)
    .order('approved_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (approved?.canon_json && Object.keys(approved.canon_json).length > 0) {
    return {
      canon: approved.canon_json,
      isApproved: true,
      compactText: buildCompactText(approved.canon_json),
      versionId: approved.id,
    };
  }

  // 2. Fallback to latest project_canon
  const { data: current } = await supabase
    .from('project_canon')
    .select('canon_json')
    .eq('project_id', projectId)
    .maybeSingle();

  const json = current?.canon_json || {};
  return {
    canon: json,
    isApproved: false,
    compactText: buildCompactText(json),
    versionId: null,
  };
}

function buildCompactText(canon: Record<string, unknown>): string {
  const sections: string[] = [];

  if (canon.logline) sections.push(`LOGLINE: ${canon.logline}`);
  if (canon.premise) sections.push(`PREMISE: ${canon.premise}`);

  if (Array.isArray(canon.characters) && canon.characters.length > 0) {
    const charLines = canon.characters.map((c: any) => {
      const parts = [c.name];
      if (c.role) parts.push(`(${c.role})`);
      if (c.goals) parts.push(`Goals: ${c.goals}`);
      if (c.traits) parts.push(`Traits: ${c.traits}`);
      if (c.secrets) parts.push(`Secrets: ${c.secrets}`);
      if (c.relationships) parts.push(`Relationships: ${c.relationships}`);
      return parts.join(' | ');
    });
    sections.push(`CHARACTERS:\n${charLines.join('\n')}`);
  }

  if (canon.timeline) sections.push(`TIMELINE: ${canon.timeline}`);
  if (canon.world_rules) sections.push(`WORLD RULES: ${canon.world_rules}`);
  if (canon.locations) sections.push(`LOCATIONS: ${canon.locations}`);
  if (canon.ongoing_threads) sections.push(`ONGOING THREADS: ${canon.ongoing_threads}`);
  if (canon.tone_style) sections.push(`TONE & STYLE: ${canon.tone_style}`);
  if (canon.format_constraints) sections.push(`FORMAT CONSTRAINTS: ${canon.format_constraints}`);
  if (canon.forbidden_changes) sections.push(`LOCKED FACTS (DO NOT CHANGE): ${canon.forbidden_changes}`);

  let text = sections.join('\n\n');
  if (text.length > MAX_COMPACT_CHARS) {
    text = text.slice(0, MAX_COMPACT_CHARS) + '\n[…truncated]';
  }
  return text;
}
