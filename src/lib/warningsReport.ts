/**
 * Deterministic warnings report builder + clipboard helper.
 */
export function buildWarningsReport(opts: {
  kind: "trailer" | "storyboard";
  runId?: string | null;
  status?: string | null;
  warnings: string[];
}): string {
  const ts = new Date().toISOString();
  const header = [
    `IFFY WARNINGS REPORT`,
    `kind: ${opts.kind}`,
    `run_id: ${opts.runId ?? ""}`,
    `status: ${opts.status ?? ""}`,
    `timestamp: ${ts}`,
    ``,
    `warnings (${opts.warnings.length}):`,
  ].join("\n");
  const body = opts.warnings.map((w) => `- ${w}`).join("\n");
  return `${header}\n${body}\n`;
}

export async function copyTextToClipboard(text: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    // no-op
  }
}
