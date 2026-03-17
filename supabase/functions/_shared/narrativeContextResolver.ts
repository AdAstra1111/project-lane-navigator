/**
 * Narrative Context Resolver — single shared loader for NEC, canon, signals,
 * locked decisions, voice, canon constraint enforcement, and format-specific structure.
 *
 * Used by dev-engine-v2 (rewrite) and generate-document to achieve context
 * parity with the analyze path.
 *
 * INVARIANTS:
 * - Deterministic: same DB state → same output.
 * - No silent fallbacks: every fallback is logged with provenance.
 * - Capped outputs to prevent prompt bloat.
 * - Reuses existing loaders (prefs, teamVoice, canonContext, effective-profile).
 * - Canon Constraint Enforcement (CCE): extracts binding constraints from canon
 *   and injects anti-drift prompt block into every generation.
 */

import { loadLanePrefs, loadTeamVoiceProfile } from "./prefs.ts";
import { buildTeamVoicePromptBlock } from "./teamVoice.ts";
import { buildEffectiveProfileContextBlock } from "./effective-profile-context.ts";
import {
  extractCanonConstraints,
  buildCanonConstraintBlock,
  type CanonConstraints,
} from "./canonConstraintEnforcement.ts";

// ── Caps ──
const SIGNALS_CAP = 6;
const LOCKED_DECISIONS_CAP = 20;
const CHARACTERS_CAP = 25;
const WORLD_RULES_CAP = 20;
const NEC_MAX_CHARS = 3000;
const CANON_BLOCK_MAX_CHARS = 6000;

// ── Types ──

export interface NarrativeContext {
  nec: { prefTier: number; maxTier: number; source: string; blockText: string };
  canon: {
    title: string | null;
    logline: string | null;
    premise: string | null;
    worldRules: string[];
    characters: { name: string; detail: string }[];
    entityAnchors: string[];
    blockText: string;
  };
  canonConstraints: CanonConstraints;
  canonConstraintBlock: string;
  signals: { topSignals: any[]; blockText: string };
  lockedDecisions: { items: any[]; blockText: string };
  voice: { voiceId: string | null; blockText: string };
  effectiveProfile: { blockText: string };
  worldPopulation: { density: string; blockText: string };
  metadata: {
    provenance: Record<string, string>;
    counts: Record<string, number>;
    resolverHash: string;
  };
}

export interface ResolveOpts {
  includeSignals?: boolean;
  includeStructure?: boolean;
  lane?: string;
  format?: string;
}

// ── NEC tier parsing (mirrors dev-engine-v2 inline logic) ──
const PREF_TIER_RE = /(?:preferred\s*(?:operating\s*)?tier)[:\s]*(\d)/i;
const MAX_TIER_RE = /(?:(?:absolute\s*)?max(?:imum)?\s*tier)[:\s]*(\d)/i;

const NEC_HARD_ENFORCEMENT = `If your proposal introduces blackmail, public spectacle, mass-casualty/catastrophic stakes, life-ruin stakes, assassinations, or supernatural escalation and the NEC does not explicitly permit it, you MUST replace it with an alternative that stays at or below the Preferred Operating Tier, preserving tone and nuance.`;

function parseTier(match: RegExpMatchArray | null, fallback: number): number {
  if (!match) return fallback;
  const n = parseInt(match[1], 10);
  return (n >= 1 && n <= 5) ? n : fallback;
}

function clamp(s: string, n: number): string {
  return s && s.length > n ? s.slice(0, n) + "\n[…truncated]" : (s || "");
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Resolve all narrative intelligence for a project in one call.
 * Returns structured + block text for prompt injection.
 */
export async function resolveNarrativeContext(
  supabase: any,
  projectId: string,
  opts: ResolveOpts = {},
): Promise<NarrativeContext> {
  const provenance: Record<string, string> = {};
  const counts: Record<string, number> = {};
  const lane = opts.lane || "independent-film";
  const format = opts.format || "film";

  // ── 1. NEC ──
  let nec = { prefTier: 2, maxTier: 3, source: "default", blockText: "" };
  try {
    const { data: necDoc } = await supabase
      .from("project_documents")
      .select("id")
      .eq("project_id", projectId)
      .eq("doc_type", "nec")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (necDoc) {
      const { data: necVer } = await supabase
        .from("project_document_versions")
        .select("plaintext")
        .eq("document_id", necDoc.id)
        .eq("is_current", true)
        .maybeSingle();

      const text = necVer?.plaintext;
      if (text && text.length >= 20) {
        const prefTier = parseTier(text.match(PREF_TIER_RE), 2);
        const maxTier = parseTier(text.match(MAX_TIER_RE), 3);
        nec = {
          prefTier,
          maxTier,
          source: `nec:doc:${necDoc.id}`,
          blockText: buildNECBlock(text, prefTier, maxTier, necDoc.id),
        };
        provenance.nec = `doc:${necDoc.id}`;
      } else {
        nec.blockText = buildDefaultNECBlock();
        provenance.nec = "default:text_too_short";
      }
    } else {
      nec.blockText = buildDefaultNECBlock();
      provenance.nec = "default:no_nec_doc";
    }
  } catch (e) {
    console.warn("[narrative-context] NEC load failed, using default:", e);
    nec.blockText = buildDefaultNECBlock();
    provenance.nec = "default:error";
  }
  counts.nec_pref = nec.prefTier;
  counts.nec_max = nec.maxTier;

  // ── 2. Canon ──
  let canon = {
    title: null as string | null,
    logline: null as string | null,
    premise: null as string | null,
    worldRules: [] as string[],
    characters: [] as { name: string; detail: string }[],
    entityAnchors: [] as string[],
    blockText: "",
  };
  try {
    const { data: canonRow } = await supabase
      .from("project_canon")
      .select("canon_json")
      .eq("project_id", projectId)
      .maybeSingle();
    const cj = canonRow?.canon_json || {};

    const parts: string[] = [];
    if (cj.title) { canon.title = cj.title; parts.push(`Title: ${cj.title}`); }
    if (cj.logline && typeof cj.logline === "string" && cj.logline.trim()) { canon.logline = cj.logline; parts.push(`Logline: ${cj.logline}`); }
    if (cj.premise && typeof cj.premise === "string" && cj.premise.trim()) { canon.premise = cj.premise; parts.push(`Premise: ${cj.premise}`); }
    if (cj.format) parts.push(`Format: ${cj.format}`);
    if (cj.genre) parts.push(`Genre: ${cj.genre}`);
    if (cj.tone) parts.push(`Tone: ${cj.tone}`);
    if (cj.tone_style && typeof cj.tone_style === "string" && cj.tone_style.trim()) parts.push(`Tone & Style: ${cj.tone_style}`);

    // Episode meta
    const epCount = typeof cj.episode_count === "number" ? cj.episode_count : null;
    const epMin = typeof cj.episode_length_seconds_min === "number" ? cj.episode_length_seconds_min : null;
    const epMax = typeof cj.episode_length_seconds_max === "number" ? cj.episode_length_seconds_max : null;
    if (epCount) parts.push(`Episode count: ${epCount}`);
    if (epMin != null && epMax != null) parts.push(`Episode duration range: ${epMin}–${epMax}s`);

    // Characters — canon_json.characters is the primary source
    let characterLockBlock = "";
    if (Array.isArray(cj.characters) && cj.characters.length > 0) {
      const chars = cj.characters
        .filter((c: any) => c.name && c.name.trim())
        .slice(0, CHARACTERS_CAP);
      canon.characters = chars.map((c: any) => ({
        name: c.name,
        detail: [c.role, c.goals, c.traits].filter(Boolean).join("; "),
      }));
      canon.entityAnchors = chars.map((c: any) => c.name);
      const charLines = chars.map((c: any) => {
        const details = [c.role, c.goals, c.traits].filter(Boolean).join("; ");
        return `  - ${c.name}${details ? `: ${details}` : ""}`;
      });
      parts.push(`Characters:\n${charLines.join("\n")}`);
      characterLockBlock = `\nCHARACTER INVENTION LOCK: Use ONLY the canonical characters listed above. Do NOT invent, hallucinate, or introduce any new named characters — including offscreen relatives, backstory figures, or referenced-but-unseen people. Unnamed extras must use generic descriptors (e.g., WAITER, GUARD, PASSERBY, "his sister", "a former colleague"). If a scene requires a new named character, flag it as [NEW CHARACTER NEEDED] instead of inventing one. This applies to ALL names mentioned in dialogue, narration, flashbacks, and backstory.`;
      provenance.characterLock = "canon_characters";
    } else {
      // Fallback: attempt to derive character names from character_bible upstream doc
      let derivedNames: string[] = [];
      try {
        const { data: cbDoc } = await supabase
          .from("project_documents")
          .select("id")
          .eq("project_id", projectId)
          .eq("doc_type", "character_bible")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cbDoc) {
          const { data: cbVer } = await supabase
            .from("project_document_versions")
            .select("plaintext")
            .eq("document_id", cbDoc.id)
            .eq("is_current", true)
            .maybeSingle();
          if (cbVer?.plaintext && cbVer.plaintext.length > 50) {
            // Strip "WORLD CHARACTERS" section to prevent non-canonical names entering the lock
            let cbText = cbVer.plaintext;
            const wcMatch = cbText.match(/^#{1,3}\s+WORLD CHARACTERS\b/mi) || cbText.match(/^#{1,3}\s+World Characters\b/mi);
            if (wcMatch && wcMatch.index !== undefined) {
              cbText = cbText.slice(0, wcMatch.index).trimEnd();
            }
            // Extract character names from markdown headings and bold declarations.
            // Patterns handle: ## Name, ### I. NAME, **NAME (Role)**, **NAME** — desc, **NAME:**
            const headingMatches = cbText.match(/^#{2,4}\s+(?:[IVXLC]+\.\s+)?(?:THE\s+)?([A-Z][a-zA-Z' -]{1,30})$/gm) || [];
            // Pattern 1: **NAME** followed by separator outside bold (original)
            const boldMatches1 = cbText.match(/\*\*([A-Z][a-zA-Z' -]{1,30})\*\*\s*(?:[—–:\(])/g) || [];
            // Pattern 2: **NAME (Role)** or **NAME / 'ALIAS' (Role)** — parens inside bold
            const boldMatches2 = cbText.match(/\*\*([A-Z][a-zA-Z' -]{1,30})\s*(?:\/[^*]*)?\([^)]*\)\*\*/g) || [];
            // Pattern 3: **THE NAME / 'ALIAS' (Role)** — with THE prefix and alias
            const boldMatches3 = cbText.match(/\*\*THE\s+([A-Z][a-zA-Z' -]{1,30})\s*\/\s*'([A-Z][a-zA-Z' -]{1,20})'/g) || [];
            const STRUCTURAL_TERMS = new Set([
              "CHARACTER BIBLE", "CHARACTERS", "SERIES OVERVIEW", "OVERVIEW", "INTRODUCTION",
              "MAIN CHARACTERS", "PRINCIPAL CHARACTERS", "SUPPORTING CHARACTERS", "RECURRING CHARACTERS", "MINOR CHARACTERS",
              "WORLD CHARACTERS", "HIERARCHY LAYER", "ENVIRONMENTAL FIGURES", "RELATIONSHIP MAP",
              "NOTES", "APPENDIX", "SUMMARY", "CONCLUSION", "ROLE", "BACKSTORY", "ACT ONE",
              "ACT TWO", "ACT THREE", "RELATIONSHIPS", "CHARACTER DYNAMICS", "THEMES",
              "PROTAGONIST", "ANTAGONIST", "FOIL", "SUPPORTING CAST", "SETTING",
              "VISUAL DNA", "THEMATIC ELEMENTS", "KEY THEMATIC ELEMENTS", "PRESSURE COOKER",
              "FORMAT", "SEASON LENGTH", "EPISODE DURATION", "TONE", "CORE CONCEPT",
              "ARCHETYPE", "BACKGROUND", "MOTIVATION", "PERSONALITY", "ARC",
              "ANTAGONIST OPPOSITION FORCE", "OPPOSITION FORCE",
            ]);
            const nameSet = new Set<string>();
            const addName = (raw: string) => {
              let name = raw.trim();
              // Strip leading "THE " for structural matching but preserve for character names like "THE CLERK"
              const nameUpper = name.toUpperCase();
              const nameNoThe = nameUpper.replace(/^THE\s+/, "");
              if (name.length <= 1 || name.length > 30) return;
              if (STRUCTURAL_TERMS.has(nameUpper) || STRUCTURAL_TERMS.has(nameNoThe)) return;
              // Skip names that look like section descriptors rather than characters
              if (/^(DARK[- ]STREAM|VISUAL|SETTING|LOCATION|THEME|FORMAT|SERIES)/i.test(name)) return;
              nameSet.add(name);
            };
            for (const m of headingMatches) {
              addName(m.replace(/^#{2,4}\s+(?:[IVXLC]+\.\s+)?(?:THE\s+)?/, ""));
            }
            for (const m of boldMatches1) {
              addName(m.replace(/\*\*/g, "").replace(/\s*[—–:\(].*$/, ""));
            }
            for (const m of boldMatches2) {
              addName(m.replace(/\*\*/g, "").replace(/\s*[\(\/].*$/, ""));
            }
            for (const m of boldMatches3) {
              // Extract both the descriptor name and the alias
              const parts = m.replace(/\*\*/g, "");
              const aliasMatch = parts.match(/'([A-Z][a-zA-Z' -]{1,20})'/);
              if (aliasMatch) addName(aliasMatch[1]);
              addName(parts.replace(/^THE\s+/, "").replace(/\s*\/.*$/, ""));
            }
            derivedNames = [...nameSet].slice(0, CHARACTERS_CAP);
          }
        }
      } catch (e) {
        console.warn("[narrative-context] character_bible fallback extraction failed:", e);
      }

      if (derivedNames.length > 0) {
        canon.entityAnchors = derivedNames;
        parts.push(`Characters (derived from Character Bible): ${derivedNames.join(", ")}`);
        characterLockBlock = `\nCHARACTER INVENTION LOCK (DERIVED): The following character names were extracted from the Character Bible: ${derivedNames.join(", ")}. Use ONLY these characters plus any names appearing in the upstream source documents provided below. Do NOT invent, hallucinate, or introduce any new named characters — including offscreen relatives, backstory figures, or referenced-but-unseen people. Use generic descriptors instead (e.g., "his sister", "a former colleague", WAITER, GUARD). If a scene requires a new named character, flag it as [NEW CHARACTER NEEDED] instead of inventing one. This applies to ALL names mentioned in dialogue, narration, flashbacks, and backstory.`;
        provenance.characterLock = "derived_from_character_bible";
        console.log(`[narrative-context] character_lock: derived ${derivedNames.length} names from character_bible`);
      } else {
        characterLockBlock = `\nCHARACTER INVENTION LOCK (NO CANON): No canonical character list is established for this project. You MUST use only character names that appear in the upstream source documents provided. Do NOT invent or hallucinate new named characters. If you need a character not mentioned in the source material, use a generic descriptor (e.g., THE STRANGER, A DETECTIVE) or flag as [NEW CHARACTER NEEDED]. This constraint prevents cross-contamination from model training data.`;
        provenance.characterLock = "empty_no_characters";
        console.log(`[narrative-context] character_lock: no canon characters and no character_bible fallback available`);
      }
    }

    if (cj.timeline && typeof cj.timeline === "string" && cj.timeline.trim()) parts.push(`Timeline: ${cj.timeline}`);
    if (cj.locations && typeof cj.locations === "string" && cj.locations.trim()) parts.push(`Locations: ${cj.locations}`);
    if (cj.ongoing_threads && typeof cj.ongoing_threads === "string" && cj.ongoing_threads.trim()) parts.push(`Ongoing threads: ${cj.ongoing_threads}`);

    // World rules
    if (Array.isArray(cj.world_rules) && cj.world_rules.length > 0) {
      canon.worldRules = cj.world_rules.slice(0, WORLD_RULES_CAP);
      parts.push(`World rules: ${canon.worldRules.join("; ")}`);
    } else if (typeof cj.world_rules === "string" && cj.world_rules.trim()) {
      canon.worldRules = [cj.world_rules];
      parts.push(`World rules: ${cj.world_rules}`);
    }

    if (Array.isArray(cj.forbidden_changes) && cj.forbidden_changes.length > 0) parts.push(`Forbidden changes: ${cj.forbidden_changes.join("; ")}`);
    else if (typeof cj.forbidden_changes === "string" && cj.forbidden_changes.trim()) parts.push(`Forbidden changes: ${cj.forbidden_changes}`);
    if (cj.format_constraints && typeof cj.format_constraints === "string" && cj.format_constraints.trim()) parts.push(`Format constraints: ${cj.format_constraints}`);

    if (parts.length > 0) {
      canon.blockText = clamp(`\nCANON OS (authoritative — these values override any other references):\n${parts.join("\n")}${characterLockBlock}`, CANON_BLOCK_MAX_CHARS);
      provenance.canon = "project_canon";
    } else {
      canon.blockText = `\nCANON OS: No canonical logline, premise, or characters established. Do NOT assert specific details as canonical facts.${characterLockBlock}`;
      provenance.canon = "empty";
    }

    // Effective profile (from seed_intel_pack)
    let effectiveProfileBlock = "";
    try {
      const { data: proj } = await supabase.from("projects").select("assigned_lane, budget_range, tone").eq("id", projectId).maybeSingle();
      if (cj.seed_intel_pack || (Array.isArray(cj.comparables) && cj.comparables.length > 0)) {
        effectiveProfileBlock = buildEffectiveProfileContextBlock({ canonJson: cj, project: proj }) || "";
      }
    } catch (e) {
      console.warn("[narrative-context] effective profile build failed:", e);
    }

    counts.canonChars = canon.blockText.length;
    counts.characters = canon.characters.length;
    counts.worldRules = canon.worldRules.length;

    // ── 2b. Canon Constraint Enforcement (CCE) — deterministic extraction ──
    const canonConstraints = extractCanonConstraints(cj as Record<string, unknown>);
    const canonConstraintBlock = buildCanonConstraintBlock(canonConstraints);
    if (canonConstraints.extractedFrom !== "empty") {
      provenance.canonConstraints = "cce_extracted";
      counts.cceConstraintChars = canonConstraintBlock.length;
      console.log(`[narrative-context] CCE: protagonist=${canonConstraints.protagonist.name || "none"} characters=${canonConstraints.canonicalCharacterNames.length} worldMode=${canonConstraints.worldRuleMode.supernatural} relationships=${canonConstraints.relationships.length}`);
    } else {
      provenance.canonConstraints = "empty";
      counts.cceConstraintChars = 0;
    }
    counts.worldRules = canon.worldRules.length;

    // ── 3. Signals ──
    let signals = { topSignals: [] as any[], blockText: "" };
    if (opts.includeSignals !== false) {
      try {
        const { data: projSettings } = await supabase.from("projects")
          .select("signals_influence, signals_apply")
          .eq("id", projectId).single();
        const influence = (projSettings as any)?.signals_influence ?? 0.5;
        const applyConfig = (projSettings as any)?.signals_apply ?? { pitch: true, dev: true, grid: true, doc: true };
        if (applyConfig.dev !== false) {
          const { data: matches } = await supabase
            .from("project_signal_matches")
            .select("relevance_score, impact_score, rationale, cluster:cluster_id(name, category, strength, velocity, saturation_risk, explanation)")
            .eq("project_id", projectId)
            .order("impact_score", { ascending: false })
            .limit(SIGNALS_CAP);
          if (matches && matches.length > 0) {
            signals.topSignals = matches;
            const fmt = format.includes("vertical") ? "vertical_drama" : format.includes("documentary") ? "documentary" : "film";
            const influenceLabel = influence >= 0.65 ? "HIGH" : influence >= 0.35 ? "MODERATE" : "LOW";
            const fmtNote = fmt === "vertical_drama" ? "Apply retention mechanics — cliff cadence, reveal pacing, twist density."
              : fmt === "documentary" ? "Apply truth constraints — access/evidence plan. Signals inform subject positioning only."
              : "Apply budget realism, lane liquidity, and saturation warnings.";
            const lines = matches.map((m: any, i: number) => {
              const c = m.cluster;
              return `${i+1}. ${c?.name || "Signal"} [${c?.category || ""}] — strength ${c?.strength || 0}/10, ${c?.velocity || "Stable"}, saturation ${c?.saturation_risk || "Low"}\n   ${c?.explanation || ""}`;
            }).join("\n");
            signals.blockText = `\n=== MARKET & FORMAT SIGNALS (influence: ${influenceLabel}) ===\n${fmtNote}\n${lines}\n=== END SIGNALS ===`;
            provenance.signals = "project_signal_matches";
          } else {
            provenance.signals = "none:no_matches";
          }
        } else {
          provenance.signals = "disabled:signals_apply.dev=false";
        }
      } catch (e) {
        console.warn("[narrative-context] signal fetch failed:", e);
        provenance.signals = "error";
      }
    } else {
      provenance.signals = "skipped";
    }
    counts.signals = signals.topSignals.length;

    // ── 4. Locked Decisions ──
    let lockedDecisions = { items: [] as any[], blockText: "" };
    try {
      const { data: decisions } = await supabase.from("decision_ledger")
        .select("decision_key, title, decision_text")
        .eq("project_id", projectId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(LOCKED_DECISIONS_CAP);
      if (decisions && decisions.length > 0) {
        lockedDecisions.items = decisions;
        const bullets = decisions.map((d: any) => `- [${d.decision_key}] ${d.decision_text}`).join("\n");
        lockedDecisions.blockText = `\n\nLOCKED DECISIONS (MUST FOLLOW — treat as canon, do not re-open):\n${bullets}`;
        provenance.decisions = "decision_ledger";
      } else {
        provenance.decisions = "none";
      }
    } catch (e) {
      console.warn("[narrative-context] locked decisions fetch failed:", e);
      provenance.decisions = "error";
    }
    counts.decisions = lockedDecisions.items.length;

    // ── 5. Voice ──
    let voice = { voiceId: null as string | null, blockText: "" };
    let worldPopulation = { density: "moderate", blockText: "" };
    try {
      const prefs = await loadLanePrefs(supabase, projectId, lane);

      // Voice
      if (prefs?.team_voice?.id) {
        const tv = await loadTeamVoiceProfile(supabase, prefs.team_voice.id);
        if (tv) {
          const hasWritingVoice = !!prefs.writing_voice?.id;
          voice.blockText = `\n${buildTeamVoicePromptBlock(tv.label, tv.profile_json, hasWritingVoice)}`;
          voice.voiceId = prefs.team_voice.id;
          provenance.voice = `team_voice:${prefs.team_voice.id}`;
        }
      }
      if (!voice.voiceId) provenance.voice = provenance.voice || "none";

      // ── 6. World Population Density (NON-CANONICAL — prompt-only) ──
      const density = prefs?.world_population_density || "moderate";
      worldPopulation.density = density;
      if (density !== "minimal") {
        worldPopulation.blockText = buildWorldPopulationBlock(density);
        provenance.worldPopulation = density;
      } else {
        provenance.worldPopulation = "minimal:omitted";
      }
    } catch (e) {
      console.warn("[narrative-context] voice/population load failed:", e);
      provenance.voice = provenance.voice || "error";
      provenance.worldPopulation = "error:fallback_moderate";
    }

    // ── Build resolver hash ──
    const hashInput = `${nec.source}|${counts.canonChars}|${counts.signals}|${counts.decisions}|${voice.voiceId || "none"}|${worldPopulation.density}`;
    const resolverHash = djb2(hashInput);

    console.log(`[narrative-context] project=${projectId} format=${format} hash=${resolverHash} nec=${provenance.nec} signals=${counts.signals} decisions=${counts.decisions} canonChars=${counts.canonChars} voice=${voice.voiceId || "null"} worldPop=${worldPopulation.density}`);

    return {
      nec,
      canon,
      canonConstraints,
      canonConstraintBlock,
      signals,
      lockedDecisions,
      voice,
      effectiveProfile: { blockText: effectiveProfileBlock },
      worldPopulation,
      metadata: { provenance, counts, resolverHash },
    };
  } catch (e) {
    console.error("[narrative-context] canon load failed:", e);
    const emptyConstraints = extractCanonConstraints({});
    const resolverHash = djb2(`error|${projectId}`);
    return {
      nec,
      canon,
      canonConstraints: emptyConstraints,
      canonConstraintBlock: "",
      signals: { topSignals: [], blockText: "" },
      lockedDecisions: { items: [], blockText: "" },
      voice: { voiceId: null, blockText: "" },
      effectiveProfile: { blockText: "" },
      worldPopulation: { density: "moderate", blockText: "" },
      metadata: { provenance, counts, resolverHash },
    };
  }
}

/**
 * Build a combined block text for prompt injection.
 * Concatenates all non-empty block texts in canonical order.
 */
export function buildNarrativeContextBlock(ctx: NarrativeContext): string {
  return [
    ctx.nec.blockText,
    ctx.canon.blockText,
    ctx.canonConstraintBlock,
    ctx.effectiveProfile.blockText,
    ctx.signals.blockText,
    ctx.lockedDecisions.blockText,
    ctx.voice.blockText,
    ctx.worldPopulation.blockText,
  ].filter(Boolean).join("\n");
}

// ── World Population Prompt Block (NON-CANONICAL) ──

const WORLD_POP_MODERATE = `
=== WORLD POPULATION LAYER (NON-CANONICAL — do NOT treat as canon) ===
Include a supporting world with secondary and background characters (e.g., guards, attendants, courtiers, soldiers, advisors, servants, townspeople, messengers).
These characters should:
- create a lived-in, socially complex environment
- reinforce hierarchy, scale, and realism
- appear naturally within scenes and interactions
Constraints:
- they are NOT core narrative anchors
- they should NOT introduce new canonical dependencies
- they should NOT alter or conflict with established canon
- they should remain flexible and non-binding
Intensity: MODERATE — light presence, occasional references.
=== END WORLD POPULATION LAYER ===`;

const WORLD_POP_RICH = `
=== WORLD POPULATION LAYER (NON-CANONICAL — do NOT treat as canon) ===
Include a rich, densely populated supporting world with multiple layers of secondary and background characters (e.g., guards, attendants, courtiers, soldiers, advisors, servants, townspeople, messengers, traders, officials, clergy, laborers).
These characters should:
- create a lived-in, socially complex, visually dense environment
- reinforce hierarchy, scale, political texture, and production realism
- appear frequently within scenes with distinct behaviors and social roles
- suggest a world that continues beyond the frame
Constraints:
- they are NOT core narrative anchors
- they should NOT introduce new canonical dependencies
- they should NOT alter or conflict with established canon
- they should remain flexible and non-binding
Intensity: RICH — frequent presence, multiple layers of world activity, visible social structure.
=== END WORLD POPULATION LAYER ===`;

function buildWorldPopulationBlock(density: string): string {
  if (density === "rich") return WORLD_POP_RICH;
  return WORLD_POP_MODERATE; // default for anything non-minimal
}

// ── Internal NEC block builders ──

function buildNECBlock(text: string, prefTier: number, maxTier: number, docId: string): string {
  return `\nNEC_GUARDRAIL: source=nec doc_id=${docId} prefTier=${prefTier} maxTier=${maxTier}
NARRATIVE ENERGY CONTRACT (from project NEC — AUTHORITATIVE, overrides all other stakes guidance):
${clamp(text, NEC_MAX_CHARS)}

HARD RULES (derived from NEC — non-negotiable):
• Preferred Operating Tier: ${prefTier}. Absolute Maximum Tier: ${maxTier}.
• Do NOT introduce events above Tier ${maxTier}. No assassinations, mass casualty events, catastrophic public scandal, "life-ruin" stakes, supernatural escalation, or blackmail unless NEC explicitly allows.
• Prefer prestige pressure: intimate stakes, reputational friction, relational loss, psychological suspense over spectacle.
• Stay inside the tonal envelope. Do NOT escalate beyond what the source material establishes.
HARD ENFORCEMENT: ${NEC_HARD_ENFORCEMENT}`;
}

function buildDefaultNECBlock(): string {
  return `\nNEC_GUARDRAIL: source=default prefTier=2 maxTier=3
NARRATIVE ENERGY CONTRACT (DEFAULT — no project NEC found):
- Preferred Operating Tier: 2 (psychological/relational pressure, status games, moral dilemmas).
- Absolute Maximum Tier: 3 (career-ending revelations, major betrayals, institutional collapse).
- HARD RULES:
  • Do NOT introduce events above Tier 3.
  • No assassinations, mass casualty events, catastrophic public scandal, "life-ruin" stakes, supernatural escalation, or blackmail unless the source material already contains them.
  • Prefer prestige pressure: intimate stakes, reputational friction, relational loss, psychological suspense.
  • Stay inside the tonal envelope established by the source material.
HARD ENFORCEMENT: ${NEC_HARD_ENFORCEMENT}`;
}
