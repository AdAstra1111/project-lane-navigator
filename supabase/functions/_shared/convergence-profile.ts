/**
 * Convergence Profile Builder — Edge-compatible, pure functions.
 *
 * Builds a deterministic Convergence Context Profile from already-fetched
 * trend_signals + cast_trends rows. Used by generate-pitch to inject
 * market-grounded creative DNA into pitch generation.
 *
 * No DB calls, no fetch, no Deno/browser deps.
 */

// ── Minimal signal shape (matches columns fetched by generate-pitch) ──

export interface EdgeTrendSignal {
  name: string;
  category: string;
  strength: number;
  velocity: string;
  explanation?: string;
  production_type?: string;
  genre_tags?: string[];
  tone_tags?: string[];
  format_tags?: string[];
  lane_relevance?: string[];
  budget_tier?: string;
  target_buyer?: string;
  region?: string;
  example_titles?: string[];
  saturation_risk?: string;
  cycle_phase?: string;
}

export interface EdgeCastTrend {
  actor_name: string;
  trend_type: string;
  market_alignment: string;
  strength: number;
  velocity: string;
  genre_relevance?: string[];
  budget_tier?: string;
  status?: string;
  production_type?: string;
}

// ── Output types ──

export interface ConvergenceDemandSignal {
  label: string;
  score: number;
  reason: string;
}

export interface ConvergenceGenreHeat {
  genre: string;
  score: number;
  reason: string;
}

export interface ConvergenceComparable {
  title: string;
  reference_axis: string;
  weight: number;
  reason: string;
}

export interface ConvergenceToneStyle {
  tone_band?: string;
  pacing?: string;
  notes: string[];
}

export interface ConvergenceRisk {
  label: string;
  severity: string;
  reason: string;
}

export interface ConvergenceProfile {
  demand_signals: ConvergenceDemandSignal[];
  genre_heat: ConvergenceGenreHeat[];
  comparable_candidates: ConvergenceComparable[];
  tone_style: ConvergenceToneStyle;
  constraints_notes: string[];
  risks: ConvergenceRisk[];
  summary_notes: string[];
}

// ── Helpers (deterministic) ──

function stableSort<T>(arr: T[], scoreKey: keyof T, labelKey: keyof T): T[] {
  return [...arr].sort((a, b) => {
    const sa = (a[scoreKey] as number) ?? 0;
    const sb = (b[scoreKey] as number) ?? 0;
    if (sb !== sa) return sb - sa;
    const la = String(a[labelKey] ?? "");
    const lb = String(b[labelKey] ?? "");
    return la.localeCompare(lb);
  });
}

function clamp<T>(arr: T[], max: number): T[] {
  return arr.slice(0, max);
}

function inferReferenceAxis(signal: EdgeTrendSignal): string {
  const cat = (signal.category || "").toLowerCase();
  if (cat.includes("narrative") || cat.includes("ip")) return "structure";
  if (cat.includes("genre")) return "tone";
  if (cat.includes("market") || cat.includes("buyer")) return "budget_scale";
  if (cat.includes("format") || cat.includes("platform")) return "pacing";
  return "tone";
}

function deriveToneBand(signals: EdgeTrendSignal[]): string | undefined {
  const toneTags = signals.flatMap((s) => s.tone_tags || []);
  if (toneTags.length === 0) return undefined;
  const freq: Record<string, number> = {};
  for (const t of toneTags) {
    const key = t.toLowerCase();
    freq[key] = (freq[key] || 0) + 1;
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0];
}

function derivePacing(signals: EdgeTrendSignal[]): string | undefined {
  const rising = signals.filter((s) => s.velocity === "Rising").length;
  const total = signals.length;
  if (total === 0) return undefined;
  const ratio = rising / total;
  if (ratio >= 0.6) return "accelerating";
  if (ratio >= 0.3) return "measured";
  return "deliberate";
}

// ── Main builder ──

export function buildConvergenceProfile(
  signals: EdgeTrendSignal[],
  castTrends: EdgeCastTrend[],
): ConvergenceProfile {
  // ── Demand Signals (top 8 by strength) ──
  const demandSignals: ConvergenceDemandSignal[] = clamp(
    stableSort(
      signals.map((s) => ({
        label: s.name,
        score: s.strength,
        reason: `${s.velocity} — ${s.cycle_phase || "unknown"} phase, ${s.saturation_risk || "Low"} saturation`,
      })),
      "score" as keyof ConvergenceDemandSignal,
      "label" as keyof ConvergenceDemandSignal,
    ),
    8,
  );

  // ── Genre Heat (top 8) ──
  const genreMap: Record<string, { total: number; count: number; reasons: string[] }> = {};
  for (const s of signals) {
    for (const g of s.genre_tags || []) {
      const key = g.toLowerCase();
      if (!genreMap[key]) genreMap[key] = { total: 0, count: 0, reasons: [] };
      genreMap[key].total += s.strength;
      genreMap[key].count++;
      if (genreMap[key].reasons.length < 2) {
        genreMap[key].reasons.push(`${s.name} (${s.velocity})`);
      }
    }
  }
  const genreHeat: ConvergenceGenreHeat[] = clamp(
    stableSort(
      Object.entries(genreMap).map(([genre, d]) => ({
        genre,
        score: Math.round((d.total / d.count) * 10) / 10,
        reason: d.reasons.join("; "),
      })),
      "score" as keyof ConvergenceGenreHeat,
      "genre" as keyof ConvergenceGenreHeat,
    ),
    8,
  );

  // ── Comparable Candidates (from example_titles, top 10, deduped) ──
  const compMap = new Map<string, ConvergenceComparable>();
  for (const s of signals) {
    const titles = s.example_titles;
    if (!titles || titles.length === 0) continue;
    for (const title of titles) {
      const key = title.toLowerCase().trim();
      if (!key || compMap.has(key)) continue;
      compMap.set(key, {
        title: title.trim(),
        reference_axis: inferReferenceAxis(s),
        weight: Math.round((s.strength / 10) * 100) / 100,
        reason: `Referenced in ${s.name} (${s.category})`,
      });
    }
  }
  const comparableCandidates: ConvergenceComparable[] = clamp(
    stableSort(
      [...compMap.values()],
      "weight" as keyof ConvergenceComparable,
      "title" as keyof ConvergenceComparable,
    ),
    10,
  );

  // ── Tone / Style ──
  const toneNotes: string[] = [];
  for (const c of castTrends.slice(0, 3)) {
    toneNotes.push(`${c.actor_name}: ${c.trend_type}, ${c.market_alignment}`);
  }
  const toneStyle: ConvergenceToneStyle = {
    tone_band: deriveToneBand(signals),
    pacing: derivePacing(signals),
    notes: clamp(toneNotes, 5),
  };

  // ── Constraints ──
  const budgetTiers = signals.map((s) => s.budget_tier).filter(Boolean) as string[];
  const constraintsNotes: string[] = [];
  if (budgetTiers.length > 0) {
    const freq: Record<string, number> = {};
    for (const t of budgetTiers) freq[t] = (freq[t] || 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    if (top) constraintsNotes.push(`Dominant budget tier: ${top[0]} (n=${top[1]})`);
  }
  const regionFreq: Record<string, number> = {};
  for (const s of signals) {
    if (s.region) regionFreq[s.region] = (regionFreq[s.region] || 0) + 1;
  }
  const topRegion = Object.entries(regionFreq).sort((a, b) => b[1] - a[1])[0];
  if (topRegion) constraintsNotes.push(`Primary region signal: ${topRegion[0]}`);

  // ── Risks ──
  const risks: ConvergenceRisk[] = [];
  for (const s of signals) {
    if (s.saturation_risk === "High" && s.strength >= 5) {
      risks.push({
        label: `Saturation: ${s.name}`,
        severity: s.strength >= 7 ? "high" : "medium",
        reason: `${s.cycle_phase || "unknown"} phase, strength ${s.strength}/10`,
      });
    }
    if (s.velocity === "Declining" && s.strength >= 6) {
      risks.push({
        label: `Declining: ${s.name}`,
        severity: s.strength >= 8 ? "high" : "medium",
        reason: `Strength ${s.strength}/10 but declining velocity`,
      });
    }
  }

  // ── Summary ──
  const summaryNotes: string[] = [];
  summaryNotes.push(`Built from ${signals.length} signals and ${castTrends.length} cast trends.`);

  return {
    demand_signals: demandSignals,
    genre_heat: genreHeat,
    comparable_candidates: comparableCandidates,
    tone_style: toneStyle,
    constraints_notes: constraintsNotes,
    risks: clamp(
      [...risks].sort((a, b) => {
        const RANK: Record<string, number> = { high: 2, medium: 1, low: 0 };
        const ra = RANK[a.severity] ?? 0;
        const rb = RANK[b.severity] ?? 0;
        if (rb !== ra) return rb - ra;
        return a.label.localeCompare(b.label);
      }),
      8,
    ),
    summary_notes: summaryNotes,
  };
}

// ── Text block builder for prompt injection ──

export function buildConvergenceBlock(profile: ConvergenceProfile): string {
  const parts: string[] = [];

  // Genre heat
  if (profile.genre_heat.length > 0) {
    const lines = profile.genre_heat.map((g) => `  - ${g.genre} (heat=${g.score}) — ${g.reason}`);
    parts.push(`Genre Heat:\n${lines.join("\n")}`);
  }

  // Tone/style
  const tsParts: string[] = [];
  if (profile.tone_style.tone_band) tsParts.push(`tone=${profile.tone_style.tone_band}`);
  if (profile.tone_style.pacing) tsParts.push(`pacing=${profile.tone_style.pacing}`);
  if (tsParts.length > 0) parts.push(`Tone/Style: ${tsParts.join(", ")}`);
  if (profile.tone_style.notes.length > 0) {
    parts.push(`Cast Signals:\n${profile.tone_style.notes.map((n) => `  - ${n}`).join("\n")}`);
  }

  // Comparable candidates
  if (profile.comparable_candidates.length > 0) {
    const lines = profile.comparable_candidates.map(
      (c) => `  - ${c.title} [${c.reference_axis}] w=${c.weight} — ${c.reason}`,
    );
    parts.push(
      `Audience Reference Points (do NOT clone these plots — use as tonal/market anchors only):\n${lines.join("\n")}`,
    );
  }

  // Constraints
  if (profile.constraints_notes.length > 0) {
    parts.push(`Market Constraints:\n${profile.constraints_notes.map((n) => `  - ${n}`).join("\n")}`);
  }

  // Risks
  if (profile.risks.length > 0) {
    const lines = profile.risks.map((r) => `  - [${r.severity}] ${r.label}: ${r.reason}`);
    parts.push(`Saturation Risks:\n${lines.join("\n")}`);
  }

  // Demand signals (top 5 only for prompt brevity)
  if (profile.demand_signals.length > 0) {
    const lines = profile.demand_signals.slice(0, 5).map((d) => `  - ${d.label} (${d.score}/10): ${d.reason}`);
    parts.push(`Demand Signals:\n${lines.join("\n")}`);
  }

  if (parts.length === 0) return "";

  return [
    "",
    "=== CONVERGENCE CONTEXT (TRENDS → CREATIVE DNA) ===",
    ...parts,
    "",
    "CONVERGENCE INSTRUCTION:",
    "  - Align 70–80% to this convergence profile (what audiences demonstrably want).",
    "  - Add 20–30% novelty as the 'differentiation_move' — a fresh angle, subversion, or world twist.",
    "  - NEVER clone specific IP from the audience reference points above; remain fully original.",
    "  - Use genre heat and tone signals to shape voice, world density, and pacing.",
    "  - Flag saturation risks in risks_mitigations if a concept leans into a saturated space.",
    "=== END CONVERGENCE CONTEXT ===",
    "",
  ].join("\n");
}
