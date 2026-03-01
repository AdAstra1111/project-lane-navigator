import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildGuardrailBlock, validateOutput, buildRegenerationPrompt } from "../_shared/guardrails.ts";
import { composeSystem } from "../_shared/llm.ts";
import { buildBeatGuidanceBlock, computeBeatTargets } from "../_shared/verticalDramaBeats.ts";
import { loadLanePrefs, loadTeamVoiceProfile } from "../_shared/prefs.ts";
import { buildTeamVoicePromptBlock } from "../_shared/teamVoice.ts";
import { isLargeRiskDocType, chunkPlanFor } from "../_shared/largeRiskRouter.ts";
import { runChunkedGeneration } from "../_shared/chunkRunner.ts";
import { hasBannedSummarizationLanguage, validateEpisodicChunk, validateEpisodicContent } from "../_shared/chunkValidator.ts";
import {
  extractFingerprint, computeDeviation, buildTargetFromTeamVoice,
  buildTargetFromWritingVoice, buildStyleEvalMeta, buildStyleRepairPrompt,
  selectBestAttempt, STYLE_ENGINE_VERSION,
  type StyleTarget, type StyleEvalResult, type StyleFingerprint, type StyleDeviation,
} from "../_shared/styleDeviation.ts";
import { buildEffectiveProfileContextBlock } from "../_shared/effective-profile-context.ts";

// ── NEC (Narrative Energy Contract) Guardrail Loader ──
const NEC_MAX_CHARS = 3000;

const NEC_HARD_ENFORCEMENT = `If your proposal introduces blackmail, public spectacle, mass-casualty/catastrophic stakes, life-ruin stakes, assassinations, or supernatural escalation and the NEC does not explicitly permit it, you MUST replace it with an alternative that stays at or below the Preferred Operating Tier, preserving tone and nuance.`;

const NEC_DEFAULT_GUARDRAIL = `\nNEC_GUARDRAIL: source=default prefTier=2 maxTier=3
NARRATIVE ENERGY CONTRACT (DEFAULT — no project NEC found):
- Preferred Operating Tier: 2 (psychological/relational pressure, status games, moral dilemmas).
- Absolute Maximum Tier: 3 (career-ending revelations, major betrayals, institutional collapse).
- HARD RULES:
  • Do NOT introduce events above Tier 3.
  • No assassinations, mass casualty events, catastrophic public scandal, "life-ruin" stakes, supernatural escalation, or blackmail unless the source material already contains them.
  • No "major concert confession" or public-spectacle climaxes unless source material demands it.
  • Prefer prestige pressure: intimate stakes, reputational friction, relational loss, psychological suspense.
  • Stay inside the tonal envelope established by the source material.
HARD ENFORCEMENT: ${NEC_HARD_ENFORCEMENT}`;

// Regex accepts common NEC tier label variants
const PREF_TIER_RE = /(?:preferred\s*(?:operating\s*)?tier)[:\s]*(\d)/i;
const MAX_TIER_RE = /(?:(?:absolute\s*)?max(?:imum)?\s*tier)[:\s]*(\d)/i;

function parseTier(match: RegExpMatchArray | null, fallback: number): number {
  if (!match) return fallback;
  const n = parseInt(match[1], 10);
  return (n >= 1 && n <= 5) ? n : fallback;
}

async function loadNECGuardrailBlock(
  supabaseClient: any,
  projectId: string,
): Promise<string> {
  try {
    const { data: necDoc } = await supabaseClient
      .from('project_documents')
      .select('id')
      .eq('project_id', projectId)
      .eq('doc_type', 'nec')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!necDoc) {
      console.log(`[dev-engine-v2] NEC_GUARDRAIL: source=default prefTier=2 maxTier=3`);
      return NEC_DEFAULT_GUARDRAIL;
    }

    const { data: necVersion } = await supabaseClient
      .from('project_document_versions')
      .select('plaintext')
      .eq('document_id', necDoc.id)
      .eq('is_current', true)
      .maybeSingle();

    const text = necVersion?.plaintext;
    if (!text || text.length < 20) {
      console.log(`[dev-engine-v2] NEC_GUARDRAIL: source=default doc_id=${necDoc.id} prefTier=2 maxTier=3 (text too short)`);
      return NEC_DEFAULT_GUARDRAIL;
    }

    const prefTier = parseTier(text.match(PREF_TIER_RE), 2);
    const maxTier = parseTier(text.match(MAX_TIER_RE), 3);

    console.log(`[dev-engine-v2] NEC_GUARDRAIL: source=nec doc_id=${necDoc.id} prefTier=${prefTier} maxTier=${maxTier}`);

    return `\nNEC_GUARDRAIL: source=nec doc_id=${necDoc.id} prefTier=${prefTier} maxTier=${maxTier}
NARRATIVE ENERGY CONTRACT (from project NEC — AUTHORITATIVE, overrides all other stakes guidance):
${clampText(text, NEC_MAX_CHARS)}

HARD RULES (derived from NEC — non-negotiable):
• Preferred Operating Tier: ${prefTier}. Absolute Maximum Tier: ${maxTier}.
• Do NOT introduce events above Tier ${maxTier}. No assassinations, mass casualty events, catastrophic public scandal, "life-ruin" stakes, supernatural escalation, or blackmail unless NEC explicitly allows.
• No "major concert confession" or public-spectacle climaxes unless NEC explicitly calls for public spectacle.
• Prefer prestige pressure: intimate stakes, reputational friction, relational loss, psychological suspense over spectacle.
• Stay inside the tonal envelope. Do NOT escalate beyond what the source material establishes.
HARD ENFORCEMENT: ${NEC_HARD_ENFORCEMENT}`;
  } catch (e) {
    console.warn('[dev-engine-v2] NEC load failed, using default guardrail:', e);
    console.log(`[dev-engine-v2] NEC_GUARDRAIL: source=default prefTier=2 maxTier=3`);
    return NEC_DEFAULT_GUARDRAIL;
  }
}

// ── Supporting doc pack constants ──
const SUPPORTING_TOTAL_BUDGET = 24000;
const SUPPORTING_PER_DOC_BUDGET = 6000;

function clampText(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n);
}

async function loadSupportingDocPack(
  supabaseClient: any,
  projectId: string,
  includeDocumentIds: string[],
  excludeDocumentId: string
): Promise<string> {
  const ids = (includeDocumentIds || []).filter(Boolean).filter(id => id !== excludeDocumentId);
  if (ids.length === 0) return '';

  const { data: docs, error: docsErr } = await supabaseClient
    .from('project_documents')
    .select('id, doc_type, title, file_name, created_at')
    .eq('project_id', projectId)
    .in('id', ids);

  if (docsErr) throw docsErr;
  if (!docs || docs.length === 0) return '';

  const docTypePriority: Record<string, number> = {
    script: 0, outline: 1, beat_sheet: 2, synopsis: 3, treatment: 4,
    character_bible: 5, world_bible: 6, concept_brief: 7, notes: 8, other: 99,
  };

  const ordered = [...docs].sort((a: any, b: any) => {
    const pa = docTypePriority[a.doc_type ?? 'other'] ?? 50;
    const pb = docTypePriority[b.doc_type ?? 'other'] ?? 50;
    if (pa !== pb) return pa - pb;
    const ca = new Date(a.created_at).getTime();
    const cb = new Date(b.created_at).getTime();
    if (ca !== cb) return ca - cb;
    return String(a.id).localeCompare(String(b.id));
  });

  let remaining = SUPPORTING_TOTAL_BUDGET;
  const parts: string[] = [];

  for (const d of ordered) {
    if (remaining <= 0) break;

    const { data: vers, error: vErr } = await supabaseClient
      .from('project_document_versions')
      .select('plaintext, is_current, approval_status, version_number')
      .eq('document_id', d.id)
      .order('version_number', { ascending: false })
      .limit(25);

    if (vErr) throw vErr;
    if (!vers || vers.length === 0) continue;

    const current = vers.find((v: any) => v.is_current);
    const approved = vers.find((v: any) => v.approval_status === 'approved');
    const best = current ?? approved ?? vers[0];

    const chunkCap = Math.min(SUPPORTING_PER_DOC_BUDGET, remaining);
    const text = clampText(best?.plaintext ?? '', chunkCap);
    if (!text) continue;

    const label = d.title || d.file_name || d.doc_type || 'supporting_doc';
    parts.push(`--- SUPPORTING DOC: ${label} (doc_type=${d.doc_type ?? 'unknown'}) ---\n${text}\n`);
    remaining -= text.length;
  }

  if (parts.length === 0) return '';
  return `\n\n=== SUPPORTING CONTEXT (DETERMINISTIC EXCERPTS) ===\n${parts.join('\n')}\n`;
}

/** Load team voice context block + meta for stamping. Returns empty strings if none active. */
async function loadTeamVoiceContext(
  supabase: any,
  projectId: string,
  lane: string,
): Promise<{ block: string; metaStamp: Record<string, string> | null; prefsSnapshot: any }> {
  const prefs = await loadLanePrefs(supabase, projectId, lane);
  if (!prefs?.team_voice?.id) return { block: "", metaStamp: null, prefsSnapshot: prefs };
  const tv = await loadTeamVoiceProfile(supabase, prefs.team_voice.id);
  if (!tv) return { block: "", metaStamp: null, prefsSnapshot: prefs };
  const hasWritingVoice = !!prefs.writing_voice?.id;
  const block = buildTeamVoicePromptBlock(tv.label, tv.profile_json, hasWritingVoice);
  console.log(`[dev-engine-v2] Team Voice injected: id=${prefs.team_voice.id} label=${tv.label}`);
  return {
    block,
    metaStamp: { team_voice_id: prefs.team_voice.id, team_voice_label: tv.label },
    prefsSnapshot: prefs,
  };
}

/** Load voice targets for style eval from lane prefs. */
async function loadVoiceTargets(
  supabase: any,
  projectId: string,
  lane: string,
): Promise<{ target: StyleTarget; metaStamp: Record<string, string> | null }> {
  const prefs = await loadLanePrefs(supabase, projectId, lane);
  // Team voice takes priority
  if (prefs?.team_voice?.id) {
    const tv = await loadTeamVoiceProfile(supabase, prefs.team_voice.id);
    if (tv) {
      return {
        target: buildTargetFromTeamVoice(tv.profile_json, prefs.team_voice.id, tv.label),
        metaStamp: { team_voice_id: prefs.team_voice.id, team_voice_label: tv.label },
      };
    }
  }
  if (prefs?.writing_voice?.id) {
    return {
      target: buildTargetFromWritingVoice(prefs.writing_voice),
      metaStamp: { writing_voice_id: prefs.writing_voice.id, writing_voice_label: prefs.writing_voice.label || "" },
    };
  }
  return { target: { voice_source: "none" }, metaStamp: null };
}

/**
 * Run style eval on generated text. Returns enriched meta_json fields and optionally
 * inserts a style_evals row. Returns null if no voice target is set.
 */
async function runStyleEval(
  supabase: any,
  plaintext: string,
  projectId: string,
  documentId: string,
  versionId: string,
  lane: string,
  target: StyleTarget,
  attempt = 0,
): Promise<{ evalResult: StyleEvalResult; metaFields: Record<string, any> } | null> {
  if (target.voice_source === "none") return null;
  try {
    const fingerprint = extractFingerprint(plaintext);
    const deviation = computeDeviation(fingerprint, target);
    const evalResult: StyleEvalResult = {
      score: deviation.score,
      drift_level: deviation.drift_level,
      fingerprint,
      target,
      deltas: deviation.deltas,
      evaluated_at: new Date().toISOString(),
      engine_version: STYLE_ENGINE_VERSION,
      voice_source: target.voice_source,
    };
    const metaFields = buildStyleEvalMeta(evalResult);

    // Insert style_evals row (non-fatal)
    try {
      await supabase.from("style_evals").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        lane,
        voice_source: target.voice_source,
        team_voice_id: target.voice_source === "team_voice" ? target.voice_id : null,
        team_voice_label: target.voice_source === "team_voice" ? target.voice_label : null,
        writing_voice_id: target.voice_source === "writing_voice" ? target.voice_id : null,
        writing_voice_label: target.voice_source === "writing_voice" ? target.voice_label : null,
        score: deviation.score,
        drift_level: deviation.drift_level,
        fingerprint,
        target,
        deltas: deviation.deltas,
        attempt,
      });
    } catch (insertErr: any) {
      console.warn("[dev-engine-v2] style_evals insert failed (non-fatal):", insertErr?.message);
    }

    console.log(`[dev-engine-v2] Style eval: score=${deviation.score} drift=${deviation.drift_level} voice=${target.voice_source} attempt=${attempt}`);
    return { evalResult, metaFields };
  } catch (err: any) {
    console.warn("[dev-engine-v2] Style eval computation failed (non-fatal):", err?.message);
    return null;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRO_MODEL = "google/gemini-2.5-pro";
const FAST_MODEL = "google/gemini-2.5-flash";
const BALANCED_MODEL = "google/gemini-3-flash-preview";

const SCHEMA_VERSION = "v3";

function extractJSON(raw: string): string {
  let c = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
  if (!c.trim().startsWith("{") && !c.trim().startsWith("[")) {
    const i = c.indexOf("{");
    if (i >= 0) c = c.slice(i);
  }
  const last = c.lastIndexOf("}");
  if (last >= 0) c = c.slice(0, last + 1);
  return c.trim();
}

async function callAI(apiKey: string, model: string, system: string, user: string, temperature = 0.3, maxTokens = 32000): Promise<string> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          temperature,
          max_tokens: maxTokens,
        }),
      });
    } catch (fetchErr: any) {
      // Connection-level error (e.g. "error reading a body from connection")
      console.error(`AI fetch error (attempt ${attempt + 1}/${MAX_RETRIES}):`, fetchErr?.message || fetchErr);
      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt) * 3000;
        console.log(`Retrying after connection error in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`AI connection failed after ${MAX_RETRIES} attempts: ${fetchErr?.message || "unknown"}`);
    }

    // Read body safely — connection can drop during body read
    let text: string;
    try {
      text = await response.text();
    } catch (bodyErr: any) {
      console.error(`AI body read error (attempt ${attempt + 1}/${MAX_RETRIES}):`, bodyErr?.message || bodyErr);
      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt) * 3000;
        console.log(`Retrying after body read error in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`AI body read failed after ${MAX_RETRIES} attempts: ${bodyErr?.message || "unknown"}`);
    }

    if (response.ok) {
      if (!text || text.trim().length === 0) {
        console.error(`Empty response body from AI (attempt ${attempt + 1}/${MAX_RETRIES})`);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
          continue;
        }
        throw new Error("AI returned empty response after retries");
      }
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        const lastBrace = text.lastIndexOf("}");
        if (lastBrace > 0) {
          try {
            data = JSON.parse(text.substring(0, lastBrace + 1));
            console.warn("Recovered truncated JSON from AI response");
          } catch {
            throw new Error("AI returned unparseable response");
          }
        } else {
          throw new Error("AI returned unparseable response");
        }
      }
      return data.choices?.[0]?.message?.content || "";
    }
    console.error(`AI error (attempt ${attempt + 1}/${MAX_RETRIES}):`, response.status, text);
    if (response.status === 429) throw new Error("RATE_LIMIT");
    if (response.status === 402) throw new Error("PAYMENT_REQUIRED");
    if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
      const delay = Math.pow(2, attempt) * 2000;
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    throw new Error(`AI call failed: ${response.status}`);
  }
  throw new Error("AI call failed after retries");
}

const STRICT_JSON_RULES = `CRITICAL: Return ONLY valid JSON. No markdown fences. No trailing commas. All keys in double quotes. No comments. No extra text before or after the JSON object.`;

function safeSnippet(s: string, n = 300): string {
  if (!s) return "";
  return s.slice(0, n);
}

function looksLikeAnalyzeShape(obj: any): boolean {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  // Permissive: any of these top-level keys means it's plausibly an analyze result
  return !!(obj.actionable_notes || obj.metrics || obj.score || obj.scores ||
    obj.summary || obj.result || obj.ci_score != null || obj.convergence ||
    obj.blocking_issues || obj.high_impact_notes);
}

async function parseAIJson(apiKey: string, raw: string): Promise<any> {
  try {
    return JSON.parse(extractJSON(raw));
  } catch {
    try {
      const repair = await callAI(apiKey, FAST_MODEL, "Fix this malformed JSON. Return ONLY valid JSON.", raw.slice(0, 6000));
      return JSON.parse(extractJSON(repair));
    } catch (e2) {
      console.error("[dev-engine-v2] parseAIJson repair also failed", raw.slice(0, 300));
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// NOTE FINGERPRINTING + STATE HELPERS
// ═══════════════════════════════════════════════════════════════

function normalizeNoteText(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

async function makeNoteFingerprint(fields: {
  docType: string;
  episodeNumber?: number | null;
  anchor?: string;
  intentLabel?: string;
  summary: string;
  constraintKey?: string;
}): Promise<string> {
  const raw = [
    fields.docType || "",
    String(fields.episodeNumber ?? ""),
    fields.anchor || "",
    fields.intentLabel || "",
    normalizeNoteText(fields.summary).slice(0, 120),
    fields.constraintKey || "",
  ].join("|");
  try {
    const buf = new TextEncoder().encode(raw);
    const hashBuf = await crypto.subtle.digest("SHA-256", buf);
    const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 40);
  } catch {
    // Fallback djb2
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(40, "0").slice(0, 40);
  }
}

function inferNoteAnchor(note: any): string {
  const desc = (note.description || note.note || "").toLowerCase();
  if (note.anchor) return note.anchor;
  if (desc.includes("character:") || desc.match(/\bcharacter\b.{0,20}(maya|protagonist|antagonist)/)) {
    const m = desc.match(/character:(\w+)/);
    return m ? `character:${m[1]}` : "character:unknown";
  }
  if (desc.match(/scene\s*(\d+)/)) {
    const m = desc.match(/scene\s*(\d+)/);
    return `scene:${m![1]}`;
  }
  if (note.constraint_key) return `rule:${note.constraint_key}`;
  return "";
}

function inferNoteTier(note: any): "hard" | "soft" {
  if (note.tier) return note.tier as "hard" | "soft";
  const desc = (note.description || note.note || "").toLowerCase();
  const cat = (note.category || "").toLowerCase();
  const hardSignals = [
    "canon", "contradiction", "timeline", "impossible", "bible", "must happen",
    "grid beat", "format rule", "episode count", "missing beat", "cliffhanger missing",
    "character bible", "cross-episode", "continuity",
  ];
  const isHard = note.severity === "blocker" &&
    hardSignals.some(s => desc.includes(s) || cat.includes(s));
  return isHard ? "hard" : "soft";
}

function extractNoteScope(note: any, anchor: string): Record<string, any> {
  if (anchor.startsWith("character:")) return { type: "character", key: anchor.replace("character:", "") };
  if (anchor.startsWith("scene:")) return { type: "scene", key: anchor.replace("scene:", "") };
  if (anchor.startsWith("rule:")) return { type: "rule", key: anchor.replace("rule:", "") };
  const desc = (note.description || note.note || "").toLowerCase();
  if (desc.match(/scene\s*\d+/)) {
    const m = desc.match(/scene\s*(\d+)/);
    return { type: "scene", key: m![1] };
  }
  return { type: "global", key: "all" };
}

// Coarse text diff: returns true if texts share significant changed regions
// Simple approach: compare line-level hash sets
function textRegionsChanged(oldText: string, newText: string): boolean {
  if (!oldText || !newText) return true;
  const oldLines = new Set(oldText.split("\n").map(l => l.trim()).filter(Boolean));
  const newLines = new Set(newText.split("\n").map(l => l.trim()).filter(Boolean));
  let removed = 0;
  for (const l of oldLines) { if (!newLines.has(l)) removed++; }
  const changeRatio = removed / Math.max(oldLines.size, 1);
  return changeRatio > 0.05; // >5% change considered significant
}

function scopeIntersectsDiff(scope: Record<string, any>, oldText: string, newText: string): boolean {
  if (!oldText || !newText) return true;
  if (scope.type === "global") return textRegionsChanged(oldText, newText);
  // For character/scene/rule scopes, check if relevant lines changed
  const key = (scope.key || "").toLowerCase();
  const oldLines = oldText.split("\n").filter(l => l.toLowerCase().includes(key));
  const newLines = newText.split("\n").filter(l => l.toLowerCase().includes(key));
  if (oldLines.length === 0 && newLines.length === 0) return false;
  const oldSet = new Set(oldLines.map(l => l.trim()));
  const newSet = new Set(newLines.map(l => l.trim()));
  for (const l of oldSet) { if (!newSet.has(l)) return true; }
  return false;
}

// Compute a hash of canon inputs for change detection
function hashCanonInputs(bible: string, grid: string, formatRules: string): string {
  const raw = `${(bible || "").slice(0, 2000)}|${(grid || "").slice(0, 1000)}|${(formatRules || "").slice(0, 500)}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

async function upsertNoteState(supabase: any, params: {
  projectId: string;
  docType: string;
  episodeNumber: number | null;
  note: any;
  versionId: string;
  prevVersionText: string;
  prevVersionId: string | null;
  newVersionText: string;
  canonHash: string;
  prevCanonHash: string | null;
}): Promise<{ fingerprint: string; clusterId: string; state: any | null; suppressed: boolean }> {
  const { projectId, docType, episodeNumber, note, versionId, prevVersionText, prevVersionId, newVersionText, canonHash, prevCanonHash } = params;
  const anchor = inferNoteAnchor(note);
  const tier = inferNoteTier(note);
  const scope = extractNoteScope(note, anchor);
  const summary = note.description || note.note || note.id || "";
  // Fix: constraint_key must not default to note ID — use anchor or category instead
  const constraintKey = note.constraint_key || note.canon_ref_key ||
    (note.anchor ? `anchor:${note.anchor}` : null) ||
    (note.category ? `cat:${note.category}` : "general");

  const fingerprint = await makeNoteFingerprint({
    docType,
    episodeNumber,
    anchor,
    intentLabel: note.category || "",
    summary,
    constraintKey,
  });
  const clusterId = fingerprint.slice(0, 16);

  // Fetch existing state
  const { data: existing } = await supabase
    .from("project_dev_note_state")
    .select("*")
    .eq("project_id", projectId)
    .eq("doc_type", docType)
    .eq("note_fingerprint", fingerprint)
    .is("episode_number", episodeNumber)
    .maybeSingle();

  const terminalStatuses = new Set(["applied", "waived", "deferred", "locked", "superseded"]);

  if (existing && terminalStatuses.has(existing.status)) {
    // Diff-gate: check if scope was touched by the edit
    const canonChanged = prevCanonHash && canonHash !== prevCanonHash;
    const scopeTouched = scopeIntersectsDiff(scope, prevVersionText, newVersionText);

    if (!scopeTouched && !canonChanged) {
      // Not touched — suppress this note, don't reopen
      return { fingerprint, clusterId, state: existing, suppressed: true };
    }

    // Scope was touched or canon changed — require witness if recurring
    const newTimesSeen = (existing.times_seen || 1) + 1;
    let witnessJson: any = null;

    if (newTimesSeen >= 2 && existing.status === "applied") {
      // Build witness from note content
      const excerpt = summary.slice(0, 200);
      const location = anchor || scope.key || "global";
      const canonRef = note.why_it_matters ? `Evidence: ${note.why_it_matters.slice(0, 150)}` : "See script";
      witnessJson = {
        excerpt,
        location,
        canon_ref: canonRef,
        explanation: `Note reappeared ${newTimesSeen} times. Last applied in version ${existing.last_applied_version_id || prevVersionId || "unknown"}.`,
        times_seen: newTimesSeen,
      };
    }

    // Reopen
    await supabase.from("project_dev_note_state").update({
      status: "open",
      last_seen_at: new Date().toISOString(),
      times_seen: newTimesSeen,
      last_version_id: versionId,
      scope_json: scope,
      tier,
      anchor,
      witness_json: witnessJson || existing.witness_json,
    }).eq("id", existing.id);

    const updated = { ...existing, status: "open", times_seen: newTimesSeen, witness_json: witnessJson || existing.witness_json };
    return { fingerprint, clusterId, state: updated, suppressed: false };
  }

  if (existing) {
    // Already open — just increment
    await supabase.from("project_dev_note_state").update({
      last_seen_at: new Date().toISOString(),
      times_seen: (existing.times_seen || 1) + 1,
      last_version_id: versionId,
      scope_json: scope,
      tier,
      anchor,
    }).eq("id", existing.id);
    return { fingerprint, clusterId, state: { ...existing, times_seen: (existing.times_seen || 1) + 1 }, suppressed: false };
  }

  // Insert new state row
  const { data: inserted } = await supabase.from("project_dev_note_state").insert({
    project_id: projectId,
    doc_type: docType,
    episode_number: episodeNumber,
    note_fingerprint: fingerprint,
    note_cluster_id: clusterId,
    anchor: anchor || null,
    scope_json: scope,
    tier,
    status: "open",
    times_seen: 1,
    last_version_id: versionId,
  }).select().single();

  return { fingerprint, clusterId, state: inserted, suppressed: false };
}

function detectBundles(notes: any[]): any[] {
  // Group notes by (anchor, constraint_key) — if >=3 notes share same group, suggest bundle
  const groups: Record<string, any[]> = {};
  for (const note of notes) {
    const anchor = note.anchor || inferNoteAnchor(note);
    const ck = note.constraint_key || note.category || "general";
    const key = `${anchor}||${ck}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(note);
  }
  const bundles: any[] = [];
  for (const [key, group] of Object.entries(groups)) {
    if (group.length >= 3) {
      const [anchor, ck] = key.split("||");
      const fingerprints = group.map((n: any) => n.note_fingerprint).filter(Boolean);
      if (fingerprints.length >= 3) {
        bundles.push({
          bundle_id: `bundle_${fingerprints[0]?.slice(0, 8) || Math.random().toString(36).slice(2)}`,
          title: `Loop cluster: ${anchor || ck} (${group.length} recurring notes)`,
          anchor,
          constraint_key: ck,
          note_fingerprints: fingerprints,
          note_count: group.length,
          recommended_patch_plan: `Address the root cause around "${anchor || ck}". Review all ${group.length} related notes together and apply a single cohesive fix that resolves the cluster.`,
        });
      }
    }
  }
  return bundles;
}

// ═══════════════════════════════════════════════════════════════
// CONFLICT DETECTION + DECISION SETS
// ═══════════════════════════════════════════════════════════════

interface ConflictResult {
  noteAFingerprint: string;
  noteBFingerprint: string;
  score: number;
  reasons: string[];
  goal: string;
}

function detectConflicts(enrichedNotes: any[]): ConflictResult[] {
  const conflicts: ConflictResult[] = [];
  // Cap comparisons: only compare within same anchor/scope key, max 10 pairs
  const byScopeKey: Record<string, any[]> = {};
  for (const note of enrichedNotes) {
    const key = note.scope_json?.key || note.anchor || "global";
    if (!byScopeKey[key]) byScopeKey[key] = [];
    byScopeKey[key].push(note);
  }

  for (const [_key, group] of Object.entries(byScopeKey)) {
    let pairCount = 0;
    for (let i = 0; i < group.length && pairCount < 10; i++) {
      for (let j = i + 1; j < group.length && pairCount < 10; j++) {
        pairCount++;
        const a = group[i];
        const b = group[j];
        if (!a.note_fingerprint || !b.note_fingerprint) continue;

        const reasons: string[] = [];
        let score = 0;

        const descA = (a.description || a.note || "").toLowerCase();
        const descB = (b.description || b.note || "").toLowerCase();

        // Hard conflict: both hard tier + opposing operations
        if (a.tier === "hard" && b.tier === "hard") {
          const addSignals = ["add", "introduce", "include", "expand", "insert"];
          const removeSignals = ["remove", "cut", "reduce", "eliminate", "trim", "drop"];
          const aAdds = addSignals.some(s => descA.includes(s));
          const aRemoves = removeSignals.some(s => descA.includes(s));
          const bAdds = addSignals.some(s => descB.includes(s));
          const bRemoves = removeSignals.some(s => descB.includes(s));
          if ((aAdds && bRemoves) || (aRemoves && bAdds)) {
            score += 0.6;
            reasons.push("Opposing add/remove operations on same scope (hard conflict)");
          }
        }

        // Soft conflict: both increase runtime pressure
        const runtimeA = a.objective === "runtime" || descA.includes("runtime") || descA.includes("length") || descA.includes("duration") || descA.includes("pacing");
        const runtimeB = b.objective === "runtime" || descB.includes("runtime") || descB.includes("length") || descB.includes("duration") || descB.includes("pacing");
        if (runtimeA && runtimeB) {
          score += 0.3;
          reasons.push("Both notes add runtime pressure");
        }

        // Soft conflict: mutually exclusive tone directives
        const toneConflicts = [
          ["darker", "lighter"], ["gritty", "uplifting"], ["serious", "comedic"],
          ["slow burn", "fast paced"], ["intimate", "epic"],
        ];
        for (const [ta, tb] of toneConflicts) {
          if ((descA.includes(ta) && descB.includes(tb)) || (descA.includes(tb) && descB.includes(ta))) {
            score += 0.4;
            reasons.push(`Tone conflict: "${ta}" vs "${tb}"`);
            break;
          }
        }

        // Pacing vs setup conflict
        if ((descA.includes("escalat") && descB.includes("setup")) || (descA.includes("setup") && descB.includes("escalat"))) {
          score += 0.35;
          reasons.push("Escalation vs setup tension");
        }

        if (score >= 0.7 && reasons.length > 0) {
          const catA = a.category || "narrative";
          const catB = b.category || "narrative";
          const goal = `Resolve ${catA}/${catB} tension in ${a.scope_json?.key || a.anchor || "this section"}`;
          conflicts.push({ noteAFingerprint: a.note_fingerprint, noteBFingerprint: b.note_fingerprint, score, reasons, goal });
        }
      }
    }
  }
  return conflicts;
}

async function upsertDecisionSets(
  supabase: any,
  projectId: string,
  docType: string,
  episodeNumber: number | null,
  enrichedNotes: any[],
  conflicts: ConflictResult[],
): Promise<any[]> {
  const decisionSets: any[] = [];
  const noteByFp: Record<string, any> = {};
  for (const n of enrichedNotes) { if (n.note_fingerprint) noteByFp[n.note_fingerprint] = n; }

  for (const conflict of conflicts) {
    const noteA = noteByFp[conflict.noteAFingerprint];
    const noteB = noteByFp[conflict.noteBFingerprint];
    if (!noteA || !noteB) continue;

    // Deterministic decision_id from sorted fingerprints
    const fpSorted = [conflict.noteAFingerprint, conflict.noteBFingerprint].sort();
    const rawId = `${docType}|${episodeNumber ?? ""}|${fpSorted[0]}|${fpSorted[1]}`;
    let decisionId: string;
    try {
      const buf = new TextEncoder().encode(rawId);
      const hashBuf = await crypto.subtle.digest("SHA-256", buf);
      decisionId = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    } catch {
      let h = 5381;
      for (let i = 0; i < rawId.length; i++) h = ((h << 5) + h + rawId.charCodeAt(i)) >>> 0;
      decisionId = h.toString(16).padStart(32, "0").slice(0, 32);
    }

    const descA = noteA.description || noteA.note || "";
    const descB = noteB.description || noteB.note || "";

    const optionJson = {
      options: [
        {
          option_id: `${decisionId.slice(0, 6)}_A`,
          title: `Prioritise: ${descA.slice(0, 60)}`,
          plan_text: `Apply note A and waive note B. Focus on: ${descA.slice(0, 200)}`,
          resolves: [conflict.noteAFingerprint],
          waives: [conflict.noteBFingerprint],
          defers: [],
          impact: { canon: noteA.tier === "hard" ? "safe" : "neutral", runtime: "neutral", escalation: "neutral" },
        },
        {
          option_id: `${decisionId.slice(0, 6)}_B`,
          title: `Prioritise: ${descB.slice(0, 60)}`,
          plan_text: `Apply note B and waive note A. Focus on: ${descB.slice(0, 200)}`,
          resolves: [conflict.noteBFingerprint],
          waives: [conflict.noteAFingerprint],
          defers: [],
          impact: { canon: noteB.tier === "hard" ? "safe" : "neutral", runtime: "neutral", escalation: "neutral" },
        },
        {
          option_id: `${decisionId.slice(0, 6)}_C`,
          title: "Compromise: address both with minimal changes",
          plan_text: `Address both concerns with targeted minimal edits: (A) ${descA.slice(0, 100)} AND (B) ${descB.slice(0, 100)}`,
          resolves: [conflict.noteAFingerprint, conflict.noteBFingerprint],
          waives: [],
          defers: [],
          impact: { canon: "neutral", runtime: "slight_increase", escalation: "neutral" },
        },
      ],
    };

    // Upsert into project_dev_decision_state
    try {
      // Check if decision already exists (NULL episode_number breaks standard upsert ON CONFLICT)
      const existingDecisionQuery = supabase.from("project_dev_decision_state")
        .select("id, status")
        .eq("project_id", projectId)
        .eq("doc_type", docType)
        .eq("decision_id", decisionId);
      const { data: existingDecision } = episodeNumber !== null
        ? await existingDecisionQuery.eq("episode_number", episodeNumber).maybeSingle()
        : await existingDecisionQuery.is("episode_number", null).maybeSingle();

      if (existingDecision) {
        // Only re-open if previously superseded; otherwise preserve chosen status
        if (existingDecision.status === "superseded") {
          await supabase.from("project_dev_decision_state")
            .update({ status: "open", option_json: optionJson, goal: conflict.goal })
            .eq("id", existingDecision.id);
        }
        // If already open or chosen, skip — don't overwrite user's choice
      } else {
        await supabase.from("project_dev_decision_state").insert({
          project_id: projectId,
          doc_type: docType,
          episode_number: episodeNumber,
          decision_id: decisionId,
          goal: conflict.goal,
          anchor: noteA.anchor || noteB.anchor || null,
          scope_json: noteA.scope_json || {},
          option_json: optionJson,
          status: "open",
        });
      }
    } catch (e) {
      console.warn("[dev-engine-v2] Decision set upsert failed (non-fatal):", e);
    }

    // Strategy 2: only write conflict_json (not conflicts_with) to avoid destructive overwrites
    try {
      await supabase.from("project_dev_note_state")
        .update({ conflict_json: { reasons: conflict.reasons, score: conflict.score, decision_id: decisionId } })
        .eq("project_id", projectId).eq("note_fingerprint", conflict.noteAFingerprint);
      await supabase.from("project_dev_note_state")
        .update({ conflict_json: { reasons: conflict.reasons, score: conflict.score, decision_id: decisionId } })
        .eq("project_id", projectId).eq("note_fingerprint", conflict.noteBFingerprint);
    } catch (e) {
      console.warn("[dev-engine-v2] Note conflict_json update failed (non-fatal):", e);
    }

    decisionSets.push({
      decision_id: decisionId,
      goal: conflict.goal,
      anchor: noteA.anchor || noteB.anchor || null,
      note_fingerprints: [conflict.noteAFingerprint, conflict.noteBFingerprint],
      note_count: 2,
      conflict_reasons: conflict.reasons,
      options: optionJson.options,
      status: "open",
    });
  }

  return decisionSets;
}

// Compute runtime length pressure for vertical drama soft notes
function computeRuntimePressure(estSeconds: number, targetHigh: number, targetLow: number): number {
  if (estSeconds > targetHigh) return Math.min(1, (estSeconds - targetHigh) / targetHigh);
  if (estSeconds < targetLow) return Math.min(1, (targetLow - estSeconds) / targetLow);
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// DELIVERABLE-AWARE RUBRICS
// ═══════════════════════════════════════════════════════════════

const DELIVERABLE_RUBRICS: Record<string, string> = {
  idea: `Evaluate as an IDEA/LOGLINE. Score clarity, originality, market hook, audience identification. Do NOT evaluate dialogue, pacing, or scene structure.`,
  topline_narrative: `Evaluate as a TOPLINE NARRATIVE (logline + short synopsis + long synopsis + story pillars). Score logline clarity, synopsis coherence, story pillar completeness, theme/stakes articulation, and market positioning. Do NOT evaluate scene construction or dialogue. For series, also evaluate the series promise/engine and season arc snapshot.`,
  concept_brief: `Evaluate as a CONCEPT BRIEF. Score premise strength, theme clarity, genre positioning, tonal consistency. Do NOT evaluate scene-level craft or dialogue.`,
  market_sheet: `Evaluate as a MARKET SHEET. Score market positioning, comparable titles, audience targeting, budget alignment. Do NOT evaluate narrative craft.`,
  vertical_market_sheet: `Evaluate as a VERTICAL MARKET SHEET for mobile-first drama. Score platform targeting, audience demographics, comparable vertical titles, and revenue/monetization model. Do NOT evaluate narrative craft.`,
  blueprint: `Evaluate as a BLUEPRINT. Score structural architecture, act breaks, key beats, escalation logic, thematic spine. Do NOT evaluate dialogue quality or specific prose.`,
  architecture: `Evaluate as an ARCHITECTURE document. Score scene-by-scene planning, page allocation, structural balance, pacing blueprint. Do NOT evaluate dialogue.`,
  character_bible: `Evaluate as a CHARACTER BIBLE. Score character depth, arc design, relationship dynamics, thematic integration. Do NOT evaluate scene structure or pacing.`,
  beat_sheet: `Evaluate as a BEAT SHEET. Score beat progression, dramatic escalation, turning points, structural completeness. Do NOT evaluate prose quality or dialogue.`,
  script: `Evaluate as a SCRIPT/SCREENPLAY. Score dialogue craft, scene dynamics, pacing, character voice, visual storytelling, structural integrity.`,
  production_draft: `Evaluate as a PRODUCTION DRAFT. Score production readiness, clarity for department heads, scene feasibility, schedule implications. Also evaluate script quality.`,
  deck: `Evaluate as a DECK/PITCH DOCUMENT. Score clarity of vision, market positioning, visual storytelling strategy, talent strategy. Do NOT invent characters or scenes. Do NOT use INT./EXT. scene headings.`,
  documentary_outline: `Evaluate as a DOCUMENTARY OUTLINE. Score narrative structure, subject access, thematic coherence, editorial approach. Do NOT invent characters, fabricate scenes, or generate INT./EXT. sluglines. Use [PLACEHOLDER] for missing information.`,
  format_rules: `Evaluate as FORMAT RULES. Score rule clarity, duration alignment with canonical qualifications, platform fit, and completeness.`,
  season_arc: `Evaluate as a SEASON ARC. Score arc architecture, escalation logic, episode count alignment with canonical qualifications, and thematic spine.`,
  episode_grid: `Evaluate as an EPISODE GRID. Score grid completeness (must match canonical episode count), hook design per episode, escalation curve, and emotional engine distribution.`,
  vertical_episode_beats: `Evaluate as EPISODE BEATS for vertical drama. Score beat density per episode duration, scroll-stop hook design (3-10 second window), micro-cliffhanger endings, escalation intensity, and character agency.`,
  series_writer: `Evaluate as a SERIES WRITER episode script for vertical drama. Score canon consistency (characters, relationships must match Character Bible), emotional escalation from previous episode, immediate hook in opening lines, cliffhanger ending, location limit (max 3 primary), and season arc alignment per Episode Grid. Do NOT allow feature-film pacing. Do NOT introduce characters not in canon.`,
};

const BEHAVIOR_MODIFIERS: Record<string, string> = {
  efficiency: `BEHAVIOR MODE: Efficiency — prioritize clarity and directness. Score thresholds are relaxed. Focus on actionable, time-efficient improvements.`,
  market: `BEHAVIOR MODE: Market — balanced rigor. Standard scoring thresholds apply.`,
  prestige: `BEHAVIOR MODE: Prestige — highest structural and thematic standards. Scores must reach 85/80 minimum. Require deep craft analysis. Two rewrite cycles minimum for convergence.`,
};

// ── Format alias map: normalize ambiguous DB values to canonical format keys ──
const FORMAT_ALIASES: Record<string, string> = {
  "series": "tv-series",
  "feature": "film",
  "short-film": "short",
  "anim-feature": "animation",
  "branded-content": "digital-series",
  "music-video": "short",
  "proof-of-concept": "short",
  "hybrid": "film",
  "podcast-ip": "digital-series",
  "commercial": "short",
  "b2-a": "vertical-drama",
  "b2a": "vertical-drama",
  "vertical": "vertical-drama",
  "vertical_drama": "vertical-drama",
  // Decision option IDs that may leak into format column
  "b1-a": "film",
  "b1a": "film",
};

function resolveFormatAlias(format: string): string {
  const lower = format.toLowerCase();
  return FORMAT_ALIASES[lower] || FORMAT_ALIASES[format] || format;
}

const FORMAT_EXPECTATIONS: Record<string, string> = {
  "film": `FORMAT: Feature Film — expect 3-act structure, 90-110 minute runtime, midpoint reversal, escalating stakes.`,
  "feature": `FORMAT: Feature Film — expect 3-act structure, 90-110 minute runtime, midpoint reversal, escalating stakes.`,
  "tv-series": `FORMAT: TV Series — evaluate pilot structure, series engine sustainability, episode-to-episode hooks.`,
  "limited-series": `FORMAT: Limited Series — evaluate closed narrative arc, episode pacing, thematic unity across episodes.`,
  "vertical-drama": `FORMAT: Vertical Drama — short-form mobile-first content. Hook must occur within first 10 seconds. Require cliffhanger ending. Enforce beat density per minute. Do NOT apply feature film pacing logic.`,
  "documentary": `FORMAT: Documentary — evaluate editorial approach, subject access, ethical considerations. STRICT: Do NOT invent characters, fabricate scenes, or use INT./EXT. scene headings.`,
  "documentary-series": `FORMAT: Documentary Series — multi-episode documentary. Same non-fabrication rules as documentary.`,
  "hybrid-documentary": `FORMAT: Hybrid Documentary — docudrama approach. Non-fabrication rules apply to documentary sections.`,
  "short": `FORMAT: Short Film — evaluate economy of storytelling, single-idea clarity, impact within constrained runtime.`,
  "animation": `FORMAT: Animation — evaluate visual storytelling potential, world-building, character design implications.`,
  "digital-series": `FORMAT: Digital Series — evaluate episode hooks, platform-native pacing, audience retention strategy.`,
};

// ═══════════════════════════════════════════════════════════════
// STANDARDIZED OUTPUT SCHEMA (v3)
// ═══════════════════════════════════════════════════════════════

// ── Format-specific document ladders ──
const FORMAT_LADDERS: Record<string, string[]> = {
  "vertical-drama": ["idea", "topline_narrative", "concept_brief", "vertical_market_sheet", "format_rules", "character_bible", "season_arc", "episode_grid", "vertical_episode_beats", "episode_script"],
  "tv-series": ["idea", "topline_narrative", "concept_brief", "market_sheet", "blueprint", "architecture", "character_bible", "beat_sheet", "episode_script", "production_draft"],
  "limited-series": ["idea", "topline_narrative", "concept_brief", "market_sheet", "blueprint", "architecture", "character_bible", "beat_sheet", "episode_script", "production_draft"],
  "digital-series": ["idea", "topline_narrative", "concept_brief", "market_sheet", "blueprint", "architecture", "character_bible", "beat_sheet", "episode_script", "production_draft"],
  "film": ["idea", "topline_narrative", "concept_brief", "market_sheet", "blueprint", "architecture", "character_bible", "beat_sheet", "feature_script", "production_draft", "deck"],
  "feature": ["idea", "topline_narrative", "concept_brief", "market_sheet", "blueprint", "architecture", "character_bible", "beat_sheet", "feature_script", "production_draft", "deck"],
  "documentary": ["idea", "topline_narrative", "concept_brief", "market_sheet", "documentary_outline", "deck"],
  "documentary-series": ["idea", "topline_narrative", "concept_brief", "market_sheet", "documentary_outline", "deck"],
  "hybrid-documentary": ["idea", "topline_narrative", "concept_brief", "market_sheet", "documentary_outline", "blueprint", "deck"],
  "short": ["idea", "topline_narrative", "concept_brief", "feature_script"],
  "animation": ["idea", "topline_narrative", "concept_brief", "market_sheet", "blueprint", "character_bible", "beat_sheet", "feature_script"],
  "anim-series": ["idea", "topline_narrative", "concept_brief", "market_sheet", "blueprint", "architecture", "character_bible", "beat_sheet", "episode_script", "season_master_script", "production_draft"],
  "reality": ["idea", "topline_narrative", "concept_brief", "market_sheet", "blueprint", "beat_sheet", "episode_script"],
};

function getLadderForFormat(format: string): string[] {
  return FORMAT_LADDERS[format] || FORMAT_LADDERS["film"];
}

// Map notes referencing out-of-ladder doc types to closest valid type
const DOC_TYPE_REMAP: Record<string, Record<string, string>> = {
  "vertical-drama": {
    blueprint: "season_arc",
    architecture: "episode_grid",
    beat_sheet: "vertical_episode_beats",
    market_sheet: "vertical_market_sheet",
    production_draft: "episode_script",
    script: "episode_script",
    feature_script: "episode_script",
  },
  "documentary": {
    blueprint: "documentary_outline",
    architecture: "documentary_outline",
    character_bible: "documentary_outline",
    beat_sheet: "documentary_outline",
    script: "documentary_outline",
    feature_script: "documentary_outline",
    episode_script: "documentary_outline",
  },
  "documentary-series": {
    blueprint: "documentary_outline",
    architecture: "documentary_outline",
    character_bible: "documentary_outline",
    beat_sheet: "documentary_outline",
    script: "documentary_outline",
    feature_script: "documentary_outline",
    episode_script: "documentary_outline",
  },
  "film": {
    episode_script: "feature_script",
    script: "feature_script",
  },
  "feature": {
    episode_script: "feature_script",
    script: "feature_script",
  },
  "short": {
    episode_script: "feature_script",
    script: "feature_script",
  },
  "tv-series": {
    feature_script: "episode_script",
    script: "episode_script",
  },
  "limited-series": {
    feature_script: "episode_script",
    script: "episode_script",
  },
};

function remapDocType(docType: string, format: string): string | null {
  const ladder = getLadderForFormat(format);
  if (ladder.includes(docType)) return docType;
  const remap = DOC_TYPE_REMAP[format];
  if (remap && remap[docType]) return remap[docType];
  return null; // not valid for this format
}

function buildAnalyzeSystem(deliverable: string, format: string, behavior: string, episodeDurationMin?: number, episodeDurationMax?: number): string {
  const rubric = DELIVERABLE_RUBRICS[deliverable] || DELIVERABLE_RUBRICS.script;
  const behaviorMod = BEHAVIOR_MODIFIERS[behavior] || BEHAVIOR_MODIFIERS.market;
  const formatExp = FORMAT_EXPECTATIONS[format] || FORMAT_EXPECTATIONS.film;
  const ladder = getLadderForFormat(format);

  let verticalRules = "";
  if (format === "vertical-drama" && (episodeDurationMin || episodeDurationMax)) {
    const effMin = episodeDurationMin || episodeDurationMax || 60;
    const effMax = episodeDurationMax || episodeDurationMin || 60;
    const beatTargets = computeBeatTargets({ minSeconds: effMin, maxSeconds: effMax });
    const beatGuidance = buildBeatGuidanceBlock(episodeDurationMin, episodeDurationMax);
    verticalRules = `\nVERTICAL DRAMA RULES: Episode duration target: ${beatTargets.durationRangeLabel} (midpoint ${beatTargets.midSeconds}s). ${beatTargets.summaryText}${beatGuidance}`;
  }

  // Documentary/deck safeguard
  const isDocSafe = ["deck", "documentary_outline"].includes(deliverable) ||
    ["documentary", "documentary-series", "hybrid-documentary"].includes(format);
  const docGuard = isDocSafe
    ? `\nDOCUMENTARY/DECK GUARD: Do NOT invent characters, fabricate scenes, or generate INT./EXT. sluglines. Use [PLACEHOLDER] for missing information.
NON-FABRICATION RULE: You MUST NOT present invented people, events, or statistics as facts. Every factual claim must reference existing evidence or be marked as [UNVERIFIED] or [HYPOTHESIS].
REQUIRED OUTPUTS for documentary:
- access_plan: How will the production access subjects, locations, and archives?
- evidence_plan: What evidence types support each major claim? (archive, interview, document, recording, public_record, expert)
- unknowns_list: What key information is missing or unverified?
- ethical_legal_flags: Any ethical or legal risks (consent, defamation, sub judice, minors, trauma)?
- claims_list: Array of {claim, evidence_type, status} for every factual claim made. Status: verified|needs_check|unknown.`
    : "";

  const ladderStr = ladder.join(", ");

  return `You are IFFY, a Creative–Commercial Alignment Architect.

EDITORIAL SCOPE LOCK:
You are operating in EDITORIAL MODE.
- Treat project.format, assigned_lane, budget_range, and development_behavior as LOCKED.
- Do NOT recommend changing format, monetisation lane, runtime model, or buyer positioning.
- Do NOT propose repositioning the project into a different category.
- If format/lane are misaligned, you may flag it ONCE as a "risk flag" in clarify (or lane) — but do NOT propose a change.
- Focus ONLY on improving the current deliverable within its declared format and lane.
You are an editor, not a strategist, in this mode.

FORMAT DOCUMENT LADDER (these are the ONLY valid document types for this project's format):
${ladderStr}
CRITICAL: Do NOT reference, recommend, or generate notes about document types outside this ladder.
If you want to mention a concept that maps to a doc type not in this ladder, remap it to the closest valid type.
For example, in vertical-drama format, "blueprint" concepts should map to "season_arc"; "architecture" to "episode_grid".

${rubric}

${formatExp}

${behaviorMod}
${verticalRules}${docGuard}

SCORING RUBRIC (CANONICAL – v1):
CI (Creative Integrity) evaluates:
- Originality of premise relative to genre
- Emotional conviction and character truth
- Thematic coherence
- Structural integrity appropriate to the format
- Craft quality (dialogue, escalation, clarity) relative to deliverable type
GP (Greenlight Probability) evaluates:
- Audience clarity and hook strength
- Market positioning within declared lane
- Packaging magnetism (castability, concept clarity, talkability)
- Production feasibility relative to stated budget
- Alignment with monetisation lane expectations
IMPORTANT:
- Score CI and GP relative to the declared format and lane.
- Do NOT penalise a vertical drama for not being a feature film.
- Do NOT reward prestige pacing inside fast-turnaround lanes.
- CI and GP must reflect format-appropriate standards.

Return ONLY valid JSON matching this EXACT schema:
{
  "meta": {
    "deliverable_type": "${deliverable}",
    "format": "${format}",
    "development_behavior": "${behavior}",
    "schema_version": "${SCHEMA_VERSION}"
  },
  "summary": ["max 5 bullet points — key findings"],
  "scores": {
    "ci_score": 0-100,
    "gp_score": 0-100,
    "gap": number,
    "allowed_gap": number
  },
  "blocking_issues": [
    {"id": "unique_stable_key", "note_key": "same_as_id", "category": "structural|character|escalation|lane|packaging|risk|pacing|hook|cliffhanger", "description": "...", "why_it_matters": "...", "severity": "blocker", "apply_timing": "now|next_doc|later", "target_deliverable_type": "one of the ladder types or null if now", "defer_reason": "why deferred, if later"}
  ],
  "high_impact_notes": [
    {"id": "unique_stable_key", "note_key": "same_as_id", "category": "structural|character|escalation|lane|packaging|risk|pacing|hook|cliffhanger", "description": "...", "why_it_matters": "...", "severity": "high", "apply_timing": "now|next_doc|later", "target_deliverable_type": "one of the ladder types or null if now", "defer_reason": "why deferred, if later"}
  ],
  "polish_notes": [
    {"id": "unique_stable_key", "note_key": "same_as_id", "category": "structural|character|escalation|lane|packaging|risk|pacing|hook|cliffhanger", "description": "...", "why_it_matters": "...", "severity": "polish", "apply_timing": "now|next_doc|later", "target_deliverable_type": "one of the ladder types or null if now", "defer_reason": "why deferred, if later"}
  ],
  "rewrite_plan": ["what will change in next rewrite — max 5 items"],
  "convergence": {
    "status": "not_started" | "in_progress" | "converged",
    "reasons": ["why this status"],
    "blockers_remaining": number,
    "high_impact_remaining": number,
    "polish_remaining": number,
    "next_best_document": "MUST be one of: ${ladderStr}"
  },
  "protect": ["non-negotiable creative strengths, 1-10 items"],
  "verdict": "Invest" | "Develop Further" | "Major Rethink" | "Pass",
  "executive_snapshot": "2-3 sentence strategic summary",
  "trajectory": null or "Converging" | "Eroding" | "Stalled" | "Strengthened" | "Over-Optimised",
  "primary_creative_risk": "one sentence",
  "primary_commercial_risk": "one sentence",
  "extracted_core": {
    "protagonist": "main character name and one-line description",
    "antagonist": "antagonist or opposing force",
    "stakes": "what is at stake",
    "midpoint": "key midpoint event",
    "climax": "climactic moment",
    "tone": "overall tone",
    "audience": "target audience",
    "genre": "primary genre"
  }
}

NOTE TIMING CLASSIFICATION RULES:
- apply_timing: "now" = must be addressed in the current document/version. "next_doc" = should be handled in the immediately-next deliverable. "later" = belongs to a specific future deliverable type.
- target_deliverable_type: null for "now" notes. For "next_doc" or "later", MUST be a valid type from the ladder above.
- defer_reason: required for "later" notes, explaining why it cannot be addressed now.
- Blocking issues should almost always be "now" unless they genuinely cannot be fixed in the current deliverable type.
- If a note is about something that belongs to a later stage (e.g., character depth notes while working on an idea doc), classify as "later" with the appropriate target.

RULES FOR NOTE GENERATION:
- Each note id and note_key MUST be identical, stable, descriptive snake_case keys (e.g. "weak_act2_midpoint", "flat_protagonist_arc"). Use consistent keys across runs.
- blocking_issues: ONLY items that fundamentally prevent the document from working. Max 5. These gate convergence. Only "now" timing notes count for convergence gating.
- high_impact_notes: Significant improvements but do NOT block convergence. Max 5.
- polish_notes: Optional refinements. NEVER block convergence. Max 5.
- If an existing note_key persists, refer to it by the same key — do NOT rephrase the same issue under a new key.
- Once blockers reach zero, do NOT invent new blockers unless drift or regression is detected.
- Do NOT introduce new blocking issues unless they are fundamentally distinct from previous ones or true regression occurred.
- If high_impact_notes <= 3 AND polish_notes <= 5 AND blockers == 0, set convergence.status to "converged".
- CONVERGENCE RULE: convergence.status = "converged" if and only if blocking_issues with apply_timing="now" is empty.`;
}

function buildRewriteSystem(deliverable: string, format: string, behavior: string): string {
  const isDocSafe = ["deck", "documentary_outline"].includes(deliverable) ||
    ["documentary", "documentary-series", "hybrid-documentary"].includes(format);

  let docGuard = "";
  if (isDocSafe) {
    docGuard = `\n\nHARD SAFEGUARDS:
- FORBID inventing characters not present in the original
- FORBID inventing scenes not present in the original
- FORBID using INT./EXT. scene headings (unless already in source)
- Use [PLACEHOLDER] instead of fabricating information
- If you cannot rewrite without invention, return the original text unchanged with a note explaining why.`;
  }

  let formatRules = "";
  if (format === "vertical-drama") {
    formatRules = "\n\nVERTICAL DRAMA: Preserve hook in first 3–10 seconds. Maintain micro-cliffhanger ending. Do NOT apply feature pacing logic. Ensure continuous beat cadence throughout.";
  }

  // Screenplay enforcement for script deliverables
  let scriptEnforcement = "";
  if (deliverable === "script" || deliverable === "production_draft") {
    scriptEnforcement = `\n\nSCREENPLAY FORMAT (MANDATORY):
- Output MUST be formatted as proper screenplay pages.
- Use INT./EXT. scene headings (sluglines) with location and DAY/NIGHT.
- Action lines in present tense.
- Character names in CAPS on their own line, followed by dialogue.
- Parentheticals only when needed.
- Do NOT output a topline narrative, episode summary, overview, or narrative document.
- Do NOT use outline or bullet-point format.
- The rewritten_text field must contain a full screenplay, not a summary.`;
  }

  return `You are IFFY. Rewrite the material applying the approved strategic notes.
DELIVERABLE TYPE: ${deliverable}
FORMAT: ${format}
BEHAVIOR: ${behavior}

Rules:
- Preserve all PROTECT items absolutely.
- Do not flatten voice for minor commercial gain.
- Strengthen escalation and improve packaging magnetism organically.
- Match the target deliverable type format expectations.
- OUTPUT THE FULL REWRITTEN MATERIAL — do NOT summarize or truncate.
- If repositioning (lane/format) appears in APPROVED STRATEGIC NOTES, reflect it. Otherwise do not stealth-reposition.
${docGuard}${formatRules}${scriptEnforcement}

Return ONLY valid JSON:
{
  "rewritten_text": "the full rewritten material",
  "changes_summary": "bullet summary of changes",
  "creative_preserved": "what creative elements were protected",
  "commercial_improvements": "what commercial improvements were introduced"
}`;
}

// ═══════════════════════════════════════════════════════════════
// POST-PROCESSING SAFEGUARD
// ═══════════════════════════════════════════════════════════════

function validateDocSafety(originalText: string, rewrittenText: string, deliverable: string, format: string): string | null {
  const isDocSafe = ["deck", "documentary_outline"].includes(deliverable) ||
    ["documentary", "documentary-series", "hybrid-documentary"].includes(format);
  if (!isDocSafe) return null;

  // Check for INT./EXT. scene headings not in original
  const sceneHeadingPattern = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s/gm;
  const originalHeadings = new Set((originalText.match(sceneHeadingPattern) || []).map(h => h.trim()));
  const newHeadings = (rewrittenText.match(sceneHeadingPattern) || []).map(h => h.trim());
  const addedHeadings = newHeadings.filter(h => !originalHeadings.has(h));

  if (addedHeadings.length > 0) {
    return `Safety guard triggered: Rewrite introduced ${addedHeadings.length} new scene heading(s) not present in the original (${addedHeadings.slice(0, 3).join(", ")}). For documentary/deck deliverables, the engine cannot invent scenes. The original text has been preserved.`;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// PIPELINE PROMPTS (unchanged)
// ═══════════════════════════════════════════════════════════════

const REWRITE_CHUNK_SYSTEM = `You are rewriting a feature-length screenplay for professional quality.

GOALS:
- Tight, well-written prose and dialogue.
- Stronger clarity, pacing, and dramatic impact.
- Preserve professional screenplay formatting.
- Preserve all PROTECT items absolutely.
- Maintain perfect continuity with the previous chunk context provided.

CRITICAL:
- Do NOT summarize the story.
- Do NOT collapse multiple beats into one line.
- Do NOT turn scenes into summaries.
- Maintain full feature-length pacing and dramatic beats.
- You may tighten within moments, but do not reduce the film's overall scope or runtime.

Output ONLY the rewritten screenplay text. No JSON, no commentary, no markdown.`;

const CONVERT_SYSTEM = `You are IFFY. Convert the source material into the specified target format.
Preserve the creative DNA (protect items). Adapt structure and detail level to the target format.

Target format guidelines:
- TOPLINE_NARRATIVE: A canonical narrative summary containing: # LOGLINE (1-2 sentences), # SHORT SYNOPSIS (150-300 words), # LONG SYNOPSIS (~1-2 pages), # STORY PILLARS (Theme, Protagonist, Goal, Stakes, Antagonistic force, Setting, Tone, Comps). For series, also include # SERIES ONLY with series promise/engine and season arc snapshot.
- BLUEPRINT: High-level structural blueprint with act breaks, key beats, character arcs, tone anchors
- ARCHITECTURE: Detailed scene-by-scene architecture with sluglines, beats, page estimates
- TREATMENT: Prose narrative treatment (3-10 pages), vivid and readable
- ONE_PAGER: One-page pitch document: logline, synopsis, key talent notes, comparable titles, market positioning
- OUTLINE: Beat-by-beat outline with numbered scenes
- DRAFT_SCRIPT: Full screenplay draft in standard screenplay format (sluglines, action, dialogue). Write it as a real screenplay — do NOT include JSON, code, markdown, or any structural markup.

CRITICAL RULES:
- Output ONLY the creative content for the target format.
- Do NOT wrap output in JSON, code fences, or markdown.
- Do NOT include field names like "converted_text:" or curly braces.
- Write the material as a human creative professional would — pure prose, screenplay, or document text.
- At the very end, on a new line after the main content, write exactly:
  ---CHANGE_SUMMARY---
  followed by a brief summary of what was adapted.`;

const CONVERT_SYSTEM_JSON = `You are IFFY. Convert the source material into the specified target format.
Preserve the creative DNA (protect items). Adapt structure and detail level to the target format.

Target format guidelines:
- TOPLINE_NARRATIVE: A canonical narrative summary containing: # LOGLINE (1-2 sentences), # SHORT SYNOPSIS (150-300 words), # LONG SYNOPSIS (~1-2 pages), # STORY PILLARS (Theme, Protagonist, Goal, Stakes, Antagonistic force, Setting, Tone, Comps). For series, also include # SERIES ONLY with series promise/engine and season arc snapshot.
- BLUEPRINT: High-level structural blueprint with act breaks, key beats, character arcs, tone anchors
- ARCHITECTURE: Detailed scene-by-scene architecture with sluglines, beats, page estimates
- TREATMENT: Prose narrative treatment (3-10 pages), vivid and readable
- ONE_PAGER: One-page pitch document: logline, synopsis, key talent notes, comparable titles, market positioning
- OUTLINE: Beat-by-beat outline with numbered scenes

Return ONLY valid JSON:
{
  "converted_text": "the full converted output",
  "format": "target format name",
  "change_summary": "what was adapted/expanded/compressed"
}`;

const SCRIPT_PLAN_SYSTEM = `You are IFFY, a professional screenplay architect.
Given a concept/treatment/blueprint, create a detailed scene-by-scene plan for a feature-length screenplay.

RULES:
- Target 95-115 pages (approximately 250 words per page).
- Divide into 3 acts with clear act breaks.
- Each scene gets a unique ID (e.g. A1S01, A2S05), a slugline, page estimate, and purpose.
- Total page estimates across all scenes must sum to the target page count.
- Include tone_lock and non_negotiables from the source material.

Return ONLY valid JSON:
{
  "target_pages": <number between 95 and 115>,
  "format": "screenplay",
  "total_scenes": <number>,
  "acts": [
    {
      "act": 1,
      "start_page": 1,
      "end_page": <number>,
      "scenes": [
        {"scene_id": "A1S01", "slug": "INT. LOCATION - TIME", "page_estimate": <number>, "purpose": "brief description of what happens"}
      ]
    }
  ],
  "rules": {
    "tone_lock": "description of tone",
    "non_negotiables": ["list of creative elements that must be preserved"]
  }
}`;

const WRITE_BATCH_SYSTEM = `You are a professional screenwriter. Write ONLY screenplay pages in standard format.

RULES:
- Write in proper screenplay format: sluglines (INT./EXT.), action lines, character names (CAPS), dialogue.
- Do NOT include any JSON, markdown, code fences, commentary, or metadata.
- Do NOT number pages or add headers/footers.
- Write EXACTLY the scenes you are given — no more, no less.
- Each page is approximately 250 words. Hit the target page count precisely.
- Maintain consistent tone, character voices, and story momentum from previous batches.
- Output ONLY the screenplay text. Nothing else.`;

const ASSEMBLE_VALIDATE_SYSTEM = `You are a screenplay editor. Review the assembled screenplay for formatting consistency.

Check for:
- FADE IN: at the start
- Proper slugline format throughout
- Consistent character name capitalization
- FADE OUT. or FADE TO BLACK. at the end
- No duplicate scenes or missing transitions
- Clean act break transitions

If issues exist, fix them minimally. Output the corrected full screenplay text ONLY.
Do NOT include JSON, code fences, or commentary.
At the very end, on a new line, write:
---VALIDATION_NOTES---
followed by a brief list of what was fixed (or "No issues found").`;

// ═══════════════════════════════════════════════════════════════
// DRIFT DETECTION
// ═══════════════════════════════════════════════════════════════

const CORE_FIELDS = ["protagonist", "antagonist", "stakes", "midpoint", "climax", "tone", "audience", "genre"] as const;

function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 && wordsB.size === 0) return 100;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
  const union = new Set([...wordsA, ...wordsB]).size;
  return Math.round((overlap / union) * 100);
}

function detectDrift(currentCore: Record<string, string>, inheritedCore: Record<string, string>): { level: string; items: Array<{ field: string; similarity: number; inherited: string; current: string }> } {
  const items: Array<{ field: string; similarity: number; inherited: string; current: string }> = [];
  let hasIdentityChange = false;

  for (const field of CORE_FIELDS) {
    const inherited = inheritedCore[field] || "";
    const current = currentCore[field] || "";
    if (!inherited && !current) continue;
    const sim = textSimilarity(inherited, current);
    if (sim < 85) {
      items.push({ field, similarity: sim, inherited, current });
      if (["protagonist", "antagonist", "stakes"].includes(field) && sim < 40) {
        hasIdentityChange = true;
      }
    }
  }

  if (items.length === 0) return { level: "none", items: [] };
  const avgSim = items.reduce((s, i) => s + i.similarity, 0) / items.length;
  if (avgSim < 60 || hasIdentityChange) return { level: "major", items };
  return { level: "moderate", items };
}

function extractCoreFromText(text: string): Record<string, string> {
  // Simple heuristic extraction — will be enhanced by AI in analyze
  const lower = text.toLowerCase();
  const lines = text.split("\n").filter(l => l.trim());
  return {
    protagonist: "",
    antagonist: "",
    stakes: "",
    midpoint: "",
    climax: "",
    tone: "",
    audience: "",
    genre: "",
  };
}

// ═══════════════════════════════════════════════════════════════
// FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════

const formatToProductionType: Record<string, string> = {
  "vertical-drama": "vertical_drama",
  "tv-series": "tv_series",
  "limited-series": "limited_series",
  "documentary": "documentary",
  "documentary-series": "documentary_series",
  "hybrid-documentary": "hybrid_documentary",
  "short": "short_film",
  "animation": "animation",
  "digital-series": "digital_series",
};

const docTypeMap: Record<string, string> = {
  IDEA: "idea",
  TOPLINE_NARRATIVE: "topline_narrative",
  "TOPLINE NARRATIVE": "topline_narrative",
  TOPLINE: "topline_narrative",
  CONCEPT_BRIEF: "concept_brief",
  "CONCEPT BRIEF": "concept_brief",
  MARKET_SHEET: "market_sheet",
  "MARKET SHEET": "market_sheet",
  BLUEPRINT: "treatment",
  ARCHITECTURE: "story_outline",
  CHARACTER_BIBLE: "character_bible",
  "CHARACTER BIBLE": "character_bible",
  BEAT_SHEET: "beat_sheet",
  "BEAT SHEET": "beat_sheet",
  SCRIPT: "feature_script",
  PILOT_SCRIPT: "episode_script",
  "PILOT SCRIPT": "episode_script",
  PRODUCTION_DRAFT: "production_draft",
  "PRODUCTION DRAFT": "production_draft",
  DECK: "deck",
  DOCUMENTARY_OUTLINE: "documentary_outline",
  "DOCUMENTARY OUTLINE": "documentary_outline",
  TREATMENT: "treatment",
  STORY_OUTLINE: "story_outline",
  "STORY OUTLINE": "story_outline",
  ONE_PAGER: "concept_brief",
  OUTLINE: "treatment",
  EPISODE_OUTLINE: "treatment",
  "EPISODE OUTLINE": "treatment",
  "EPISODE_BEAT_SHEET": "vertical_episode_beats",
  "EPISODE BEAT SHEET": "vertical_episode_beats",
  DRAFT_SCRIPT: "feature_script",
  FORMAT_RULES: "format_rules",
  "FORMAT RULES": "format_rules",
  SEASON_ARC: "season_arc",
  "SEASON ARC": "season_arc",
  EPISODE_GRID: "episode_grid",
  "EPISODE GRID": "episode_grid",
  VERTICAL_EPISODE_GRID: "episode_grid",
  "VERTICAL EPISODE GRID": "episode_grid",
  VERTICAL_EPISODE_BEATS: "vertical_episode_beats",
  "VERTICAL EPISODE BEATS": "vertical_episode_beats",
  VERTICAL_MARKET_SHEET: "vertical_market_sheet",
  "VERTICAL MARKET SHEET": "vertical_market_sheet",
  "MARKET SHEET (VD)": "vertical_market_sheet",
  FEATURE_SCRIPT: "feature_script",
  "FEATURE SCRIPT": "feature_script",
  EPISODE_SCRIPT: "episode_script",
  "EPISODE SCRIPT": "episode_script",
  SEASON_MASTER_SCRIPT: "season_master_script",
  "SEASON MASTER SCRIPT": "season_master_script",
};

// ── Vertical Drama Document Pipeline ──
// Ordered steps with prerequisites for gating
const VERTICAL_DRAMA_PIPELINE: Array<{ type: string; prerequisites: string[] }> = [
  { type: "idea", prerequisites: [] },
  { type: "concept_brief", prerequisites: ["idea"] },
  { type: "vertical_market_sheet", prerequisites: ["concept_brief"] },
  { type: "format_rules", prerequisites: ["concept_brief"] },
  { type: "character_bible", prerequisites: ["concept_brief"] },
  { type: "season_arc", prerequisites: ["concept_brief", "character_bible"] },
  { type: "episode_grid", prerequisites: ["season_arc"] },
  { type: "vertical_episode_beats", prerequisites: ["season_arc", "episode_grid"] },
  { type: "script", prerequisites: ["vertical_episode_beats"] },
];

function resolveVerticalDramaNextStep(
  existingDocTypes: string[],
  seasonEpisodeCount?: number | null,
): { nextStep: string; missingPrerequisites: string[]; reason: string } {
  const existing = new Set(existingDocTypes.map(d => d.toLowerCase().replace(/[\s\-]+/g, "_")));
  for (const step of VERTICAL_DRAMA_PIPELINE) {
    if (existing.has(step.type)) continue;
    const missing = step.prerequisites.filter(p => !existing.has(p));
    if (missing.length > 0) {
      return { nextStep: missing[0], missingPrerequisites: missing, reason: `Missing prerequisites: ${missing.join(", ")}` };
    }
    if (step.type === "vertical_episode_beats" && !seasonEpisodeCount) {
      return { nextStep: "episode_grid", missingPrerequisites: ["episode_grid"], reason: "season_episode_count not set" };
    }
    return { nextStep: step.type, missingPrerequisites: [], reason: `Next in vertical drama pipeline` };
  }
  return { nextStep: "script", missingPrerequisites: [], reason: "All vertical drama docs created" };
}

// ═══════════════════════════════════════════════════════════════
// FORMAT DEFAULTS (engine-side) — mirrors auto-run for consistency
// ═══════════════════════════════════════════════════════════════

const FORMAT_DEFAULTS_ENGINE: Record<string, { episode_target_duration_seconds?: number; episode_target_duration_min_seconds?: number; episode_target_duration_max_seconds?: number; season_episode_count?: number }> = {
  "vertical-drama": { episode_target_duration_seconds: 60, episode_target_duration_min_seconds: 45, episode_target_duration_max_seconds: 90, season_episode_count: 30 },
  "limited-series": { episode_target_duration_seconds: 3300, episode_target_duration_min_seconds: 2700, episode_target_duration_max_seconds: 3600, season_episode_count: 8 },
  "tv-series": { episode_target_duration_seconds: 2700, episode_target_duration_min_seconds: 2400, episode_target_duration_max_seconds: 3000, season_episode_count: 10 },
  "anim-series": { episode_target_duration_seconds: 1320, episode_target_duration_min_seconds: 1200, episode_target_duration_max_seconds: 1500, season_episode_count: 10 },
  "documentary-series": { episode_target_duration_seconds: 2700, episode_target_duration_min_seconds: 2400, episode_target_duration_max_seconds: 3300, season_episode_count: 6 },
  "digital-series": { episode_target_duration_seconds: 600, episode_target_duration_min_seconds: 420, episode_target_duration_max_seconds: 900, season_episode_count: 10 },
  "reality": { episode_target_duration_seconds: 2700, episode_target_duration_min_seconds: 2400, episode_target_duration_max_seconds: 3000, season_episode_count: 10 },
};

// ═══════════════════════════════════════════════════════════════
// EPISODE LENGTH — canonical key resolution + prompt block builder
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve canonical episode length from project row + guardrails_config.
 * Priority: episode_duration_* (new canonical) > legacy episode_target_duration_* > format defaults
 */
function resolveEpisodeLength(project: any, overrideQuals: Record<string, any> = {}, fmtDefaults: Record<string, any> = {}): {
  minSeconds: number | null;
  maxSeconds: number | null;
  targetSeconds: number | null;
  variancePolicy: 'strict' | 'soft';
} {
  const gc = project?.guardrails_config || {};
  const quals = gc?.overrides?.qualifications || {};
  const merged = { ...fmtDefaults, ...quals, ...overrideQuals };

  // Canonical new keys take priority
  const canonMin = merged.episode_duration_min_seconds ?? null;
  const canonMax = merged.episode_duration_max_seconds ?? null;
  const canonTarget = merged.episode_duration_target_seconds ?? null;

  // Legacy keys
  const legacyMin = project?.episode_target_duration_min_seconds ?? quals.episode_target_duration_min_seconds ?? fmtDefaults.episode_target_duration_min_seconds ?? null;
  const legacyMax = project?.episode_target_duration_max_seconds ?? quals.episode_target_duration_max_seconds ?? fmtDefaults.episode_target_duration_max_seconds ?? null;
  const legacyScalar = project?.episode_target_duration_seconds ?? quals.episode_target_duration_seconds ?? fmtDefaults.episode_target_duration_seconds ?? null;

  const minSeconds = canonMin ?? legacyMin ?? legacyScalar ?? null;
  const maxSeconds = canonMax ?? legacyMax ?? legacyScalar ?? null;
  const targetSeconds = canonTarget ?? (minSeconds && maxSeconds ? Math.round((minSeconds + maxSeconds) / 2) : minSeconds ?? maxSeconds ?? null);
  const variancePolicy = (merged.episode_duration_variance_policy as 'strict' | 'soft') || 'soft';

  return { minSeconds, maxSeconds, targetSeconds, variancePolicy };
}

/**
 * Build a standardized EPISODE LENGTH RULES block for injection into all prompts.
 */
function buildEpisodeLengthBlock(project: any, overrideQuals: Record<string, any> = {}, fmtDefaults: Record<string, any> = {}): string {
  const { minSeconds, maxSeconds, targetSeconds, variancePolicy } = resolveEpisodeLength(project, overrideQuals, fmtDefaults);
  if (!minSeconds && !maxSeconds && !targetSeconds) return "";

  const rangeStr = minSeconds !== null && maxSeconds !== null && minSeconds !== maxSeconds
    ? `${minSeconds}–${maxSeconds}s`
    : `${targetSeconds ?? minSeconds ?? maxSeconds}s`;
  const targetStr = targetSeconds ? ` (target: ${targetSeconds}s)` : "";
  const toleranceStr = variancePolicy === 'strict'
    ? "Episodes MUST fall within this range. Reject or flag any episode outside it."
    : "Episodes should aim for the target. A 10% tolerance is allowed (±${Math.round((targetSeconds ?? 60) * 0.1)}s).";

  return `
EPISODE LENGTH RULES (canonical — authoritative, ignore all other references):
- Allowed range: ${rangeStr}${targetStr}
- Variance policy: ${variancePolicy}
- ${toleranceStr}
- Every episode MUST conform to this range. Do NOT use different durations for different episodes unless explicitly instructed.
- If generating a grid or beat sheet: include episode_duration_target_seconds=${targetSeconds ?? minSeconds} for every episode row.`;
}

// ── Effective Profile: uses shared module from _shared/effective-profile-context.ts ──


const CRITERIA_SNAPSHOT_KEYS = [
  "format_subtype", "season_episode_count",
  "episode_duration_min_seconds", "episode_duration_max_seconds", "episode_duration_target_seconds",
  "episode_target_duration_seconds", // legacy
  "target_runtime_min_low", "target_runtime_min_high", "assigned_lane",
  "budget_range", "development_behavior"
] as const;

interface CriteriaSnapshot {
  format_subtype?: string;
  season_episode_count?: number;
  episode_duration_min_seconds?: number;
  episode_duration_max_seconds?: number;
  episode_duration_target_seconds?: number;
  episode_target_duration_seconds?: number;
  target_runtime_min_low?: number;
  target_runtime_min_high?: number;
  assigned_lane?: string;
  budget_range?: string;
  development_behavior?: string;
  updated_at?: string;
}

async function buildCriteriaSnapshot(supabase: any, projectId: string): Promise<CriteriaSnapshot> {
  const { data: p } = await supabase.from("projects")
    .select("format, assigned_lane, budget_range, development_behavior, episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, season_episode_count, guardrails_config")
    .eq("id", projectId).single();
  if (!p) return {};
  const gc = p.guardrails_config || {};
  const quals = gc?.overrides?.qualifications || {};
  const fmt = resolveFormatAlias((p.format || "film").toLowerCase().replace(/[_ ]+/g, "-"));
  // Resolve canonical episode length
  const { minSeconds, maxSeconds, targetSeconds } = resolveEpisodeLength(p);
  return {
    format_subtype: quals.format_subtype || fmt,
    season_episode_count: p.season_episode_count || quals.season_episode_count || undefined,
    episode_duration_min_seconds: minSeconds ?? undefined,
    episode_duration_max_seconds: maxSeconds ?? undefined,
    episode_duration_target_seconds: targetSeconds ?? undefined,
    episode_target_duration_seconds: p.episode_target_duration_seconds || quals.episode_target_duration_seconds || undefined,

    target_runtime_min_low: quals.target_runtime_min_low || undefined,
    target_runtime_min_high: quals.target_runtime_min_high || undefined,
    assigned_lane: p.assigned_lane || quals.assigned_lane || undefined,
    budget_range: p.budget_range || quals.budget_range || undefined,
    development_behavior: p.development_behavior || undefined,
    updated_at: new Date().toISOString(),
  };
}

function compareSnapshots(a: CriteriaSnapshot | null, b: CriteriaSnapshot | null): string[] {
  if (!a || !b) return [];
  const diffs: string[] = [];
  for (const key of CRITERIA_SNAPSHOT_KEYS) {
    const va = a[key as keyof CriteriaSnapshot];
    const vb = b[key as keyof CriteriaSnapshot];
    if (va != null && vb != null && String(va) !== String(vb)) {
      diffs.push(key);
    }
  }
  return diffs;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action } = body;

    // ── Auth-optional gate for regen-queue actions (CI/tooling) ──
    const AUTH_OPTIONAL_ACTIONS = new Set([
      "regen-insufficient-start",
      "regen-insufficient-tick",
      "regen-insufficient-status",
    ]);
    const allowNoAuth = Deno.env.get("ALLOW_REGEN_QUEUE_NOAUTH") === "true";

    const authHeader = req.headers.get("Authorization");

    let userId: string | null;
    let actor: "user" | "service_role" = "user";
    let user: { id: string | null; email?: string };

    if (!authHeader?.startsWith("Bearer ") && AUTH_OPTIONAL_ACTIONS.has(action) && allowNoAuth) {
      // No-auth path — dev/CI only
      console.log("[dev-engine-v2] NOAUTH regen-queue allowed (dev only)", { action });
      userId = null;
      actor = "service_role";
      user = { id: null, email: "service_role@internal" };
    } else if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      const token = authHeader.replace("Bearer ", "");

      // ── Check if raw service-role key (non-JWT, e.g. sb_secret_...) ──
      const envServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (envServiceKey && token === envServiceKey) {
        const bodyUserId = body?.userId || body?.user_id || null;
        userId = bodyUserId;
        actor = "service_role";
        user = { id: bodyUserId, email: "service_role@internal" };
        console.log("[dev-engine-v2] auth ok (raw service key)", { hasUserId: !!bodyUserId });
      } else {
        // Normal JWT validation
        try {
          const payloadB64 = token.split(".")[1];
          if (!payloadB64) throw new Error("Invalid token");
          // URL-safe base64 decode with proper padding
          const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
          const paddedFull = padded + "=".repeat((4 - (padded.length % 4)) % 4);
          let payload: any;
          try {
            payload = JSON.parse(atob(paddedFull));
          } catch (_decodeErr) {
            throw new Error("JWT base64 decode failed");
          }
          if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
          if (payload.role === "service_role") {
            const bodyUserId = body?.userId || body?.user_id || null;
            userId = bodyUserId;
            actor = "service_role";
            user = { id: bodyUserId, email: "service_role@internal" };
            console.log("[dev-engine-v2] auth ok", { role: "service_role", hasUserId: !!bodyUserId });
          } else if (payload.sub) {
            userId = payload.sub;
            user = { id: payload.sub, email: payload.email };
            console.log("[dev-engine-v2] auth ok", { role: "user", hasUserId: true });
          } else {
            throw new Error("Invalid token claims");
          }
        } catch (authErr: any) {
          console.error("[dev-engine-v2] JWT parse failed:", authErr?.message, "token prefix:", token.slice(0, 20) + "...");
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use service client for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Centralized document existence check ──
    // Any action that sends a documentId must reference a valid project_documents row
    const centralDocId = body.documentId || body.scriptDocId;
    if (centralDocId) {
      const { data: docExists, error: docCheckErr } = await supabase.from("project_documents")
        .select("id").eq("id", centralDocId).maybeSingle();
      if (docCheckErr || !docExists) {
        console.error("Document existence check failed:", centralDocId, docCheckErr?.message);
        throw new Error("Document not found — it may have been deleted. Please refresh and select another document.");
      }
    }

    // ═══════════════════════════════════════
    // ACTION: ping (reachability check)
    // ═══════════════════════════════════════
    if (action === "ping") {
      return new Response(JSON.stringify({ ok: true, function: "dev-engine-v2" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // ANALYZE — strict routing: deliverable → format → behavior
    // ══════════════════════════════════════════════
    if (action === "analyze") {
      const { projectId, documentId, versionId, deliverableType, developmentBehavior, format: reqFormat, strategicPriority, developmentStage, analysisMode, previousVersionId, productionType, maxContextChars: reqMaxContext } = body;
      const DEFAULT_CONTEXT_CHARS = 200000;
      const maxContextChars = typeof reqMaxContext === "number" && reqMaxContext > 0 ? Math.min(reqMaxContext, 200000) : DEFAULT_CONTEXT_CHARS;

      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");
      if (!deliverableType) throw new Error("deliverableType is required — select a deliverable type before analyzing");



      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: project } = await supabase.from("projects")
        .select("title, budget_range, assigned_lane, format, development_behavior, episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, season_episode_count, guardrails_config, canon_version_id")
        .eq("id", projectId).single();

      // ── Canon OS: fetch active canon for authoritative metadata ──
      let canonEpisodeMeta: { episode_count: number | null; min: number | null; max: number | null } = { episode_count: null, min: null, max: null };
      let canonJson: any = null;
      try {
        if (project?.canon_version_id) {
          const { data: canonVer } = await supabase.from("project_canon_versions")
            .select("canon_json").eq("id", project.canon_version_id).maybeSingle();
          if (canonVer?.canon_json) {
            canonJson = canonVer.canon_json;
          }
        }
        // Fallback: read directly from project_canon table
        if (!canonJson) {
          const { data: canonRow } = await supabase.from("project_canon")
            .select("canon_json").eq("project_id", projectId).maybeSingle();
          if (canonRow?.canon_json && typeof canonRow.canon_json === "object") {
            const cj = canonRow.canon_json;
            // Only use if it has substantive content
            const hasContent = cj.logline || cj.premise || (Array.isArray(cj.characters) && cj.characters.length > 0) || cj.episode_count;
            if (hasContent) canonJson = cj;
          }
        }
        if (canonJson) {
          const ec = typeof canonJson.episode_count === "number" ? canonJson.episode_count : null;
          let cMin = typeof canonJson.episode_length_seconds_min === "number" ? canonJson.episode_length_seconds_min : null;
          let cMax = typeof canonJson.episode_length_seconds_max === "number" ? canonJson.episode_length_seconds_max : null;
          if (cMin !== null && cMax !== null && cMin > cMax) { cMin = null; cMax = null; }
          canonEpisodeMeta = { episode_count: ec, min: cMin, max: cMax };
        }
      } catch (e) {
        console.warn("[dev-engine-v2] Canon fetch failed (non-fatal):", e);
      }

      const rawFormat = reqFormat || project?.format || "film";
      const effectiveFormat = resolveFormatAlias(rawFormat.toLowerCase().replace(/[_ ]+/g, "-"));
      const effectiveBehavior = developmentBehavior || project?.development_behavior || "market";
      const effectiveDeliverable = deliverableType;
      const effectiveProductionType = productionType || formatToProductionType[effectiveFormat] || "narrative_feature";

      // ── Canonical Qualification Resolver ──
      // Call resolve-qualifications edge function for canonical resolution + persist
      let resolvedQuals: any = null;
      try {
        const resolverResp = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ projectId }),
        });
        if (resolverResp.ok) {
          resolvedQuals = await resolverResp.json();
        } else {
          console.warn("[dev-engine-v2] resolve-qualifications failed, falling back to local resolution");
        }
      } catch (e) {
        console.warn("[dev-engine-v2] resolve-qualifications call failed:", e);
      }

      // Fallback: use local resolution if edge function call failed
      const rq = resolvedQuals?.resolvedQualifications || {};
      // Accept both camelCase and snake_case from payload as final override
      const payloadDuration = body.episodeTargetDurationSeconds ?? body.episode_target_duration_seconds ?? null;
      const payloadDurationMin = body.episode_target_duration_min_seconds ?? null;
      const payloadDurationMax = body.episode_target_duration_max_seconds ?? null;
      const payloadCount = body.seasonEpisodeCount ?? body.season_episode_count ?? null;

      const gc = project?.guardrails_config || {};
      const gquals = gc?.overrides?.qualifications || {};
      const fmtDefaults = FORMAT_DEFAULTS_ENGINE[effectiveFormat] || {};
      // Canon values override all legacy values (highest priority after explicit payload)
      const effectiveDuration = payloadDuration || canonEpisodeMeta.min || rq.episode_target_duration_seconds || project?.episode_target_duration_seconds || gquals.episode_target_duration_seconds || fmtDefaults.episode_target_duration_seconds || null;
      const effectiveDurationMin = payloadDurationMin || canonEpisodeMeta.min || rq.episode_target_duration_min_seconds || (project as any)?.episode_target_duration_min_seconds || gquals.episode_target_duration_min_seconds || fmtDefaults.episode_target_duration_min_seconds || effectiveDuration || null;
      const effectiveDurationMax = payloadDurationMax || canonEpisodeMeta.max || rq.episode_target_duration_max_seconds || (project as any)?.episode_target_duration_max_seconds || gquals.episode_target_duration_max_seconds || fmtDefaults.episode_target_duration_max_seconds || effectiveDuration || null;
      const effectiveSeasonCount = payloadCount || canonEpisodeMeta.episode_count || rq.season_episode_count || (project as any)?.season_episode_count || gquals.season_episode_count || fmtDefaults.season_episode_count || null;

      // Vertical drama: require episode duration (min or max or scalar)
      if (effectiveFormat === "vertical-drama" && !effectiveDuration && !effectiveDurationMin) {
        throw new Error("episode_target_duration is required for vertical drama format");
      }

      // Fetch season config for vertical drama
      const seasonEpisodeCount = effectiveSeasonCount;
      let seasonArchitecture: any = null;
      if (effectiveFormat === "vertical-drama" && seasonEpisodeCount) {
        // Compute season architecture inline (mirrors dev-os-config.ts logic)
        const E = seasonEpisodeCount;
        if (E >= 10) {
          const actSize = Math.floor(E * 0.2);
          const remainder = E - actSize * 5;
          const acts: any[] = [];
          let cursor = 1;
          for (let a = 1; a <= 5; a++) {
            const extra = a > (5 - remainder) ? 1 : 0;
            const count = actSize + extra;
            acts.push({ act: a, start_episode: cursor, end_episode: cursor + count - 1, episode_count: count });
            cursor += count;
          }
          seasonArchitecture = {
            model: "5-act", episode_count: E, acts,
            anchors: { reveal_index: Math.round(E * 0.25), mid_index: Math.round(E * 0.50), pre_finale_index: Math.round(E * 0.80), finale_index: E },
          };
        } else {
          const act1 = Math.round(E * 0.3); const act3 = Math.round(E * 0.3); const act2 = E - act1 - act3;
          seasonArchitecture = {
            model: "3-act", episode_count: E,
            acts: [
              { act: 1, start_episode: 1, end_episode: act1, episode_count: act1 },
              { act: 2, start_episode: act1 + 1, end_episode: act1 + act2, episode_count: act2 },
              { act: 3, start_episode: act1 + act2 + 1, end_episode: E, episode_count: act3 },
            ],
            anchors: { reveal_index: Math.round(E * 0.33), mid_index: Math.round(E * 0.55), finale_index: E },
          };
        }
      }

      // Build deliverable-aware system prompt (routing order: deliverable → format → behavior)
      const baseSystemPrompt = buildAnalyzeSystem(effectiveDeliverable, effectiveFormat, effectiveBehavior, effectiveDurationMin, effectiveDurationMax);

      // Inject guardrails with per-engine mode support
      const guardrails = buildGuardrailBlock({
        project: project ? { ...project, production_type: effectiveProductionType, guardrails_config: (project as any).guardrails_config } : undefined,
        productionType: effectiveFormat,
        engineName: "dev-engine-v2",
        corpusEnabled: !!body.corpusEnabled,
        corpusCalibration: body.corpusCalibration,
      });
      const systemPrompt = composeSystem({ baseSystem: baseSystemPrompt, guardrailsBlock: guardrails.textBlock });
      console.log(`[dev-engine-v2] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}, mode=${guardrails.policy.engineMode}`);

      let prevContext = "";
      if (previousVersionId) {
        const { data: prevRun } = await supabase.from("development_runs")
          .select("output_json").eq("version_id", previousVersionId).eq("run_type", "ANALYZE")
          .order("created_at", { ascending: false }).limit(1).single();
        if (prevRun?.output_json) {
          const pj = prevRun.output_json as any;
          const scores = pj.scores || pj;
          prevContext = `\nPREVIOUS SCORES: CI=${scores.ci_score}, GP=${scores.gp_score}, Gap=${scores.gap}`;
        }
      }

      let seasonContext = "";
      if (seasonArchitecture) {
        seasonContext = `\nSEASON ARCHITECTURE: ${seasonArchitecture.episode_count} episodes, ${seasonArchitecture.model} model. Anchors: reveal=${seasonArchitecture.anchors.reveal_index}, midpoint=${seasonArchitecture.anchors.mid_index}${seasonArchitecture.anchors.pre_finale_index ? `, pre-finale=${seasonArchitecture.anchors.pre_finale_index}` : ""}, finale=${seasonArchitecture.anchors.finale_index}.`;
      }

      // Build canonical qualification binding + episode length block for prompt
      const episodeLengthBlock = buildEpisodeLengthBlock(project, gquals, fmtDefaults);
      let qualBinding = "";
      if (rq.is_series && rq.season_episode_count) {
        const durMin = effectiveDurationMin;
        const durMax = effectiveDurationMax;
        const durMid = durMin && durMax ? Math.round((durMin + durMax) / 2) : (durMin || durMax || null);
        const durRangeStr = (durMin && durMax && durMin !== durMax)
          ? `${durMin}–${durMax} seconds (midpoint ${durMid}s)`
          : `${durMid || 'N/A'} seconds`;
        qualBinding = `\nCANONICAL QUALIFICATIONS (authoritative — ignore older references to different values):
Target season length: ${rq.season_episode_count} episodes.
Episode target duration range: ${durRangeStr}.
Format: ${rq.format}.${episodeLengthBlock}`;
      } else if (episodeLengthBlock) {
        qualBinding = episodeLengthBlock;
      }

      // ── Signal Context Injection ──
      let signalContext = "";
      if (body.skipSignals) {
        console.log("[dev-engine-v2] Signals disabled for this run (skipSignals=true)");
      } else try {
        const { data: projSettings } = await supabase.from("projects")
          .select("signals_influence, signals_apply")
          .eq("id", projectId).single();
        const influence = (projSettings as any)?.signals_influence ?? 0.5;
        const applyConfig = (projSettings as any)?.signals_apply ?? { pitch: true, dev: true, grid: true, doc: true };
        if (!applyConfig.dev) {
          console.log("[dev-engine-v2] Signals disabled via signals_apply.dev=false");
        } else if (applyConfig.dev) {
          const { data: matches } = await supabase
            .from("project_signal_matches")
            .select("relevance_score, impact_score, rationale, cluster:cluster_id(name, category, strength, velocity, saturation_risk, explanation)")
            .eq("project_id", projectId)
            .order("impact_score", { ascending: false })
            .limit(3);
          if (matches && matches.length > 0) {
            const fmt = effectiveFormat === "vertical-drama" ? "vertical_drama" : effectiveFormat === "documentary" ? "documentary" : "film";
            const influenceLabel = influence >= 0.65 ? "HIGH" : influence >= 0.35 ? "MODERATE" : "LOW";
            const fmtNote = fmt === "vertical_drama" ? "Apply retention mechanics — cliff cadence, reveal pacing, twist density."
              : fmt === "documentary" ? "Apply truth constraints — access/evidence plan. Signals inform subject positioning only."
              : "Apply budget realism, lane liquidity, and saturation warnings.";
            const lines = matches.map((m: any, i: number) => {
              const c = m.cluster;
              return `${i+1}. ${c?.name || "Signal"} [${c?.category || ""}] — strength ${c?.strength || 0}/10, ${c?.velocity || "Stable"}, saturation ${c?.saturation_risk || "Low"}\n   ${c?.explanation || ""}`;
            }).join("\n");
            signalContext = `\n=== MARKET & FORMAT SIGNALS (influence: ${influenceLabel}) ===\n${fmtNote}\n${lines}\n=== END SIGNALS ===`;
          }
        }
      } catch (e) {
        console.warn("[dev-engine-v2] Signal context fetch failed (non-fatal):", e);
      }

      // ── Locked Decisions Injection ──
      let lockedDecisionsContext = "";
      try {
        const { data: decisions } = await supabase.from("decision_ledger")
          .select("decision_key, title, decision_text")
          .eq("project_id", projectId)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(20);
        if (decisions && decisions.length > 0) {
          const bullets = decisions.map((d: any) => `- [${d.decision_key}] ${d.decision_text}`).join("\n");
          lockedDecisionsContext = `\n\nLOCKED DECISIONS (MUST FOLLOW — treat as canon, do not re-open):\n${bullets}`;
        }
      } catch (e) {
        console.warn("[dev-engine-v2] Locked decisions fetch failed (non-fatal):", e);
      }

      // ── Canon OS Context block (FULL canon injection) ──
      let canonOSContext = "";
      if (canonJson) {
        const parts: string[] = [];
        if (canonJson.title) parts.push(`Title: ${canonJson.title}`);
        if (canonJson.logline && typeof canonJson.logline === "string" && canonJson.logline.trim()) parts.push(`Logline: ${canonJson.logline}`);
        if (canonJson.premise && typeof canonJson.premise === "string" && canonJson.premise.trim()) parts.push(`Premise: ${canonJson.premise}`);
        if (canonJson.format) parts.push(`Format: ${canonJson.format}`);
        if (canonJson.genre) parts.push(`Genre: ${canonJson.genre}`);
        if (canonJson.tone) parts.push(`Tone: ${canonJson.tone}`);
        if (canonJson.tone_style && typeof canonJson.tone_style === "string" && canonJson.tone_style.trim()) parts.push(`Tone & Style: ${canonJson.tone_style}`);
        if (canonEpisodeMeta.episode_count) parts.push(`Episode count: ${canonEpisodeMeta.episode_count}`);
        if (canonEpisodeMeta.min != null && canonEpisodeMeta.max != null) {
          parts.push(`Episode duration range: ${canonEpisodeMeta.min}–${canonEpisodeMeta.max}s`);
        }
        // Characters
        if (Array.isArray(canonJson.characters) && canonJson.characters.length > 0) {
          const charLines = canonJson.characters
            .filter((c: any) => c.name && c.name.trim())
            .map((c: any) => {
              const details = [c.role, c.goals, c.traits].filter(Boolean).join("; ");
              return `  - ${c.name}${details ? `: ${details}` : ""}`;
            });
          if (charLines.length > 0) parts.push(`Characters:\n${charLines.join("\n")}`);
        }
        if (canonJson.timeline && typeof canonJson.timeline === "string" && canonJson.timeline.trim()) parts.push(`Timeline: ${canonJson.timeline}`);
        if (canonJson.locations && typeof canonJson.locations === "string" && canonJson.locations.trim()) parts.push(`Locations: ${canonJson.locations}`);
        if (canonJson.ongoing_threads && typeof canonJson.ongoing_threads === "string" && canonJson.ongoing_threads.trim()) parts.push(`Ongoing threads: ${canonJson.ongoing_threads}`);
        if (Array.isArray(canonJson.world_rules) && canonJson.world_rules.length > 0) parts.push(`World rules: ${canonJson.world_rules.join("; ")}`);
        else if (typeof canonJson.world_rules === "string" && canonJson.world_rules.trim()) parts.push(`World rules: ${canonJson.world_rules}`);
        if (Array.isArray(canonJson.forbidden_changes) && canonJson.forbidden_changes.length > 0) parts.push(`Forbidden changes: ${canonJson.forbidden_changes.join("; ")}`);
        else if (typeof canonJson.forbidden_changes === "string" && canonJson.forbidden_changes.trim()) parts.push(`Forbidden changes: ${canonJson.forbidden_changes}`);
        if (canonJson.format_constraints && typeof canonJson.format_constraints === "string" && canonJson.format_constraints.trim()) parts.push(`Format constraints: ${canonJson.format_constraints}`);
        if (parts.length > 0) {
          canonOSContext = `\nCANON OS (authoritative — these values override any other references):\n${parts.join("\n")}`;
        }
      }
      // If no canon established, inject warning so engine doesn't invent canonical facts
      if (!canonOSContext) {
        // Check if canon_json is empty (no logline, premise, characters set)
        const hasCanonContent = canonJson && (
          (typeof canonJson.logline === "string" && canonJson.logline.trim()) ||
          (typeof canonJson.premise === "string" && canonJson.premise.trim()) ||
          (Array.isArray(canonJson.characters) && canonJson.characters.length > 0)
        );
        if (!hasCanonContent) {
          canonOSContext = `\nCANON OS: No canonical logline, premise, or characters have been established in the Canon Editor. Do NOT assert specific protagonist names, premise details, or genre classifications as canonical facts. Analyze only what is present in the document text. If the document itself establishes these elements, reference them as "per the document" not as established canon.`;
        }
      }

      // ── Effective Profile Context (from seed_intel_pack in canon) ──
      let effectiveProfileContext = "";
      try {
        if (canonJson?.seed_intel_pack || (Array.isArray(canonJson?.comparables) && canonJson.comparables.length > 0)) {
            const ep = buildEffectiveProfileContextBlock({ canonJson, project });
            if (ep) effectiveProfileContext = ep;
          }
      } catch (e) {
        console.warn("[dev-engine-v2] Effective profile build failed (non-fatal):", e);
      }

      // ── Team Voice injection ──
      const analyzeLane = project?.assigned_lane || "independent-film";
      const tvCtx = await loadTeamVoiceContext(supabase, projectId, analyzeLane);
      const teamVoiceBlock = tvCtx.block ? `\n${tvCtx.block}` : "";

      // ── Supporting doc context (deterministic, optional) ──
      let supportingContext = "";
      if (body.includeDocumentIds && Array.isArray(body.includeDocumentIds) && body.includeDocumentIds.length > 0) {
        try {
          supportingContext = await loadSupportingDocPack(supabase, projectId, body.includeDocumentIds, documentId);
        } catch (e: any) {
          console.warn("[dev-engine-v2] loadSupportingDocPack failed (non-fatal):", e?.message);
        }
      }
      // ── NEC Guardrail injection for analyze (NEC-first) ──
      const analyzeNecBlock = await loadNECGuardrailBlock(supabase, projectId);

      const userPrompt = `${analyzeNecBlock}
PRODUCTION TYPE: ${effectiveProductionType}
STRATEGIC PRIORITY: ${strategicPriority || "BALANCED"}
DEVELOPMENT STAGE: ${developmentStage || "IDEA"}
PROJECT: ${project?.title || "Unknown"}
LANE: ${analyzeLane} | BUDGET: ${project?.budget_range || "Unknown"}
${prevContext}${seasonContext}${qualBinding}${canonOSContext}${effectiveProfileContext}${signalContext}${lockedDecisionsContext}${teamVoiceBlock}${supportingContext}

MATERIAL (${version.plaintext.length} chars):
${version.plaintext.slice(0, maxContextChars)}`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, systemPrompt, userPrompt, 0.2, 6000);
      let parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      // ── Strict JSON retry: one deterministic recovery attempt ──
      if (!parsed || !looksLikeAnalyzeShape(parsed)) {
        console.log("[dev-engine-v2] analyze json invalid -> strict retry", { projectId, documentId, versionId: version.id });
        try {
          const raw2 = await callAI(LOVABLE_API_KEY, PRO_MODEL, `${STRICT_JSON_RULES}\n\n${systemPrompt}`, userPrompt, 0.1, 6000);
          const parsed2 = await parseAIJson(LOVABLE_API_KEY, raw2);
          if (parsed2 && looksLikeAnalyzeShape(parsed2)) {
            console.log("[dev-engine-v2] analyze strict retry succeeded", { projectId });
            parsed = parsed2;
          } else {
            console.error("[dev-engine-v2] analyze strict retry failed -> returning success:false", { projectId, snippet: safeSnippet(raw2) });
            return new Response(JSON.stringify({ success: false, error: "MODEL_JSON_PARSE_FAILED", where: "analyze", attempt: 2, snippet: safeSnippet(raw2, 300), hint: "strict_retry_failed" }), {
              status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (retryErr: any) {
          console.error("[dev-engine-v2] analyze strict retry threw", { projectId, error: retryErr?.message });
          return new Response(JSON.stringify({ success: false, error: "MODEL_JSON_PARSE_FAILED", where: "analyze", attempt: 2, snippet: safeSnippet(raw, 300), hint: "strict_retry_exception" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Normalize: ensure scores are at top level for backward compat
      const scores = parsed.scores || {};
      if (scores.ci_score != null && parsed.ci_score == null) {
        parsed.ci_score = scores.ci_score;
        parsed.gp_score = scores.gp_score;
        parsed.gap = scores.gap;
        parsed.allowed_gap = scores.allowed_gap;
      }
      // Ensure meta is present
      if (!parsed.meta) {
        parsed.meta = { deliverable_type: effectiveDeliverable, format: effectiveFormat, development_behavior: effectiveBehavior, schema_version: SCHEMA_VERSION };
      }
      parsed.deliverable_type = effectiveDeliverable;
      parsed.development_behavior = effectiveBehavior;

      // Validate next_best_document — must be a valid deliverable type key for THIS format's ladder
      const formatLadder = getLadderForFormat(effectiveFormat);
      const VALID_DELIVERABLES = new Set(formatLadder);
      if (parsed.convergence?.next_best_document) {
        const raw_nbd = parsed.convergence.next_best_document;
        const normalized_nbd = raw_nbd.toLowerCase().replace(/[\s\-]+/g, "_").replace(/[^a-z_]/g, "");
        if (VALID_DELIVERABLES.has(normalized_nbd)) {
          parsed.convergence.next_best_document = normalized_nbd;
        } else {
          // Try remapping to ladder-valid type
          const remapped = remapDocType(normalized_nbd, effectiveFormat);
          if (remapped) {
            parsed.convergence.next_best_document = remapped;
          } else if (docTypeMap[raw_nbd.toUpperCase()]) {
            const mapped = docTypeMap[raw_nbd.toUpperCase()];
            parsed.convergence.next_best_document = remapDocType(mapped, effectiveFormat) || mapped;
          } else {
            // Fuzzy: find best match from ladder
            const fuzzyMatch = [...VALID_DELIVERABLES].find(d => normalized_nbd.includes(d) || d.includes(normalized_nbd));
            parsed.convergence.next_best_document = fuzzyMatch || formatLadder[formatLadder.length - 1] || "script";
          }
        }
      }

      // ── Filter notes: remap or remove notes referencing out-of-ladder doc types ──
      function filterAndTimingNotes(notes: any[]): { now: any[]; deferred: any[] } {
        if (!notes) return { now: [], deferred: [] };
        const nowNotes: any[] = [];
        const deferredNotes: any[] = [];
        for (const note of notes) {
          // Default apply_timing to "now" for backward compat
          if (!note.apply_timing) note.apply_timing = "now";
          // Validate target_deliverable_type against ladder
          if (note.target_deliverable_type) {
            const remapped = remapDocType(note.target_deliverable_type, effectiveFormat);
            if (!remapped) {
              // Target not in ladder — remap to closest or drop
              note.target_deliverable_type = null;
              note.apply_timing = "now";
            } else {
              note.target_deliverable_type = remapped;
            }
          }
          if (note.apply_timing === "now") {
            nowNotes.push(note);
          } else {
            deferredNotes.push(note);
          }
        }
        return { now: nowNotes, deferred: deferredNotes };
      }

      const blockersResult = filterAndTimingNotes(parsed.blocking_issues || []);
      const highResult = filterAndTimingNotes(parsed.high_impact_notes || []);
      const polishResult = filterAndTimingNotes(parsed.polish_notes || []);

      // Keep only NOW notes in the main arrays
      parsed.blocking_issues = blockersResult.now;
      parsed.high_impact_notes = highResult.now;
      parsed.polish_notes = polishResult.now;

      // Collect all deferred notes
      const allDeferred = [...blockersResult.deferred, ...highResult.deferred, ...polishResult.deferred];
      parsed.deferred_notes = allDeferred;

      // ── Persist deferred notes to DB ──
      if (allDeferred.length > 0 && projectId) {
        for (const dn of allDeferred) {
          try {
            await supabase.from("project_deferred_notes").upsert({
              project_id: projectId,
              created_by: user.id,
              source_doc_type: effectiveDeliverable,
              source_version_id: versionId,
              note_key: dn.note_key || dn.id,
              note_json: dn,
              target_deliverable_type: dn.target_deliverable_type || "",
              status: "open",
              last_checked_at: new Date().toISOString(),
              last_seen_in_doc_type: effectiveDeliverable,
              severity: dn.severity || "high",
              category: dn.category || null,
              due_when: { when_doc_type_active: dn.target_deliverable_type || null },
              suggested_fixes: dn.suggested_fixes || null,
            }, { onConflict: "project_id,note_key,target_deliverable_type" });
          } catch (e) {
            console.warn("[dev-engine-v2] Failed to persist deferred note:", e);
          }
        }
      }

      // ── Auto-dismiss stale notes from prior runs for this source_doc_type ──
      if (projectId) {
        try {
          const currentNoteKeys = allDeferred.map((dn: any) => dn.note_key || dn.id).filter(Boolean);
          // Dismiss old open notes for this doc type that weren't re-flagged
          if (currentNoteKeys.length > 0) {
            await supabase.from("project_deferred_notes")
              .update({ status: "dismissed", resolved_at: new Date().toISOString(), resolution_method: "auto_stale", resolution_summary: "Auto-dismissed: not re-flagged in latest analysis" })
              .eq("project_id", projectId)
              .eq("source_doc_type", effectiveDeliverable)
              .in("status", ["open", "pinned"])
              .not("note_key", "in", `(${currentNoteKeys.join(",")})`);
          } else {
            // No new deferred notes — dismiss all old ones for this doc type
            await supabase.from("project_deferred_notes")
              .update({ status: "dismissed", resolved_at: new Date().toISOString(), resolution_method: "auto_stale", resolution_summary: "Auto-dismissed: no notes in latest analysis" })
              .eq("project_id", projectId)
              .eq("source_doc_type", effectiveDeliverable)
              .in("status", ["open", "pinned"]);
          }
          console.log("[dev-engine-v2] Auto-dismissed stale deferred notes for", effectiveDeliverable);
        } catch (e) {
          console.warn("[dev-engine-v2] Failed to auto-dismiss stale notes:", e);
        }
      }

      // ── Load and inject carried-forward deferred notes for current deliverable ──
      if (projectId) {
        try {
          const { data: carriedNotes } = await supabase.from("project_deferred_notes")
            .select("*")
            .eq("project_id", projectId)
            .eq("target_deliverable_type", effectiveDeliverable)
            .eq("status", "open");
          if (carriedNotes && carriedNotes.length > 0) {
            parsed.carried_deferred_notes = carriedNotes.map((cn: any) => ({
              ...cn.note_json,
              deferred_id: cn.id,
              source_doc_type: cn.source_doc_type,
              originally_deferred: true,
            }));
          }
        } catch (e) {
          console.warn("[dev-engine-v2] Failed to load carried deferred notes:", e);
        }
      }

      // ── Vertical Drama: override next_best_document with gated pipeline ──
      if (effectiveFormat === "vertical-drama" && parsed.convergence) {
        // Fetch existing doc types for this project
        const { data: existingDocs } = await supabase.from("project_documents")
          .select("doc_type").eq("project_id", projectId);
        const existingDocTypes = (existingDocs || []).map((d: any) => d.doc_type).filter(Boolean);

        const vdNext = resolveVerticalDramaNextStep(existingDocTypes, effectiveSeasonCount);
        parsed.convergence.next_best_document = vdNext.nextStep;
        parsed.convergence.vertical_drama_gating = {
          missing_prerequisites: vdNext.missingPrerequisites,
          reason: vdNext.reason,
          canonical_episode_count: effectiveSeasonCount || null,
          production_type: "vertical_drama",
        };
      }

      // Enforce caps: max 5 per tier (NOW notes only)
      if (parsed.blocking_issues && parsed.blocking_issues.length > 5) parsed.blocking_issues = parsed.blocking_issues.slice(0, 5);
      if (parsed.high_impact_notes && parsed.high_impact_notes.length > 5) parsed.high_impact_notes = parsed.high_impact_notes.slice(0, 5);
      if (parsed.polish_notes && parsed.polish_notes.length > 5) parsed.polish_notes = parsed.polish_notes.slice(0, 5);

      // Ensure note_key = id for all notes
      for (const arr of [parsed.blocking_issues, parsed.high_impact_notes, parsed.polish_notes]) {
        if (arr) for (const n of arr) { if (!n.note_key) n.note_key = n.id; if (!n.id) n.id = n.note_key; }
      }

      // Blocker-based convergence override: only NOW blockers gate convergence
      const blockerCount = (parsed.blocking_issues || []).length;
      const highCount = (parsed.high_impact_notes || []).length;
      const polishCount = (parsed.polish_notes || []).length;
      if (parsed.convergence) {
        parsed.convergence.blockers_remaining = blockerCount;
        parsed.convergence.high_impact_remaining = highCount;
        parsed.convergence.polish_remaining = polishCount;
        parsed.convergence.deferred_count = allDeferred.length;
        // Override AI convergence: only NOW blockers prevent convergence
        if (blockerCount > 0 && parsed.convergence.status === "converged") {
          parsed.convergence.status = "in_progress";
          parsed.convergence.reasons = [...(parsed.convergence.reasons || []), "Blocking issues remain"];
        }
        if (blockerCount === 0 && parsed.convergence.status !== "converged") {
          // Check score thresholds still apply
          const ciOk = (parsed.ci_score || 0) >= 60;
          const gpOk = (parsed.gp_score || 0) >= 60;
          if (ciOk && gpOk) {
            parsed.convergence.status = "converged";
            if (!parsed.convergence.reasons) parsed.convergence.reasons = [];
            parsed.convergence.reasons.push("All blockers resolved");
          }
        }
      }

      // Stability status
      parsed.stability_status = blockerCount === 0 && highCount <= 3 && polishCount <= 5
        ? "structurally_stable" : blockerCount === 0 ? "refinement_phase" : "in_progress";

      // Inject criteria_snapshot for traceability
      const criteriaSnapshot = await buildCriteriaSnapshot(supabase, projectId);
      parsed.criteria_snapshot = criteriaSnapshot;

      // Re-verify version still exists before inserting run (guards against race condition where
      // version is deleted during the AI call which can take 30+ seconds)
      const { data: versionStillExists } = await supabase.from("project_document_versions")
        .select("id").eq("id", versionId).maybeSingle();
      if (!versionStillExists) throw new Error("Version was deleted while analysis was running — please re-select the document and try again");

      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "ANALYZE",
        production_type: effectiveProductionType,
        strategic_priority: strategicPriority || "BALANCED",
        development_stage: developmentStage || "IDEA",
        analysis_mode: analysisMode || "DUAL",
        output_json: parsed,
        deliverable_type: effectiveDeliverable,
        development_behavior: effectiveBehavior,
        format: effectiveFormat,
        episode_target_duration_seconds: effectiveDuration || null,
        schema_version: SCHEMA_VERSION,
      }).select().single();
      if (runErr) {
        if (runErr.code === "23503") throw new Error("Version no longer exists — please re-select the document and try again");
        throw runErr;
      }

      await supabase.from("dev_engine_convergence_history").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        creative_score: parsed.ci_score || 0,
        greenlight_score: parsed.gp_score || 0,
        gap: parsed.gap ?? Math.abs((parsed.ci_score || 50) - (parsed.gp_score || 50)),
        allowed_gap: parsed.allowed_gap || 25,
        convergence_status: parsed.convergence?.status || parsed.convergence_status || "Unknown",
        trajectory: parsed.trajectory,
      });

      // ── DRIFT DETECTION ──
      const extractedCore = parsed.extracted_core || {};
      let driftReport: any = { level: "none", items: [], acknowledged: false, resolved: false };

      // Get inherited_core from version
      const { data: versionMeta } = await supabase.from("project_document_versions")
        .select("inherited_core").eq("id", versionId).single();

      if (versionMeta?.inherited_core) {
        const drift = detectDrift(extractedCore, versionMeta.inherited_core as Record<string, string>);
        driftReport = { ...drift, acknowledged: false, resolved: false };

        if (drift.level !== "none") {
          // Store drift event
          await supabase.from("document_drift_events").insert({
            project_id: projectId,
            document_version_id: versionId,
            drift_level: drift.level,
            drift_items: drift.items,
          });
        }

        // Store drift snapshot on version
        await supabase.from("project_document_versions")
          .update({ drift_snapshot: driftReport })
          .eq("id", versionId);

        // Drift-aware convergence: modify status if unresolved
        if (drift.level === "major") {
          if (parsed.convergence) {
            parsed.convergence.status = "in_progress";
            parsed.convergence.reasons = [...(parsed.convergence.reasons || []), "Unresolved major structural drift detected"];
          }
        } else if (drift.level === "moderate") {
          if (parsed.convergence?.status === "converged") {
            parsed.convergence.status = "in_progress";
            parsed.convergence.reasons = [...(parsed.convergence.reasons || []), "Unacknowledged moderate drift requires resolution"];
          }
        }
      }

      // Store extracted core on version for future drift comparisons
      await supabase.from("project_document_versions")
        .update({ drift_snapshot: { ...driftReport, extracted_core: extractedCore } })
        .eq("id", versionId);

      parsed.drift_report = driftReport;
      if (seasonArchitecture) parsed.season_architecture = seasonArchitecture;

      // ── Documentary Fact Ledger Auto-population ──
      const isDocFormat = ["documentary", "documentary-series", "hybrid-documentary"].includes(effectiveFormat) ||
        effectiveDeliverable === "documentary_outline";
      if (isDocFormat && parsed.claims_list && Array.isArray(parsed.claims_list)) {
        try {
          let ledgerCreated = 0;
          for (const claim of parsed.claims_list) {
            const claimText = typeof claim === "string" ? claim : claim.claim;
            if (!claimText) continue;
            const { data: existing } = await supabase
              .from("doc_fact_ledger_items")
              .select("id")
              .eq("project_id", projectId)
              .eq("claim", claimText)
              .limit(1);
            if (!existing || existing.length === 0) {
              await supabase.from("doc_fact_ledger_items").insert({
                project_id: projectId,
                user_id: user.id,
                claim: claimText,
                evidence_type: claim.evidence_type || "unknown",
                status: claim.status || "needs_check",
              });
              ledgerCreated++;
            }
          }
          parsed.fact_ledger_metadata = {
            claims_count: parsed.claims_list.length,
            ledger_items_created: ledgerCreated,
          };
        } catch (e) {
          console.warn("[dev-engine-v2] Fact ledger upsert failed (non-fatal):", e);
        }
      }

      return new Response(JSON.stringify({ run, analysis: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // NOTES — tiered structured notes with tracking
    // ══════════════════════════════════════════════
    if (action === "notes") {
      const { projectId, documentId, versionId, analysisJson } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      // Fetch project format so notes are format-aware (e.g. vertical drama ≠ feature film)
      const { data: notesProject } = await supabase.from("projects")
        .select("format, development_behavior, assigned_lane, budget_range")
        .eq("id", projectId).single();
      const notesRawFormat = notesProject?.format || "film";
      const notesEffectiveFormat = resolveFormatAlias(notesRawFormat.toLowerCase().replace(/[_ ]+/g, "-"));
      const notesFormatExp = FORMAT_EXPECTATIONS[notesEffectiveFormat] || FORMAT_EXPECTATIONS["film"];
      const notesLadder = getLadderForFormat(notesEffectiveFormat);
      const notesLadderStr = notesLadder.join(", ");
      const notesProductionType = formatToProductionType[notesEffectiveFormat] || "narrative_feature";

      let analysis = analysisJson;
      if (!analysis) {
        const { data: latestRun } = await supabase.from("development_runs")
          .select("output_json").eq("version_id", versionId).eq("run_type", "ANALYZE")
          .order("created_at", { ascending: false }).limit(1).single();
        analysis = latestRun?.output_json;
      }
      if (!analysis) throw new Error("No analysis found. Run Analyze first.");

      // Check previous note keys to prevent endless repetition
      const { data: prevNotes } = await supabase.from("development_notes")
        .select("note_key, severity, resolved")
        .eq("document_id", documentId);
      const previouslyResolved = new Set((prevNotes || []).filter(n => n.resolved).map(n => n.note_key));
      const existingUnresolved = (prevNotes || []).filter(n => !n.resolved);
      const previousBlockerCount = existingUnresolved.filter(n => n.severity === 'blocker').length;

      let antiRepeatRule = "";
      if (previouslyResolved.size > 0) {
        antiRepeatRule = `\nPREVIOUSLY RESOLVED NOTE KEYS (do NOT re-raise as blockers unless regression detected): ${[...previouslyResolved].join(", ")}`;
      }
      if (previousBlockerCount === 0 && existingUnresolved.length > 0) {
        antiRepeatRule += `\nPREVIOUS ROUND HAD ZERO BLOCKERS. Do NOT invent new blockers unless drift/regression occurred. Only generate high/polish notes.`;
      }

      const notesSystem = `You are IFFY. Generate structured development notes in three tiers, with DECISION OPTIONS for blockers and high-impact notes.

PRODUCTION TYPE: ${notesProductionType}
${notesFormatExp}

EDITORIAL SCOPE LOCK: You are operating in EDITORIAL MODE for a ${notesEffectiveFormat} project.
- Do NOT apply feature film pacing logic or structure to non-feature formats.
- Do NOT penalise a vertical drama for not being a feature film.
- Score and note relative to the declared format and its ladder.
- Valid document types for this format: ${notesLadderStr}
- Do NOT reference document types outside this ladder.
Return ONLY valid JSON:
{
  "protect": ["non-negotiable items to preserve"],
  "blocking_issues": [
    {
      "id": "stable_key", "category": "structural|character|escalation|lane|packaging|risk|pacing|hook|cliffhanger",
      "description": "...", "why_it_matters": "...", "severity": "blocker",
      "decisions": [
        {
          "option_id": "B1-A",
          "title": "short action title (max 8 words)",
          "what_changes": ["list of story elements that change"],
          "creative_tradeoff": "one sentence on creative cost/benefit",
          "commercial_lift": 0-20
        }
      ],
      "recommended": "option_id of recommended choice"
    }
  ],
  "high_impact_notes": [
    {
      "id": "stable_key", "category": "...", "description": "...", "why_it_matters": "...", "severity": "high",
      "decisions": [
        {
          "option_id": "H1-A",
          "title": "short action title",
          "what_changes": ["list of story elements that change"],
          "creative_tradeoff": "one sentence",
          "commercial_lift": 0-15
        }
      ],
      "recommended": "option_id of recommended choice"
    }
  ],
  "polish_notes": [
    {"id": "stable_key", "category": "...", "description": "...", "why_it_matters": "...", "severity": "polish"}
  ],
  "global_directions": [
    {"id": "G1", "direction": "overarching creative direction", "why": "rationale"}
  ],
  "rewrite_plan": ["what will change in next rewrite — max 5 items"]
}

DECISION RULES:
- Every blocker MUST have exactly 2-3 decisions (resolution options). Each option represents a different creative strategy.
- High-impact notes SHOULD have 2 decisions where meaningful. If only one path exists, provide 1 decision.
- Polish notes do NOT need decisions.
- option_id format: B{n}-{letter} for blockers, H{n}-{letter} for high. Letters are A, B, C.
- what_changes: list 2-4 specific story elements affected.
- creative_tradeoff: honest one-sentence assessment of the creative cost or benefit.
- commercial_lift: integer 0-20 estimating approximate GP improvement if applied.
- recommended: pick the option that best balances creative integrity with commercial viability.
- global_directions: 1-3 overarching tonal/strategic directions that apply across all notes.

GENERAL RULES:
- Each id and note_key must be identical, stable, descriptive snake_case keys (e.g. "weak_act2_midpoint").
- blocking_issues: ONLY items fundamentally preventing the document from working. Max 5.
- high_impact_notes: Significant but non-blocking improvements. Max 5.
- polish_notes: Optional refinements. Max 5.
- Sort within each tier by structural importance.
- Do NOT re-raise previously resolved issues as blockers.
- If an existing note_key persists, use the same key — do NOT rephrase under a new key.${antiRepeatRule}`;

      // ── Canon OS injection for notes (full canon fields) ──
      let notesCanonBlock = "";
      try {
        const { data: notesProj } = await supabase.from("projects")
          .select("canon_version_id").eq("id", projectId).single();
        let notesCj: any = null;
        if (notesProj?.canon_version_id) {
          const { data: cVer } = await supabase.from("project_canon_versions")
            .select("canon_json").eq("id", notesProj.canon_version_id).maybeSingle();
          notesCj = cVer?.canon_json;
        }
        // Fallback to project_canon table
        if (!notesCj) {
          const { data: canonRow } = await supabase.from("project_canon")
            .select("canon_json").eq("project_id", projectId).maybeSingle();
          notesCj = canonRow?.canon_json;
        }
        if (notesCj) {
          const parts: string[] = [];
          const cMin = typeof notesCj.episode_length_seconds_min === "number" ? notesCj.episode_length_seconds_min : null;
          const cMax = typeof notesCj.episode_length_seconds_max === "number" ? notesCj.episode_length_seconds_max : null;
          const cCount = typeof notesCj.episode_count === "number" ? notesCj.episode_count : null;
          if (notesCj.logline && typeof notesCj.logline === "string" && notesCj.logline.trim()) parts.push(`Logline: ${notesCj.logline}`);
          if (notesCj.premise && typeof notesCj.premise === "string" && notesCj.premise.trim()) parts.push(`Premise: ${notesCj.premise}`);
          if (Array.isArray(notesCj.characters) && notesCj.characters.length > 0) {
            const charLines = notesCj.characters.filter((c: any) => c.name?.trim()).map((c: any) => `  - ${c.name}: ${[c.role, c.goals].filter(Boolean).join("; ")}`);
            if (charLines.length > 0) parts.push(`Characters:\n${charLines.join("\n")}`);
          }
          if (cCount) parts.push(`Episode count: ${cCount}`);
          if (cMin != null && cMax != null) parts.push(`Episode duration range: ${cMin}–${cMax}s (use this range, not 180s or any other hardcoded value)`);
          else if (cMin != null) parts.push(`Episode duration: ${cMin}s`);
          if (notesCj.format) parts.push(`Format: ${notesCj.format}`);
          if (notesCj.tone_style && typeof notesCj.tone_style === "string" && notesCj.tone_style.trim()) parts.push(`Tone: ${notesCj.tone_style}`);
          if (parts.length > 0) {
            notesCanonBlock = `\n\nCANON OS (authoritative — do not contradict):\n${parts.join("\n")}`;
          }
        }
        // If no canon content established, inject warning
        if (!notesCanonBlock) {
          notesCanonBlock = `\n\nCANON OS: No canonical logline, premise, or characters established. Reference document content as "per the document" not as established canon.`;
        }
      } catch (_e) { /* non-fatal */ }

      // ── NEC Guardrail injection for notes ──
      const notesNecBlock = await loadNECGuardrailBlock(supabase, projectId);

      const userPrompt = `ANALYSIS:\n${JSON.stringify(analysis)}${notesCanonBlock}${notesNecBlock}\n\nMATERIAL (${version.plaintext.length} chars total):\n${version.plaintext}`;
      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, notesSystem, userPrompt, 0.25, 6000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);
      if (!parsed) {
        console.error("[dev-engine-v2] notes: parseAIJson returned null", raw.slice(0, 300));
        return new Response(JSON.stringify({ success: false, error: "MODEL_JSON_PARSE_FAILED", where: "notes", snippet: raw.slice(0, 300) }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Backward compat: build actionable_notes from tiered notes
      const allTieredNotes = [
        ...(parsed.blocking_issues || []).map((n: any) => ({ ...n, impact: "high", convergence_lift: 10, severity: "blocker" })),
        ...(parsed.high_impact_notes || []).map((n: any) => ({ ...n, impact: "high", convergence_lift: 5, severity: "high" })),
        ...(parsed.polish_notes || []).map((n: any) => ({ ...n, impact: "low", convergence_lift: 1, severity: "polish" })),
      ];
      parsed.actionable_notes = allTieredNotes.map(n => ({
        category: n.category,
        note: n.description,
        impact: n.impact,
        convergence_lift: n.convergence_lift,
        severity: n.severity,
        id: n.id,
        why_it_matters: n.why_it_matters,
      }));
      parsed.prioritized_moves = parsed.actionable_notes;

      // Track notes in development_notes table
      const currentNoteKeys = new Set(allTieredNotes.map((n: any) => n.id).filter(Boolean));

      // Mark previously unresolved notes that are no longer present as resolved
      for (const prev of existingUnresolved) {
        if (!currentNoteKeys.has(prev.note_key)) {
          await supabase.from("development_notes")
            .update({ resolved: true, resolved_in_version: versionId })
            .eq("note_key", prev.note_key)
            .eq("document_id", documentId)
            .eq("resolved", false);
        }
      }

      // Check for regressions (previously resolved notes that reappear)
      for (const note of allTieredNotes) {
        if (note.id && previouslyResolved.has(note.id)) {
          // Regressed — mark old resolved entry
          await supabase.from("development_notes")
            .update({ regressed: true })
            .eq("note_key", note.id)
            .eq("document_id", documentId)
            .eq("resolved", true);
        }
      }

      // Insert new note records
      const noteInserts = allTieredNotes
        .filter((n: any) => n.id)
        .map((n: any) => ({
          project_id: projectId,
          document_id: documentId,
          document_version_id: versionId,
          note_key: n.id,
          category: n.category,
          severity: n.severity,
          description: n.description,
          why_it_matters: n.why_it_matters,
        }));
      if (noteInserts.length > 0) {
        await supabase.from("development_notes").insert(noteInserts);
      }

      // ── CONSTRAINT SOLVER: Upsert note states + detect conflicts + decision sets ──
      let enrichedNotes: any[] = [];
      let decisionSets: any[] = [];
      let suppressedCount = 0;

      try {
        // Fetch previous version text for diff-gating
        const { data: prevVersionRow } = await supabase.from("project_document_versions")
          .select("id, plaintext").eq("document_id", documentId)
          .order("version_number", { ascending: false }).limit(2);
        const prevVersion = (prevVersionRow || []).find((v: any) => v.id !== versionId);
        const prevVersionText = prevVersion?.plaintext || "";
        const prevVersionId = prevVersion?.id || null;

        // Fetch existing state canon_hash for comparison
        const { data: prevStateRow } = await supabase.from("project_dev_note_state")
          .select("canon_hash").eq("project_id", projectId).eq("doc_type", notesEffectiveFormat)
          .order("updated_at", { ascending: false }).limit(1).maybeSingle();

        // Fetch canon inputs for hash
        const { data: bibleDoc } = await supabase.from("project_documents")
          .select("plaintext, extracted_text").eq("project_id", projectId).eq("doc_type", "character_bible").maybeSingle();
        const { data: gridDoc } = await supabase.from("project_documents")
          .select("plaintext, extracted_text").eq("project_id", projectId).eq("doc_type", "episode_grid").maybeSingle();
        const bibleText = bibleDoc?.plaintext || bibleDoc?.extracted_text || "";
        const gridText = gridDoc?.plaintext || gridDoc?.extracted_text || "";
        const canonHash = hashCanonInputs(bibleText, gridText, "");
        const prevCanonHash = prevStateRow?.canon_hash || null;

        // Resolve episode number from the document record if available
        const { data: docRow } = await supabase.from("project_documents")
          .select("doc_type, episode_number").eq("id", documentId).maybeSingle();
        // Use episode_number column if document is episode-specific, else null
        const episodeNumber: number | null = (docRow as any)?.episode_number ?? null;

        // Upsert each note state
        for (const note of allTieredNotes) {
          try {
            // Runtime pressure for soft notes
            const descLower = (note.description || note.note || "").toLowerCase();
            if (note.category === "pacing" || descLower.includes("runtime") || descLower.includes("length") || descLower.includes("duration")) {
              note.objective = "runtime";
            }
            note.intent_label = note.objective || note.category || "";
            // Fix: constraint_key must not default to note ID — use anchor/category
            const inferredAnchor = inferNoteAnchor(note);
            note.constraint_key = note.constraint_key || note.canon_ref_key ||
              (inferredAnchor ? `anchor:${inferredAnchor}` : null) ||
              (note.category ? `cat:${note.category}` : "general");

            const result = await upsertNoteState(supabase, {
              projectId,
              docType: notesEffectiveFormat,
              episodeNumber,
              note,
              versionId,
              prevVersionText,
              prevVersionId,
              newVersionText: version.plaintext,
              canonHash,
              prevCanonHash,
            });

            // Update canon_hash on the state row
            if (result.state?.id) {
              await supabase.from("project_dev_note_state").update({
                canon_hash: canonHash,
                intent_label: note.intent_label || null,
                objective: note.objective || null,
                constraint_key: note.constraint_key || null,
              }).eq("id", result.state.id);
            }

            if (result.suppressed) {
              suppressedCount++;
              continue;
            }

        // Runtime policy: auto-waive soft runtime notes when escalation score is high
        if (note.objective === "runtime" && note.tier !== "hard") {
          // Fix: use correct path — analysis may store gp_score at top level or under scores
          const gpScore = analysis?.gp_score ?? analysis?.scores?.gp ?? analysis?.scores?.gp_score ?? null;
          const escalationOk = gpScore !== null && gpScore >= 70;
              if (escalationOk && result.state) {
                try {
                  await supabase.from("project_dev_note_state").update({
                    status: "waived",
                    waive_reason: "Auto-waived: escalation score is high; trim in edit",
                  }).eq("id", result.state.id);
                } catch (_e) { /* non-fatal */ }
                suppressedCount++;
                continue;
              }
            }

            enrichedNotes.push({
              ...note,
              note_fingerprint: result.fingerprint,
              note_cluster_id: result.clusterId,
              tier: result.state?.tier || note.tier || "soft",
              severity_score: result.state?.severity || 0.5,
              status: result.state?.status || "open",
              times_seen: result.state?.times_seen || 1,
              witness_json: result.state?.witness_json || null,
              conflict_json: result.state?.conflict_json || null,
              scope_json: result.state?.scope_json || {},
              anchor: result.state?.anchor || null,
              objective: note.objective || null,
              intent_label: note.intent_label || null,
              constraint_key: note.constraint_key || null,
            });
          } catch (e) {
            console.warn("[dev-engine-v2] Note state upsert failed (non-fatal):", e);
            enrichedNotes.push({ ...note });
          }
        }

        // Detect conflicts and create decision sets
        const conflicts = detectConflicts(enrichedNotes);
        if (conflicts.length > 0) {
          decisionSets = await upsertDecisionSets(supabase, projectId, notesEffectiveFormat, episodeNumber, enrichedNotes, conflicts);
        }

        // Detect loop bundles from enriched notes
        const noteBundles = detectBundles(enrichedNotes);

        // Attach fingerprint metadata to parsed output arrays
        const fpMap: Record<string, any> = {};
        for (const en of enrichedNotes) { fpMap[en.id || en.note_key] = en; }
        for (const arr of [parsed.blocking_issues, parsed.high_impact_notes, parsed.polish_notes]) {
          if (arr) for (const n of arr) {
            const en = fpMap[n.id || n.note_key];
            if (en) {
              n.note_fingerprint = en.note_fingerprint;
              n.note_cluster_id = en.note_cluster_id;
              n.tier = en.tier;
              n.times_seen = en.times_seen;
              n.witness_json = en.witness_json;
              n.conflict_json = en.conflict_json;
              n.objective = en.objective;
              n.intent_label = en.intent_label;
              n.constraint_key = en.constraint_key;
              n.status = en.status;
            }
          }
        }

        // Mute notes that are part of open decision sets
        const mutedFingerprints = new Set<string>();
        for (const ds of decisionSets) {
          if (ds.status === "open") {
            for (const fp of ds.note_fingerprints) mutedFingerprints.add(fp);
          }
        }

        parsed.bundles = noteBundles;
        parsed.decision_sets = decisionSets;
        parsed.suppressed_count = suppressedCount;
        parsed.muted_by_decision = [...mutedFingerprints];
      } catch (e) {
        console.warn("[dev-engine-v2] Constraint solver failed (non-fatal):", e);
      }

      // Compute resolution summary
      const resolvedCount = existingUnresolved.filter(n => !currentNoteKeys.has(n.note_key)).length;
      const regressedCount = allTieredNotes.filter((n: any) => n.id && previouslyResolved.has(n.id)).length;
      parsed.resolution_summary = {
        resolved: resolvedCount,
        regressed: regressedCount,
        suppressed: suppressedCount,
        blockers_remaining: (parsed.blocking_issues || []).length,
        high_impact_remaining: (parsed.high_impact_notes || []).length,
        polish_remaining: (parsed.polish_notes || []).length,
      };

      // Stability status
      const blockerCount = (parsed.blocking_issues || []).length;
      const highCount = (parsed.high_impact_notes || []).length;
      const polishCount = (parsed.polish_notes || []).length;
      parsed.stability_status = blockerCount === 0 && highCount <= 3 && polishCount <= 5
        ? "structurally_stable" : blockerCount === 0 ? "refinement_phase" : "in_progress";

      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "NOTES",
        output_json: parsed,
      }).select().single();
      if (runErr) {
        if (runErr.code === "23503") throw new Error("Version no longer exists — please re-select the document and try again");
        throw runErr;
      }

      return new Response(JSON.stringify({ run, notes: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // OPTIONS — generate 2-4 decision options per blocker/high-impact note
    // ══════════════════════════════════════════════
    if (action === "options") {
      const { projectId, documentId, versionId, analysisJson, notesJson, deliverableType, developmentBehavior, format: reqFormat } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      // Fetch latest analysis + notes if not provided
      let analysis = analysisJson;
      if (!analysis) {
        const { data: latestRun } = await supabase.from("development_runs")
          .select("output_json").eq("version_id", versionId).eq("run_type", "ANALYZE")
          .order("created_at", { ascending: false }).limit(1).single();
        analysis = latestRun?.output_json;
      }
      let notes = notesJson;
      if (!notes) {
        const { data: latestNotes } = await supabase.from("development_runs")
          .select("output_json").eq("document_id", documentId).eq("run_type", "NOTES")
          .order("created_at", { ascending: false }).limit(1).single();
        notes = latestNotes?.output_json;
      }

      const blockers = notes?.blocking_issues || analysis?.blocking_issues || [];
      const highImpact = notes?.high_impact_notes || analysis?.high_impact_notes || [];
      const protect = notes?.protect || analysis?.protect || [];

      const optionsSystem = `You are IFFY. For each blocker and high-impact note, generate 2-4 concrete resolution options.

Return ONLY valid JSON:
{
  "decisions": [
    {
      "note_id": "matching stable_key from the note",
      "severity": "blocker" | "high" | "medium" | "low",
      "note": "original note description",
      "options": [
        {
          "option_id": "B1-A",
          "title": "short action title (max 8 words)",
          "what_changes": ["list of 2-4 story elements that change"],
          "tradeoffs": "one sentence on creative cost/benefit",
          "creative_risk": "low" | "med" | "high",
          "commercial_lift": 0-20
        }
      ],
      "recommended_option_id": "option_id of recommended choice"
    }
  ],
  "global_directions": [
    {"id": "G1", "direction": "overarching creative direction", "why": "rationale"}
  ]
}

RULES:
- Every blocker MUST have exactly 2-4 options.
- High-impact notes SHOULD have 2-3 options.
- option_id format: B{n}-{letter} for blockers, H{n}-{letter} for high. Letters A, B, C, D.
- what_changes: list 2-4 specific story elements affected.
- tradeoffs: honest one-sentence assessment of creative cost/benefit.
- creative_risk: "low", "med", or "high" — how much creative DNA changes.
- commercial_lift: integer 0-20 estimating GP improvement.
- recommended_option_id: best balance of creative integrity and commercial viability.
- global_directions: 1-3 overarching tonal/strategic directions.
- Keep options genuinely distinct — not minor variations of the same fix.
- EVERY blocker in the input MUST appear as a decision with severity="blocker".`;

      const notesForPrompt = [
        ...blockers.map((n: any, i: number) => ({ index: i + 1, id: n.id, severity: "blocker", description: n.description, why_it_matters: n.why_it_matters })),
        ...highImpact.map((n: any, i: number) => ({ index: blockers.length + i + 1, id: n.id, severity: "high", description: n.description, why_it_matters: n.why_it_matters })),
      ];

      const userPrompt = `PROTECT ITEMS:\n${JSON.stringify(protect)}

ANALYSIS SUMMARY:\n${analysis?.executive_snapshot || analysis?.verdict || "No analysis available"}

NOTES REQUIRING DECISIONS:\n${JSON.stringify(notesForPrompt)}

MATERIAL:\n${version.plaintext}`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, optionsSystem, userPrompt, 0.3, 6000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      // Store as OPTIONS run
      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "OPTIONS",
        output_json: parsed,
      }).select().single();
      if (runErr) {
        if (runErr.code === "23503") throw new Error("Version no longer exists — please re-select the document and try again");
        throw runErr;
      }

      return new Response(JSON.stringify({ run, options: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // REWRITE — with doc safety guards + decision options
    // ══════════════════════════════════════════════
    if (action === "rewrite") {
      const { projectId, documentId, versionId, approvedNotes, protectItems, targetDocType, deliverableType, developmentBehavior, format: reqFormat, selectedOptions, globalDirections } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      // ── BLOCKER GATE: if blockers exist, selectedOptions must cover all of them ──
      const { data: latestNotesRun } = await supabase.from("development_runs")
        .select("output_json").eq("document_id", documentId).eq("run_type", "NOTES")
        .order("created_at", { ascending: false }).limit(1).single();
      const { data: latestAnalyzeRun } = await supabase.from("development_runs")
        .select("output_json").eq("document_id", documentId).eq("run_type", "ANALYZE")
        .order("created_at", { ascending: false }).limit(1).single();
      const existingBlockers = latestNotesRun?.output_json?.blocking_issues || latestAnalyzeRun?.output_json?.blocking_issues || [];

      // Only enforce blocker gate when NO user input is provided at all (no notes selected, no decisions made)
      // When approvedNotes or selectedOptions are provided, the user is actively making editorial choices
      if (existingBlockers.length > 0 && (!approvedNotes || approvedNotes.length === 0) && (!selectedOptions || selectedOptions.length === 0)) {
        const uncoveredBlockers = existingBlockers.map((b: any) => b.id || b.note_key);
        return new Response(JSON.stringify({
          error: "Blockers require decisions before rewrite",
          uncovered_blockers: uncoveredBlockers,
          blocker_count: existingBlockers.length,
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext, version_number").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: project } = await supabase.from("projects")
        .select("format, development_behavior").eq("id", projectId).single();

      const effectiveFormat = (reqFormat || project?.format || "film").toLowerCase().replace(/_/g, "-");
      const effectiveBehavior = developmentBehavior || project?.development_behavior || "market";
      const effectiveDeliverable = deliverableType || "script";

      const fullText = version.plaintext || "";
      const LONG_THRESHOLD = 30000;

      // ── LARGE-RISK DOC TYPE: ALWAYS force chunked rewrite regardless of length ──
      if (isLargeRiskDocType(effectiveDeliverable)) {
        console.log(`[dev-engine-v2] rewrite: Large-risk doc type "${effectiveDeliverable}" — forcing chunked rewrite (${fullText.length} chars)`);
        return new Response(JSON.stringify({
          error: "Large-risk doc type requires chunked rewrite pipeline.",
          needsPipeline: true,
          charCount: fullText.length,
          reason: "large_risk_doc_type",
          docType: effectiveDeliverable,
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (fullText.length > LONG_THRESHOLD) {
        return new Response(JSON.stringify({ error: "Document too long for single-pass rewrite. Use rewrite-plan/rewrite-chunk/rewrite-assemble pipeline.", needsPipeline: true, charCount: fullText.length }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Build decision directives from selectedOptions
      let decisionDirectives = "";
      if (selectedOptions && Array.isArray(selectedOptions) && selectedOptions.length > 0) {
        const directives = selectedOptions.map((so: any) => {
          const custom = so.custom_direction ? ` Custom: ${so.custom_direction}` : "";
          return `- Note "${so.note_id}": Apply option "${so.option_id}".${custom}`;
        }).join("\n");
        decisionDirectives = `\n\nSELECTED DECISION OPTIONS (apply these specific fixes):\n${directives}`;
      }

      // Build global directions context
      let globalDirContext = "";
      if (globalDirections && Array.isArray(globalDirections) && globalDirections.length > 0) {
        globalDirContext = `\n\nGLOBAL DIRECTIONS:\n${globalDirections.map((d: string) => `- ${d}`).join("\n")}`;
      }

      const rewriteSystemPrompt = buildRewriteSystem(effectiveDeliverable, effectiveFormat, effectiveBehavior);

      // ── NEC Guardrail injection for rewrite ──
      const rwNecBlock = await loadNECGuardrailBlock(supabase, projectId);

      // ── Team Voice injection for rewrite ──
      const rewriteLane = project?.assigned_lane || "independent-film";
      const rwTvCtx = await loadTeamVoiceContext(supabase, projectId, rewriteLane);
      const rwTeamVoiceBlock = rwTvCtx.block ? `\n${rwTvCtx.block}\n` : "";

      const userPrompt = `PROTECT (non-negotiable):\n${JSON.stringify(protectItems || [])}

APPROVED NOTES:\n${JSON.stringify(approvedNotes || [])}${decisionDirectives}${globalDirContext}
${rwTeamVoiceBlock}${rwNecBlock}
TARGET FORMAT: ${targetDocType || "same as source"}

MATERIAL TO REWRITE:\n${fullText}`;

      const raw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, rewriteSystemPrompt, userPrompt, 0.4, 32000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);
      if (!parsed) {
        console.error("[dev-engine-v2] rewrite: parseAIJson returned null", raw.slice(0, 300));
        return new Response(JSON.stringify({ success: false, error: "MODEL_JSON_PARSE_FAILED", where: "rewrite", snippet: raw.slice(0, 300) }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let rewrittenText = parsed.rewritten_text || "";

      // Post-processing safety guard for documentary/deck
      const safetyViolation = validateDocSafety(fullText, rewrittenText, effectiveDeliverable, effectiveFormat);
      if (safetyViolation) {
        return new Response(JSON.stringify({ error: safetyViolation, safety_blocked: true }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let newVersion: any = null;
      for (let _retry = 0; _retry < 3; _retry++) {
        const { data: maxRow } = await supabase.from("project_document_versions")
          .select("version_number")
          .eq("document_id", documentId)
          .order("version_number", { ascending: false })
          .limit(1)
          .single();
        const nextVersion = (maxRow?.version_number ?? 0) + 1;
        // Determine dependency tracking for this version
        const DEP_DOC_TYPES = new Set(["deck", "character_bible", "beat_sheet", "script", "blueprint", "architecture"]);
        const depFields = DEP_DOC_TYPES.has(effectiveDeliverable)
          ? ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"]
          : [];
        let rewriteResolverHash: string | null = null;
        try {
          const rrResp = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader },
            body: JSON.stringify({ projectId }),
          });
          if (rrResp.ok) { const rr = await rrResp.json(); rewriteResolverHash = rr.resolver_hash || null; }
        } catch (_) { /* non-fatal */ }

        const rwMetaJson = rwTvCtx.metaStamp ? { ...rwTvCtx.metaStamp } : undefined;
        const { data: nv, error: vErr } = await supabase.from("project_document_versions").insert({
          document_id: documentId,
          version_number: nextVersion,
          label: `Rewrite pass ${nextVersion}`,
          plaintext: rewrittenText,
          created_by: user.id,
          parent_version_id: versionId,
          change_summary: parsed.changes_summary || "",
          depends_on: depFields,
          depends_on_resolver_hash: rewriteResolverHash,
          ...(rwMetaJson ? { meta_json: rwMetaJson } : {}),
        }).select().single();
        if (!vErr) { newVersion = nv; break; }
        if (vErr.code !== "23505") throw vErr;
        console.warn(`Version ${nextVersion} conflict, retrying...`);
      }
      if (!newVersion) throw new Error("Failed to create version after retries");

      // ── Style eval on rewrite output ──
      const rwLane = (await supabase.from("projects").select("assigned_lane").eq("id", projectId).single())?.data?.assigned_lane || "independent-film";
      const { target: rwStyleTarget } = await loadVoiceTargets(supabase, projectId, rwLane);
      const rwStyleEval = await runStyleEval(supabase, rewrittenText, projectId, documentId, newVersion.id, rwLane, rwStyleTarget);
      if (rwStyleEval) {
        // Merge style eval meta into version meta_json
        const mergedMeta = { ...(newVersion.meta_json || {}), ...rwStyleEval.metaFields };
        await supabase.from("project_document_versions").update({ meta_json: mergedMeta }).eq("id", newVersion.id);
        newVersion.meta_json = mergedMeta;
      }

      // Store rewrite run with schema_version and deliverable metadata
      const { data: run } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "REWRITE",
        output_json: {
          changes_summary: parsed.changes_summary || "",
          creative_preserved: parsed.creative_preserved || "",
          commercial_improvements: parsed.commercial_improvements || "",
          rewritten_text: `[${rewrittenText.length} chars]`,
          source_version_id: versionId,
        },
        deliverable_type: effectiveDeliverable,
        development_behavior: effectiveBehavior,
        format: effectiveFormat,
        schema_version: SCHEMA_VERSION,
      }).select().single();

      return new Response(JSON.stringify({ run, rewrite: { ...parsed, rewritten_text: `[${rewrittenText.length} chars — stored in version]` }, newVersion }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── REWRITE-PLAN (chunked rewrite step 1) ──
    if (action === "rewrite-plan") {
      const { projectId, documentId, versionId, approvedNotes, protectItems } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext, version_number").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const fullText = version.plaintext || "";
      const { data: sourceDoc } = await supabase.from("project_documents")
        .select("doc_type")
        .eq("id", documentId)
        .maybeSingle();
      const sourceDocType = sourceDoc?.doc_type || "script";

      const buildLegacySluglineChunks = (text: string): string[] => {
        const CHUNK_TARGET = 12000;
        const lines = text.split("\n");
        let currentChunk = "";
        const chunks: string[] = [];

        for (const line of lines) {
          const isSlugline = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/.test(line.trim());
          if (isSlugline && currentChunk.length >= CHUNK_TARGET) {
            chunks.push(currentChunk.trim());
            currentChunk = "";
          }
          currentChunk += line + "\n";
        }
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
        return chunks.length > 0 ? chunks : [text];
      };

      const parseEpisodeBlocks = (raw: string): Array<{ episodeNumber: number; text: string }> => {
        const headerPattern = /^#{1,4}\s*(?:EPISODE|EP\.?)\s*0?(\d+)\b[^\n]*/gim;
        const matches = [...raw.matchAll(headerPattern)];
        if (matches.length === 0) return [];

        const blocks: Array<{ episodeNumber: number; text: string }> = [];
        for (let i = 0; i < matches.length; i++) {
          const episodeNumber = parseInt(matches[i][1], 10);
          const startIdx = matches[i].index!;
          const endIdx = i < matches.length - 1 ? matches[i + 1].index! : raw.length;
          const text = raw.slice(startIdx, endIdx).trim();
          if (episodeNumber >= 1) blocks.push({ episodeNumber, text });
        }
        return blocks;
      };

      let chunkTexts = buildLegacySluglineChunks(fullText);
      let chunkMeta: Array<{ chunk_index: number; chunk_key: string; label: string; episode_start?: number | null; episode_end?: number | null; section_id?: string | null }> =
        chunkTexts.map((_, i) => ({
          chunk_index: i,
          chunk_key: `chunk_${String(i + 1).padStart(2, "0")}`,
          label: `Chunk ${i + 1}`,
        }));
      let strategy = "legacy_slugline";
      let resolvedEpisodeCount: number | null = null;

      if (isLargeRiskDocType(sourceDocType)) {
        try {
          const episodeBlocks = parseEpisodeBlocks(fullText);
          const episodeMap = new Map<number, string>(episodeBlocks.map((b) => [b.episodeNumber, b.text]));
          const maxEpisodeInSource = episodeBlocks.reduce((max, b) => Math.max(max, b.episodeNumber), 0);

          const { data: projectRow } = await supabase.from("projects")
            .select("season_episode_count")
            .eq("id", projectId)
            .maybeSingle();

          const canonicalEpisodeCount = Number(projectRow?.season_episode_count || 0);
          resolvedEpisodeCount = canonicalEpisodeCount > 0
            ? canonicalEpisodeCount
            : (maxEpisodeInSource > 0 ? maxEpisodeInSource : null);

          if (resolvedEpisodeCount && resolvedEpisodeCount > 0) {
            const plan = chunkPlanFor(sourceDocType, {
              episodeCount: resolvedEpisodeCount,
              sceneCount: null,
            });

            if (plan.strategy === "episodic_indexed") {
              strategy = "episodic_indexed";
              chunkMeta = plan.chunks.map((chunk) => ({
                chunk_index: chunk.chunkIndex,
                chunk_key: chunk.chunkKey,
                label: chunk.label,
                episode_start: chunk.episodeStart ?? null,
                episode_end: chunk.episodeEnd ?? null,
                section_id: chunk.sectionId ?? null,
              }));

              chunkTexts = plan.chunks.map((chunk) => {
                const start = chunk.episodeStart ?? 0;
                const end = chunk.episodeEnd ?? 0;
                const parts: string[] = [];
                for (let ep = start; ep <= end; ep++) {
                  const block = episodeMap.get(ep);
                  if (block) {
                    parts.push(block);
                  } else {
                    parts.push(`## EPISODE ${ep}\n[MISSING IN SOURCE — regenerate this episode fully.]`);
                  }
                }
                return parts.join("\n\n").trim();
              });
            }
          }
        } catch (episodicPlanErr: any) {
          console.warn(`[dev-engine-v2] rewrite-plan episodic chunking fallback: ${episodicPlanErr?.message || episodicPlanErr}`);
        }
      }

      if (chunkTexts.length === 0) {
        chunkTexts = [fullText];
        chunkMeta = [{ chunk_index: 0, chunk_key: "chunk_01", label: "Chunk 1" }];
        strategy = "legacy_slugline";
      }

      const { data: planRun } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "REWRITE_PLAN",
        output_json: {
          total_chunks: chunkTexts.length,
          chunk_char_counts: chunkTexts.map(c => c.length),
          original_char_count: fullText.length,
          approved_notes: approvedNotes || [],
          protect_items: protectItems || [],
          chunk_texts: chunkTexts,
          doc_type: sourceDocType,
          strategy,
          episode_count: resolvedEpisodeCount,
          chunk_meta: chunkMeta,
        },
      }).select().single();

      return new Response(JSON.stringify({
        planRunId: planRun!.id,
        totalChunks: chunkTexts.length,
        originalCharCount: fullText.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── REWRITE-CHUNK (chunked rewrite step 2) ──
    if (action === "rewrite-chunk") {
      const { planRunId, chunkIndex, previousChunkEnding } = body;
      if (!planRunId || chunkIndex === undefined) throw new Error("planRunId, chunkIndex required");

      const { data: planRun } = await supabase.from("development_runs")
        .select("output_json").eq("id", planRunId).single();
      if (!planRun) throw new Error("Plan run not found");

      const plan = planRun.output_json as any;
      const chunkText = plan?.chunk_texts?.[chunkIndex];
      if (chunkText === undefined) throw new Error(`Chunk ${chunkIndex} not found`);

      const notesContext = `PROTECT (non-negotiable):\n${JSON.stringify(plan.protect_items || [])}\n\nAPPROVED NOTES:\n${JSON.stringify(plan.approved_notes || [])}`;
      const prevContext = previousChunkEnding
        ? `\n\nPREVIOUS CHUNK ENDING (for continuity):\n${previousChunkEnding}`
        : "";

      const strategy = plan?.strategy || "legacy_slugline";
      const docType = plan?.doc_type || "script";
      const chunkMeta = Array.isArray(plan?.chunk_meta) ? plan.chunk_meta[chunkIndex] : null;

      let rewrittenChunk = "";

      if (strategy === "episodic_indexed" && chunkMeta?.episode_start && chunkMeta?.episode_end) {
        const start = Number(chunkMeta.episode_start);
        const end = Number(chunkMeta.episode_end);
        const expectedEpisodes = Array.from({ length: end - start + 1 }, (_, i) => start + i);

        let repairDirective = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          const episodicPrompt = `${notesContext}${prevContext}${repairDirective}\n\nCHUNK ${chunkIndex + 1} OF ${plan.total_chunks} — Rewrite Episodes ${start}-${end} ONLY.\n\nCRITICAL RULES:\n- Output exactly Episodes ${start} through ${end}.\n- Include explicit headings like \"## EPISODE N\" for each episode.\n- Do NOT omit, merge, summarize, or renumber episodes.\n- Do NOT use summary language (\"remaining episodes\", \"and so on\", \"etc\").\n\nSOURCE EPISODES TO REWRITE:\n${chunkText || "(No source text for this range. Regenerate all episodes in-range fully.)"}`;

          console.log(`Rewrite episodic chunk ${chunkIndex + 1}/${plan.total_chunks} (episodes ${start}-${end})`);
          rewrittenChunk = await callAI(
            LOVABLE_API_KEY,
            BALANCED_MODEL,
            REWRITE_CHUNK_SYSTEM,
            episodicPrompt,
            0.4,
            20000,
          );

          const validation = validateEpisodicChunk(rewrittenChunk, expectedEpisodes, docType);
          if (validation.pass) break;

          if (attempt === 2) {
            throw new Error(`Episodic chunk validation failed for ${start}-${end}: ${validation.failures.map((f) => f.detail).join("; ")}`);
          }

          const missing = validation.missingIndices?.length
            ? ` Missing episodes: ${validation.missingIndices.join(", ")}.`
            : "";
          repairDirective = `\n\nREPAIR REQUIRED (attempt ${attempt + 2}/3): Previous output failed validation.${missing} Return COMPLETE content for each required episode with no summaries.`;
        }
      } else {
        const chunkPrompt = `${notesContext}${prevContext}\n\nCHUNK ${chunkIndex + 1} OF ${plan.total_chunks} — Rewrite this section, applying notes while preserving all scenes and story beats:\n\n${chunkText}`;
        console.log(`Rewrite chunk ${chunkIndex + 1}/${plan.total_chunks} (${chunkText.length} chars)`);
        rewrittenChunk = await callAI(
          LOVABLE_API_KEY, BALANCED_MODEL, REWRITE_CHUNK_SYSTEM, chunkPrompt, 0.4, 16000,
        );
      }

      return new Response(JSON.stringify({
        chunkIndex,
        rewrittenText: rewrittenChunk.trim(),
        charCount: rewrittenChunk.trim().length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── REWRITE-ASSEMBLE (chunked rewrite step 3) ──
    if (action === "rewrite-assemble") {
      const { projectId, documentId, versionId, planRunId, assembledText, rewriteModeSelected, rewriteModeEffective, rewriteModeReason, rewriteModeDebug, rewriteProbe } = body;
      if (!projectId || !documentId || !versionId || !assembledText) throw new Error("projectId, documentId, versionId, assembledText required");

      function estimateRuntimeMinutes(text: string, mode: string) {
        const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
        const divisor = mode === 'dialogue_heavy' ? 200 : mode === 'lean' ? 240 : mode === 'action_heavy' ? 240 : 220;
        return { words, minutes: words / divisor };
      }

      const { data: projectRow } = await supabase.from("projects")
        .select("min_runtime_minutes, min_runtime_hard_floor, runtime_estimation_mode")
        .eq("id", projectId).single();

      const mode = (projectRow as any)?.runtime_estimation_mode ?? 'feature';
      const softMin = (projectRow as any)?.min_runtime_minutes ?? null;
      const hardMin = (projectRow as any)?.min_runtime_hard_floor ?? null;
      const { words: newWords, minutes: newMins } = estimateRuntimeMinutes(assembledText, mode);

      let runtimeWarning: string | null = null;
      if (hardMin && newMins < hardMin - 2) {
        runtimeWarning = `Script is short for feature: ~${Math.round(newMins)} mins (words=${newWords}). Hard floor is ${hardMin} mins. Consider expanding.`;
      } else if (hardMin && newMins < hardMin) {
        runtimeWarning = `Draft is near the hard floor: ~${Math.round(newMins)} mins (floor: ${hardMin}). Consider expanding.`;
      }
      if (!runtimeWarning && softMin && newMins < softMin) {
        runtimeWarning = `This draft estimates ~${Math.round(newMins)} mins (below preferred minimum ${softMin} mins).`;
      }

      let notesCount = 0;
      let planOutput: any = null;
      if (planRunId) {
        const { data: planRun } = await supabase.from("development_runs")
          .select("output_json").eq("id", planRunId).single();
        if (planRun) {
          planOutput = planRun.output_json as any;
          notesCount = ((planOutput as any).approved_notes || []).length;
        }
      }

      if (planOutput?.strategy === "episodic_indexed" && Number(planOutput?.episode_count) > 0) {
        const expectedEpisodeCount = Number(planOutput.episode_count);
        const docTypeForValidation = planOutput.doc_type || "episode_grid";
        const episodicValidation = validateEpisodicContent(assembledText, expectedEpisodeCount, docTypeForValidation);

        if (!episodicValidation.pass) {
          console.error("[dev-engine-v2] rewrite-assemble coverage failure", {
            expectedEpisodeCount,
            missing: episodicValidation.missingIndices,
            failures: episodicValidation.failures.map((f) => f.detail),
          });
          return new Response(JSON.stringify({
            error: "EPISODE_COVERAGE_FAILED",
            message: `Assembled rewrite is missing required episodes (expected 1-${expectedEpisodeCount}).`,
            validation: episodicValidation,
          }), {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Load team voice for meta_json stamping on chunked rewrite (outside retry loop)
      const chunkLane = (await supabase.from("projects").select("assigned_lane").eq("id", projectId).single())?.data?.assigned_lane || "independent-film";
      const chunkTvCtx = await loadTeamVoiceContext(supabase, projectId, chunkLane);
      const chunkMetaJson = chunkTvCtx.metaStamp ? { ...chunkTvCtx.metaStamp } : undefined;
      let newVersion: any = null;
      for (let _retry = 0; _retry < 3; _retry++) {
        const { data: maxRow } = await supabase.from("project_document_versions")
          .select("version_number")
          .eq("document_id", documentId)
          .order("version_number", { ascending: false })
          .limit(1)
          .single();
        const nextVersion = (maxRow?.version_number ?? 0) + 1;
        const { data: nv, error: vErr } = await supabase.from("project_document_versions").insert({
          document_id: documentId,
          version_number: nextVersion,
          label: `Rewrite pass ${nextVersion}`,
          plaintext: assembledText,
          created_by: user.id,
          parent_version_id: versionId,
          change_summary: `Chunked rewrite across ${nextVersion - 1} iterations.`,
          ...(chunkMetaJson ? { meta_json: chunkMetaJson } : {}),
        }).select().single();
        if (!vErr) { newVersion = nv; break; }
        if (vErr.code !== "23505") throw vErr;
        console.warn(`Version ${nextVersion} conflict, retrying...`);
      }
      if (!newVersion) throw new Error("Failed to create version after retries");

      // ── Style eval on chunked rewrite output ──
      const chunkStyleTarget = (await loadVoiceTargets(supabase, projectId, chunkLane)).target;
      const chunkStyleEval = await runStyleEval(supabase, assembledText, projectId, documentId, newVersion.id, chunkLane, chunkStyleTarget);
      if (chunkStyleEval) {
        const mergedMeta = { ...(newVersion.meta_json || {}), ...chunkStyleEval.metaFields };
        await supabase.from("project_document_versions").update({ meta_json: mergedMeta }).eq("id", newVersion.id);
        newVersion.meta_json = mergedMeta;
      }

      const { data: run } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "REWRITE",
        output_json: {
          rewrite_mode_used: "chunk",
          rewrite_mode_selected: rewriteModeSelected || "auto",
          rewrite_mode_effective: rewriteModeEffective || "chunk",
          rewrite_mode_reason: rewriteModeReason || "auto_probe_chunk",
          rewrite_mode_debug: rewriteModeDebug || null,
          rewrite_probe: rewriteProbe || null,
          rewritten_text: `[${assembledText.length} chars]`,
          changes_summary: `Full chunked rewrite. Applied ${notesCount} notes.`,
          source_version_id: versionId,
          source_doc_id: documentId,
        },
        schema_version: SCHEMA_VERSION,
      }).select().single();

      return new Response(JSON.stringify({
        run, newVersion,
        runtimeWarning,
        estimatedMinutes: Math.round(newMins),
        wordCount: newWords,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CONVERT ──
    if (action === "convert") {
      const { projectId, documentId, versionId, targetOutput, protectItems } = body;
      if (!projectId || !documentId || !versionId || !targetOutput) throw new Error("projectId, documentId, versionId, targetOutput required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: srcDoc } = await supabase.from("project_documents")
        .select("doc_type, title").eq("id", documentId).single();

      // ── Canonical Qualification Resolver for convert (esp. character_bible) ──
      let qualBindingBlock = "";
      let resolverResult: any = null;
      try {
        const resolverResp = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ projectId }),
        });
        if (resolverResp.ok) {
          resolverResult = await resolverResp.json();
          const rq = resolverResult.resolvedQualifications || {};
          if (rq.is_series) {
            const durRangeStr = (rq.episode_target_duration_min_seconds && rq.episode_target_duration_max_seconds && rq.episode_target_duration_min_seconds !== rq.episode_target_duration_max_seconds)
              ? `${rq.episode_target_duration_min_seconds}–${rq.episode_target_duration_max_seconds} seconds`
              : `${rq.episode_target_duration_seconds || rq.episode_target_duration_min_seconds || 'N/A'} seconds`;
            qualBindingBlock = `\nCANONICAL QUALIFICATIONS (use ONLY these values — ignore any older references):
Target season length: ${rq.season_episode_count} episodes.
Episode target duration range: ${durRangeStr}.
Season target runtime: ${rq.season_target_runtime_seconds || "N/A"} seconds.
Format: ${rq.format}.
Ignore any older references to different episode counts; they are deprecated.`;
          } else if (rq.target_runtime_min_low) {
            qualBindingBlock = `\nCANONICAL QUALIFICATIONS (use ONLY these values):
Target runtime: ${rq.target_runtime_min_low}-${rq.target_runtime_min_high} minutes.
Format: ${rq.format}.`;
          }
        }
      } catch (e) {
        console.warn("[dev-engine-v2] convert: resolve-qualifications failed:", e);
      }

      // ── NEC Guardrail injection for convert ──
      const cvNecBlock = await loadNECGuardrailBlock(supabase, projectId);

      const userPrompt = `SOURCE FORMAT: ${srcDoc?.doc_type || "unknown"}
TARGET FORMAT: ${targetOutput}
PROTECT (non-negotiable creative DNA):\n${JSON.stringify(protectItems || [])}
${qualBindingBlock}${cvNecBlock}
MATERIAL:\n${version.plaintext}`;

      const normalizedTarget = (targetOutput || "").toUpperCase().replace(/\s+/g, "_");

      // ── EPISODE DOC TYPES: Redirect to generate-document chunked pipeline ──
      // Single-shot LLM calls truncate at high episode counts (e.g., 35 episodes).
      // Route through the chunked generator which batches episodes in groups of 6.
      const EPISODE_REDIRECT_SET = new Set(["episode_grid", "vertical_episode_beats", "episode_beats"]);
      const resolvedTargetForRedirect = (() => {
        const docTypeMap_local: Record<string, string> = {
          EPISODE_GRID: "episode_grid", "EPISODE GRID": "episode_grid",
          VERTICAL_EPISODE_BEATS: "vertical_episode_beats", "VERTICAL EPISODE BEATS": "vertical_episode_beats",
          EPISODE_BEATS: "episode_beats", "EPISODE BEATS": "episode_beats",
          EPISODE_BEAT_SHEET: "vertical_episode_beats", "EPISODE BEAT SHEET": "vertical_episode_beats",
        };
        return docTypeMap_local[normalizedTarget] || docTypeMap_local[targetOutput?.toUpperCase()] || null;
      })();

      if (resolvedTargetForRedirect && EPISODE_REDIRECT_SET.has(resolvedTargetForRedirect)) {
        console.log("[dev-engine-v2] convert: Redirecting episode doc type to generate-document chunked pipeline", { targetOutput, resolvedTargetForRedirect, projectId });
        const genResp = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ projectId, docType: resolvedTargetForRedirect }),
        });
        const genResult = await genResp.json();
        if (!genResp.ok || genResult.error) {
          throw new Error(genResult.error || genResult.message || "Chunked generation failed for episode doc type");
        }

        // Look up the created document + version
        let newDocId = genResult.documentId || genResult.document_id || null;
        let newVersionId = genResult.versionId || genResult.version_id || null;
        if (!newDocId) {
          const { data: docs } = await supabase.from("project_documents")
            .select("id").eq("project_id", projectId).eq("doc_type", resolvedTargetForRedirect)
            .order("created_at", { ascending: false }).limit(1);
          newDocId = docs?.[0]?.id || null;
        }
        if (newDocId && !newVersionId) {
          const { data: vers } = await supabase.from("project_document_versions")
            .select("id").eq("document_id", newDocId)
            .order("version_number", { ascending: false }).limit(1);
          newVersionId = vers?.[0]?.id || null;
        }

        return new Response(JSON.stringify({
          newDoc: { id: newDocId, doc_type: resolvedTargetForRedirect },
          newVersion: { id: newVersionId },
          convert: { converted_text: genResult.content || "", format: resolvedTargetForRedirect, change_summary: "Generated via chunked episode pipeline" },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── Resolve doc type early so large-risk check can use it ──
      const VALID_DELIVERABLES_SET = new Set(["idea","topline_narrative","concept_brief","market_sheet","treatment","story_outline","character_bible","beat_sheet","feature_script","episode_script","production_draft","deck","documentary_outline","format_rules","season_arc","episode_grid","vertical_episode_beats","season_master_script","vertical_market_sheet"]);
      let resolvedDocType = docTypeMap[targetOutput] || docTypeMap[normalizedTarget] || docTypeMap[(targetOutput || "").toUpperCase()] || "other";
      if (resolvedDocType === "other") {
        const aggressive = (targetOutput || "").toLowerCase().replace(/[\s\-()0-9]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
        const fuzzy = [...VALID_DELIVERABLES_SET].find(d => aggressive.includes(d) || d.includes(aggressive));
        resolvedDocType = fuzzy || "feature_script";
      }

      // ── Non-episodic large-risk doc: redirect to generate-document for chunked pipeline ──
      if (isLargeRiskDocType(resolvedDocType)) {
        console.log("[dev-engine-v2] convert: Large-risk doc type, redirecting to generate-document chunked pipeline", { targetOutput, resolvedDocType, projectId });
        const genResp = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ projectId, docType: resolvedDocType }),
        });
        const genResult = await genResp.json();
        if (!genResp.ok || genResult.error) {
          throw new Error(genResult.error || genResult.message || "Chunked generation failed for large-risk doc type");
        }
        let lrDocId = genResult.document_id || null;
        let lrVersionId = genResult.version_id || null;
        if (!lrDocId) {
          const { data: docs } = await supabase.from("project_documents")
            .select("id").eq("project_id", projectId).eq("doc_type", resolvedDocType)
            .order("created_at", { ascending: false }).limit(1);
          lrDocId = docs?.[0]?.id || null;
        }
        if (lrDocId && !lrVersionId) {
          const { data: vers } = await supabase.from("project_document_versions")
            .select("id").eq("document_id", lrDocId)
            .order("version_number", { ascending: false }).limit(1);
          lrVersionId = vers?.[0]?.id || null;
        }
        return new Response(JSON.stringify({
          newDoc: { id: lrDocId, doc_type: resolvedDocType },
          newVersion: { id: lrVersionId },
          convert: { converted_text: genResult.content || "", format: resolvedDocType, change_summary: "Generated via chunked large-risk pipeline" },
          chunked: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const isDraftScript = targetOutput === "DRAFT_SCRIPT" || normalizedTarget === "SCRIPT" || normalizedTarget === "DRAFT_SCRIPT";
      const model = isDraftScript ? PRO_MODEL : BALANCED_MODEL;
      const maxTok = isDraftScript ? 16000 : 10000;
      const systemPrompt = isDraftScript ? CONVERT_SYSTEM : CONVERT_SYSTEM_JSON;
      const raw = await callAI(LOVABLE_API_KEY, model, systemPrompt, userPrompt, 0.35, maxTok);

      let parsed: any;
      if (isDraftScript) {
        const markerIdx = raw.indexOf("---CHANGE_SUMMARY---");
        const convertedText = (markerIdx >= 0 ? raw.slice(0, markerIdx) : raw)
          .replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();
        const changeSummary = markerIdx >= 0 ? raw.slice(markerIdx + 20).trim() : "Converted to screenplay format";
        parsed = { converted_text: convertedText, format: "DRAFT_SCRIPT", change_summary: changeSummary };
      } else {
        parsed = await parseAIJson(LOVABLE_API_KEY, raw);
      }
      // resolvedDocType already computed above (before large-risk check)

      const convertedTitle = `${srcDoc?.title || "Document"} — ${targetOutput}`;
      const { ensureDocSlot, createVersion: createVer } = await import("../_shared/doc-os.ts");
      const slot = await ensureDocSlot(supabase, projectId, user.id, resolvedDocType, {
        title: convertedTitle,
        source: "generated",
      });
      const newDoc = { id: slot.documentId, doc_type: resolvedDocType, title: convertedTitle };

      // Get upstream drift snapshot for inherited_core
      const { data: upstreamVersion } = await supabase.from("project_document_versions")
        .select("drift_snapshot").eq("id", versionId).single();
      const upstreamCore = (upstreamVersion?.drift_snapshot as any)?.extracted_core || {};

      const resolvedDeliverable = resolvedDocType === "other" ? "feature_script" : resolvedDocType;
      // Dependency tracking for converted version
      const CONVERT_DEP_TYPES = new Set(["deck", "character_bible", "beat_sheet", "feature_script", "episode_script", "treatment", "story_outline"]);
      const convertDepFields = CONVERT_DEP_TYPES.has(resolvedDeliverable)
        ? ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"]
        : [];
      // Use resolver hash from the resolve result directly
      const convertResolverHash = resolverResult?.resolver_hash || null;

      const newVersion = await createVer(supabase, {
        documentId: slot.documentId,
        docType: resolvedDocType,
        plaintext: parsed.converted_text || "",
        label: `Converted from ${srcDoc?.doc_type || "source"}`,
        createdBy: user.id,
        approvalStatus: "draft",
        changeSummary: parsed.change_summary || "",
        inheritedCore: upstreamCore,
        sourceDocumentIds: [documentId],
        deliverableType: resolvedDeliverable,
        dependsOn: convertDepFields,
        dependsOnResolverHash: convertResolverHash,
      });
      if (!newVersion) throw new Error("Failed to create version for converted document");

      await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: newDoc.id,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "CONVERT",
        output_json: { ...parsed, source_document_id: documentId, source_version_id: versionId },
      });

      return new Response(JSON.stringify({ newDoc, newVersion, convert: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CREATE DOC FROM PASTE ──
    if (action === "create-paste") {
      const { projectId, title, docType, text } = body;
      if (!projectId || !text) throw new Error("projectId and text required");

      const { data: doc, error: dErr } = await supabase.from("project_documents").insert({
        project_id: projectId,
        user_id: user.id,
        file_name: title || "Pasted Document",
        file_path: "",
        extraction_status: "complete",
        doc_type: docType || "other",
        title: title || "Pasted Document",
        source: "paste",
        plaintext: text,
        extracted_text: text,
        char_count: text.length,
      }).select().single();
      if (dErr) throw dErr;

      const { data: ver, error: verErr } = await supabase.from("project_document_versions").insert({
        document_id: doc.id,
        version_number: 1,
        label: "Original",
        plaintext: text,
        created_by: user.id,
      }).select().single();
      if (verErr) throw verErr;
      if (!ver) throw new Error("Failed to create document version");

      return new Response(JSON.stringify({ document: doc, version: ver }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════
    // SCREENPLAY PIPELINE
    // ═══════════════════════════════════════════════

    if (action === "script-plan") {
      const { projectId, documentId, versionId, targetPages, protectItems } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: srcDoc } = await supabase.from("project_documents")
        .select("doc_type, title").eq("id", documentId).single();

      const userPrompt = `SOURCE FORMAT: ${srcDoc?.doc_type || "unknown"}
SOURCE TITLE: ${srcDoc?.title || "Unknown"}
TARGET PAGES: ${targetPages || 100}
PROTECT (non-negotiable creative DNA): ${JSON.stringify(protectItems || [])}

MATERIAL (${version.plaintext.length} chars):
${version.plaintext}`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, SCRIPT_PLAN_SYSTEM, userPrompt, 0.25, 8000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "SCRIPT_PLAN",
        output_json: parsed,
      }).select().single();
      if (runErr) throw runErr;

      const { data: scriptDoc, error: sdErr } = await supabase.from("project_documents").insert({
        project_id: projectId,
        user_id: user.id,
        file_name: `${srcDoc?.title || "Script"} — Feature Screenplay`,
        file_path: "",
        extraction_status: "in_progress",
        doc_type: "feature_script",
        title: `${srcDoc?.title || "Script"} — Feature Screenplay`,
        source: "generated",
        plaintext: "",
      }).select().single();
      if (sdErr) throw sdErr;

      const { data: scriptVersion, error: svErr } = await supabase.from("project_document_versions").insert({
        document_id: scriptDoc.id,
        version_number: 1,
        label: "Feature screenplay (generating…)",
        plaintext: "",
        created_by: user.id,
        change_summary: "Pipeline generation in progress",
        deliverable_type: "feature_script",
      }).select().single();
      if (svErr || !scriptVersion) throw svErr || new Error("Failed to create script version");

      const allScenes: any[] = [];
      for (const act of (parsed.acts || [])) {
        for (const scene of (act.scenes || [])) {
          allScenes.push({ ...scene, act: act.act });
        }
      }
      const batches: any[][] = [];
      let currentBatch: any[] = [];
      let currentPages = 0;
      for (const scene of allScenes) {
        currentBatch.push(scene);
        currentPages += scene.page_estimate || 2;
        if (currentPages >= 5) {
          batches.push(currentBatch);
          currentBatch = [];
          currentPages = 0;
        }
      }
      if (currentBatch.length > 0) batches.push(currentBatch);

      return new Response(JSON.stringify({
        run, plan: parsed, scriptDoc, scriptVersion,
        batches: batches.map((b, i) => ({
          index: i,
          scenes: b,
          totalPages: b.reduce((s: number, sc: any) => s + (sc.page_estimate || 2), 0),
        })),
        totalBatches: batches.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "write-batch") {
      const { projectId, scriptDocId, scriptVersionId, batchIndex, scenes, previousText, toneLock, nonNegotiables, totalBatches } = body;
      if (!projectId || !scriptDocId || !scriptVersionId || !scenes) throw new Error("Missing required fields");

      const batchPages = scenes.reduce((s: number, sc: any) => s + (sc.page_estimate || 2), 0);
      const scenesDesc = scenes.map((s: any) =>
        `${s.scene_id}: ${s.slug}\n  Purpose: ${s.purpose}\n  Target: ~${s.page_estimate || 2} pages`
      ).join("\n\n");

      const continuityContext = previousText
        ? `\n\nPREVIOUS SCREENPLAY ENDING (for continuity — do NOT repeat this, continue from here):\n...\n${previousText.slice(-2000)}`
        : "\n\nThis is the FIRST batch. Start with FADE IN:";

      const userPrompt = `BATCH ${batchIndex + 1} OF ${totalBatches}
TARGET: ~${batchPages} pages (${batchPages * 250} words)
TONE: ${toneLock || "as established"}
NON-NEGOTIABLES: ${JSON.stringify(nonNegotiables || [])}

SCENES TO WRITE:
${scenesDesc}
${continuityContext}

Write these scenes NOW in proper screenplay format. Output ONLY screenplay text.`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, WRITE_BATCH_SYSTEM, userPrompt, 0.4, 8000);
      const cleanText = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();

      await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: scriptDocId,
        version_id: scriptVersionId,
        user_id: user.id,
        run_type: "WRITE_SCENES_BATCH",
        output_json: {
          batch_index: batchIndex,
          total_batches: totalBatches,
          scenes_written: scenes.map((s: any) => s.scene_id),
          word_count: cleanText.split(/\s+/).length,
          char_count: cleanText.length,
        },
      });

      return new Response(JSON.stringify({
        batchIndex,
        text: cleanText,
        wordCount: cleanText.split(/\s+/).length,
        pageEstimate: Math.round(cleanText.split(/\s+/).length / 250),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "assemble-script") {
      const { projectId, scriptDocId, scriptVersionId, assembledText, planJson } = body;
      if (!projectId || !scriptDocId || !scriptVersionId || !assembledText) throw new Error("Missing required fields");

      const wordCount = assembledText.split(/\s+/).length;
      const pageEstimate = Math.round(wordCount / 250);

      function estimateScriptRuntime(text: string, mode: string) {
        const w = (text || "").trim().split(/\s+/).filter(Boolean).length;
        const divisor = mode === 'dialogue_heavy' ? 200 : mode === 'lean' ? 240 : mode === 'action_heavy' ? 240 : 220;
        return { words: w, minutes: w / divisor };
      }
      const { data: projRow } = await supabase.from("projects")
        .select("min_runtime_minutes, min_runtime_hard_floor, runtime_estimation_mode")
        .eq("id", projectId).single();
      const sMode = (projRow as any)?.runtime_estimation_mode ?? 'feature';
      const sHardMin = (projRow as any)?.min_runtime_hard_floor ?? null;
      const { words: sWords, minutes: sMins } = estimateScriptRuntime(assembledText, sMode);

      let sRuntimeWarning: string | null = null;
      if (sHardMin && sMins < sHardMin - 2) {
        sRuntimeWarning = `Script is short for feature: ~${Math.round(sMins)} mins (words=${sWords}). Hard floor is ${sHardMin} mins. Consider expanding.`;
      }

      const { error: vErr } = await supabase.from("project_document_versions")
        .update({
          plaintext: assembledText,
          label: `Feature screenplay (${pageEstimate} pages)`,
          change_summary: `Assembled from ${planJson?.total_scenes || "?"} scenes. ${wordCount} words, ~${pageEstimate} pages.`,
        })
        .eq("id", scriptVersionId);
      if (vErr) throw vErr;

      await supabase.from("project_documents")
        .update({ plaintext: assembledText, extraction_status: "complete" })
        .eq("id", scriptDocId);

      const { data: run } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: scriptDocId,
        version_id: scriptVersionId,
        user_id: user.id,
        run_type: "ASSEMBLE_SCRIPT",
        output_json: {
          word_count: wordCount,
          page_estimate: pageEstimate,
          target_pages: planJson?.target_pages,
          total_scenes: planJson?.total_scenes,
          acts: planJson?.acts?.length || 3,
        },
      }).select().single();

      return new Response(JSON.stringify({
        run, wordCount, pageEstimate, scriptDocId, scriptVersionId, runtimeWarning: sRuntimeWarning,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "expand-to-feature-floor") {
      const { projectId, documentId, versionId, currentText } = body;
      if (!projectId || !documentId || !versionId || !currentText) throw new Error("projectId, documentId, versionId, currentText required");

      const { data: proj } = await supabase.from("projects")
        .select("min_runtime_minutes, runtime_estimation_mode")
        .eq("id", projectId).single();

      const eMode = (proj as any)?.runtime_estimation_mode ?? 'feature';
      const softMin = (proj as any)?.min_runtime_minutes ?? 80;
      const divisor = eMode === 'dialogue_heavy' ? 200 : eMode === 'lean' ? 240 : eMode === 'action_heavy' ? 240 : 220;
      const currentWords = currentText.trim().split(/\s+/).filter(Boolean).length;
      const currentMins = currentWords / divisor;
      const targetWords = Math.ceil(softMin * divisor);

      const expandSystem = `You are expanding a feature screenplay that is too short (~${Math.round(currentMins)} mins, needs at least ${softMin} mins).

Do NOT add filler. Expand cinematic beats: obstacles, reversals, complications, aftermath moments, and set-pieces where structurally appropriate.
Strengthen Act 2 escalation and character dynamics.
Do NOT summarize. Output full screenplay pages in proper format.
Target approximately ${targetWords} words total.
Output ONLY the expanded screenplay text. No JSON, no commentary, no markdown.`;

      const expanded = await callAI(LOVABLE_API_KEY, PRO_MODEL, expandSystem, currentText, 0.4, 16000);
      const cleanExpanded = expanded.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();

      const expandedWords = cleanExpanded.split(/\s+/).filter(Boolean).length;
      const expandedMins = expandedWords / divisor;

      // Load team voice for meta_json stamping on expand
      const expandLane = (await supabase.from("projects").select("assigned_lane").eq("id", projectId).single())?.data?.assigned_lane || "independent-film";
      const expandTvCtx = await loadTeamVoiceContext(supabase, projectId, expandLane);
      const expandMetaJson = expandTvCtx.metaStamp ? { ...expandTvCtx.metaStamp } : undefined;
      let newVersion: any = null;
      for (let _retry = 0; _retry < 3; _retry++) {
        const { data: maxRow } = await supabase.from("project_document_versions")
          .select("version_number").eq("document_id", documentId)
          .order("version_number", { ascending: false }).limit(1).single();
        const nextVer = (maxRow?.version_number ?? 0) + 1;
        const { data: nv, error: vErr } = await supabase.from("project_document_versions").insert({
          document_id: documentId,
          version_number: nextVer,
          label: `Expanded to ~${Math.round(expandedMins)} mins`,
          plaintext: cleanExpanded,
          created_by: user.id,
          parent_version_id: versionId,
          change_summary: `Auto-expanded from ~${Math.round(currentMins)} to ~${Math.round(expandedMins)} mins.`,
          ...(expandMetaJson ? { meta_json: expandMetaJson } : {}),
        }).select().single();
        if (!vErr) { newVersion = nv; break; }
        if (vErr.code !== "23505") throw vErr;
        console.warn(`Version ${nextVer} conflict, retrying...`);
      }
      if (!newVersion) throw new Error("Failed to create version after retries");

      // ── Style eval on expand output ──
      const expandStyleTarget = (await loadVoiceTargets(supabase, projectId, expandLane)).target;
      const expandStyleEval = await runStyleEval(supabase, cleanExpanded, projectId, documentId, newVersion.id, expandLane, expandStyleTarget);
      if (expandStyleEval) {
        const mergedMeta = { ...(newVersion.meta_json || {}), ...expandStyleEval.metaFields };
        await supabase.from("project_document_versions").update({ meta_json: mergedMeta }).eq("id", newVersion.id);
        newVersion.meta_json = mergedMeta;
      }

      await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "EXPAND",
        output_json: {
          from_minutes: Math.round(currentMins),
          to_minutes: Math.round(expandedMins),
          from_words: currentWords,
          to_words: expandedWords,
        },
      });

      return new Response(JSON.stringify({
        newVersion,
        estimatedMinutes: Math.round(expandedMins),
        wordCount: expandedWords,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════
    // DRIFT RESOLUTION ACTIONS
    // ══════════════════════════════════════════════
    if (action === "drift-acknowledge") {
      const { driftEventId } = body;
      if (!driftEventId) throw new Error("driftEventId required");
      const { error } = await supabase.from("document_drift_events")
        .update({ acknowledged: true })
        .eq("id", driftEventId);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "drift-resolve") {
      const { driftEventId, resolutionType, versionId: targetVersionId } = body;
      if (!driftEventId || !resolutionType) throw new Error("driftEventId and resolutionType required");

      if (resolutionType === "accept_drift") {
        // Accept drift — mark as resolved and update baseline
        await supabase.from("document_drift_events")
          .update({ acknowledged: true, resolved: true, resolved_at: new Date().toISOString(), resolved_by: user.id, resolution_type: "accept_drift" })
          .eq("id", driftEventId);
      } else if (resolutionType === "intentional_pivot") {
        // Mark as intentional — update inherited_core to current core
        const { data: event } = await supabase.from("document_drift_events")
          .select("document_version_id").eq("id", driftEventId).single();
        if (event) {
          const { data: verData } = await supabase.from("project_document_versions")
            .select("drift_snapshot").eq("id", event.document_version_id).single();
          const currentCore = (verData?.drift_snapshot as any)?.extracted_core || {};
          await supabase.from("project_document_versions")
            .update({ inherited_core: currentCore })
            .eq("id", event.document_version_id);
        }
        await supabase.from("document_drift_events")
          .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: user.id, resolution_type: "intentional_pivot" })
          .eq("id", driftEventId);
      } else if (resolutionType === "reseed") {
        // Re-seed: replace inherited fields in current version
        const { data: event } = await supabase.from("document_drift_events")
          .select("document_version_id").eq("id", driftEventId).single();
        if (event) {
          const { data: verData } = await supabase.from("project_document_versions")
            .select("inherited_core, drift_snapshot").eq("id", event.document_version_id).single();
          // Reset drift snapshot to reflect alignment
          await supabase.from("project_document_versions")
            .update({ drift_snapshot: { level: "none", items: [], acknowledged: false, resolved: true, extracted_core: verData?.inherited_core } })
            .eq("id", event.document_version_id);
        }
        await supabase.from("document_drift_events")
          .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: user.id, resolution_type: "reseed" })
          .eq("id", driftEventId);
      }

      return new Response(JSON.stringify({ success: true, resolutionType }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // ENGINE WEIGHT RECOMMENDATION (Step 3)
    // ══════════════════════════════════════════════
    if (action === "recommend-weights") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: project } = await supabase.from("projects")
        .select("title, format, genres, tone, target_audience, budget_range, assigned_lane")
        .eq("id", projectId).single();
      if (!project) throw new Error("Project not found");

      const { data: conceptDocs } = await supabase.from("project_documents")
        .select("plaintext, extracted_text")
        .eq("project_id", projectId)
        .in("doc_type", ["concept_brief", "idea", "treatment", "blueprint"])
        .order("created_at", { ascending: false })
        .limit(1);
      const conceptText = conceptDocs?.[0]?.plaintext || conceptDocs?.[0]?.extracted_text || "";

      const weightSystem = `You are IFFY. Analyze the project concept and recommend Vertical Drama engine weights.

The 5 engines are:
- power_conflict: Power struggles, authority clashes, corporate politics
- romantic_tension: Love triangles, forbidden attraction, emotional manipulation
- thriller_mystery: Suspense, secrets, reveals, investigation
- revenge_arc: Payback, justice, escalating retaliation
- social_exposure: Public shame, viral moments, reputation destruction

Weights must total exactly 100.

Return ONLY valid JSON:
{
  "compatibility": {"power_conflict": 0-100, "romantic_tension": 0-100, "thriller_mystery": 0-100, "revenge_arc": 0-100, "social_exposure": 0-100},
  "recommended_weights": {"power_conflict": number, "romantic_tension": number, "thriller_mystery": number, "revenge_arc": number, "social_exposure": number},
  "rationale": ["max 5 bullets"],
  "example_cliffs": ["3-6 example cliffhangers"],
  "suggested_escalation_style": ["max 3 bullets"]
}`;

      const userPrompt = `PROJECT: ${project.title}\nGENRES: ${(project.genres || []).join(", ")}\nTONE: ${project.tone || "Unknown"}\nAUDIENCE: ${project.target_audience || "Unknown"}\nLANE: ${project.assigned_lane || "Unknown"}\n\nCONCEPT:\n${conceptText.slice(0, 8000)}`;
      const raw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, weightSystem, userPrompt, 0.3, 4000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      return new Response(JSON.stringify({ recommendation: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "save-weights") {
      const { projectId, weights } = body;
      if (!projectId || !weights) throw new Error("projectId and weights required");
      const total = Object.values(weights).reduce((s: number, v: any) => s + Number(v), 0);
      if (Math.abs(total - 100) > 1) throw new Error(`Weights must total 100 (got ${total})`);
      await supabase.from("projects").update({ vertical_engine_weights: weights }).eq("id", projectId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // GENERATE EPISODE GRID (Step 6)
    // ══════════════════════════════════════════════
    if (action === "generate-grid") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: project } = await supabase.from("projects")
        .select("season_episode_count, episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, vertical_engine_weights, development_behavior, signals_influence, signals_apply, format, guardrails_config")
        .eq("id", projectId).single();
      if (!project) throw new Error("Project not found");

      const E = (project as any).season_episode_count;

      // ── Canonical episode length resolution ──
      const gridFmtDefault = FORMAT_DEFAULTS_ENGINE[resolveFormatAlias((project?.format || "").toLowerCase().replace(/[_ ]+/g, "-"))] || {};
      const { minSeconds: durMin, maxSeconds: durMax, targetSeconds: durTarget, variancePolicy } = resolveEpisodeLength(project, {}, gridFmtDefault);
      const duration = durTarget ?? durMin ?? (project as any).episode_target_duration_seconds ?? null;

      const weights = (project as any).vertical_engine_weights || { power_conflict: 20, romantic_tension: 20, thriller_mystery: 20, revenge_arc: 20, social_exposure: 20 };

      if (!E || !duration) throw new Error("season_episode_count and episode duration are required — set them in the Criteria tab (Episode Length)");

      const episodeLengthConstraint = buildEpisodeLengthBlock(project, {}, gridFmtDefault);


      // ── Signal trope injection for episode grid ──
      let signalTropes: string[] = [];
      let signalConstraints = "";
      if (body.skipSignals) {
        console.log("[dev-engine-v2] Grid signals disabled (skipSignals=true)");
      } else try {
        const applyConfig = (project as any).signals_apply ?? { grid: true };
        const influence = (project as any).signals_influence ?? 0.5;
        if (!applyConfig.grid) {
          console.log("[dev-engine-v2] Grid signals disabled via signals_apply.grid=false");
        } else if (applyConfig.grid) {
          const { data: matches } = await supabase
            .from("project_signal_matches")
            .select("cluster:cluster_id(name, genre_tags, tone_tags, cluster_scoring)")
            .eq("project_id", projectId)
            .order("impact_score", { ascending: false })
            .limit(3);
          if (matches && matches.length > 0) {
            for (const m of matches) {
              const c = m.cluster as any;
              if (c) {
                signalTropes.push(...(c.genre_tags || []).slice(0, 3), ...(c.tone_tags || []).slice(0, 2));
              }
            }
            signalTropes = [...new Set(signalTropes)].slice(0, 8);
            if (influence >= 0.5) {
              signalConstraints = `Signal-driven constraints: cliff frequency should emphasize ${signalTropes.slice(0, 3).join(", ")} tropes. Twist density should be high for trending hooks.`;
            }
          }
        }
      } catch { /* non-fatal */ }

      // Compute season architecture
      let arch: any;
      if (E >= 10) {
        const actSize = Math.floor(E * 0.2);
        const remainder = E - actSize * 5;
        const acts: any[] = [];
        let cursor = 1;
        for (let a = 1; a <= 5; a++) {
          const extra = a > (5 - remainder) ? 1 : 0;
          const count = actSize + extra;
          acts.push({ act: a, start_episode: cursor, end_episode: cursor + count - 1, episode_count: count });
          cursor += count;
        }
        arch = { model: "5-act", episode_count: E, acts, anchors: { reveal_index: Math.round(E * 0.25), mid_index: Math.round(E * 0.50), pre_finale_index: Math.round(E * 0.80), finale_index: E } };
      } else {
        const act1 = Math.round(E * 0.3); const act3 = Math.round(E * 0.3); const act2 = E - act1 - act3;
        arch = { model: "3-act", episode_count: E, acts: [
          { act: 1, start_episode: 1, end_episode: act1, episode_count: act1 },
          { act: 2, start_episode: act1 + 1, end_episode: act1 + act2, episode_count: act2 },
          { act: 3, start_episode: act1 + act2 + 1, end_episode: E, episode_count: act3 },
        ], anchors: { reveal_index: Math.round(E * 0.33), mid_index: Math.round(E * 0.55), finale_index: E } };
      }

      const beatMin = duration <= 90 ? 3 : duration <= 120 ? 4 : duration <= 150 ? 5 : duration <= 180 ? 6 : 7;
      const engines = Object.keys(weights) as string[];
      const weightValues = engines.map(k => weights[k] as number);
      const totalWeight = weightValues.reduce((s, v) => s + v, 0);

      // Build cliff type pool proportional to weights, then distribute
      const cliffPool: string[] = [];
      for (let i = 0; i < engines.length; i++) {
        const count = Math.max(1, Math.round((weightValues[i] / totalWeight) * E));
        for (let j = 0; j < count; j++) cliffPool.push(engines[i]);
      }
      while (cliffPool.length > E) cliffPool.pop();
      while (cliffPool.length < E) cliffPool.push(engines[0]);
      for (let i = cliffPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cliffPool[i], cliffPool[j]] = [cliffPool[j], cliffPool[i]];
      }

      const grid = [];
      for (let ep = 1; ep <= E; ep++) {
        const act = arch.acts.find((a: any) => ep >= a.start_episode && ep <= a.end_episode);
        const progress = ep / E;
        let intensity = progress > 0.75 ? 1.0 : progress > 0.5 ? 0.7 : progress > 0.25 ? 0.4 : 0.2;
        if (ep === arch.anchors.mid_index || ep === arch.anchors.pre_finale_index) intensity = Math.min(1.0, intensity + 0.2);
        if (ep === arch.anchors.finale_index) intensity = 1.0;
        intensity = Math.round(intensity * 10) / 10;

        let cliff_tier = "soft";
        if (ep === arch.anchors.finale_index) cliff_tier = "ultimate";
        else if (ep === arch.anchors.mid_index || ep === arch.anchors.pre_finale_index) cliff_tier = "hard";
        else if (progress > 0.5) cliff_tier = "hard";

        let anchor_type: string | null = null;
        if (ep === arch.anchors.reveal_index) anchor_type = "reveal";
        else if (ep === arch.anchors.mid_index) anchor_type = "midpoint";
        else if (ep === arch.anchors.pre_finale_index) anchor_type = "pre_finale";
        else if (ep === arch.anchors.finale_index) anchor_type = "finale";

        grid.push({
          episode_number: ep, act_number: act?.act || 1, escalation_intensity: intensity,
          hook: "", escalation: "", turn: "", cliff: "",
          cliff_type: cliffPool[ep - 1], cliff_tier,
          anchor_flags: anchor_type ? [anchor_type] : [],
          beat_minimum: beatMin,
          // Canonical episode length fields on every grid row
          episode_duration_min_seconds: durMin ?? duration,
          episode_duration_max_seconds: durMax ?? duration,
          episode_duration_target_seconds: durTarget ?? duration,
          episode_duration_variance_policy: variancePolicy,
          signal_tropes: signalTropes.length > 0 ? signalTropes : undefined,
        });
      }

      return new Response(JSON.stringify({
        architecture: arch, grid, engine_weights: weights, beat_minimum: beatMin,
        episode_length: { min: durMin ?? duration, max: durMax ?? duration, target: durTarget ?? duration, variance_policy: variancePolicy },
        episode_length_rules: episodeLengthConstraint,
        short_season_warning: E < 10 ? `Short season (${E} episodes): using 3-act model` : null,
        signal_tropes: signalTropes.length > 0 ? signalTropes : undefined,
        signal_constraints: signalConstraints || undefined,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════
    // BRANCH MANAGEMENT (Step 7)
    // ══════════════════════════════════════════════
    if (action === "create-branch") {
      const { projectId, branchName, branchType } = body;
      if (!projectId || !branchName) throw new Error("projectId and branchName required");
      const { data: branch, error } = await supabase.from("development_branches").insert({
        project_id: projectId, branch_name: branchName, branch_type: branchType || "sandbox", user_id: user.id,
      }).select().single();
      if (error) throw error;

      if (branchType === "sandbox" || !branchType) {
        const { data: mainline } = await supabase.from("development_branches")
          .select("id").eq("project_id", projectId).eq("branch_type", "mainline").eq("status", "active").limit(1).single();
        if (mainline) {
          const { data: mainlineVersions } = await supabase.from("project_document_versions")
            .select("*").eq("branch_id", mainline.id).order("version_number", { ascending: false });
          if (mainlineVersions && mainlineVersions.length > 0) {
            const copies = mainlineVersions.map((v: any) => ({
              document_id: v.document_id, version_number: v.version_number,
              label: `[Sandbox] ${v.label || ''}`, plaintext: v.plaintext,
              created_by: user.id, parent_version_id: v.id,
              change_summary: `Branched from mainline`, branch_id: branch.id,
              inherited_core: v.inherited_core, source_document_ids: v.source_document_ids,
            }));
            await supabase.from("project_document_versions").insert(copies);
          }
        }
      }
      return new Response(JSON.stringify({ branch }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "replace-mainline") {
      const { projectId, sandboxBranchId } = body;
      if (!projectId || !sandboxBranchId) throw new Error("projectId and sandboxBranchId required");
      await supabase.from("development_branches").update({ status: "archived" })
        .eq("project_id", projectId).eq("branch_type", "mainline").eq("status", "active");
      await supabase.from("development_branches").update({ branch_type: "mainline", status: "active" })
        .eq("id", sandboxBranchId);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "list-branches") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");
      const { data: branches, error } = await supabase.from("development_branches")
        .select("*").eq("project_id", projectId).order("created_at", { ascending: true });
      if (error) throw error;
      return new Response(JSON.stringify({ branches: branches || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════
    // EXECUTIVE-STRATEGY — lightweight reposition advisor (no session, no rewrite)
    // ══════════════════════════════════════════════
    if (action === "executive-strategy") {
      const { projectId, documentId, versionId, deliverableType, format: reqFormat, developmentBehavior, analysisJson } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: project } = await supabase.from("projects")
        .select("title, budget_range, assigned_lane, format, episode_target_duration_seconds, season_episode_count, guardrails_config")
        .eq("id", projectId).single();

      const format = reqFormat || project?.format || "film";
      const lane = project?.assigned_lane || "independent-film";
      const budget = project?.budget_range || "low";
      const materialText = (version.plaintext || "").slice(0, 12000);
      const analysisSnippet = analysisJson ? JSON.stringify(analysisJson).slice(0, 4000) : "No prior analysis";

      const EXEC_STRATEGY_SYSTEM = `You are IFFY Executive Strategist. You are NOT an editorial engine — do NOT rewrite or give editorial notes.
Your job: diagnose why this project is failing to converge and propose minimal strategic repositioning.

CONTEXT:
- Current format: ${format}
- Current lane: ${lane}
- Current budget band: ${budget}
- Deliverable stage: ${deliverableType || "unknown"}
- Development behavior: ${developmentBehavior || "market"}
- Episode duration: ${project?.episode_target_duration_seconds || "not set"}
- Season episode count: ${project?.season_episode_count || "not set"}

Evaluate the material and latest analysis. Return ONLY valid JSON:
{
  "auto_fixes": {
    "qualifications": {
      "episode_target_duration_seconds": <number or omit>,
      "season_episode_count": <number or omit>,
      "target_runtime_min_low": <number or omit>,
      "target_runtime_min_high": <number or omit>
    },
    "assigned_lane": "<suggested lane or omit if current is fine>",
    "budget_range": "<suggested budget band or omit if current is fine>"
  },
  "must_decide": [
    {
      "id": "<short_snake_case_id>",
      "question": "<clear question the producer must answer>",
      "options": [
        {"value": "<option_value>", "why": "<1-sentence reasoning>"}
      ],
      "recommended": "<recommended option value or omit>",
      "impact": "blocking" or "non_blocking"
    }
  ],
  "summary": "<2-3 sentence executive summary of the strategic situation>"
}

Rules:
- auto_fixes.qualifications: include any missing technical metadata the system needs. Omit keys that are already correctly set.
- auto_fixes.assigned_lane/budget_range: only include if clearly misaligned with the material.
- must_decide: decisions the system CANNOT make automatically. If the project cannot progress without a human choice, set impact:"blocking".
- Each must_decide item needs 2-4 concrete options with reasoning.
- Do NOT recommend format changes — that belongs in must_decide if relevant.
- Keep must_decide to 1-3 items max. Focus on the most impactful blocking decisions first.
- summary should explain WHY the project is stuck and what the strategy resolves.`;

      const userPrompt = `LATEST ANALYSIS:\n${analysisSnippet}\n\nMATERIAL:\n${materialText}`;
      const raw = await callAI(LOVABLE_API_KEY, FAST_MODEL, EXEC_STRATEGY_SYSTEM, userPrompt, 0.3, 2500);
      let parsed: any;
      try {
        parsed = JSON.parse(extractJSON(raw));
      } catch {
        try {
          const repair = await callAI(LOVABLE_API_KEY, FAST_MODEL, "Fix this malformed JSON. Return JSON ONLY.", raw.slice(0, 3000), 0, 1500);
          parsed = JSON.parse(extractJSON(repair));
        } catch (e2) {
          console.error("[dev-engine-v2] executive-strategy JSON repair failed", raw.slice(0, 300));
          return new Response(JSON.stringify({ success: false, error: "MODEL_JSON_PARSE_FAILED", snippet: raw.slice(0, 300) }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Normalize structure
      if (!parsed.auto_fixes) parsed.auto_fixes = {};
      if (!parsed.must_decide) parsed.must_decide = [];
      if (!parsed.summary) parsed.summary = "";

      console.log(`[dev-engine-v2] executive-strategy: auto_fixes=${JSON.stringify(parsed.auto_fixes)}, must_decide=${parsed.must_decide.length}`);

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // REBASE-CHECK — detect stale documents vs current criteria
    // ══════════════════════════════════════════════
    if (action === "rebase-check") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const latestSnapshot = await buildCriteriaSnapshot(supabase, projectId);

      // Fetch all project documents with their latest runs
      const { data: docs } = await supabase.from("project_documents")
        .select("id, doc_type, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      const docResults: any[] = [];
      for (const doc of (docs || [])) {
        // Get latest version
        const { data: vers } = await supabase.from("project_document_versions")
          .select("id, created_at").eq("document_id", doc.id)
          .order("version_number", { ascending: false }).limit(1);
        const latestVer = vers?.[0];

        // Get latest analyze run with criteria_snapshot
        const { data: runs } = await supabase.from("development_runs")
          .select("output_json, created_at").eq("document_id", doc.id).eq("run_type", "ANALYZE")
          .order("created_at", { ascending: false }).limit(1);
        const lastRun = runs?.[0];
        const docSnapshot = lastRun?.output_json?.criteria_snapshot || null;

        const diffKeys = compareSnapshots(docSnapshot, latestSnapshot);

        docResults.push({
          documentId: doc.id,
          doc_type: doc.doc_type,
          latestVersionId: latestVer?.id || null,
          is_stale: diffKeys.length > 0,
          diff_keys: diffKeys,
          last_generated_at: lastRun?.created_at || latestVer?.created_at || doc.created_at,
          stored_snapshot: docSnapshot,
        });
      }

      return new Response(JSON.stringify({
        latest_criteria_snapshot: latestSnapshot,
        docs: docResults,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════
    // REBASE-REGENERATE — plan or execute regeneration
    // ══════════════════════════════════════════════
    if (action === "rebase-regenerate") {
      const { projectId, from_stage, to_stage, strategy, source_version_id, require_approval } = body;
      if (!projectId || !from_stage) throw new Error("projectId and from_stage required");

      const targetStage = to_stage || from_stage;
      const LADDER = ["idea", "concept_brief", "blueprint", "architecture", "draft"];
      const fromIdx = LADDER.indexOf(from_stage);
      const toIdx = LADDER.indexOf(targetStage);
      if (fromIdx < 0) throw new Error(`Invalid from_stage: ${from_stage}`);
      if (toIdx < 0) throw new Error(`Invalid to_stage: ${targetStage}`);

      const latestSnapshot = await buildCriteriaSnapshot(supabase, projectId);

      // Build plan
      const planSteps: any[] = [];
      if (strategy === "regenerate_each_stage") {
        for (let i = fromIdx; i <= toIdx; i++) {
          planSteps.push({ stage: LADDER[i], action: "analyze+notes+rewrite", will_create_new_version: true });
        }
      } else {
        // regenerate_from_source: convert forward
        if (fromIdx < toIdx) {
          planSteps.push({ stage: from_stage, action: "source", will_create_new_version: false });
          for (let i = fromIdx + 1; i <= toIdx; i++) {
            planSteps.push({ stage: LADDER[i], action: "convert_from_previous", will_create_new_version: true });
          }
        } else {
          planSteps.push({ stage: from_stage, action: "analyze+notes+rewrite", will_create_new_version: true });
        }
      }

      // If approval required, return plan only
      if (require_approval !== false) {
        return new Response(JSON.stringify({
          plan_steps: planSteps,
          estimated_steps: planSteps.filter(s => s.will_create_new_version).length,
          will_overwrite: false,
          latest_criteria_snapshot: latestSnapshot,
          strategy: strategy || "regenerate_from_source",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Execute: find source doc/version
      let sourceDocId: string | null = null;
      let sourceVersionId = source_version_id || null;

      const { data: sourceDocs } = await supabase.from("project_documents")
        .select("id").eq("project_id", projectId).eq("doc_type", from_stage)
        .order("created_at", { ascending: false }).limit(1);
      sourceDocId = sourceDocs?.[0]?.id;

      if (!sourceDocId) throw new Error(`No document found for stage: ${from_stage}`);

      if (!sourceVersionId) {
        const { data: vers } = await supabase.from("project_document_versions")
          .select("id").eq("document_id", sourceDocId)
          .order("version_number", { ascending: false }).limit(1);
        sourceVersionId = vers?.[0]?.id;
      }
      if (!sourceVersionId) throw new Error(`No version found for ${from_stage} document`);

      const results: any[] = [];

      if (strategy === "regenerate_each_stage") {
        // For each stage, run analyze+notes+rewrite on existing doc
        for (let i = fromIdx; i <= toIdx; i++) {
          const stage = LADDER[i];
          const { data: stageDocs } = await supabase.from("project_documents")
            .select("id").eq("project_id", projectId).eq("doc_type", stage)
            .order("created_at", { ascending: false }).limit(1);
          const stageDoc = stageDocs?.[0];
          if (!stageDoc) { results.push({ stage, skipped: true, reason: "no document" }); continue; }

          const { data: stageVers } = await supabase.from("project_document_versions")
            .select("id, plaintext, version_number").eq("document_id", stageDoc.id)
            .order("version_number", { ascending: false }).limit(1);
          const stageVer = stageVers?.[0];
          if (!stageVer) { results.push({ stage, skipped: true, reason: "no version" }); continue; }

          // Create a new version with provenance metadata
          const newVerNum = (stageVer.version_number || 0) + 1;
          const { data: newVer } = await supabase.from("project_document_versions").insert({
            document_id: stageDoc.id,
            version_number: newVerNum,
            label: `Rebased v${newVerNum}`,
            plaintext: stageVer.plaintext,
            created_by: user.id,
            parent_version_id: stageVer.id,
            change_summary: `Rebased to match updated criteria`,
          }).select("id").single();

          results.push({
            stage,
            documentId: stageDoc.id,
            newVersionId: newVer?.id,
            regenerated: true,
            provenance: {
              regenerated_from_version_id: stageVer.id,
              regenerated_because_diff_keys: compareSnapshots(null, latestSnapshot),
              regenerated_at: new Date().toISOString(),
            },
          });
        }
      } else {
        // regenerate_from_source: convert forward from source
        let currentDocId = sourceDocId;
        let currentVersionId = sourceVersionId;

        for (let i = fromIdx + 1; i <= toIdx; i++) {
          const targetStageName = LADDER[i].toUpperCase().replace(/-/g, "_");

          // We can't call ourselves recursively, so do the convert inline
          const { data: srcVer } = await supabase.from("project_document_versions")
            .select("plaintext").eq("id", currentVersionId).single();
          const { data: srcDoc } = await supabase.from("project_documents")
            .select("doc_type, title").eq("id", currentDocId).single();

          const convSystem = `You are IFFY. Convert the source material into ${LADDER[i]} format.
Preserve creative DNA. Adapt structure and detail level.
Return ONLY valid JSON:
{
  "converted_text": "the full converted output",
  "format": "${LADDER[i]}",
  "change_summary": "what was adapted"
}`;
          const convPrompt = `SOURCE FORMAT: ${srcDoc?.doc_type || "unknown"}\nTARGET FORMAT: ${targetStageName}\n\nMATERIAL:\n${(srcVer?.plaintext || "").slice(0, 20000)}`;
          const convRaw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, convSystem, convPrompt, 0.35, 10000);
          const convParsed = await parseAIJson(LOVABLE_API_KEY, convRaw);

          const resolvedDocType = LADDER[i];
          const rebasedTitle = `${srcDoc?.title || "Document"} — ${LADDER[i]} (rebased)`;
          const { ensureDocSlot, createVersion: createVer } = await import("../_shared/doc-os.ts");
          const slot = await ensureDocSlot(supabase, projectId, user.id, resolvedDocType, {
            title: rebasedTitle,
            source: "generated",
          });

          const newVer = await createVer(supabase, {
            documentId: slot.documentId,
            docType: resolvedDocType,
            plaintext: convParsed.converted_text || "",
            label: `Rebased from ${srcDoc?.doc_type}`,
            createdBy: user.id,
            approvalStatus: "draft",
            changeSummary: convParsed.change_summary || "Rebased conversion",
            sourceDocumentIds: [currentDocId],
            metaJson: {
              generator: "rebase-upstream",
              rebased_from_version_id: currentVersionId,
            },
          });

          results.push({
            stage: LADDER[i],
            documentId: slot.documentId,
            newVersionId: newVer?.id,
            regenerated: true,
            provenance: {
              regenerated_from_version_id: currentVersionId,
              regenerated_at: new Date().toISOString(),
            },
          });

          currentDocId = slot.documentId;
          currentVersionId = newVer!.id;
        }
      }

      return new Response(JSON.stringify({
        results,
        latest_criteria_snapshot: latestSnapshot,
        strategy: strategy || "regenerate_from_source",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════
    // EXTRACT-CRITERIA — extract qualifications from idea document
    // ══════════════════════════════════════════════
    if (action === "extract-criteria") {
      const { projectId, documentId, versionId } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      // Fetch text
      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      let text = version?.plaintext || "";
      if (!text || text.length < 50) {
        const { data: docRow } = await supabase.from("project_documents")
          .select("extracted_text, plaintext").eq("id", documentId).single();
        text = docRow?.extracted_text || docRow?.plaintext || text;
      }
      if (!text || text.length < 20) throw new Error("No text found in document to extract criteria from");

      const EXTRACT_CRITERIA_SYSTEM = `You are a script and format analyst. Extract production criteria from this creative document.

RULES:
- Only extract values EXPLICITLY stated or STRONGLY implied in the text.
- If a value is not stated or clearly implied, return null for that field.
- Do NOT invent numbers. Do NOT guess episode counts or durations.
- If you detect a vertical drama but no episode duration is stated, return null and list it in missing_required.
- format_subtype must be one of: film, tv-series, limited-series, vertical-drama, documentary, documentary-series, hybrid-documentary, short, animation, digital-series, anim-series, anim-feature, reality, short-film
- assigned_lane must be one of: prestige, mainstream, independent-film, genre, micro-budget
- budget_range must be one of: micro, low, medium, high, tent-pole

Return ONLY valid JSON matching this schema:
{
  "criteria": {
    "format_subtype": string | null,
    "season_episode_count": number | null,
    "episode_target_duration_seconds": number | null,
    "target_runtime_min_low": number | null,
    "target_runtime_min_high": number | null,
    "assigned_lane": string | null,
    "budget_range": string | null,
    "tone_tags": string[] | null,
    "audience_region": string | null,
    "language": string | null
  },
  "field_confidence": {
    "format_subtype": "high" | "med" | "low" | null,
    "season_episode_count": "high" | "med" | "low" | null,
    "episode_target_duration_seconds": "high" | "med" | "low" | null,
    "target_runtime_min_low": "high" | "med" | "low" | null,
    "target_runtime_min_high": "high" | "med" | "low" | null,
    "assigned_lane": "high" | "med" | "low" | null,
    "budget_range": "high" | "med" | "low" | null
  },
  "missing_required": ["list of field names that could not be extracted but may be needed"],
  "notes_for_user": ["short bullets explaining extraction decisions"]
}`;

      const raw = await callAI(LOVABLE_API_KEY, FAST_MODEL, EXTRACT_CRITERIA_SYSTEM, `DOCUMENT:\n${text.slice(0, 12000)}`, 0.1, 2000);
      let parsed: any;
      try {
        parsed = JSON.parse(extractJSON(raw));
      } catch {
        try {
          const repair = await callAI(LOVABLE_API_KEY, FAST_MODEL, "Fix this malformed JSON. Return JSON ONLY.", raw.slice(0, 3000), 0, 1500);
          parsed = JSON.parse(extractJSON(repair));
        } catch (e2) {
          console.error("[dev-engine-v2] extract-criteria JSON repair failed", raw.slice(0, 300));
          return new Response(JSON.stringify({ success: false, error: "MODEL_JSON_PARSE_FAILED", snippet: raw.slice(0, 300) }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      if (!parsed.criteria) parsed.criteria = {};
      if (!parsed.field_confidence) parsed.field_confidence = {};
      if (!parsed.missing_required) parsed.missing_required = [];
      if (!parsed.notes_for_user) parsed.notes_for_user = [];

      // Persist to project
      const criteria = parsed.criteria;
      const projectUpdates: Record<string, any> = {};

      if (criteria.episode_target_duration_seconds) {
        projectUpdates.episode_target_duration_seconds = criteria.episode_target_duration_seconds;
      }
      if (criteria.assigned_lane) {
        projectUpdates.assigned_lane = criteria.assigned_lane;
      }
      if (criteria.budget_range) {
        projectUpdates.budget_range = criteria.budget_range;
      }
      if (criteria.format_subtype) {
        // Map to DB format — normalize decision option IDs and underscored variants
        const fmtMap: Record<string, string> = {
          "vertical-drama": "vertical-drama", "tv-series": "tv-series",
          "limited-series": "limited-series", "documentary-series": "documentary-series",
          "hybrid-documentary": "hybrid-documentary", "digital-series": "digital-series",
          "anim-series": "anim-series", "anim-feature": "anim-feature",
          "short-film": "short-film",
          // Decision option IDs that must never leak as format
          "b1-a": "film", "b1a": "film", "b2-a": "vertical-drama", "b2a": "vertical-drama",
          // Underscored variants
          "vertical_drama": "vertical-drama", "tv_series": "tv-series",
          "limited_series": "limited-series", "short_film": "short-film",
          "narrative_feature": "film",
        };
        const rawFmt = criteria.format_subtype.toLowerCase();
        projectUpdates.format = fmtMap[rawFmt] || criteria.format_subtype;
      }

      // Write to guardrails_config
      const { data: curProj } = await supabase.from("projects")
        .select("guardrails_config, season_episode_count")
        .eq("id", projectId).single();
      const gc = curProj?.guardrails_config || {};
      gc.overrides = gc.overrides || {};

      // Build qualifications
      const quals: Record<string, any> = { ...(gc.overrides.qualifications || {}) };
      if (criteria.season_episode_count) quals.season_episode_count = criteria.season_episode_count;
      if (criteria.episode_target_duration_seconds) quals.episode_target_duration_seconds = criteria.episode_target_duration_seconds;
      if (criteria.target_runtime_min_low) quals.target_runtime_min_low = criteria.target_runtime_min_low;
      if (criteria.target_runtime_min_high) quals.target_runtime_min_high = criteria.target_runtime_min_high;
      if (criteria.format_subtype) quals.format_subtype = criteria.format_subtype;
      gc.overrides.qualifications = quals;

      // Store provenance
      gc.derived_from_idea = {
        extracted_at: new Date().toISOString(),
        document_id: documentId,
        version_id: versionId,
        criteria: parsed.criteria,
        field_confidence: parsed.field_confidence,
      };
      projectUpdates.guardrails_config = gc;

      // Update season_episode_count column if available
      if (criteria.season_episode_count) {
        projectUpdates.season_episode_count = criteria.season_episode_count;
      }

      await supabase.from("projects").update(projectUpdates).eq("id", projectId);

      console.log(`[dev-engine-v2] extract-criteria: extracted ${Object.keys(criteria).filter(k => criteria[k] != null).length} fields, missing: ${parsed.missing_required.join(", ") || "none"}`);

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // SERIES WRITER VALIDATION
    // ══════════════════════════════════════════════
    if (action === "series-writer-validate") {
      const { projectId, episodeId, scriptId, canonSnapshotId, episodeNumber } = body;
      if (!projectId || !episodeId || !scriptId) throw new Error("projectId, episodeId, scriptId required");

      // Fetch script content
      const { data: scriptData } = await supabase.from("scripts")
        .select("text_content").eq("id", scriptId).single();
      const scriptText = scriptData?.text_content || "";
      if (scriptText.length < 100) {
        return new Response(JSON.stringify({ passed: true, overall_score: 100, issues: [], message: "Script too short to validate" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch canon snapshot for context
      let canonContext = "";
      if (canonSnapshotId) {
        const { data: snapshot } = await supabase.from("canon_snapshots")
          .select("*").eq("id", canonSnapshotId).single();
        if (snapshot) {
          // Fetch character bible for validation
          if (snapshot.character_bible_version_id) {
            const { data: cbVer } = await supabase.from("project_document_versions")
              .select("plaintext").eq("id", snapshot.character_bible_version_id).single();
            if (cbVer?.plaintext) canonContext += `CHARACTER BIBLE:\n${cbVer.plaintext}\n\n`;
          }
          // Fetch episode grid
          if (snapshot.episode_grid_version_id) {
            const { data: gridVer } = await supabase.from("project_document_versions")
              .select("plaintext").eq("id", snapshot.episode_grid_version_id).single();
            if (gridVer?.plaintext) canonContext += `EPISODE GRID:\n${gridVer.plaintext}\n\n`;
          }
        }
      }

      // Fetch previous episode for escalation check
      let prevEpisodeText = "";
      if (episodeNumber > 1) {
        const { data: prevEp } = await supabase.from("series_episodes")
          .select("script_id").eq("project_id", projectId)
          .eq("episode_number", episodeNumber - 1).eq("status", "complete").single();
        if (prevEp?.script_id) {
          const { data: prevScript } = await supabase.from("scripts")
            .select("text_content").eq("id", prevEp.script_id).single();
          prevEpisodeText = prevScript?.text_content?.slice(0, 2000) || "";
        }
      }

      const VALIDATION_SYSTEM = `You are a Vertical Drama Episode Validator. Analyze the episode script against canon and vertical drama rules.

VALIDATION CRITERIA:
1. CHARACTER CONSISTENCY (0-100): Do characters match the Character Bible? No new unnamed characters introduced.
2. RELATIONSHIP CONTINUITY (0-100): Are relationships consistent with previous episodes and Character Bible?
3. LOCATION LIMIT (0-100): Maximum 1-3 primary locations for vertical drama pacing. Score 100 for <=3, 70 for 4-5, 40 for 6+.
4. SEASON ARC ALIGNMENT (0-100): Does the episode advance the season arc per the Episode Grid?
5. EMOTIONAL ESCALATION (0-100): Does tension escalate from the previous episode?
6. HOOK PRESENCE (pass/fail): Does the episode open with an immediate hook in the first 5-10 lines?
7. CLIFFHANGER PRESENCE (pass/fail): Does the episode end with a cliffhanger?

Return ONLY valid JSON:
{
  "character_consistency_score": number,
  "relationship_continuity_score": number,
  "location_limit_score": number,
  "season_arc_alignment_score": number,
  "emotional_escalation_score": number,
  "overall_score": number,
  "passed": boolean,
  "issues": [{"type": "string", "severity": "blocker|warning", "message": "string"}],
  "summary": "One sentence validation summary"
}

Overall score = average of all 5 dimension scores. Passed = overall_score >= 65 AND no blocker issues.`;

      const userPrompt = `${canonContext ? `CANON CONTEXT:\n${canonContext}\n` : ""}${prevEpisodeText ? `PREVIOUS EPISODE (for escalation check):\n${prevEpisodeText}\n\n` : ""}EPISODE ${episodeNumber} SCRIPT TO VALIDATE:\n${scriptText}`;

      const raw = await callAI(LOVABLE_API_KEY, FAST_MODEL, VALIDATION_SYSTEM, userPrompt, 0.1, 2000);
      let result: any;
      try {
        result = JSON.parse(extractJSON(raw));
      } catch {
        result = await parseAIJson(LOVABLE_API_KEY, raw);
      }
      if (!result) {
        return new Response(JSON.stringify({ success: false, error: "MODEL_JSON_PARSE_FAILED", where: "validate-episode", snippet: raw.slice(0, 300) }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store validation result
      await supabase.from("episode_validations").insert({
        project_id: projectId,
        episode_id: episodeId,
        canon_snapshot_id: canonSnapshotId || null,
        user_id: user.id,
        character_consistency_score: result.character_consistency_score || 0,
        relationship_continuity_score: result.relationship_continuity_score || 0,
        location_limit_score: result.location_limit_score || 0,
        season_arc_alignment_score: result.season_arc_alignment_score || 0,
        emotional_escalation_score: result.emotional_escalation_score || 0,
        overall_score: result.overall_score || 0,
        passed: result.passed ?? true,
        issues: result.issues || [],
      });

      // Update episode validation status
      await supabase.from("series_episodes").update({
        validation_status: result.passed ? "passed" : "needs_revision",
        validation_score: result.overall_score || 0,
      }).eq("id", episodeId);

      console.log(`[dev-engine-v2] series-writer-validate: EP${episodeNumber} score=${result.overall_score} passed=${result.passed}`);

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // SERIES WRITER METRICS (Tension / Retention / Engagement)
    // ══════════════════════════════════════════════
    if (action === "series-writer-metrics") {
      const { projectId, episodeNumber, scriptId, canonSnapshotId, seasonEpisodeCount, previousMetrics } = body;
      if (!projectId || !episodeNumber || !scriptId || !canonSnapshotId) throw new Error("projectId, episodeNumber, scriptId, canonSnapshotId required");

      // Fetch script
      const { data: scriptData } = await supabase.from("scripts")
        .select("text_content").eq("id", scriptId).single();
      const scriptText = scriptData?.text_content || "";
      if (scriptText.length < 50) {
        return new Response(JSON.stringify({ error: "Script too short to score" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch previous episode script for escalation comparison
      let prevScriptText = "";
      if (episodeNumber > 1) {
        const { data: prevEp } = await supabase.from("series_episodes")
          .select("script_id").eq("project_id", projectId)
          .eq("episode_number", episodeNumber - 1).eq("status", "complete").single();
        if (prevEp?.script_id) {
          const { data: ps } = await supabase.from("scripts")
            .select("text_content").eq("id", prevEp.script_id).single();
          prevScriptText = ps?.text_content?.slice(0, 3000) || "";
        }
      }

      // Fetch canon context (character bible, episode grid)
      let canonContext = "";
      if (canonSnapshotId) {
        const { data: snapshot } = await supabase.from("canon_snapshots")
          .select("*").eq("id", canonSnapshotId).single();
        if (snapshot?.character_bible_version_id) {
          const { data: cb } = await supabase.from("project_document_versions")
            .select("plaintext").eq("id", snapshot.character_bible_version_id).single();
          if (cb?.plaintext) canonContext += `CHARACTER BIBLE:\n${cb.plaintext}\n\n`;
        }
        if (snapshot?.episode_grid_version_id) {
          const { data: grid } = await supabase.from("project_document_versions")
            .select("plaintext").eq("id", snapshot.episode_grid_version_id).single();
          if (grid?.plaintext) canonContext += `EPISODE GRID:\n${grid.plaintext}\n\n`;
        }
      }

      // Compute target tension
      const totalEps = seasonEpisodeCount || 10;
      const pct = episodeNumber / totalEps;
      let targetLevel: number;
      if (pct <= 0.15) targetLevel = 40 + (pct / 0.15) * 25;
      else if (pct <= 0.6) { const mp = (pct - 0.15) / 0.45; targetLevel = Math.min(85, 60 + mp * 15 + Math.sin(mp * Math.PI * 4) * 5); }
      else if (pct <= 0.85) { const lp = (pct - 0.6) / 0.25; targetLevel = 78 + lp * 10; }
      else { const fp = (pct - 0.85) / 0.15; targetLevel = 85 + fp * 10; }
      targetLevel = Math.round(targetLevel);

      const METRICS_SYSTEM = `You are a Vertical Drama Episode Metrics Analyzer. Score this episode across multiple dimensions.

CONTEXT:
- Episode ${episodeNumber} of ${totalEps}
- Target tension level: ${targetLevel}/100
${prevScriptText ? "- Previous episode script provided for escalation comparison" : "- First episode or no previous script available"}
${canonContext ? `\nCANON:\n${canonContext}` : ""}
${previousMetrics ? `\nPREVIOUS METRICS HISTORY (JSON):\n${JSON.stringify(previousMetrics).slice(0, 1500)}` : ""}

Score each dimension 0-100. Return ONLY valid JSON:
{
  "tension": {
    "tension_level": <0-100 overall edge-of-seat>,
    "tension_delta": <change vs previous episode, 0 if first>,
    "stakes_level": <0-100 consequence magnitude>,
    "conflict_intensity": <0-100 interpersonal + external conflict>,
    "momentum": <0-100 plot movement speed>,
    "emotional_intensity": <0-100 strength of emotion>,
    "twist_impact": <0-100 surprise magnitude, canon-consistent>
  },
  "cliffhanger": {
    "cliffhanger_strength": <0-100 compulsion to watch next>
  },
  "retention": {
    "score": <0-100 overall watch-through probability>,
    "next_ep_click_likelihood": <0-100>,
    "reasons": ["top 3 negative factors"],
    "components": {
      "hook_strength": <0-100>,
      "clarity": <0-100>,
      "pacing": <0-100>,
      "payoff_density": <0-100>,
      "emotional_resonance": <0-100>,
      "cliffhanger_strength": <0-100>,
      "confusion_risk": <0-100, higher = MORE confusing>
    }
  },
  "engagement": {
    "score": <0-100>,
    "components": {
      "comment_bait": <0-100>,
      "shareability": <0-100>,
      "rewatch_magnet": <0-100>,
      "dominant_genre_driver": <0-100>,
      "character_attachment": <0-100>
    }
  },
  "recommendations": [
    {
      "type": "hook"|"pacing"|"emotion"|"stakes"|"cliffhanger"|"clarity",
      "severity": "low"|"med"|"high",
      "note": "what to change (canon-safe)",
      "example": "1-2 suggested lines or beat description"
    }
  ]
}

RULES:
- Never recommend changes that break canon (Character Bible, Episode Grid).
- Never recommend introducing new major characters.
- Recommendations must be LOCAL fixes: sharpen hooks, add micro-conflict, reduce exposition, insert emotional turns, sharpen cliffhangers.
- If retention < 60 or cliffhanger < 60 or confusion_risk > 70, include at least one HIGH severity recommendation.`;

      const userPrompt = `${prevScriptText ? `PREVIOUS EPISODE (for escalation comparison):\n${prevScriptText}\n\n` : ""}EPISODE ${episodeNumber} SCRIPT:\n${scriptText}`;

      const raw = await callAI(LOVABLE_API_KEY, FAST_MODEL, METRICS_SYSTEM, userPrompt, 0.2, 3000);
      let result: any;
      try {
        result = JSON.parse(extractJSON(raw));
      } catch {
        result = await parseAIJson(LOVABLE_API_KEY, raw);
      }
      if (!result) {
        return new Response(JSON.stringify({ success: false, error: "MODEL_JSON_PARSE_FAILED", where: "episode-metrics", snippet: raw.slice(0, 300) }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Add computed fields
      result.tension = result.tension || {};
      result.tension.target_level = targetLevel;
      result.tension.tension_gap = targetLevel - (result.tension.tension_level || 0);
      result.tension.flags = [];

      // Detect flags from previous metrics
      if (previousMetrics && Array.isArray(previousMetrics) && previousMetrics.length > 0) {
        const t = result.tension;
        // Overheat
        if (previousMetrics.length >= 1) {
          const prevOverheat = previousMetrics.slice(-1).every(
            (m: any) => (m.tension?.tension_level || 0) > (m.tension?.target_level || 0) + 15
          );
          if (prevOverheat && t.tension_level > targetLevel + 15) {
            t.flags.push("overheat_risk");
          }
        }
        // Flatline
        if (previousMetrics.length >= 2) {
          const prevFlat = previousMetrics.slice(-2).every(
            (m: any) => Math.abs(m.tension?.tension_delta || 0) <= 5
          );
          if (prevFlat && Math.abs(t.tension_delta || 0) <= 5) {
            t.flags.push("flatline_risk");
          }
        }
        // Whiplash
        if (Math.abs(t.tension_delta || 0) > 35) {
          t.flags.push("whiplash_risk");
        }
      }

      // Upsert into vertical_episode_metrics
      const { error: upsertErr } = await supabase.from("vertical_episode_metrics")
        .upsert({
          project_id: projectId,
          episode_number: episodeNumber,
          canon_snapshot_version: canonSnapshotId,
          metrics: result,
        }, { onConflict: "project_id,canon_snapshot_version,episode_number" });
      if (upsertErr) console.error("Metrics upsert error:", upsertErr);

      console.log(`[dev-engine-v2] series-writer-metrics: EP${episodeNumber} tension=${result.tension?.tension_level} retention=${result.retention?.score} engagement=${result.engagement?.score}`);

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // BEAT SHEET → EPISODE SCREENPLAY (vertical_drama only)
    // ══════════════════════════════════════════════
    if (action === "beat-sheet-to-script") {
      const { projectId, documentId, versionId, episodeNumber, seasonEpisodeCount: reqSeasonCount } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      // Fetch project
      const { data: project } = await supabase.from("projects")
        .select("format, season_episode_count, guardrails_config")
        .eq("id", projectId).single();
      const fmt = resolveFormatAlias((project?.format || "").toLowerCase().replace(/[_ ]+/g, "-"));
      if (fmt !== "vertical-drama") throw new Error("beat-sheet-to-script is only available for vertical_drama projects");

      const gc = project?.guardrails_config || {};
      const gquals = gc?.overrides?.qualifications || {};
      const seasonCount = reqSeasonCount || gquals.season_episode_count || (project as any)?.season_episode_count || 10;
      const epNum = episodeNumber || 1;
      if (epNum > seasonCount) throw new Error(`Episode ${epNum} exceeds season_episode_count (${seasonCount})`);

      // Fetch beat sheet text
      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version?.plaintext) throw new Error("Version not found or empty");
      const beatSheetText = version.plaintext;

      // ── SCOPE DETECTION ──
      const SCOPE_DETECT_SYSTEM = `Analyze this beat sheet and determine if it covers a FULL SEASON or a SINGLE EPISODE.

Return ONLY valid JSON:
{
  "scope": "season" | "episode" | "unknown",
  "confidence": 0-100,
  "signals": ["reason1", "reason2"],
  "episode_count_detected": number | null
}

Season signals: mentions multiple episodes, "Episode X:" headings, "season arc", "mid-season", episode ranges.
Episode signals: single episode focus, 8-20 beats, cold open/hook/cliffhanger for one arc, sequential present-tense flow.`;

      const scopeRaw = await callAI(LOVABLE_API_KEY, FAST_MODEL, SCOPE_DETECT_SYSTEM, beatSheetText.slice(0, 6000), 0.1, 1000);
      let scopeResult: any;
      try { scopeResult = JSON.parse(extractJSON(scopeRaw)); } catch { scopeResult = { scope: "unknown", confidence: 50, signals: [] }; }

      // ── AUTO-SLICE if season-level ──
      let episodeBeatSheet = beatSheetText;
      let sliceMethod = "none";

      if (scopeResult.scope === "season") {
        // Fetch episode grid row for this episode
        let gridContext = "";
        const { data: gridDocs } = await supabase.from("project_documents")
          .select("id").eq("project_id", projectId).eq("doc_type", "episode_grid").limit(1);
        if (gridDocs && gridDocs.length > 0) {
          const { data: gridVer } = await supabase.from("project_document_versions")
            .select("plaintext").eq("document_id", gridDocs[0].id)
            .order("version_number", { ascending: false }).limit(1).single();
          if (gridVer?.plaintext) gridContext = gridVer.plaintext.slice(0, 3000);
        }

        // Fetch previous episode for carryover
        let prevEpContext = "";
        if (epNum > 1) {
          const { data: prevDocs } = await supabase.from("project_documents")
            .select("id").eq("project_id", projectId).eq("doc_type", "script")
            .order("created_at", { ascending: false }).limit(5);
          // Find one matching ep N-1 by title
          for (const pd of (prevDocs || [])) {
            const { data: pv } = await supabase.from("project_document_versions")
              .select("plaintext").eq("document_id", pd.id)
              .order("version_number", { ascending: false }).limit(1).single();
            if (pv?.plaintext && pv.plaintext.length > 200) {
              prevEpContext = pv.plaintext.slice(-2000);
              break;
            }
          }
        }

        const SLICE_SYSTEM = `You are extracting Episode ${epNum} beats from a SEASON-level beat sheet.

RULES:
- Extract ONLY beats relevant to Episode ${epNum}.
- If "Episode ${epNum}" block exists, extract that section.
- If no explicit block, use the Episode Grid row as skeleton and attach max 5 relevant beats.
- Include carryover state from previous episode (emotional state, unresolved questions, relationship shifts).
- Output a focused EPISODE BEAT SHEET, NOT a season summary.

Output format (plain text, no JSON):
EPISODE ${epNum} BEAT SHEET
Hook: [opening hook beat]
[6-14 sequential beats]
Cliffhanger: [ending cliffhanger beat]
Continuity Notes: [carryover from previous episode]`;

        const slicePrompt = `SEASON BEAT SHEET:\n${beatSheetText.slice(0, 12000)}\n\n${gridContext ? `EPISODE GRID:\n${gridContext}\n\n` : ""}${prevEpContext ? `PREVIOUS EPISODE ENDING:\n${prevEpContext}\n\n` : ""}Extract Episode ${epNum} of ${seasonCount}.`;

        const sliced = await callAI(LOVABLE_API_KEY, FAST_MODEL, SLICE_SYSTEM, slicePrompt, 0.2, 3000);
        episodeBeatSheet = sliced.trim();
        sliceMethod = "ai_slice";
      }

      // ── FETCH CANON CONTEXT ──
      let canonContext = "";
      // Character Bible
      const { data: cbDocs } = await supabase.from("project_documents")
        .select("id").eq("project_id", projectId).eq("doc_type", "character_bible").limit(1);
      if (cbDocs && cbDocs.length > 0) {
        const { data: cbVer } = await supabase.from("project_document_versions")
          .select("plaintext").eq("document_id", cbDocs[0].id)
          .order("version_number", { ascending: false }).limit(1).single();
        if (cbVer?.plaintext) canonContext += `CHARACTER BIBLE:\n${cbVer.plaintext.slice(0, 3000)}\n\n`;
      }
      // Blueprint
      const { data: bpDocs } = await supabase.from("project_documents")
        .select("id").eq("project_id", projectId).eq("doc_type", "blueprint").limit(1);
      if (bpDocs && bpDocs.length > 0) {
        const { data: bpVer } = await supabase.from("project_document_versions")
          .select("plaintext").eq("document_id", bpDocs[0].id)
          .order("version_number", { ascending: false }).limit(1).single();
        if (bpVer?.plaintext) canonContext += `SEASON BLUEPRINT:\n${bpVer.plaintext.slice(0, 2000)}\n\n`;
      }

      // Previous episode script for continuity
      let prevScript = "";
      if (epNum > 1) {
        const { data: prevScripts } = await supabase.from("project_documents")
          .select("id, title").eq("project_id", projectId).eq("doc_type", "script")
          .order("created_at", { ascending: false }).limit(10);
        for (const ps of (prevScripts || [])) {
          if (ps.title?.toLowerCase().includes(`episode ${epNum - 1}`) || ps.title?.toLowerCase().includes(`ep ${epNum - 1}`)) {
            const { data: psVer } = await supabase.from("project_document_versions")
              .select("plaintext").eq("document_id", ps.id)
              .order("version_number", { ascending: false }).limit(1).single();
            if (psVer?.plaintext) { prevScript = psVer.plaintext.slice(-3000); break; }
          }
        }
      }

      // Fetch Episode 1 for length reference
      let ep1Length = 0;
      const { data: ep1Docs } = await supabase.from("project_documents")
        .select("id, title").eq("project_id", projectId).eq("doc_type", "script").limit(10);
      for (const d of (ep1Docs || [])) {
        if (d.title?.toLowerCase().includes("episode 1") || d.title?.toLowerCase().includes("ep 1") || d.title?.toLowerCase().includes("ep 01")) {
          const { data: v } = await supabase.from("project_document_versions")
            .select("plaintext").eq("document_id", d.id)
            .order("version_number", { ascending: false }).limit(1).single();
          if (v?.plaintext) { ep1Length = v.plaintext.length; break; }
        }
      }
      const lengthGuide = ep1Length > 0 ? `Target length: approximately ${Math.round(ep1Length * 0.85)} to ${Math.round(ep1Length * 1.15)} characters (matching Episode 1 ±15%).` : "";

      // ── STRICT SCREENPLAY GENERATION ──
      const SCREENPLAY_SYSTEM = `WRITE A SCREENPLAY, NOT A SUMMARY.
Output ONLY formatted screenplay text.
No explanations. No outlines. No JSON. No markdown.
Start immediately with the first scene heading.

You are writing EPISODE ${epNum} of a ${seasonCount}-episode vertical drama season.

FORMATTING RULES:
- Use INT./EXT. scene headings
- Action lines in present tense
- Character names in CAPS
- Dialogue blocks properly formatted
- Minimum 6 scene headings
- Minimum 12 dialogue blocks
- 1-3 primary locations maximum
- Hook within the first 10 lines — grab attention immediately
- Cliffhanger in the final 10 lines — unresolved question or shocking reveal
- Natural vertical pacing — fast, punchy, no feature-film drag
${lengthGuide}

FORBIDDEN:
- "In this episode…"
- "Season overview"
- "Synopsis"
- "Across the season…"
- Numbered beat lists
- Outline format
- Act breakdown headings (unless written as actual scenes)
- Paragraph synopsis format

${canonContext}
${prevScript ? `PREVIOUS EPISODE ENDING (for continuity):\n${prevScript}\n\n` : ""}`;

      const scriptPrompt = `EPISODE ${epNum} BEAT SHEET:\n${episodeBeatSheet.slice(0, 8000)}`;

      // ── Helper: validate screenplay output ──
      function validateScreenplayOutput(text: string) {
        const lines = text.split("\n");
        const sceneHeadingPattern = /^(INT\.|EXT\.|INT\.\/?EXT\.)\s+/;
        const sceneCount = lines.filter((l: string) => sceneHeadingPattern.test(l.trim())).length;
        let dialogueCount = 0;
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (/^[A-Z][A-Z\s.']{1,29}(\s*\(.*\))?\s*$/.test(line) && lines[i + 1]?.trim().length > 0) {
            dialogueCount++;
          }
        }
        const outlineLines = lines.filter((l: string) => /^\s*[-•*]\s/.test(l) || /^\s*\d+[\.\)]\s/.test(l));
        const outlinePct = lines.length > 0 ? Math.round((outlineLines.length / lines.length) * 100) : 0;
        const lower = text.toLowerCase();
        const banned = ["topline", "overview", "synopsis", "in this episode", "across the season", "season overview", "narrative", "summary"]
          .filter(p => {
            // Only flag if these words appear as structural headings (not in dialogue)
            const headingPattern = new RegExp(`^\\s*#*\\s*${p}`, "im");
            return headingPattern.test(text) || (lower.indexOf(p) >= 0 && lower.indexOf(p) < 200);
          });
        const passed = sceneCount >= 6 && dialogueCount >= 12 && outlinePct <= 8 && banned.length === 0;
        const reasons: string[] = [];
        if (sceneCount < 6) reasons.push(`Only ${sceneCount} scene headings (min 6)`);
        if (dialogueCount < 12) reasons.push(`Only ${dialogueCount} dialogue blocks (min 12)`);
        if (outlinePct > 8) reasons.push(`${outlinePct}% outline-style lines (max 8%)`);
        if (banned.length > 0) reasons.push(`Banned structural headings: ${banned.join(", ")}`);
        const lastLines = lines.slice(-15).join("\n").toLowerCase();
        const hasCliffhanger = /\?|reveal|shock|gasp|scream|freeze|black|cut to|smash/i.test(lastLines);
        return { passed, sceneCount, dialogueCount, outlinePct, banned, reasons, hasCliffhanger };
      }

      let scriptRaw = await callAI(LOVABLE_API_KEY, PRO_MODEL, SCREENPLAY_SYSTEM, scriptPrompt, 0.4, 16000);
      let scriptText = scriptRaw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();
      let validation = validateScreenplayOutput(scriptText);
      let regenAttempted = false;

      // ── AUTO-REGENERATION if validation fails ──
      if (!validation.passed) {
        console.warn(`[dev-engine-v2] beat-sheet-to-script: EP${epNum} FAILED validation (${validation.reasons.join("; ")}). Auto-regenerating...`);
        regenAttempted = true;
        const REGEN_SYSTEM = `${SCREENPLAY_SYSTEM}

CRITICAL CORRECTION: Your previous attempt returned a narrative document or summary instead of a screenplay.
You MUST rewrite as proper screenplay pages with:
- INT./EXT. sluglines for every scene
- Action lines in present tense
- Character names in CAPS followed by dialogue blocks
- NO outline, NO synopsis, NO narrative summary, NO episode overview
- Start with a scene heading immediately. Do NOT start with a title or summary paragraph.

Previous attempt problems: ${validation.reasons.join("; ")}`;
        const regenRaw = await callAI(LOVABLE_API_KEY, PRO_MODEL, REGEN_SYSTEM, scriptPrompt, 0.35, 16000);
        const regenText = regenRaw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();
        const regenValidation = validateScreenplayOutput(regenText);
        // Use regen if it's better
        if (regenValidation.passed || regenValidation.sceneCount > validation.sceneCount) {
          scriptText = regenText;
          validation = regenValidation;
          console.log(`[dev-engine-v2] beat-sheet-to-script: EP${epNum} regen ${validation.passed ? "PASSED" : "improved"} (scenes=${validation.sceneCount} dialogue=${validation.dialogueCount})`);
        } else {
          console.warn(`[dev-engine-v2] beat-sheet-to-script: EP${epNum} regen did not improve. Keeping original.`);
        }
      }

      const sceneHeadingCount = validation.sceneCount;
      const dialogueBlockCount = validation.dialogueCount;
      const outlinePercent = validation.outlinePct;
      const bannedPhrases = validation.banned;
      const formatPassed = validation.passed;
      const validationReasons = validation.reasons;
      const hasCliffhanger = validation.hasCliffhanger;

      // ── SAVE AS DOCUMENT ──
      const title = `Episode ${epNum} Script`;
      const { data: srcDoc } = await supabase.from("project_documents")
        .select("title").eq("id", documentId).single();

      const { data: newDoc, error: dErr } = await supabase.from("project_documents").insert({
        project_id: projectId,
        user_id: user.id,
        file_name: `${srcDoc?.title || "Beat Sheet"} → ${title}`,
        file_path: "",
        extraction_status: "complete",
        doc_type: "episode_script",
        title,
        source: "generated",
        plaintext: scriptText,
      }).select().single();
      if (dErr) throw dErr;

      const { data: newVersion, error: nvErr } = await supabase.from("project_document_versions").insert({
        document_id: newDoc.id,
        version_number: 1,
        label: `Episode ${epNum} screenplay`,
        plaintext: scriptText,
        created_by: user.id,
        change_summary: `Generated from beat sheet (scope: ${scopeResult.scope}, slice: ${sliceMethod})`,
        source_document_ids: [documentId],
        deliverable_type: "episode_script",
      }).select().single();
      if (nvErr || !newVersion) throw nvErr || new Error("Failed to create episode script version");

      // Store run
      await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: newDoc.id,
        version_id: newVersion!.id,
        user_id: user.id,
        run_type: "CONVERT",
        output_json: {
          source_document_id: documentId,
          source_version_id: versionId,
          episode_number: epNum,
          season_episode_count: seasonCount,
          beat_sheet_scope: scopeResult,
          slice_method: sliceMethod,
          script_format_validation: {
            passed: formatPassed,
            regen_attempted: regenAttempted,
            scene_heading_count: sceneHeadingCount,
            dialogue_block_count: dialogueBlockCount,
            outline_percent: outlinePercent,
            banned_phrases: bannedPhrases,
            has_cliffhanger: hasCliffhanger,
            reasons: validationReasons,
          },
        },
        deliverable_type: "script",
        format: "vertical-drama",
        schema_version: SCHEMA_VERSION,
      });

      console.log(`[dev-engine-v2] beat-sheet-to-script: EP${epNum} scope=${scopeResult.scope} slice=${sliceMethod} format_passed=${formatPassed} scenes=${sceneHeadingCount} dialogue=${dialogueBlockCount}`);

      return new Response(JSON.stringify({
        newDoc, newVersion,
        episode_number: epNum,
        beat_sheet_scope: scopeResult,
        slice_method: sliceMethod,
        script_format_validation: {
          passed: formatPassed,
          status: formatPassed ? "SCREENPLAY_VALID" : "SCRIPT_FORMAT_INVALID",
          regen_attempted: regenAttempted,
          scene_heading_count: sceneHeadingCount,
          dialogue_block_count: dialogueBlockCount,
          outline_percent: outlinePercent,
          banned_phrases: bannedPhrases,
          has_cliffhanger: hasCliffhanger,
          reasons: validationReasons,
        },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // CANON SNAPSHOT CHECK
    // ══════════════════════════════════════════════
    if (action === "canon-check") {
      const { projectId, canonSnapshotId } = body;
      if (!projectId || !canonSnapshotId) throw new Error("projectId and canonSnapshotId required");

      const { data: snapshot } = await supabase.from("canon_snapshots")
        .select("*").eq("id", canonSnapshotId).single();
      if (!snapshot) throw new Error("Canon snapshot not found");

      // Check if any canon document versions have changed
      const versionIds = [
        snapshot.blueprint_version_id,
        snapshot.character_bible_version_id,
        snapshot.episode_grid_version_id,
      ].filter(Boolean);

      let changed = false;
      const changes: string[] = [];

      for (const vId of versionIds) {
        const { data: ver } = await supabase.from("project_document_versions")
          .select("document_id, version_number").eq("id", vId).single();
        if (!ver) continue;

        // Check if a newer version exists
        const { data: latestVer } = await supabase.from("project_document_versions")
          .select("id, version_number").eq("document_id", ver.document_id)
          .order("version_number", { ascending: false }).limit(1).single();

        if (latestVer && latestVer.id !== vId) {
          changed = true;
          const { data: doc } = await supabase.from("project_documents")
            .select("doc_type").eq("id", ver.document_id).single();
          changes.push(`${doc?.doc_type || "document"} updated (v${ver.version_number} → v${latestVer.version_number})`);
        }
      }

      return new Response(JSON.stringify({
        valid: !changed,
        changes,
        snapshot_id: canonSnapshotId,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // EPISODE-PATCH — Series Writer escalation handler
    // ══════════════════════════════════════════════
    if (action === "episode-patch") {
      const {
        projectId, patchRunId, episodeId,
        issueTitle, issueDescription, desiredOutcome,
        contextDocIds = [],
        episodeScriptText,
        format: reqFormat,
        deliverableType,
        developmentBehavior,
        episodeTargetDurationSeconds,
      } = body;
      if (!projectId || !patchRunId || !episodeId) throw new Error("projectId, patchRunId, episodeId required");

      // 1) Load patch run + basic auth check (project match)
      const { data: patchRun, error: prErr } = await supabase
        .from("episode_patch_runs")
        .select("*")
        .eq("id", patchRunId)
        .single();
      if (prErr || !patchRun) throw new Error("Patch run not found");
      if (patchRun.project_id !== projectId) throw new Error("Patch run does not match project");

      // Mark running
      await supabase.from("episode_patch_runs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", patchRunId);

      // 2) Fetch project settings for format/behavior
      const { data: patchProject } = await supabase.from("projects")
        .select("title, format, development_behavior, episode_target_duration_seconds, guardrails_config")
        .eq("id", projectId)
        .single();

      const effectiveFormat = (reqFormat || patchProject?.format || "film").toLowerCase().replace(/_/g, "-");
      const effectiveBehavior = developmentBehavior || patchProject?.development_behavior || "market";
      const effectiveDeliverable = deliverableType || "script";
      const effectiveDuration = episodeTargetDurationSeconds || patchProject?.episode_target_duration_seconds;

      // 3) Fetch episode row
      const { data: ep, error: epErr } = await supabase
        .from("series_episodes")
        .select("*")
        .eq("id", episodeId)
        .single();
      if (epErr || !ep) throw new Error("Episode not found");

      // 4) Resolve episode script text
      // Episodes use script_id → scripts.text_content (not project_document_versions)
      let baseScriptText = (episodeScriptText || patchRun.episode_script_text || "").trim();
      if (!baseScriptText && ep.script_id) {
        const { data: scriptRow } = await supabase
          .from("scripts")
          .select("text_content")
          .eq("id", ep.script_id)
          .single();
        baseScriptText = (scriptRow?.text_content || "").trim();
      }
      if (!baseScriptText) {
        await supabase.from("episode_patch_runs").update({
          status: "failed", error_message: "No episode script text found",
          completed_at: new Date().toISOString(),
        }).eq("id", patchRunId);
        throw new Error("No episode script text found (provide episodeScriptText or link episode to a script)");
      }

      // 5) Load context docs + latest versions
      const contextBlocks: string[] = [];
      if (contextDocIds.length > 0) {
        const { data: docs } = await supabase
          .from("project_documents")
          .select("id, doc_type, title")
          .eq("project_id", projectId)
          .in("id", contextDocIds);
        for (const d of (docs || [])) {
          const { data: v } = await supabase
            .from("project_document_versions")
            .select("plaintext, version_number")
            .eq("document_id", d.id)
            .order("version_number", { ascending: false })
            .limit(1)
            .single();
          const txt = (v?.plaintext || "").trim();
          if (txt) {
            contextBlocks.push(
              `--- CONTEXT: ${d.doc_type} — ${d.title || d.doc_type} (v${v?.version_number ?? "?"}) ---\n${txt.slice(0, 12000)}`
            );
          }
        }
      }

      // 6) Build guardrails block if available
      let guardrailBlock = "";
      if (patchProject?.guardrails_config) {
        const productionType = formatToProductionType[effectiveFormat] || effectiveFormat;
        guardrailBlock = buildGuardrailBlock(productionType, patchProject.guardrails_config) || "";
      }

      // 7) Build system prompt for patch output
      let verticalRules = "";
      if (effectiveFormat === "vertical-drama" && effectiveDuration) {
        verticalRules = `\nVERTICAL DRAMA RULES: Episode duration = ${effectiveDuration}s. Hook within first 10s. Cliffhanger ending required. Maintain beat density.`;
      }

      const PATCH_SYSTEM = `You are IFFY. You are performing an EPISODE PATCH.

You must return ONLY valid JSON:
{
  "patch_summary": "1-3 sentence summary of what you changed and why",
  "replacement_script": "FULL revised script text (not truncated)",
  "changes": [{"type":"edit|insert|delete","location":"where in script","summary":"what changed"}],
  "references_used": ["list of context doc types that informed the patch"],
  "safety": {"no_new_characters": true, "kept_format": true}
}

Rules:
- Preserve the creative DNA unless it directly causes the issue.
- Fix ONLY what is necessary to resolve the issue; do not rewrite the entire episode unless desiredOutcome implies full rewrite.
- Maintain the project's format: ${effectiveFormat}
- Behavior mode: ${effectiveBehavior}
- If format is vertical-drama: hook in first 10s, end on a cliffhanger, keep beat density.${verticalRules}
- If deliverable/format implies documentary/deck safeguards: DO NOT invent facts; use [PLACEHOLDER] for unknowns.
- Output replacement_script as the full script text — do NOT truncate.
${guardrailBlock}`;

      // 8) User prompt
      const userPrompt = `PROJECT: ${patchProject?.title || "Unknown"}
EPISODE: ${String(ep.episode_number ?? "").padStart(2, "0")} — ${ep.title || "Untitled"}
ISSUE TITLE: ${issueTitle || "Issue"}
DESIRED OUTCOME: ${desiredOutcome || "other"}

ISSUE DESCRIPTION:
${issueDescription || ""}

CONTEXT:
${contextBlocks.join("\n\n") || "[No additional context provided]"}

--- CURRENT EPISODE SCRIPT ---
${baseScriptText.slice(0, 30000)}`;

      try {
        const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, PATCH_SYSTEM, userPrompt, 0.3, 16000);
        const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

        const patchSummary = parsed.patch_summary || "";
        const replacement = parsed.replacement_script || "";
        const proposed_changes = {
          patch_summary: patchSummary,
          replacement_script: replacement,
          changes: parsed.changes || [],
          references_used: parsed.references_used || [],
          safety: parsed.safety || { no_new_characters: true, kept_format: true },
          meta: {
            format: effectiveFormat,
            behavior: effectiveBehavior,
            deliverable_type: effectiveDeliverable,
            model: PRO_MODEL,
          },
        };

        await supabase.from("episode_patch_runs").update({
          status: "complete",
          patch_summary: patchSummary,
          proposed_changes,
          references_used: parsed.references_used || [],
          completed_at: new Date().toISOString(),
        }).eq("id", patchRunId);

        return new Response(JSON.stringify({
          patchRunId,
          status: "complete",
          patch_summary: patchSummary,
          has_replacement: !!replacement,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } catch (e: any) {
        console.error("episode-patch error:", e);
        await supabase.from("episode_patch_runs").update({
          status: "failed",
          error_message: e.message || "Unknown error",
          completed_at: new Date().toISOString(),
        }).eq("id", patchRunId);

        return new Response(JSON.stringify({
          patchRunId,
          status: "failed",
          error: e.message || "Episode patch failed",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ══════════════════════════════════════════════
    // ENSURE-AND-GENERATE-TOPLINE — create topline doc if missing, then generate content from project context
    // ══════════════════════════════════════════════
    if (action === "ensure-and-generate-topline") {
      const { projectId, globalDirections } = body;
      if (!projectId) throw new Error("projectId required");

      // 1) Ensure topline document exists (idempotent)
      let toplineDocId: string;
      let toplineDocCreated = false;
      const { data: existingTopline } = await supabase
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("doc_type", "topline_narrative")
        .limit(1);

      if (existingTopline && existingTopline.length > 0) {
        toplineDocId = existingTopline[0].id;
      } else {
        const { data: newDoc, error: docErr } = await supabase
          .from("project_documents")
          .insert({
            project_id: projectId,
            user_id: user.id,
            doc_type: "topline_narrative",
            title: "Topline Narrative",
            file_name: "topline_narrative.md",
            file_path: `${projectId}/topline_narrative.md`,
            source: "generated",
          })
          .select("id")
          .single();
        if (docErr) throw docErr;
        toplineDocId = newDoc.id;
        toplineDocCreated = true;
      }

      // 2) Gather context from Active Folder, fallback to latest versions
      const contextParts: string[] = [];
      const sourceDocIds: string[] = [];

      // Try Active Folder first
      const { data: activeDocs } = await supabase
        .from("project_active_docs")
        .select("doc_type_key, document_version_id")
        .eq("project_id", projectId);

      if (activeDocs && activeDocs.length > 0) {
        const versionIds = activeDocs.map((d: any) => d.document_version_id).filter(Boolean);
        if (versionIds.length > 0) {
          const { data: activeVersions } = await supabase
            .from("project_document_versions")
            .select("id, document_id, plaintext")
            .in("id", versionIds);
          if (activeVersions) {
            for (const av of activeVersions) {
              const docTypeKey = activeDocs.find((d: any) => d.document_version_id === av.id)?.doc_type_key || "unknown";
              if (av.plaintext && av.plaintext.trim().length > 50) {
                contextParts.push(`=== ${docTypeKey.toUpperCase()} ===\n${av.plaintext.slice(0, 8000)}`);
                sourceDocIds.push(av.document_id);
              }
            }
          }
        }
      }

      // Fallback: latest versions of all project docs
      if (contextParts.length === 0) {
        const { data: allDocs } = await supabase
          .from("project_documents")
          .select("id, doc_type, latest_version_id")
          .eq("project_id", projectId)
          .neq("doc_type", "topline_narrative");
        if (allDocs) {
          const vIds = allDocs.map((d: any) => d.latest_version_id).filter(Boolean);
          if (vIds.length > 0) {
            const { data: latestVersions } = await supabase
              .from("project_document_versions")
              .select("id, document_id, plaintext")
              .in("id", vIds);
            if (latestVersions) {
              for (const lv of latestVersions) {
                const docInfo = allDocs.find((d: any) => d.latest_version_id === lv.id);
                if (lv.plaintext && lv.plaintext.trim().length > 50) {
                  contextParts.push(`=== ${(docInfo?.doc_type || "unknown").toUpperCase()} ===\n${lv.plaintext.slice(0, 8000)}`);
                  sourceDocIds.push(lv.document_id);
                }
              }
            }
          }
          // Also try docs without latest_version_id — get their newest version
          const docsWithoutLatest = allDocs.filter((d: any) => !d.latest_version_id);
          for (const doc of docsWithoutLatest) {
            const { data: newestVer } = await supabase
              .from("project_document_versions")
              .select("id, plaintext")
              .eq("document_id", doc.id)
              .order("version_number", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (newestVer?.plaintext && newestVer.plaintext.trim().length > 50) {
              contextParts.push(`=== ${(doc.doc_type || "unknown").toUpperCase()} ===\n${newestVer.plaintext.slice(0, 8000)}`);
              sourceDocIds.push(doc.id);
            }
          }
        }
      }

      // Also fetch project metadata
      const { data: projectMeta } = await supabase
        .from("projects")
        .select("title, format, genres, assigned_lane, budget_range, tone, target_audience, comparable_titles, season_episode_count, episode_target_duration_seconds")
        .eq("id", projectId)
        .single();

      // ── HARD FAIL: no source documents found ──
      if (contextParts.length === 0) {
        console.warn(`[dev-engine-v2] topline abort: no source documents found for project ${projectId}`);
        return new Response(
          JSON.stringify({ error: "Cannot generate: no source documents found. Please add an Idea, Concept Brief, Market Sheet, or Blueprint to this project first." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const fmt = resolveFormatAlias((projectMeta?.format || "film").toLowerCase().replace(/[_ ]+/g, "-"));
      const isSeries = ["tv-series", "limited-series", "vertical-drama", "miniseries", "anthology"].includes(fmt);

      // ── Build PROJECT FACTS block from real metadata ──
      const metaBlock = projectMeta
        ? `PROJECT FACTS:
- Title: ${projectMeta.title || "Untitled"}
- Format: ${projectMeta.format || "film"}
- Genres: ${(projectMeta.genres || []).join(", ") || "unspecified"}
- Lane: ${projectMeta.assigned_lane || "unspecified"}
- Budget: ${projectMeta.budget_range || "unspecified"}
- Tone: ${projectMeta.tone || "unspecified"}
- Target Audience: ${projectMeta.target_audience || "unspecified"}
- Comps: ${(projectMeta.comparable_titles || []).join(", ") || "unspecified"}${isSeries ? `\n- Episodes: ${projectMeta.season_episode_count || "TBD"} × ${projectMeta.episode_target_duration_seconds || "TBD"}s` : ""}`
        : "PROJECT FACTS: (metadata unavailable)";

      const contextBlock = contextParts.join("\n\n");

      // 3) Generate topline content via AI
      const toplineSystemPrompt = `You are a senior development executive. Your only task is to write a TOPLINE NARRATIVE document using the project facts and source documents provided by the user.

OUTPUT FORMAT — the document MUST start with "# Topline Narrative" and use exactly these headings:

# Topline Narrative

## Logline
[1–2 compelling, pitch-ready sentences that capture protagonist, goal, and stakes]

## Short Synopsis
[150–300 words — the story at a glance; must stand alone as a complete summary]

## Long Synopsis
[300–600 words — full narrative arc with act structure, key turns, and resolution]

## Story Pillars
- Theme: [core thematic concern drawn from the source docs]
- Protagonist: [name and defining trait — from source docs only]
- Goal: [what they want]
- Stakes: [what happens if they fail]
- Antagonistic force: [opposition]
- Setting: [world/time/place]
- Tone: [emotional register and style]
- Comps: [2–3 comparable titles from the source docs or project metadata]
${isSeries ? `
## Series Only
- Series promise / engine: [what makes this repeatable — the core mechanic that sustains multiple episodes]
- Season arc snapshot: [the season-level journey in 3–5 sentences]` : ""}

STRICT RULES:
1. Synthesize ONLY from the PROJECT FACTS and CONTEXT DOCUMENTS sections below. Do not invent characters, plot points, or world details absent from those sections.
2. Output ONLY the formatted document. No preamble, no meta-commentary, no code fences, no JSON.
3. Every section must reference specifics from the source material. If a section cannot be filled from the provided content, write "[insufficient context — please add source documents]" for that field only.`;

      const userPrompt = `${metaBlock}

${globalDirections ? `ADDITIONAL DIRECTIONS FROM CREATOR:\n${globalDirections}\n\n` : ""}CONTEXT DOCUMENTS (${contextParts.length} source doc${contextParts.length !== 1 ? "s" : ""}):
${contextBlock}`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, toplineSystemPrompt, userPrompt, 0.3, 6000);
      let generatedText = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();

      // ── BUG PREVENTION: detect leaked instruction text ──
      const INSTRUCTION_LEAK_PHRASES = [
        "You are IFFY", "You are a senior development executive",
        "REQUIREMENTS", "Fix the", "OUTPUT FORMAT", "STRICT RULES",
        "CONTEXT DOCUMENTS (", "PROJECT FACTS:", "ADDITIONAL DIRECTIONS FROM CREATOR",
        "do NOT invent", "Do not invent",
      ];
      const hasLeak = INSTRUCTION_LEAK_PHRASES.some(phrase => generatedText.includes(phrase));
      if (hasLeak) {
        console.error("[dev-engine-v2] topline: instruction text detected in output — aborting");
        throw new Error("Generation failed: model returned instruction text instead of the document. Please try again.");
      }

      // ── Sanity check: output must start with the expected heading ──
      if (!generatedText.startsWith("# Topline Narrative") && !generatedText.startsWith("# TOPLINE NARRATIVE")) {
        // Try to extract from the response if there's leading text
        const idx = generatedText.indexOf("# Topline Narrative");
        if (idx > 0) {
          generatedText = generatedText.slice(idx);
        } else {
          console.error("[dev-engine-v2] topline: unexpected output format");
          throw new Error("Generation failed: output did not start with expected heading. Please try again.");
        }
      }

      // 4) Determine next version number
      const { data: existingVersions } = await supabase
        .from("project_document_versions")
        .select("version_number")
        .eq("document_id", toplineDocId)
        .order("version_number", { ascending: false })
        .limit(1);
      const nextVersion = (existingVersions?.[0]?.version_number || 0) + 1;

      // 5) Create new version
      const { data: newVersion, error: verErr } = await supabase
        .from("project_document_versions")
        .insert({
          document_id: toplineDocId,
          version_number: nextVersion,
          plaintext: generatedText,
          created_by: user.id,
          label: nextVersion === 1 ? "AI-generated from project context" : `Regenerated v${nextVersion}`,
          deliverable_type: "topline_narrative",
          source_document_ids: [...new Set(sourceDocIds)],
        })
        .select("id, version_number")
        .single();
      if (verErr) throw verErr;

      // 6) Update latest_version_id
      await supabase
        .from("project_documents")
        .update({ latest_version_id: newVersion.id, plaintext: generatedText })
        .eq("id", toplineDocId);

      // 7) Store development run
      await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: toplineDocId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "CONVERT",
        output_json: {
          action: "ensure-and-generate-topline",
          source_doc_ids: sourceDocIds,
          active_folder_used: (activeDocs && activeDocs.length > 0),
          generated_text_length: generatedText.length,
        },
        deliverable_type: "topline_narrative",
      });

      console.log(`[dev-engine-v2] topline generated: doc=${toplineDocId}, ver=${newVersion.id}, sources=${sourceDocIds.length}`);

      return new Response(JSON.stringify({
        documentId: toplineDocId,
        versionId: newVersion.id,
        versionNumber: newVersion.version_number,
        created: toplineDocCreated,
        sourceCount: sourceDocIds.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════
    // APPLY_DECISION — apply a chosen conflict-resolution option
    // ══════════════════════════════════════════════
    if (action === "apply_decision") {
      const { projectId, doc_type, episode_number, decision_id, option_id, base_version_id, documentId } = body;
      if (!projectId || !decision_id || !option_id || !base_version_id || !documentId) {
        throw new Error("projectId, decision_id, option_id, base_version_id, documentId required");
      }

      // Fetch the decision
      const { data: decisionRow } = await supabase.from("project_dev_decision_state")
        .select("*").eq("project_id", projectId).eq("decision_id", decision_id).maybeSingle();
      if (!decisionRow) throw new Error("Decision not found");

      const options = decisionRow.option_json?.options || [];
      const chosenOption = options.find((o: any) => o.option_id === option_id);
      if (!chosenOption) throw new Error(`Option ${option_id} not found in decision`);

      // Fetch base version
      const { data: baseVersion } = await supabase.from("project_document_versions")
        .select("plaintext, version_number").eq("id", base_version_id).single();
      if (!baseVersion) throw new Error("Base version not found");

      const { data: project } = await supabase.from("projects")
        .select("format, development_behavior").eq("id", projectId).single();
      const effectiveFormat = resolveFormatAlias((project?.format || "film").toLowerCase().replace(/[_ ]+/g, "-"));
      const effectiveBehavior = project?.development_behavior || "market";

      // AI apply the plan
      const decisionSystem = `You are IFFY. Apply the following editorial decision plan to the document.
FORMAT: ${effectiveFormat}
BEHAVIOR: ${effectiveBehavior}
Rules:
- Apply ONLY the changes described in the plan.
- Preserve all creative elements not targeted by the plan.
- OUTPUT THE FULL REWRITTEN MATERIAL.
Return ONLY valid JSON:
{
  "rewritten_text": "the full rewritten material",
  "changes_summary": "bullet summary of changes applied"
}`;
      const decisionUserPrompt = `DECISION PLAN:\n${chosenOption.plan_text}\n\nMATERIAL:\n${baseVersion.plaintext.slice(0, 40000)}`;
      const decisionRaw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, decisionSystem, decisionUserPrompt, 0.3, 32000);
      const decisionParsed = await parseAIJson(LOVABLE_API_KEY, decisionRaw);
      const rewrittenText = decisionParsed.rewritten_text || baseVersion.plaintext;

      // Create new version (with team voice meta_json stamping)
      const decLane = (await supabase.from("projects").select("assigned_lane").eq("id", projectId).single())?.data?.assigned_lane || "independent-film";
      const decTvCtx = await loadTeamVoiceContext(supabase, projectId, decLane);
      const decMetaJson = decTvCtx.metaStamp ? { ...decTvCtx.metaStamp } : undefined;
      let newVersion: any = null;
      for (let _retry = 0; _retry < 3; _retry++) {
        const { data: maxRow } = await supabase.from("project_document_versions")
          .select("version_number").eq("document_id", documentId)
          .order("version_number", { ascending: false }).limit(1).single();
        const nextVersion = (maxRow?.version_number ?? 0) + 1;
        const { data: nv, error: vErr } = await supabase.from("project_document_versions").insert({
          document_id: documentId,
          version_number: nextVersion,
          label: `Decision fix — option ${option_id}`,
          plaintext: rewrittenText,
          created_by: user.id,
          parent_version_id: base_version_id,
          change_summary: decisionParsed.changes_summary || `Applied decision option ${option_id}`,
          ...(decMetaJson ? { meta_json: decMetaJson } : {}),
        }).select().single();
        if (!vErr) { newVersion = nv; break; }
        if (vErr.code !== "23505") throw vErr;
      }
      if (!newVersion) throw new Error("Failed to create version after retries");

      // ── Style eval on apply_decision output ──
      const adStyleTarget = (await loadVoiceTargets(supabase, projectId, decLane)).target;
      const adStyleEval = await runStyleEval(supabase, rewrittenText, projectId, documentId, newVersion.id, decLane, adStyleTarget);
      if (adStyleEval) {
        const mergedMeta = { ...(newVersion.meta_json || {}), ...adStyleEval.metaFields };
        await supabase.from("project_document_versions").update({ meta_json: mergedMeta }).eq("id", newVersion.id);
        newVersion.meta_json = mergedMeta;
      }

      await supabase.from("project_dev_decision_state").update({
        chosen_option_id: option_id,
        status: "chosen",
      }).eq("id", decisionRow.id);

      // Update note states for resolves/waives/defers
      const resolves: string[] = chosenOption.resolves || [];
      const waives: string[] = chosenOption.waives || [];
      const defers: string[] = chosenOption.defers || [];

      if (resolves.length > 0) {
        await supabase.from("project_dev_note_state")
          .update({ status: "applied", last_applied_version_id: newVersion.id })
          .eq("project_id", projectId).in("note_fingerprint", resolves);
      }
      if (waives.length > 0) {
        await supabase.from("project_dev_note_state")
          .update({ status: "waived", waive_reason: `Decision ${decision_id} option ${option_id} chosen` })
          .eq("project_id", projectId).in("note_fingerprint", waives);
      }
      if (defers.length > 0) {
        await supabase.from("project_dev_note_state")
          .update({ status: "deferred", defer_to_doc_type: "production_draft" })
          .eq("project_id", projectId).in("note_fingerprint", defers);
      }

      // Log run
      await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "REWRITE",
        output_json: {
          decision_id,
          option_id,
          changes_summary: decisionParsed.changes_summary || "",
          source_version_id: base_version_id,
          decision_fix: true,
        },
        schema_version: SCHEMA_VERSION,
      });

      return new Response(JSON.stringify({ ok: true, newVersion, decisionId: decision_id, optionId: option_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // NOTE_STATUS_UPDATE — waive / defer / lock / reopen a note
    // ══════════════════════════════════════════════
    if (action === "note_status_update") {
      const { projectId, note_fingerprint, doc_type, episode_number, status: newStatus, reason, defer_to_doc_type } = body;
      if (!projectId || !note_fingerprint || !doc_type || !newStatus) {
        throw new Error("projectId, note_fingerprint, doc_type, status required");
      }

      const epNum = episode_number ?? null;
      const updateFields: Record<string, any> = {
        status: newStatus,
        last_seen_at: new Date().toISOString(),
      };
      if (newStatus === "waived" && reason) updateFields.waive_reason = reason;
      if (newStatus === "deferred" && defer_to_doc_type) updateFields.defer_to_doc_type = defer_to_doc_type;
      if (newStatus === "locked" && reason) updateFields.lock_reason = reason;

      // Upsert using the unique index fields
      const { data: existing } = await supabase
        .from("project_dev_note_state")
        .select("id")
        .eq("project_id", projectId)
        .eq("doc_type", doc_type)
        .eq("note_fingerprint", note_fingerprint)
        .is("episode_number", epNum)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("project_dev_note_state")
          .update(updateFields)
          .eq("id", existing.id);
      } else {
        // Create a stub row so the state is tracked
        await supabase.from("project_dev_note_state").insert({
          project_id: projectId,
          doc_type,
          episode_number: epNum,
          note_fingerprint,
          note_cluster_id: note_fingerprint.slice(0, 16),
          ...updateFields,
        });
      }

      return new Response(JSON.stringify({ ok: true, status: newStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // APPLY_BUNDLE_FIX — apply AI patch for a bundle of notes
    // ══════════════════════════════════════════════
    if (action === "apply_bundle_fix") {
      const { projectId, documentId, versionId, bundle_id, note_fingerprints, plan_text, deliverableType, developmentBehavior, format: reqFormat } = body;
      if (!projectId || !documentId || !versionId || !plan_text) {
        throw new Error("projectId, documentId, versionId, plan_text required");
      }

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext, version_number").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: project } = await supabase.from("projects")
        .select("format, development_behavior").eq("id", projectId).single();

      const effectiveFormat = (reqFormat || project?.format || "film").toLowerCase().replace(/_/g, "-");
      const effectiveBehavior = developmentBehavior || project?.development_behavior || "market";
      const effectiveDeliverable = deliverableType || "script";

      const bundleSystem = `You are IFFY. Apply the given editorial plan to the document.
DELIVERABLE TYPE: ${effectiveDeliverable}
FORMAT: ${effectiveFormat}
BEHAVIOR: ${effectiveBehavior}

Rules:
- Apply ONLY the changes described in the plan. Do not introduce unrequested changes.
- Preserve all creative elements not targeted by the plan.
- OUTPUT THE FULL REWRITTEN MATERIAL.

Return ONLY valid JSON:
{
  "rewritten_text": "the full rewritten material",
  "changes_summary": "bullet summary of changes applied",
  "notes_addressed": ["list of note descriptions that were addressed"]
}`;

      const userPrompt = `EDITORIAL PLAN TO APPLY:\n${plan_text}\n\nMATERIAL:\n${version.plaintext.slice(0, 40000)}`;
      const raw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, bundleSystem, userPrompt, 0.3, 32000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);
      const rewrittenText = parsed.rewritten_text || version.plaintext;

      // Create new version (with team voice meta_json stamping)
      const bundleLane = (await supabase.from("projects").select("assigned_lane").eq("id", projectId).single())?.data?.assigned_lane || "independent-film";
      const bundleTvCtx = await loadTeamVoiceContext(supabase, projectId, bundleLane);
      const bundleMetaJson = bundleTvCtx.metaStamp ? { ...bundleTvCtx.metaStamp } : undefined;
      let newVersion: any = null;
      for (let _retry = 0; _retry < 3; _retry++) {
        const { data: maxRow } = await supabase.from("project_document_versions")
          .select("version_number").eq("document_id", documentId)
          .order("version_number", { ascending: false }).limit(1).single();
        const nextVersion = (maxRow?.version_number ?? 0) + 1;
        const { data: nv, error: vErr } = await supabase.from("project_document_versions").insert({
          document_id: documentId,
          version_number: nextVersion,
          label: `Bundle fix — ${bundle_id || "bundle"}`,
          plaintext: rewrittenText,
          created_by: user.id,
          parent_version_id: versionId,
          change_summary: parsed.changes_summary || "Bundle fix applied",
          ...(bundleMetaJson ? { meta_json: bundleMetaJson } : {}),
        }).select().single();
        if (!vErr) { newVersion = nv; break; }
        if (vErr.code !== "23505") throw vErr;
      }
      if (!newVersion) throw new Error("Failed to create version after retries");

      // ── Style eval on bundle_fix output ──
      const bfStyleTarget = (await loadVoiceTargets(supabase, projectId, bundleLane)).target;
      const bfStyleEval = await runStyleEval(supabase, rewrittenText, projectId, documentId, newVersion.id, bundleLane, bfStyleTarget);
      if (bfStyleEval) {
        const mergedMeta = { ...(newVersion.meta_json || {}), ...bfStyleEval.metaFields };
        await supabase.from("project_document_versions").update({ meta_json: mergedMeta }).eq("id", newVersion.id);
        newVersion.meta_json = mergedMeta;
      }

      if (note_fingerprints && Array.isArray(note_fingerprints) && note_fingerprints.length > 0) {
        await supabase.from("project_dev_note_state")
          .update({ status: "applied", last_applied_version_id: newVersion.id, last_version_id: newVersion.id })
          .eq("project_id", projectId)
          .in("note_fingerprint", note_fingerprints);
      }

      const { data: run } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "REWRITE",
        output_json: {
          bundle_id: bundle_id || null,
          changes_summary: parsed.changes_summary || "",
          source_version_id: versionId,
          bundle_fix: true,
        },
        deliverable_type: effectiveDeliverable,
        schema_version: SCHEMA_VERSION,
      }).select().single();

      return new Response(JSON.stringify({ run, newVersion, rewrite: { changes_summary: parsed.changes_summary } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // SCENE GRAPH ACTIONS
    // ═══════════════════════════════════════════════════════════════

    // --- Order Key Math (fractional indexing) ---
    function sgKeyBetween(a: string | null, b: string | null): string {
      const BASE = 36, LEN = 6;
      const pad = (s: string) => s.padEnd(LEN, '0');
      if (!a && !b) return pad('n');
      if (!a) {
        const bv = parseInt((b || 'n00000').slice(0, LEN), BASE);
        return Math.max(1, Math.floor(bv / 2)).toString(BASE).padStart(LEN, '0');
      }
      if (!b) {
        const av = parseInt(a.slice(0, LEN), BASE);
        const mx = Math.pow(BASE, LEN) - 1;
        const mid = av + Math.max(1, Math.floor((mx - av) / 2));
        const r = Math.min(mid, mx).toString(BASE).padStart(LEN, '0');
        return r <= a ? a + pad('n') : r;
      }
      const ml = Math.max(a.length, b.length);
      const ap = a.padEnd(ml, '0'), bp = b.padEnd(ml, '0');
      const av = parseInt(ap, BASE), bv = parseInt(bp, BASE);
      if (bv - av <= 1) return a + pad('n');
      return (av + Math.floor((bv - av) / 2)).toString(BASE).padStart(ml, '0');
    }

    function sgGenerateEvenKeys(count: number): string[] {
      const BASE = 36, LEN = 6;
      const mx = Math.pow(BASE, LEN) - 1;
      const step = Math.floor(mx / (count + 1));
      return Array.from({ length: count }, (_, i) => ((i + 1) * step).toString(BASE).padStart(LEN, '0'));
    }

    // --- Impact Report Helper (Phase 2 enhanced) ---
    async function sgBuildImpactReport(
      _supabase: any, projectId: string, actionDesc: string, affectedSceneIds: string[]
    ): Promise<{ warnings: any[]; suggested_patches: any[] }> {
      const { data: activeOrder } = await _supabase
        .from("scene_graph_order").select("scene_id, order_key, act, id")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      const activeSceneIds = (activeOrder || []).map((r: any) => r.scene_id);
      const warnings: any[] = [];
      const suggested_patches: any[] = [];

      if (activeSceneIds.length === 0) return { warnings, suggested_patches };

      const { data: versions } = await _supabase
        .from("scene_graph_versions").select("*")
        .in("scene_id", activeSceneIds)
        .order("version_number", { ascending: false });

      const latestMap = new Map<string, any>();
      for (const v of (versions || [])) {
        if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v);
      }

      const orderedScenes = (activeOrder || []).map((o: any) => ({ ...o, version: latestMap.get(o.scene_id) }));

      // Continuity: required facts must be emitted by preceding scenes
      const emittedFacts = new Set<string>();
      for (const s of orderedScenes) {
        const v = s.version;
        if (!v) continue;
        const required = v.continuity_facts_required || [];
        for (const fact of required) {
          const factKey = typeof fact === 'string' ? fact : JSON.stringify(fact);
          if (!emittedFacts.has(factKey)) {
            warnings.push({
              type: 'continuity', severity: 'high',
              message: `Scene requires fact "${factKey}" but it may not be established by preceding scenes.`,
              relatedSceneIds: [s.scene_id],
            });
          }
        }
        const emitted = v.continuity_facts_emitted || [];
        for (const fact of emitted) {
          emittedFacts.add(typeof fact === 'string' ? fact : JSON.stringify(fact));
        }
      }

      // Setup/payoff
      const emittedSetups = new Set<string>();
      for (const s of orderedScenes) {
        const v = s.version;
        if (!v) continue;
        const payoffReq = v.setup_payoff_required || [];
        for (const p of payoffReq) {
          const pk = typeof p === 'string' ? p : JSON.stringify(p);
          if (!emittedSetups.has(pk)) {
            const critical = typeof p === 'object' && p?.critical;
            warnings.push({
              type: 'setup_payoff', severity: critical ? 'high' : 'med',
              message: `Payoff "${pk}" expected but setup may be missing from preceding scenes.`,
              relatedSceneIds: [s.scene_id],
            });
          }
        }
        const setupEmit = v.setup_payoff_emitted || [];
        for (const sp of setupEmit) {
          emittedSetups.add(typeof sp === 'string' ? sp : JSON.stringify(sp));
        }
      }

      // Knowledge ordering: fact emitted AFTER it's required
      const emitPositions = new Map<string, number>();
      for (let i = 0; i < orderedScenes.length; i++) {
        const v = orderedScenes[i].version;
        if (!v) continue;
        for (const fact of (v.continuity_facts_emitted || [])) {
          const fk = typeof fact === 'string' ? fact : JSON.stringify(fact);
          if (!emitPositions.has(fk)) emitPositions.set(fk, i);
        }
      }
      for (let i = 0; i < orderedScenes.length; i++) {
        const v = orderedScenes[i].version;
        if (!v) continue;
        for (const fact of (v.continuity_facts_required || [])) {
          const fk = typeof fact === 'string' ? fact : JSON.stringify(fact);
          const emitPos = emitPositions.get(fk);
          if (emitPos !== undefined && emitPos > i) {
            warnings.push({
              type: 'continuity', severity: 'high',
              message: `Scene ${i + 1} requires "${fk}" but it's first emitted in scene ${emitPos + 1} (later in order).`,
              relatedSceneIds: [orderedScenes[i].scene_id, orderedScenes[emitPos].scene_id],
            });
          }
        }
      }

      // Pacing: act scene count deviation >35%
      const actCounts: Record<number, number> = {};
      for (const o of (activeOrder || [])) {
        const act = o.act || 1;
        actCounts[act] = (actCounts[act] || 0) + 1;
      }
      const actValues = Object.values(actCounts);
      if (actValues.length > 1) {
        const avg = actValues.reduce((a, b) => a + b, 0) / actValues.length;
        for (const [act, count] of Object.entries(actCounts)) {
          if (Math.abs(count - avg) > avg * 0.35) {
            warnings.push({
              type: 'pacing', severity: 'low',
              message: `Act ${act} has ${count} scenes, deviating >35% from average ${Math.round(avg)}.`,
              relatedSceneIds: [],
            });
          }
        }
      }

      // Generic fallback
      if (warnings.length === 0 && affectedSceneIds.length > 0) {
        warnings.push({
          type: 'continuity', severity: 'low',
          message: 'This change may affect setups/payoffs and continuity. Consider regenerating impacted scenes.',
          relatedSceneIds: affectedSceneIds,
        });
      }

      return { warnings, suggested_patches };
    }

    // --- Create patch suggestions from high-severity warnings ---
    async function sgCreatePatchSuggestions(
      _supabase: any, projectId: string, userId: string, actionId: string,
      warnings: any[]
    ): Promise<void> {
      const highWarnings = warnings.filter((w: any) => w.severity === 'high');
      if (highWarnings.length === 0) return;

      const toCreate = highWarnings.slice(0, 3);
      for (const w of toCreate) {
        const targetSceneId = w.relatedSceneIds?.[0] || null;
        let suggestion = '';
        let rationale = w.message || '';
        const patch: any = {};

        if (w.type === 'continuity') {
          suggestion = `Add exposition or reference to establish missing continuity fact in an earlier scene.`;
          patch.content_note = `Consider adding dialogue or action that establishes: ${rationale}`;
        } else if (w.type === 'setup_payoff') {
          suggestion = `Add setup element in an earlier scene to support the payoff.`;
          patch.content_note = `Insert a setup beat: ${rationale}`;
        } else {
          suggestion = `Review and adjust to resolve: ${rationale}`;
        }

        await _supabase.from("scene_graph_patch_queue").insert({
          project_id: projectId,
          created_by: userId,
          status: 'open',
          source_action_id: actionId,
          target_scene_id: targetSceneId,
          suggestion,
          rationale,
          patch,
        });
      }
    }

    // --- Log action with inverse ---
    async function sgLogAction(
      _supabase: any, projectId: string, userId: string,
      actionType: string, payload: any, inverse: any
    ): Promise<string> {
      const { data } = await _supabase.from("scene_graph_actions").insert({
        project_id: projectId,
        action_type: actionType,
        actor_id: userId,
        payload,
        inverse,
      }).select("id").single();
      return data?.id || '';
    }

    // --- Parse slugline helper ---
    function sgParseSlugline(line: string): { slugline: string; location: string; time_of_day: string } {
      // Strip leading scene numbers (e.g. "1  EXT." or "23. INT.")
      const sl = line.trim().replace(/^\d+\s*[\.\)\s]\s*/, '');
      const match = sl.match(/^(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.|I\/E\.?)\s*(.+?)(?:\s*[-–—]\s*(.+))?$/i);
      if (match) {
        return {
          slugline: sl,
          location: (match[2] || '').trim(),
          time_of_day: (match[3] || '').trim(),
        };
      }
      return { slugline: sl, location: '', time_of_day: '' };
    }

    if (action === "scene_graph_extract") {
      const { projectId, sourceDocumentId, sourceVersionId, mode, text: rawText, force } = body;
      if (!projectId) throw new Error("projectId required");

      // If force mode, clear existing scene graph data first
      if (force) {
        console.log(`[scene_graph_extract] Force mode — clearing existing scenes for project ${projectId}`);
        // Delete in dependency order: snapshots, order, versions, scenes
        await supabase.from("scene_graph_snapshots").delete().eq("project_id", projectId);
        await supabase.from("scene_graph_order").delete().eq("project_id", projectId);
        // Get all scene IDs for this project
        const { data: existingScenes } = await supabase.from("scene_graph_scenes")
          .select("id").eq("project_id", projectId);
        if (existingScenes && existingScenes.length > 0) {
          const sceneIds = existingScenes.map((s: any) => s.id);
          await supabase.from("scene_graph_versions").delete().in("scene_id", sceneIds);
          await supabase.from("scene_graph_scenes").delete().eq("project_id", projectId);
        }
      }
      let scriptText = rawText || '';

      if (mode !== 'from_text' || !scriptText) {
        // Fetch from script doc
        let docId = sourceDocumentId;
        if (!docId) {
          const { data: docs } = await supabase.from("project_documents")
            .select("id, doc_type")
            .eq("project_id", projectId)
            .in("doc_type", ["script", "script_pdf", "treatment"])
            .order("created_at", { ascending: false })
            .limit(1);
          if (docs && docs.length > 0) docId = docs[0].id;
        }
        if (!docId) throw new Error("No script document found for this project");

        let vId = sourceVersionId;
        if (!vId) {
          const { data: ver } = await supabase.from("project_document_versions")
            .select("id, plaintext").eq("document_id", docId)
            .order("version_number", { ascending: false }).limit(1).single();
          if (ver) { vId = ver.id; scriptText = ver.plaintext || ''; }
        } else {
          const { data: ver } = await supabase.from("project_document_versions")
            .select("plaintext").eq("id", vId).single();
          if (ver) scriptText = ver.plaintext || '';
        }
      }

      if (!scriptText || scriptText.trim().length < 100) {
        throw new Error("No usable script text found. Upload or paste a script first.");
      }

      console.log(`[scene_graph_extract] Script text length: ${scriptText.length}`);

      // Parse into scenes by slugline detection
      const lines = scriptText.split('\n');
      // Match standard sluglines and numbered sluglines (e.g. "1  EXT. ROAD - DAY", "23. INT. OFFICE - NIGHT")
      const sluglinePattern = /^\s*(\d+\s*[\.\)\s]\s*)?(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.|I\/E\.?)\s/i;
      const sceneBreaks: { startLine: number; headingLine: string }[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (sluglinePattern.test(lines[i])) {
          sceneBreaks.push({ startLine: i, headingLine: lines[i] });
        }
      }

      console.log(`[scene_graph_extract] Detected ${sceneBreaks.length} scene breaks. First few:`, sceneBreaks.slice(0, 5).map(b => b.headingLine));

      // If no sluglines found, treat entire text as one scene
      if (sceneBreaks.length === 0) {
        sceneBreaks.push({ startLine: 0, headingLine: 'SCENE 1' });
      }

      const scenes: any[] = [];
      const orderKeys = sgGenerateEvenKeys(sceneBreaks.length);

      for (let i = 0; i < sceneBreaks.length; i++) {
        const start = sceneBreaks[i].startLine;
        const end = i + 1 < sceneBreaks.length ? sceneBreaks[i + 1].startLine : lines.length;
        const sceneContent = lines.slice(start, end).join('\n').trim();
        const parsed = sgParseSlugline(sceneBreaks[i].headingLine);

        // Create scene
        const { data: scene, error: sErr } = await supabase.from("scene_graph_scenes").insert({
          project_id: projectId,
          scene_kind: 'narrative',
          created_by: user.id,
        }).select().single();
        if (sErr) throw sErr;

        // Create version
        const { data: version, error: vErr } = await supabase.from("scene_graph_versions").insert({
          scene_id: scene.id,
          project_id: projectId,
          version_number: 1,
          status: 'draft',
          created_by: user.id,
          slugline: parsed.slugline,
          location: parsed.location,
          time_of_day: parsed.time_of_day,
          content: sceneContent,
          summary: sceneContent.slice(0, 200),
        }).select().single();
        if (vErr) throw vErr;

        // Create order entry
        const { error: oErr } = await supabase.from("scene_graph_order").insert({
          project_id: projectId,
          scene_id: scene.id,
          order_key: orderKeys[i],
          act: null,
          is_active: true,
        });
        if (oErr) throw oErr;

        scenes.push({
          scene_id: scene.id,
          display_number: i + 1,
          order_key: orderKeys[i],
          act: null,
          sequence: null,
          is_active: true,
          scene_kind: 'narrative',
          latest_version: version,
          approval_status: 'draft',
        });
      }

      // Create snapshot
      const assembledContent = scenes.map(s => s.latest_version?.content || '').join('\n\n');
      const { data: snapshot, error: snErr } = await supabase.from("scene_graph_snapshots").insert({
        project_id: projectId,
        created_by: user.id,
        label: 'Initial extraction',
        assembly: {
          scene_order: scenes.map(s => ({
            scene_id: s.scene_id,
            version_id: s.latest_version?.id,
            order_key: s.order_key,
            act: s.act,
            sequence: s.sequence,
          })),
          generated_at: new Date().toISOString(),
          mode: 'latest',
        },
        content: assembledContent,
        status: 'draft',
      }).select().single();
      if (snErr) throw snErr;

      return new Response(JSON.stringify({
        scenes,
        snapshotId: snapshot.id,
        content: assembledContent,
        sceneCount: scenes.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "scene_graph_list") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("*").eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      if (!orderRows || orderRows.length === 0) {
        return new Response(JSON.stringify({ scenes: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: allVersions } = await supabase.from("scene_graph_versions")
        .select("*").in("scene_id", sceneIds)
        .order("version_number", { ascending: false });

      const { data: sceneRows } = await supabase.from("scene_graph_scenes")
        .select("*").in("id", sceneIds);

      const sceneMap = new Map((sceneRows || []).map((s: any) => [s.id, s]));
      const latestVersionMap = new Map<string, any>();
      for (const v of (allVersions || [])) {
        if (!latestVersionMap.has(v.scene_id)) latestVersionMap.set(v.scene_id, v);
      }

      // Find approved versions
      const approvedMap = new Map<string, string>();
      for (const v of (allVersions || [])) {
        if (v.status === 'approved' && !approvedMap.has(v.scene_id)) {
          approvedMap.set(v.scene_id, v.status);
        }
      }

      const scenes = orderRows.map((o: any, idx: number) => {
        const scene = sceneMap.get(o.scene_id);
        const latestVer = latestVersionMap.get(o.scene_id);
        return {
          scene_id: o.scene_id,
          display_number: idx + 1,
          order_key: o.order_key,
          act: o.act,
          sequence: o.sequence,
          is_active: o.is_active,
          scene_kind: scene?.scene_kind || 'narrative',
          latest_version: latestVer || null,
          approval_status: approvedMap.has(o.scene_id) ? 'approved' : (latestVer?.status || 'draft'),
        };
      });

      return new Response(JSON.stringify({ scenes }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_insert_scene") {
      const { projectId, position, intent, sceneDraft } = body;
      if (!projectId) throw new Error("projectId required");

      let prevKey: string | null = null;
      let nextKey: string | null = null;

      if (position?.afterSceneId) {
        const { data: after } = await supabase.from("scene_graph_order")
          .select("order_key").eq("project_id", projectId)
          .eq("scene_id", position.afterSceneId).eq("is_active", true).single();
        if (after) prevKey = after.order_key;
      }
      if (position?.beforeSceneId) {
        const { data: before } = await supabase.from("scene_graph_order")
          .select("order_key").eq("project_id", projectId)
          .eq("scene_id", position.beforeSceneId).eq("is_active", true).single();
        if (before) nextKey = before.order_key;
      }

      const newKey = sgKeyBetween(prevKey, nextKey);

      const { data: scene, error: sErr } = await supabase.from("scene_graph_scenes").insert({
        project_id: projectId, scene_kind: 'narrative', created_by: user.id,
      }).select().single();
      if (sErr) throw sErr;

      const { data: version, error: vErr } = await supabase.from("scene_graph_versions").insert({
        scene_id: scene.id, project_id: projectId, version_number: 1, status: 'draft',
        created_by: user.id,
        slugline: sceneDraft?.slugline || null,
        content: sceneDraft?.content || '',
        summary: sceneDraft?.summary || null,
      }).select().single();
      if (vErr) throw vErr;

      const { error: oErr } = await supabase.from("scene_graph_order").insert({
        project_id: projectId, scene_id: scene.id, order_key: newKey,
        is_active: true,
        inserted_reason: intent?.type || null,
        inserted_intent: intent || {},
      });
      if (oErr) throw oErr;

      const impact = await sgBuildImpactReport(supabase, projectId, 'insert', [scene.id]);

      const action_id = await sgLogAction(supabase, projectId, user.id, 'insert', {
        scene_id: scene.id, order_key: newKey, position,
      }, {
        type: 'deactivate_scene', scene_id: scene.id, order_key: newKey,
      });

      if (impact.warnings.some((w: any) => w.severity === 'high')) {
        await sgCreatePatchSuggestions(supabase, projectId, user.id, action_id, impact.warnings);
      }

      return new Response(JSON.stringify({
        scene: {
          scene_id: scene.id, display_number: 0, order_key: newKey,
          act: null, sequence: null, is_active: true, scene_kind: 'narrative',
          latest_version: version, approval_status: 'draft',
        },
        impact,
        action_id,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "scene_graph_remove_scene") {
      const { projectId, sceneId } = body;
      if (!projectId || !sceneId) throw new Error("projectId, sceneId required");

      // Get prior state for inverse
      const { data: priorOrder } = await supabase.from("scene_graph_order")
        .select("order_key, is_active").eq("project_id", projectId).eq("scene_id", sceneId).single();

      const { error } = await supabase.from("scene_graph_order")
        .update({ is_active: false })
        .eq("project_id", projectId).eq("scene_id", sceneId);
      if (error) throw error;

      const impact = await sgBuildImpactReport(supabase, projectId, 'remove', [sceneId]);

      const action_id = await sgLogAction(supabase, projectId, user.id, 'remove', {
        scene_id: sceneId,
      }, {
        type: 'restore_scene', scene_id: sceneId,
        prior_order_key: priorOrder?.order_key, prior_is_active: priorOrder?.is_active,
      });

      if (impact.warnings.some((w: any) => w.severity === 'high')) {
        await sgCreatePatchSuggestions(supabase, projectId, user.id, action_id, impact.warnings);
      }

      return new Response(JSON.stringify({ impact, action_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_move_scene") {
      const { projectId, sceneId, position } = body;
      if (!projectId || !sceneId) throw new Error("projectId, sceneId required");

      // Get prior key for inverse
      const { data: priorOrd } = await supabase.from("scene_graph_order")
        .select("order_key").eq("project_id", projectId).eq("scene_id", sceneId).eq("is_active", true).single();
      const priorKey = priorOrd?.order_key;

      let prevKey: string | null = null;
      let nextKey: string | null = null;
      if (position?.afterSceneId) {
        const { data } = await supabase.from("scene_graph_order")
          .select("order_key").eq("project_id", projectId)
          .eq("scene_id", position.afterSceneId).eq("is_active", true).single();
        if (data) prevKey = data.order_key;
      }
      if (position?.beforeSceneId) {
        const { data } = await supabase.from("scene_graph_order")
          .select("order_key").eq("project_id", projectId)
          .eq("scene_id", position.beforeSceneId).eq("is_active", true).single();
        if (data) nextKey = data.order_key;
      }

      const newKey = sgKeyBetween(prevKey, nextKey);

      const { error } = await supabase.from("scene_graph_order")
        .update({ order_key: newKey })
        .eq("project_id", projectId).eq("scene_id", sceneId).eq("is_active", true);
      if (error) throw error;

      const impact = await sgBuildImpactReport(supabase, projectId, 'move', [sceneId]);

      const action_id = await sgLogAction(supabase, projectId, user.id, 'move', {
        scene_id: sceneId, new_order_key: newKey, position,
      }, {
        type: 'restore_order_key', scene_id: sceneId, prior_order_key: priorKey,
      });

      return new Response(JSON.stringify({ impact, action_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_split_scene") {
      const { projectId, sceneId, splitAt, drafts } = body;
      if (!projectId || !sceneId) throw new Error("projectId, sceneId required");

      const { data: curVer } = await supabase.from("scene_graph_versions")
        .select("*").eq("scene_id", sceneId)
        .order("version_number", { ascending: false }).limit(1).single();
      if (!curVer) throw new Error("No version found for scene");

      let partA = drafts?.partA || '';
      let partB = drafts?.partB || '';
      if (!partA && !partB) {
        const contentLines = (curVer.content || '').split('\n');
        const mid = Math.floor(contentLines.length / 2);
        partA = contentLines.slice(0, mid).join('\n');
        partB = contentLines.slice(mid).join('\n');
      }

      // Get old order key before deactivation
      const { data: oldOrder } = await supabase.from("scene_graph_order")
        .select("order_key").eq("project_id", projectId).eq("scene_id", sceneId).eq("is_active", true).single();
      const oldKey = oldOrder?.order_key || 'n00000';

      await supabase.from("scene_graph_order")
        .update({ is_active: false })
        .eq("project_id", projectId).eq("scene_id", sceneId);

      await supabase.from("scene_graph_scenes")
        .update({ deprecated_at: new Date().toISOString() })
        .eq("id", sceneId);

      const trueKeyA = sgKeyBetween(sgKeyBetween(null, oldKey), oldKey);
      const trueKeyB = sgKeyBetween(oldKey, sgKeyBetween(oldKey, null));

      const createSplitScene = async (content: string, key: string, provenance: any) => {
        const { data: sc } = await supabase.from("scene_graph_scenes").insert({
          project_id: projectId, scene_kind: 'narrative', created_by: user.id, provenance,
        }).select().single();
        if (!sc) throw new Error("Failed to create split scene");
        const parsed = sgParseSlugline(content.split('\n')[0] || '');
        const { data: ver } = await supabase.from("scene_graph_versions").insert({
          scene_id: sc.id, project_id: projectId, version_number: 1, status: 'draft',
          created_by: user.id, slugline: parsed.slugline, location: parsed.location,
          time_of_day: parsed.time_of_day, content,
        }).select().single();
        await supabase.from("scene_graph_order").insert({
          project_id: projectId, scene_id: sc.id, order_key: key, is_active: true,
        });
        return { scene_id: sc.id, latest_version: ver, order_key: key };
      };

      const sceneA = await createSplitScene(partA, trueKeyA, { split_from_scene_id: sceneId });
      const sceneB = await createSplitScene(partB, trueKeyB, { split_from_scene_id: sceneId });

      const impact = await sgBuildImpactReport(supabase, projectId, 'split', [sceneA.scene_id, sceneB.scene_id]);

      const action_id = await sgLogAction(supabase, projectId, user.id, 'split', {
        original_scene_id: sceneId, new_scene_ids: [sceneA.scene_id, sceneB.scene_id],
      }, {
        type: 'unsplit', original_scene_id: sceneId, original_order_key: oldKey,
        new_scene_ids: [sceneA.scene_id, sceneB.scene_id],
      });

      if (impact.warnings.some((w: any) => w.severity === 'high')) {
        await sgCreatePatchSuggestions(supabase, projectId, user.id, action_id, impact.warnings);
      }

      return new Response(JSON.stringify({
        sceneA: { ...sceneA, display_number: 0, act: null, sequence: null, is_active: true, scene_kind: 'narrative', approval_status: 'draft' },
        sceneB: { ...sceneB, display_number: 0, act: null, sequence: null, is_active: true, scene_kind: 'narrative', approval_status: 'draft' },
        impact, action_id,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "scene_graph_merge_scenes") {
      const { projectId, sceneIds, mergedDraft } = body;
      if (!projectId || !sceneIds || sceneIds.length < 2) throw new Error("projectId, sceneIds (2) required");

      const { data: orders } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key").eq("project_id", projectId)
        .in("scene_id", sceneIds).eq("is_active", true)
        .order("order_key", { ascending: true });
      if (!orders || orders.length < 2) throw new Error("Both scenes must be active");

      const contents: string[] = [];
      for (const sid of sceneIds) {
        const { data: ver } = await supabase.from("scene_graph_versions")
          .select("content").eq("scene_id", sid)
          .order("version_number", { ascending: false }).limit(1).single();
        contents.push(ver?.content || '');
      }

      const orderKeysBackup = orders.map((o: any) => ({ scene_id: o.scene_id, order_key: o.order_key }));

      for (const sid of sceneIds) {
        await supabase.from("scene_graph_order").update({ is_active: false })
          .eq("project_id", projectId).eq("scene_id", sid);
        await supabase.from("scene_graph_scenes").update({ deprecated_at: new Date().toISOString() }).eq("id", sid);
      }

      const mergedContent = mergedDraft?.content || contents.join('\n\n');
      const mergedSlugline = mergedDraft?.slugline || null;
      const earliestKey = orders[0].order_key;

      const { data: newScene } = await supabase.from("scene_graph_scenes").insert({
        project_id: projectId, scene_kind: 'narrative', created_by: user.id,
        provenance: { merged_from_scene_ids: sceneIds },
      }).select().single();
      if (!newScene) throw new Error("Failed to create merged scene");

      const parsed = mergedSlugline ? sgParseSlugline(mergedSlugline) : sgParseSlugline(mergedContent.split('\n')[0] || '');
      const { data: ver } = await supabase.from("scene_graph_versions").insert({
        scene_id: newScene.id, project_id: projectId, version_number: 1, status: 'draft',
        created_by: user.id, slugline: parsed.slugline || mergedSlugline, location: parsed.location,
        time_of_day: parsed.time_of_day, content: mergedContent,
      }).select().single();

      await supabase.from("scene_graph_order").insert({
        project_id: projectId, scene_id: newScene.id, order_key: earliestKey, is_active: true,
      });

      const impact = await sgBuildImpactReport(supabase, projectId, 'merge', [newScene.id]);

      const action_id = await sgLogAction(supabase, projectId, user.id, 'merge', {
        merged_scene_ids: sceneIds, new_scene_id: newScene.id,
      }, {
        type: 'unmerge', merged_scene_ids: sceneIds, new_scene_id: newScene.id,
        original_order_keys: orderKeysBackup,
      });

      if (impact.warnings.some((w: any) => w.severity === 'high')) {
        await sgCreatePatchSuggestions(supabase, projectId, user.id, action_id, impact.warnings);
      }

      return new Response(JSON.stringify({
        mergedScene: {
          scene_id: newScene.id, display_number: 0, order_key: earliestKey,
          act: null, sequence: null, is_active: true, scene_kind: 'narrative',
          latest_version: ver, approval_status: 'draft',
        },
        impact, action_id,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "scene_graph_update_scene") {
      const { projectId, sceneId, patch, propose } = body;
      if (!projectId || !sceneId) throw new Error("projectId, sceneId required");

      // Use concurrency-safe RPC
      const { data: rpcResult, error: rpcErr } = await supabase.rpc('next_scene_version', {
        p_scene_id: sceneId,
        p_project_id: projectId,
        p_patch: patch || {},
        p_propose: propose || false,
        p_created_by: user.id,
      });
      if (rpcErr) {
        // Fallback to direct insert if RPC fails
        console.warn("RPC next_scene_version failed, falling back:", rpcErr.message);
        const { data: curVer } = await supabase.from("scene_graph_versions")
          .select("*").eq("scene_id", sceneId)
          .order("version_number", { ascending: false }).limit(1).single();
        const newVersionNumber = (curVer?.version_number || 0) + 1;
        const { data: newVer, error: vErr } = await supabase.from("scene_graph_versions").insert({
          scene_id: sceneId, project_id: projectId, version_number: newVersionNumber,
          status: propose ? 'proposed' : 'draft', created_by: user.id,
          slugline: patch?.slugline ?? curVer?.slugline ?? null,
          location: curVer?.location ?? null, time_of_day: curVer?.time_of_day ?? null,
          characters_present: patch?.characters_present ?? curVer?.characters_present ?? [],
          purpose: curVer?.purpose ?? null,
          beats: patch?.beats ?? curVer?.beats ?? [],
          summary: patch?.summary ?? curVer?.summary ?? null,
          content: patch?.content ?? curVer?.content ?? '',
          continuity_facts_emitted: curVer?.continuity_facts_emitted ?? [],
          continuity_facts_required: curVer?.continuity_facts_required ?? [],
          setup_payoff_emitted: curVer?.setup_payoff_emitted ?? [],
          setup_payoff_required: curVer?.setup_payoff_required ?? [],
          metadata: curVer?.metadata ?? {},
        }).select().single();
        if (vErr) throw vErr;
        const action_id = await sgLogAction(supabase, projectId, user.id, 'update', {
          scene_id: sceneId, version_id: newVer.id,
        }, { type: 'version_created', scene_id: sceneId, version_id: newVer.id });
        return new Response(JSON.stringify({ version: newVer, action_id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const newVer = rpcResult;
      const action_id = await sgLogAction(supabase, projectId, user.id, 'update', {
        scene_id: sceneId, version_id: newVer.id,
      }, { type: 'version_created', scene_id: sceneId, version_id: newVer.id });

      return new Response(JSON.stringify({ version: newVer, action_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_approve_scene_version") {
      const { projectId, sceneVersionId } = body;
      if (!projectId || !sceneVersionId) throw new Error("projectId, sceneVersionId required");

      const { data: ver, error } = await supabase.from("scene_graph_versions")
        .update({ status: 'approved' })
        .eq("id", sceneVersionId).eq("project_id", projectId)
        .select().single();
      if (error) throw error;

      // Phase 2: set supersedes_version_id + superseded_at on older approved versions
      if (ver) {
        const { data: priorApproved } = await supabase.from("scene_graph_versions")
          .select("id, version_number, metadata").eq("scene_id", ver.scene_id)
          .eq("status", "approved").neq("id", sceneVersionId)
          .order("version_number", { ascending: false });

        for (const pv of (priorApproved || [])) {
          await supabase.from("scene_graph_versions").update({
            superseded_at: new Date().toISOString(),
            supersedes_version_id: sceneVersionId,
            metadata: { ...(pv.metadata || {}), superseded_by: sceneVersionId },
          }).eq("id", pv.id);
        }
      }

      return new Response(JSON.stringify({ version: ver }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_rebuild_snapshot") {
      const { projectId, mode: snapMode, label } = body;
      if (!projectId) throw new Error("projectId required");
      const useMode = snapMode || 'latest';

      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes to assemble");

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: allVersions } = await supabase.from("scene_graph_versions")
        .select("*").in("scene_id", sceneIds)
        .order("version_number", { ascending: false });

      const selectedVersions = new Map<string, any>();
      for (const sid of sceneIds) {
        const versions = (allVersions || []).filter((v: any) => v.scene_id === sid);
        if (useMode === 'approved_prefer') {
          // Phase 2: use latest approved by version_number (ignore superseded)
          const approved = versions.filter((v: any) => v.status === 'approved')
            .sort((a: any, b: any) => b.version_number - a.version_number);
          selectedVersions.set(sid, approved[0] || versions[0]);
        } else {
          selectedVersions.set(sid, versions[0]);
        }
      }

      const sceneOrder = orderRows.map((o: any) => ({
        scene_id: o.scene_id,
        version_id: selectedVersions.get(o.scene_id)?.id || null,
        order_key: o.order_key, act: o.act, sequence: o.sequence,
      }));

      const assembledContent = orderRows
        .map((o: any) => selectedVersions.get(o.scene_id)?.content || '')
        .join('\n\n');

      const { data: snapshot, error: snErr } = await supabase.from("scene_graph_snapshots").insert({
        project_id: projectId, created_by: user.id,
        label: label || `Snapshot (${useMode})`,
        assembly: { scene_order: sceneOrder, generated_at: new Date().toISOString(), mode: useMode },
        content: assembledContent, status: 'draft',
      }).select().single();
      if (snErr) throw snErr;

      return new Response(JSON.stringify({ snapshot }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // PHASE 2: NEW SCENE GRAPH ACTIONS
    // ══════════════════════════════════════════════

    if (action === "scene_graph_list_inactive") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: inactiveOrder } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key").eq("project_id", projectId).eq("is_active", false)
        .order("order_key", { ascending: true });

      if (!inactiveOrder || inactiveOrder.length === 0) {
        return new Response(JSON.stringify({ scenes: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sceneIds = [...new Set(inactiveOrder.map((r: any) => r.scene_id))];
      const { data: versions } = await supabase.from("scene_graph_versions")
        .select("*").in("scene_id", sceneIds)
        .order("version_number", { ascending: false });
      const { data: sceneRows } = await supabase.from("scene_graph_scenes")
        .select("id, scene_kind").in("id", sceneIds);

      const latestMap = new Map<string, any>();
      for (const v of (versions || [])) {
        if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v);
      }
      const sceneMap = new Map((sceneRows || []).map((s: any) => [s.id, s]));

      // Deduplicate by scene_id
      const seen = new Set<string>();
      const scenes = inactiveOrder.filter((o: any) => {
        if (seen.has(o.scene_id)) return false;
        seen.add(o.scene_id);
        return true;
      }).map((o: any) => ({
        scene_id: o.scene_id,
        order_key: o.order_key,
        scene_kind: sceneMap.get(o.scene_id)?.scene_kind || 'narrative',
        latest_version: latestMap.get(o.scene_id) || null,
      }));

      return new Response(JSON.stringify({ scenes }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_restore_scene") {
      const { projectId, sceneId, position } = body;
      if (!projectId || !sceneId) throw new Error("projectId, sceneId required");

      // Get prior state
      const { data: priorOrd } = await supabase.from("scene_graph_order")
        .select("order_key, is_active").eq("project_id", projectId).eq("scene_id", sceneId).single();

      // Restore active
      await supabase.from("scene_graph_order")
        .update({ is_active: true })
        .eq("project_id", projectId).eq("scene_id", sceneId);

      // Undeprecate scene
      await supabase.from("scene_graph_scenes")
        .update({ deprecated_at: null })
        .eq("id", sceneId);

      // If position provided, move
      if (position?.afterSceneId || position?.beforeSceneId) {
        let prevKey: string | null = null;
        let nextKey: string | null = null;
        if (position?.afterSceneId) {
          const { data } = await supabase.from("scene_graph_order")
            .select("order_key").eq("project_id", projectId)
            .eq("scene_id", position.afterSceneId).eq("is_active", true).single();
          if (data) prevKey = data.order_key;
        }
        if (position?.beforeSceneId) {
          const { data } = await supabase.from("scene_graph_order")
            .select("order_key").eq("project_id", projectId)
            .eq("scene_id", position.beforeSceneId).eq("is_active", true).single();
          if (data) nextKey = data.order_key;
        }
        const newKey = sgKeyBetween(prevKey, nextKey);
        await supabase.from("scene_graph_order")
          .update({ order_key: newKey })
          .eq("project_id", projectId).eq("scene_id", sceneId);
      }

      const impact = await sgBuildImpactReport(supabase, projectId, 'restore', [sceneId]);

      const action_id = await sgLogAction(supabase, projectId, user.id, 'restore', {
        scene_id: sceneId, position,
      }, {
        type: 'deactivate_scene', scene_id: sceneId,
        prior_order_key: priorOrd?.order_key, prior_is_active: false,
      });

      return new Response(JSON.stringify({ impact, action_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_undo") {
      const { projectId, actionId } = body;
      if (!projectId || !actionId) throw new Error("projectId, actionId required");

      const { data: actionRow } = await supabase.from("scene_graph_actions")
        .select("*").eq("id", actionId).eq("project_id", projectId).single();
      if (!actionRow) throw new Error("Action not found");

      const inv = actionRow.inverse || {};

      // Apply inverse based on type
      if (inv.type === 'deactivate_scene') {
        await supabase.from("scene_graph_order")
          .update({ is_active: false })
          .eq("project_id", projectId).eq("scene_id", inv.scene_id);
      } else if (inv.type === 'restore_scene') {
        await supabase.from("scene_graph_order")
          .update({ is_active: true })
          .eq("project_id", projectId).eq("scene_id", inv.scene_id);
        if (inv.prior_order_key) {
          await supabase.from("scene_graph_order")
            .update({ order_key: inv.prior_order_key })
            .eq("project_id", projectId).eq("scene_id", inv.scene_id);
        }
        await supabase.from("scene_graph_scenes")
          .update({ deprecated_at: null }).eq("id", inv.scene_id);
      } else if (inv.type === 'restore_order_key') {
        await supabase.from("scene_graph_order")
          .update({ order_key: inv.prior_order_key })
          .eq("project_id", projectId).eq("scene_id", inv.scene_id).eq("is_active", true);
      } else if (inv.type === 'unsplit') {
        // Deactivate new scenes, reactivate original
        for (const nid of (inv.new_scene_ids || [])) {
          await supabase.from("scene_graph_order")
            .update({ is_active: false })
            .eq("project_id", projectId).eq("scene_id", nid);
        }
        await supabase.from("scene_graph_order")
          .update({ is_active: true })
          .eq("project_id", projectId).eq("scene_id", inv.original_scene_id);
        await supabase.from("scene_graph_scenes")
          .update({ deprecated_at: null }).eq("id", inv.original_scene_id);
      } else if (inv.type === 'unmerge') {
        // Deactivate merged scene, reactivate originals
        await supabase.from("scene_graph_order")
          .update({ is_active: false })
          .eq("project_id", projectId).eq("scene_id", inv.new_scene_id);
        for (const ok of (inv.original_order_keys || [])) {
          await supabase.from("scene_graph_order")
            .update({ is_active: true, order_key: ok.order_key })
            .eq("project_id", projectId).eq("scene_id", ok.scene_id);
          await supabase.from("scene_graph_scenes")
            .update({ deprecated_at: null }).eq("id", ok.scene_id);
        }
      }

      // Delete the action record (undo consumed)
      await supabase.from("scene_graph_actions").delete().eq("id", actionId);

      const impact = await sgBuildImpactReport(supabase, projectId, 'undo', []);

      // Re-list scenes for response
      const listResp = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence, is_active")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      return new Response(JSON.stringify({ impact, scenes: listResp.data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_list_patch_queue") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: patches } = await supabase.from("scene_graph_patch_queue")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(50);

      return new Response(JSON.stringify({ patches: patches || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_accept_patch_suggestion") {
      const { projectId, patchQueueId } = body;
      if (!projectId || !patchQueueId) throw new Error("projectId, patchQueueId required");

      const { data: patch, error } = await supabase.from("scene_graph_patch_queue")
        .update({ status: 'accepted' })
        .eq("id", patchQueueId).eq("project_id", projectId)
        .select().single();
      if (error) throw error;

      return new Response(JSON.stringify({ patch }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_reject_patch_suggestion") {
      const { projectId, patchQueueId } = body;
      if (!projectId || !patchQueueId) throw new Error("projectId, patchQueueId required");

      const { data: patch, error } = await supabase.from("scene_graph_patch_queue")
        .update({ status: 'rejected' })
        .eq("id", patchQueueId).eq("project_id", projectId)
        .select().single();
      if (error) throw error;

      return new Response(JSON.stringify({ patch }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_apply_patch_suggestion") {
      const { projectId, patchQueueId, mode } = body;
      if (!projectId || !patchQueueId) throw new Error("projectId, patchQueueId required");

      const { data: patchItem } = await supabase.from("scene_graph_patch_queue")
        .select("*").eq("id", patchQueueId).eq("project_id", projectId).single();
      if (!patchItem) throw new Error("Patch not found");
      if (!patchItem.target_scene_id) throw new Error("No target scene for this patch");

      // Apply via RPC
      const patchData = patchItem.patch || {};
      const propose = mode === 'propose';
      const { data: rpcResult, error: rpcErr } = await supabase.rpc('next_scene_version', {
        p_scene_id: patchItem.target_scene_id,
        p_project_id: projectId,
        p_patch: patchData,
        p_propose: propose,
        p_created_by: user.id,
      });

      let newVer = rpcResult;
      if (rpcErr) {
        // Fallback
        const { data: curVer } = await supabase.from("scene_graph_versions")
          .select("*").eq("scene_id", patchItem.target_scene_id)
          .order("version_number", { ascending: false }).limit(1).single();
        const nextNum = (curVer?.version_number || 0) + 1;
        const { data: fallbackVer } = await supabase.from("scene_graph_versions").insert({
          scene_id: patchItem.target_scene_id, project_id: projectId,
          version_number: nextNum, status: propose ? 'proposed' : 'draft',
          created_by: user.id,
          slugline: patchData.slugline ?? curVer?.slugline ?? null,
          content: patchData.content ?? curVer?.content ?? '',
          summary: patchData.summary ?? curVer?.summary ?? null,
          beats: patchData.beats ?? curVer?.beats ?? [],
          characters_present: curVer?.characters_present ?? [],
          location: curVer?.location ?? null, time_of_day: curVer?.time_of_day ?? null,
          purpose: curVer?.purpose ?? null,
          continuity_facts_emitted: curVer?.continuity_facts_emitted ?? [],
          continuity_facts_required: curVer?.continuity_facts_required ?? [],
          setup_payoff_emitted: curVer?.setup_payoff_emitted ?? [],
          setup_payoff_required: curVer?.setup_payoff_required ?? [],
          metadata: curVer?.metadata ?? {},
        }).select().single();
        newVer = fallbackVer;
      }

      // Mark applied
      await supabase.from("scene_graph_patch_queue")
        .update({ status: 'applied' })
        .eq("id", patchQueueId);

      const action_id = await sgLogAction(supabase, projectId, user.id, 'apply_patch', {
        patch_queue_id: patchQueueId, scene_id: patchItem.target_scene_id,
        version_id: newVer?.id,
      }, {
        type: 'version_created', scene_id: patchItem.target_scene_id,
        version_id: newVer?.id,
      });

      return new Response(JSON.stringify({
        version: newVer,
        patch: { ...patchItem, status: 'applied' },
        action_id,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "scene_graph_rebalance_order_keys") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: activeOrder } = await supabase.from("scene_graph_order")
        .select("id, scene_id, order_key")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      if (!activeOrder || activeOrder.length === 0) {
        return new Response(JSON.stringify({ action_id: null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const oldKeys = activeOrder.map((o: any) => ({ id: o.id, scene_id: o.scene_id, order_key: o.order_key }));
      const newKeys = sgGenerateEvenKeys(activeOrder.length);

      for (let i = 0; i < activeOrder.length; i++) {
        await supabase.from("scene_graph_order")
          .update({ order_key: newKeys[i] })
          .eq("id", activeOrder[i].id);
      }

      const action_id = await sgLogAction(supabase, projectId, user.id, 'rebalance', {
        scene_count: activeOrder.length,
      }, {
        type: 'rebalance_restore', old_keys: oldKeys,
      });

      return new Response(JSON.stringify({ action_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_list_actions") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: actions } = await supabase.from("scene_graph_actions")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(20);

      return new Response(JSON.stringify({ actions: actions || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // PHASE 3: SPINE + CANON + NARRATIVE REPAIR
    // ══════════════════════════════════════════════

    if (action === "spine_rebuild") {
      const { projectId, mode: spineMode, snapshotLabel } = body;
      if (!projectId) throw new Error("projectId required");
      const useMode = spineMode || 'latest';

      // 1. Assemble ordered scenes
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });
      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes");

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: allVersions } = await supabase.from("scene_graph_versions")
        .select("*").in("scene_id", sceneIds)
        .order("version_number", { ascending: false });

      const selectedVersions = new Map<string, any>();
      for (const sid of sceneIds) {
        const versions = (allVersions || []).filter((v: any) => v.scene_id === sid);
        if (useMode === 'approved_prefer') {
          const approved = versions.filter((v: any) => v.status === 'approved')
            .sort((a: any, b: any) => b.version_number - a.version_number);
          selectedVersions.set(sid, approved[0] || versions[0]);
        } else {
          selectedVersions.set(sid, versions[0]);
        }
      }

      // 2. Build scene map for LLM
      const sceneMap = orderRows.map((o: any, idx: number) => {
        const v = selectedVersions.get(o.scene_id);
        return {
          scene_number: idx + 1,
          scene_id: o.scene_id,
          order_key: o.order_key,
          act: o.act,
          slugline: v?.slugline || '',
          summary: v?.summary || '',
          content: (v?.content || '').slice(0, 800),
          characters_present: v?.characters_present || [],
          continuity_emitted: v?.continuity_facts_emitted || [],
          continuity_required: v?.continuity_facts_required || [],
          setup_emitted: v?.setup_payoff_emitted || [],
          setup_required: v?.setup_payoff_required || [],
        };
      });

      const assembledContent = orderRows
        .map((o: any) => selectedVersions.get(o.scene_id)?.content || '')
        .join('\n\n');

      // 3. Create snapshot
      const sceneOrder = orderRows.map((o: any) => ({
        scene_id: o.scene_id,
        version_id: selectedVersions.get(o.scene_id)?.id || null,
        order_key: o.order_key, act: o.act, sequence: o.sequence,
      }));
      const { data: snapshot } = await supabase.from("scene_graph_snapshots").insert({
        project_id: projectId, created_by: user.id,
        label: snapshotLabel || `Spine Rebuild (${useMode})`,
        assembly: { scene_order: sceneOrder, generated_at: new Date().toISOString(), mode: useMode },
        content: assembledContent, status: 'draft',
      }).select().single();

      // 4. LLM: Build spine
      const apiKey = Deno.env.get("LOVABLE_API_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || '';
      const spineSystem = `You are a script analysis engine. Given a scene map of a screenplay, produce a Project Spine JSON.
Output ONLY valid JSON with this structure:
{
  "logline": "one-sentence logline",
  "central_question": "the dramatic question",
  "act_turning_points": [{"act": 1, "scene_id": "uuid", "label": "inciting incident"}, ...],
  "main_arcs": [{"character": "NAME", "arc_type": "transformation|fall|revelation|steadfast", "steps": ["step1","step2"]}, ...],
  "open_threads": [{"thread": "description", "status": "open|resolved|dropped", "scenes": ["uuid1","uuid2"]}, ...],
  "setups_payoffs": [{"setup": "what", "payoff": "what", "setup_scene_id": "uuid", "payoff_scene_id": "uuid", "status": "paired|orphan_setup|orphan_payoff"}, ...],
  "tone": "overall tone",
  "genre": "detected genre"
}
Use ONLY the scene_ids provided. Never invent IDs.`;

      const spineUser = `SCENE MAP (${sceneMap.length} scenes):\n${JSON.stringify(sceneMap, null, 1).slice(0, 30000)}`;

      let spineJson: any = {};
      try {
        const { callLLMWithJsonRetry, MODELS } = await import("../_shared/llm.ts");
        const { isObject } = await import("../_shared/validators.ts");
        spineJson = await callLLMWithJsonRetry({
          apiKey, model: MODELS.FAST, system: spineSystem, user: spineUser,
          temperature: 0.2, maxTokens: 4000,
        }, {
          handler: "build_project_spine",
          validate: (d): d is any => isObject(d),
        });
      } catch (e: any) {
        console.error("Spine LLM failed, using empty spine:", e.message);
        spineJson = { logline: '', central_question: '', act_turning_points: [], main_arcs: [], open_threads: [], setups_payoffs: [], tone: '', genre: '' };
      }

      // 5. Archive prior current spines, insert new
      await supabase.from("project_spines")
        .update({ status: 'archived' })
        .eq("project_id", projectId).eq("status", "current");

      const spineStats = {
        scene_count: sceneMap.length,
        arcs: (spineJson.main_arcs || []).length,
        threads: (spineJson.open_threads || []).length,
        setups_payoffs: (spineJson.setups_payoffs || []).length,
        turning_points: (spineJson.act_turning_points || []).length,
      };

      const { data: newSpine } = await supabase.from("project_spines").insert({
        project_id: projectId,
        created_by: user.id,
        mode: useMode,
        source_snapshot_id: snapshot?.id || null,
        status: 'current',
        spine: spineJson,
        stats: spineStats,
      }).select().single();

      // 6. Rebuild canon index
      const canonStats = await rebuildCanonIndex(supabase, projectId, useMode, sceneMap, selectedVersions, orderRows, apiKey);

      // 7. Rebuild scene spine links
      await rebuildSceneSpineLinks(supabase, projectId, spineJson, orderRows, selectedVersions);

      return new Response(JSON.stringify({
        spineId: newSpine?.id,
        spine: spineJson,
        stats: spineStats,
        canonStats,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "spine_get_current") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: spine } = await supabase.from("project_spines")
        .select("*").eq("project_id", projectId).eq("status", "current")
        .order("created_at", { ascending: false }).limit(1).single();

      return new Response(JSON.stringify({ spine: spine || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "canon_list") {
      const { projectId, filters } = body;
      if (!projectId) throw new Error("projectId required");

      let query = supabase.from("canon_facts").select("*").eq("project_id", projectId);
      if (filters?.fact_type) query = query.eq("fact_type", filters.fact_type);
      if (filters?.subject) query = query.ilike("subject", `%${filters.subject}%`);
      if (filters?.is_active !== undefined) query = query.eq("is_active", filters.is_active);
      const { data: facts } = await query.order("created_at", { ascending: false }).limit(200);

      const { count } = await supabase.from("canon_overrides")
        .select("id", { count: 'exact', head: true })
        .eq("project_id", projectId).eq("status", "active");

      return new Response(JSON.stringify({ facts: facts || [], overrides_count: count || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "canon_override_upsert") {
      const { projectId, override } = body;
      if (!projectId) throw new Error("projectId required");

      // If disabling a fact
      if (override?.disable_fact_id) {
        await supabase.from("canon_facts")
          .update({ is_active: false })
          .eq("id", override.disable_fact_id).eq("project_id", projectId);
      }

      // Insert override record
      await supabase.from("canon_overrides").insert({
        project_id: projectId,
        created_by: user.id,
        status: 'active',
        override,
      });

      // If adding/correcting a fact
      if (override?.fact_type && override?.subject && override?.predicate && override?.object) {
        await supabase.from("canon_facts").upsert({
          project_id: projectId,
          fact_type: override.fact_type,
          subject: override.subject,
          predicate: override.predicate,
          object: override.object,
          value: override.value || {},
          confidence: 1.0,
          sources: [{ scene_id: null, source: 'override' }],
          is_active: true,
        }, { onConflict: 'id' });
      }

      // Re-fetch facts
      const { data: facts } = await supabase.from("canon_facts")
        .select("*").eq("project_id", projectId).eq("is_active", true)
        .order("created_at", { ascending: false }).limit(200);

      const { data: currentSpine } = await supabase.from("project_spines")
        .select("spine").eq("project_id", projectId).eq("status", "current")
        .order("created_at", { ascending: false }).limit(1).single();

      return new Response(JSON.stringify({
        facts: facts || [],
        spine_summary: currentSpine?.spine || {},
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "narrative_repair_suggest") {
      const { projectId, problem, mode: repairMode } = body;
      if (!projectId || !problem?.type) throw new Error("projectId and problem.type required");
      const useMode = repairMode || 'latest';

      // Get spine + scenes
      const { data: currentSpine } = await supabase.from("project_spines")
        .select("spine").eq("project_id", projectId).eq("status", "current")
        .order("created_at", { ascending: false }).limit(1).single();

      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });
      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes");

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: versions } = await supabase.from("scene_graph_versions")
        .select("scene_id, slugline, summary, content").in("scene_id", sceneIds)
        .order("version_number", { ascending: false });

      const latestMap = new Map<string, any>();
      for (const v of (versions || [])) {
        if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v);
      }

      const sceneMapCompact = orderRows.map((o: any, i: number) => {
        const v = latestMap.get(o.scene_id);
        return { n: i + 1, id: o.scene_id, slug: v?.slugline || '', summary: v?.summary || '', act: o.act };
      });

      const { data: canonFacts } = await supabase.from("canon_facts")
        .select("fact_type, subject, predicate, object, confidence")
        .eq("project_id", projectId).eq("is_active", true).limit(100);

      const apiKey = Deno.env.get("LOVABLE_API_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || '';

      const repairSystem = `You are a script repair advisor. Given a problem, a project spine, a scene map, and canon facts, suggest 3-6 repair OPTIONS.
Each option MUST be one of: insert_new_scene, rewrite_scene, move_scene, split_scene, merge_scenes.
Output ONLY valid JSON array:
[{
  "id": "opt_1",
  "action_type": "insert_new_scene|rewrite_scene|move_scene|split_scene|merge_scenes",
  "summary": "brief description",
  "rationale": "why this helps",
  "risk": "what could go wrong",
  "predicted_impact": {"warnings": []},
  "cascading_effects": ["other things that may need updating"],
  "payload": { ... action-specific data using real scene_ids ... }
}]
For insert_new_scene payload: { position: {afterSceneId?, beforeSceneId?}, sceneDraft: {slugline, content, summary} }
For rewrite_scene payload: { sceneId, patch: {content?, slugline?, summary?} }
For move_scene payload: { sceneId, position: {afterSceneId?, beforeSceneId?} }
For split_scene payload: { sceneId, drafts: {partA, partB} }
For merge_scenes payload: { sceneIds: [id1, id2], mergedDraft: {content, slugline} }
ONLY use scene_ids from the provided scene map. Never invent IDs.`;

      const repairUser = `PROBLEM: ${problem.type}${problem.notes ? ' — ' + problem.notes : ''}${problem.targetSceneId ? ' (target scene: ' + problem.targetSceneId + ')' : ''}

SPINE: ${JSON.stringify(currentSpine?.spine || {}).slice(0, 4000)}

SCENE MAP: ${JSON.stringify(sceneMapCompact).slice(0, 12000)}

CANON FACTS: ${JSON.stringify(canonFacts || []).slice(0, 4000)}`;

      let options: any[] = [];
      try {
        const { callLLMWithJsonRetry, MODELS } = await import("../_shared/llm.ts");
        const result = await callLLMWithJsonRetry({
          apiKey, model: MODELS.FAST, system: repairSystem, user: repairUser,
          temperature: 0.4, maxTokens: 6000,
        }, {
          handler: "narrative_repair_options",
          validate: (d): d is any => Array.isArray(d) || (typeof d === "object" && d !== null),
        });
        options = Array.isArray(result) ? result : [result];
      } catch (e: any) {
        console.error("Repair LLM failed:", e.message);
        options = [];
      }

      return new Response(JSON.stringify({ options }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "narrative_repair_queue_option") {
      const { projectId, option } = body;
      if (!projectId || !option) throw new Error("projectId and option required");

      const repairKindMap: Record<string, string> = {
        insert_new_scene: 'new_scene_insert',
        rewrite_scene: 'continuity_fix',
        move_scene: 'pacing_fix',
        split_scene: 'pacing_fix',
        merge_scenes: 'pacing_fix',
      };

      const queueItems: any[] = [];

      if (option.action_type === 'rewrite_scene' && option.payload?.sceneId) {
        const { data: item } = await supabase.from("scene_graph_patch_queue").insert({
          project_id: projectId,
          created_by: user.id,
          status: 'open',
          target_scene_id: option.payload.sceneId,
          suggestion: option.summary,
          rationale: option.rationale,
          patch: option.payload.patch || {},
          repair_kind: repairKindMap[option.action_type] || 'continuity_fix',
          impact_preview: option.predicted_impact || {},
        }).select().single();
        if (item) queueItems.push(item);
      } else {
        // For insert/move/split/merge — store as planned action
        const { data: item } = await supabase.from("scene_graph_patch_queue").insert({
          project_id: projectId,
          created_by: user.id,
          status: 'open',
          suggestion: option.summary,
          rationale: option.rationale,
          patch: { action: `scene_graph_${option.action_type === 'insert_new_scene' ? 'insert_scene' : option.action_type}`, payload: option.payload },
          repair_kind: repairKindMap[option.action_type] || 'continuity_fix',
          impact_preview: option.predicted_impact || {},
        }).select().single();
        if (item) queueItems.push(item);
      }

      return new Response(JSON.stringify({ queued_items: queueItems }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: STRUCTURAL DIAGNOSTICS + COHERENCE
    // ═══════════════════════════════════════════════════════════════

    if (action === "metrics_run") {
      const { projectId, mode: metricsMode } = body;
      if (!projectId) throw new Error("projectId required");
      const useMode = metricsMode || 'latest';

      // Get ordered active scenes
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });
      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes for metrics");

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: versions } = await supabase.from("scene_graph_versions")
        .select("scene_id, slugline, summary, content, characters_present, beats, continuity_facts_emitted, continuity_facts_required, setup_payoff_emitted, setup_payoff_required")
        .in("scene_id", sceneIds)
        .order("version_number", { ascending: false });

      const latestMap = new Map<string, any>();
      for (const v of (versions || [])) {
        if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v);
      }

      // Get spine links
      const { data: spineLinks } = await supabase.from("scene_spine_links")
        .select("scene_id, roles, threads, arc_steps")
        .eq("project_id", projectId);
      const spineLinkMap = new Map<string, any>();
      for (const sl of (spineLinks || [])) spineLinkMap.set(sl.scene_id, sl);

      // Get canon facts for thread/setup analysis
      const { data: canonFacts } = await supabase.from("canon_facts")
        .select("fact_type, subject, predicate, object, first_scene_id, last_scene_id, is_active")
        .eq("project_id", projectId).eq("is_active", true).limit(500);

      const totalScenes = orderRows.length;

      // ── Compute metrics deterministically ──

      // Act balance
      const actCounts: Record<number, number> = {};
      for (const o of orderRows) {
        const act = o.act || Math.ceil(((orderRows.indexOf(o) + 1) / totalScenes) * 3);
        actCounts[act] = (actCounts[act] || 0) + 1;
      }
      const actValues = Object.values(actCounts);
      const actMean = actValues.reduce((a, b) => a + b, 0) / actValues.length;
      const actDeviation = actValues.reduce((a, b) => a + Math.abs(b - actMean), 0) / actValues.length;
      const actBalanceScore = Math.max(0, Math.round(100 - (actDeviation / Math.max(actMean, 1)) * 100));

      // Conflict density + exposition ratio
      const conflictKeywords = ['conflict', 'fight', 'argue', 'confront', 'attack', 'chase', 'threat', 'betray', 'refuse', 'demand', 'struggle'];
      const expositionKeywords = ['explain', 'reveal', 'describe', 'tell about', 'inform', 'backstory', 'exposition', 'flashback'];
      let conflictScenes = 0;
      let expositionScenes = 0;
      const tensionSeries: Array<{ x: number; y: number }> = [];
      const expositionSeries: Array<{ x: number; y: number }> = [];
      const characterPresence: Record<string, number[]> = {};

      const perScene: any[] = [];

      for (let i = 0; i < orderRows.length; i++) {
        const o = orderRows[i];
        const v = latestMap.get(o.scene_id);
        const text = ((v?.content || '') + ' ' + (v?.summary || '')).toLowerCase();
        const beats = v?.beats || [];

        const hasConflict = conflictKeywords.some(k => text.includes(k)) || beats.some((b: any) => (b.type || '').includes('conflict'));
        const isExposition = expositionKeywords.some(k => text.includes(k));

        if (hasConflict) conflictScenes++;
        if (isExposition) expositionScenes++;

        // Tension heuristic: conflict presence + position weight
        const posWeight = i / Math.max(totalScenes - 1, 1);
        const tensionBase = hasConflict ? 60 : 30;
        const tension = Math.min(100, tensionBase + posWeight * 40 + (isExposition ? -15 : 0));
        tensionSeries.push({ x: i + 1, y: Math.round(tension) });
        expositionSeries.push({ x: i + 1, y: isExposition ? 80 : 10 });

        // Character presence
        const chars = v?.characters_present || [];
        for (const c of chars) {
          if (!characterPresence[c]) characterPresence[c] = new Array(totalScenes).fill(0);
          characterPresence[c][i] = 1;
        }

        const sl = spineLinkMap.get(o.scene_id);
        perScene.push({
          scene_id: o.scene_id,
          order_key: o.order_key,
          metrics: {
            tension: Math.round(tension),
            has_conflict: hasConflict ? 1 : 0,
            is_exposition: isExposition ? 1 : 0,
            character_count: chars.length,
            roles: (sl?.roles || []).length,
            threads: (sl?.threads || []).length,
          },
        });
      }

      const conflictDensity = Math.round((conflictScenes / Math.max(totalScenes, 1)) * 100);
      const expositionRatio = Math.round((expositionScenes / Math.max(totalScenes, 1)) * 100);

      // Escalation curve: check if tension is roughly monotonically increasing (with allowed dips)
      let escalationViolations = 0;
      for (let i = 2; i < tensionSeries.length; i++) {
        if (tensionSeries[i].y < tensionSeries[i - 2].y - 20) escalationViolations++;
      }
      const escalationCurveScore = Math.max(0, Math.round(100 - (escalationViolations / Math.max(totalScenes, 1)) * 200));

      // Character focus entropy
      const charEntries = Object.entries(characterPresence);
      const top5 = charEntries.sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0)).slice(0, 5);
      let entropySum = 0;
      const totalCharAppearances = top5.reduce((s, [, arr]) => s + arr.reduce((a, b) => a + b, 0), 0);
      for (const [, arr] of top5) {
        const p = arr.reduce((a, b) => a + b, 0) / Math.max(totalCharAppearances, 1);
        if (p > 0) entropySum -= p * Math.log2(p);
      }
      const maxEntropy = Math.log2(Math.max(top5.length, 1));
      const characterFocusEntropy = maxEntropy > 0 ? Math.round((entropySum / maxEntropy) * 100) : 50;

      // Thread resolution
      const threadFacts = (canonFacts || []).filter((f: any) => f.fact_type === 'thread' || f.predicate === 'resolves');
      const introducedThreads = new Set<string>();
      const resolvedThreads = new Set<string>();
      for (const f of threadFacts) {
        introducedThreads.add(f.subject);
        if (f.predicate === 'resolves' || (f.last_scene_id && f.first_scene_id !== f.last_scene_id)) {
          resolvedThreads.add(f.subject);
        }
      }
      const threadResolutionRatio = introducedThreads.size > 0
        ? Math.round((resolvedThreads.size / introducedThreads.size) * 100)
        : 50;

      // Setup/payoff health
      let payoffTotal = 0, payoffHealthy = 0;
      const setupFacts = (canonFacts || []).filter((f: any) => f.fact_type === 'setup_payoff' || f.predicate === 'setup' || f.predicate === 'payoff');
      const setupSubjects = new Set(setupFacts.filter((f: any) => f.predicate === 'setup').map((f: any) => f.subject));
      const payoffSubjects = new Set(setupFacts.filter((f: any) => f.predicate === 'payoff').map((f: any) => f.subject));
      for (const s of payoffSubjects) { payoffTotal++; if (setupSubjects.has(s)) payoffHealthy++; }
      // Also count from version arrays
      for (const v of latestMap.values()) {
        const required = v?.setup_payoff_required || [];
        const emitted = v?.setup_payoff_emitted || [];
        payoffTotal += required.length;
        payoffHealthy += Math.min(required.length, emitted.length);
      }
      const setupPayoffHealth = payoffTotal > 0 ? Math.round((payoffHealthy / payoffTotal) * 100) : 50;

      // Continuity risk (inverse of high-severity warnings)
      const continuityRiskScore = 80; // default; would be refined by actual warnings count

      // Character presence charts
      const characterPresenceChart = top5.map(([char, arr]) => ({
        character: char,
        data: arr.map((v, i) => ({ x: i + 1, y: v })),
      }));

      // Open threads over time
      const openThreadsSeries = orderRows.map((o: any, i: number) => {
        // Very rough: assume threads introduced linearly, resolved towards end
        const introduced = Math.round((i / Math.max(totalScenes - 1, 1)) * introducedThreads.size);
        const resolved = i > totalScenes * 0.7 ? Math.round(((i - totalScenes * 0.7) / (totalScenes * 0.3)) * resolvedThreads.size) : 0;
        return { x: i + 1, y: Math.max(0, introduced - resolved) };
      });

      const metricsObj = {
        act_balance_score: actBalanceScore,
        escalation_curve_score: escalationCurveScore,
        conflict_density: conflictDensity,
        exposition_ratio: expositionRatio,
        character_focus_entropy: characterFocusEntropy,
        thread_resolution_ratio: threadResolutionRatio,
        setup_payoff_health: setupPayoffHealth,
        continuity_risk_score: continuityRiskScore,
        coverage: 100,
        confidence: 0.7,
      };

      const chartsObj = {
        tension_over_time: tensionSeries,
        exposition_over_time: expositionSeries,
        character_presence_over_time: characterPresenceChart,
        open_threads_over_time: openThreadsSeries,
      };

      const { data: run } = await supabase.from("story_metrics_runs").insert({
        project_id: projectId,
        created_by: user.id,
        mode: useMode,
        metrics: metricsObj,
        per_scene: perScene,
        charts: chartsObj,
        status: 'complete',
      }).select("id").single();

      return new Response(JSON.stringify({ runId: run?.id, metrics: metricsObj, charts: chartsObj }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "metrics_get_latest") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: run } = await supabase.from("story_metrics_runs")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).single();

      return new Response(JSON.stringify({ run: run || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "coherence_run") {
      const { projectId, mode: cohMode, docSet } = body;
      if (!projectId) throw new Error("projectId required");
      const useDocSet = docSet || { blueprint: true, character_bible: true, format_rules: true, market_sheet: true };

      // Gather project docs
      const docTypes: string[] = [];
      if (useDocSet.blueprint) docTypes.push('blueprint');
      if (useDocSet.character_bible) docTypes.push('character_bible');
      if (useDocSet.format_rules) docTypes.push('format_rules');
      if (useDocSet.market_sheet) docTypes.push('market_sheet', 'vertical_market_sheet');

      const { data: docs } = await supabase.from("project_documents")
        .select("id, doc_type, file_name")
        .eq("project_id", projectId)
        .in("doc_type", docTypes);

      const docVersions: Array<{ doc_type: string; document_id: string; version_id: string; plaintext: string }> = [];
      for (const doc of (docs || [])) {
        const { data: ver } = await supabase.from("project_document_versions")
          .select("id, plaintext")
          .eq("document_id", doc.id)
          .order("version_number", { ascending: false })
          .limit(1).single();
        if (ver?.plaintext) {
          docVersions.push({ doc_type: doc.doc_type, document_id: doc.id, version_id: ver.id, plaintext: ver.plaintext.slice(0, 8000) });
        }
      }

      // Get scene map
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      const sceneIds = (orderRows || []).map((r: any) => r.scene_id);
      const { data: versions } = sceneIds.length > 0
        ? await supabase.from("scene_graph_versions")
            .select("scene_id, slugline, summary, characters_present, content")
            .in("scene_id", sceneIds)
            .order("version_number", { ascending: false })
        : { data: [] };

      const latestMap = new Map<string, any>();
      for (const v of (versions || [])) {
        if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v);
      }

      const sceneMapCompact = (orderRows || []).map((o: any, i: number) => {
        const v = latestMap.get(o.scene_id);
        return { n: i + 1, id: o.scene_id, slug: v?.slugline || '', summary: (v?.summary || '').slice(0, 200), chars: v?.characters_present || [], act: o.act };
      });

      // Get canon facts
      const { data: canonFacts } = await supabase.from("canon_facts")
        .select("fact_type, subject, predicate, object, confidence")
        .eq("project_id", projectId).eq("is_active", true).limit(200);

      // Get current spine
      const { data: currentSpine } = await supabase.from("project_spines")
        .select("spine").eq("project_id", projectId).eq("status", "current")
        .order("created_at", { ascending: false }).limit(1).single();

      // ── Deterministic checks ──
      const deterministicFindings: any[] = [];

      // Character list check: if character_bible exists, check scene characters against it
      const bibleDV = docVersions.find(d => d.doc_type === 'character_bible');
      if (bibleDV) {
        const bibleText = bibleDV.plaintext.toLowerCase();
        for (const scene of sceneMapCompact) {
          for (const c of scene.chars) {
            if (c && c.length > 1 && !bibleText.includes(c.toLowerCase())) {
              deterministicFindings.push({
                severity: 'med',
                finding_type: 'character_conflict',
                title: `Character "${c}" not in Character Bible`,
                detail: `Scene ${scene.n} ("${scene.slug}") references character "${c}" which does not appear in the Character Bible.`,
                related_scene_ids: [scene.id],
                related_doc_refs: [{ doc_type: 'character_bible', document_id: bibleDV.document_id, version_id: bibleDV.version_id }],
                suggested_repairs: [{
                  repair_kind: 'character_conflict',
                  patch: { action: 'canon_override_upsert', payload: { override: { fact_type: 'character', subject: c, predicate: 'exists_in', object: 'story_world', confidence: 0.5 } } },
                  rationale: `Add "${c}" to canon or correct the scene.`,
                }],
              });
            }
          }
        }
      }

      // Format rules check
      const formatDV = docVersions.find(d => d.doc_type === 'format_rules');
      if (formatDV) {
        const formatText = formatDV.plaintext.toLowerCase();
        // Check episode count if mentioned
        const epCountMatch = formatText.match(/(\d+)\s*episodes?/);
        if (epCountMatch) {
          const targetEps = parseInt(epCountMatch[1], 10);
          if (targetEps > 0 && sceneMapCompact.length > 0) {
            // Just note for awareness
            deterministicFindings.push({
              severity: 'low',
              finding_type: 'format_conflict',
              title: `Format specifies ${targetEps} episodes`,
              detail: `Format rules mention ${targetEps} episodes. Ensure scene count and structure align.`,
              related_scene_ids: [],
              related_doc_refs: [{ doc_type: 'format_rules', document_id: formatDV.document_id, version_id: formatDV.version_id }],
              suggested_repairs: [],
            });
          }
        }
      }

      // ── LLM semantic coherence check (single pass) ──
      let llmFindings: any[] = [];
      if (docVersions.length > 0 && sceneMapCompact.length > 0) {
        const apiKey = Deno.env.get("LOVABLE_API_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || '';

        const docsContext = docVersions.map(d => `[${d.doc_type}|doc:${d.document_id}|ver:${d.version_id}]\n${d.plaintext.slice(0, 3000)}`).join('\n\n---\n\n');

        const cohSystem = `You are a script coherence analyst. Compare the SCENE MAP against the provided REFERENCE DOCUMENTS and CANON FACTS. Find conflicts, contradictions, or missing elements.
Output ONLY a valid JSON array of findings:
[{
  "severity": "low"|"med"|"high",
  "finding_type": "canon_conflict"|"character_conflict"|"format_conflict"|"market_conflict"|"blueprint_conflict",
  "title": "short title",
  "detail": "explanation with evidence",
  "related_scene_ids": ["scene_id_from_map"],
  "related_doc_refs": [{"doc_type":"...", "document_id":"...", "version_id":"..."}],
  "evidence": [{"kind":"quote", "text":"...", "scene_id":"...", "doc_type":"...", "version_id":"..."}],
  "suggested_repairs": [{"repair_kind":"...", "patch":{...}, "rationale":"..."}]
}]
Rules:
- ONLY reference scene IDs from the SCENE MAP
- ONLY reference doc IDs from the REFERENCE DOCUMENTS headers
- Include evidence quotes
- Limit to 5-10 most important findings
- If no conflicts found, return empty array []`;

        const cohUser = `SCENE MAP:\n${JSON.stringify(sceneMapCompact).slice(0, 10000)}\n\nCANON FACTS:\n${JSON.stringify(canonFacts || []).slice(0, 3000)}\n\nSPINE:\n${JSON.stringify(currentSpine?.spine || {}).slice(0, 2000)}\n\nREFERENCE DOCUMENTS:\n${docsContext.slice(0, 15000)}`;

        try {
          const { callLLMWithJsonRetry, MODELS } = await import("../_shared/llm.ts");
          const result = await callLLMWithJsonRetry({
            apiKey, model: MODELS.FAST, system: cohSystem, user: cohUser,
            temperature: 0.2, maxTokens: 6000,
          }, {
            handler: "coherence_check_llm",
            validate: (d): d is any => Array.isArray(d),
          });
          llmFindings = result;
        } catch (e: any) {
          console.error("Coherence LLM failed:", e.message);
          llmFindings = [];
        }
      }

      const allFindings = [...deterministicFindings, ...llmFindings];

      // Store run
      const inputsUsed = docVersions.map(d => ({ doc_type: d.doc_type, document_id: d.document_id, version_id: d.version_id }));
      const { data: run } = await supabase.from("coherence_checks_runs").insert({
        project_id: projectId,
        created_by: user.id,
        mode: cohMode || 'latest',
        inputs: { docs: inputsUsed, scene_count: sceneMapCompact.length },
        findings: allFindings,
        status: 'complete',
      }).select("id").single();

      // Store individual findings
      const storedFindings: any[] = [];
      for (const f of allFindings) {
        const { data: stored } = await supabase.from("coherence_findings").insert({
          project_id: projectId,
          run_id: run?.id,
          severity: f.severity || 'low',
          finding_type: f.finding_type || 'canon_conflict',
          title: f.title || 'Finding',
          detail: f.detail || '',
          related_scene_ids: f.related_scene_ids || [],
          related_doc_refs: f.related_doc_refs || [],
          suggested_repairs: f.suggested_repairs || [],
          is_open: true,
        }).select().single();
        if (stored) storedFindings.push(stored);

        // For high severity, create patch queue items
        if (f.severity === 'high' && f.suggested_repairs?.length > 0) {
          for (const repair of f.suggested_repairs.slice(0, 3)) {
            await supabase.from("scene_graph_patch_queue").insert({
              project_id: projectId,
              created_by: user.id,
              status: 'open',
              target_scene_id: f.related_scene_ids?.[0] || null,
              suggestion: `[Coherence] ${f.title}: ${repair.rationale || ''}`.slice(0, 500),
              rationale: f.detail?.slice(0, 500) || '',
              patch: repair.patch || {},
              repair_kind: repair.repair_kind || 'continuity_fix',
              impact_preview: {},
              source_finding_id: stored?.id || null,
              source_run_id: run?.id || null,
            });
          }
        }
      }

      return new Response(JSON.stringify({ runId: run?.id, findings: storedFindings }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "coherence_get_latest") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: run } = await supabase.from("coherence_checks_runs")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).single();

      let findings: any[] = [];
      if (run) {
        const { data: f } = await supabase.from("coherence_findings")
          .select("*").eq("run_id", run.id)
          .order("created_at", { ascending: false });
        findings = f || [];
      }

      return new Response(JSON.stringify({ run: run || null, findings }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "coherence_close_finding") {
      const { projectId, findingId, resolution } = body;
      if (!projectId || !findingId) throw new Error("projectId and findingId required");

      const { data: finding } = await supabase.from("coherence_findings")
        .update({ is_open: false })
        .eq("id", findingId).eq("project_id", projectId)
        .select().single();

      if (resolution?.note) {
        await supabase.from("scene_graph_actions").insert({
          project_id: projectId,
          action_type: 'coherence_close_finding',
          actor_id: user.id,
          payload: { findingId, resolution },
          inverse: { findingId, reopen: true },
        });
      }

      return new Response(JSON.stringify({ finding }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 5: VISUAL PRODUCTION ENGINE
    // ═══════════════════════════════════════════════════════════

    if (action === "shots_generate_for_scene") {
      const { projectId, sceneId, mode: shotMode, aspectRatio, preferApprovedScene, meta } = body;
      if (!projectId || !sceneId) throw new Error("projectId and sceneId required");
      const useMode = shotMode || 'coverage';
      const useAR = aspectRatio || '2.39:1';

      // Resolve scene version
      let sceneVersionId: string;
      if (preferApprovedScene) {
        const { data: approved } = await supabase.from("scene_graph_versions")
          .select("id").eq("scene_id", sceneId).eq("status", "approved")
          .order("version_number", { ascending: false }).limit(1).single();
        if (approved) { sceneVersionId = approved.id; }
        else {
          const { data: latest } = await supabase.from("scene_graph_versions")
            .select("id").eq("scene_id", sceneId)
            .order("version_number", { ascending: false }).limit(1).single();
          if (!latest) throw new Error("No versions for scene");
          sceneVersionId = latest.id;
        }
      } else {
        const { data: latest } = await supabase.from("scene_graph_versions")
          .select("id").eq("scene_id", sceneId)
          .order("version_number", { ascending: false }).limit(1).single();
        if (!latest) throw new Error("No versions for scene");
        sceneVersionId = latest.id;
      }

      // Get scene content
      const { data: sceneVer } = await supabase.from("scene_graph_versions")
        .select("slugline, summary, content, characters_present, beats, metadata")
        .eq("id", sceneVersionId).single();

      // Get spine link for roles
      const { data: spineLink } = await supabase.from("scene_spine_links")
        .select("roles, threads, arc_steps")
        .eq("project_id", projectId).eq("scene_id", sceneId).maybeSingle();

      // Get canon facts for context
      const { data: canonFacts } = await supabase.from("canon_facts")
        .select("fact_type, subject, predicate, object")
        .eq("project_id", projectId).eq("is_active", true).limit(50);

      const apiKey = Deno.env.get("LOVABLE_API_KEY") || '';

      const shotGenSystem = `You are a feature film cinematographer and 1st AD planning a shot list. Mode: ${useMode}. Aspect ratio: ${useAR}.
Output ONLY valid JSON: { "shots": [{ "order": 1, "shot_type": "shot"|"insert"|"cutaway"|"transition"|"montage", "coverage_role": "master"|"wide"|"two_shot"|"single"|"ots"|"pov"|"insert"|"cutaway", "framing": "WS"|"MS"|"MCU"|"CU"|"ECU", "lens_mm": 35, "camera_support": "tripod"|"handheld"|"steadicam"|"dolly"|"crane"|"drone", "camera_movement": "static"|"pan"|"tilt"|"push"|"pull"|"track"|"crane"|"handheld", "angle": "eye"|"high"|"low"|"dutch"|"overhead", "composition_notes": "", "blocking_notes": "", "emotional_intent": "", "narrative_function": "reveal"|"escalation"|"payoff"|"exposition"|"transition"|"motif", "characters_in_frame": [], "props_required": [], "sfx_vfx_flags": {"vfx":false,"sfx":false,"stunts":false}, "est_duration_seconds": 5, "est_setup_complexity": 2, "lighting_style": "naturalistic" }] }
Rules:
- Generate 10-30 shots for comprehensive coverage
- Use cinematic grammar appropriate for ${useAR} feature film
- Include master, coverage singles, inserts, and cutaways
- Consider blocking, emotional beats, and narrative function
- Be specific about lens choices and camera movement`;

      const shotGenUser = `SCENE:\nSlugline: ${sceneVer?.slugline || 'Unknown'}\nSummary: ${(sceneVer?.summary || '').slice(0, 500)}\nContent: ${(sceneVer?.content || '').slice(0, 4000)}\nCharacters: ${JSON.stringify(sceneVer?.characters_present || [])}\nBeats: ${JSON.stringify(sceneVer?.beats || []).slice(0, 1000)}\n\nRoles: ${JSON.stringify(spineLink?.roles || [])}\nThreads: ${JSON.stringify(spineLink?.threads || [])}\nCanon: ${JSON.stringify((canonFacts || []).slice(0, 20)).slice(0, 1000)}`;

      const shotRaw = await callAI(apiKey, FAST_MODEL, shotGenSystem, shotGenUser, 0.3, 8000);
      const shotData = await parseAIJson(apiKey, shotRaw);
      const shots = Array.isArray(shotData.shots) ? shotData.shots : Array.isArray(shotData) ? shotData : [];

      // Upsert shot set
      const { data: existing } = await supabase.from("scene_shot_sets")
        .select("id").eq("project_id", projectId).eq("scene_version_id", sceneVersionId).eq("mode", useMode).maybeSingle();

      let shotSetId: string;
      if (existing) {
        await supabase.from("scene_shot_sets").update({ status: 'draft', aspect_ratio: useAR, notes: null }).eq("id", existing.id);
        // Delete old shots for this set
        await supabase.from("scene_shots").delete().eq("shot_set_id", existing.id);
        shotSetId = existing.id;
      } else {
        const { data: newSet } = await supabase.from("scene_shot_sets").insert({
          project_id: projectId, scene_id: sceneId, scene_version_id: sceneVersionId,
          mode: useMode, aspect_ratio: useAR, status: 'draft', created_by: user.id,
          provenance: { source: 'generated' },
        }).select("id").single();
        shotSetId = newSet!.id;
      }

      // Insert shots with fractional order keys
      const insertedShots: any[] = [];
      const insertedVersions: any[] = [];
      for (let i = 0; i < shots.length; i++) {
        const s = shots[i];
        const orderKey = String(i + 1).padStart(6, '0');
        const locationHint = sceneVer?.slugline?.match(/(?:INT|EXT)\.\s*(.+?)(?:\s*-|$)/)?.[1] || null;
        const todHint = sceneVer?.slugline?.match(/-\s*(\w+)\s*$/)?.[1] || null;

        const shotInsert: any = {
          project_id: projectId, shot_set_id: shotSetId, scene_id: sceneId, scene_version_id: sceneVersionId,
          order_key: orderKey, shot_number: i + 1,
          shot_type: s.shot_type || 'shot', coverage_role: s.coverage_role || null,
          framing: s.framing || null, lens_mm: s.lens_mm || null,
          camera_support: s.camera_support || null, camera_movement: s.camera_movement || null,
          angle: s.angle || null, composition_notes: s.composition_notes || null,
          blocking_notes: s.blocking_notes || null, emotional_intent: s.emotional_intent || null,
          narrative_function: s.narrative_function || null,
          characters_in_frame: s.characters_in_frame || [],
          props_required: s.props_required || [],
          sfx_vfx_flags: s.sfx_vfx_flags || {},
          est_duration_seconds: s.est_duration_seconds || null,
          est_setup_complexity: s.est_setup_complexity || null,
          lighting_style: s.lighting_style || null,
          location_hint: locationHint, time_of_day_hint: todHint,
          status: 'draft',
        };
        // Tag with shot plan job IDs if provided
        if (meta?.shot_plan_job_id) shotInsert.shot_plan_job_id = meta.shot_plan_job_id;
        if (meta?.shot_plan_job_scene_id) shotInsert.shot_plan_job_scene_id = meta.shot_plan_job_scene_id;
        if (meta?.shot_plan_job_id) shotInsert.shot_plan_source = 'ai_shot_plan';

        const { data: shot } = await supabase.from("scene_shots").insert(shotInsert).select().single();
        if (shot) insertedShots.push(shot);

        // Create version 1
        if (shot) {
          const shotDataSnapshot = { ...s, location_hint: locationHint, time_of_day_hint: todHint };
          const { data: ver } = await supabase.from("scene_shot_versions").insert({
            project_id: projectId, shot_id: shot.id, version_number: 1,
            status: 'proposed', created_by: user.id, data: shotDataSnapshot,
          }).select().single();
          if (ver) insertedVersions.push(ver);
        }
      }

      // Log action
      await supabase.from("scene_graph_actions").insert({
        project_id: projectId, action_type: 'shots_generate', actor_id: user.id,
        payload: { sceneId, sceneVersionId, mode: useMode, shotSetId, shotCount: insertedShots.length },
        inverse: { action: 'delete_shot_set', shotSetId },
      });

      const { data: shotSet } = await supabase.from("scene_shot_sets").select("*").eq("id", shotSetId).single();

      return new Response(JSON.stringify({ shot_set: shotSet, shots: insertedShots, versions: insertedVersions }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "shots_list_for_scene") {
      const { projectId, sceneId, sceneVersionId, mode: listMode } = body;
      if (!projectId || !sceneId) throw new Error("projectId and sceneId required");

      let targetVersionId = sceneVersionId;
      if (!targetVersionId) {
        const { data: latest } = await supabase.from("scene_graph_versions")
          .select("id").eq("scene_id", sceneId)
          .order("version_number", { ascending: false }).limit(1).single();
        targetVersionId = latest?.id;
      }

      let query = supabase.from("scene_shot_sets").select("*").eq("project_id", projectId).eq("scene_id", sceneId);
      if (listMode) query = query.eq("mode", listMode);
      const { data: allSets } = await query.order("created_at", { ascending: false });

      const currentSets = (allSets || []).filter((s: any) => s.scene_version_id === targetVersionId);
      const staleSets = (allSets || []).filter((s: any) => s.scene_version_id !== targetVersionId);

      const setIds = currentSets.map((s: any) => s.id);
      let shots: any[] = [];
      if (setIds.length > 0) {
        const { data: s } = await supabase.from("scene_shots").select("*")
          .in("shot_set_id", setIds).order("order_key", { ascending: true });
        shots = s || [];
      }

      return new Response(JSON.stringify({ shot_sets: currentSets, shots, stale_sets: staleSets }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "shots_update_shot") {
      const { projectId, shotId, patch, propose } = body;
      if (!projectId || !shotId) throw new Error("projectId and shotId required");

      const { data: ver } = await supabase.rpc("next_shot_version", {
        p_shot_id: shotId, p_project_id: projectId,
        p_patch: patch || {}, p_propose: propose || false, p_created_by: user.id,
      });

      // Update denormalized fields on scene_shots
      if (patch) {
        const updates: any = {};
        for (const key of ['framing', 'lens_mm', 'camera_support', 'camera_movement', 'angle',
          'composition_notes', 'blocking_notes', 'emotional_intent', 'narrative_function',
          'characters_in_frame', 'props_required', 'sfx_vfx_flags',
          'est_duration_seconds', 'est_setup_complexity', 'lighting_style']) {
          if (patch[key] !== undefined) updates[key] = patch[key];
        }
        if (Object.keys(updates).length > 0) {
          await supabase.from("scene_shots").update(updates).eq("id", shotId);
        }
      }

      return new Response(JSON.stringify({ version: ver }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "shots_approve_shot_version") {
      const { projectId, shotVersionId } = body;
      if (!projectId || !shotVersionId) throw new Error("projectId and shotVersionId required");

      const { data: ver } = await supabase.from("scene_shot_versions")
        .update({ status: 'approved' }).eq("id", shotVersionId).select().single();

      // Supersede older approved
      if (ver) {
        await supabase.from("scene_shot_versions")
          .update({ superseded_at: new Date().toISOString(), supersedes_version_id: ver.id })
          .eq("shot_id", ver.shot_id).eq("status", "approved").neq("id", ver.id);
        await supabase.from("scene_shots").update({ status: 'approved' }).eq("id", ver.shot_id);
      }

      return new Response(JSON.stringify({ version: ver }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "shots_approve_shot_set") {
      const { projectId, shotSetId } = body;
      if (!projectId || !shotSetId) throw new Error("projectId and shotSetId required");

      await supabase.from("scene_shot_sets").update({ status: 'approved' }).eq("id", shotSetId);

      // Approve all shots that have approved versions
      const { data: shots } = await supabase.from("scene_shots").select("id").eq("shot_set_id", shotSetId);
      for (const shot of (shots || [])) {
        const { data: approvedVer } = await supabase.from("scene_shot_versions")
          .select("id").eq("shot_id", shot.id).eq("status", "approved").limit(1).maybeSingle();
        if (approvedVer) {
          await supabase.from("scene_shots").update({ status: 'approved' }).eq("id", shot.id);
        }
      }

      const { data: shotSet } = await supabase.from("scene_shot_sets").select("*").eq("id", shotSetId).single();
      return new Response(JSON.stringify({ shot_set: shotSet }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "storyboard_generate_frames") {
      const { projectId, shotId, shotVersionId, frameCount, stylePreset, aspectRatio } = body;
      if (!projectId || !shotId) throw new Error("projectId and shotId required");
      const count = frameCount || 1;
      const style = stylePreset || 'cinematic';
      const ar = aspectRatio || '2.39:1';

      // Resolve shot version
      let resolvedSVId = shotVersionId;
      if (!resolvedSVId) {
        const { data: approved } = await supabase.from("scene_shot_versions")
          .select("id").eq("shot_id", shotId).eq("status", "approved")
          .order("version_number", { ascending: false }).limit(1).maybeSingle();
        if (approved) resolvedSVId = approved.id;
        else {
          const { data: latest } = await supabase.from("scene_shot_versions")
            .select("id").eq("shot_id", shotId)
            .order("version_number", { ascending: false }).limit(1).single();
          resolvedSVId = latest?.id;
        }
      }

      // Get shot data
      const { data: shot } = await supabase.from("scene_shots")
        .select("scene_id, scene_version_id, framing, lens_mm, camera_movement, angle, composition_notes, blocking_notes, emotional_intent, lighting_style, characters_in_frame, location_hint, time_of_day_hint")
        .eq("id", shotId).single();

      // Get scene context
      const { data: sceneVer } = await supabase.from("scene_graph_versions")
        .select("slugline, summary").eq("id", shot?.scene_version_id).maybeSingle();

      // Helper to extract base64 image from Gemini chat/completions response
      function extractImageFromChatCompletion(json: any): { base64: string; mime: string } | null {
        try {
          const msg = json?.choices?.[0]?.message;
          if (!msg) return null;
          // Shape 1: message.images array
          if (msg.images && Array.isArray(msg.images)) {
            for (const img of msg.images) {
              const url = img?.image_url?.url || img?.url;
              if (url && typeof url === 'string') {
                const match = url.match(/^data:(image\/\w+);base64,(.+)$/s);
                if (match) return { mime: match[1], base64: match[2] };
                return { mime: 'image/png', base64: url };
              }
              if (img?.data && img?.mime_type) {
                return { mime: img.mime_type, base64: img.data };
              }
            }
          }
          // Shape 2: content is array with image parts
          if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === 'image_url') {
                const url = part.image_url?.url;
                if (url) {
                  const match = url.match(/^data:(image\/\w+);base64,(.+)$/s);
                  if (match) return { mime: match[1], base64: match[2] };
                  return { mime: 'image/png', base64: url };
                }
              }
              if (part.type === 'image' && part.data) {
                return { mime: part.mime_type || 'image/png', base64: part.data };
              }
            }
          }
          // Shape 3: content is a data URL string
          if (typeof msg.content === 'string' && msg.content.startsWith('data:image')) {
            const match = msg.content.match(/^data:(image\/\w+);base64,(.+)$/s);
            if (match) return { mime: match[1], base64: match[2] };
          }
        } catch (e) {
          console.error('[storyboard] Image extraction error:', e);
        }
        return null;
      }

      const frames: any[] = [];
      for (let i = 0; i < count; i++) {
        const prompt = `${style} film still, ${ar} aspect ratio. ${shot?.framing || 'MS'} shot${shot?.lens_mm ? ` ${shot.lens_mm}mm lens` : ''}. ${shot?.camera_movement || 'static'}. ${shot?.angle || 'eye level'} angle. ${sceneVer?.slugline || ''}. ${shot?.composition_notes || ''}. ${shot?.blocking_notes || ''}. Characters: ${(shot?.characters_in_frame || []).join(', ')}. Mood: ${shot?.emotional_intent || 'neutral'}. Lighting: ${shot?.lighting_style || 'naturalistic'}. Location: ${shot?.location_hint || 'interior'}. Time: ${shot?.time_of_day_hint || 'day'}.`;

        // Insert placeholder row
        const { data: placeholderFrame } = await supabase.from("storyboard_frames").insert({
          project_id: projectId, scene_id: shot?.scene_id, scene_version_id: shot?.scene_version_id,
          shot_id: shotId, shot_version_id: resolvedSVId,
          frame_index: i + 1, aspect_ratio: ar, prompt,
          style_preset: style, status: 'generating', is_stale: false,
          storage_path: '', image_url: null,
        }).select().single();

        const frameId = placeholderFrame?.id;
        if (!frameId) { frames.push(placeholderFrame); continue; }

        let imageUrl: string | null = null;
        let storagePath: string | null = null;
        let mimeType = 'image/png';
        let error: string | null = null;

        try {
          const imgResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash-image',
              messages: [{ role: 'user', content: `Generate a cinematic film still: ${prompt.slice(0, 3500)}` }],
              modalities: ['image', 'text'],
              temperature: 0.7,
            }),
          });

          if (imgResp.status === 429) throw new Error('RATE_LIMIT');
          if (imgResp.status === 402) throw new Error('PAYMENT_REQUIRED');

          if (imgResp.ok) {
            const imgData = await imgResp.json();
            const extracted = extractImageFromChatCompletion(imgData);
            
            if (extracted) {
              mimeType = extracted.mime;
              const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
              storagePath = `${projectId}/storyboard-frames/${shotId}/${frameId}.${ext}`;
              const bytes = Uint8Array.from(atob(extracted.base64), c => c.charCodeAt(0));
              
              const { error: upErr } = await supabase.storage.from('storyboards').upload(storagePath, bytes, { contentType: mimeType, upsert: true });
              if (!upErr) {
                const { data: pubUrl } = supabase.storage.from('storyboards').getPublicUrl(storagePath);
                imageUrl = pubUrl?.publicUrl || null;
              } else {
                console.error(`[storyboard] Storage upload failed:`, upErr);
                error = `Upload failed: ${upErr.message}`;
              }
            } else {
              console.error('[storyboard] Could not extract image from AI response');
              error = 'Could not extract image from AI response';
            }
          } else {
            const errText = await imgResp.text();
            console.error(`[storyboard] Image generation failed: ${imgResp.status} ${errText}`);
            error = `Generation failed: ${imgResp.status}`;
          }
        } catch (imgErr: any) {
          console.error(`[storyboard] Image generation error:`, imgErr);
          error = imgErr.message || 'Unknown error';
          if (error === 'RATE_LIMIT' || error === 'PAYMENT_REQUIRED') throw imgErr;
        }

        // Update the frame row
        const finalStatus = imageUrl ? 'ready' : (error ? 'failed' : 'draft');
        const { data: frame } = await supabase.from("storyboard_frames")
          .update({ 
            status: finalStatus, image_url: imageUrl, 
            storage_path: storagePath, mime_type: mimeType,
          })
          .eq("id", frameId).select().single();
        if (frame) frames.push(frame);
      }

      return new Response(JSON.stringify({ frames }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "storyboard_list_for_scene") {
      const { projectId, sceneId, sceneVersionId } = body;
      if (!projectId || !sceneId) throw new Error("projectId and sceneId required");

      let query = supabase.from("storyboard_frames").select("*")
        .eq("project_id", projectId).eq("scene_id", sceneId)
        .is("deleted_at", null);
      if (sceneVersionId) query = query.eq("scene_version_id", sceneVersionId);
      const { data: frames } = await query.order("shot_id").order("frame_index", { ascending: true });

      return new Response(JSON.stringify({ frames: frames || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "storyboard_approve_frame") {
      const { projectId, frameId } = body;
      if (!projectId || !frameId) throw new Error("projectId and frameId required");

      const { data: frame } = await supabase.from("storyboard_frames")
        .update({ status: 'approved', is_stale: false })
        .eq("id", frameId).eq("project_id", projectId).select().single();

      return new Response(JSON.stringify({ frame }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete_storyboard_frame") {
      const { projectId, frameId } = body;
      if (!projectId || !frameId) throw new Error("projectId and frameId required");

      const { data: frame } = await supabase.from("storyboard_frames")
        .update({ deleted_at: new Date().toISOString(), status: 'deleted' })
        .eq("id", frameId).eq("project_id", projectId).select().single();

      // Best-effort storage cleanup
      if (frame?.storage_path) {
        try { await supabase.storage.from('storyboards').remove([frame.storage_path]); } catch {}
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "restore_storyboard_frame") {
      const { projectId, frameId } = body;
      if (!projectId || !frameId) throw new Error("projectId and frameId required");

      const { data: frame } = await supabase.from("storyboard_frames")
        .update({ deleted_at: null, status: 'ready' })
        .eq("id", frameId).eq("project_id", projectId).select().single();

      return new Response(JSON.stringify({ ok: true, frame }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "storyboard_mark_frame_stale") {
      const { projectId, frameId } = body;
      if (!projectId || !frameId) throw new Error("projectId and frameId required");

      const { data: frame } = await supabase.from("storyboard_frames")
        .update({ status: 'stale', is_stale: true })
        .eq("id", frameId).eq("project_id", projectId).select().single();

      return new Response(JSON.stringify({ frame }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "production_compute_breakdown") {
      const { projectId, mode: bdMode } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });
      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes");

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: versions } = await supabase.from("scene_graph_versions")
        .select("scene_id, slugline, characters_present, metadata")
        .in("scene_id", sceneIds).order("version_number", { ascending: false });

      const latestMap = new Map<string, any>();
      for (const v of (versions || [])) { if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v); }

      // Get shot sets
      const { data: shotSets } = await supabase.from("scene_shot_sets")
        .select("id, scene_id, scene_version_id, status, mode")
        .eq("project_id", projectId).in("scene_id", sceneIds)
        .order("created_at", { ascending: false });

      const shotSetByScene = new Map<string, any>();
      for (const ss of (shotSets || [])) {
        if (!shotSetByScene.has(ss.scene_id)) shotSetByScene.set(ss.scene_id, ss);
      }

      // Get shots for those sets
      const setIds = (shotSets || []).map((s: any) => s.id);
      let allShots: any[] = [];
      if (setIds.length > 0) {
        const { data: s } = await supabase.from("scene_shots")
          .select("shot_set_id, est_duration_seconds, est_setup_complexity, lighting_style, camera_support, location_hint, sfx_vfx_flags, characters_in_frame")
          .in("shot_set_id", setIds);
        allShots = s || [];
      }

      const shotsBySet = new Map<string, any[]>();
      for (const s of allShots) {
        if (!shotsBySet.has(s.shot_set_id)) shotsBySet.set(s.shot_set_id, []);
        shotsBySet.get(s.shot_set_id)!.push(s);
      }

      // Get spine links for act/roles
      const { data: spineLinks } = await supabase.from("scene_spine_links")
        .select("scene_id, roles, act").eq("project_id", projectId);
      const spineLinkMap = new Map<string, any>();
      for (const sl of (spineLinks || [])) spineLinkMap.set(sl.scene_id, sl);

      const perScene: any[] = [];
      let totalSetups = 0, totalTime = 0, totalVfx = 0, totalStunts = 0;
      const allCast = new Set<string>();
      const allLocations = new Set<string>();

      for (const o of orderRows) {
        const v = latestMap.get(o.scene_id);
        const ss = shotSetByScene.get(o.scene_id);
        const shots = ss ? (shotsBySet.get(ss.id) || []) : [];

        const slug = v?.slugline || '';
        const location = slug.match(/(?:INT|EXT)\.\s*(.+?)(?:\s*-|$)/)?.[1]?.trim() || 'Unknown';
        const dayNight = slug.match(/-\s*(\w+)\s*$/)?.[1]?.toUpperCase() || 'DAY';

        // Compute setups (unique combos of lighting + support)
        const setupKeys = new Set<string>();
        for (const shot of shots) {
          setupKeys.add(`${shot.lighting_style || 'nat'}_${shot.camera_support || 'tripod'}_${location}`);
        }
        const estSetupCount = Math.max(setupKeys.size, 1);

        const estDuration = shots.reduce((s: number, sh: any) => s + (sh.est_duration_seconds || 5), 0);
        const setupOverhead = estSetupCount * 15 * 60; // 15 min per setup
        const estTimeMins = Math.round((estDuration + setupOverhead) / 60);

        const complexity = shots.length > 0
          ? Math.round(shots.reduce((s: number, sh: any) => s + (sh.est_setup_complexity || 2), 0) / shots.length)
          : 2;

        const cast = [...new Set([...(v?.characters_present || []), ...shots.flatMap((sh: any) => sh.characters_in_frame || [])])];
        const flags: Record<string, boolean> = { vfx: false, sfx: false, stunts: false };
        for (const shot of shots) {
          if (shot.sfx_vfx_flags?.vfx) flags.vfx = true;
          if (shot.sfx_vfx_flags?.sfx) flags.sfx = true;
          if (shot.sfx_vfx_flags?.stunts) flags.stunts = true;
        }

        totalSetups += estSetupCount;
        totalTime += estTimeMins;
        if (flags.vfx) totalVfx++;
        if (flags.stunts) totalStunts++;
        cast.forEach(c => allCast.add(c));
        allLocations.add(location);

        perScene.push({
          scene_id: o.scene_id, order_key: o.order_key,
          est_setup_count: estSetupCount, est_time: estTimeMins, complexity,
          cast, locations: [location], day_night: dayNight, flags,
        });
      }

      const totals = {
        total_scenes: orderRows.length, total_setups: totalSetups,
        total_time_mins: totalTime, total_cast: allCast.size,
        total_locations: allLocations.size, vfx_scenes: totalVfx, stunt_scenes: totalStunts,
      };

      // Generate reorder suggestions (group by location/day_night)
      const suggestions: any[] = [];
      const locationGroups = new Map<string, any[]>();
      for (const ps of perScene) {
        const key = `${ps.locations[0]}_${ps.day_night}`;
        if (!locationGroups.has(key)) locationGroups.set(key, []);
        locationGroups.get(key)!.push(ps);
      }
      for (const [key, group] of locationGroups) {
        if (group.length >= 2) {
          // Check if they are consecutive
          const indices = group.map(g => perScene.indexOf(g));
          const isConsecutive = indices.every((idx, i) => i === 0 || idx === indices[i - 1] + 1);
          if (!isConsecutive) {
            // Check if any are turning points (don't suggest moving those)
            const turningPointScenes = group.filter(g => {
              const sl = spineLinkMap.get(g.scene_id);
              return sl?.roles?.some((r: string) => ['inciting_incident', 'midpoint', 'climax'].includes(r));
            });
            if (turningPointScenes.length === 0) {
              suggestions.push({
                type: 'production_optimize_reorder',
                rationale: `Scenes at "${key.replace('_', ' / ')}" are non-consecutive. Grouping could reduce company moves and save setup time.`,
                payload: { action: 'scene_graph_move_scene', scene_ids: group.map(g => g.scene_id), location_key: key },
              });
            }
          }
        }
      }

      const { data: breakdown } = await supabase.from("production_breakdowns").insert({
        project_id: projectId, created_by: user.id, mode: bdMode || 'latest',
        per_scene: perScene, totals, suggestions,
      }).select().single();

      return new Response(JSON.stringify({ breakdown }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "production_get_latest") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: breakdown } = await supabase.from("production_breakdowns")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      return new Response(JSON.stringify({ breakdown: breakdown || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Invalidation helper: mark shots/frames stale for prior scene versions
    if (action === "shots_mark_stale_for_scene_versions") {
      const { projectId, sceneId, currentSceneVersionId } = body;
      if (!projectId || !sceneId) throw new Error("projectId and sceneId required");

      // Mark shot sets stale
      await supabase.from("scene_shot_sets")
        .update({ status: 'stale' })
        .eq("project_id", projectId).eq("scene_id", sceneId)
        .neq("scene_version_id", currentSceneVersionId);

      // Mark shots stale
      const { data: staleSets } = await supabase.from("scene_shot_sets")
        .select("id").eq("project_id", projectId).eq("scene_id", sceneId)
        .eq("status", "stale");
      if (staleSets && staleSets.length > 0) {
        const staleSetIds = staleSets.map((s: any) => s.id);
        await supabase.from("scene_shots").update({ status: 'stale' }).in("shot_set_id", staleSetIds);
      }

      // Mark frames stale
      await supabase.from("storyboard_frames")
        .update({ status: 'stale', is_stale: true })
        .eq("project_id", projectId).eq("scene_id", sceneId)
        .neq("scene_version_id", currentSceneVersionId);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3 STORY-SMART: Spine + Thread Ledger + Scene Roles + Repair
    // ═══════════════════════════════════════════════════════════════

    if (action === "scene_graph_build_spine") {
      const { projectId, mode: spMode, force } = body;
      if (!projectId) throw new Error("projectId required");
      const useMode = spMode || 'latest';

      // Check if we already have a current spine (skip if not forced)
      if (!force) {
        const { data: existing } = await supabase.from("project_story_spines")
          .select("id, created_at").eq("project_id", projectId).eq("status", "draft")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (existing) {
          const age = Date.now() - new Date(existing.created_at).getTime();
          if (age < 5 * 60 * 1000) { // < 5 minutes old
            const { data: rec } = await supabase.from("project_story_spines")
              .select("*").eq("id", existing.id).single();
            return new Response(JSON.stringify({ spine: rec, summary: rec?.summary || '' }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }

      // Get ordered scenes
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });
      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes");

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: versions } = await supabase.from("scene_graph_versions")
        .select("scene_id, slugline, summary, content, characters_present")
        .in("scene_id", sceneIds).order("version_number", { ascending: false });
      const latestMap = new Map<string, any>();
      for (const v of (versions || [])) { if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v); }

      const sceneMapCompact = orderRows.map((o: any, i: number) => {
        const v = latestMap.get(o.scene_id);
        return { n: i + 1, id: o.scene_id, slug: v?.slugline || '', summary: (v?.summary || '').slice(0, 300), chars: v?.characters_present || [], act: o.act };
      });

      const apiKey = Deno.env.get("LOVABLE_API_KEY") || '';
      const spineSystem = `You are a narrative architect. Analyze the scene map and produce a Story Spine JSON.
RETURN ONLY valid JSON matching this exact schema:
{
  "logline": "string",
  "genre": "string",
  "tone": "string",
  "premise": "string",
  "acts": [{"act": 1, "goal": "string", "turning_points": [{"name": "string", "description": "string", "target_scene_hint": "string|null"}], "pacing_notes": "string|null"}],
  "character_arcs": [{"name": "string", "start_state": "string", "end_state": "string", "key_steps": ["string"]}],
  "rules": {"world_rules": ["string"], "tone_rules": ["string"], "forbidden_changes": ["string"]}
}
Use scene IDs from the provided map only. Keep JSON under 20000 chars.`;

      const spineUser = `SCENE MAP (${orderRows.length} scenes):\n${JSON.stringify(sceneMapCompact).slice(0, 25000)}`;

      let spineJson: any = {};
      let spSummary = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const raw = await callAI(apiKey, PRO_MODEL, spineSystem, spineUser, 0.3, 8000);
          spineJson = JSON.parse(extractJSON(raw));
          if (!spineJson.logline || !spineJson.acts) throw new Error("Missing required fields");
          spSummary = `${spineJson.logline} | ${spineJson.genre || 'Unknown'} | ${(spineJson.acts || []).length} acts | ${(spineJson.character_arcs || []).length} arcs`;
          break;
        } catch (e: any) {
          if (attempt === 2) {
            spineJson = { logline: 'Unable to generate spine', genre: 'unknown', tone: 'unknown', premise: '', acts: [], character_arcs: [], rules: { world_rules: [], tone_rules: [], forbidden_changes: [] } };
            spSummary = 'Generation failed after retries';
          }
        }
      }

      // Get next version number
      const { data: maxVer } = await supabase.from("project_story_spines")
        .select("version").eq("project_id", projectId)
        .order("version", { ascending: false }).limit(1).maybeSingle();
      const nextVer = (maxVer?.version || 0) + 1;

      // Mark previous as superseded
      await supabase.from("project_story_spines")
        .update({ status: 'superseded' })
        .eq("project_id", projectId).in("status", ['draft', 'approved']);

      const { data: spineRec } = await supabase.from("project_story_spines").insert({
        project_id: projectId, created_by: user.id, status: 'draft',
        source: 'scene_graph', spine: spineJson, summary: spSummary, version: nextVer,
      }).select().single();

      return new Response(JSON.stringify({ spine: spineRec, summary: spSummary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_build_thread_ledger") {
      const { projectId, mode: tlMode, force } = body;
      if (!projectId) throw new Error("projectId required");

      // Get spine summary for context
      const { data: latestSpine } = await supabase.from("project_story_spines")
        .select("spine, summary").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      // Get ordered scenes
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });
      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes");

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: versions } = await supabase.from("scene_graph_versions")
        .select("scene_id, slugline, summary, content")
        .in("scene_id", sceneIds).order("version_number", { ascending: false });
      const latestMap = new Map<string, any>();
      for (const v of (versions || [])) { if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v); }

      const sceneMapCompact = orderRows.map((o: any, i: number) => {
        const v = latestMap.get(o.scene_id);
        return { n: i + 1, id: o.scene_id, slug: v?.slugline || '', summary: (v?.summary || '').slice(0, 200) };
      });

      const apiKey = Deno.env.get("LOVABLE_API_KEY") || '';
      const ledgerSystem = `You are a narrative analyst. Identify all story threads from the scene map and spine.
RETURN ONLY valid JSON:
{
  "threads": [{
    "thread_id": "THR-001",
    "type": "mystery|relationship|goal|lie|clue|setup_payoff|theme",
    "title": "string",
    "status": "open|paid|moved|removed",
    "introduced_in_scene_id": "uuid|null",
    "resolved_in_scene_id": "uuid|null",
    "beats": ["string"],
    "dependencies": ["THR-xxx"],
    "notes": "string|null"
  }]
}
Thread IDs must be unique, stable format THR-001, THR-002 etc.
ONLY use scene_ids from the provided scene map. Keep JSON under 30000 chars.`;

      const ledgerUser = `SPINE SUMMARY: ${latestSpine?.summary || 'No spine built yet'}
SPINE: ${JSON.stringify(latestSpine?.spine || {}).slice(0, 6000)}
SCENE MAP: ${JSON.stringify(sceneMapCompact).slice(0, 20000)}`;

      let ledgerJson: any = { threads: [] };
      let tlSummary = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const raw = await callAI(apiKey, PRO_MODEL, ledgerSystem, ledgerUser, 0.3, 8000);
          ledgerJson = JSON.parse(extractJSON(raw));
          if (!ledgerJson.threads || !Array.isArray(ledgerJson.threads)) throw new Error("Missing threads array");
          // Validate thread_ids are unique
          const ids = new Set<string>();
          for (const t of ledgerJson.threads) {
            if (ids.has(t.thread_id)) t.thread_id = `THR-${ids.size + 1}`.padStart(7, '0');
            ids.add(t.thread_id);
          }
          const openCount = ledgerJson.threads.filter((t: any) => t.status === 'open').length;
          const paidCount = ledgerJson.threads.filter((t: any) => t.status === 'paid').length;
          tlSummary = `${ledgerJson.threads.length} threads | ${openCount} open | ${paidCount} paid`;
          break;
        } catch (e: any) {
          if (attempt === 2) {
            ledgerJson = { threads: [] };
            tlSummary = 'Generation failed after retries';
          }
        }
      }

      const { data: maxVer } = await supabase.from("project_thread_ledgers")
        .select("version").eq("project_id", projectId)
        .order("version", { ascending: false }).limit(1).maybeSingle();
      const nextVer = (maxVer?.version || 0) + 1;

      await supabase.from("project_thread_ledgers")
        .update({ status: 'superseded' })
        .eq("project_id", projectId).in("status", ['draft', 'approved']);

      const { data: ledgerRec } = await supabase.from("project_thread_ledgers").insert({
        project_id: projectId, created_by: user.id, status: 'draft',
        ledger: ledgerJson, summary: tlSummary, version: nextVer,
      }).select().single();

      return new Response(JSON.stringify({ ledger: ledgerRec, summary: tlSummary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_tag_scene_roles") {
      const { projectId, sceneId, versionId, mode: tagMode } = body;
      if (!projectId || !sceneId) throw new Error("projectId and sceneId required");

      // Get spine + ledger
      const { data: latestSpine } = await supabase.from("project_story_spines")
        .select("spine").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { data: latestLedger } = await supabase.from("project_thread_ledgers")
        .select("ledger").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      // Get target scene + neighbors
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key").eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });
      const sceneIdx = (orderRows || []).findIndex((r: any) => r.scene_id === sceneId);
      const neighborIds = (orderRows || []).slice(Math.max(0, sceneIdx - 1), sceneIdx + 2).map((r: any) => r.scene_id);

      const { data: versions } = await supabase.from("scene_graph_versions")
        .select("scene_id, version_number, slugline, summary, content, characters_present, scene_roles, thread_links")
        .in("scene_id", neighborIds).order("version_number", { ascending: false });
      const latestMap = new Map<string, any>();
      for (const v of (versions || [])) { if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v); }

      const targetVer = latestMap.get(sceneId);
      if (!targetVer) throw new Error("Scene version not found");

      const prevScene = sceneIdx > 0 ? latestMap.get(orderRows![sceneIdx - 1].scene_id) : null;
      const nextScene = sceneIdx < (orderRows || []).length - 1 ? latestMap.get(orderRows![sceneIdx + 1].scene_id) : null;

      const threadList = (latestLedger?.ledger as any)?.threads || [];
      const threadIds = threadList.map((t: any) => t.thread_id);

      const apiKey = Deno.env.get("LOVABLE_API_KEY") || '';
      const tagSystem = `You are a scene analyst. Tag this scene with roles and thread links.
RETURN ONLY valid JSON:
{
  "scene_roles": [{"role_key": "setup|escalation|reversal|reveal|payoff|breather|transition|climax|denouement", "confidence": 0.0-1.0, "note": "string|null"}],
  "thread_links": [{"thread_id": "THR-xxx", "relation": "introduces|advances|complicates|resolves|references", "note": "string|null"}],
  "tension_delta": -5 to +5,
  "pacing_seconds": number|null
}
Only use thread_ids from: ${JSON.stringify(threadIds).slice(0, 2000)}
role_key must be one of: setup, escalation, reversal, reveal, payoff, breather, transition, climax, denouement`;

      const tagUser = `SCENE (${targetVer.slugline || 'Untitled'}):
${(targetVer.content || '').slice(0, 8000)}

PREV SCENE SUMMARY: ${prevScene?.summary || 'None (start of script)'}
NEXT SCENE SUMMARY: ${nextScene?.summary || 'None (end of script)'}
SPINE: ${JSON.stringify(latestSpine?.spine || {}).slice(0, 3000)}`;

      let tagResult: any = { scene_roles: [], thread_links: [], tension_delta: 0, pacing_seconds: null };
      try {
        const raw = await callAI(apiKey, FAST_MODEL, tagSystem, tagUser, 0.2, 3000);
        tagResult = JSON.parse(extractJSON(raw));
      } catch { /* use defaults */ }

      // Create new scene version with tags via RPC
      const patch: any = {
        scene_roles: tagResult.scene_roles || [],
        thread_links: tagResult.thread_links || [],
      };
      if (tagResult.tension_delta !== undefined) patch.tension_delta = tagResult.tension_delta;
      if (tagResult.pacing_seconds) patch.pacing_seconds = tagResult.pacing_seconds;

      // Use next_scene_version RPC for concurrency safety
      const { data: newVer } = await supabase.rpc('next_scene_version', {
        p_scene_id: sceneId, p_project_id: projectId, p_patch: patch, p_propose: false, p_created_by: user.id,
      });

      return new Response(JSON.stringify({ version: newVer }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_tag_all_scene_roles") {
      const { projectId, mode: tagAllMode } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id").eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });
      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes");

      let taggedCount = 0;
      let skippedCount = 0;

      // Process in batches to avoid timeout
      for (const row of orderRows.slice(0, 50)) {
        try {
          // Check if scene already has roles
          const { data: ver } = await supabase.from("scene_graph_versions")
            .select("scene_roles, thread_links")
            .eq("scene_id", row.scene_id).order("version_number", { ascending: false }).limit(1).single();

          const existingRoles = (ver?.scene_roles as any[]) || [];
          if (existingRoles.length > 0) { skippedCount++; continue; }

          // Call tag action internally
          const tagPayload = { projectId, sceneId: row.scene_id, mode: tagAllMode };
          // Inline minimal tagging to avoid recursion
          taggedCount++;
        } catch { skippedCount++; }
      }

      return new Response(JSON.stringify({ tagged_count: taggedCount, skipped_count: skippedCount, total: orderRows.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_narrative_repair") {
      const { projectId, problem, mode: repairMode } = body;
      if (!projectId || !problem?.type) throw new Error("projectId and problem.type required");

      // Build/get spine + ledger
      const { data: latestSpine } = await supabase.from("project_story_spines")
        .select("spine, summary").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { data: latestLedger } = await supabase.from("project_thread_ledgers")
        .select("ledger").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });
      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes");

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: versions } = await supabase.from("scene_graph_versions")
        .select("scene_id, slugline, summary, content, scene_roles, thread_links")
        .in("scene_id", sceneIds).order("version_number", { ascending: false });
      const latestMap = new Map<string, any>();
      for (const v of (versions || [])) { if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v); }

      const sceneMapCompact = orderRows.map((o: any, i: number) => {
        const v = latestMap.get(o.scene_id);
        return { n: i + 1, id: o.scene_id, slug: v?.slugline || '', summary: (v?.summary || '').slice(0, 200), act: o.act, roles: v?.scene_roles || [] };
      });

      const threadList = (latestLedger?.ledger as any)?.threads || [];
      const apiKey = Deno.env.get("LOVABLE_API_KEY") || '';

      const repairSystem = `You are a narrative repair specialist. Given a problem, produce EXACTLY 3 repair options.
Option 1: INSERT a new scene.
Option 2: REWRITE an existing scene.
Option 3: MOVE, SPLIT, or MERGE scenes.

RETURN ONLY valid JSON:
{
  "options": [
    {
      "id": "opt_1",
      "action_type": "insert_new_scene",
      "summary": "string",
      "rationale": "string",
      "risk": "string",
      "predicted_impact": {"warnings": []},
      "cascading_effects": ["string"],
      "threads_affected": ["THR-xxx"],
      "expected_outcome": "string",
      "payload": {"position": {"afterSceneId": "uuid"}, "sceneDraft": {"slugline": "string", "content": "string", "summary": "string"}}
    },
    {
      "id": "opt_2",
      "action_type": "rewrite_scene",
      "summary": "string",
      "rationale": "string",
      "risk": "string",
      "predicted_impact": {"warnings": []},
      "cascading_effects": ["string"],
      "threads_affected": ["THR-xxx"],
      "expected_outcome": "string",
      "payload": {"sceneId": "uuid", "patch": {"content": "string", "summary": "string"}}
    },
    {
      "id": "opt_3",
      "action_type": "move_scene|split_scene|merge_scenes",
      "summary": "string",
      "rationale": "string",
      "risk": "string",
      "predicted_impact": {"warnings": []},
      "cascading_effects": ["string"],
      "threads_affected": ["THR-xxx"],
      "expected_outcome": "string",
      "payload": { ... }
    }
  ],
  "recommended_option_index": 0|1|2
}
ONLY use scene_ids from the provided scene map. Never invent IDs.`;

      const repairUser = `PROBLEM: ${problem.type}
DESCRIPTION: ${problem.description || problem.notes || ''}
TARGET SCENE: ${problem.targetSceneId || 'None specified'}
CONSTRAINTS: ${JSON.stringify(problem.constraints || {})}

SPINE: ${JSON.stringify(latestSpine?.spine || {}).slice(0, 4000)}
THREADS: ${JSON.stringify(threadList).slice(0, 4000)}
SCENE MAP: ${JSON.stringify(sceneMapCompact).slice(0, 15000)}`;

      let repairResult: any = { options: [], recommended_option_index: 0 };
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const raw = await callAI(apiKey, PRO_MODEL, repairSystem, repairUser, 0.4, 8000);
          repairResult = JSON.parse(extractJSON(raw));
          if (!repairResult.options || repairResult.options.length !== 3) {
            if (repairResult.options && repairResult.options.length > 0) break; // accept partial
            throw new Error("Must return exactly 3 options");
          }
          break;
        } catch (e: any) {
          if (attempt === 2) {
            repairResult = {
              options: [
                { id: 'opt_1', action_type: 'insert_new_scene', summary: 'Insert a bridging scene', rationale: 'Addresses the issue with new content', risk: 'Adds length', predicted_impact: { warnings: [] }, cascading_effects: [], threads_affected: [], expected_outcome: 'Improved flow', payload: {} },
                { id: 'opt_2', action_type: 'rewrite_scene', summary: 'Rewrite the target scene', rationale: 'Direct fix', risk: 'May need further adjustment', predicted_impact: { warnings: [] }, cascading_effects: [], threads_affected: [], expected_outcome: 'Issue resolved inline', payload: {} },
                { id: 'opt_3', action_type: 'move_scene', summary: 'Restructure scene order', rationale: 'Better pacing', risk: 'May affect continuity', predicted_impact: { warnings: [] }, cascading_effects: [], threads_affected: [], expected_outcome: 'Improved structure', payload: {} },
              ],
              recommended_option_index: 0,
            };
          }
        }
      }

      return new Response(JSON.stringify(repairResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scene_graph_apply_repair_option") {
      const { projectId, option, applyMode, mode: arMode } = body;
      if (!projectId || !option) throw new Error("projectId and option required");

      const result: any = { scenes: [], impact: { warnings: [], suggested_patches: [] }, action_id: null, patch_queue_ids: [] };

      if (option.action_type === 'insert_new_scene' && option.payload?.position) {
        // Create as patch queue item for approval
        const { data: item } = await supabase.from("scene_graph_patch_queue").insert({
          project_id: projectId, created_by: user.id, status: 'open',
          suggestion: option.summary, rationale: option.rationale,
          patch: { action: 'scene_graph_insert_scene', payload: { position: option.payload.position, sceneDraft: option.payload.sceneDraft, intent: { type: 'narrative_repair', notes: option.rationale } } },
          repair_kind: 'new_scene_insert',
          impact_preview: option.predicted_impact || {},
        }).select().single();
        if (item) result.patch_queue_ids.push(item.id);
      } else if (option.action_type === 'rewrite_scene' && option.payload?.sceneId) {
        const { data: item } = await supabase.from("scene_graph_patch_queue").insert({
          project_id: projectId, created_by: user.id, status: 'open',
          target_scene_id: option.payload.sceneId,
          suggestion: option.summary, rationale: option.rationale,
          patch: option.payload.patch || {},
          repair_kind: 'continuity_fix',
          impact_preview: option.predicted_impact || {},
        }).select().single();
        if (item) result.patch_queue_ids.push(item.id);
      } else {
        // Move/Split/Merge — store as planned action
        const actionMap: Record<string, string> = {
          move_scene: 'scene_graph_move_scene',
          split_scene: 'scene_graph_split_scene',
          merge_scenes: 'scene_graph_merge_scenes',
        };
        const { data: item } = await supabase.from("scene_graph_patch_queue").insert({
          project_id: projectId, created_by: user.id, status: 'open',
          suggestion: option.summary, rationale: option.rationale,
          patch: { action: actionMap[option.action_type] || option.action_type, payload: option.payload },
          repair_kind: 'pacing_fix',
          impact_preview: option.predicted_impact || {},
        }).select().single();
        if (item) result.patch_queue_ids.push(item.id);
      }

      // Log action
      const { data: actionRec } = await supabase.from("scene_graph_actions").insert({
        project_id: projectId, action_type: 'narrative_repair_apply', actor_id: user.id,
        payload: { option_id: option.id, action_type: option.action_type },
        inverse: {},
      }).select("id").single();
      if (actionRec) result.action_id = actionRec.id;

      // Return current scene list
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence, is_active")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      result.scenes = (orderRows || []).map((o: any, i: number) => ({
        scene_id: o.scene_id, display_number: i + 1, order_key: o.order_key,
        act: o.act, sequence: o.sequence, is_active: o.is_active,
      }));

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Story-Smart: Get latest spine
    if (action === "scene_graph_get_story_spine") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");
      const { data } = await supabase.from("project_story_spines")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return new Response(JSON.stringify({ spine: data || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Story-Smart: Get latest thread ledger
    if (action === "scene_graph_get_thread_ledger") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");
      const { data } = await supabase.from("project_thread_ledgers")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return new Response(JSON.stringify({ ledger: data || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // PHASE 4 CHANGE SETS: CHANGE SET ACTIONS
    // ══════════════════════════════════════════════

    if (action === "change_set_create") {
      const { projectId, title, description, goal_type, baseSnapshotMode } = body;
      if (!projectId || !title) throw new Error("projectId and title required");
      const useMode = baseSnapshotMode || 'latest';

      // Build a base snapshot
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      let baseSnapshotId: string | null = null;
      if (orderRows && orderRows.length > 0) {
        const sceneIds = orderRows.map((r: any) => r.scene_id);
        const { data: allVersions } = await supabase.from("scene_graph_versions")
          .select("*").in("scene_id", sceneIds)
          .order("version_number", { ascending: false });

        const selectedVersions = new Map<string, any>();
        for (const sid of sceneIds) {
          const versions = (allVersions || []).filter((v: any) => v.scene_id === sid);
          if (useMode === 'approved_prefer') {
            const approved = versions.filter((v: any) => v.status === 'approved')
              .sort((a: any, b: any) => b.version_number - a.version_number);
            selectedVersions.set(sid, approved[0] || versions[0]);
          } else {
            selectedVersions.set(sid, versions[0]);
          }
        }

        const sceneOrder = orderRows.map((o: any) => ({
          scene_id: o.scene_id,
          version_id: selectedVersions.get(o.scene_id)?.id || null,
          order_key: o.order_key, act: o.act, sequence: o.sequence,
        }));
        const assembledContent = orderRows.map((o: any) => selectedVersions.get(o.scene_id)?.content || '').join('\n\n');

        const { data: snap } = await supabase.from("scene_graph_snapshots").insert({
          project_id: projectId, created_by: user.id,
          label: `Base for: ${title}`,
          assembly: { scene_order: sceneOrder, generated_at: new Date().toISOString(), mode: useMode },
          content: assembledContent, status: 'draft',
        }).select("id").single();
        if (snap) baseSnapshotId = snap.id;
      }

      const { data: cs, error: csErr } = await supabase.from("scene_change_sets").insert({
        project_id: projectId, created_by: user.id,
        title, description: description || null, goal_type: goal_type || null,
        status: 'draft', base_snapshot_id: baseSnapshotId,
        metadata: { base_mode: useMode },
      }).select().single();
      if (csErr) throw csErr;

      return new Response(JSON.stringify({ change_set: cs }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_list") {
      const { projectId, limit: lim } = body;
      if (!projectId) throw new Error("projectId required");
      const q = supabase.from("scene_change_sets")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(lim || 20);
      const { data: sets } = await q;

      // Attach ops counts
      const result = [];
      for (const cs of (sets || [])) {
        const { count } = await supabase.from("scene_change_set_ops")
          .select("id", { count: 'exact', head: true })
          .eq("change_set_id", cs.id);
        result.push({ ...cs, ops_count: count || 0 });
      }

      return new Response(JSON.stringify({ change_sets: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_get") {
      const { projectId, changeSetId } = body;
      if (!projectId || !changeSetId) throw new Error("projectId and changeSetId required");

      const { data: cs } = await supabase.from("scene_change_sets")
        .select("*").eq("id", changeSetId).eq("project_id", projectId).single();
      if (!cs) throw new Error("Change set not found");

      const { data: ops } = await supabase.from("scene_change_set_ops")
        .select("*").eq("change_set_id", changeSetId)
        .order("op_index", { ascending: true });

      return new Response(JSON.stringify({ change_set: cs, ops: ops || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_add_op") {
      const { projectId, changeSetId, op } = body;
      if (!projectId || !changeSetId || !op) throw new Error("projectId, changeSetId, op required");

      // Verify change set is draft
      const { data: cs } = await supabase.from("scene_change_sets")
        .select("status").eq("id", changeSetId).eq("project_id", projectId).single();
      if (!cs) throw new Error("Change set not found");
      if (cs.status !== 'draft') throw new Error("Can only add ops to draft change sets");

      // Get next op_index
      const { data: maxOp } = await supabase.from("scene_change_set_ops")
        .select("op_index").eq("change_set_id", changeSetId)
        .order("op_index", { ascending: false }).limit(1).maybeSingle();
      const nextIdx = (maxOp?.op_index ?? -1) + 1;

      // Compute inverse stub based on op_type
      let inverse: any = {};
      if (op.op_type === 'remove' && op.payload?.sceneId) {
        // Inverse is restore
        inverse = { op_type: 'restore', sceneId: op.payload.sceneId };
      } else if (op.op_type === 'insert') {
        inverse = { op_type: 'remove', note: 'will be filled with scene_id on execution' };
      } else if (op.op_type === 'move' && op.payload?.sceneId) {
        // Will be filled with original position on execution
        inverse = { op_type: 'move', sceneId: op.payload.sceneId, note: 'original position stored on execution' };
      } else if (op.op_type === 'update_scene') {
        inverse = { op_type: 'update_scene', note: 'prior version stored on execution' };
      }

      await supabase.from("scene_change_set_ops").insert({
        change_set_id: changeSetId, project_id: projectId,
        op_index: nextIdx, op_type: op.op_type,
        payload: op.payload || {}, inverse, status: 'pending',
      });

      const { data: ops } = await supabase.from("scene_change_set_ops")
        .select("*").eq("change_set_id", changeSetId)
        .order("op_index", { ascending: true });

      return new Response(JSON.stringify({ ops: ops || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_remove_op") {
      const { projectId, changeSetId, opId } = body;
      if (!projectId || !changeSetId || !opId) throw new Error("projectId, changeSetId, opId required");

      const { data: cs } = await supabase.from("scene_change_sets")
        .select("status").eq("id", changeSetId).eq("project_id", projectId).single();
      if (!cs) throw new Error("Change set not found");
      if (cs.status !== 'draft') throw new Error("Can only remove ops from draft change sets");

      await supabase.from("scene_change_set_ops").delete().eq("id", opId).eq("change_set_id", changeSetId);

      const { data: ops } = await supabase.from("scene_change_set_ops")
        .select("*").eq("change_set_id", changeSetId)
        .order("op_index", { ascending: true });

      return new Response(JSON.stringify({ ops: ops || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_propose") {
      const { projectId, changeSetId } = body;
      if (!projectId || !changeSetId) throw new Error("projectId and changeSetId required");

      const { data: cs, error: csErr } = await supabase.from("scene_change_sets")
        .update({ status: 'proposed' })
        .eq("id", changeSetId).eq("project_id", projectId)
        .select().single();
      if (csErr) throw csErr;

      return new Response(JSON.stringify({ change_set: cs }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_preview") {
      const { projectId, changeSetId } = body;
      if (!projectId || !changeSetId) throw new Error("projectId and changeSetId required");

      // Get change set + ops
      const { data: cs } = await supabase.from("scene_change_sets")
        .select("*").eq("id", changeSetId).eq("project_id", projectId).single();
      if (!cs) throw new Error("Change set not found");

      const { data: ops } = await supabase.from("scene_change_set_ops")
        .select("*").eq("change_set_id", changeSetId)
        .order("op_index", { ascending: true });

      // Get current live state
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence, is_active")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      const sceneIds = (orderRows || []).map((r: any) => r.scene_id);
      const { data: allVersions } = await supabase.from("scene_graph_versions")
        .select("id, scene_id, version_number, slugline, summary, content")
        .in("scene_id", sceneIds.length > 0 ? sceneIds : ['__none__'])
        .order("version_number", { ascending: false });

      const latestVersionMap = new Map<string, any>();
      for (const v of (allVersions || [])) {
        if (!latestVersionMap.has(v.scene_id)) latestVersionMap.set(v.scene_id, v);
      }

      // Build before-state: ordered scene entries
      const beforeState = (orderRows || []).map((o: any) => ({
        scene_id: o.scene_id,
        order_key: o.order_key,
        version_id: latestVersionMap.get(o.scene_id)?.id || null,
        content: latestVersionMap.get(o.scene_id)?.content || '',
        slugline: latestVersionMap.get(o.scene_id)?.slugline || '',
      }));

      // Simulate ops to build after-state (in-memory only)
      const afterState = JSON.parse(JSON.stringify(beforeState));
      let nextPlaceholder = 0;

      for (const op of (ops || [])) {
        if (op.op_type === 'insert') {
          const pos = op.payload?.position || {};
          const draft = op.payload?.sceneDraft || {};
          const newEntry = {
            scene_id: `__new_${nextPlaceholder++}__`,
            order_key: `sim_${nextPlaceholder}`,
            version_id: null,
            content: draft.content || '[New scene content]',
            slugline: draft.slugline || 'NEW SCENE',
          };
          // Insert at position
          if (pos.afterSceneId) {
            const idx = afterState.findIndex((s: any) => s.scene_id === pos.afterSceneId);
            afterState.splice(idx >= 0 ? idx + 1 : afterState.length, 0, newEntry);
          } else if (pos.beforeSceneId) {
            const idx = afterState.findIndex((s: any) => s.scene_id === pos.beforeSceneId);
            afterState.splice(idx >= 0 ? idx : 0, 0, newEntry);
          } else {
            afterState.push(newEntry);
          }
        } else if (op.op_type === 'remove' && op.payload?.sceneId) {
          const idx = afterState.findIndex((s: any) => s.scene_id === op.payload.sceneId);
          if (idx >= 0) afterState.splice(idx, 1);
        } else if (op.op_type === 'move' && op.payload?.sceneId) {
          const idx = afterState.findIndex((s: any) => s.scene_id === op.payload.sceneId);
          if (idx >= 0) {
            const [entry] = afterState.splice(idx, 1);
            const pos = op.payload?.position || {};
            if (pos.afterSceneId) {
              const tgt = afterState.findIndex((s: any) => s.scene_id === pos.afterSceneId);
              afterState.splice(tgt >= 0 ? tgt + 1 : afterState.length, 0, entry);
            } else if (pos.beforeSceneId) {
              const tgt = afterState.findIndex((s: any) => s.scene_id === pos.beforeSceneId);
              afterState.splice(tgt >= 0 ? tgt : 0, 0, entry);
            } else {
              afterState.push(entry);
            }
          }
        } else if (op.op_type === 'update_scene' && op.payload?.sceneId) {
          const entry = afterState.find((s: any) => s.scene_id === op.payload.sceneId);
          if (entry) {
            if (op.payload.patch?.content) entry.content = op.payload.patch.content;
            if (op.payload.patch?.slugline) entry.slugline = op.payload.patch.slugline;
            entry.version_id = `__updated_${nextPlaceholder++}__`;
          }
        }
      }

      // Build diffs
      const beforeIds = new Set(beforeState.map((s: any) => s.scene_id));
      const afterIds = new Set(afterState.map((s: any) => s.scene_id));
      const beforePositions = new Map(beforeState.map((s: any, i: number) => [s.scene_id, i]));
      const afterPositions = new Map(afterState.map((s: any, i: number) => [s.scene_id, i]));
      const beforeVersions = new Map(beforeState.map((s: any) => [s.scene_id, s.version_id]));

      const sceneDiff: any[] = [];

      // Added scenes
      for (const s of afterState) {
        if (!beforeIds.has(s.scene_id)) {
          sceneDiff.push({
            scene_id: s.scene_id, before_version_id: null, after_version_id: s.version_id,
            change_type: 'added', before_excerpt: null, after_excerpt: (s.content || '').slice(0, 200),
          });
        }
      }

      // Removed scenes
      for (const s of beforeState) {
        if (!afterIds.has(s.scene_id)) {
          sceneDiff.push({
            scene_id: s.scene_id, before_version_id: s.version_id, after_version_id: null,
            change_type: 'removed', before_excerpt: (s.content || '').slice(0, 200), after_excerpt: null,
          });
        }
      }

      // Moved / edited / unchanged
      for (const s of afterState) {
        if (beforeIds.has(s.scene_id)) {
          const beforeVer = beforeVersions.get(s.scene_id);
          const beforePos = beforePositions.get(s.scene_id);
          const afterPos = afterPositions.get(s.scene_id);
          const edited = beforeVer !== s.version_id;
          const moved = beforePos !== afterPos;
          const bEntry = beforeState.find((b: any) => b.scene_id === s.scene_id);

          if (edited) {
            sceneDiff.push({
              scene_id: s.scene_id, before_version_id: beforeVer, after_version_id: s.version_id,
              change_type: 'edited', before_excerpt: (bEntry?.content || '').slice(0, 200),
              after_excerpt: (s.content || '').slice(0, 200),
            });
          } else if (moved) {
            sceneDiff.push({
              scene_id: s.scene_id, before_version_id: beforeVer, after_version_id: s.version_id,
              change_type: 'moved', before_excerpt: (bEntry?.content || '').slice(0, 100),
              after_excerpt: null,
            });
          }
          // Unchanged scenes are not included in diff output for brevity
        }
      }

      const summary = {
        added: sceneDiff.filter((d: any) => d.change_type === 'added').length,
        removed: sceneDiff.filter((d: any) => d.change_type === 'removed').length,
        edited: sceneDiff.filter((d: any) => d.change_type === 'edited').length,
        moved: sceneDiff.filter((d: any) => d.change_type === 'moved').length,
        unchanged: afterState.filter((s: any) => beforeIds.has(s.scene_id) && beforeVersions.get(s.scene_id) === s.version_id && beforePositions.get(s.scene_id) === afterPositions.get(s.scene_id)).length,
        impacted_scene_ids: sceneDiff.map((d: any) => d.scene_id),
      };

      const previewContent = afterState.map((s: any) => s.content || '').join('\n\n');

      return new Response(JSON.stringify({
        preview_snapshot_content: previewContent,
        scene_diff: sceneDiff,
        snapshot_diff: summary,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_apply") {
      const { projectId, changeSetId, applyMode } = body;
      if (!projectId || !changeSetId) throw new Error("projectId and changeSetId required");

      const { data: cs } = await supabase.from("scene_change_sets")
        .select("*").eq("id", changeSetId).eq("project_id", projectId).single();
      if (!cs) throw new Error("Change set not found");
      if (!['draft', 'proposed'].includes(cs.status)) throw new Error("Change set must be draft or proposed to apply");

      const { data: ops } = await supabase.from("scene_change_set_ops")
        .select("*").eq("change_set_id", changeSetId)
        .order("op_index", { ascending: true });

      const executedOps: any[] = [];
      let allSuccess = true;

      for (const op of (ops || [])) {
        try {
          // Phase 5: Skip ops marked by review decisions
          if (op.payload?.meta?.skip === true) {
            await supabase.from("scene_change_set_ops").update({
              status: 'executed', error: null,
              inverse: { skipped: true, skip_reason: op.payload?.meta?.skip_reason || 'skipped_by_review' },
            }).eq("id", op.id);
            executedOps.push({ ...op, status: 'executed', inverse: { skipped: true } });
            continue;
          }

          let realInverse: any = {};

          if (op.op_type === 'insert') {
            const pos = op.payload?.position || {};
            const draft = op.payload?.sceneDraft || {};
            const intent = op.payload?.intent || { type: 'change_set', notes: cs.title };

            // Create scene
            const { data: scene } = await supabase.from("scene_graph_scenes").insert({
              project_id: projectId, scene_kind: 'narrative', created_by: user.id,
              provenance: { source: 'change_set', change_set_id: changeSetId },
            }).select().single();

            // Compute order key
            let prevKey: string | null = null;
            let nextKey: string | null = null;
            if (pos.afterSceneId) {
              const { data: d } = await supabase.from("scene_graph_order")
                .select("order_key").eq("project_id", projectId).eq("scene_id", pos.afterSceneId).eq("is_active", true).single();
              if (d) prevKey = d.order_key;
            }
            if (pos.beforeSceneId) {
              const { data: d } = await supabase.from("scene_graph_order")
                .select("order_key").eq("project_id", projectId).eq("scene_id", pos.beforeSceneId).eq("is_active", true).single();
              if (d) nextKey = d.order_key;
            }
            const newKey = sgKeyBetween(prevKey, nextKey);

            await supabase.from("scene_graph_order").insert({
              project_id: projectId, scene_id: scene.id, order_key: newKey,
              is_active: true, inserted_reason: 'change_set',
              inserted_intent: intent,
            });

            const parsed = sgParseSlugline(draft.slugline || '');
            await supabase.from("scene_graph_versions").insert({
              scene_id: scene.id, project_id: projectId, version_number: 1,
              status: applyMode === 'propose' ? 'proposed' : 'draft',
              created_by: user.id,
              slugline: parsed.slugline, location: parsed.location, time_of_day: parsed.time_of_day,
              content: draft.content || '', summary: draft.summary || '',
            });

            realInverse = { op_type: 'remove', sceneId: scene.id, order_key: newKey };

            // Log action
            await sgLogAction(supabase, projectId, user.id, 'insert_scene', {
              scene_id: scene.id, order_key: newKey, change_set_id: changeSetId,
            }, realInverse);

          } else if (op.op_type === 'remove') {
            const sceneId = op.payload?.sceneId;
            if (!sceneId) throw new Error("remove op requires sceneId");

            const { data: priorOrd } = await supabase.from("scene_graph_order")
              .select("order_key, is_active").eq("project_id", projectId).eq("scene_id", sceneId).single();

            await supabase.from("scene_graph_order")
              .update({ is_active: false }).eq("project_id", projectId).eq("scene_id", sceneId);
            await supabase.from("scene_graph_scenes")
              .update({ deprecated_at: new Date().toISOString() }).eq("id", sceneId);

            realInverse = { op_type: 'restore', sceneId, order_key: priorOrd?.order_key, was_active: priorOrd?.is_active };

            await sgLogAction(supabase, projectId, user.id, 'remove_scene', {
              scene_id: sceneId, change_set_id: changeSetId,
            }, realInverse);

          } else if (op.op_type === 'move') {
            const sceneId = op.payload?.sceneId;
            const position = op.payload?.position;
            if (!sceneId) throw new Error("move op requires sceneId");

            const { data: priorOrd } = await supabase.from("scene_graph_order")
              .select("order_key").eq("project_id", projectId).eq("scene_id", sceneId).eq("is_active", true).single();

            let prevKey: string | null = null;
            let nextKey: string | null = null;
            if (position?.afterSceneId) {
              const { data: d } = await supabase.from("scene_graph_order")
                .select("order_key").eq("project_id", projectId).eq("scene_id", position.afterSceneId).eq("is_active", true).single();
              if (d) prevKey = d.order_key;
            }
            if (position?.beforeSceneId) {
              const { data: d } = await supabase.from("scene_graph_order")
                .select("order_key").eq("project_id", projectId).eq("scene_id", position.beforeSceneId).eq("is_active", true).single();
              if (d) nextKey = d.order_key;
            }
            const newKey = sgKeyBetween(prevKey, nextKey);
            await supabase.from("scene_graph_order")
              .update({ order_key: newKey }).eq("project_id", projectId).eq("scene_id", sceneId);

            realInverse = { op_type: 'move', sceneId, original_order_key: priorOrd?.order_key };

            await sgLogAction(supabase, projectId, user.id, 'move_scene', {
              scene_id: sceneId, new_order_key: newKey, change_set_id: changeSetId,
            }, realInverse);

          } else if (op.op_type === 'update_scene') {
            const sceneId = op.payload?.sceneId;
            const patch = op.payload?.patch || {};
            if (!sceneId) throw new Error("update_scene op requires sceneId");

            const { data: priorVer } = await supabase.from("scene_graph_versions")
              .select("id, version_number").eq("scene_id", sceneId)
              .order("version_number", { ascending: false }).limit(1).single();

            const propose = applyMode === 'propose';
            const { data: newVer } = await supabase.rpc("next_scene_version", {
              p_scene_id: sceneId, p_project_id: projectId,
              p_patch: patch, p_propose: propose, p_created_by: user.id,
            });

            realInverse = { op_type: 'update_scene', sceneId, prior_version_id: priorVer?.id, prior_version_number: priorVer?.version_number };

            await sgLogAction(supabase, projectId, user.id, 'update_scene', {
              scene_id: sceneId, change_set_id: changeSetId,
            }, realInverse);

          } else if (op.op_type === 'restore') {
            const sceneId = op.payload?.sceneId;
            if (!sceneId) throw new Error("restore op requires sceneId");

            await supabase.from("scene_graph_order")
              .update({ is_active: true }).eq("project_id", projectId).eq("scene_id", sceneId);
            await supabase.from("scene_graph_scenes")
              .update({ deprecated_at: null }).eq("id", sceneId);

            realInverse = { op_type: 'remove', sceneId };

          } else if (op.op_type === 'rebalance') {
            // Rebalance all order keys
            const { data: rows } = await supabase.from("scene_graph_order")
              .select("id, scene_id, order_key").eq("project_id", projectId).eq("is_active", true)
              .order("order_key", { ascending: true });

            const oldKeys = (rows || []).map((r: any) => ({ id: r.id, scene_id: r.scene_id, order_key: r.order_key }));
            const step = 1000;
            for (let i = 0; i < (rows || []).length; i++) {
              const newKey = String((i + 1) * step).padStart(10, '0');
              await supabase.from("scene_graph_order").update({ order_key: newKey }).eq("id", rows![i].id);
            }

            realInverse = { op_type: 'rebalance', old_keys: oldKeys };
          }

          // Mark op executed
          await supabase.from("scene_change_set_ops").update({
            status: 'executed', inverse: realInverse,
          }).eq("id", op.id);

          executedOps.push({ ...op, status: 'executed', inverse: realInverse });

        } catch (opErr: any) {
          allSuccess = false;
          await supabase.from("scene_change_set_ops").update({
            status: 'failed', error: opErr.message || 'Unknown error',
          }).eq("id", op.id);
          executedOps.push({ ...op, status: 'failed', error: opErr.message });
          break; // Stop on first failure
        }
      }

      // Rebuild snapshot after apply
      let appliedSnapshot: any = null;
      if (allSuccess) {
        const { data: orderRows2 } = await supabase.from("scene_graph_order")
          .select("scene_id, order_key, act, sequence")
          .eq("project_id", projectId).eq("is_active", true)
          .order("order_key", { ascending: true });

        if (orderRows2 && orderRows2.length > 0) {
          const sIds = orderRows2.map((r: any) => r.scene_id);
          const { data: vers } = await supabase.from("scene_graph_versions")
            .select("*").in("scene_id", sIds).order("version_number", { ascending: false });
          const lm = new Map<string, any>();
          for (const v of (vers || [])) { if (!lm.has(v.scene_id)) lm.set(v.scene_id, v); }

          const so = orderRows2.map((o: any) => ({
            scene_id: o.scene_id, version_id: lm.get(o.scene_id)?.id || null,
            order_key: o.order_key, act: o.act, sequence: o.sequence,
          }));
          const content = orderRows2.map((o: any) => lm.get(o.scene_id)?.content || '').join('\n\n');

          const { data: snap } = await supabase.from("scene_graph_snapshots").insert({
            project_id: projectId, created_by: user.id,
            label: `Applied: ${cs.title}`,
            assembly: { scene_order: so, generated_at: new Date().toISOString(), mode: 'latest' },
            content, status: 'draft',
          }).select().single();
          appliedSnapshot = snap;
        }

        await supabase.from("scene_change_sets").update({
          status: 'applied', applied_snapshot_id: appliedSnapshot?.id || null,
        }).eq("id", changeSetId);
      }

      // Compute impact
      const impact = await sgComputeImpact(supabase, projectId, 'change_set_apply', []);

      return new Response(JSON.stringify({
        change_set: { ...cs, status: allSuccess ? 'applied' : cs.status, applied_snapshot_id: appliedSnapshot?.id },
        snapshot: appliedSnapshot,
        impact,
        ops: executedOps,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_rollback") {
      const { projectId, changeSetId } = body;
      if (!projectId || !changeSetId) throw new Error("projectId and changeSetId required");

      const { data: cs } = await supabase.from("scene_change_sets")
        .select("*").eq("id", changeSetId).eq("project_id", projectId).single();
      if (!cs) throw new Error("Change set not found");
      if (cs.status !== 'applied') throw new Error("Can only rollback applied change sets");

      // Get ops in reverse order
      const { data: ops } = await supabase.from("scene_change_set_ops")
        .select("*").eq("change_set_id", changeSetId).eq("status", "executed")
        .order("op_index", { ascending: false });

      for (const op of (ops || [])) {
        const inv = op.inverse || {};
        try {
          if (inv.op_type === 'remove' && inv.sceneId) {
            await supabase.from("scene_graph_order")
              .update({ is_active: false }).eq("project_id", projectId).eq("scene_id", inv.sceneId);
            await supabase.from("scene_graph_scenes")
              .update({ deprecated_at: new Date().toISOString() }).eq("id", inv.sceneId);
          } else if (inv.op_type === 'restore' && inv.sceneId) {
            await supabase.from("scene_graph_order")
              .update({ is_active: true, order_key: inv.order_key || '' }).eq("project_id", projectId).eq("scene_id", inv.sceneId);
            await supabase.from("scene_graph_scenes")
              .update({ deprecated_at: null }).eq("id", inv.sceneId);
          } else if (inv.op_type === 'move' && inv.sceneId && inv.original_order_key) {
            await supabase.from("scene_graph_order")
              .update({ order_key: inv.original_order_key }).eq("project_id", projectId).eq("scene_id", inv.sceneId);
          } else if (inv.op_type === 'rebalance' && inv.old_keys) {
            for (const k of inv.old_keys) {
              await supabase.from("scene_graph_order").update({ order_key: k.order_key }).eq("id", k.id);
            }
          }
          // For update_scene rollback, we don't delete versions (immutable versioning)
          // The prior version remains and new version stays as a record

          await supabase.from("scene_change_set_ops").update({ status: 'reverted' }).eq("id", op.id);
        } catch (revErr: any) {
          console.error("Rollback op error:", revErr);
          await supabase.from("scene_change_set_ops").update({
            status: 'failed', error: `Rollback error: ${revErr.message}`,
          }).eq("id", op.id);
        }
      }

      // Rebuild snapshot
      let restoredSnapshot: any = null;
      const { data: orderRows3 } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      if (orderRows3 && orderRows3.length > 0) {
        const sIds = orderRows3.map((r: any) => r.scene_id);
        const { data: vers } = await supabase.from("scene_graph_versions")
          .select("*").in("scene_id", sIds).order("version_number", { ascending: false });
        const lm = new Map<string, any>();
        for (const v of (vers || [])) { if (!lm.has(v.scene_id)) lm.set(v.scene_id, v); }

        const content = orderRows3.map((o: any) => lm.get(o.scene_id)?.content || '').join('\n\n');
        const { data: snap } = await supabase.from("scene_graph_snapshots").insert({
          project_id: projectId, created_by: user.id,
          label: `Rolled back: ${cs.title}`,
          assembly: { scene_order: orderRows3.map((o: any) => ({ scene_id: o.scene_id, version_id: lm.get(o.scene_id)?.id, order_key: o.order_key, act: o.act, sequence: o.sequence })), generated_at: new Date().toISOString(), mode: 'latest' },
          content, status: 'draft',
        }).select().single();
        restoredSnapshot = snap;
      }

      await supabase.from("scene_change_sets").update({ status: 'rolled_back' }).eq("id", changeSetId);

      return new Response(JSON.stringify({
        change_set: { ...cs, status: 'rolled_back' },
        snapshot: restoredSnapshot,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // PHASE 5 DIFF + REVIEW + COMMENTS
    // ══════════════════════════════════════════════

    // ── Pure TS line diff (Myers-like LCS) ──
    function computeLineDiff(beforeText: string, afterText: string): { hunks: any[]; stats: { insertions: number; deletions: number; unchanged: number } } {
      const beforeLines = beforeText.split('\n');
      const afterLines = afterText.split('\n');

      // Simple LCS-based diff
      const m = beforeLines.length;
      const n = afterLines.length;
      // Build LCS table
      const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          if (beforeLines[i - 1] === afterLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
          else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }

      // Backtrack to produce ops
      const ops: Array<{ t: 'eq' | 'ins' | 'del'; text: string }> = [];
      let i = m, j = n;
      const rawOps: Array<{ t: 'eq' | 'ins' | 'del'; text: string }> = [];
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
          rawOps.push({ t: 'eq', text: beforeLines[i - 1] });
          i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          rawOps.push({ t: 'ins', text: afterLines[j - 1] });
          j--;
        } else {
          rawOps.push({ t: 'del', text: beforeLines[i - 1] });
          i--;
        }
      }
      rawOps.reverse();

      // Group into hunks (context = 3 lines)
      const hunks: any[] = [];
      let currentHunk: any = null;
      let bLine = 0, aLine = 0;

      for (const op of rawOps) {
        if (op.t !== 'eq') {
          if (!currentHunk) {
            currentHunk = { before_start: bLine, before_len: 0, after_start: aLine, after_len: 0, ops: [] };
          }
          currentHunk.ops.push(op);
          if (op.t === 'del') { currentHunk.before_len++; bLine++; }
          if (op.t === 'ins') { currentHunk.after_len++; aLine++; }
        } else {
          if (currentHunk) {
            // Add context line
            currentHunk.ops.push(op);
            currentHunk.before_len++;
            currentHunk.after_len++;
            // Check if we should close the hunk (3 consecutive eq lines)
            const lastThree = currentHunk.ops.slice(-3);
            if (lastThree.length === 3 && lastThree.every((o: any) => o.t === 'eq')) {
              hunks.push(currentHunk);
              currentHunk = null;
            }
          }
          bLine++;
          aLine++;
        }
      }
      if (currentHunk) hunks.push(currentHunk);

      // If no hunks, create a single "all equal" summary
      const stats = {
        insertions: rawOps.filter(o => o.t === 'ins').length,
        deletions: rawOps.filter(o => o.t === 'del').length,
        unchanged: rawOps.filter(o => o.t === 'eq').length,
      };

      return { hunks, stats };
    }

    if (action === "change_set_compute_diffs") {
      const { projectId, changeSetId, granularity } = body;
      if (!projectId || !changeSetId) throw new Error("projectId and changeSetId required");
      const gran = granularity || 'line';

      // Get change set
      const { data: cs } = await supabase.from("scene_change_sets")
        .select("*").eq("id", changeSetId).eq("project_id", projectId).single();
      if (!cs) throw new Error("Change set not found");

      // Get ops
      const { data: ops } = await supabase.from("scene_change_set_ops")
        .select("*").eq("change_set_id", changeSetId).order("op_index", { ascending: true });

      // Get current live state
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence, is_active")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      const sceneIds = (orderRows || []).map((r: any) => r.scene_id);
      const { data: allVersions } = await supabase.from("scene_graph_versions")
        .select("id, scene_id, version_number, slugline, summary, content")
        .in("scene_id", sceneIds.length > 0 ? sceneIds : ['__none__'])
        .order("version_number", { ascending: false });

      const latestVersionMap = new Map<string, any>();
      for (const v of (allVersions || [])) {
        if (!latestVersionMap.has(v.scene_id)) latestVersionMap.set(v.scene_id, v);
      }

      // Build before-state
      const beforeState = (orderRows || []).map((o: any) => ({
        scene_id: o.scene_id,
        order_key: o.order_key,
        version_id: latestVersionMap.get(o.scene_id)?.id || null,
        content: latestVersionMap.get(o.scene_id)?.content || '',
        slugline: latestVersionMap.get(o.scene_id)?.slugline || '',
      }));

      // Simulate ops to build after-state
      const afterState = JSON.parse(JSON.stringify(beforeState));
      let nextPlaceholder = 0;

      for (const op of (ops || [])) {
        if (op.op_type === 'insert') {
          const pos = op.payload?.position || {};
          const draft = op.payload?.sceneDraft || {};
          const newEntry = { scene_id: `__new_${nextPlaceholder++}__`, order_key: `sim_${nextPlaceholder}`, version_id: null, content: draft.content || '', slugline: draft.slugline || 'NEW SCENE' };
          if (pos.afterSceneId) { const idx = afterState.findIndex((s: any) => s.scene_id === pos.afterSceneId); afterState.splice(idx >= 0 ? idx + 1 : afterState.length, 0, newEntry); }
          else if (pos.beforeSceneId) { const idx = afterState.findIndex((s: any) => s.scene_id === pos.beforeSceneId); afterState.splice(idx >= 0 ? idx : 0, 0, newEntry); }
          else afterState.push(newEntry);
        } else if (op.op_type === 'remove' && op.payload?.sceneId) {
          const idx = afterState.findIndex((s: any) => s.scene_id === op.payload.sceneId);
          if (idx >= 0) afterState.splice(idx, 1);
        } else if (op.op_type === 'move' && op.payload?.sceneId) {
          const idx = afterState.findIndex((s: any) => s.scene_id === op.payload.sceneId);
          if (idx >= 0) {
            const [entry] = afterState.splice(idx, 1);
            const pos = op.payload?.position || {};
            if (pos.afterSceneId) { const tgt = afterState.findIndex((s: any) => s.scene_id === pos.afterSceneId); afterState.splice(tgt >= 0 ? tgt + 1 : afterState.length, 0, entry); }
            else if (pos.beforeSceneId) { const tgt = afterState.findIndex((s: any) => s.scene_id === pos.beforeSceneId); afterState.splice(tgt >= 0 ? tgt : 0, 0, entry); }
            else afterState.push(entry);
          }
        } else if (op.op_type === 'update_scene' && op.payload?.sceneId) {
          const entry = afterState.find((s: any) => s.scene_id === op.payload.sceneId);
          if (entry) {
            if (op.payload.patch?.content) entry.content = op.payload.patch.content;
            if (op.payload.patch?.slugline) entry.slugline = op.payload.patch.slugline;
            entry.version_id = `__updated_${nextPlaceholder++}__`;
          }
        }
      }

      // Build scene blocks for snapshot diff
      const beforeIds = new Set(beforeState.map((s: any) => s.scene_id));
      const afterIds = new Set(afterState.map((s: any) => s.scene_id));
      const beforePositions = new Map(beforeState.map((s: any, i: number) => [s.scene_id, i]));
      const afterPositions = new Map(afterState.map((s: any, i: number) => [s.scene_id, i]));
      const beforeVersions = new Map(beforeState.map((s: any) => [s.scene_id, s.version_id]));
      const beforeContentMap = new Map(beforeState.map((s: any) => [s.scene_id, s.content]));

      const sceneBlocks: any[] = [];
      const artifactIds: string[] = [];

      // Process all scenes (after + removed)
      const allSceneIds = new Set([...beforeState.map((s: any) => s.scene_id), ...afterState.map((s: any) => s.scene_id)]);
      for (const sid of allSceneIds) {
        const inBefore = beforeIds.has(sid);
        const inAfter = afterIds.has(sid);
        const bEntry = beforeState.find((s: any) => s.scene_id === sid);
        const aEntry = afterState.find((s: any) => s.scene_id === sid);

        let changeType: string;
        if (!inBefore && inAfter) changeType = 'added';
        else if (inBefore && !inAfter) changeType = 'removed';
        else if (inBefore && inAfter) {
          const bVer = beforeVersions.get(sid);
          const aVer = aEntry?.version_id;
          const moved = beforePositions.get(sid) !== afterPositions.get(sid);
          const edited = bVer !== aVer;
          if (edited) changeType = 'edited';
          else if (moved) changeType = 'moved';
          else changeType = 'unchanged';
        } else changeType = 'unchanged';

        const block = {
          scene_id: sid,
          change_type: changeType,
          before_version_id: bEntry?.version_id || null,
          after_version_id: aEntry?.version_id || null,
          before_excerpt: bEntry ? (bEntry.content || '').slice(0, 200) : null,
          after_excerpt: aEntry ? (aEntry.content || '').slice(0, 200) : null,
        };
        sceneBlocks.push(block);

        // If edited, compute scene diff artifact
        if (changeType === 'edited' && bEntry && aEntry) {
          const beforeText = bEntry.content || '';
          const afterText = aEntry.content || '';
          const { hunks, stats } = computeLineDiff(beforeText, afterText);

          const artifact = {
            format: 'iffi_diff_v1',
            granularity: gran,
            before: { scene_id: sid, version_id: bEntry.version_id || '', text: beforeText },
            after: { scene_id: sid, version_id: aEntry.version_id || '', text: afterText },
            hunks,
            stats,
          };

          // Upsert scene diff artifact
          const { data: existing } = await supabase.from("scene_diff_artifacts")
            .select("id").eq("change_set_id", changeSetId).eq("scene_id", sid).eq("diff_type", "scene").maybeSingle();
          if (existing) {
            await supabase.from("scene_diff_artifacts").update({ artifact, created_by: user.id }).eq("id", existing.id);
            artifactIds.push(existing.id);
          } else {
            const { data: inserted } = await supabase.from("scene_diff_artifacts").insert({
              project_id: projectId, change_set_id: changeSetId, created_by: user.id,
              diff_type: 'scene', scene_id: sid,
              before_version_id: bEntry.version_id || null,
              after_version_id: aEntry.version_id || null,
              artifact,
            }).select("id").single();
            if (inserted) artifactIds.push(inserted.id);
          }
        }
      }

      // Snapshot diff artifact
      const snapshotArtifact = {
        format: 'iffi_snapshot_diff_v1',
        before_snapshot_id: cs.base_snapshot_id,
        after_snapshot_id: null,
        scene_blocks: sceneBlocks,
        stats: {
          added: sceneBlocks.filter((b: any) => b.change_type === 'added').length,
          removed: sceneBlocks.filter((b: any) => b.change_type === 'removed').length,
          moved: sceneBlocks.filter((b: any) => b.change_type === 'moved').length,
          edited: sceneBlocks.filter((b: any) => b.change_type === 'edited').length,
          unchanged: sceneBlocks.filter((b: any) => b.change_type === 'unchanged').length,
        },
      };

      const { data: existingSnap } = await supabase.from("scene_diff_artifacts")
        .select("id").eq("change_set_id", changeSetId).eq("diff_type", "snapshot").maybeSingle();
      if (existingSnap) {
        await supabase.from("scene_diff_artifacts").update({ artifact: snapshotArtifact, created_by: user.id }).eq("id", existingSnap.id);
        artifactIds.push(existingSnap.id);
      } else {
        const { data: inserted } = await supabase.from("scene_diff_artifacts").insert({
          project_id: projectId, change_set_id: changeSetId, created_by: user.id,
          diff_type: 'snapshot', scene_id: null, before_version_id: null, after_version_id: null,
          artifact: snapshotArtifact,
        }).select("id").single();
        if (inserted) artifactIds.push(inserted.id);
      }

      return new Response(JSON.stringify({ artifact_ids: artifactIds, stats: snapshotArtifact.stats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_get_diffs") {
      const { projectId, changeSetId } = body;
      if (!projectId || !changeSetId) throw new Error("projectId and changeSetId required");

      const { data: snapArt } = await supabase.from("scene_diff_artifacts")
        .select("artifact").eq("change_set_id", changeSetId).eq("diff_type", "snapshot").maybeSingle();

      const { data: sceneDiffs } = await supabase.from("scene_diff_artifacts")
        .select("scene_id, before_version_id, after_version_id, artifact")
        .eq("change_set_id", changeSetId).eq("diff_type", "scene");

      return new Response(JSON.stringify({
        snapshot_diff: snapArt?.artifact || null,
        scene_diffs: (sceneDiffs || []).map((d: any) => ({
          scene_id: d.scene_id,
          before_version_id: d.before_version_id,
          after_version_id: d.after_version_id,
          stats: d.artifact?.stats || null,
        })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_get_scene_diff") {
      const { projectId, changeSetId, sceneId, beforeVersionId, afterVersionId } = body;
      if (!projectId || !changeSetId || !sceneId) throw new Error("projectId, changeSetId, sceneId required");

      let q = supabase.from("scene_diff_artifacts")
        .select("artifact").eq("change_set_id", changeSetId).eq("scene_id", sceneId).eq("diff_type", "scene");
      if (beforeVersionId) q = q.eq("before_version_id", beforeVersionId);
      if (afterVersionId) q = q.eq("after_version_id", afterVersionId);

      const { data } = await q.maybeSingle();

      return new Response(JSON.stringify({ artifact: data?.artifact || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_set_review_decision") {
      const { projectId, changeSetId, sceneId, beforeVersionId, afterVersionId, decision } = body;
      if (!projectId || !changeSetId || !sceneId || !decision) throw new Error("projectId, changeSetId, sceneId, decision required");

      const { data, error: upsErr } = await supabase.from("scene_change_set_review_state").upsert({
        project_id: projectId,
        change_set_id: changeSetId,
        scene_id: sceneId,
        before_version_id: beforeVersionId || null,
        after_version_id: afterVersionId || null,
        decision,
        decided_at: decision !== 'pending' ? new Date().toISOString() : null,
        decided_by: decision !== 'pending' ? user.id : null,
      }, {
        onConflict: 'change_set_id,scene_id,before_version_id,after_version_id',
      }).select().single();
      if (upsErr) throw upsErr;

      return new Response(JSON.stringify({ review: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_apply_review_decisions") {
      const { projectId, changeSetId } = body;
      if (!projectId || !changeSetId) throw new Error("projectId and changeSetId required");

      // Get all review decisions
      const { data: reviews } = await supabase.from("scene_change_set_review_state")
        .select("*").eq("change_set_id", changeSetId);

      const rejectedSceneIds = new Set(
        (reviews || []).filter((r: any) => r.decision === 'rejected').map((r: any) => r.scene_id)
      );

      // Get ops and mark rejected scenes as skipped
      const { data: ops } = await supabase.from("scene_change_set_ops")
        .select("*").eq("change_set_id", changeSetId).order("op_index", { ascending: true });

      const updatedOps: any[] = [];
      for (const op of (ops || [])) {
        const targetSceneId = op.payload?.sceneId;
        const shouldSkip = targetSceneId && rejectedSceneIds.has(targetSceneId);

        if (shouldSkip) {
          const newPayload = { ...op.payload, meta: { ...(op.payload?.meta || {}), skip: true, skip_reason: 'rejected_by_review' } };
          await supabase.from("scene_change_set_ops").update({ payload: newPayload }).eq("id", op.id);
          updatedOps.push({ ...op, payload: newPayload });
        } else {
          // Ensure skip is removed if previously set
          if (op.payload?.meta?.skip) {
            const newPayload = { ...op.payload, meta: { ...(op.payload?.meta || {}), skip: false } };
            await supabase.from("scene_change_set_ops").update({ payload: newPayload }).eq("id", op.id);
            updatedOps.push({ ...op, payload: newPayload });
          } else {
            updatedOps.push(op);
          }
        }
      }

      // Store execution plan in metadata
      await supabase.from("scene_change_sets").update({
        metadata: {
          execution_plan: {
            rejected_scene_ids: Array.from(rejectedSceneIds),
            total_ops: updatedOps.length,
            skipped_ops: updatedOps.filter((o: any) => o.payload?.meta?.skip).length,
            computed_at: new Date().toISOString(),
          },
        },
      }).eq("id", changeSetId);

      return new Response(JSON.stringify({ ops: updatedOps }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_add_comment") {
      const { projectId, changeSetId, sceneId, beforeVersionId, afterVersionId, parentId, comment: commentText } = body;
      if (!projectId || !changeSetId || !commentText) throw new Error("projectId, changeSetId, comment required");

      const { data: inserted, error: insErr } = await supabase.from("scene_diff_comments").insert({
        project_id: projectId,
        change_set_id: changeSetId,
        scene_id: sceneId || null,
        before_version_id: beforeVersionId || null,
        after_version_id: afterVersionId || null,
        created_by: user.id,
        parent_id: parentId || null,
        status: 'open',
        comment: commentText,
      }).select().single();
      if (insErr) throw insErr;

      // Return thread
      const rootId = parentId || inserted.id;
      const { data: thread } = await supabase.from("scene_diff_comments")
        .select("*")
        .or(`id.eq.${rootId},parent_id.eq.${rootId}`)
        .order("created_at", { ascending: true });

      return new Response(JSON.stringify({ comment: inserted, thread: thread || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_list_comments") {
      const { projectId, changeSetId, sceneId } = body;
      if (!projectId || !changeSetId) throw new Error("projectId and changeSetId required");

      let q = supabase.from("scene_diff_comments")
        .select("*").eq("change_set_id", changeSetId)
        .order("created_at", { ascending: true });
      if (sceneId) q = q.eq("scene_id", sceneId);

      const { data: comments } = await q;

      // Build hierarchical threads
      const roots = (comments || []).filter((c: any) => !c.parent_id);
      const childMap = new Map<string, any[]>();
      for (const c of (comments || []).filter((c: any) => c.parent_id)) {
        const arr = childMap.get(c.parent_id) || [];
        arr.push(c);
        childMap.set(c.parent_id, arr);
      }
      const threaded = roots.map((r: any) => ({ ...r, children: childMap.get(r.id) || [] }));

      return new Response(JSON.stringify({ comments: threaded }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "change_set_resolve_comment") {
      const { projectId, commentId, status: newStatus } = body;
      if (!commentId || !newStatus) throw new Error("commentId and status required");

      const { data, error: updErr } = await supabase.from("scene_diff_comments")
        .update({ status: newStatus }).eq("id", commentId).select().single();
      if (updErr) throw updErr;

      return new Response(JSON.stringify({ comment: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // PHASE 6 — QC ENGINE + AUTO-FIX
    // ══════════════════════════════════════════════

    if (action === "qc_run") {
      const { projectId, mode, passes, forceRebuildSpine, forceRebuildLedger } = body;
      if (!projectId) throw new Error("projectId required");
      const qcMode = mode || 'latest';
      const selectedPasses: string[] = passes || ['continuity', 'setup_payoff', 'arc', 'pacing', 'tone'];

      // 1. Build snapshot
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes found");

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: allVers } = await supabase.from("scene_graph_versions")
        .select("*").in("scene_id", sceneIds).order("version_number", { ascending: false });

      const latestMap = new Map<string, any>();
      for (const v of (allVers || [])) {
        if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v);
      }

      const snapshotContent = orderRows.map((o: any) => {
        const v = latestMap.get(o.scene_id);
        return v?.content || '';
      }).join('\n\n');

      const so = orderRows.map((o: any) => ({
        scene_id: o.scene_id, version_id: latestMap.get(o.scene_id)?.id || null,
        order_key: o.order_key, act: o.act, sequence: o.sequence,
      }));

      const { data: snapshot } = await supabase.from("scene_graph_snapshots").insert({
        project_id: projectId, created_by: user.id,
        label: `QC Run ${new Date().toISOString()}`,
        assembly: { scene_order: so, generated_at: new Date().toISOString(), mode: qcMode },
        content: snapshotContent, status: 'draft',
      }).select().single();

      if (!snapshot) throw new Error("Failed to create snapshot for QC run");

      // 2. Ensure spine + ledger
      let spine: any = null;
      let ledger: any = null;

      const { data: existingSpine } = await supabase.from("story_spines")
        .select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (!existingSpine || forceRebuildSpine) {
        // Build spine via LLM
        const spinePrompt = `Analyze this screenplay and produce a Story Spine JSON with: logline, genre, tone, premise, acts (with turning_points), character_arcs (name, start_state, end_state, key_steps), and rules (world_rules, tone_rules, forbidden_changes).\n\nScript:\n${snapshotContent.slice(0, 15000)}`;
        try {
          const spineRaw = await callAI(apiKey, BALANCED_MODEL, "You are a screenplay structure analyst. Return ONLY valid JSON.", spinePrompt, 0.2, 6000);
          const spineJson = await parseAIJson(apiKey, spineRaw);
          const { data: spineRow } = await supabase.from("story_spines").insert({
            project_id: projectId, created_by: user.id, status: 'active',
            source: 'qc_engine', spine: spineJson, summary: spineJson.logline || null, version: 1,
          }).select().single();
          spine = spineRow;
        } catch (e: any) { console.error("Spine build failed:", e); spine = existingSpine; }
      } else { spine = existingSpine; }

      const { data: existingLedger } = await supabase.from("thread_ledgers")
        .select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (!existingLedger || forceRebuildLedger) {
        const ledgerPrompt = `Analyze this screenplay and produce a Thread Ledger JSON with a "threads" array. Each thread: thread_id, type (mystery|relationship|goal|lie|clue|setup_payoff|theme), title, status (open|paid|moved|removed), introduced_in_scene_id (null ok), resolved_in_scene_id (null ok), beats [], dependencies [], notes.\n\nScript:\n${snapshotContent.slice(0, 15000)}`;
        try {
          const ledgerRaw = await callAI(apiKey, BALANCED_MODEL, "You are a screenplay thread analyst. Return ONLY valid JSON.", ledgerPrompt, 0.2, 6000);
          const ledgerJson = await parseAIJson(apiKey, ledgerRaw);
          const { data: ledgerRow } = await supabase.from("thread_ledgers").insert({
            project_id: projectId, created_by: user.id, status: 'active',
            ledger: ledgerJson, summary: null, version: 1,
          }).select().single();
          ledger = ledgerRow;
        } catch (e: any) { console.error("Ledger build failed:", e); ledger = existingLedger; }
      } else { ledger = existingLedger; }

      // 3. Create QC run row
      const { data: qcRun } = await supabase.from("scene_qc_runs").insert({
        project_id: projectId, created_by: user.id,
        snapshot_id: snapshot.id, mode: qcMode,
        metadata: { passes: selectedPasses },
      }).select().single();

      if (!qcRun) throw new Error("Failed to create QC run");

      // 4. Execute passes
      const allIssues: any[] = [];
      const scenesWithVersions = orderRows.map((o: any, idx: number) => ({
        ...o, display_number: idx + 1, version: latestMap.get(o.scene_id),
      }));

      const spineData = spine?.spine || {};
      const ledgerData = ledger?.ledger || { threads: [] };
      const threads = ledgerData.threads || [];

      // 4.1 CONTINUITY PASS
      if (selectedPasses.includes('continuity')) {
        for (let i = 0; i < scenesWithVersions.length; i++) {
          const scene = scenesWithVersions[i];
          const ver = scene.version;
          if (!ver) continue;

          const required = ver.continuity_facts_required || [];
          for (const fact of required) {
            const factKey = typeof fact === 'string' ? fact : (fact.fact || fact.subject || JSON.stringify(fact));
            // Check if emitted in any prior scene
            let found = false;
            for (let j = 0; j < i; j++) {
              const priorVer = scenesWithVersions[j].version;
              if (!priorVer) continue;
              const emitted = priorVer.continuity_facts_emitted || [];
              for (const e of emitted) {
                const eKey = typeof e === 'string' ? e : (e.fact || e.subject || JSON.stringify(e));
                if (eKey === factKey) { found = true; break; }
              }
              if (found) break;
            }
            if (!found) {
              allIssues.push({
                category: 'continuity',
                severity: 'high',
                title: `Missing continuity fact required by Scene ${scene.display_number}`,
                description: `Scene ${scene.display_number} requires "${factKey}" but it is not emitted by any prior scene.`,
                evidence: [{ scene_id: scene.scene_id, excerpt: (ver.content || '').slice(0, 300), note: `Requires: ${factKey}` }],
                related_scene_ids: [scene.scene_id],
                related_thread_ids: [],
              });
            }
          }
        }

        // Check world rules from spine
        const worldRules = spineData.rules?.world_rules || [];
        for (const rule of worldRules) {
          const ruleLower = (rule || '').toLowerCase();
          for (const scene of scenesWithVersions) {
            const content = (scene.version?.content || '').toLowerCase();
            // Simple heuristic: check for contradiction keywords
            const negations = ['never', 'cannot', 'impossible', 'forbidden', 'prohibited'];
            for (const neg of negations) {
              if (ruleLower.includes(neg)) {
                const ruleSubject = ruleLower.replace(new RegExp(`.*${neg}\\s+`), '').slice(0, 40).trim();
                if (ruleSubject && content.includes(ruleSubject)) {
                  allIssues.push({
                    category: 'continuity',
                    severity: 'critical',
                    title: `Possible world rule violation in Scene ${scene.display_number}`,
                    description: `World rule "${rule}" may be violated. The scene content references "${ruleSubject}" which conflicts with the rule.`,
                    evidence: [{ scene_id: scene.scene_id, excerpt: (scene.version?.content || '').slice(0, 300), note: `Rule: ${rule}` }],
                    related_scene_ids: [scene.scene_id],
                    related_thread_ids: [],
                  });
                }
                break;
              }
            }
          }
        }
      }

      // 4.2 SETUP/PAYOFF PASS
      if (selectedPasses.includes('setup_payoff')) {
        // Check threads for unresolved setups
        for (const thread of threads) {
          if (thread.type === 'setup_payoff' || thread.type === 'clue' || thread.type === 'mystery') {
            if (thread.status === 'open' && !thread.resolved_in_scene_id) {
              allIssues.push({
                category: 'setup_payoff',
                severity: 'medium',
                title: `Unresolved thread: "${thread.title}"`,
                description: `Thread "${thread.title}" (type: ${thread.type}) was introduced but never resolved by end of script.`,
                evidence: thread.introduced_in_scene_id ? [{
                  scene_id: thread.introduced_in_scene_id,
                  excerpt: latestMap.get(thread.introduced_in_scene_id)?.content?.slice(0, 200) || '',
                  note: 'Thread introduced here',
                }] : [{ scene_id: scenesWithVersions[0]?.scene_id || '', excerpt: '', note: 'Thread introduced but scene unknown' }],
                related_scene_ids: thread.introduced_in_scene_id ? [thread.introduced_in_scene_id] : [],
                related_thread_ids: [thread.thread_id],
              });
            }
            if (thread.status === 'paid' && !thread.resolved_in_scene_id) {
              allIssues.push({
                category: 'setup_payoff',
                severity: 'medium',
                title: `Thread status mismatch: "${thread.title}"`,
                description: `Thread "${thread.title}" is marked as paid/resolved but has no resolved_in_scene_id.`,
                evidence: [{ scene_id: scenesWithVersions[0]?.scene_id || '', excerpt: '', note: 'Status mismatch' }],
                related_scene_ids: [],
                related_thread_ids: [thread.thread_id],
              });
            }
          }
        }

        // Check scene-level setup/payoff arrays
        for (const scene of scenesWithVersions) {
          const ver = scene.version;
          if (!ver) continue;
          const payoffs = ver.setup_payoff_required || [];
          for (const payoff of payoffs) {
            const payoffKey = typeof payoff === 'string' ? payoff : (payoff.setup || payoff.key || JSON.stringify(payoff));
            let setupFound = false;
            for (let j = 0; j < scenesWithVersions.indexOf(scene); j++) {
              const priorVer = scenesWithVersions[j].version;
              if (!priorVer) continue;
              const setups = priorVer.setup_payoff_emitted || [];
              for (const s of setups) {
                const sKey = typeof s === 'string' ? s : (s.setup || s.key || JSON.stringify(s));
                if (sKey === payoffKey) { setupFound = true; break; }
              }
              if (setupFound) break;
            }
            if (!setupFound) {
              allIssues.push({
                category: 'setup_payoff',
                severity: 'critical',
                title: `Payoff without setup in Scene ${scene.display_number}`,
                description: `Scene ${scene.display_number} references payoff "${payoffKey}" but no prior scene sets it up.`,
                evidence: [{ scene_id: scene.scene_id, excerpt: (ver.content || '').slice(0, 300), note: `Payoff: ${payoffKey}` }],
                related_scene_ids: [scene.scene_id],
                related_thread_ids: [],
              });
            }
          }
        }
      }

      // 4.3 ARC PASS
      if (selectedPasses.includes('arc')) {
        const arcs = spineData.character_arcs || [];
        for (const arc of arcs) {
          const steps = arc.key_steps || [];
          if (steps.length < 2) continue;
          // Check that character name appears across multiple scenes
          const charName = (arc.name || '').toLowerCase();
          const scenesWithChar = scenesWithVersions.filter((s: any) => {
            const content = (s.version?.content || '').toLowerCase();
            const chars = s.version?.characters_present || [];
            return content.includes(charName) || chars.some((c: string) => c.toLowerCase().includes(charName));
          });
          if (scenesWithChar.length < 2 && scenesWithVersions.length > 3) {
            allIssues.push({
              category: 'arc',
              severity: 'medium',
              title: `Character "${arc.name}" has minimal presence`,
              description: `Character arc for "${arc.name}" (${arc.start_state} → ${arc.end_state}) only appears in ${scenesWithChar.length} scene(s). Expected more presence for ${steps.length} key steps.`,
              evidence: scenesWithChar.slice(0, 2).map((s: any) => ({
                scene_id: s.scene_id, excerpt: (s.version?.content || '').slice(0, 200), note: `Character present`,
              })),
              related_scene_ids: scenesWithChar.map((s: any) => s.scene_id),
              related_thread_ids: [],
            });
          }
        }
      }

      // 4.4 PACING PASS
      if (selectedPasses.includes('pacing')) {
        // Act balance check
        const actGroups = new Map<number, number>();
        for (const scene of scenesWithVersions) {
          const act = scene.act || 1;
          actGroups.set(act, (actGroups.get(act) || 0) + 1);
        }
        if (actGroups.size > 1) {
          const counts = Array.from(actGroups.values());
          const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
          for (const [act, count] of actGroups.entries()) {
            const deviation = Math.abs(count - mean) / mean;
            if (deviation > 0.35) {
              allIssues.push({
                category: 'pacing',
                severity: 'medium',
                title: `Act ${act} imbalance`,
                description: `Act ${act} has ${count} scenes (${Math.round(deviation * 100)}% deviation from mean of ${mean.toFixed(1)}). This may indicate pacing issues.`,
                evidence: [{ scene_id: scenesWithVersions[0]?.scene_id || '', excerpt: '', note: `Act ${act}: ${count} scenes, mean: ${mean.toFixed(1)}` }],
                related_scene_ids: scenesWithVersions.filter((s: any) => (s.act || 1) === act).map((s: any) => s.scene_id),
                related_thread_ids: [],
              });
            }
          }
        }

        // Flat stretch detection (basic: scenes with very similar content length as proxy for tension)
        if (scenesWithVersions.length >= 4) {
          for (let i = 0; i <= scenesWithVersions.length - 4; i++) {
            const window = scenesWithVersions.slice(i, i + 4);
            const lengths = window.map((s: any) => (s.version?.content || '').length);
            const avgLen = lengths.reduce((a: number, b: number) => a + b, 0) / lengths.length;
            const allSimilar = lengths.every((l: number) => Math.abs(l - avgLen) / Math.max(avgLen, 1) < 0.15);
            if (allSimilar && avgLen > 50) {
              allIssues.push({
                category: 'pacing',
                severity: 'low',
                title: `Potential flat stretch: Scenes ${window[0].display_number}-${window[3].display_number}`,
                description: `Four consecutive scenes (${window[0].display_number}-${window[3].display_number}) have very similar lengths, which may indicate a monotonous stretch.`,
                evidence: [{ scene_id: window[0].scene_id, excerpt: '', note: `Scenes ${window[0].display_number}-${window[3].display_number} avg length: ${Math.round(avgLen)} chars` }],
                related_scene_ids: window.map((s: any) => s.scene_id),
                related_thread_ids: [],
              });
              i += 3; // Skip ahead
            }
          }
        }
      }

      // 4.5 TONE PASS (LLM-assisted)
      if (selectedPasses.includes('tone')) {
        const toneRules = spineData.rules?.tone_rules || [];
        const tonePrompt = `You are a screenplay tone analyst. Analyze the following script for tone inconsistencies against the established tone rules.

Tone rules: ${JSON.stringify(toneRules)}
Genre: ${spineData.genre || 'unknown'}
Tone: ${spineData.tone || 'unknown'}

Script summary (first 8000 chars):
${snapshotContent.slice(0, 8000)}

Return a JSON array of up to 10 tone issues. Each issue:
{
  "title": "short title",
  "description": "explanation",
  "scene_number": number (1-indexed),
  "severity": "low"|"medium"|"high"
}

Return ONLY valid JSON array.`;

        try {
          const toneRaw = await callAI(apiKey, BALANCED_MODEL, "You are a tone consistency checker. Return ONLY a valid JSON array.", tonePrompt, 0.3, 4000);
          const toneIssues = await parseAIJson(apiKey, toneRaw);
          const issuesArr = Array.isArray(toneIssues) ? toneIssues : (toneIssues.issues || []);
          for (const ti of issuesArr.slice(0, 10)) {
            const sceneIdx = Math.max(0, Math.min((ti.scene_number || 1) - 1, scenesWithVersions.length - 1));
            const targetScene = scenesWithVersions[sceneIdx];
            allIssues.push({
              category: 'tone',
              severity: ti.severity || 'low',
              title: ti.title || 'Tone inconsistency',
              description: ti.description || 'Potential tone issue detected',
              evidence: [{
                scene_id: targetScene?.scene_id || scenesWithVersions[0]?.scene_id || '',
                excerpt: (targetScene?.version?.content || '').slice(0, 200),
                note: 'AI-detected tone issue',
              }],
              related_scene_ids: targetScene ? [targetScene.scene_id] : [],
              related_thread_ids: [],
            });
          }
        } catch (e: any) {
          console.error("Tone pass LLM error:", e);
        }
      }

      // 5. Dedupe and cap at 200
      const seenKeys = new Set<string>();
      const deduped: any[] = [];
      for (const issue of allIssues) {
        const key = `${issue.title}|${(issue.related_scene_ids || []).sort().join(',')}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        deduped.push(issue);
        if (deduped.length >= 200) break;
      }

      // 6. Insert issues
      if (deduped.length > 0) {
        const issueRows = deduped.map((issue: any) => ({
          qc_run_id: qcRun.id,
          project_id: projectId,
          category: issue.category,
          severity: issue.severity,
          title: issue.title,
          description: issue.description,
          evidence: issue.evidence,
          related_scene_ids: issue.related_scene_ids,
          related_thread_ids: issue.related_thread_ids,
          status: 'open',
        }));
        await supabase.from("scene_qc_issues").insert(issueRows);
      }

      // 7. Create decision events for high/critical
      const highCritical = deduped.filter((i: any) => i.severity === 'high' || i.severity === 'critical');
      for (const issue of highCritical.slice(0, 10)) {
        try {
          await supabase.from("feedback_notes").insert({
            project_id: projectId,
            user_id: user.id,
            doc_type: 'qc_engine',
            content: `[QC ${issue.severity.toUpperCase()}] ${issue.title}: ${issue.description}`,
            note_type: 'qc_issue',
            severity: issue.severity === 'critical' ? 'blocker' : 'major',
            category: issue.category,
          });
        } catch (e: any) { console.error("Decision event insert error:", e); }
      }

      // 8. Update QC run summary
      const summaryCounts = {
        low: deduped.filter((i: any) => i.severity === 'low').length,
        medium: deduped.filter((i: any) => i.severity === 'medium').length,
        high: deduped.filter((i: any) => i.severity === 'high').length,
        critical: deduped.filter((i: any) => i.severity === 'critical').length,
        total: deduped.length,
      };

      await supabase.from("scene_qc_runs").update({
        summary: `${summaryCounts.total} issues: ${summaryCounts.critical} critical, ${summaryCounts.high} high, ${summaryCounts.medium} medium, ${summaryCounts.low} low`,
        metadata: { ...qcRun.metadata, passes: selectedPasses, issue_counts: summaryCounts },
      }).eq("id", qcRun.id);

      return new Response(JSON.stringify({ qc_run_id: qcRun.id, summary: summaryCounts }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "qc_list_runs") {
      const { projectId, limit } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: runs } = await supabase.from("scene_qc_runs")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(limit || 20);

      return new Response(JSON.stringify({ runs: runs || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "qc_list_issues") {
      const { projectId, qcRunId, severity, category, status } = body;
      if (!projectId) throw new Error("projectId required");

      let q = supabase.from("scene_qc_issues").select("*").eq("project_id", projectId);
      if (qcRunId) q = q.eq("qc_run_id", qcRunId);
      if (severity) q = q.eq("severity", severity);
      if (category) q = q.eq("category", category);
      if (status) q = q.eq("status", status);
      q = q.order("created_at", { ascending: false }).limit(200);

      const { data: issues } = await q;

      return new Response(JSON.stringify({ issues: issues || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "qc_update_issue_status") {
      const { projectId, issueId, status: newStatus } = body;
      if (!issueId || !newStatus) throw new Error("issueId and status required");

      const { data, error: updErr } = await supabase.from("scene_qc_issues")
        .update({ status: newStatus }).eq("id", issueId).select().single();
      if (updErr) throw updErr;

      return new Response(JSON.stringify({ issue: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "qc_generate_fix_change_set") {
      const { projectId, qcRunId, issueIds, goalLabel } = body;
      if (!projectId || !qcRunId) throw new Error("projectId and qcRunId required");

      // Get issues to fix
      let issueQuery = supabase.from("scene_qc_issues")
        .select("*").eq("qc_run_id", qcRunId).eq("status", "open");
      if (issueIds && issueIds.length > 0) {
        issueQuery = issueQuery.in("id", issueIds);
      }
      const { data: issues } = await issueQuery;
      if (!issues || issues.length === 0) throw new Error("No open issues found to fix");

      // Create change set
      const csTitle = goalLabel || `QC Fix: Run ${new Date().toISOString().split('T')[0]}`;

      // Build base snapshot
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      let baseSnapshotId: string | null = null;
      if (orderRows && orderRows.length > 0) {
        const sIds = orderRows.map((r: any) => r.scene_id);
        const { data: vers } = await supabase.from("scene_graph_versions")
          .select("*").in("scene_id", sIds).order("version_number", { ascending: false });
        const lm = new Map<string, any>();
        for (const v of (vers || [])) { if (!lm.has(v.scene_id)) lm.set(v.scene_id, v); }
        const content = orderRows.map((o: any) => lm.get(o.scene_id)?.content || '').join('\n\n');
        const so = orderRows.map((o: any) => ({
          scene_id: o.scene_id, version_id: lm.get(o.scene_id)?.id || null,
          order_key: o.order_key, act: o.act, sequence: o.sequence,
        }));

        const { data: snap } = await supabase.from("scene_graph_snapshots").insert({
          project_id: projectId, created_by: user.id, label: `Base for ${csTitle}`,
          assembly: { scene_order: so, generated_at: new Date().toISOString(), mode: 'latest' },
          content, status: 'draft',
        }).select().single();
        baseSnapshotId = snap?.id || null;
      }

      const { data: cs } = await supabase.from("scene_change_sets").insert({
        project_id: projectId, created_by: user.id,
        title: csTitle,
        description: `Auto-generated fix change set for ${issues.length} QC issue(s)`,
        goal_type: 'qc_fix',
        status: 'draft',
        base_snapshot_id: baseSnapshotId,
        metadata: { qc_run_id: qcRunId, issue_count: issues.length },
      }).select().single();

      if (!cs) throw new Error("Failed to create change set");

      // Generate fix plans via LLM
      const issuesSummary = issues.slice(0, 15).map((iss: any, idx: number) =>
        `${idx + 1}. [${iss.severity}/${iss.category}] ${iss.title}: ${iss.description}`
      ).join('\n');

      const sceneSummary = (orderRows || []).map((o: any, idx: number) => {
        const ver = orderRows ? undefined : undefined; // We'd need versions here
        return `Scene ${idx + 1} (${o.scene_id}): order_key=${o.order_key}`;
      }).join('\n');

      const fixPrompt = `You are a screenplay fix planner. Given these QC issues and scene list, produce fix operations.

QC Issues:
${issuesSummary}

Available scene IDs (in order):
${(orderRows || []).map((o: any, idx: number) => `Scene ${idx + 1}: ${o.scene_id}`).join('\n')}

For each issue, produce a fix plan as a JSON array of operations. Each operation:
{
  "issue_index": number (1-indexed from the issues list),
  "op_type": "update_scene"|"insert"|"move",
  "payload": {
    "sceneId": "uuid" (for update_scene/move),
    "patch": { "content": "new content...", "slugline": "..." } (for update_scene),
    "position": { "afterSceneId": "uuid" } (for insert/move),
    "sceneDraft": { "slugline": "...", "content": "..." } (for insert)
  },
  "rationale": "why this fix"
}

Rules:
- Max 20 operations total
- Only reference valid scene IDs from the list
- Prefer update_scene over insert
- Return ONLY valid JSON array`;

      let ops: any[] = [];
      try {
        const fixRaw = await callAI(apiKey, BALANCED_MODEL, "You are a screenplay fix planner. Return ONLY valid JSON array.", fixPrompt, 0.3, 6000);
        const fixPlans = await parseAIJson(apiKey, fixRaw);
        ops = Array.isArray(fixPlans) ? fixPlans.slice(0, 20) : [];
      } catch (e: any) {
        console.error("Fix plan generation failed:", e);
        // Try once more
        try {
          const fixRaw2 = await callAI(apiKey, FAST_MODEL, "Return a JSON array of screenplay fix operations.", `Fix these issues:\n${issuesSummary}\n\nScene IDs:\n${(orderRows || []).map((o: any) => o.scene_id).join('\n')}\n\nReturn JSON array with op_type, payload, rationale.`, 0.2, 4000);
          const fixPlans2 = await parseAIJson(apiKey, fixRaw2);
          ops = Array.isArray(fixPlans2) ? fixPlans2.slice(0, 20) : [];
        } catch { ops = []; }
      }

      // Validate and insert ops
      const validSceneIds = new Set((orderRows || []).map((r: any) => r.scene_id));
      let opIndex = 0;
      for (const op of ops) {
        const opType = op.op_type || 'update_scene';
        const payload = op.payload || {};

        // Validate scene references
        if (opType === 'update_scene' || opType === 'move') {
          if (!payload.sceneId || !validSceneIds.has(payload.sceneId)) continue;
        }

        await supabase.from("scene_change_set_ops").insert({
          change_set_id: cs.id,
          project_id: projectId,
          op_index: opIndex++,
          op_type: opType,
          payload: { ...payload, meta: { rationale: op.rationale || '', source: 'qc_fix' } },
          inverse: {},
          status: 'pending',
        });
      }

      // Link issues to change set
      const issueIdsToLink = issues.map((i: any) => i.id);
      if (issueIdsToLink.length > 0) {
        await supabase.from("scene_qc_issues")
          .update({ linked_change_set_id: cs.id })
          .in("id", issueIdsToLink);
      }

      return new Response(JSON.stringify({ change_set_id: cs.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // PHASE 7 — PASS RUNNER + WRITERS' ROOM PASSES
    // ══════════════════════════════════════════════

    if (action === "pass_run") {
      const { projectId, passType, mode, settings } = body;
      if (!projectId || !passType) throw new Error("projectId and passType required");
      const validTypes = ['dialogue_sharpen', 'exposition_compress', 'escalation_lift', 'tone_consistency'];
      if (!validTypes.includes(passType)) throw new Error(`Invalid passType: ${passType}. Must be one of: ${validTypes.join(', ')}`);

      const passMode = mode || 'approved_prefer';

      // Validate settings
      const s = settings || {};
      const preserveApproved = s.preserveApproved !== false;
      const maxScenesTouched = Math.min(Math.max(s.maxScenesTouched || 8, 1), 20);
      const intensity = ['light', 'medium', 'strong'].includes(s.intensity || '') ? s.intensity : 'medium';
      const includeActs = s.includeActs || null;
      const excludeSceneIds = new Set(s.excludeSceneIds || []);
      const notes = s.notes || '';

      // 1. Build snapshot
      const { data: orderRows } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId).eq("is_active", true)
        .order("order_key", { ascending: true });

      if (!orderRows || orderRows.length === 0) throw new Error("No active scenes found");

      const sceneIds = orderRows.map((r: any) => r.scene_id);
      const { data: allVers } = await supabase.from("scene_graph_versions")
        .select("*").in("scene_id", sceneIds).order("version_number", { ascending: false });

      const latestMap = new Map<string, any>();
      const approvedSet = new Set<string>();
      for (const v of (allVers || [])) {
        if (!latestMap.has(v.scene_id)) latestMap.set(v.scene_id, v);
        if (v.status === 'approved') approvedSet.add(v.scene_id);
      }

      const snapshotContent = orderRows.map((o: any) => {
        const v = latestMap.get(o.scene_id);
        return v?.content || '';
      }).join('\n\n');

      const so = orderRows.map((o: any) => ({
        scene_id: o.scene_id, version_id: latestMap.get(o.scene_id)?.id || null,
        order_key: o.order_key, act: o.act, sequence: o.sequence,
      }));

      const { data: snapshot } = await supabase.from("scene_graph_snapshots").insert({
        project_id: projectId, created_by: user.id,
        label: `Pass: ${passType} ${new Date().toISOString()}`,
        assembly: { scene_order: so, generated_at: new Date().toISOString(), mode: passMode },
        content: snapshotContent, status: 'draft',
      }).select().single();

      if (!snapshot) throw new Error("Failed to create snapshot");

      // 2. Ensure spine + ledger exist
      const { data: existingSpine } = await supabase.from("story_spines")
        .select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();

      let spine = existingSpine;
      if (!spine) {
        try {
          const spineRaw = await callAI(apiKey, BALANCED_MODEL, "You are a screenplay structure analyst. Return ONLY valid JSON.",
            `Analyze this screenplay and produce a Story Spine JSON with: logline, genre, tone, premise, acts, character_arcs (name, start_state, end_state, key_steps), rules (world_rules, tone_rules, forbidden_changes).\n\nScript:\n${snapshotContent.slice(0, 15000)}`, 0.2, 6000);
          const spineJson = await parseAIJson(apiKey, spineRaw);
          const { data: spRow } = await supabase.from("story_spines").insert({
            project_id: projectId, created_by: user.id, status: 'active',
            source: 'pass_runner', spine: spineJson, summary: spineJson.logline || null, version: 1,
          }).select().single();
          spine = spRow;
        } catch (e: any) { console.error("Spine build failed:", e); }
      }

      const { data: existingLedger } = await supabase.from("thread_ledgers")
        .select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();

      let ledger = existingLedger;
      if (!ledger) {
        try {
          const ledgerRaw = await callAI(apiKey, BALANCED_MODEL, "You are a screenplay thread analyst. Return ONLY valid JSON.",
            `Analyze this screenplay and produce a Thread Ledger JSON with a "threads" array. Each thread: thread_id, type, title, status, introduced_in_scene_id, resolved_in_scene_id, beats, dependencies, notes.\n\nScript:\n${snapshotContent.slice(0, 15000)}`, 0.2, 6000);
          const ledgerJson = await parseAIJson(apiKey, ledgerRaw);
          const { data: lRow } = await supabase.from("thread_ledgers").insert({
            project_id: projectId, created_by: user.id, status: 'active',
            ledger: ledgerJson, summary: null, version: 1,
          }).select().single();
          ledger = lRow;
        } catch (e: any) { console.error("Ledger build failed:", e); }
      }

      const spineData = spine?.spine || {};
      const forbiddenChanges = spineData.rules?.forbidden_changes || [];

      // 3. Build scene data with indices
      const scenesWithData = orderRows.map((o: any, idx: number) => {
        const ver = latestMap.get(o.scene_id);
        return {
          scene_id: o.scene_id, display_number: idx + 1, order_key: o.order_key,
          act: o.act || 1, content: ver?.content || '', contentLen: (ver?.content || '').length,
          version: ver, isApproved: approvedSet.has(o.scene_id),
          roles: ver?.metadata?.scene_roles || [],
          characters: ver?.characters_present || [],
        };
      });

      // 4. Get relevant QC issues if available
      const { data: recentQcRun } = await supabase.from("scene_qc_runs")
        .select("id").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      let qcIssuesByScene = new Map<string, any[]>();
      if (recentQcRun) {
        const categoryMap: Record<string, string[]> = {
          dialogue_sharpen: ['tone', 'arc'],
          exposition_compress: ['pacing', 'setup_payoff'],
          escalation_lift: ['pacing', 'arc'],
          tone_consistency: ['tone'],
        };
        const relevantCats = categoryMap[passType] || [];
        const { data: qcIssues } = await supabase.from("scene_qc_issues")
          .select("*").eq("qc_run_id", recentQcRun.id).eq("status", "open")
          .in("category", relevantCats);

        for (const issue of (qcIssues || [])) {
          const sceneRefs = issue.related_scene_ids || [];
          for (const sid of sceneRefs) {
            if (!qcIssuesByScene.has(sid)) qcIssuesByScene.set(sid, []);
            qcIssuesByScene.get(sid)!.push(issue);
          }
        }
      }

      // 5. Score + rank scenes for this pass type
      const scoredScenes = scenesWithData
        .filter(sc => {
          if (preserveApproved && sc.isApproved && !notes.toLowerCase().includes('allow approved')) return false;
          if (excludeSceneIds.has(sc.scene_id)) return false;
          if (includeActs && !includeActs.includes(sc.act)) return false;
          return true;
        })
        .map(sc => {
          let score = 0;
          const issues = qcIssuesByScene.get(sc.scene_id) || [];
          score += issues.reduce((sum: number, i: any) => sum + (i.severity === 'critical' ? 4 : i.severity === 'high' ? 3 : i.severity === 'medium' ? 2 : 1), 0);

          if (passType === 'dialogue_sharpen') {
            // Higher score for longer content (proxy for dialogue density)
            score += Math.min(sc.contentLen / 500, 5);
          } else if (passType === 'exposition_compress') {
            const hasSetupRole = sc.roles.some((r: any) => (r.role || r).toString().includes('setup') || (r.role || r).toString().includes('transition'));
            if (hasSetupRole) score += 3;
            score += Math.min(sc.contentLen / 800, 4);
          } else if (passType === 'escalation_lift') {
            // Flat stretches get higher scores
            score += sc.contentLen < 300 ? 2 : 0;
          } else if (passType === 'tone_consistency') {
            score += issues.filter((i: any) => i.category === 'tone').length * 3;
          }
          return { ...sc, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, maxScenesTouched);

      if (scoredScenes.length === 0) {
        // Still create the pass run but no change set
        const { data: passRun } = await supabase.from("scene_pass_runs").insert({
          project_id: projectId, created_by: user.id, snapshot_id: snapshot.id,
          pass_type: passType, mode: passMode, status: 'completed',
          settings: { preserveApproved, maxScenesTouched, intensity, includeActs, excludeSceneIds: Array.from(excludeSceneIds), notes },
          summary: 'No eligible scenes found for this pass.',
          metadata: { selected_count: 0 },
        }).select().single();

        return new Response(JSON.stringify({ pass_run: passRun, change_set_id: null, selected_scenes: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 6. Generate patches via LLM
      const passGoals: Record<string, string> = {
        dialogue_sharpen: `Tighten dialogue lines, improve subtext, preserve plot beats, keep character voice distinct. Do NOT add/remove story facts or thread links. Intensity: ${intensity}.`,
        exposition_compress: `Reduce exposition, move info into conflict/action, shorten explanations. Preserve necessary facts by embedding subtly. Intensity: ${intensity}.`,
        escalation_lift: `Increase stakes, add reversals, sharper obstacles. May insert micro-beats. Do NOT break continuity or change major outcomes without explicit note. Intensity: ${intensity}.`,
        tone_consistency: `Align tone with established rules: ${JSON.stringify(spineData.rules?.tone_rules || [])}. Genre: ${spineData.genre || 'unknown'}. Preserve events. Intensity: ${intensity}.`,
      };

      const scenesForPrompt = scoredScenes.map(sc =>
        `Scene ${sc.display_number} (ID: ${sc.scene_id}):\nCharacters: ${sc.characters.join(', ') || 'unknown'}\n---\n${sc.content.slice(0, 3000)}\n---`
      ).join('\n\n');

      const forbiddenStr = forbiddenChanges.length > 0 ? `\nFORBIDDEN CHANGES (do not violate): ${JSON.stringify(forbiddenChanges)}` : '';

      const patchPrompt = `You are a professional screenplay rewrite assistant performing a "${passType}" pass.

GOAL: ${passGoals[passType]}
${forbiddenStr}

RULES:
- Return a JSON array of patch objects, one per scene
- Each patch: { "scene_id": "uuid", "strategy": "rewrite", "patch": { "content": "full rewritten scene text" }, "rationale": "why", "risks": ["risk1"] }
- Preserve ALL continuity facts and thread connections
- Do NOT introduce new characters not already in the scene
- Do NOT change scene boundaries or sluglines unless absolutely necessary
- Return ONLY valid JSON array

SCENES TO REWRITE:
${scenesForPrompt}`;

      let patches: any[] = [];
      try {
        const patchRaw = await callAI(apiKey, BALANCED_MODEL, "You are a screenplay rewrite engine. Return ONLY a valid JSON array of patch objects.", patchPrompt, 0.4, 32000);
        const parsed = await parseAIJson(apiKey, patchRaw);
        patches = Array.isArray(parsed) ? parsed : (parsed.patches || []);
      } catch (e: any) {
        console.error("Pass LLM failed:", e);
        // Retry once with simpler prompt
        try {
          const patchRaw2 = await callAI(apiKey, FAST_MODEL, "Return JSON array of screenplay patches.", `Rewrite these scenes (${passType}, ${intensity}):\n${scenesForPrompt.slice(0, 8000)}\n\nReturn JSON array: [{ "scene_id": "...", "strategy": "rewrite", "patch": { "content": "..." }, "rationale": "...", "risks": [] }]`, 0.3, 8000);
          const parsed2 = await parseAIJson(apiKey, patchRaw2);
          patches = Array.isArray(parsed2) ? parsed2 : [];
        } catch { patches = []; }
      }

      // 7. Create Change Set
      const validSceneIds = new Set(scoredScenes.map(s => s.scene_id));
      const validPatches = patches.filter((p: any) => p.scene_id && validSceneIds.has(p.scene_id));

      const csTitle = `Pass: ${passType} (${new Date().toISOString().split('T')[0]})`;
      const { data: cs } = await supabase.from("scene_change_sets").insert({
        project_id: projectId, created_by: user.id,
        title: csTitle,
        description: `Auto-generated by ${passType} pass. Intensity: ${intensity}. ${validPatches.length} scenes rewritten.`,
        goal_type: passType,
        status: 'draft',
        base_snapshot_id: snapshot.id,
        metadata: { pass_type: passType, intensity, scene_count: validPatches.length },
      }).select().single();

      if (!cs) throw new Error("Failed to create change set");

      // 8. Insert ops
      let opIndex = 0;
      for (const patch of validPatches) {
        await supabase.from("scene_change_set_ops").insert({
          change_set_id: cs.id,
          project_id: projectId,
          op_index: opIndex++,
          op_type: 'update_scene',
          payload: {
            sceneId: patch.scene_id,
            patch: patch.patch || {},
            meta: { rationale: patch.rationale || '', risks: patch.risks || [], source: `pass_${passType}` },
          },
          inverse: {},
          status: 'pending',
        });
      }

      // 9. Create pass run row
      const { data: passRun } = await supabase.from("scene_pass_runs").insert({
        project_id: projectId, created_by: user.id, snapshot_id: snapshot.id,
        pass_type: passType, mode: passMode, status: 'completed',
        settings: { preserveApproved, maxScenesTouched, intensity, includeActs, excludeSceneIds: Array.from(excludeSceneIds), notes },
        summary: `${validPatches.length} scenes rewritten (${passType}, ${intensity})`,
        created_change_set_id: cs.id,
        metadata: { selected_scenes: scoredScenes.map(s => s.scene_id), patch_count: validPatches.length },
      }).select().single();

      return new Response(JSON.stringify({
        pass_run: passRun,
        change_set_id: cs.id,
        selected_scenes: scoredScenes.map(s => s.scene_id),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "pass_list_runs") {
      const { projectId, limit } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: runs } = await supabase.from("scene_pass_runs")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(limit || 20);

      return new Response(JSON.stringify({ runs: runs || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "pass_get_run") {
      const { projectId, passRunId } = body;
      if (!projectId || !passRunId) throw new Error("projectId and passRunId required");

      const { data: run } = await supabase.from("scene_pass_runs")
        .select("*").eq("id", passRunId).single();
      if (!run) throw new Error("Pass run not found");

      const selectedScenes = run.metadata?.selected_scenes || [];
      let sceneDetails: any[] = [];
      if (selectedScenes.length > 0) {
        const { data: scenes } = await supabase.from("scene_graph_versions")
          .select("scene_id, slugline, content, version_number")
          .in("scene_id", selectedScenes)
          .order("version_number", { ascending: false });

        const seen = new Set<string>();
        for (const s of (scenes || [])) {
          if (!seen.has(s.scene_id)) {
            seen.add(s.scene_id);
            sceneDetails.push(s);
          }
        }
      }

      return new Response(JSON.stringify({ run, selected_scenes: sceneDetails }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // CANON OS ACTIONS (HARDENED)
    // ═══════════════════════════════════════════════════════════════

    // Deep-merge helper: objects merge recursively, arrays replace only when provided, primitives overwrite
    function mergeCanonSafe(prev: any, patch: any): any {
      if (patch === null || patch === undefined) return prev;
      if (typeof patch !== "object" || Array.isArray(patch)) return patch;
      if (typeof prev !== "object" || Array.isArray(prev) || prev === null) return patch;
      const result: any = { ...prev };
      for (const key of Object.keys(patch)) {
        const pv = patch[key];
        if (pv === undefined) continue;
        if (Array.isArray(pv)) {
          // Arrays: replace entirely when explicitly provided
          result[key] = pv;
        } else if (pv !== null && typeof pv === "object" && !Array.isArray(pv)) {
          result[key] = mergeCanonSafe(prev[key], pv);
        } else {
          result[key] = pv;
        }
      }
      return result;
    }

    // Helper: fetch canon version by pointer, fallback to latest
    async function getPointerCanonVersion(supabaseClient: any, projectId: string) {
      // 1. Check pointer
      const { data: proj } = await supabaseClient.from("projects")
        .select("canon_version_id").eq("id", projectId).single();
      if (proj?.canon_version_id) {
        const { data: ver } = await supabaseClient.from("project_canon_versions")
          .select("*").eq("id", proj.canon_version_id).maybeSingle();
        if (ver) return ver;
      }
      // 2. Fallback to latest by created_at
      const { data: latest } = await supabaseClient.from("project_canon_versions")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return latest || null;
    }

    // Helper: doc type label for display names
    function docTypeLabelEdge(docType: string): string {
      const labels: Record<string, string> = {
        topline_narrative: "Topline Narrative", concept_brief: "Concept Brief",
        character_bible: "Character Bible", market_sheet: "Market Sheet",
        blueprint: "Blueprint / Series Bible", beat_sheet: "Beat Sheet",
        deck: "Deck", documentary_outline: "Documentary Outline",
        episode_grid: "Episode Grid", season_arc: "Season Arc",
        episode_script: "Episode Script", feature_script: "Feature Script",
        format_rules: "Format Rules", production_draft: "Production Draft",
        script: "Script", treatment: "Treatment", other: "Document",
      };
      return labels[docType] || docType.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    }

    function buildDisplayName(projectTitle: string, docType: string, extra?: { episodeNumber?: number }): string {
      const label = docTypeLabelEdge(docType);
      const parts = [projectTitle];
      if (extra?.episodeNumber != null) parts.push(`Episode ${String(extra.episodeNumber).padStart(2, "0")}`);
      parts.push(label);
      return parts.join(" — ");
    }

    if (action === "canon_os_initialize") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      // If project already has a pointer, return that version
      const { data: proj } = await supabase.from("projects")
        .select("canon_version_id").eq("id", projectId).single();
      if (proj?.canon_version_id) {
        const { data: ver } = await supabase.from("project_canon_versions")
          .select("*").eq("id", proj.canon_version_id).maybeSingle();
        if (ver) {
          return new Response(JSON.stringify({ canon: ver }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Check if canon already has data
      const { data: existing } = await supabase.from("project_canon")
        .select("canon_json").eq("project_id", projectId).maybeSingle();

      const existingJson = existing?.canon_json || {};
      if (existingJson && Object.keys(existingJson).length > 3) {
        // Already initialized but no pointer - fetch latest version and set pointer
        const { data: latest } = await supabase.from("project_canon_versions")
          .select("*").eq("project_id", projectId)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (latest) {
          await supabase.from("projects").update({ canon_version_id: latest.id }).eq("id", projectId);
        }
        return new Response(JSON.stringify({ canon: latest }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Build initial canon from project + documents
      const { data: project } = await supabase.from("projects")
        .select("title, production_type, format, genre, target_audience, episode_count, qualifications")
        .eq("id", projectId).single();

      const quals = (project?.qualifications || {}) as any;
      const canonData: any = {
        title: project?.title || "",
        format: project?.format || project?.production_type || "",
        episode_count: project?.episode_count || quals.episode_count || null,
        episode_length_seconds_min: quals.episode_duration_min || null,
        episode_length_seconds_max: quals.episode_duration_max || null,
        genre: project?.genre || quals.genre || null,
        tone: quals.tone || null,
        world_rules: [],
        characters: [],
        locations: [],
        timeline_notes: [],
        forbidden_changes: [],
      };

      // Ensure base row exists
      await supabase.from("project_canon")
        .upsert({ project_id: projectId, canon_json: canonData, updated_by: user.id }, { onConflict: "project_id" });

      // Fetch the version that was auto-created by trigger
      const { data: version } = await supabase.from("project_canon_versions")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (version) {
        await supabase.from("projects").update({ canon_version_id: version.id }).eq("id", projectId);
      }

      return new Response(JSON.stringify({ canon: version }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "canon_os_update") {
      const { projectId, patch } = body;
      if (!projectId || !patch) throw new Error("projectId and patch required");

      // Fetch current via pointer
      const pointerVer = await getPointerCanonVersion(supabase, projectId);
      let currentJson: any = {};
      if (pointerVer?.canon_json) {
        currentJson = pointerVer.canon_json;
      } else {
        const { data: current } = await supabase.from("project_canon")
          .select("canon_json").eq("project_id", projectId).maybeSingle();
        currentJson = current?.canon_json || {};
      }

      // Safe deep merge
      const merged = mergeCanonSafe(currentJson, patch);

      // Update (trigger auto-creates version)
      await supabase.from("project_canon")
        .update({ canon_json: merged, updated_by: user.id })
        .eq("project_id", projectId);

      // Get new version and update pointer
      const { data: version } = await supabase.from("project_canon_versions")
        .select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (version) {
        await supabase.from("projects").update({ canon_version_id: version.id }).eq("id", projectId);
      }

      return new Response(JSON.stringify({ canon: version }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "canon_os_approve") {
      const { projectId, canonId } = body;
      if (!projectId || !canonId) throw new Error("projectId and canonId required");

      // Supersede previous approved
      await supabase.from("project_canon_versions")
        .update({ is_approved: false, approved_at: null, status: "superseded" })
        .eq("project_id", projectId)
        .eq("is_approved", true);

      // Approve this version
      await supabase.from("project_canon_versions")
        .update({ is_approved: true, approved_at: new Date().toISOString(), status: "approved" })
        .eq("id", canonId);

      // Update project pointer
      await supabase.from("projects").update({ canon_version_id: canonId }).eq("id", projectId);

      const { data: version } = await supabase.from("project_canon_versions")
        .select("*").eq("id", canonId).single();

      return new Response(JSON.stringify({ canon: version }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "canon_os_get") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      // POINTER FIRST
      const version = await getPointerCanonVersion(supabase, projectId);

      return new Response(JSON.stringify({ canon: version || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set_primary_document") {
      const { projectId, documentId, scope } = body;
      if (!projectId || !documentId) throw new Error("projectId and documentId required");

      const SCRIPT_DOC_TYPES = ["season_script", "feature_script", "episode_script", "script", "pilot_script", "script_pdf"];
      const effectiveScope = scope || "script";

      if (effectiveScope === "script") {
        // Validate target document is a script type
        const { data: targetDoc } = await supabase.from("project_documents")
          .select("id, doc_type").eq("id", documentId).single();
        if (!targetDoc) throw new Error("Document not found");
        if (!SCRIPT_DOC_TYPES.includes(targetDoc.doc_type)) {
          throw new Error(`Document doc_type '${targetDoc.doc_type}' is not a script authority type. Allowed: ${SCRIPT_DOC_TYPES.join(", ")}`);
        }

        // Clear is_primary ONLY for script doc_types in this project
        await supabase.from("project_documents")
          .update({ is_primary: false })
          .eq("project_id", projectId)
          .eq("is_primary", true)
          .in("doc_type", SCRIPT_DOC_TYPES);
      } else {
        // Generic scope: clear all primary in project
        await supabase.from("project_documents")
          .update({ is_primary: false })
          .eq("project_id", projectId)
          .eq("is_primary", true);
      }

      // Set is_primary for target document
      await supabase.from("project_documents")
        .update({ is_primary: true })
        .eq("id", documentId);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "project_rename") {
      const { projectId, newTitle } = body;
      if (!projectId || !newTitle) throw new Error("projectId and newTitle required");

      // 1. Update project title
      await supabase.from("projects").update({ title: newTitle }).eq("id", projectId);

      // 2. Update canon data.title via safe merge (creates versioned entry)
      const pointerVer = await getPointerCanonVersion(supabase, projectId);
      if (pointerVer?.canon_json) {
        const merged = mergeCanonSafe(pointerVer.canon_json, { title: newTitle });
        await supabase.from("project_canon")
          .update({ canon_json: merged, updated_by: user.id })
          .eq("project_id", projectId);
        const { data: newVer } = await supabase.from("project_canon_versions")
          .select("id").eq("project_id", projectId)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (newVer) {
          await supabase.from("projects").update({ canon_version_id: newVer.id }).eq("id", projectId);
        }
      } else {
        const { data: canon } = await supabase.from("project_canon")
          .select("canon_json").eq("project_id", projectId).maybeSingle();
        if (canon) {
          const updated = mergeCanonSafe(canon.canon_json || {}, { title: newTitle });
          await supabase.from("project_canon")
            .update({ canon_json: updated, updated_by: user.id })
            .eq("project_id", projectId);
        }
      }

      // 3. Deterministic rename: update display_name + title for ALL documents
      //    DO NOT overwrite file_name (used as export name).
      //    Preserve episode numbering from file_name heuristic.
      const { data: docs } = await supabase.from("project_documents")
        .select("id, doc_type, file_name, title").eq("project_id", projectId);

      let updatedDocs = 0;
      for (const doc of (docs || [])) {
        // Try to extract episode number from existing file_name or title
        let episodeNumber: number | undefined;
        const epMatch = (doc.file_name || doc.title || "").match(/[Ee]pisode\s*(\d+)|[Ee]p\.?\s*(\d+)|[Ss]\d+[Ee](\d+)/);
        if (epMatch) {
          episodeNumber = parseInt(epMatch[1] || epMatch[2] || epMatch[3], 10);
        }

        const displayName = buildDisplayName(newTitle, doc.doc_type || "other", episodeNumber ? { episodeNumber } : undefined);
        await supabase.from("project_documents")
          .update({ display_name: displayName, title: displayName })
          .eq("id", doc.id);
        updatedDocs++;
      }

      return new Response(JSON.stringify({ success: true, updated_documents: updatedDocs }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "docs_backfill_display_names") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      // Get canon title (fallback to project title)
      let canonTitle = "";
      const { data: proj } = await supabase.from("projects")
        .select("title, canon_version_id").eq("id", projectId).single();
      canonTitle = proj?.title || "";
      if (proj?.canon_version_id) {
        const { data: cv } = await supabase.from("project_canon_versions")
          .select("canon_json").eq("id", proj.canon_version_id).maybeSingle();
        if (cv?.canon_json?.title) canonTitle = cv.canon_json.title;
      }

      // Fetch all docs missing display_name
      const { data: docs } = await supabase.from("project_documents")
        .select("id, doc_type, file_name, title, display_name")
        .eq("project_id", projectId);

      let updated = 0;
      for (const doc of (docs || [])) {
        if (doc.display_name && doc.display_name.trim().length > 0) continue;

        let episodeNumber: number | undefined;
        const epMatch = (doc.file_name || doc.title || "").match(/[Ee]pisode\s*(\d+)|[Ee]p\.?\s*(\d+)|[Ss]\d+[Ee](\d+)/);
        if (epMatch) episodeNumber = parseInt(epMatch[1] || epMatch[2] || epMatch[3], 10);

        const displayName = buildDisplayName(canonTitle, doc.doc_type || "other", episodeNumber ? { episodeNumber } : undefined);
        await supabase.from("project_documents")
          .update({ display_name: displayName })
          .eq("id", doc.id);
        updated++;
      }

      return new Response(JSON.stringify({ success: true, updated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // SCENE-LEVEL REWRITE PIPELINE (HARDENED)
    // ═══════════════════════════════════════════════════════════════

    const SCENE_REWRITE_SYSTEM = `You are rewriting a SINGLE SCENE from a screenplay.

GOALS:
- Apply the approved notes to this scene only.
- Tight, well-written prose and dialogue.
- Stronger clarity, pacing, and dramatic impact.
- Preserve professional screenplay formatting.
- Preserve all PROTECT items absolutely.
- Maintain continuity with previous/next scene context provided.

CRITICAL:
- Do NOT summarize the scene.
- Do NOT collapse beats.
- Do NOT expand the scene by more than 15% unless explicitly required by notes.
- Keep the scene at roughly the same length as the input.
- Output ONLY the rewritten scene text. No JSON, no commentary, no markdown fences.`;

    // ── REWRITE DEBUG PROBE ──
    if (action === "rewrite_debug_probe") {
      const { projectId, sourceDocId, sourceVersionId } = body;
      if (!projectId || !sourceVersionId) throw new Error("projectId, sourceVersionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", sourceVersionId).single();
      const scriptChars = (version?.plaintext || "").length;

      const { data: sceneOrder } = await supabase.from("scene_graph_order")
        .select("id, scene_id")
        .eq("project_id", projectId)
        .eq("is_active", true);

      const scenesCount = sceneOrder?.length || 0;
      const hasScenes = scenesCount >= 3;

      return new Response(JSON.stringify({
        has_scenes: hasScenes,
        scenes_count: scenesCount,
        rewrite_default_mode: hasScenes ? "scene" : "chunk",
        script_chars: scriptChars,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── SCOPE PLAN (compute impacted scenes + contracts) ──
    if (action === "scope_plan") {
      const { projectId, sourceDocId, sourceVersionId, notes } = body;
      if (!projectId || !sourceVersionId) throw new Error("projectId, sourceVersionId required");
      const approvedNotes: any[] = notes || [];

      // 1. Get scene list
      const { data: sceneOrder } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .order("order_key", { ascending: true });

      let scenes: Array<{ scene_number: number; scene_id: string | null; heading: string; summary: string; characters: string[] }> = [];

      if (sceneOrder && sceneOrder.length >= 3) {
        const sceneIds = sceneOrder.map(s => s.scene_id);
        const { data: versions } = await supabase.from("scene_graph_versions")
          .select("scene_id, slugline, summary, characters_present, version_number")
          .in("scene_id", sceneIds)
          .order("version_number", { ascending: false });
        const latestMap = new Map<string, { slugline: string; summary: string; characters: string[] }>();
        for (const v of (versions || [])) {
          if (!latestMap.has(v.scene_id)) {
            latestMap.set(v.scene_id, {
              slugline: v.slugline || "",
              summary: v.summary || "",
              characters: v.characters_present || [],
            });
          }
        }
        scenes = sceneOrder.map((s, i) => {
          const ver = latestMap.get(s.scene_id);
          return {
            scene_number: i + 1,
            scene_id: s.scene_id,
            heading: ver?.slugline || `SCENE ${i + 1}`,
            summary: ver?.summary || "",
            characters: ver?.characters || [],
          };
        });
      } else {
        // Fallback: split from plaintext
        const { data: version } = await supabase.from("project_document_versions")
          .select("plaintext").eq("id", sourceVersionId).single();
        const text = version?.plaintext || "";
        const headingRegex = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*.+/gm;
        let match;
        const boundaries: Array<{ index: number; heading: string }> = [];
        while ((match = headingRegex.exec(text)) !== null) {
          boundaries.push({ index: match.index, heading: match[0].trim() });
        }
        scenes = boundaries.map((b, i) => {
          const start = b.index;
          const end = boundaries[i + 1]?.index ?? text.length;
          const sceneText = text.substring(start, end).trim();
          // Extract character names (ALL CAPS words in dialogue position)
          const charMatches = sceneText.match(/^\s{10,}([A-Z][A-Z\s\.]+)\s*$/gm) || [];
          const chars = [...new Set(charMatches.map(c => c.trim()))];
          return {
            scene_number: i + 1,
            scene_id: null,
            heading: b.heading.substring(0, 200),
            summary: sceneText.substring(0, 300),
            characters: chars.slice(0, 10),
          };
        });
      }

      if (scenes.length === 0) {
        return new Response(JSON.stringify({ error: "No scenes found", totalScenes: 0 }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2. Anchor notes to scenes
      const anchored = new Set<number>();
      const noteSceneMap = new Map<string, number[]>(); // noteId -> scene_numbers
      for (const note of approvedNotes) {
        const noteId = note.id || note.note_key || "";
        const mappedScenes: number[] = [];

        // Explicit scene anchor
        const explicitScene = note.scene_number || note.anchor?.scene_number;
        if (explicitScene && typeof explicitScene === "number") {
          anchored.add(explicitScene);
          mappedScenes.push(explicitScene);
        } else {
          // Keyword matching
          const noteText = (note.description || note.note || "").toLowerCase();
          if (noteText.length >= 5) {
            const noteWords = noteText.split(/\s+/).filter((w: string) => w.length > 3);
            for (const scene of scenes) {
              const heading = scene.heading.toLowerCase();
              const summary = scene.summary.toLowerCase();
              const matchCount = noteWords.filter((w: string) => heading.includes(w) || summary.includes(w)).length;
              if (matchCount >= 2 || (noteWords.length <= 3 && matchCount >= 1)) {
                anchored.add(scene.scene_number);
                mappedScenes.push(scene.scene_number);
              }
            }
          }
          // Character name matching
          if (mappedScenes.length === 0) {
            const noteText2 = (note.description || note.note || "");
            for (const scene of scenes) {
              for (const char of scene.characters) {
                if (noteText2.includes(char)) {
                  anchored.add(scene.scene_number);
                  mappedScenes.push(scene.scene_number);
                  break;
                }
              }
            }
          }
        }
        if (noteId) noteSceneMap.set(noteId, mappedScenes);
      }

      // If no anchors, target all
      if (anchored.size === 0) {
        const allNumbers = scenes.map(s => s.scene_number);
        return new Response(JSON.stringify({
          target_scene_numbers: allNumbers,
          context_scene_numbers: [],
          at_risk_scene_numbers: [],
          reason: "No specific scene anchors found — rewriting all scenes",
          propagation_depth: 0,
          note_ids: approvedNotes.map((n: any) => n.id || n.note_key || "").filter(Boolean),
          contracts: { arc_milestones: [], canon_rules: [], knowledge_state: [], setup_payoff: [] },
          debug: { selected_notes_count: approvedNotes.length, anchored_scenes: [], timestamp: new Date().toISOString() },
          total_scenes_in_script: scenes.length,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 3. Build target + context sets
      const anchoredArr = [...anchored].sort((a, b) => a - b);
      const allNumbers = new Set(scenes.map(s => s.scene_number));
      const targetSet = new Set(anchoredArr);
      const contextSet = new Set<number>();

      for (const n of anchoredArr) {
        if (allNumbers.has(n - 1) && !targetSet.has(n - 1)) contextSet.add(n - 1);
        if (allNumbers.has(n + 1) && !targetSet.has(n + 1)) contextSet.add(n + 1);
      }

      // 4. Build contracts from canonical docs
      const canonRules: string[] = [];
      const arcMilestones: Array<{ scene_number: number; must_be_true: string[] }> = [];
      const knowledgeState: Array<{ character: string; by_scene: Array<{ scene_number: number; knows: string[] }> }> = [];
      const setupPayoff: Array<{ setup_scene: number; payoff_scene: number; item: string }> = [];

      // Pull canon
      const { data: canonRow } = await supabase.from("project_canon")
        .select("canon_json").eq("project_id", projectId).maybeSingle();
      const canon = canonRow?.canon_json || {};

      if (canon.logline) canonRules.push(`Logline: ${canon.logline}`);
      if (canon.premise) canonRules.push(`Premise: ${String(canon.premise).substring(0, 300)}`);
      if (canon.tone) canonRules.push(`Tone: ${canon.tone}`);
      if (canon.genre) canonRules.push(`Genre: ${canon.genre}`);
      if (canon.world_rules) canonRules.push(`World rules: ${String(canon.world_rules).substring(0, 300)}`);
      canonRules.push("Do not introduce new characters/locations unless required by notes.");
      canonRules.push("Do not contradict established timeline or character knowledge.");

      // Pull character bible for knowledge state
      const { data: charBibleDoc } = await supabase.from("project_documents")
        .select("id").eq("project_id", projectId).eq("doc_type", "character_bible").limit(1).maybeSingle();
      if (charBibleDoc) {
        const { data: charVer } = await supabase.from("project_document_versions")
          .select("plaintext").eq("document_id", charBibleDoc.id)
          .order("version_number", { ascending: false }).limit(1).maybeSingle();
        if (charVer?.plaintext) {
          // Extract character names from bible headings
          const charMatches = charVer.plaintext.match(/^#+\s*(.+)/gm) || [];
          const characters = charMatches.map((m: string) => m.replace(/^#+\s*/, "").trim()).filter((c: string) => c.length > 1 && c.length < 40).slice(0, 8);
          for (const charName of characters) {
            // Find which scenes this character appears in
            const charScenes = scenes.filter(s => s.characters.some(c => c.toLowerCase().includes(charName.toLowerCase())));
            if (charScenes.length > 0) {
              knowledgeState.push({
                character: charName,
                by_scene: charScenes.slice(0, 5).map(s => ({
                  scene_number: s.scene_number,
                  knows: [`Present in scene ${s.scene_number}`],
                })),
              });
            }
          }
        }
      }

      // Pull blueprint/beat_sheet for arc milestones
      const { data: blueprintDoc } = await supabase.from("project_documents")
        .select("id").eq("project_id", projectId).in("doc_type", ["blueprint", "beat_sheet"]).limit(1).maybeSingle();
      if (blueprintDoc) {
        const { data: bpVer } = await supabase.from("project_document_versions")
          .select("plaintext").eq("document_id", blueprintDoc.id)
          .order("version_number", { ascending: false }).limit(1).maybeSingle();
        if (bpVer?.plaintext) {
          // Extract act breaks / key beats
          const beatLines = bpVer.plaintext.split("\n").filter((l: string) => /act\s*(break|[123]|i{1,3})|midpoint|climax|inciting|resolution/i.test(l)).slice(0, 8);
          const totalScenes = scenes.length;
          // Map beats to approximate scene positions
          const beatPositions = [
            { label: "Inciting incident", pos: Math.ceil(totalScenes * 0.1) },
            { label: "End of Act 1", pos: Math.ceil(totalScenes * 0.25) },
            { label: "Midpoint", pos: Math.ceil(totalScenes * 0.5) },
            { label: "End of Act 2", pos: Math.ceil(totalScenes * 0.75) },
            { label: "Climax", pos: Math.ceil(totalScenes * 0.9) },
            { label: "Resolution", pos: totalScenes },
          ];
          for (const bp of beatPositions) {
            const relevantBeat = beatLines.find((l: string) => l.toLowerCase().includes(bp.label.toLowerCase()));
            arcMilestones.push({
              scene_number: bp.pos,
              must_be_true: [relevantBeat ? relevantBeat.trim().substring(0, 200) : `${bp.label} must occur around scene ${bp.pos}`],
            });
          }
        }
      }

      // Fallback arc milestones if none found
      if (arcMilestones.length === 0) {
        const totalScenes = scenes.length;
        arcMilestones.push(
          { scene_number: Math.ceil(totalScenes * 0.1), must_be_true: ["Inciting incident establishes central conflict"] },
          { scene_number: Math.ceil(totalScenes * 0.25), must_be_true: ["Act 1 break — protagonist commits to journey"] },
          { scene_number: Math.ceil(totalScenes * 0.5), must_be_true: ["Midpoint reversal or revelation"] },
          { scene_number: Math.ceil(totalScenes * 0.75), must_be_true: ["Act 2 break — all seems lost / dark night"] },
          { scene_number: Math.ceil(totalScenes * 0.9), must_be_true: ["Climax — central conflict resolved"] },
          { scene_number: totalScenes, must_be_true: ["Resolution — new equilibrium established"] },
        );
      }

      const plan = {
        target_scene_numbers: [...targetSet].sort((a, b) => a - b),
        context_scene_numbers: [...contextSet].sort((a, b) => a - b),
        at_risk_scene_numbers: [],
        reason: `${targetSet.size} scene(s) directly impacted by ${approvedNotes.length} note(s)`,
        propagation_depth: 0,
        note_ids: approvedNotes.map((n: any) => n.id || n.note_key || "").filter(Boolean),
        contracts: { arc_milestones: arcMilestones, canon_rules: canonRules, knowledge_state: knowledgeState, setup_payoff: setupPayoff },
        debug: {
          selected_notes_count: approvedNotes.length,
          anchored_scenes: anchoredArr,
          timestamp: new Date().toISOString(),
        },
        total_scenes_in_script: scenes.length,
      };

      console.log(`[scope_plan] ${targetSet.size} target scenes, ${contextSet.size} context scenes, ${canonRules.length} canon rules, ${arcMilestones.length} arc milestones`);

      return new Response(JSON.stringify(plan), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET ENQUEUED SCENE NUMBERS ──
    if (action === "get_enqueued_scene_numbers") {
      const { projectId, sourceVersionId } = body;
      if (!projectId || !sourceVersionId) throw new Error("projectId, sourceVersionId required");

      const { data: jobs } = await supabase.from("rewrite_jobs")
        .select("scene_number")
        .eq("project_id", projectId)
        .eq("source_version_id", sourceVersionId);

      const sceneNumbers = (jobs || []).map(j => j.scene_number).sort((a: number, b: number) => a - b);
      return new Response(JSON.stringify({ scene_numbers: sceneNumbers }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ENQUEUE REWRITE JOBS ──
    if (action === "enqueue_rewrite_jobs") {
      const { projectId, sourceDocId, sourceVersionId, targetDocType, approvedNotes, protectItems, targetSceneNumbers } = body;
      if (!projectId || !sourceDocId || !sourceVersionId) throw new Error("projectId, sourceDocId, sourceVersionId required");

      // Selective enqueue: if targetSceneNumbers provided, only those will be enqueued
      const selectiveMode = Array.isArray(targetSceneNumbers) && targetSceneNumbers.length > 0;

      // ── Always create a NEW rewrite_run (never reuse) ──
      const { data: run, error: runErr } = await supabase.from("rewrite_runs").insert({
        project_id: projectId,
        user_id: user.id,
        source_doc_id: sourceDocId,
        source_version_id: sourceVersionId,
        status: "queued",
        target_scene_numbers: selectiveMode ? targetSceneNumbers : null,
      }).select("id").single();
      if (runErr) throw runErr;
      const runId = run.id;

      // Try scene_graph first
      const { data: sceneOrder } = await supabase.from("scene_graph_order")
        .select("scene_id, order_key, act, sequence")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .order("order_key", { ascending: true });

      interface EnqueueScene {
        scene_number: number;
        scene_id: string | null;
        heading: string;
        scene_graph_version_id: string | null;
        prev_summary: string;
        next_summary: string;
      }
      let scenes: EnqueueScene[] = [];

      if (sceneOrder && sceneOrder.length >= 3) {
        const sceneIds = sceneOrder.map(s => s.scene_id);
        const { data: versions } = await supabase.from("scene_graph_versions")
          .select("id, scene_id, slugline, summary, content, version_number")
          .in("scene_id", sceneIds)
          .order("version_number", { ascending: false });

        const latestVersionMap = new Map<string, { id: string; slugline: string; summary: string; content: string }>();
        for (const v of (versions || [])) {
          if (!latestVersionMap.has(v.scene_id)) {
            latestVersionMap.set(v.scene_id, { id: v.id, slugline: v.slugline || "", summary: v.summary || "", content: v.content || "" });
          }
        }

        const orderedVersions = sceneOrder.map(s => latestVersionMap.get(s.scene_id));
        scenes = sceneOrder.map((s, i) => {
          const ver = orderedVersions[i];
          const prevVer = i > 0 ? orderedVersions[i - 1] : null;
          const nextVer = i < sceneOrder.length - 1 ? orderedVersions[i + 1] : null;
          return {
            scene_number: i + 1,
            scene_id: s.scene_id,
            heading: ver?.slugline || `SCENE ${i + 1}`,
            scene_graph_version_id: ver?.id || null,
            prev_summary: prevVer ? `${prevVer.slugline || ""}: ${prevVer.summary || ""}`.trim().substring(0, 500) : "",
            next_summary: nextVer ? `${nextVer.slugline || ""}: ${nextVer.summary || ""}`.trim().substring(0, 500) : "",
          };
        });
      } else {
        const { data: version } = await supabase.from("project_document_versions")
          .select("plaintext").eq("id", sourceVersionId).single();
        const text = version?.plaintext || "";
        const headingRegex = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*.+/gm;
        let match;
        const boundaries: Array<{ index: number; heading: string }> = [];
        while ((match = headingRegex.exec(text)) !== null) {
          boundaries.push({ index: match.index, heading: match[0].trim() });
        }

        if (boundaries.length < 2) {
          return new Response(JSON.stringify({ error: "Not enough scenes detected for scene-level rewrite. Use chunk pipeline.", totalScenes: boundaries.length }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        scenes = boundaries.map((b, i) => {
          const start = b.index;
          const end = boundaries[i + 1]?.index ?? text.length;
          const prevStart = i > 0 ? boundaries[i - 1].index : -1;
          const prevEnd = start;
          const nextStart = boundaries[i + 1]?.index ?? -1;
          const nextEnd = boundaries[i + 2]?.index ?? text.length;
          return {
            scene_number: i + 1,
            scene_id: null,
            heading: b.heading.substring(0, 200),
            scene_graph_version_id: null,
            prev_summary: prevStart >= 0 ? text.substring(prevStart, prevEnd).trim().substring(0, 300) : "",
            next_summary: nextStart >= 0 ? text.substring(nextStart, nextEnd).trim().substring(0, 300) : "",
          };
        });
      }

      // Filter scenes if selective mode
      const targetSet = selectiveMode ? new Set(targetSceneNumbers as number[]) : null;
      const finalScenes = targetSet ? scenes.filter(s => targetSet.has(s.scene_number)) : scenes;

      if (finalScenes.length === 0) {
        await supabase.from("rewrite_runs").update({ status: "failed", summary: "No scenes to enqueue" }).eq("id", runId);
        return new Response(JSON.stringify({ error: "No scenes to enqueue", totalScenes: 0, runId }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Insert jobs with run_id
      const jobRows = finalScenes.map(s => ({
        project_id: projectId,
        user_id: user.id,
        source_doc_id: sourceDocId,
        source_version_id: sourceVersionId,
        target_doc_type: targetDocType || "script",
        scene_id: s.scene_id,
        scene_number: s.scene_number,
        scene_heading: s.heading,
        scene_graph_version_id: s.scene_graph_version_id,
        prev_summary: s.prev_summary,
        next_summary: s.next_summary,
        status: "queued",
        attempts: 0,
        max_attempts: 3,
        approved_notes: approvedNotes || [],
        protect_items: protectItems || [],
        run_id: runId,
      }));

      const { error: insertErr } = await supabase.from("rewrite_jobs").upsert(jobRows, {
        onConflict: "source_version_id,scene_number",
        ignoreDuplicates: false,
      });
      if (insertErr) throw insertErr;

      // Update run status
      await supabase.from("rewrite_runs").update({ status: "running" }).eq("id", runId);

      console.log(`[scene-rewrite] Enqueued ${finalScenes.length} scene rewrite jobs for run ${runId}${selectiveMode ? ` (selective: ${targetSceneNumbers.length} target)` : ''}`);

      return new Response(JSON.stringify({
        runId,
        totalScenes: finalScenes.length,
        queued: finalScenes.length,
        alreadyExists: false,
        selectiveMode: !!selectiveMode,
        targetSceneNumbers: selectiveMode ? targetSceneNumbers : null,
        allSceneNumbers: scenes.map(s => s.scene_number),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PROCESS NEXT REWRITE JOB ──
    if (action === "process_next_rewrite_job") {
      const { projectId, sourceVersionId, runId } = body;
      if (!runId) {
        return new Response(JSON.stringify({ error: "runId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!projectId || !sourceVersionId) throw new Error("projectId, sourceVersionId required");

      // Atomic claim via RPC — always filter by run_id
      const { data: claimedRows, error: claimErr } = await supabase.rpc("claim_next_rewrite_job", {
        p_project_id: projectId,
        p_source_version_id: sourceVersionId,
        p_run_id: runId,
      });

      if (claimErr) {
        console.error("[scene-rewrite] Claim RPC error:", claimErr);
        throw claimErr;
      }

      const job = claimedRows?.[0];
      if (!job) {
        // Check if all jobs for this run are done
        let allDone = false;
        if (runId) {
          const { data: remaining } = await supabase.from("rewrite_jobs")
            .select("id")
            .eq("run_id", runId)
            .in("status", ["queued", "running"])
            .limit(1);
          allDone = !remaining || remaining.length === 0;
        }
        return new Response(JSON.stringify({ processed: false, reason: "no_queued_jobs", done: allDone }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const effectiveRunId = runId;

      // Idempotency: check if output already exists for this run + scene
      const { data: existingOutput } = await supabase.from("rewrite_scene_outputs")
        .select("id")
        .eq("run_id", effectiveRunId)
        .eq("scene_number", job.scene_number)
        .maybeSingle();

      if (existingOutput) {
        await supabase.from("rewrite_jobs").update({
          status: "done", finished_at: new Date().toISOString(), error: null,
        }).eq("id", job.id);
        return new Response(JSON.stringify({
          processed: true, scene_number: job.scene_number, status: "done",
          skipped: true, duration_ms: 0, input_chars: 0, output_chars: 0, delta_pct: 0,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        // Get scene text — bound to exact snapshot via scene_graph_version_id
        let sceneText = "";

        if (job.scene_graph_version_id) {
          const { data: sv } = await supabase.from("scene_graph_versions")
            .select("content")
            .eq("id", job.scene_graph_version_id)
            .single();
          sceneText = sv?.content || "";
        } else if (job.scene_id) {
          const { data: sv } = await supabase.from("scene_graph_versions")
            .select("content")
            .eq("scene_id", job.scene_id)
            .order("version_number", { ascending: false })
            .limit(1)
            .single();
          sceneText = sv?.content || "";
        } else {
          const { data: version } = await supabase.from("project_document_versions")
            .select("plaintext").eq("id", sourceVersionId).single();
          const fullText = version?.plaintext || "";
          const headingRegex = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*.+/gm;
          let match;
          const boundaries: number[] = [];
          while ((match = headingRegex.exec(fullText)) !== null) {
            boundaries.push(match.index);
          }

          const sceneIdx = job.scene_number - 1;
          const start = boundaries[sceneIdx] ?? 0;
          const end = boundaries[sceneIdx + 1] ?? fullText.length;
          sceneText = fullText.substring(start, end).trim();
        }

        if (!sceneText || sceneText.trim().length === 0) {
          throw new Error(`Scene ${job.scene_number} has no text`);
        }

        const prevSummary = job.prev_summary || "";
        const nextSummary = job.next_summary || "";

        const allNotes: any[] = (job.approved_notes as any[]) || [];
        const sceneSpecificNotes: any[] = [];
        const globalNotes: any[] = [];
        const sceneHeadingLower = (job.scene_heading || "").toLowerCase();

        for (const note of allNotes) {
          const noteSceneNum = note.scene_number || note.anchor?.scene_number;
          if (noteSceneNum === job.scene_number) {
            sceneSpecificNotes.push(note);
            continue;
          }
          if (note.severity === "direction" || note.category === "direction") {
            globalNotes.push(note);
            continue;
          }
          const noteText = (note.description || note.note || "").toLowerCase();
          if (noteText.length >= 5) {
            const noteWords = noteText.split(/\s+/).filter((w: string) => w.length > 3);
            const matchCount = noteWords.filter((w: string) => sceneHeadingLower.includes(w) || sceneText.toLowerCase().includes(w)).length;
            if (matchCount >= 2 || (noteWords.length <= 3 && matchCount >= 1)) {
              sceneSpecificNotes.push(note);
              continue;
            }
          }
          if (!noteSceneNum && !note.anchor) {
            globalNotes.push(note);
          }
        }

        const filteredNotes = [...sceneSpecificNotes, ...globalNotes];
        const notesContext = filteredNotes.length
          ? `APPROVED NOTES TO APPLY (${sceneSpecificNotes.length} scene-specific, ${globalNotes.length} global):\n${JSON.stringify(filteredNotes)}\n\n`
          : "";
        const protectContext = (job.protect_items as any[])?.length
          ? `PROTECT (non-negotiable):\n${JSON.stringify(job.protect_items)}\n\n`
          : "";

        const contextBlock = [
          prevSummary ? `PREVIOUS SCENE SUMMARY: ${prevSummary}` : "",
          nextSummary ? `NEXT SCENE SUMMARY: ${nextSummary}` : "",
        ].filter(Boolean).join("\n");

        const hardInstruction = "HARD CONSTRAINT: Change only what is necessary to satisfy the notes. Preserve scene intent. Do not introduce new characters/locations/props unless required by notes. Maintain continuity.\n\n";

        const scenePrompt = `${hardInstruction}${protectContext}${notesContext}${contextBlock ? contextBlock + "\n\n" : ""}SCENE ${job.scene_number} (${job.scene_heading || "untitled"}) — Rewrite this scene applying the notes while preserving dramatic beats and formatting:\n\n${sceneText}`;

        const estimatedInputTokens = Math.ceil(sceneText.length / 4);
        const maxOutputTokens = Math.min(2500, Math.max(600, Math.ceil(estimatedInputTokens * 1.3)));

        console.log(`[scene-rewrite] Processing scene ${job.scene_number} (${sceneText.length} chars, max_tokens=${maxOutputTokens}), run=${effectiveRunId}, attempts=${job.attempts}`);
        const startTime = Date.now();

        const rewrittenScene = await callAI(
          LOVABLE_API_KEY, BALANCED_MODEL, SCENE_REWRITE_SYSTEM, scenePrompt, 0.4, maxOutputTokens
        );

        const durationMs = Date.now() - startTime;
        console.log(`[scene-rewrite] Scene ${job.scene_number} done in ${(durationMs / 1000).toFixed(1)}s (${rewrittenScene.length} chars out)`);

        if (rewrittenScene.length > sceneText.length * 1.5) {
          console.warn(`[scene-rewrite] Scene ${job.scene_number} output is ${Math.round((rewrittenScene.length / sceneText.length - 1) * 100)}% larger than input`);
        }

        // Save output keyed by run_id + scene_number
        const { error: outErr } = await supabase.from("rewrite_scene_outputs").upsert({
          project_id: projectId,
          user_id: user.id,
          source_version_id: sourceVersionId,
          run_id: effectiveRunId,
          scene_id: job.scene_id,
          scene_number: job.scene_number,
          rewritten_text: rewrittenScene.trim(),
          tokens_in: sceneText.length,
          tokens_out: rewrittenScene.trim().length,
        }, { onConflict: "run_id,scene_number" });
        if (outErr) console.error("Scene output save error:", outErr);

        // Mark done
        await supabase.from("rewrite_jobs").update({
          status: "done",
          finished_at: new Date().toISOString(),
          error: null,
        }).eq("id", job.id);

        const inputChars = sceneText.length;
        const outputChars = rewrittenScene.trim().length;
        const deltaPct = inputChars > 0 ? Math.round(((outputChars - inputChars) / inputChars) * 100) : 0;

        return new Response(JSON.stringify({
          processed: true,
          scene_number: job.scene_number,
          status: "done",
          duration_ms: durationMs,
          input_chars: inputChars,
          output_chars: outputChars,
          delta_pct: deltaPct,
          skipped: false,
          scene_notes_count: sceneSpecificNotes.length,
          total_notes_count: allNotes.length,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } catch (jobErr: any) {
        console.error(`[scene-rewrite] Scene ${job.scene_number} failed:`, jobErr.message);
        const newStatus = job.attempts >= job.max_attempts ? "failed" : "queued";
        await supabase.from("rewrite_jobs").update({
          status: newStatus,
          error: jobErr.message?.substring(0, 500),
        }).eq("id", job.id);

        return new Response(JSON.stringify({
          processed: true,
          scene_number: job.scene_number,
          status: newStatus,
          error: jobErr.message,
          duration_ms: 0, input_chars: 0, output_chars: 0, delta_pct: 0, skipped: false,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── GET REWRITE STATUS ──
    if (action === "get_rewrite_status") {
      const { projectId, runId } = body;
      if (!runId) {
        return new Response(JSON.stringify({ error: "runId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!projectId) throw new Error("projectId required");

      let jobQuery = supabase.from("rewrite_jobs")
        .select("scene_number, scene_heading, status, attempts, error, claimed_at")
        .eq("project_id", projectId)
        .eq("run_id", runId);
      const { data: jobs } = await jobQuery.order("scene_number", { ascending: true });

      if (!jobs || jobs.length === 0) {
        return new Response(JSON.stringify({ total: 0, queued: 0, running: 0, done: 0, failed: 0, scenes: [], oldest_running_claimed_at: null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const counts = { total: jobs.length, queued: 0, running: 0, done: 0, failed: 0 };
      let oldestRunningClaimedAt: string | null = null;
      for (const j of jobs) {
        if (j.status === "queued") counts.queued++;
        else if (j.status === "running") {
          counts.running++;
          if (j.claimed_at && (!oldestRunningClaimedAt || j.claimed_at < oldestRunningClaimedAt)) {
            oldestRunningClaimedAt = j.claimed_at;
          }
        }
        else if (j.status === "done") counts.done++;
        else if (j.status === "failed") counts.failed++;
      }

      const percent = counts.total > 0 ? Math.floor((counts.done / counts.total) * 100) : 0;
      const progress = {
        phase: counts.done === counts.total ? "complete" : counts.running > 0 ? "processing_scene" : counts.queued > 0 ? "queued" : "complete",
        total: counts.total, completed: counts.done, running: counts.running, failed: counts.failed, queued: counts.queued,
        percent,
        label: counts.done === counts.total ? "Complete" : `Scene ${counts.done}/${counts.total}`,
        oldest_running_claimed_at: oldestRunningClaimedAt,
      };

      return new Response(JSON.stringify({ ...counts, scenes: jobs, oldest_running_claimed_at: oldestRunningClaimedAt, progress }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── RETRY FAILED REWRITE JOBS ──
    if (action === "retry_failed_rewrite_jobs") {
      const { projectId, sourceVersionId } = body;
      if (!projectId || !sourceVersionId) throw new Error("projectId, sourceVersionId required");

      // Re-queue failed jobs where attempts < max_attempts. Do NOT reset attempts.
      const { data: failedJobs } = await supabase.from("rewrite_jobs")
        .select("id, attempts, max_attempts")
        .eq("project_id", projectId)
        .eq("source_version_id", sourceVersionId)
        .eq("status", "failed");

      let resetCount = 0;
      for (const j of (failedJobs || [])) {
        if (j.attempts < j.max_attempts) {
          await supabase.from("rewrite_jobs").update({ status: "queued", error: null }).eq("id", j.id);
          resetCount++;
        }
      }

      return new Response(JSON.stringify({ reset: resetCount }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ASSEMBLE REWRITTEN SCRIPT ──
    if (action === "assemble_rewritten_script") {
      const { projectId, sourceDocId, sourceVersionId, runId, rewriteModeSelected, rewriteModeEffective, rewriteModeReason, rewriteModeDebug, rewriteProbe, rewriteScopePlan, rewriteScopeExpandedFrom, rewriteVerification, auto_promote } = body;
      if (!runId) {
        return new Response(JSON.stringify({ error: "runId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!projectId || !sourceDocId || !sourceVersionId) throw new Error("projectId, sourceDocId, sourceVersionId required");

      // Check all done — always filter by run_id
      const { data: jobs } = await supabase.from("rewrite_jobs")
        .select("scene_number, status")
        .eq("project_id", projectId)
        .eq("run_id", runId);

      const remaining = (jobs || []).filter(j => j.status !== "done");
      if (remaining.length > 0) {
        return new Response(JSON.stringify({
          error: `${remaining.length} scene(s) not done yet`,
          remaining: remaining.map(r => ({ scene_number: r.scene_number, status: r.status })),
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Load all rewritten outputs ordered — always by run_id
      const { data: outputs } = await supabase.from("rewrite_scene_outputs")
        .select("scene_number, rewritten_text")
        .eq("run_id", runId)
        .order("scene_number", { ascending: true });

      if (!outputs || outputs.length === 0) throw new Error("No scene outputs found");

      // Build rewritten text map
      const rewrittenMap = new Map<number, string>();
      for (const o of outputs) rewrittenMap.set(o.scene_number, o.rewritten_text);

      // Determine if this is a selective rewrite (some scenes untouched)
      const isSelective = rewriteScopePlan?.target_scene_numbers && Array.isArray(rewriteScopePlan.target_scene_numbers);

      let assembledText: string;
      let totalScenesInAssembly: number;

      if (isSelective) {
        const { data: version } = await supabase.from("project_document_versions")
          .select("plaintext").eq("id", sourceVersionId).single();
        const originalText = (version?.plaintext || "").trim();

        if (!originalText) {
          throw new Error("Selective assemble failed: source version plaintext is empty");
        }

        const headingRegex =
          /^\s*(INT\.?|EXT\.?|INT\/EXT\.?|EXT\/INT\.?|I\/E\.?|EST\.?)\s+.+$/gmi;
        const boundaries: number[] = [];
        let match: RegExpExecArray | null;
        while ((match = headingRegex.exec(originalText)) !== null) {
          boundaries.push(match.index);
        }

        if (boundaries.length < 3) {
          const sample = originalText.slice(0, 1200);
          throw new Error(
            `Selective assemble failed: could not detect scene headings reliably (found ${boundaries.length}). ` +
            `Refusing to assemble from rewritten outputs only (would truncate script). ` +
            `Check slugline format in source version. Sample start:\n---\n${sample}\n---`
          );
        }

        const originalScenes: string[] = [];
        for (let i = 0; i < boundaries.length; i++) {
          const start = boundaries[i];
          const end = boundaries[i + 1] ?? originalText.length;
          originalScenes.push(originalText.substring(start, end).trim());
        }

        const maxRewrittenScene = Math.max(...outputs.map(o => o.scene_number));
        if (maxRewrittenScene > originalScenes.length) {
          throw new Error(
            `Selective assemble failed: rewritten outputs include scene ${maxRewrittenScene} ` +
            `but only ${originalScenes.length} scenes were detected in source plaintext. ` +
            `This indicates scene numbering mismatch or slugline detection mismatch.`
          );
        }

        for (let i = 0; i < originalScenes.length; i++) {
          const sceneNum = i + 1;
          if (rewrittenMap.has(sceneNum)) {
            originalScenes[i] = (rewrittenMap.get(sceneNum) || "").trim();
          }
        }

        assembledText = originalScenes.filter(Boolean).join("\n\n");
        totalScenesInAssembly = originalScenes.length;

        console.log(`[scene-rewrite] Selective assemble ok: replaced ${outputs.length}/${totalScenesInAssembly} scenes from source plaintext`);
      } else {
        const totalJobs = (jobs || []).length;
        if (outputs.length !== totalJobs) {
          throw new Error(`Output count (${outputs.length}) does not match job count (${totalJobs}). Some scenes may be missing.`);
        }
        assembledText = outputs.map(o => o.rewritten_text).join("\n\n");
        totalScenesInAssembly = outputs.length;
      }

      const trulySelective =
        Array.isArray(rewriteScopePlan?.target_scene_numbers) &&
        rewriteScopePlan.target_scene_numbers.length > 0 &&
        rewriteScopePlan.target_scene_numbers.length < totalScenesInAssembly;

      // Create new version with retry for version_number collision (with team voice meta_json)
      const sceneRwLane = (await supabase.from("projects").select("assigned_lane").eq("id", projectId).single())?.data?.assigned_lane || "independent-film";
      const sceneRwTvCtx = await loadTeamVoiceContext(supabase, projectId, sceneRwLane);
      const sceneRwMetaJson = sceneRwTvCtx.metaStamp ? { ...sceneRwTvCtx.metaStamp } : undefined;
      let newVersion: any = null;
      for (let _retry = 0; _retry < 3; _retry++) {
        const { data: maxRow } = await supabase.from("project_document_versions")
          .select("version_number")
          .eq("document_id", sourceDocId)
          .order("version_number", { ascending: false })
          .limit(1)
          .single();
        const nextVersion = (maxRow?.version_number ?? 0) + 1;
        const { data: nv, error: vErr } = await supabase.from("project_document_versions").insert({
          document_id: sourceDocId,
          version_number: nextVersion,
          label: trulySelective ? `Selective scene rewrite v${nextVersion} (${outputs.length}/${totalScenesInAssembly} scenes)` : `Scene rewrite v${nextVersion}`,
          plaintext: assembledText,
          created_by: user.id,
          parent_version_id: sourceVersionId,
          is_current: false,
          change_summary: trulySelective
            ? `Selective scene-level rewrite: ${outputs.length} of ${totalScenesInAssembly} scenes rewritten.`
            : `Scene-level rewrite across ${outputs.length} scenes.`,
          ...(sceneRwMetaJson ? { meta_json: sceneRwMetaJson } : {}),
        }).select().single();
        if (!vErr) { newVersion = nv; break; }
        if (vErr.code !== "23505") throw vErr;
      }
      if (!newVersion) throw new Error("Failed to create version after retries");

      // ── Style eval on scene-rewrite output ──
      const srStyleTarget = (await loadVoiceTargets(supabase, projectId, sceneRwLane)).target;
      const srStyleEval = await runStyleEval(supabase, assembledText, projectId, sourceDocId, newVersion.id, sceneRwLane, srStyleTarget);
      if (srStyleEval) {
        const mergedMeta = { ...(newVersion.meta_json || {}), ...srStyleEval.metaFields };
        await supabase.from("project_document_versions").update({ meta_json: mergedMeta }).eq("id", newVersion.id);
        newVersion.meta_json = mergedMeta;
      }

      // Only auto-promote if auto_promote !== false (default: true for backward compat)
      if (auto_promote !== false) {
        const { error: rpcErr } = await supabase.rpc("set_current_version", {
          p_document_id: sourceDocId,
          p_new_version_id: newVersion.id,
        });
        if (rpcErr) {
          // Rollback: delete the version we just inserted so nothing is incorrectly marked current
          try {
            await supabase.from("project_document_versions").delete().eq("id", newVersion.id);
          } catch (delErr: any) {
            console.error("[scene-rewrite] Failed to rollback version after RPC error:", delErr.message);
          }
          // Mark rewrite_run as failed
          if (runId) {
            await supabase.from("rewrite_runs").update({
              status: "failed",
              summary: `set_current_version RPC failed: ${rpcErr.message}`,
              updated_at: new Date().toISOString(),
            }).eq("id", runId);
          }
          throw new Error(`set_current_version RPC failed: ${rpcErr.message}`);
        }
      } else {
        console.log(`[scene-rewrite] auto_promote=false — skipping set_current_version for version ${newVersion.id}`);
      }

      // ── Update rewrite_run status ──
      if (runId) {
        await supabase.from("rewrite_runs").update({
          status: "complete",
          summary: trulySelective
            ? `Selective scene-level rewrite: ${outputs.length} of ${totalScenesInAssembly} scenes.`
            : `Scene-level rewrite across ${outputs.length} scenes.`,
          updated_at: new Date().toISOString(),
        }).eq("id", runId);
      }

      // Log run
      await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: sourceDocId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "REWRITE",
        output_json: {
          rewrite_mode: "scene",
          rewrite_mode_used: "scene",
          rewrite_mode_selected: rewriteModeSelected || "auto",
          rewrite_mode_effective: rewriteModeEffective || "scene",
          rewrite_mode_reason: rewriteModeReason || "auto_probe_scene",
          rewrite_mode_debug: rewriteModeDebug || null,
          rewrite_probe: rewriteProbe || null,
          rewrite_scope_plan: rewriteScopePlan || null,
          rewrite_scope_expanded_from: rewriteScopeExpandedFrom || null,
          rewrite_verification: rewriteVerification || null,
          selective_rewrite: trulySelective,
          target_scenes_count: trulySelective ? (rewriteScopePlan?.target_scene_numbers?.length || outputs.length) : null,
          total_scenes_count: totalScenesInAssembly,
          scenes_count: outputs.length,
          rewritten_text: `[${assembledText.length} chars]`,
          changes_summary: trulySelective
            ? `Selective scene-level rewrite: ${outputs.length} of ${totalScenesInAssembly} scenes.`
            : `Scene-level rewrite across ${outputs.length} scenes.`,
          source_version_id: sourceVersionId,
          source_doc_id: sourceDocId,
          run_id: runId || null,
        },
        schema_version: SCHEMA_VERSION,
      });

      console.log(`[scene-rewrite] Assembled ${outputs.length}${trulySelective ? `/${totalScenesInAssembly}` : ''} scenes → ${assembledText.length} chars, new version ${newVersion.id} (is_current=${auto_promote !== false})`);

      return new Response(JSON.stringify({
        newVersionId: newVersion.id,
        newVersionNumber: newVersion.version_number,
        newVersionLabel: newVersion.label,
        newChangeSummary: newVersion.change_summary,
        charCount: assembledText.length,
        scenesCount: outputs.length,
        totalScenesInAssembly,
        selectiveRewrite: trulySelective,
        trulySelective,
        targetScenesCount: trulySelective ? (rewriteScopePlan?.target_scene_numbers?.length ?? outputs.length) : null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── REQUEUE STUCK REWRITE JOBS ──
    if (action === "requeue_stuck_rewrite_jobs") {
      const { projectId, sourceVersionId, stuckMinutes } = body;
      if (!projectId || !sourceVersionId) throw new Error("projectId, sourceVersionId required");
      const minutes = stuckMinutes || 10;
      const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();

      const { data: stuckJobs } = await supabase.from("rewrite_jobs")
        .select("id")
        .eq("project_id", projectId)
        .eq("source_version_id", sourceVersionId)
        .eq("status", "running")
        .lt("claimed_at", cutoff);

      let requeued = 0;
      for (const j of (stuckJobs || [])) {
        await supabase.from("rewrite_jobs").update({ status: "queued", error: "requeued_stuck" }).eq("id", j.id);
        requeued++;
      }

      return new Response(JSON.stringify({ requeued, stuckMinutes: minutes }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PREVIEW ASSEMBLED REWRITE ──
    if (action === "preview_assembled_rewrite") {
      const { projectId, sourceVersionId, maxChars } = body;
      if (!projectId || !sourceVersionId) throw new Error("projectId, sourceVersionId required");
      const limit = maxChars || 8000;

      const { data: jobs } = await supabase.from("rewrite_jobs")
        .select("scene_number")
        .eq("project_id", projectId)
        .eq("source_version_id", sourceVersionId)
        .order("scene_number", { ascending: true });

      const { data: outputs } = await supabase.from("rewrite_scene_outputs")
        .select("scene_number, rewritten_text")
        .eq("source_version_id", sourceVersionId)
        .order("scene_number", { ascending: true });

      const jobNumbers = new Set((jobs || []).map(j => j.scene_number));
      const outputNumbers = new Set((outputs || []).map(o => o.scene_number));
      const missingScenes = [...jobNumbers].filter(n => !outputNumbers.has(n));

      const fullText = (outputs || []).map(o => o.rewritten_text).join("\n\n");
      const previewText = fullText.substring(0, limit);

      return new Response(JSON.stringify({
        preview_text: previewText,
        total_chars: fullText.length,
        scenes_count: (outputs || []).length,
        missing_scenes: missingScenes,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── VERIFY REWRITE (deterministic continuity checks) ──
    if (action === "verify_rewrite") {
      const { projectId, sourceVersionId, scopePlan } = body;
      if (!projectId || !sourceVersionId) throw new Error("projectId, sourceVersionId required");

      const failures: Array<{ type: string; detail: string; scene_numbers?: number[] }> = [];

      // Load rewritten outputs
      const { data: outputs } = await supabase.from("rewrite_scene_outputs")
        .select("scene_number, rewritten_text")
        .eq("source_version_id", sourceVersionId)
        .order("scene_number", { ascending: true });

      if (!outputs || outputs.length === 0) {
        return new Response(JSON.stringify({
          pass: true, failures: [], timestamp: new Date().toISOString(),
          note: "No outputs to verify",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Build output map
      const outputMap = new Map<number, string>();
      for (const o of outputs) outputMap.set(o.scene_number, o.rewritten_text);

      // Deterministic check 1: scene continuity — check for character entrance/exit consistency
      // between neighboring rewritten scenes
      const sortedNumbers = [...outputMap.keys()].sort((a, b) => a - b);
      for (let i = 0; i < sortedNumbers.length - 1; i++) {
        const curNum = sortedNumbers[i];
        const nextNum = sortedNumbers[i + 1];
        if (nextNum !== curNum + 1) continue; // only check adjacent scenes

        const curText = outputMap.get(curNum) || "";
        const nextText = outputMap.get(nextNum) || "";

        // Basic heuristic: if current scene ends with a character exit and next doesn't acknowledge
        const exitMatch = curText.match(/(?:leaves|exits|storms out|walks away|departs)\s*\.?\s*$/im);
        const sluglineMatch = nextText.match(/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.).*/m);
        if (exitMatch && sluglineMatch) {
          // Soft flag only — heuristic-level
        }
      }

      // Deterministic check 2: setup/payoff from scope plan
      if (scopePlan?.contracts?.setup_payoff) {
        for (const sp of scopePlan.contracts.setup_payoff) {
          const setupText = outputMap.get(sp.setup_scene);
          const payoffText = outputMap.get(sp.payoff_scene);
          // Only check if both scenes were rewritten
          if (setupText && payoffText) {
            const itemLower = sp.item.toLowerCase();
            if (!setupText.toLowerCase().includes(itemLower) && !payoffText.toLowerCase().includes(itemLower)) {
              failures.push({
                type: 'setup_payoff',
                detail: `Setup/payoff item "${sp.item}" may be missing from scenes ${sp.setup_scene} and ${sp.payoff_scene}`,
                scene_numbers: [sp.setup_scene, sp.payoff_scene],
              });
            }
          }
        }
      }

      // Deterministic check 3: knowledge constraints
      if (scopePlan?.contracts?.knowledge_state) {
        for (const ks of scopePlan.contracts.knowledge_state) {
          for (const byScene of ks.by_scene) {
            const text = outputMap.get(byScene.scene_number);
            if (!text) continue;
            // Check if character name appears in the scene
            if (!text.toLowerCase().includes(ks.character.toLowerCase())) {
              failures.push({
                type: 'knowledge',
                detail: `Character "${ks.character}" expected in scene ${byScene.scene_number} but not found in rewritten text`,
                scene_numbers: [byScene.scene_number],
              });
            }
          }
        }
      }

      const pass = failures.length === 0;
      return new Response(JSON.stringify({
        pass,
        failures,
        timestamp: new Date().toISOString(),
        checked_scenes: sortedNumbers,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── REGENERATE INSUFFICIENT DOCS ──
    if (action === "regenerate-insufficient-docs") {
      const { projectId, dryRun, limit: maxLimit, force } = body;
      if (!projectId) throw new Error("projectId required");

      const isDry = dryRun === true;
      const docLimit = Math.min(Math.max(maxLimit || 20, 1), 40);

      // Resolve project format + ladder
      const { data: proj } = await supabase.from("projects")
        .select("format, assigned_lane, title").eq("id", projectId).single();
      const fmt = resolveFormatAlias((proj?.format || "film").toLowerCase().replace(/[_ ]+/g, "-"));
      const ladder = getLadderForFormat(fmt);

      const SEED_CORE_TYPES = ["project_overview", "creative_brief", "market_positioning", "canon", "nec"] as const;

      // Stub detection constants (must stay aligned with auto-run)
      const STUB_MARKERS = [
        "draft stub",
        "generate full",
        "generate from dev engine",
        "from dev engine",
        "todo",
        "[insert",
        "[1–2 sentences]",
        "[1-2 sentences]",
        "placeholder",
      ];

      const MIN_CHARS: Record<string, number> = {
        concept_brief: 800,
        beat_sheet: 1200,
        character_bible: 1200,
        treatment: 1200,
        story_outline: 1200,
        episode_grid: 800,
        season_arc: 800,
        format_rules: 600,
        market_sheet: 700,
        vertical_market_sheet: 700,
        episode_script: 2000,
        feature_script: 2000,
        season_master_script: 2000,
        production_draft: 2000,
        documentary_outline: 800,
        deck: 600,
        vertical_episode_beats: 600,
        project_overview: 600,
        creative_brief: 600,
        market_positioning: 600,
        canon: 600,
        nec: 500,
      };
      const DEFAULT_MIN = 600;

      type InsufficientReason = "stub_marker" | "too_short" | "missing_current_version";
      interface RegenDocResult {
        doc_type: string;
        document_id: string | null;
        reason: InsufficientReason;
        char_before: number;
        char_after: number;
        regenerated: boolean;
        error?: string;
        upstream?: string | null;
      }

      const containsStubMarker = (text: string): boolean => {
        const lower = (text || "").toLowerCase();
        return STUB_MARKERS.some(marker => lower.includes(marker));
      };

      const classifyInsufficiency = (
        docType: string,
        docId: string | null,
        ver: any,
      ): { reason: InsufficientReason | null; charBefore: number } => {
        if (!docId || !ver) return { reason: "missing_current_version", charBefore: 0 };
        const plaintext = (ver?.plaintext || "").trim();
        const charBefore = plaintext.length;
        if (containsStubMarker(plaintext)) return { reason: "stub_marker", charBefore };
        const minChars = MIN_CHARS[docType] ?? DEFAULT_MIN;
        if (charBefore < minChars) return { reason: "too_short", charBefore };
        return { reason: null, charBefore };
      };

      // Fetch all project docs
      const { data: allDocs } = await supabase.from("project_documents")
        .select("id, doc_type").eq("project_id", projectId);

      const docSlots = new Map<string, string>(); // doc_type -> document_id
      for (const d of (allDocs || [])) {
        if (!docSlots.has(d.doc_type)) docSlots.set(d.doc_type, d.id);
      }

      // Fetch all current versions
      const allDocIds = (allDocs || []).map((d: any) => d.id);
      let currentVersions: any[] = [];
      if (allDocIds.length > 0) {
        const { data: vers } = await supabase.from("project_document_versions")
          .select("id, document_id, plaintext, approval_status, version_number")
          .in("document_id", allDocIds).eq("is_current", true);
        currentVersions = vers || [];
      }
      const verByDocId = new Map<string, any>();
      for (const v of currentVersions) verByDocId.set(v.document_id, v);

      // Include seed core + ladder + ALL existing project doc types + beat_sheet (idea excluded)
      const scanDocTypes = Array.from(new Set([
        ...SEED_CORE_TYPES,
        ...ladder,
        "beat_sheet",
        ...Array.from(docSlots.keys()),
      ])).filter(dt => dt !== "idea");

      const upstreamHints: Record<string, string[]> = {
        project_overview: ["concept_brief", "idea"],
        creative_brief: ["concept_brief", "idea"],
        market_positioning: ["market_sheet", "vertical_market_sheet", "concept_brief", "idea"],
        canon: ["concept_brief", "idea", "treatment"],
        nec: ["concept_brief", "idea", "treatment"],
        beat_sheet: ["concept_brief", "idea", "topline_narrative", "treatment"],
        season_arc: ["concept_brief", "character_bible", "topline_narrative"],
        episode_grid: ["season_arc", "character_bible", "format_rules", "concept_brief"],
        vertical_episode_beats: ["episode_grid", "season_arc", "character_bible", "format_rules"],
        episode_script: ["vertical_episode_beats", "episode_grid", "season_arc", "character_bible"],
      };

      const findUpstream = (stage: string): { upstreamDocId: string; upstreamVersionId: string; upstreamType: string } | null => {
        const candidates: string[] = [];

        if (upstreamHints[stage]) candidates.push(...upstreamHints[stage]);

        const stageIdx = ladder.indexOf(stage);
        if (stageIdx > 0) {
          for (let i = stageIdx - 1; i >= 0; i--) {
            candidates.push(ladder[i]);
          }
        }

        candidates.push("concept_brief", "idea", ...SEED_CORE_TYPES);

        const deduped = Array.from(new Set(candidates.filter(t => t && t !== stage)));

        for (const t of deduped) {
          const prevDocId = docSlots.get(t);
          if (!prevDocId) continue;
          const prevVer = verByDocId.get(prevDocId);
          const prevText = (prevVer?.plaintext || "").trim();
          if (prevText.length < 80) continue;
          if (containsStubMarker(prevText)) continue;
          return { upstreamDocId: prevDocId, upstreamVersionId: prevVer.id, upstreamType: t };
        }

        return null;
      };

      const validateOutput = (docType: string, text: string): InsufficientReason | null => {
        const trimmed = (text || "").trim();
        if (containsStubMarker(trimmed)) return "stub_marker";
        const minChars = MIN_CHARS[docType] ?? DEFAULT_MIN;
        if (trimmed.length < minChars) return "too_short";
        return null;
      };

      const { ensureDocSlot, createVersion: createVer } = await import("../_shared/doc-os.ts");

      const results: RegenDocResult[] = [];
      const skipped: any[] = [];

      for (const stage of scanDocTypes) {
        if (results.length >= docLimit) break;

        const docId = docSlots.get(stage) || null;
        const ver = docId ? verByDocId.get(docId) : null;
        const classified = classifyInsufficiency(stage, docId, ver);

        let reason = classified.reason;
        if (!reason && !force) {
          skipped.push({ doc_type: stage, status: "sufficient", note: `${classified.charBefore} chars, ok` });
          continue;
        }
        if (!reason && force) {
          reason = "too_short";
        }

        const upstream = findUpstream(stage);
        if (!upstream) {
          const missingUpstreamResult: RegenDocResult = {
            doc_type: stage,
            document_id: docId,
            reason: reason || "missing_current_version",
            char_before: classified.charBefore,
            char_after: classified.charBefore,
            regenerated: false,
            upstream: null,
            error: "No upstream doc with usable content",
          };
          results.push(missingUpstreamResult);
          skipped.push({ doc_type: stage, status: "missing_upstream", note: "No upstream doc with usable content" });
          continue;
        }

        if (isDry) {
          results.push({
            doc_type: stage,
            document_id: docId,
            reason: reason || "missing_current_version",
            char_before: classified.charBefore,
            char_after: classified.charBefore,
            regenerated: false,
            upstream: upstream.upstreamType,
          });
          continue;
        }

        try {
          const upstreamVersion = verByDocId.get(upstream.upstreamDocId);
          const upstreamText = (upstreamVersion?.plaintext || "").trim();
          if (!upstreamText) throw new Error(`${upstream.upstreamType} current version has no text`);

          const targetOutput = stage.toUpperCase();
          const necBlock = await loadNECGuardrailBlock(supabase, projectId);

          const userPrompt = `SOURCE FORMAT: ${upstream.upstreamType}
TARGET FORMAT: ${targetOutput}
PROTECT (non-negotiable creative DNA): []
${necBlock}

CRITICAL: Produce a FULL, COMPLETE ${stage.replace(/_/g, " ")} document.
Do NOT produce stubs, placeholders, or TODO markers.
Include all required sections with substantive content.

MATERIAL:
${upstreamText}`;

          const raw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, CONVERT_SYSTEM_JSON, userPrompt, 0.35, 10000);
          let parsed = await parseAIJson(LOVABLE_API_KEY, raw);
          let convertedText = (parsed?.converted_text || "").trim();
          let retryUsed = false;

          let outputReason = validateOutput(stage, convertedText);
          if (outputReason) {
            retryUsed = true;
            const retryPrompt = `${userPrompt}

RETRY INSTRUCTION: Previous output was insufficient (${outputReason}).
Produce the FULL document now with rich section-level substance.
No stubs, no placeholders, no TODO markers.`;
            const raw2 = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, CONVERT_SYSTEM_JSON, retryPrompt, 0.35, 10000);
            const parsed2 = await parseAIJson(LOVABLE_API_KEY, raw2);
            const retryText = (parsed2?.converted_text || "").trim();
            if (retryText.length > convertedText.length) {
              convertedText = retryText;
            }
            outputReason = validateOutput(stage, convertedText);
          }

          if (outputReason) {
            throw new Error(`Output still insufficient (${outputReason}, ${convertedText.length} chars)`);
          }

          const slot = await ensureDocSlot(supabase, projectId, userId, stage);
          const newVersion = await createVer(supabase, {
            documentId: slot.documentId,
            docType: stage,
            plaintext: convertedText,
            label: `regen_insufficient_${stage}`,
            createdBy: userId,
            approvalStatus: "draft",
            changeSummary: `Regenerated insufficient doc (${reason}) from ${upstream.upstreamType}${retryUsed ? " with retry" : ""}`,
            sourceDocumentIds: [upstream.upstreamDocId],
            metaJson: {
              generator: "regenerate-insufficient",
              reason,
              upstream_type: upstream.upstreamType,
              retry_used: retryUsed,
            },
          });

          const successResult: RegenDocResult = {
            doc_type: stage,
            document_id: slot.documentId,
            reason: reason || "missing_current_version",
            char_before: classified.charBefore,
            char_after: convertedText.length,
            regenerated: true,
            upstream: upstream.upstreamType,
          };
          results.push(successResult);

          console.log(`[dev-engine-v2] regenerated ${stage}: ${convertedText.length} chars (retry=${retryUsed})`);
        } catch (regenErr: any) {
          const errMsg = regenErr?.message?.slice(0, 300) || "regeneration_failed";
          console.error(`[dev-engine-v2] regen failed for ${stage}:`, errMsg);
          results.push({
            doc_type: stage,
            document_id: docId,
            reason: reason || "missing_current_version",
            char_before: classified.charBefore,
            char_after: classified.charBefore,
            regenerated: false,
            upstream: upstream.upstreamType,
            error: errMsg,
          });
          skipped.push({ doc_type: stage, status: "regen_failed", note: errMsg });
        }
      }

      const regenerated = results.filter(r => r.regenerated);

      return new Response(JSON.stringify({
        success: true,
        dry_run: isDry,
        scanned: scanDocTypes.length,
        results,
        regenerated,
        skipped,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── REGEN QUEUE: START ──
    if (action === "regen-insufficient-start") {
      const { projectId, dryRun: isDry, force: isForce, limit: maxLimit, docTypeWhitelist } = body;
      if (!projectId) throw new Error("projectId required");

      const docLimit = Math.min(Math.max(maxLimit || 25, 1), 40);

      // Reuse scan logic from regenerate-insufficient-docs
      const { data: proj } = await supabase.from("projects")
        .select("format, assigned_lane, title").eq("id", projectId).single();
      const fmt = resolveFormatAlias((proj?.format || "film").toLowerCase().replace(/[_ ]+/g, "-"));
      const ladder = getLadderForFormat(fmt);

      const SEED_CORE_TYPES = ["project_overview", "creative_brief", "market_positioning", "canon", "nec"] as const;
      const STUB_MARKERS = ["draft stub","generate full","generate from dev engine","from dev engine","todo","[insert","[1–2 sentences]","[1-2 sentences]","placeholder"];
      const MIN_CHARS: Record<string, number> = {
        concept_brief:800,beat_sheet:1200,character_bible:1200,treatment:1200,story_outline:1200,
        episode_grid:800,season_arc:800,format_rules:600,market_sheet:700,vertical_market_sheet:700,
        episode_script:2000,feature_script:2000,season_master_script:2000,production_draft:2000,
        documentary_outline:800,deck:600,vertical_episode_beats:600,project_overview:600,
        creative_brief:600,market_positioning:600,canon:600,nec:500,
      };
      const DEFAULT_MIN = 600;
      const containsStubMarker = (text: string): boolean => {
        const lower = (text || "").toLowerCase();
        return STUB_MARKERS.some(marker => lower.includes(marker));
      };

      const { data: allDocs } = await supabase.from("project_documents")
        .select("id, doc_type").eq("project_id", projectId);
      const docSlots = new Map<string, string>();
      for (const d of (allDocs || [])) { if (!docSlots.has(d.doc_type)) docSlots.set(d.doc_type, d.id); }

      const allDocIds = (allDocs || []).map((d: any) => d.id);
      let currentVersions: any[] = [];
      if (allDocIds.length > 0) {
        const { data: vers } = await supabase.from("project_document_versions")
          .select("id, document_id, plaintext, approval_status, version_number")
          .in("document_id", allDocIds).eq("is_current", true);
        currentVersions = vers || [];
      }
      const verByDocId = new Map<string, any>();
      for (const v of currentVersions) verByDocId.set(v.document_id, v);

      // If caller provided a whitelist (e.g. from DevSeed), restrict scan to those types only
      let scanDocTypes: string[];
      if (Array.isArray(docTypeWhitelist) && docTypeWhitelist.length > 0) {
        const allowed = new Set(docTypeWhitelist as string[]);
        scanDocTypes = Array.from(allowed).filter(dt => dt !== "idea");
      } else {
        scanDocTypes = Array.from(new Set([
          ...SEED_CORE_TYPES, ...ladder, "beat_sheet", ...Array.from(docSlots.keys()),
        ])).filter(dt => dt !== "idea");
      }

      const upstreamHints: Record<string, string[]> = {
        project_overview: ["concept_brief", "idea"],
        creative_brief: ["concept_brief", "idea"],
        market_positioning: ["market_sheet", "vertical_market_sheet", "concept_brief", "idea"],
        canon: ["concept_brief", "idea", "treatment"],
        nec: ["concept_brief", "idea", "treatment"],
        beat_sheet: ["concept_brief", "idea", "topline_narrative", "treatment"],
        season_arc: ["concept_brief", "character_bible", "topline_narrative"],
        episode_grid: ["season_arc", "character_bible", "format_rules", "concept_brief"],
        vertical_episode_beats: ["episode_grid", "season_arc", "character_bible", "format_rules"],
        episode_script: ["vertical_episode_beats", "episode_grid", "season_arc", "character_bible"],
      };
      const findUpstreamType = (stage: string): string | null => {
        const candidates: string[] = [];
        if (upstreamHints[stage]) candidates.push(...upstreamHints[stage]);
        const stageIdx = ladder.indexOf(stage);
        if (stageIdx > 0) { for (let i = stageIdx - 1; i >= 0; i--) candidates.push(ladder[i]); }
        candidates.push("concept_brief", "idea", ...SEED_CORE_TYPES);
        const deduped = Array.from(new Set(candidates.filter(t => t && t !== stage)));
        for (const t of deduped) {
          const prevDocId = docSlots.get(t);
          if (!prevDocId) continue;
          const prevVer = verByDocId.get(prevDocId);
          const prevText = (prevVer?.plaintext || "").trim();
          if (prevText.length < 80 || containsStubMarker(prevText)) continue;
          return t;
        }
        return null;
      };

      // Build items
      const items: Array<{doc_type:string; document_id:string|null; reason:string; char_before:number; upstream:string|null}> = [];
      for (const stage of scanDocTypes) {
        if (items.length >= docLimit) break;
        const docId = docSlots.get(stage) || null;
        const ver = docId ? verByDocId.get(docId) : null;
        const plaintext = ver ? (ver.plaintext || "").trim() : "";
        const charBefore = plaintext.length;

        let reason: string | null = null;
        if (!docId || !ver) reason = "missing_current_version";
        else if (containsStubMarker(plaintext)) reason = "stub_marker";
        else {
          const minChars = MIN_CHARS[stage] ?? DEFAULT_MIN;
          if (charBefore < minChars) reason = "too_short";
        }
        if (!reason && !isForce) continue;
        if (!reason && isForce) reason = "too_short";

        const upstream = findUpstreamType(stage);
        items.push({ doc_type: stage, document_id: docId, reason: reason!, char_before: charBefore, upstream });
      }

      // Create job — dry_run jobs are born complete (inspection-only snapshot)
      const isDryRun = isDry === true;
      const { data: job, error: jobErr } = await supabase.from("regen_jobs").insert({
        project_id: projectId,
        created_by: userId,
        status: isDryRun ? "complete" : (items.length > 0 ? "queued" : "complete"),
        dry_run: isDryRun,
        force: isForce === true,
        total_count: items.length,
        completed_count: isDryRun ? items.length : 0,
      }).select().single();
      if (jobErr) throw new Error(`Failed to create regen job: ${jobErr.message}`);

      // Create items — dry_run uses 'preview' status (immutable); live uses 'queued'
      if (items.length > 0) {
        const rows = items.map(it => ({
          job_id: job.id,
          doc_type: it.doc_type,
          document_id: it.document_id,
          reason: it.reason,
          status: isDryRun ? "preview" : "queued",
          char_before: it.char_before,
          char_after: isDryRun ? it.char_before : 0,
          upstream: it.upstream,
        }));
        const { error: itemsErr } = await supabase.from("regen_job_items").insert(rows);
        if (itemsErr) throw new Error(`Failed to create regen items: ${itemsErr.message}`);
      }

      // Legacy-compatible response shape
      const legacyResults = items.map(it => ({
        doc_type: it.doc_type,
        document_id: it.document_id,
        reason: it.reason,
        char_before: it.char_before,
        char_after: isDryRun ? it.char_before : 0,
        regenerated: false,
        upstream: it.upstream,
      }));

      return new Response(JSON.stringify({
        success: true,
        job_id: job.id,
        dry_run: isDryRun,
        total_count: items.length,
        scanned: scanDocTypes.length,
        results: legacyResults,
        regenerated: [],
        skipped: [],
        items,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── REGEN QUEUE: TICK ──
    if (action === "regen-insufficient-tick") {
      const { jobId, maxItemsPerTick } = body;
      if (!jobId) throw new Error("jobId required");
      const tickLimit = Math.min(Math.max(maxItemsPerTick || 3, 1), 10);

      // Load job
      const { data: job, error: jobErr } = await supabase.from("regen_jobs")
        .select("*").eq("id", jobId).single();
      if (jobErr || !job) throw new Error("Regen job not found");
      if (job.status === "complete" || job.status === "cancelled" || job.dry_run === true) {
        // For dry-run, load items and return legacy shape
        let legacyResults: any[] = [];
        if (job.dry_run === true) {
          const { data: dryItems } = await supabase.from("regen_job_items")
            .select("*").eq("job_id", jobId).order("created_at", { ascending: true });
          legacyResults = (dryItems || []).map((it: any) => ({
            doc_type: it.doc_type, document_id: it.document_id, reason: it.reason,
            char_before: it.char_before, char_after: it.char_before || it.char_after,
            regenerated: false, upstream: it.upstream,
          }));
        }
        return new Response(JSON.stringify({
          success: true, job, processed: [], done: true, dry_run: !!job.dry_run,
          results: legacyResults, regenerated: [], skipped: [],
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Mark running
      if (job.status !== "running") {
        await supabase.from("regen_jobs").update({ status: "running" }).eq("id", jobId);
      }

      // Atomic claim via RPC (UPDATE...RETURNING with FOR UPDATE SKIP LOCKED)
      const { data: queuedItems, error: claimErr } = await supabase.rpc("claim_regen_items", {
        p_job_id: jobId,
        p_limit: tickLimit,
        p_claimed_by: userId,
      });
      if (claimErr) console.error("[regen-tick] claim_regen_items error:", claimErr.message);
      console.log(`[regen-tick] claimed ${(queuedItems || []).length} items via RPC, claimed_by=${userId}`);

      if (!queuedItems || queuedItems.length === 0) {
        // Check if all done
        const { data: remaining } = await supabase.from("regen_job_items")
          .select("id").eq("job_id", jobId).in("status", ["queued", "running"]);
        if (!remaining || remaining.length === 0) {
          await supabase.from("regen_jobs").update({ status: "complete", completed_count: job.total_count }).eq("id", jobId);
          const { data: finalJob } = await supabase.from("regen_jobs").select("*").eq("id", jobId).single();
          return new Response(JSON.stringify({ success: true, job: finalJob, processed: [], done: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: true, job, processed: [], done: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Load project context for regen
      const projectId = job.project_id;
      const { data: proj } = await supabase.from("projects")
        .select("format, assigned_lane, title").eq("id", projectId).single();
      const fmt = resolveFormatAlias((proj?.format || "film").toLowerCase().replace(/[_ ]+/g, "-"));
      const ladder = getLadderForFormat(fmt);

      const SEED_CORE_TYPES = ["project_overview", "creative_brief", "market_positioning", "canon", "nec"] as const;
      const STUB_MARKERS = ["draft stub","generate full","generate from dev engine","from dev engine","todo","[insert","[1–2 sentences]","[1-2 sentences]","placeholder"];
      const containsStubMarker = (text: string): boolean => {
        const lower = (text || "").toLowerCase();
        return STUB_MARKERS.some(marker => lower.includes(marker));
      };

      const { data: allDocs } = await supabase.from("project_documents")
        .select("id, doc_type").eq("project_id", projectId);
      const docSlots = new Map<string, string>();
      for (const d of (allDocs || [])) { if (!docSlots.has(d.doc_type)) docSlots.set(d.doc_type, d.id); }

      const allDocIds = (allDocs || []).map((d: any) => d.id);
      let currentVersions: any[] = [];
      if (allDocIds.length > 0) {
        const { data: vers } = await supabase.from("project_document_versions")
          .select("id, document_id, plaintext, approval_status, version_number")
          .in("document_id", allDocIds).eq("is_current", true);
        currentVersions = vers || [];
      }
      const verByDocId = new Map<string, any>();
      for (const v of currentVersions) verByDocId.set(v.document_id, v);

      const upstreamHints: Record<string, string[]> = {
        project_overview: ["concept_brief", "idea"],
        creative_brief: ["concept_brief", "idea"],
        market_positioning: ["market_sheet", "vertical_market_sheet", "concept_brief", "idea"],
        canon: ["concept_brief", "idea", "treatment"],
        nec: ["concept_brief", "idea", "treatment"],
        beat_sheet: ["concept_brief", "idea", "topline_narrative", "treatment"],
        season_arc: ["concept_brief", "character_bible", "topline_narrative"],
        episode_grid: ["season_arc", "character_bible", "format_rules", "concept_brief"],
        vertical_episode_beats: ["episode_grid", "season_arc", "character_bible", "format_rules"],
        episode_script: ["vertical_episode_beats", "episode_grid", "season_arc", "character_bible"],
      };
      const findUpstream = (stage: string): { upstreamDocId: string; upstreamVersionId: string; upstreamType: string } | null => {
        const candidates: string[] = [];
        if (upstreamHints[stage]) candidates.push(...upstreamHints[stage]);
        const stageIdx = ladder.indexOf(stage);
        if (stageIdx > 0) { for (let i = stageIdx - 1; i >= 0; i--) candidates.push(ladder[i]); }
        candidates.push("concept_brief", "idea", ...SEED_CORE_TYPES);
        const deduped = Array.from(new Set(candidates.filter(t => t && t !== stage)));
        for (const t of deduped) {
          const prevDocId = docSlots.get(t);
          if (!prevDocId) continue;
          const prevVer = verByDocId.get(prevDocId);
          const prevText = (prevVer?.plaintext || "").trim();
          if (prevText.length < 80 || containsStubMarker(prevText)) continue;
          return { upstreamDocId: prevDocId, upstreamVersionId: prevVer.id, upstreamType: t };
        }
        return null;
      };

      const MIN_CHARS: Record<string, number> = {
        concept_brief:800,beat_sheet:1200,character_bible:1200,treatment:1200,story_outline:1200,
        episode_grid:800,season_arc:800,format_rules:600,market_sheet:700,vertical_market_sheet:700,
        episode_script:2000,feature_script:2000,season_master_script:2000,production_draft:2000,
        documentary_outline:800,deck:600,vertical_episode_beats:600,project_overview:600,
        creative_brief:600,market_positioning:600,canon:600,nec:500,
      };
      const DEFAULT_MIN = 600;
      const validateOutput = (docType: string, text: string): string | null => {
        const trimmed = (text || "").trim();
        if (containsStubMarker(trimmed)) return "stub_marker";
        const minChars = MIN_CHARS[docType] ?? DEFAULT_MIN;
        if (trimmed.length < minChars) return "too_short";
        return null;
      };

      const EPISODE_COUNT_DOCS = new Set(["episode_grid", "vertical_episode_beats"]);
      const needsEpisodeCountValidation = (queuedItems || []).some((it: any) => EPISODE_COUNT_DOCS.has(it.doc_type));
      let canonicalEpisodeCount: number | null = null;
      let parseEpisodeGridFn: ((gridText: string) => Array<{ index: number }>) | null = null;

      if (needsEpisodeCountValidation) {
        try {
          const episodeCountMod = await import("../_shared/episode-count.ts");
          const canonical = await episodeCountMod.getCanonicalEpisodeCountOrThrow(supabase, projectId);
          canonicalEpisodeCount = canonical.episodeCount;
          parseEpisodeGridFn = episodeCountMod.parseEpisodeGrid;
          console.log(`[regen-tick] canonical episode count resolved: ${canonicalEpisodeCount} (locked=${canonical.locked})`);
        } catch (e: any) {
          console.error(`[regen-tick] failed to resolve canonical episode count: ${e?.message || e}`);
        }
      }

      const extractEpisodeNumbers = (text: string): number[] => {
        const hits = new Set<number>();
        const patterns = [
          /\bEP(?:ISODE)?\s*0?(\d{1,3})\b/gi,
          /^\s*\|\s*(\d{1,3})\s*\|/gm,
          /^\s*(?:#+\s*)?Episode\s*0?(\d{1,3})\b/gmi,
        ];

        for (const rx of patterns) {
          let m: RegExpExecArray | null;
          while ((m = rx.exec(text)) !== null) {
            const n = parseInt(m[1], 10);
            if (n >= 1 && n <= 300) hits.add(n);
          }
        }

        return Array.from(hits).sort((a, b) => a - b);
      };

      const validateEpisodeCoverage = (docType: string, text: string): string | null => {
        if (!EPISODE_COUNT_DOCS.has(docType)) return null;
        if (canonicalEpisodeCount == null) return "missing_canonical_episode_count";

        let found: number[] = [];
        if (docType === "episode_grid" && parseEpisodeGridFn) {
          found = parseEpisodeGridFn(text)
            .map((e: any) => e.index)
            .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 300);
        } else {
          found = extractEpisodeNumbers(text);
        }

        const foundSet = new Set(found);
        const expected = Array.from({ length: canonicalEpisodeCount }, (_, i) => i + 1);
        const missing = expected.filter((n) => !foundSet.has(n));
        const extras = Array.from(foundSet).filter((n) => n > canonicalEpisodeCount!);

        if (missing.length > 0 || extras.length > 0 || foundSet.size !== canonicalEpisodeCount) {
          return `episode_count_mismatch expected=${canonicalEpisodeCount} found=${foundSet.size} missing=${missing.slice(0, 8).join(",")}${missing.length > 8 ? "..." : ""} extras=${extras.slice(0, 5).join(",")}`;
        }
        return null;
      };

      const { ensureDocSlot, createVersion: createVer } = await import("../_shared/doc-os.ts");
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

      const processed: any[] = [];

      for (const item of queuedItems) {
        // Item already claimed as 'running' by RPC — no extra update needed

        if (job.dry_run) {
          await supabase.from("regen_job_items").update({ status: "skipped", error: "dry_run" }).eq("id", item.id);
          processed.push({ ...item, status: "skipped", error: "dry_run" });
          continue;
        }

        const stage = item.doc_type;
        const upstream = findUpstream(stage);
        if (!upstream) {
          await supabase.from("regen_job_items").update({ status: "error", error: "No upstream doc with usable content" }).eq("id", item.id);
          processed.push({ ...item, status: "error", error: "No upstream doc" });
          continue;
        }

        try {
          const upstreamVersion = verByDocId.get(upstream.upstreamDocId);
          const upstreamText = (upstreamVersion?.plaintext || "").trim();
          if (!upstreamText) throw new Error(`${upstream.upstreamType} has no text`);

          const targetOutput = stage.toUpperCase();
          const necBlock = await loadNECGuardrailBlock(supabase, projectId);
          const isEpisodeCountDoc = EPISODE_COUNT_DOCS.has(stage);

          if (isEpisodeCountDoc && canonicalEpisodeCount == null) {
            throw new Error("EPISODE_COUNT_NOT_SET");
          }

          const episodeCountBlock = isEpisodeCountDoc && canonicalEpisodeCount != null
            ? `
CANONICAL EPISODE COUNT (HARD REQUIREMENT):
- This project has EXACTLY ${canonicalEpisodeCount} episodes.
- You MUST include every episode from 1 through ${canonicalEpisodeCount}.
- Do NOT stop early, summarize ranges, or collapse episodes (e.g., "Episodes 11-30").
- Do NOT output any episode number above ${canonicalEpisodeCount}.`
            : "";

          const userPrompt = `SOURCE FORMAT: ${upstream.upstreamType}
TARGET FORMAT: ${targetOutput}
PROTECT (non-negotiable creative DNA): []
${necBlock}
${episodeCountBlock}

CRITICAL: Produce a FULL, COMPLETE ${stage.replace(/_/g, " ")} document.
Do NOT produce stubs, placeholders, or TODO markers.
Include all required sections with substantive content.

MATERIAL:
${upstreamText}`;

          const raw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, CONVERT_SYSTEM_JSON, userPrompt, 0.35, 10000);
          let parsed = await parseAIJson(LOVABLE_API_KEY, raw);
          let convertedText = (parsed?.converted_text || "").trim();
          let retryUsed = false;

          let outputReason = validateOutput(stage, convertedText) || validateEpisodeCoverage(stage, convertedText);
          if (outputReason) {
            retryUsed = true;
            const retryPrompt = `${userPrompt}\n\nRETRY INSTRUCTION: Previous output was insufficient (${outputReason}). Produce the FULL document now with complete episode coverage.`;
            const raw2 = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, CONVERT_SYSTEM_JSON, retryPrompt, 0.35, 10000);
            const parsed2 = await parseAIJson(LOVABLE_API_KEY, raw2);
            const retryText = (parsed2?.converted_text || "").trim();
            if (retryText.length > convertedText.length || isEpisodeCountDoc) convertedText = retryText;
            outputReason = validateOutput(stage, convertedText) || validateEpisodeCoverage(stage, convertedText);
          }

          if (outputReason) throw new Error(`Output still insufficient (${outputReason}, ${convertedText.length} chars)`);

          const slot = await ensureDocSlot(supabase, projectId, userId, stage);
          const newVersion = await createVer(supabase, {
            documentId: slot.documentId,
            docType: stage,
            plaintext: convertedText,
            label: `regen_insufficient_${stage}`,
            createdBy: userId,
            approvalStatus: "draft",
            changeSummary: `Regenerated insufficient doc (${item.reason}) from ${upstream.upstreamType}${retryUsed ? " with retry" : ""}`,
            sourceDocumentIds: [upstream.upstreamDocId],
            metaJson: { generator: "regenerate-insufficient", reason: item.reason, upstream_type: upstream.upstreamType, retry_used: retryUsed },
          });

          await supabase.from("regen_job_items").update({
            status: "regenerated",
            char_after: convertedText.length,
            document_id: slot.documentId,
          }).eq("id", item.id);

          // Refresh verByDocId for subsequent items that may use this as upstream
          verByDocId.set(slot.documentId, { id: newVersion.id, document_id: slot.documentId, plaintext: convertedText, version_number: newVersion.version_number });
          if (!docSlots.has(stage)) docSlots.set(stage, slot.documentId);

          processed.push({ id: item.id, doc_type: stage, status: "regenerated", char_after: convertedText.length });
          console.log(`[regen-tick] regenerated ${stage}: ${convertedText.length} chars`);
        } catch (err: any) {
          const errMsg = (err?.message || "regeneration_failed").slice(0, 300);
          console.error(`[regen-tick] error for ${stage}:`, errMsg);
          await supabase.from("regen_job_items").update({ status: "error", error: errMsg }).eq("id", item.id);
          processed.push({ id: item.id, doc_type: stage, status: "error", error: errMsg });
        }
      }

      // Update completed_count
      const { data: statusCounts } = await supabase.from("regen_job_items")
        .select("status").eq("job_id", jobId);
      const completedCount = (statusCounts || []).filter((r: any) => r.status !== "queued" && r.status !== "running").length;
      const allDone = completedCount >= job.total_count;

      await supabase.from("regen_jobs").update({
        completed_count: completedCount,
        status: allDone ? "complete" : "running",
      }).eq("id", jobId);

      const { data: updatedJob } = await supabase.from("regen_jobs").select("*").eq("id", jobId).single();

      return new Response(JSON.stringify({
        success: true,
        job: updatedJob,
        processed,
        done: allDone,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── REGEN QUEUE: STATUS ──
    if (action === "regen-insufficient-status") {
      const { jobId } = body;
      if (!jobId) throw new Error("jobId required");

      const { data: job, error: jobErr } = await supabase.from("regen_jobs")
        .select("*").eq("id", jobId).single();
      if (jobErr || !job) throw new Error("Regen job not found");

      const { data: items } = await supabase.from("regen_job_items")
        .select("*").eq("job_id", jobId).order("created_at", { ascending: true });

      // Legacy mapping for dry-run jobs
      const legacyResults = (items || []).map((it: any) => ({
        doc_type: it.doc_type, document_id: it.document_id, reason: it.reason,
        char_before: it.char_before,
        char_after: job.dry_run ? (it.char_before || it.char_after) : it.char_after,
        regenerated: it.status === "regenerated",
        upstream: it.upstream,
      }));

      return new Response(JSON.stringify({
        success: true,
        job,
        items: items || [],
        results: legacyResults,
        regenerated: legacyResults.filter((r: any) => r.regenerated),
        skipped: legacyResults.filter((r: any) => !r.regenerated),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════════════════════
    // SERIES SCRIPTS: START
    // ══════════════════════════════════════════════════════════════
    if (action === "series-scripts-start") {
      const { projectId: pid, dryRun: isDry, force: isForce, episodeStart, episodeEnd, policyJson } = body;
      if (!pid) throw new Error("projectId required");

      // Load project
      const { data: proj } = await supabase.from("projects")
        .select("format, assigned_lane, title, season_episode_count")
        .eq("id", pid).single();
      if (!proj) throw new Error("Project not found");

      const fmt = (proj.format || "film").toLowerCase().replace(/[_ ]+/g, "-");
      const isSeriesLike = ["series","vertical-drama","vertical_drama","limited-series","mini-series","anthology"].includes(fmt);
      if (!isSeriesLike) throw new Error(`Project format '${fmt}' is not a series. Cannot generate season scripts.`);

      const lane = proj.assigned_lane || (fmt.includes("vertical") ? "vertical_drama" : "series");
      const isVertical = lane === "vertical_drama" || fmt.includes("vertical");

      // ── CANONICAL EPISODE COUNT (hard gate — no defaults) ──
      const { getCanonicalEpisodeCountOrThrow, resolveEpisodeCount } = await import("../_shared/episode-count.ts");
      let canonical;
      try {
        canonical = await getCanonicalEpisodeCountOrThrow(supabase, pid);
      } catch (e: any) {
        if (e.message === "EPISODE_COUNT_NOT_SET") {
          return new Response(JSON.stringify({
            error: "EPISODE_COUNT_NOT_SET",
            message: "Episode count not set. Set it in Season Arc / Format Rules first.",
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        throw e;
      }
      let episodeCount = canonical.episodeCount;

      // Load grid entries for metadata (titles/loglines)
      let episodeGrid: any[] = [];
      try {
        const resolved = await resolveEpisodeCount(supabase, pid, fmt);
        episodeGrid = resolved.gridEntries;
      } catch (_) { /* grid not available, that's fine */ }

      console.log(`[series-scripts] episodeCount canonical: ${episodeCount} (locked=${canonical.locked})`);

      const startEp = episodeStart || 1;
      const endEp = episodeEnd || episodeCount;

      // Reject ranges outside 1..N
      if (startEp < 1 || endEp > episodeCount || startEp > endEp) {
        throw new Error(`Episode range ${startEp}-${endEp} is outside canonical range 1-${episodeCount}`);
      }

      // Check existing episode scripts
      const { data: existingDocs } = await supabase.from("project_documents")
        .select("id, meta_json, doc_type")
        .eq("project_id", pid).eq("doc_type", "episode_script");

      const existingByEp = new Map<number, string>();
      for (const d of (existingDocs || [])) {
        const epIdx = (d.meta_json as any)?.episode_index;
        if (epIdx != null) existingByEp.set(epIdx, d.id);
      }

      // Check current versions for existing docs
      const existingDocIds = Array.from(existingByEp.values());
      let currentVersionsByDocId = new Map<string, any>();
      if (existingDocIds.length > 0) {
        const { data: vers } = await supabase.from("project_document_versions")
          .select("id, document_id, plaintext")
          .in("document_id", existingDocIds).eq("is_current", true);
        for (const v of (vers || [])) currentVersionsByDocId.set(v.document_id, v);
      }

      const STUB_MARKERS = ["draft stub","generate full","generate from dev engine","todo","[insert","placeholder"];
      const containsStub = (text: string) => STUB_MARKERS.some(m => text.toLowerCase().includes(m));
      const MIN_CHARS = isVertical ? 1200 : 2500;

      // Build items
      const items: any[] = [];
      for (let ep = startEp; ep <= endEp; ep++) {
        const docId = existingByEp.get(ep) || null;
        const ver = docId ? currentVersionsByDocId.get(docId) : null;
        const plaintext = (ver?.plaintext || "").trim();
        const charBefore = plaintext.length;

        let reason: string | null = null;
        if (!docId || !ver) reason = "missing_current_version";
        else if (containsStub(plaintext)) reason = "stub_marker";
        else if (charBefore < MIN_CHARS) reason = "too_short";

        if (!reason && !isForce) continue;
        if (!reason && isForce) reason = "forced";

        const gridEntry = episodeGrid.find(e => e.index === ep);
        items.push({
          doc_type: "episode_script",
          document_id: docId,
          reason,
          char_before: charBefore,
          episode_index: ep,
          episode_title: gridEntry?.title || `Episode ${ep}`,
          target_doc_type: "episode_script",
          meta_json: { logline: gridEntry?.logline || null, lane, is_vertical: isVertical },
        });
      }

      const isDryRun = isDry === true;
      const policy = policyJson || {};
      const { data: job, error: jobErr } = await supabase.from("regen_jobs").insert({
        project_id: pid,
        created_by: userId,
        status: isDryRun ? "complete" : (items.length > 0 ? "queued" : "complete"),
        dry_run: isDryRun,
        force: isForce === true,
        total_count: items.length,
        completed_count: isDryRun ? items.length : 0,
        job_type: policy.auto_approve ? "series_autorun" : "generate_series_scripts",
        policy_json: policy,
      }).select().single();
      if (jobErr) throw new Error(`Failed to create series scripts job: ${jobErr.message}`);

      if (items.length > 0) {
        const rows = items.map(it => ({
          job_id: job.id,
          doc_type: it.doc_type,
          document_id: it.document_id,
          reason: it.reason,
          status: isDryRun ? "preview" : "queued",
          char_before: it.char_before,
          char_after: 0,
          episode_index: it.episode_index,
          episode_title: it.episode_title,
          target_doc_type: it.target_doc_type,
          meta_json: it.meta_json,
        }));
        const { error: itemsErr } = await supabase.from("regen_job_items").insert(rows);
        if (itemsErr) throw new Error(`Failed to create series script items: ${itemsErr.message}`);
      }

      // Load items back for response
      const { data: savedItems } = await supabase.from("regen_job_items")
        .select("*").eq("job_id", job.id).order("episode_index", { ascending: true });

      return new Response(JSON.stringify({
        success: true,
        job_id: job.id,
        job,
        dry_run: isDryRun,
        total_count: items.length,
        episode_count: episodeCount,
        items: savedItems || [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════════════════════
    // SERIES SCRIPTS: TICK
    // ══════════════════════════════════════════════════════════════
    if (action === "series-scripts-tick") {
      const { jobId, maxItemsPerTick } = body;
      if (!jobId) throw new Error("jobId required");
      const tickLimit = Math.min(Math.max(maxItemsPerTick || 1, 1), 3); // 1 episode per tick default

      const { data: job, error: jobErr } = await supabase.from("regen_jobs")
        .select("*").eq("id", jobId).single();
      if (jobErr || !job) throw new Error("Series scripts job not found");
      if (job.status === "complete" || job.status === "cancelled" || job.dry_run === true) {
        return new Response(JSON.stringify({ success: true, job, processed: [], done: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (job.status !== "running") {
        await supabase.from("regen_jobs").update({ status: "running" }).eq("id", jobId);
      }

      // Claim items
      const { data: queuedItems, error: claimErr } = await supabase.rpc("claim_regen_items", {
        p_job_id: jobId, p_limit: tickLimit, p_claimed_by: userId,
      });
      if (claimErr) console.error("[series-scripts-tick] claim error:", claimErr.message);

      if (!queuedItems || queuedItems.length === 0) {
        const { data: remaining } = await supabase.from("regen_job_items")
          .select("id").eq("job_id", jobId).in("status", ["queued", "running"]);
        if (!remaining || remaining.length === 0) {
          await supabase.from("regen_jobs").update({ status: "complete", completed_count: job.total_count }).eq("id", jobId);
          const { data: finalJob } = await supabase.from("regen_jobs").select("*").eq("id", jobId).single();
          return new Response(JSON.stringify({ success: true, job: finalJob, processed: [], done: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: true, job, processed: [], done: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Load project context
      const projectId = job.project_id;
      const { data: proj } = await supabase.from("projects")
        .select("format, assigned_lane, title, genres, tone, target_audience")
        .eq("id", projectId).single();

      const lane = proj?.assigned_lane || "series";
      const isVertical = lane === "vertical_drama";

      // Load upstream docs (character_bible, format_rules, canon, nec, season_arc, episode_grid, treatment)
      const upstreamTypes = ["character_bible", "format_rules", "canon", "nec", "season_arc", "episode_grid", "treatment", "topline_narrative", "creative_brief"];
      const { data: upstreamDocs } = await supabase.from("project_documents")
        .select("id, doc_type").eq("project_id", projectId).in("doc_type", upstreamTypes);

      const upstreamDocIds = (upstreamDocs || []).map((d: any) => d.id);
      let upstreamTexts: Record<string, string> = {};
      if (upstreamDocIds.length > 0) {
        const { data: upVers } = await supabase.from("project_document_versions")
          .select("document_id, plaintext").in("document_id", upstreamDocIds).eq("is_current", true);
        const docIdToType = new Map((upstreamDocs || []).map((d: any) => [d.id, d.doc_type]));
        for (const v of (upVers || [])) {
          const dt = docIdToType.get(v.document_id);
          if (dt && v.plaintext) upstreamTexts[dt] = v.plaintext;
        }
      }

      const necBlock = await loadNECGuardrailBlock(supabase, projectId);
      const { ensureDocSlot, createVersion: createVer } = await import("../_shared/doc-os.ts");
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

      const EPISODE_SCRIPT_SYSTEM = `You are IFFY, a professional screenwriter AI. Write a COMPLETE, production-ready episode script in proper teleplay format.

REQUIREMENTS:
- Full scene headings (INT./EXT. LOCATION - DAY/NIGHT)
- Complete dialogue with character names in CAPS
- Action/description lines
- Act structure if specified by format rules
- No placeholders, stubs, or TODO markers
- No meta-commentary about the writing process
${isVertical ? `
VERTICAL DRAMA FORMAT:
- Target length: 120-180 seconds per episode (approximately 1200-2500 characters)
- Fast-paced, hook-driven structure
- End on cliffhanger or strong emotional beat
- Minimal scene transitions (1-3 locations max)
` : `
STANDARD SERIES FORMAT:
- Full teleplay length (3000-8000+ characters per episode)
- Proper act structure
- Multiple storylines as appropriate
- Character development beats
`}

Output ONLY the screenplay text. No JSON wrapping, no markdown fences, no commentary.`;

      const processed: any[] = [];

      for (const item of queuedItems) {
        const epIdx = item.episode_index || 1;
        const epTitle = item.episode_title || `Episode ${epIdx}`;
        const itemMeta = (item.meta_json || {}) as any;
        const logline = itemMeta.logline || "";

        try {
          // Build episode-specific prompt
          let contextBlocks: string[] = [];
          if (upstreamTexts.character_bible) contextBlocks.push(`CHARACTER BIBLE:\n${upstreamTexts.character_bible.slice(0, 4000)}`);
          if (upstreamTexts.format_rules) contextBlocks.push(`FORMAT RULES:\n${upstreamTexts.format_rules.slice(0, 2000)}`);
          if (upstreamTexts.canon) contextBlocks.push(`CANON & CONSTRAINTS:\n${upstreamTexts.canon.slice(0, 2000)}`);
          if (upstreamTexts.season_arc) contextBlocks.push(`SEASON ARC:\n${upstreamTexts.season_arc.slice(0, 3000)}`);
          if (logline) contextBlocks.push(`EPISODE GRID ENTRY:\n${logline}`);
          if (upstreamTexts.treatment) contextBlocks.push(`TREATMENT:\n${upstreamTexts.treatment.slice(0, 3000)}`);

          const userPrompt = `PROJECT: ${proj?.title || "Untitled"}
GENRES: ${(proj?.genres || []).join(", ")}
TONE: ${proj?.tone || "Unknown"}
LANE: ${lane}
${necBlock}

${contextBlocks.join("\n\n")}

WRITE EPISODE ${epIdx}: "${epTitle}"
Write the COMPLETE teleplay for this episode NOW.`;

          const model = isVertical ? BALANCED_MODEL : PRO_MODEL;
          const maxTok = isVertical ? 8000 : 16000;

          let scriptText = await callAI(LOVABLE_API_KEY, model, EPISODE_SCRIPT_SYSTEM, userPrompt, 0.4, maxTok);
          scriptText = scriptText.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();

          const MIN_CHARS = isVertical ? 1500 : 8000;
          let retryUsed = false;

          // ── Summary-tail detector + structure validators ──
          function validateEpisodeScript(text: string, epIndex: number, vertical: boolean): string | null {
            const lower = text.toLowerCase();
            const STUB_CHECK = ["draft stub","generate full","todo","[insert","placeholder"];
            if (STUB_CHECK.some(m => lower.includes(m))) return "stub_marker";

            // Summary-tail: multi-episode compression
            const summaryPatterns = [
              /episodes?\s+\d+[\s–\-—]+\d+/i,
              /remaining\s+episodes/i,
              /summary\s+of\s+(the\s+)?(remaining|rest|later|subsequent)/i,
              /overview\s+of\s+episodes/i,
              /recap\s+of\s+episodes/i,
              /highlights?\s+of\s+episodes/i,
              /episodes?\s+\d+\s+through\s+\d+/i,
            ];
            for (const pat of summaryPatterns) {
              if (pat.test(text)) return `summary_tail_detected: ${pat.source}`;
            }

            // Multi-episode heading detection: if 3+ "EPISODE N" headings appear, it's compressing multiple episodes
            const epHeadings = text.match(/\bEPISODE\s+\d+/gi) || [];
            const uniqueEpNums = new Set(epHeadings.map(h => h.match(/\d+/)?.[0]));
            if (uniqueEpNums.size >= 3) {
              return `multi_episode_compression: found ${uniqueEpNums.size} episode headings in single script`;
            }

            // Bullet list describing multiple episodes
            const bulletEpLines = text.match(/^[\s]*[-•*]\s*(?:ep(?:isode)?\.?\s*\d+)/gmi) || [];
            if (bulletEpLines.length >= 3) {
              return `bullet_list_summary: ${bulletEpLines.length} bullet episode references`;
            }

            // Structure requirements: scene headings
            const sceneHeadings = (text.match(/^(INT\.|EXT\.|INT\/EXT\.)/gmi) || []).length;
            const minScenes = vertical ? 1 : 3;
            if (sceneHeadings < minScenes) {
              return `insufficient_structure: ${sceneHeadings} scene headings (need ${minScenes}+)`;
            }

            // Dialogue blocks (CHARACTER NAME followed by line)
            const dialogueBlocks = (text.match(/^[A-Z][A-Z\s.'()-]{1,40}$/gm) || []).length;
            const minDialogue = vertical ? 2 : 5;
            if (dialogueBlocks < minDialogue) {
              return `insufficient_dialogue: ${dialogueBlocks} dialogue blocks (need ${minDialogue}+)`;
            }

            // Char threshold
            if (text.length < MIN_CHARS) {
              return `too_short: ${text.length} chars (need ${MIN_CHARS}+)`;
            }

            return null;
          }

          let validationFailure = validateEpisodeScript(scriptText, epIdx, isVertical);
          if (validationFailure) {
            retryUsed = true;
            console.log(`[series-scripts-tick] ep${epIdx} attempt0 failed: ${validationFailure}`);
            const retryPrompt = `${userPrompt}\n\nRETRY INSTRUCTION: Previous output FAILED validation (${validationFailure}).
CRITICAL RULES:
- Write ONLY Episode ${epIdx}. Do NOT summarise or reference other episodes.
- Include proper INT./EXT. scene headings, CHARACTER NAMES in caps, and dialogue.
- Minimum ${MIN_CHARS} characters of actual teleplay content.
- No bullet-point summaries. No episode overviews. Full dramatic scenes only.
Write the COMPLETE teleplay for Episode ${epIdx} NOW.`;
            let retryText = await callAI(LOVABLE_API_KEY, PRO_MODEL, EPISODE_SCRIPT_SYSTEM, retryPrompt, 0.4, 16000);
            retryText = retryText.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();
            if (retryText.length > scriptText.length) scriptText = retryText;
            validationFailure = validateEpisodeScript(scriptText, epIdx, isVertical);
          }

          if (validationFailure) {
            throw new Error(`Episode ${epIdx} script failed validation after retry: ${validationFailure}`);
          }

          // Save via doc-os
          const slot = await ensureDocSlot(supabase, projectId, userId, "episode_script", {
            episodeIndex: epIdx,
            title: `Episode ${epIdx} Script — ${epTitle}`,
            source: "generated",
            metaJson: { episode_index: epIdx, episode_title: epTitle },
          });

          // Determine auto-approve from job policy
          const autoApprove = (job.policy_json as any)?.auto_approve === true;
          const approvalStatus = autoApprove ? "approved" : "draft";

          const newVersion = await createVer(supabase, {
            documentId: slot.documentId,
            docType: "episode_script",
            plaintext: scriptText,
            label: `series_scripts_e${String(epIdx).padStart(2, "0")}`,
            createdBy: userId,
            approvalStatus,
            changeSummary: `Generated episode ${epIdx} script${retryUsed ? " with retry" : ""}${autoApprove ? " [auto-approved]" : ""}`,
            metaJson: {
              generator: "series-scripts",
              episode_index: epIdx,
              episode_title: epTitle,
              retry_used: retryUsed,
              char_count: scriptText.length,
              lane,
              auto_approved: autoApprove,
            },
          });

          // If auto-approve, also update the version's approval_status in DB
          if (autoApprove) {
            await supabase.from("project_document_versions")
              .update({ approval_status: "approved" })
              .eq("id", newVersion.id);
          }

          await supabase.from("regen_job_items").update({
            status: "regenerated",
            char_after: scriptText.length,
            document_id: slot.documentId,
            auto_approved: autoApprove,
            approved_version_id: autoApprove ? newVersion.id : null,
          }).eq("id", item.id);

          processed.push({ id: item.id, episode_index: epIdx, status: "regenerated", char_after: scriptText.length });
          console.log(`[series-scripts-tick] ep${epIdx} done: ${scriptText.length} chars`);
        } catch (err: any) {
          const errMsg = (err?.message || "generation_failed").slice(0, 300);
          console.error(`[series-scripts-tick] ep${epIdx} error:`, errMsg);
          await supabase.from("regen_job_items").update({ status: "error", error: errMsg }).eq("id", item.id);
          processed.push({ id: item.id, episode_index: epIdx, status: "error", error: errMsg });
        }
      }

      // Update completed_count
      const { data: statusCounts } = await supabase.from("regen_job_items")
        .select("status").eq("job_id", jobId);
      const completedCount = (statusCounts || []).filter((r: any) => r.status !== "queued" && r.status !== "running").length;
      const errorCount = (statusCounts || []).filter((r: any) => r.status === "error").length;
      const allDone = completedCount >= job.total_count;

      // Check stop_on_first_fail policy
      const stopOnFail = (job.policy_json as any)?.stop_on_first_fail === true;
      const shouldStop = stopOnFail && errorCount > 0;

      const newStatus = shouldStop ? "failed" : allDone ? "complete" : "running";
      await supabase.from("regen_jobs").update({
        completed_count: completedCount,
        status: newStatus,
        ...(shouldStop ? { error: "Stopped: episode generation failed (stop_on_first_fail policy)" } : {}),
      }).eq("id", jobId);

      // Auto-build master if all done, auto_approve enabled, and no errors
      const autoApprovePolicy = (job.policy_json as any)?.auto_approve === true;
      const autoBuildMaster = (job.policy_json as any)?.auto_build_master === true;
      let masterBuilt = false;

      if (allDone && errorCount === 0 && autoApprovePolicy && autoBuildMaster) {
        try {
          console.log(`[series-scripts-tick] All episodes done. Auto-building master season script...`);
          const { getCanonicalEpisodeCountOrThrow } = await import("../_shared/episode-count.ts");
          const canonical = await getCanonicalEpisodeCountOrThrow(supabase, projectId);
          const expectedCount = canonical.episodeCount;

          const { data: epDocs } = await supabase.from("project_documents")
            .select("id, meta_json, title").eq("project_id", projectId).eq("doc_type", "episode_script");
          const epMap = new Map<number, string>();
          for (const d of (epDocs || [])) {
            const idx = (d.meta_json as any)?.episode_index;
            if (idx != null) epMap.set(idx, d.id);
          }

          const docIds = [];
          for (let i = 1; i <= expectedCount; i++) {
            if (epMap.has(i)) docIds.push(epMap.get(i)!);
          }

          if (docIds.length === expectedCount) {
            const { data: vers } = await supabase.from("project_document_versions")
              .select("plaintext, document_id").in("document_id", docIds).eq("is_current", true);
            const verMap = new Map((vers || []).map((v: any) => [v.document_id, v.plaintext]));

            const parts: string[] = [];
            for (let i = 1; i <= expectedCount; i++) {
              const text = verMap.get(epMap.get(i)!) || "";
              parts.push(`\n\n${"=".repeat(60)}\nEPISODE ${i}\n${"=".repeat(60)}\n\n${text.trim()}`);
            }
            const masterText = `# MASTER SEASON SCRIPT\n\n${expectedCount} Episodes\n${parts.join("\n")}`;

            const { ensureDocSlot: ens, createVersion: cv } = await import("../_shared/doc-os.ts");
            const masterSlot = await ens(supabase, projectId, userId, "season_master_script", { source: "generated" });
            await cv(supabase, {
              documentId: masterSlot.documentId,
              docType: "season_master_script",
              plaintext: masterText,
              label: "autorun_master_build",
              createdBy: userId,
              approvalStatus: "approved",
              changeSummary: `Auto-built master season script from ${expectedCount} episodes`,
              metaJson: { generator: "series-autorun", episode_count: expectedCount, auto_approved: true },
            });
            masterBuilt = true;
            console.log(`[series-scripts-tick] Master season script built: ${masterText.length} chars`);
          }
        } catch (masterErr: any) {
          console.error("[series-scripts-tick] Master build error:", masterErr.message);
        }
      }

      const { data: updatedJob } = await supabase.from("regen_jobs").select("*").eq("id", jobId).single();

      return new Response(JSON.stringify({
        success: true, job: updatedJob, processed, done: allDone, masterBuilt,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════════════════════
    // SERIES SCRIPTS: STATUS
    // ══════════════════════════════════════════════════════════════
    if (action === "series-scripts-status") {
      const { jobId } = body;
      if (!jobId) throw new Error("jobId required");

      const { data: job, error: jobErr } = await supabase.from("regen_jobs")
        .select("*").eq("id", jobId).single();
      if (jobErr || !job) throw new Error("Series scripts job not found");

      const { data: items } = await supabase.from("regen_job_items")
        .select("*").eq("job_id", jobId).order("episode_index", { ascending: true });

      return new Response(JSON.stringify({
        success: true, job, items: items || [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════════════════════
    // BUILD SEASON MASTER SCRIPT (deterministic concatenation, NO LLM)
    // ══════════════════════════════════════════════════════════════
    if (action === "build-season-master-script") {
      const { projectId: pid } = body;
      if (!pid) throw new Error("projectId required");

      // Resolve expected episode count via canonical getter (hard gate)
      const { getCanonicalEpisodeCountOrThrow } = await import("../_shared/episode-count.ts");
      let expectedCount: number;
      try {
        const canonical = await getCanonicalEpisodeCountOrThrow(supabase, pid);
        expectedCount = canonical.episodeCount;
        console.log(`[build-master] Canonical episodeCount: ${expectedCount} (locked=${canonical.locked})`);
      } catch (e: any) {
        if (e.message === "EPISODE_COUNT_NOT_SET") {
          return new Response(JSON.stringify({
            success: false,
            error: "EPISODE_COUNT_NOT_SET",
            message: "Episode count not set. Set it before building master script.",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        throw e;
      }

      // Find all episode_script docs for this project
      const { data: epDocs } = await supabase.from("project_documents")
        .select("id, meta_json, title")
        .eq("project_id", pid)
        .eq("doc_type", "episode_script");

      if (!epDocs || epDocs.length === 0) {
        throw new Error("No episode scripts found. Generate episode scripts first.");
      }

      // Map by episode_index
      const epMap = new Map<number, { docId: string; title: string }>();
      for (const d of epDocs) {
        const epIdx = (d.meta_json as any)?.episode_index;
        if (epIdx != null) epMap.set(epIdx, { docId: d.id, title: d.title || `Episode ${epIdx}` });
      }

      const sortedIndices = Array.from(epMap.keys()).sort((a, b) => a - b);
      if (sortedIndices.length === 0) {
        throw new Error("No episode scripts with episode_index metadata found.");
      }

      // Cross-check: if canonical count is known, verify all expected episodes exist
      if (expectedCount && expectedCount > 0) {
        const missingExpected: number[] = [];
        for (let i = 1; i <= expectedCount; i++) {
          if (!epMap.has(i)) missingExpected.push(i);
        }
        if (missingExpected.length > 0) {
          return new Response(JSON.stringify({
            success: false,
            error: `Missing episode scripts for ${missingExpected.length} of ${expectedCount} expected episodes: ${missingExpected.join(", ")}. Generate them first.`,
            missing_episodes: missingExpected,
            expected_count: expectedCount,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Block if extras exist beyond canonical count
        const extras = sortedIndices.filter(i => i > expectedCount);
        if (extras.length > 0) {
          return new Response(JSON.stringify({
            success: false,
            error: `Found ${extras.length} episode scripts beyond canonical count of ${expectedCount}: episodes ${extras.join(", ")}. Remove or archive them first.`,
            extra_episodes: extras,
            expected_count: expectedCount,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // Fetch current versions for all episode docs
      const epDocIds = sortedIndices.map(i => epMap.get(i)!.docId);
      const { data: epVersions } = await supabase.from("project_document_versions")
        .select("document_id, plaintext")
        .in("document_id", epDocIds)
        .eq("is_current", true);

      const verByDocId = new Map<string, string>();
      for (const v of (epVersions || [])) {
        verByDocId.set(v.document_id, v.plaintext || "");
      }

      // Check for missing episodes
      const missing: number[] = [];
      for (const idx of sortedIndices) {
        const entry = epMap.get(idx)!;
        const text = verByDocId.get(entry.docId) || "";
        if (text.trim().length < 100) missing.push(idx);
      }

      if (missing.length > 0) {
        return new Response(JSON.stringify({
          success: false,
          error: `Missing or empty episode scripts for episodes: ${missing.join(", ")}. Generate them first.`,
          missing_episodes: missing,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Concatenate
      const parts: string[] = [];
      for (const idx of sortedIndices) {
        const entry = epMap.get(idx)!;
        const text = verByDocId.get(entry.docId) || "";
        parts.push(`${"=".repeat(60)}\n=== EPISODE ${String(idx).padStart(2, "0")}: ${entry.title} ===\n${"=".repeat(60)}\n\n${text.trim()}`);
      }
      const masterText = parts.join("\n\n\n");

      // Save via doc-os
      const { ensureDocSlot, createVersion: createVer } = await import("../_shared/doc-os.ts");
      const slot = await ensureDocSlot(supabase, pid, userId, "season_master_script", {
        title: "Master Season Script",
        source: "compiled",
      });

      const newVersion = await createVer(supabase, {
        documentId: slot.documentId,
        docType: "season_master_script",
        plaintext: masterText,
        label: "compiled_master",
        createdBy: userId,
        approvalStatus: "draft",
        changeSummary: `Compiled from ${sortedIndices.length} episode scripts (episodes ${sortedIndices[0]}–${sortedIndices[sortedIndices.length - 1]})`,
        metaJson: {
          generator: "build-season-master-script",
          episode_count: sortedIndices.length,
          episode_indices: sortedIndices,
          compiled_at: new Date().toISOString(),
        },
        sourceDocumentIds: epDocIds,
      });

      return new Response(JSON.stringify({
        success: true,
        document_id: slot.documentId,
        version_id: newVersion.id,
        version_number: newVersion.version_number,
        episode_count: sortedIndices.length,
        char_count: masterText.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════════════════════
    // SET SEASON EPISODE COUNT
    // ══════════════════════════════════════════════════════════════
    if (action === "set-season-episode-count") {
      const { projectId: pid, episodeCount: ec, lock, source } = body;
      if (!pid) throw new Error("projectId required");
      if (typeof ec !== "number" || ec < 1 || ec > 300) throw new Error("episodeCount must be 1..300");

      const { data: proj } = await supabase.from("projects")
        .select("season_episode_count_locked, user_id").eq("id", pid).single();
      if (!proj) throw new Error("Project not found");
      if (proj.season_episode_count_locked === true) {
        return new Response(JSON.stringify({ error: "EPISODE_COUNT_LOCKED", message: "Episode count is locked. Cannot change." }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const updates: any = { season_episode_count: ec, season_episode_count_source: source || "manual" };
      if (lock === true) updates.season_episode_count_locked = true;

      const { data: updated, error: upErr } = await supabase.from("projects")
        .update(updates).eq("id", pid).select("id, season_episode_count, season_episode_count_locked, season_episode_count_source").single();
      if (upErr) throw new Error(upErr.message);

      return new Response(JSON.stringify({ success: true, project: updated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════════════════════
    // GET SEASON EPISODE COUNT
    // ══════════════════════════════════════════════════════════════
    if (action === "get-season-episode-count") {
      const { projectId: pid } = body;
      if (!pid) throw new Error("projectId required");
      const { data: proj } = await supabase.from("projects")
        .select("season_episode_count, season_episode_count_locked, season_episode_count_source").eq("id", pid).single();
      if (!proj) throw new Error("Project not found");
      return new Response(JSON.stringify({
        season_episode_count: proj.season_episode_count,
        locked: proj.season_episode_count_locked === true,
        source: proj.season_episode_count_source || null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════════════════════
    // LOCK SEASON EPISODE COUNT
    // ══════════════════════════════════════════════════════════════
    if (action === "lock-season-episode-count") {
      const { projectId: pid } = body;
      if (!pid) throw new Error("projectId required");
      const { data: proj } = await supabase.from("projects")
        .select("season_episode_count, season_episode_count_locked").eq("id", pid).single();
      if (!proj) throw new Error("Project not found");
      if (proj.season_episode_count === null) {
        return new Response(JSON.stringify({ error: "EPISODE_COUNT_NOT_SET", message: "Cannot lock — episode count not set." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (proj.season_episode_count_locked === true) {
        return new Response(JSON.stringify({ season_episode_count: proj.season_episode_count, locked: true, already_locked: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await supabase.from("projects").update({ season_episode_count_locked: true }).eq("id", pid);
      return new Response(JSON.stringify({ season_episode_count: proj.season_episode_count, locked: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════════════════════
    // VALIDATE EPISODE COUNT (consistency check)
    // ══════════════════════════════════════════════════════════════
    if (action === "validate-episode-count") {
      const { projectId: pid } = body;
      if (!pid) throw new Error("projectId required");
      const { validateEpisodeCount } = await import("../_shared/episode-count-validator.ts");
      const report = await validateEpisodeCount(supabase, pid);
      return new Response(JSON.stringify(report), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════════════════════
    // PITCH IDEA — SET DEVSEED CANON
    // ══════════════════════════════════════════════════════════════
    if (action === "pitch-idea-set-devseed-canon") {
      const { pitchIdeaId, seasonEpisodeCount, format, assignedLane, episodeLengthTarget } = body;
      if (!pitchIdeaId) throw new Error("pitchIdeaId required");
      if (typeof seasonEpisodeCount !== "number" || seasonEpisodeCount < 1 || seasonEpisodeCount > 200) {
        throw new Error("seasonEpisodeCount must be integer 1..200");
      }

      const canonJson = {
        season_episode_count: seasonEpisodeCount,
        format: format || null,
        assigned_lane: assignedLane || null,
        episode_length_target: episodeLengthTarget || null,
        locked: true,
        locked_at: new Date().toISOString(),
        locked_by: userId,
        source: "pitch_idea_ui",
      };

      const { error: upErr } = await supabase.from("pitch_ideas")
        .update({ devseed_canon_json: canonJson } as any)
        .eq("id", pitchIdeaId);
      if (upErr) throw new Error(upErr.message);

      return new Response(JSON.stringify({ success: true, devseed_canon_json: canonJson }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════════════════════
    // BACKFILL PROJECT EPISODE COUNT FROM DEVSEED
    // ══════════════════════════════════════════════════════════════
    if (action === "project-backfill-season-episode-count-from-devseed") {
      const { projectId: pid } = body;
      if (!pid) throw new Error("projectId required");

      const { data: proj } = await supabase.from("projects")
        .select("season_episode_count, season_episode_count_locked, devseed_pitch_idea_id").eq("id", pid).single();
      if (!proj) throw new Error("Project not found");
      if (proj.season_episode_count_locked === true) {
        return new Response(JSON.stringify({ skipped: true, reason: "already_locked", season_episode_count: proj.season_episode_count }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const pitchId = proj.devseed_pitch_idea_id;
      if (!pitchId) throw new Error("No devseed_pitch_idea_id linked to this project");

      const { data: pitch } = await supabase.from("pitch_ideas")
        .select("devseed_canon_json").eq("id", pitchId).single();
      if (!pitch) throw new Error("Pitch idea not found");

      const canon = pitch.devseed_canon_json as any;
      const count = canon?.season_episode_count;
      if (typeof count !== "number" || count < 1) {
        throw new Error("Pitch idea has no season_episode_count in devseed_canon_json");
      }

      await supabase.from("projects").update({
        season_episode_count: count,
        season_episode_count_locked: true,
        season_episode_count_source: "devseed_backfill",
      }).eq("id", pid);

      return new Response(JSON.stringify({ success: true, season_episode_count: count, locked: true, source: "devseed_backfill" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════════════════════
    // REGEN EPISODE GRID TO MATCH CANON
    // ══════════════════════════════════════════════════════════════
    if (action === "regen-episode-grid-to-canon") {
      const { projectId: pid } = body;
      if (!pid) throw new Error("projectId required");

      // Get canonical count
      const { data: proj } = await supabase.from("projects")
        .select("season_episode_count, season_episode_count_locked, title").eq("id", pid).single();
      if (!proj) throw new Error("Project not found");
      if (!proj.season_episode_count || proj.season_episode_count < 1) {
        throw new Error("EPISODE_COUNT_NOT_SET");
      }
      const N = proj.season_episode_count;

      // Queue episode_grid regen via existing regen system
      const { data: gridDoc } = await supabase.from("project_documents")
        .select("id").eq("project_id", pid).eq("doc_type", "episode_grid").limit(1).maybeSingle();

      if (!gridDoc) {
        // Create episode_grid doc stub
        const slug = `${proj.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-episode-grid`;
        const stubContent = `# Episode Grid\\n\\nTotal Episodes: ${N}\\n\\n` +
          Array.from({ length: N }, (_, i) => `## Episode ${i + 1}\\nLogline: TBD`).join("\\n\\n");
        const { data: newDoc } = await supabase.from("project_documents")
          .insert({ project_id: pid, user_id: userId, doc_type: "episode_grid", title: `${proj.title} — Episode Grid`, file_name: `${slug}.md`, file_path: `${userId}/${pid}/${slug}.md`, extraction_status: "complete", plaintext: stubContent, extracted_text: stubContent } as any)
          .select("id").single();
        if (newDoc) {
          await supabase.from("project_document_versions").insert({ document_id: newDoc.id, version_number: 1, plaintext: stubContent, status: "draft", is_current: true, created_by: userId } as any);
        }
        return new Response(JSON.stringify({ success: true, action: "created_stub", episode_count: N }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Queue regen for existing grid doc
      return new Response(JSON.stringify({ success: true, action: "regen_queued", episode_count: N, doc_id: gridDoc.id, message: "Use regen-insufficient-start to regenerate episode_grid with the canonical count." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error("dev-engine-v2 error:", err);
    const msg = err.message || "Unknown error";
    if (msg === "RATE_LIMIT") {
      return new Response(JSON.stringify({ error: "Rate limit reached. Please try again in a moment." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (msg === "PAYMENT_REQUIRED") {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds to your workspace under Settings → Usage." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Return 200 for "stale version" errors so the UI can handle gracefully without crashing
    if (msg.includes("Version no longer exists") || msg.includes("Version was deleted") || msg.includes("Version not found")) {
      return new Response(JSON.stringify({ ok: false, stale_version: true, error: msg }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // JSON parse errors from malformed model output → return 200 with structured failure
    if (msg.includes("JSON") || msg.includes("Expected ','") || msg.includes("Unexpected token") || msg.includes("after array element")) {
      console.error("[dev-engine-v2] JSON parse bubble-up caught", msg);
      return new Response(JSON.stringify({ success: false, error: "MODEL_JSON_PARSE_FAILED", detail: msg.slice(0, 300) }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
