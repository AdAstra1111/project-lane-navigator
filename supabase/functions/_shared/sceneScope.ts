/**
 * sceneScope — Deterministic scene parsing + out-of-scope diff guard.
 * Used by Writers' Room apply_change_plan to enforce scene-scoped rewrites.
 *
 * NO LLM calls — purely text-based scene segmentation using standard
 * screenplay heading patterns (INT./EXT./I/E).
 */

/** A parsed scene segment with heading and body text. */
export interface ParsedScene {
  sceneNumber: number;
  heading: string;
  body: string;
  startOffset: number;
  endOffset: number;
}

/** Scene heading pattern: INT., EXT., I/E., INT/EXT, or numbered scene headings */
const SCENE_HEADING_RE = /^(?:\d+[\.\)]\s*)?(?:INT\.|EXT\.|I\/E\.|INT\/EXT\.?)\s*.+$/im;

/**
 * parseScenes — split script text into deterministic scene segments.
 * Each scene starts at a heading line matching standard screenplay format.
 * Returns scenes in document order, numbered 1..N.
 */
export function parseScenes(scriptText: string): ParsedScene[] {
  if (!scriptText || scriptText.trim().length === 0) return [];

  const lines = scriptText.split('\n');
  const scenes: ParsedScene[] = [];
  let currentHeading = '';
  let currentStart = 0;
  let bodyLines: string[] = [];
  let charOffset = 0;
  let sceneStartOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (SCENE_HEADING_RE.test(trimmed)) {
      // Close previous scene if exists
      if (currentHeading) {
        scenes.push({
          sceneNumber: scenes.length + 1,
          heading: currentHeading,
          body: bodyLines.join('\n'),
          startOffset: sceneStartOffset,
          endOffset: charOffset - 1,
        });
      }
      currentHeading = trimmed;
      sceneStartOffset = charOffset;
      bodyLines = [];
    } else if (currentHeading) {
      bodyLines.push(line);
    }

    charOffset += line.length + 1; // +1 for newline
  }

  // Close last scene
  if (currentHeading) {
    scenes.push({
      sceneNumber: scenes.length + 1,
      heading: currentHeading,
      body: bodyLines.join('\n'),
      startOffset: sceneStartOffset,
      endOffset: charOffset - 1,
    });
  }

  return scenes;
}

/** Result of out-of-scope detection */
export interface ScopeCheckResult {
  ok: boolean;
  outOfScopeScenes: number[];
  message: string;
}

/**
 * detectOutOfScopeChanges — compare original and updated scene lists,
 * flag any scene outside allowedSceneNumbers that changed materially.
 *
 * "Material change" = body text differs after whitespace normalization.
 */
export function detectOutOfScopeChanges(
  originalScenes: ParsedScene[],
  updatedScenes: ParsedScene[],
  allowedSceneNumbers: number[]
): ScopeCheckResult {
  const allowedSet = new Set(allowedSceneNumbers);
  const outOfScope: number[] = [];

  // Build heading→body maps for comparison
  // Use heading as key since scene numbers may shift in rewrite
  const originalMap = new Map<string, string>();
  for (const s of originalScenes) {
    originalMap.set(normalizeHeading(s.heading), normalizeBody(s.body));
  }

  // Check each updated scene
  for (const us of updatedScenes) {
    if (allowedSet.has(us.sceneNumber)) continue; // allowed to change

    const normalizedHeading = normalizeHeading(us.heading);
    const originalBody = originalMap.get(normalizedHeading);

    if (originalBody === undefined) {
      // New scene not in allowed set — flag it
      outOfScope.push(us.sceneNumber);
      continue;
    }

    const updatedBody = normalizeBody(us.body);
    if (originalBody !== updatedBody) {
      outOfScope.push(us.sceneNumber);
    }
  }

  // Also check for deleted scenes not in allowed set
  const updatedHeadings = new Set(updatedScenes.map(s => normalizeHeading(s.heading)));
  for (const os of originalScenes) {
    if (allowedSet.has(os.sceneNumber)) continue;
    if (!updatedHeadings.has(normalizeHeading(os.heading))) {
      outOfScope.push(os.sceneNumber);
    }
  }

  // Deterministic sort
  const sorted = [...new Set(outOfScope)].sort((a, b) => a - b);

  if (sorted.length === 0) {
    return { ok: true, outOfScopeScenes: [], message: 'All changes within scope' };
  }

  return {
    ok: false,
    outOfScopeScenes: sorted,
    message: `Out-of-scope changes detected in scene(s): ${sorted.join(', ')}. Only scenes ${[...allowedSet].sort((a, b) => a - b).join(', ')} were allowed.`,
  };
}

/**
 * resolveApplyScope — determine effective scope for a change plan apply.
 * If plan has scene targets and client didn't explicitly set applyScope='full',
 * default to scene-scoped.
 */
export function resolveApplyScope(
  changePlan: { changes?: Array<{ target?: { scene_numbers?: number[] } }> },
  clientApplyScope?: string
): { mode: 'scene' | 'full'; allowedScenes: number[] } {
  // Gather all target scene numbers from enabled changes
  const allSceneNumbers = new Set<number>();
  for (const c of changePlan.changes || []) {
    for (const sn of c.target?.scene_numbers || []) {
      allSceneNumbers.add(sn);
    }
  }

  // If client explicitly requests full scope
  if (clientApplyScope === 'full') {
    return { mode: 'full', allowedScenes: [] };
  }

  // If we have scene targets, enforce scene scope
  if (allSceneNumbers.size > 0) {
    return {
      mode: 'scene',
      allowedScenes: [...allSceneNumbers].sort((a, b) => a - b),
    };
  }

  // No scene targets → full scope (global changes like tone, pacing)
  return { mode: 'full', allowedScenes: [] };
}

/* ── Internal helpers ── */

function normalizeHeading(heading: string): string {
  return heading.trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}
