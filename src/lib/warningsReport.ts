/**
 * Deterministic warnings report builder + clipboard helper.
 */
export function buildWarningsReport(opts: {
  kind: "trailer" | "storyboard";
  runId?: string | null;
  status?: string | null;
  warnings: string[];
  selectedWarning?: string | null;
  anchorId?: string | null;
}): string {
  const ts = new Date().toISOString();
  const lines: string[] = [
    "IFFY WARNINGS REPORT",
    `kind: ${opts.kind}`,
    `run_id: ${opts.runId ?? ""}`,
    `status: ${opts.status ?? ""}`,
    `timestamp: ${ts}`,
  ];
  if (opts.selectedWarning) {
    lines.push(`selected_warning: ${opts.selectedWarning}`);
    lines.push(`anchor: ${opts.anchorId ?? ""}`);
  }
  lines.push("", `warnings (${opts.warnings.length}):`);
  const body = opts.warnings.map((w) => `- ${w}`).join("\n");
  return `${lines.join("\n")}\n${body}\n`;
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

export function buildPageLinkWithAnchor(anchorId?: string | null): string {
  try {
    const { origin, pathname, search } = window.location;
    const base = `${origin}${pathname}${search}`;
    return anchorId ? `${base}#${anchorId}` : base;
  } catch {
    return "";
  }
}
