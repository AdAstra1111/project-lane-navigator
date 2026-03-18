/**
 * Structural Lineage Resolver — single canonical retrieval path for
 * DNA → Engine → Blueprint lineage persisted on projects and idea_blueprints.
 *
 * INVARIANTS:
 * - Blueprint is highest structural authority when present.
 * - Engine-only context used only when blueprint absent.
 * - Broken canonical blueprint links are blocked, not hidden.
 * - Deterministic: same DB state → same output.
 */

export type AuthorityLevel = "blueprint" | "engine" | "dna" | "none";

export interface StructuralLineage {
  source_dna_profile_id: string | null;
  source_engine_key: string | null;
  source_blueprint_id: string | null;
  source_blueprint_family_key: string | null;
  authority_level: AuthorityLevel;

  // Blueprint-sourced (highest authority)
  engine_key: string | null;
  blueprint_family_key: string | null;
  execution_pattern: Record<string, unknown> | null;
  structural_summary: string | null;
  family_selection_confidence: number | null;
  family_selection_rationale: string | null;

  // DNA-sourced (fallback context)
  dna_thematic_spine: string | null;

  // Engine-sourced (fallback structural pattern)
  engine_label: string | null;
  engine_structural_pattern: string | null;

  // Prompt block (pre-built for injection)
  blockText: string;
}

const STRUCTURAL_BUDGET = 3000;

/**
 * Resolve structural lineage for a project from canonical DB sources.
 */
export async function resolveStructuralLineage(
  supabase: any,
  projectId: string,
): Promise<StructuralLineage> {
  const empty: StructuralLineage = {
    source_dna_profile_id: null,
    source_engine_key: null,
    source_blueprint_id: null,
    source_blueprint_family_key: null,
    authority_level: "none",
    engine_key: null,
    blueprint_family_key: null,
    execution_pattern: null,
    structural_summary: null,
    family_selection_confidence: null,
    family_selection_rationale: null,
    dna_thematic_spine: null,
    engine_label: null,
    engine_structural_pattern: null,
    blockText: "",
  };

  // 1. Fetch lineage pointers from project
  let proj: any;
  try {
    const { data } = await supabase
      .from("projects")
      .select("source_dna_profile_id, source_engine_key, source_blueprint_id, source_blueprint_family_key")
      .eq("id", projectId)
      .maybeSingle();
    proj = data;
  } catch (e) {
    console.warn("[structural-lineage] project fetch failed:", e);
    return empty;
  }

  if (!proj) return empty;

  const result: StructuralLineage = { ...empty };
  result.source_dna_profile_id = proj.source_dna_profile_id || null;
  result.source_engine_key = proj.source_engine_key || null;
  result.source_blueprint_id = proj.source_blueprint_id || null;
  result.source_blueprint_family_key = proj.source_blueprint_family_key || null;

  // 2. Blueprint authority path (highest)
  if (proj.source_blueprint_id) {
    try {
      const { data: bp } = await supabase
        .from("idea_blueprints")
        .select("engine, blueprint_family_key, execution_pattern, family_selection_confidence, family_selection_rationale, structural_summary, source_dna_profile_id")
        .eq("id", proj.source_blueprint_id)
        .maybeSingle();

      if (!bp) {
        // IEL: Broken canonical link — fail explicitly
        console.error(JSON.stringify({
          diag: "DEV_ENGINE_STRUCTURAL_CONTEXT_BLOCKED",
          project_id: projectId,
          source_blueprint_id: proj.source_blueprint_id,
          reason: "canonical_blueprint_not_found",
        }));
        // Return empty with blockText warning rather than silently degrading
        result.blockText = `\n[STRUCTURAL LINEAGE ERROR: Blueprint ${proj.source_blueprint_id} linked but not found. Structural guidance unavailable.]`;
        return result;
      }

      // IEL: Validate required fields
      if (!bp.blueprint_family_key) {
        console.error(JSON.stringify({
          diag: "DEV_ENGINE_STRUCTURAL_CONTEXT_BLOCKED",
          project_id: projectId,
          source_blueprint_id: proj.source_blueprint_id,
          reason: "blueprint_missing_family_key",
        }));
        result.blockText = `\n[STRUCTURAL LINEAGE ERROR: Blueprint exists but missing family_key.]`;
        return result;
      }

      if (!bp.execution_pattern || Object.keys(bp.execution_pattern).length === 0) {
        console.error(JSON.stringify({
          diag: "DEV_ENGINE_STRUCTURAL_CONTEXT_BLOCKED",
          project_id: projectId,
          source_blueprint_id: proj.source_blueprint_id,
          reason: "blueprint_empty_execution_pattern",
        }));
        result.blockText = `\n[STRUCTURAL LINEAGE ERROR: Blueprint exists but execution_pattern is empty.]`;
        return result;
      }

      result.authority_level = "blueprint";
      result.engine_key = bp.engine || proj.source_engine_key || null;
      result.blueprint_family_key = bp.blueprint_family_key;
      result.execution_pattern = bp.execution_pattern;
      result.structural_summary = bp.structural_summary || null;
      result.family_selection_confidence = bp.family_selection_confidence ?? null;
      result.family_selection_rationale = bp.family_selection_rationale || null;

      // Optionally enrich with DNA thematic spine
      const dnaId = bp.source_dna_profile_id || proj.source_dna_profile_id;
      if (dnaId) {
        result.source_dna_profile_id = dnaId;
        try {
          const { data: dna } = await supabase
            .from("narrative_dna_profiles")
            .select("thematic_spine")
            .eq("id", dnaId)
            .maybeSingle();
          if (dna?.thematic_spine) result.dna_thematic_spine = dna.thematic_spine;
        } catch (_) { /* non-critical */ }
      }

      result.blockText = buildBlueprintBlock(result);

      console.log(JSON.stringify({
        diag: "DEV_ENGINE_STRUCTURAL_CONTEXT_RESOLVED",
        project_id: projectId,
        authority_level: "blueprint",
        source_blueprint_id: proj.source_blueprint_id,
        blueprint_family_key: bp.blueprint_family_key,
        engine_key: result.engine_key,
        confidence: bp.family_selection_confidence,
        source_dna_profile_id: result.source_dna_profile_id,
      }));

      return result;
    } catch (e) {
      console.error(JSON.stringify({
        diag: "DEV_ENGINE_STRUCTURAL_CONTEXT_BLOCKED",
        project_id: projectId,
        source_blueprint_id: proj.source_blueprint_id,
        reason: "blueprint_fetch_error",
        error: String(e),
      }));
      result.blockText = `\n[STRUCTURAL LINEAGE ERROR: Blueprint fetch failed.]`;
      return result;
    }
  }

  // 3. Engine-only fallback path
  if (proj.source_engine_key) {
    try {
      const { data: eng } = await supabase
        .from("narrative_engines")
        .select("engine_key, label, structural_pattern, description")
        .eq("engine_key", proj.source_engine_key)
        .maybeSingle();

      if (eng) {
        result.authority_level = "engine";
        result.engine_key = eng.engine_key;
        result.engine_label = eng.label || null;
        result.engine_structural_pattern = eng.structural_pattern || null;

        // Also fetch DNA if available
        if (proj.source_dna_profile_id) {
          try {
            const { data: dna } = await supabase
              .from("narrative_dna_profiles")
              .select("thematic_spine")
              .eq("id", proj.source_dna_profile_id)
              .maybeSingle();
            if (dna?.thematic_spine) result.dna_thematic_spine = dna.thematic_spine;
          } catch (_) { /* non-critical */ }
        }

        result.blockText = buildEngineBlock(result);

        console.log(JSON.stringify({
          diag: "DEV_ENGINE_STRUCTURAL_CONTEXT_RESOLVED",
          project_id: projectId,
          authority_level: "engine",
          source_engine_key: proj.source_engine_key,
          engine_label: eng.label,
          source_dna_profile_id: proj.source_dna_profile_id,
        }));

        return result;
      }
    } catch (_) { /* fall through to DNA */ }

    console.log(JSON.stringify({
      diag: "DEV_ENGINE_STRUCTURAL_CONTEXT_FALLBACK",
      project_id: projectId,
      authority_level: "engine",
      source_engine_key: proj.source_engine_key,
      reason: "engine_row_not_found",
    }));
  }

  // 4. DNA-only fallback path
  if (proj.source_dna_profile_id) {
    try {
      const { data: dna } = await supabase
        .from("narrative_dna_profiles")
        .select("thematic_spine, primary_engine_key")
        .eq("id", proj.source_dna_profile_id)
        .maybeSingle();

      if (dna) {
        result.authority_level = "dna";
        result.dna_thematic_spine = dna.thematic_spine || null;
        if (dna.primary_engine_key) result.engine_key = dna.primary_engine_key;

        result.blockText = buildDnaBlock(result);

        console.log(JSON.stringify({
          diag: "DEV_ENGINE_STRUCTURAL_CONTEXT_RESOLVED",
          project_id: projectId,
          authority_level: "dna",
          source_dna_profile_id: proj.source_dna_profile_id,
          engine_key: result.engine_key,
        }));

        return result;
      }
    } catch (_) { /* non-critical */ }
  }

  // 5. No structural lineage
  console.log(JSON.stringify({
    diag: "DEV_ENGINE_STRUCTURAL_CONTEXT_FALLBACK",
    project_id: projectId,
    authority_level: "none",
    reason: "no_lineage_fields_present",
  }));

  return result;
}

// ── Prompt Block Builders ──

function clamp(s: string, n: number): string {
  return s && s.length > n ? s.slice(0, n) + "\n[…truncated]" : (s || "");
}

function buildBlueprintBlock(l: StructuralLineage): string {
  const ep = l.execution_pattern || {};
  const lines: string[] = [
    `\n=== STRUCTURAL EXECUTION PATTERN (AUTHORITATIVE — from Blueprint Family: ${l.blueprint_family_key}) ===`,
  ];

  if (l.structural_summary) lines.push(`STRUCTURAL SUMMARY: ${l.structural_summary}`);
  if (l.engine_key) lines.push(`Narrative Engine: ${l.engine_key}`);
  if (l.dna_thematic_spine) lines.push(`Thematic Spine: ${l.dna_thematic_spine}`);

  // Execution pattern keys
  const patternKeys = [
    "act_structure", "spatial_mode", "confrontation_rhythm",
    "escalation_shape", "reveal_structure", "pov_distribution",
    "climax_shape", "pressure_topology",
  ];
  for (const key of patternKeys) {
    if (ep[key]) lines.push(`${key}: ${typeof ep[key] === "string" ? ep[key] : JSON.stringify(ep[key])}`);
  }

  // Any additional execution pattern keys not in the standard set
  for (const [k, v] of Object.entries(ep)) {
    if (!patternKeys.includes(k) && v) {
      lines.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }

  lines.push(
    `\nINSTRUCTION: Honor this structural execution pattern in all generation and rewriting. ` +
    `The escalation shape, confrontation rhythm, and reveal structure define how this story moves. ` +
    `Do not flatten to generic three-act structure unless the pattern explicitly calls for it.`,
  );
  lines.push(`=== END STRUCTURAL EXECUTION PATTERN ===`);

  return clamp(lines.join("\n"), STRUCTURAL_BUDGET);
}

function buildEngineBlock(l: StructuralLineage): string {
  const lines: string[] = [
    `\n=== STRUCTURAL GUIDANCE (from Narrative Engine: ${l.engine_key}) ===`,
  ];
  if (l.engine_label) lines.push(`Engine: ${l.engine_label}`);
  if (l.engine_structural_pattern) lines.push(`Structural Pattern: ${l.engine_structural_pattern}`);
  if (l.dna_thematic_spine) lines.push(`Thematic Spine: ${l.dna_thematic_spine}`);
  lines.push(
    `\nINSTRUCTION: Use this engine's structural pattern as guidance for escalation shape, ` +
    `confrontation rhythm, and narrative architecture. This is engine-level (not blueprint-level) authority.`,
  );
  lines.push(`=== END STRUCTURAL GUIDANCE ===`);
  return clamp(lines.join("\n"), STRUCTURAL_BUDGET);
}

function buildDnaBlock(l: StructuralLineage): string {
  const lines: string[] = [
    `\n=== STRUCTURAL DNA (thematic context only) ===`,
  ];
  if (l.dna_thematic_spine) lines.push(`Thematic Spine: ${l.dna_thematic_spine}`);
  if (l.engine_key) lines.push(`Derived Engine: ${l.engine_key}`);
  lines.push(`=== END STRUCTURAL DNA ===`);
  return clamp(lines.join("\n"), STRUCTURAL_BUDGET);
}
