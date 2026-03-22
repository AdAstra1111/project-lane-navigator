/**
 * Anchor Validation — Pre-condition Gates (PG-00, PG-01)
 * 
 * PG-00: Anchor Coverage Gate — requires headshot, profile, full-body
 * PG-01: Anchor Coherence Gate — pairwise anchor similarity
 * 
 * This is the SINGLE SOURCE OF TRUTH for pre-validation gating.
 * No other module may duplicate this logic.
 *
 * Architecture: shared internal helpers ensure actor-level and candidate-level
 * paths use identical classification, thresholds, and gating semantics.
 */
import { supabase } from '@/integrations/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export type AnchorCoverageStatus = 'insufficient' | 'partial' | 'complete';
export type AnchorCoherenceStatus = 'unknown' | 'coherent' | 'marginal' | 'incoherent';

export interface AnchorUrls {
  headshot: string | null;
  profile: string | null;
  fullBody: string | null;
}

export interface AnchorPresence {
  headshot: boolean;
  profile: boolean;
  fullBody: boolean;
}

export interface AnchorCoverageResult {
  coverageStatus: AnchorCoverageStatus;
  presentAnchors: AnchorPresence;
  anchorCount: number;
  anchorUrls: AnchorUrls;
}

export interface AnchorCoherenceResult {
  coherenceStatus: AnchorCoherenceStatus;
  scores: {
    headshot_profile: number | null;
    headshot_fullBody: number | null;
    profile_fullBody: number | null;
  };
  failCount: number;
}

export interface AnchorPrecheckResult {
  coverageStatus: AnchorCoverageStatus;
  coherenceStatus: AnchorCoherenceStatus;
  coverage: AnchorCoverageResult;
  coherence: AnchorCoherenceResult;
  blocked: boolean;
  cap: number | null;
  reasons: string[];
}

export interface CandidateAnchorPackage {
  headshot_url: string | null;
  full_body_url: string | null;
  additional_refs: string[];
}

// ── Constants (single source) ────────────────────────────────────────────────

const COHERENCE_FAIL_THRESHOLD = 4;
const COHERENCE_STRONG_FAIL_THRESHOLD = 3;
const PARTIAL_CAP = 79;

// ── Shared Internal Helpers ──────────────────────────────────────────────────

/** Classify coverage status from anchor count. */
function classifyCoverage(count: number): AnchorCoverageStatus {
  if (count >= 3) return 'complete';
  if (count === 2) return 'partial';
  return 'insufficient';
}

/** Build coverage result from resolved anchor URLs. */
function buildCoverageResult(urls: AnchorUrls): AnchorCoverageResult {
  const present: AnchorPresence = {
    headshot: !!urls.headshot,
    profile: !!urls.profile,
    fullBody: !!urls.fullBody,
  };
  const count = [present.headshot, present.profile, present.fullBody].filter(Boolean).length;
  return {
    coverageStatus: classifyCoverage(count),
    presentAnchors: present,
    anchorCount: count,
    anchorUrls: urls,
  };
}

type PairKey = 'headshot_profile' | 'headshot_fullBody' | 'profile_fullBody';

/** Build pairwise comparison list from anchor URLs. */
function buildPairs(urls: AnchorUrls): Array<{ key: PairKey; a: string; b: string }> {
  const pairs: Array<{ key: PairKey; a: string; b: string }> = [];
  if (urls.headshot && urls.profile) pairs.push({ key: 'headshot_profile', a: urls.headshot, b: urls.profile });
  if (urls.headshot && urls.fullBody) pairs.push({ key: 'headshot_fullBody', a: urls.headshot, b: urls.fullBody });
  if (urls.profile && urls.fullBody) pairs.push({ key: 'profile_fullBody', a: urls.profile, b: urls.fullBody });
  return pairs;
}

/** Classify coherence status from fail count. */
function classifyCoherence(failCount: number, evaluatedCount: number): AnchorCoherenceStatus {
  if (evaluatedCount === 0) return 'unknown';
  if (failCount === 0) return 'coherent';
  if (failCount === 1) return 'marginal';
  return 'incoherent';
}

/** Normalize a raw similarity score to 0–10. */
function normalizeScore(data: any): number {
  const raw = data?.overall_score ?? data?.similarity_score ?? 5;
  return Math.min(10, Math.max(0, raw));
}

const EMPTY_SCORES = { headshot_profile: null, headshot_fullBody: null, profile_fullBody: null } as const;

/** Run pairwise coherence evaluation against anchor URLs. */
async function evaluateCoherenceFromUrls(
  urls: AnchorUrls,
  logPrefix: string,
): Promise<AnchorCoherenceResult> {
  const availableCount = [urls.headshot, urls.profile, urls.fullBody].filter(Boolean).length;
  if (availableCount < 2) {
    return { coherenceStatus: 'unknown', scores: { ...EMPTY_SCORES }, failCount: 0 };
  }

  const pairs = buildPairs(urls);
  const scores: Record<string, number | null> = { ...EMPTY_SCORES };
  let failCount = 0;

  for (const pair of pairs) {
    try {
      const { data, error } = await supabase.functions.invoke('evaluate-visual-similarity', {
        body: { anchorUrl: pair.a, candidateUrl: pair.b, evaluationType: 'anchor_coherence' },
      });
      if (error || !data) {
        console.warn(`[${logPrefix}] Failed to evaluate ${pair.key}:`, error);
        scores[pair.key] = null;
        continue;
      }
      const normalized = normalizeScore(data);
      scores[pair.key] = normalized;
      if (normalized < COHERENCE_FAIL_THRESHOLD) failCount++;
    } catch (e) {
      console.warn(`[${logPrefix}] Exception evaluating ${pair.key}:`, (e as Error).message);
      scores[pair.key] = null;
    }
  }

  const evaluated = Object.values(scores).filter(s => s !== null).length;
  return {
    coherenceStatus: classifyCoherence(failCount, evaluated),
    scores: scores as AnchorCoherenceResult['scores'],
    failCount,
  };
}

/** Build missing-anchor list from presence flags. */
function missingAnchors(present: AnchorPresence): string[] {
  const missing: string[] = [];
  if (!present.headshot) missing.push('headshot');
  if (!present.profile) missing.push('profile');
  if (!present.fullBody) missing.push('full body');
  return missing;
}

/** Shared gating logic — takes coverage + coherence, returns precheck result. */
function buildPrecheckResult(
  coverage: AnchorCoverageResult,
  coherence: AnchorCoherenceResult,
): Omit<AnchorPrecheckResult, 'coverage' | 'coherence'> {
  const reasons: string[] = [];
  let blocked = false;
  let cap: number | null = null;

  if (coverage.coverageStatus === 'insufficient') {
    blocked = true;
    reasons.push(`Insufficient anchor coverage: missing ${missingAnchors(coverage.presentAnchors).join(', ')}`);
  } else if (coverage.coverageStatus === 'partial') {
    cap = PARTIAL_CAP;
    reasons.push(`Partial anchor coverage: missing ${missingAnchors(coverage.presentAnchors).join(', ')} (score capped at ${PARTIAL_CAP})`);
  }

  if (!blocked) {
    if (coherence.coherenceStatus === 'incoherent') {
      blocked = true;
      reasons.push(`Anchor set is incoherent: ${coherence.failCount} pairwise comparison(s) failed (similarity < ${COHERENCE_FAIL_THRESHOLD}/10)`);
    } else if (coherence.coherenceStatus === 'marginal') {
      cap = cap !== null ? Math.min(cap, PARTIAL_CAP) : PARTIAL_CAP;
      reasons.push(`Anchor coherence is marginal: 1 pairwise comparison failed (score capped at ${PARTIAL_CAP})`);
    }
  }

  return { coverageStatus: coverage.coverageStatus, coherenceStatus: coherence.coherenceStatus, blocked, cap, reasons };
}

const SKIPPED_COHERENCE: AnchorCoherenceResult = {
  coherenceStatus: 'unknown',
  scores: { headshot_profile: null, headshot_fullBody: null, profile_fullBody: null },
  failCount: 0,
};

// ── Actor-Level Functions (post-creation) ────────────────────────────────────

/** Resolve anchor URLs from an actor's canonical approved version assets. */
async function resolveActorAnchorUrls(actorId: string): Promise<AnchorUrls> {
  // Use Phase 4 canonical approved_version_id — NO is_approved fallback
  const { data: actor } = await (supabase as any)
    .from('ai_actors')
    .select('approved_version_id')
    .eq('id', actorId)
    .maybeSingle();

  let versionId = actor?.approved_version_id;

  // Display-only fallback to latest version if no canonical approval exists
  if (!versionId) {
    const { data: latestVersions } = await (supabase as any)
      .from('ai_actor_versions')
      .select('id')
      .eq('actor_id', actorId)
      .order('version_number', { ascending: false })
      .limit(1);
    versionId = latestVersions?.[0]?.id;
  }

  if (!versionId) return { headshot: null, profile: null, fullBody: null };

  const { data: assets } = await (supabase as any)
    .from('ai_actor_assets')
    .select('asset_type, public_url, storage_path, meta_json')
    .eq('actor_version_id', versionId);

  let headshot: string | null = null;
  let profile: string | null = null;
  let fullBody: string | null = null;

  for (const asset of (assets || []) as Array<{ asset_type: string; public_url: string; storage_path: string; meta_json: Record<string, unknown> }>) {
    const assetType = (asset.asset_type || '').toLowerCase();
    const metaShotType = ((asset.meta_json as any)?.shot_type || '').toLowerCase();
    const url = asset.public_url || asset.storage_path;
    if (!url) continue;

    if (!headshot && (assetType === 'reference_headshot' || metaShotType === 'identity_headshot' || metaShotType === 'headshot')) {
      headshot = url;
    }
    if (!profile && (metaShotType === 'profile' || metaShotType === 'identity_profile' || (assetType === 'reference_image' && metaShotType === 'profile'))) {
      profile = url;
    }
    if (!fullBody && (assetType === 'reference_full_body' || metaShotType === 'identity_full_body' || metaShotType === 'full_body')) {
      fullBody = url;
    }
  }

  return { headshot, profile, fullBody };
}

export async function evaluateAnchorCoverage(actorId: string): Promise<AnchorCoverageResult> {
  const urls = await resolveActorAnchorUrls(actorId);
  return buildCoverageResult(urls);
}

export async function evaluateAnchorCoherence(
  actorId: string,
  coverage?: AnchorCoverageResult,
): Promise<AnchorCoherenceResult> {
  const cov = coverage || await evaluateAnchorCoverage(actorId);
  return evaluateCoherenceFromUrls(cov.anchorUrls, 'AnchorCoherence');
}

export async function runAnchorPrecheck(actorId: string): Promise<AnchorPrecheckResult> {
  const coverage = await evaluateAnchorCoverage(actorId);
  const coherence = coverage.coverageStatus === 'insufficient'
    ? SKIPPED_COHERENCE
    : await evaluateAnchorCoherence(actorId, coverage);

  const gate = buildPrecheckResult(coverage, coherence);
  console.log(`[AnchorPrecheck] actor=${actorId} coverage=${gate.coverageStatus} coherence=${gate.coherenceStatus} blocked=${gate.blocked} cap=${gate.cap}`, { reasons: gate.reasons });

  return { ...gate, coverage, coherence };
}

// ── Candidate-Level Functions (pre-promotion) ────────────────────────────────

export function evaluateCandidateAnchorCoverage(candidate: CandidateAnchorPackage): AnchorCoverageResult {
  const urls: AnchorUrls = {
    headshot: candidate.headshot_url || null,
    fullBody: candidate.full_body_url || null,
    profile: (candidate.additional_refs || [])[0] || null,
  };
  return buildCoverageResult(urls);
}

export async function evaluateCandidateAnchorCoherence(
  candidate: CandidateAnchorPackage,
  coverage?: AnchorCoverageResult,
): Promise<AnchorCoherenceResult> {
  const cov = coverage || evaluateCandidateAnchorCoverage(candidate);
  return evaluateCoherenceFromUrls(cov.anchorUrls, 'CandidateCoherence');
}

export async function runCandidateAnchorPrecheck(candidate: CandidateAnchorPackage): Promise<AnchorPrecheckResult> {
  const coverage = evaluateCandidateAnchorCoverage(candidate);
  const coherence = coverage.coverageStatus === 'insufficient'
    ? SKIPPED_COHERENCE
    : await evaluateCandidateAnchorCoherence(candidate, coverage);

  const gate = buildPrecheckResult(coverage, coherence);
  console.log(`[CandidatePrecheck] coverage=${gate.coverageStatus} coherence=${gate.coherenceStatus} blocked=${gate.blocked} cap=${gate.cap}`, { reasons: gate.reasons });

  return { ...gate, coverage, coherence };
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function persistAnchorStatus(
  actorId: string,
  coverageStatus: AnchorCoverageStatus,
  coherenceStatus: AnchorCoherenceStatus,
): Promise<void> {
  const { error } = await (supabase as any)
    .from('ai_actors')
    .update({
      anchor_coverage_status: coverageStatus,
      anchor_coherence_status: coherenceStatus,
    })
    .eq('id', actorId);

  if (error) {
    console.warn(`[AnchorPrecheck] Failed to persist status for actor ${actorId}:`, error.message);
  }
}
