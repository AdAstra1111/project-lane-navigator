/**
 * sceneParser — deterministic scene segmentation from screenplay text.
 * NO LLM calls. Pure regex-based heading detection.
 */

export interface ParsedScene {
  scene_id: string;
  ordinal: number;
  slugline: string;
  start: number;
  end: number;
  preview: string;
  anchor: string;
}

/** Standard screenplay heading pattern */
const SCENE_HEADING_RE = /^(?:\d+[\.\)]\s*)?(?:INT\.|EXT\.|I\/E\.|INT\/EXT\.?)\s*.+$/i;

/**
 * Parse script text into scene segments.
 * Returns scenes in document order, numbered 1..N.
 */
export function parseScenes(text: string): ParsedScene[] {
  if (!text || text.trim().length === 0) return [];

  const lines = text.split('\n');
  const scenes: ParsedScene[] = [];
  let currentSlugline = '';
  let sceneStart = 0;
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (SCENE_HEADING_RE.test(trimmed)) {
      // Close previous scene
      if (currentSlugline) {
        scenes.push(makeScene(scenes.length + 1, currentSlugline, sceneStart, charOffset - 1, text));
      }
      currentSlugline = trimmed;
      sceneStart = charOffset;
    }
    charOffset += line.length + 1;
  }

  // Close last scene
  if (currentSlugline) {
    scenes.push(makeScene(scenes.length + 1, currentSlugline, sceneStart, charOffset - 1, text));
  }

  return scenes;
}

function makeScene(ordinal: number, slugline: string, start: number, end: number, fullText: string): ParsedScene {
  const body = fullText.slice(start, Math.min(end, fullText.length));
  const preview = body.slice(0, 120).replace(/\n/g, ' ').trim();
  const anchor = body.replace(/\s+/g, ' ').toUpperCase().slice(0, 80).trim();
  return {
    scene_id: simpleHash(`${ordinal}:${slugline}`),
    ordinal,
    slugline,
    start,
    end,
    preview,
    anchor,
  };
}

/** Simple deterministic hash for scene ID */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return 'sc_' + Math.abs(hash).toString(36);
}

/** Extract all-caps character cues from text */
export function extractCharacterCues(text: string): string[] {
  const cueRe = /^\s{10,}([A-Z][A-Z .'-]{1,30})\s*(?:\(.*?\))?\s*$/gm;
  const chars = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = cueRe.exec(text))) {
    const name = m[1].trim();
    if (name.length >= 2 && !['FADE IN', 'FADE OUT', 'CUT TO', 'DISSOLVE TO', 'SMASH CUT', 'THE END'].includes(name)) {
      chars.add(name);
    }
  }
  return [...chars].sort();
}

/** Extract locations from sluglines */
export function extractLocations(scenes: ParsedScene[]): string[] {
  const locs = new Set<string>();
  for (const s of scenes) {
    const match = s.slugline.match(/(?:INT\.|EXT\.|I\/E\.|INT\/EXT\.?)\s*(.+?)(?:\s*[-–—]\s*(?:DAY|NIGHT|DAWN|DUSK|LATER|CONTINUOUS|MORNING|EVENING|SUNSET|SUNRISE).*)?$/i);
    if (match) locs.add(match[1].trim().toUpperCase());
  }
  return [...locs].sort();
}
