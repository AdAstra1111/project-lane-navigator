/**
 * Demo Bundle Utilities — Deterministic manifest, CSV, README generation.
 * No randomness. Same inputs => same outputs.
 */

// ---------- FNV-1a hash (same as demoStateMachine) ----------
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------- Bundle ID ----------
export function computeBundleId(
  demoRunId: string,
  settingsJson: Record<string, unknown>,
  linksJson: Record<string, unknown>,
): string {
  const payload = JSON.stringify({ demoRunId, settingsJson, linksJson });
  return fnv1a(payload);
}

// ---------- ZIP file name ----------
export function bundleFileName(
  projectSlug: string,
  demoRunId: string,
  createdAt: Date,
): string {
  const slug = projectSlug.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const shortId = demoRunId.slice(0, 8);
  const ts = createdAt.toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z$/, 'Z');
  return `IFFY_DemoBundle_${slug}_${shortId}_${ts}.zip`;
}

// ---------- Quality History CSV ----------
export interface QualityRunRow {
  created_at: string;
  run_source: string;
  lane: string | null;
  final_pass: boolean;
  final_score: number;
  hard_failures: string[];
  diagnostic_flags: string[];
  adapter_mode: string | null;
  strictness_mode: string;
}

const CSV_HEADERS = [
  'created_at', 'run_source', 'lane', 'pass', 'final_score',
  'hard_failures_count', 'diagnostics_count', 'adapter_mode', 'strictness_mode',
];

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function qualityHistoryCSV(runs: QualityRunRow[]): string {
  // Fixed ordering: created_at DESC
  const sorted = [...runs].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const headerLine = CSV_HEADERS.join(',');
  const rows = sorted.map((r) =>
    [
      r.created_at,
      r.run_source,
      r.lane || '',
      r.final_pass ? 'true' : 'false',
      String(r.final_score),
      String((r.hard_failures || []).length),
      String((r.diagnostic_flags || []).length),
      r.adapter_mode || '',
      r.strictness_mode,
    ]
      .map(escapeCSV)
      .join(','),
  );
  return [headerLine, ...rows].join('\n');
}

// ---------- Manifest ----------
export interface ManifestEntry {
  filename: string;
  type: string;
  source_ids: Record<string, string | undefined>;
  checksum: string;
  created_at: string;
}

export interface BundleManifest {
  bundle_id: string;
  created_at: string;
  files: ManifestEntry[];
}

/** Deterministic SHA-256 hex digest (browser crypto API). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const buf = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function buildManifest(
  bundleId: string,
  createdAt: string,
  entries: ManifestEntry[],
): BundleManifest {
  // Fixed file order
  const FIXED_ORDER = [
    'quality_run.json',
    'video_plan.json',
    'timeline.json',
    'rough_cut.mp4',
    'rough_cut_playlist.json',
    'quality_history.csv',
    'manifest.json',
    'README.txt',
  ];
  const sorted = [...entries].sort(
    (a, b) => FIXED_ORDER.indexOf(a.filename) - FIXED_ORDER.indexOf(b.filename),
  );
  return { bundle_id: bundleId, created_at: createdAt, files: sorted };
}

// ---------- README ----------
export function buildReadme(manifest: BundleManifest): string {
  const lines = [
    'IFFY Demo Bundle',
    '=================',
    '',
    `Bundle ID: ${manifest.bundle_id}`,
    `Created:   ${manifest.created_at}`,
    '',
    'Contents:',
    '',
  ];
  for (const f of manifest.files) {
    lines.push(`  ${f.filename}`);
    lines.push(`    Type: ${f.type}`);
    if (f.checksum) lines.push(`    SHA-256: ${f.checksum}`);
  }
  lines.push('');
  lines.push('How to view:');
  lines.push('  - quality_run.json: Open in any JSON viewer for CIK quality gate results.');
  lines.push('  - video_plan.json: Video generation plan with shot breakdowns.');
  lines.push('  - timeline.json: Rough cut timeline data.');
  lines.push('  - rough_cut.mp4: Play in any video player (if available).');
  lines.push('  - rough_cut_playlist.json: Playlist manifest for streaming playback.');
  lines.push('  - quality_history.csv: Open in Excel/Sheets for quality run history.');
  lines.push('');
  lines.push('This bundle was generated deterministically. Same demo run + settings = same bundle.');
  return lines.join('\n');
}

// ---------- Stable JSON serializer ----------
export function stableJsonString(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}
