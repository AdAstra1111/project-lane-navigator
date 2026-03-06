/**
 * Scene Repair Registry — Phase 2E
 *
 * Deterministic scene-level repair for script-class deliverables.
 * Wraps sceneScope.ts parsing with issue-to-scene resolution,
 * scene extraction/replacement, and integrity enforcement.
 *
 * Safe rollout: feature_script, episode_script, season_script ONLY.
 * season_master_script excluded (AGGREGATE, compile-only).
 * Non-script docs excluded (use section or episodic block engines).
 *
 * Scripts are NOT heading-based docs. Scripts are NOT episodic block docs.
 * Scene identity is determined by INT./EXT. sluglines — standard screenplay format.
 *
 * Fail-closed: if scene targeting is ambiguous, returns full_doc fallback.
 */

import {
  parseScenes,
  detectOutOfScopeChanges,
  type ParsedScene,
} from "./sceneScope.ts";

// ── Types ──

export interface SceneRepairConfig {
  doc_type: string;
  /** Whether this doc type supports scene-level repair */
  scene_repair_supported: boolean;
  /** Minimum scene count to activate scene repair */
  min_scenes_required: number;
}

export type SceneRepairTargetType = "scene" | "full_doc";

export interface SceneRepairTarget {
  repair_target_type: SceneRepairTargetType;
  scene_number: number | null;
  scene_heading: string | null;
  reason: string;
  fallback_reason: string | null;
  scene_content: string | null;
  full_content: string;
  total_scenes: number;
}

export interface SceneIntegrityResult {
  ok: boolean;
  merged_content: string;
  scenes_preserved: number;
  scenes_corrected: number;
  scenes_missing_from_rewrite: number;
  target_scene_found: boolean;
  reason: string;
}

// ── Registry ──

const SCENE_REPAIR_REGISTRY: Record<string, SceneRepairConfig> = {
  feature_script: {
    doc_type: "feature_script",
    scene_repair_supported: true,
    min_scenes_required: 3,
  },
  episode_script: {
    doc_type: "episode_script",
    scene_repair_supported: true,
    min_scenes_required: 2,
  },
  season_script: {
    doc_type: "season_script",
    scene_repair_supported: true,
    min_scenes_required: 3,
  },
  // season_master_script: AGGREGATE — compile-only, excluded
  // production_draft: could be added later if proven safe
};

// ── Public API ──

/**
 * Check whether a doc type supports scene-level repair.
 */
export function isSceneRepairSupported(docType: string): boolean {
  return SCENE_REPAIR_REGISTRY[docType]?.scene_repair_supported === true;
}

/**
 * Get scene repair config. Returns null if unsupported.
 */
export function getSceneRepairConfig(docType: string): SceneRepairConfig | null {
  return SCENE_REPAIR_REGISTRY[docType] || null;
}

/**
 * List doc types supporting scene-level repair.
 */
export function listSceneRepairDocTypes(): string[] {
  return Object.keys(SCENE_REPAIR_REGISTRY).filter(
    k => SCENE_REPAIR_REGISTRY[k].scene_repair_supported
  );
}

// ── Issue-to-Scene Resolution ──

/**
 * Resolve an issue/note to a specific scene number.
 * Uses explicit scene_number, text patterns ("Scene 5", "INT. OFFICE"),
 * and anchor/constraint_key fields.
 * Fails closed: returns null if no confident single-scene match.
 */
export function resolveIssueToSceneTarget(
  issue: {
    scene_number?: number | null;
    scene_numbers?: number[] | null;
    category?: string | null;
    title?: string;
    summary?: string;
    anchor?: string | null;
    constraint_key?: string | null;
  },
  docType: string,
  content: string,
): { scene_number: number; confidence: "high" | "medium"; reason: string } | null {
  const config = SCENE_REPAIR_REGISTRY[docType];
  if (!config || !config.scene_repair_supported) return null;

  const scenes = parseScenes(content);
  if (scenes.length < config.min_scenes_required) return null;

  const sceneNumberSet = new Set(scenes.map(s => s.sceneNumber));

  // 1. Explicit scene_number (high confidence)
  if (issue.scene_number != null && sceneNumberSet.has(issue.scene_number)) {
    return {
      scene_number: issue.scene_number,
      confidence: "high",
      reason: `explicit_scene_number:${issue.scene_number}`,
    };
  }

  // 2. Single scene_numbers entry (high confidence)
  if (issue.scene_numbers && issue.scene_numbers.length === 1 && sceneNumberSet.has(issue.scene_numbers[0])) {
    return {
      scene_number: issue.scene_numbers[0],
      confidence: "high",
      reason: `explicit_scene_numbers_single:${issue.scene_numbers[0]}`,
    };
  }

  // 3. Extract from text: "Scene N", "scene N", "Sc. N", "SCENE N"
  const searchText = [
    issue.title || "",
    issue.summary || "",
    issue.anchor || "",
    issue.constraint_key || "",
  ].join(" ");

  const scenePattern = /\b(?:scene|sc\.?)\s*#?(\d+)\b/gi;
  const matches = [...searchText.matchAll(scenePattern)];
  const extractedNums = [...new Set(matches.map(m => parseInt(m[1], 10)))].filter(
    n => !isNaN(n) && sceneNumberSet.has(n)
  );

  if (extractedNums.length === 1) {
    return {
      scene_number: extractedNums[0],
      confidence: "medium",
      reason: `text_extraction:scene_${extractedNums[0]}`,
    };
  }

  // 4. Slugline match: if issue text contains a slugline fragment, match to scene
  const sluglinePattern = /\b(INT\.|EXT\.|I\/E\.|INT\/EXT\.?)\s+([A-Z][A-Z\s\/\-']+)/gi;
  const slugMatches = [...searchText.matchAll(sluglinePattern)];
  if (slugMatches.length === 1) {
    const slugFragment = slugMatches[0][0].trim().toUpperCase();
    const matchedScene = scenes.find(s =>
      s.heading.toUpperCase().includes(slugFragment) ||
      normalizeHeading(s.heading).includes(normalizeHeading(slugFragment))
    );
    if (matchedScene) {
      return {
        scene_number: matchedScene.sceneNumber,
        confidence: "medium",
        reason: `slugline_match:${slugFragment}->scene_${matchedScene.sceneNumber}`,
      };
    }
  }

  // Ambiguous or no match — fail closed
  return null;
}

// ── Scene Extract / Replace ──

/**
 * Extract a specific scene's full text (heading + body) from content.
 * Returns null if scene not found.
 */
export function extractScene(
  content: string,
  sceneNumber: number,
): { content: string; scene: ParsedScene } | null {
  const scenes = parseScenes(content);
  const match = scenes.find(s => s.sceneNumber === sceneNumber);
  if (!match) return null;
  return {
    content: match.heading + "\n" + match.body,
    scene: match,
  };
}

/**
 * Replace a specific scene in the document, preserving all others verbatim.
 * Reconstructs the document from parsed scenes.
 */
export function replaceScene(
  content: string,
  sceneNumber: number,
  newSceneContent: string,
): { success: boolean; new_content: string; reason: string } {
  const scenes = parseScenes(content);
  const targetIdx = scenes.findIndex(s => s.sceneNumber === sceneNumber);
  if (targetIdx === -1) {
    return { success: false, new_content: content, reason: `scene_${sceneNumber}_not_found` };
  }

  // Extract preamble (content before the first scene)
  const preamble = scenes.length > 0 && scenes[0].startOffset > 0
    ? content.slice(0, scenes[0].startOffset)
    : "";

  // Reconstruct from scene segments
  const parts: string[] = [];
  if (preamble.trim()) {
    parts.push(preamble.trimEnd());
  }

  for (const scene of scenes) {
    if (scene.sceneNumber === sceneNumber) {
      parts.push(newSceneContent.trimEnd());
    } else {
      // Preserve original scene verbatim
      const originalText = content.slice(scene.startOffset, scene.endOffset + 1);
      parts.push(originalText.trimEnd());
    }
  }

  return {
    success: true,
    new_content: parts.join("\n\n"),
    reason: `scene_${sceneNumber}_replaced:total=${scenes.length}`,
  };
}

// ── Repair Target Resolution ──

/**
 * Determine the optimal repair target for an issue against a script document.
 * Returns either a scene-level target or full_doc fallback with reason.
 */
export function getSceneRepairTarget(
  issue: {
    scene_number?: number | null;
    scene_numbers?: number[] | null;
    category?: string | null;
    title?: string;
    summary?: string;
    anchor?: string | null;
    constraint_key?: string | null;
  },
  docType: string,
  content: string,
): SceneRepairTarget {
  const config = SCENE_REPAIR_REGISTRY[docType];

  if (!config || !config.scene_repair_supported) {
    return {
      repair_target_type: "full_doc",
      scene_number: null,
      scene_heading: null,
      reason: "doc_type_not_supported_for_scene_repair",
      fallback_reason: null,
      scene_content: null,
      full_content: content,
      total_scenes: 0,
    };
  }

  const scenes = parseScenes(content);
  if (scenes.length < config.min_scenes_required) {
    return {
      repair_target_type: "full_doc",
      scene_number: null,
      scene_heading: null,
      reason: "insufficient_scenes_found",
      fallback_reason: `found=${scenes.length}, required=${config.min_scenes_required}`,
      scene_content: null,
      full_content: content,
      total_scenes: scenes.length,
    };
  }

  const resolution = resolveIssueToSceneTarget(issue, docType, content);
  if (!resolution) {
    return {
      repair_target_type: "full_doc",
      scene_number: null,
      scene_heading: null,
      reason: "scene_resolution_failed_closed",
      fallback_reason: "no_confident_single_scene_match",
      scene_content: null,
      full_content: content,
      total_scenes: scenes.length,
    };
  }

  const extracted = extractScene(content, resolution.scene_number);
  if (!extracted) {
    return {
      repair_target_type: "full_doc",
      scene_number: resolution.scene_number,
      scene_heading: null,
      reason: "scene_extraction_failed",
      fallback_reason: `matched_scene=${resolution.scene_number}_but_extract_failed`,
      scene_content: null,
      full_content: content,
      total_scenes: scenes.length,
    };
  }

  return {
    repair_target_type: "scene",
    scene_number: resolution.scene_number,
    scene_heading: extracted.scene.heading,
    reason: `scene_targeted:${resolution.reason}:confidence=${resolution.confidence}`,
    fallback_reason: null,
    scene_content: extracted.content,
    full_content: content,
    total_scenes: scenes.length,
  };
}

// ── Post-Rewrite Integrity Enforcement ──

/**
 * After a rewrite, enforce scene-level integrity:
 * - Parse both original and rewritten into scenes
 * - Take only the target scene from the rewritten output
 * - Restore all other scenes verbatim from original
 * - Validate scene count and order
 *
 * Returns the merged content with integrity enforced.
 */
export function enforceSceneIntegrity(
  originalContent: string,
  rewrittenContent: string,
  targetSceneNumber: number,
): SceneIntegrityResult {
  const originalScenes = parseScenes(originalContent);
  const rewrittenScenes = parseScenes(rewrittenContent);

  if (originalScenes.length === 0) {
    return {
      ok: false,
      merged_content: rewrittenContent,
      scenes_preserved: 0,
      scenes_corrected: 0,
      scenes_missing_from_rewrite: 0,
      target_scene_found: false,
      reason: "no_scenes_in_original",
    };
  }

  // Find target scene in rewritten output — match by scene number
  const targetInRewritten = rewrittenScenes.find(s => s.sceneNumber === targetSceneNumber);

  // Also try heading match if ordinal doesn't match (scene numbers may shift)
  let effectiveTarget: ParsedScene | null = targetInRewritten || null;
  if (!effectiveTarget) {
    const originalTarget = originalScenes.find(s => s.sceneNumber === targetSceneNumber);
    if (originalTarget) {
      const normalizedOrigHeading = normalizeHeading(originalTarget.heading);
      effectiveTarget = rewrittenScenes.find(s =>
        normalizeHeading(s.heading) === normalizedOrigHeading
      ) || null;
    }
  }

  if (!effectiveTarget) {
    return {
      ok: false,
      merged_content: originalContent,
      scenes_preserved: originalScenes.length,
      scenes_corrected: 0,
      scenes_missing_from_rewrite: 1,
      target_scene_found: false,
      reason: `target_scene_${targetSceneNumber}_not_in_rewritten_output`,
    };
  }

  // Build merged document: original preamble + original scenes, swapping only target
  const preamble = originalScenes.length > 0 && originalScenes[0].startOffset > 0
    ? originalContent.slice(0, originalScenes[0].startOffset)
    : "";

  const parts: string[] = [];
  if (preamble.trim()) {
    parts.push(preamble.trimEnd());
  }

  let scenesPreserved = 0;
  let scenesCorrected = 0;

  for (const origScene of originalScenes) {
    if (origScene.sceneNumber === targetSceneNumber) {
      // Use the rewritten version of the target scene
      const rewrittenText = effectiveTarget.heading + "\n" + effectiveTarget.body;
      parts.push(rewrittenText.trimEnd());
    } else {
      // Preserve original verbatim
      const origText = originalContent.slice(origScene.startOffset, origScene.endOffset + 1);
      parts.push(origText.trimEnd());

      // Check if this scene was modified in the rewrite (for reporting)
      const rewrittenCounterpart = rewrittenScenes.find(s => s.sceneNumber === origScene.sceneNumber);
      if (rewrittenCounterpart) {
        const origBody = normalizeBody(origScene.body);
        const rewriteBody = normalizeBody(rewrittenCounterpart.body);
        if (origBody !== rewriteBody) {
          scenesCorrected++; // AI modified a non-target scene — we restored it
        } else {
          scenesPreserved++;
        }
      } else {
        scenesPreserved++; // scene not in rewrite, preserved from original
      }
    }
  }

  const mergedContent = parts.join("\n\n");

  // Use detectOutOfScopeChanges for final validation
  const finalScenes = parseScenes(mergedContent);
  const scopeCheck = detectOutOfScopeChanges(originalScenes, finalScenes, [targetSceneNumber]);

  return {
    ok: scopeCheck.ok,
    merged_content: mergedContent,
    scenes_preserved: scenesPreserved,
    scenes_corrected: scenesCorrected,
    scenes_missing_from_rewrite: 0,
    target_scene_found: true,
    reason: scopeCheck.ok
      ? `integrity_ok:replaced_scene_${targetSceneNumber}:preserved=${scenesPreserved}:corrected=${scenesCorrected}`
      : `integrity_issues:${scopeCheck.message}`,
  };
}

// ── Internal Helpers ──

function normalizeHeading(heading: string): string {
  return heading.trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}
