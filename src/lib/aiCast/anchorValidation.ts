/**
 * Anchor Validation — Pre-condition Gates (PG-00, PG-01)
 * 
 * PG-00: Anchor Coverage Gate — requires headshot, profile, full-body
 * PG-01: Anchor Coherence Gate — pairwise anchor similarity
 * 
 * This is the SINGLE SOURCE OF TRUTH for pre-validation gating.
 * No other module may duplicate this logic.
 */
import { supabase } from '@/integrations/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export type AnchorCoverageStatus = 'insufficient' | 'partial' | 'complete';
export type AnchorCoherenceStatus = 'unknown' | 'coherent' | 'marginal' | 'incoherent';

export interface AnchorCoverageResult {
  coverageStatus: AnchorCoverageStatus;
  presentAnchors: {
    headshot: boolean;
    profile: boolean;
    fullBody: boolean;
  };
  anchorCount: number;
  /** URLs of found anchors for downstream use */
  anchorUrls: {
    headshot: string | null;
    profile: string | null;
    fullBody: string | null;
  };
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
  /** Whether validation/promotion is blocked entirely */
  blocked: boolean;
  /** Score cap imposed by partial/marginal gates (null = no cap) */
  cap: number | null;
  /** Human-readable block/cap reasons */
  reasons: string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const COHERENCE_FAIL_THRESHOLD = 4; // Score below this = fail
const COHERENCE_STRONG_FAIL_THRESHOLD = 3; // Score below this = strong fail

// ── PG-00: Anchor Coverage ───────────────────────────────────────────────────

/**
 * Evaluate anchor coverage for an actor's latest approved version.
 * Checks for presence of headshot, profile, and full-body reference assets.
 */
export async function evaluateAnchorCoverage(actorId: string): Promise<AnchorCoverageResult> {
  // Find latest approved version, fallback to latest version
  const { data: versions } = await (supabase as any)
    .from('ai_actor_versions')
    .select('id')
    .eq('actor_id', actorId)
    .eq('is_approved', true)
    .order('version_number', { ascending: false })
    .limit(1);

  let versionId = versions?.[0]?.id;

  if (!versionId) {
    const { data: anyVersions } = await (supabase as any)
      .from('ai_actor_versions')
      .select('id')
      .eq('actor_id', actorId)
      .order('version_number', { ascending: false })
      .limit(1);
    versionId = anyVersions?.[0]?.id;
  }

  if (!versionId) {
    return {
      coverageStatus: 'insufficient',
      presentAnchors: { headshot: false, profile: false, fullBody: false },
      anchorCount: 0,
      anchorUrls: { headshot: null, profile: null, fullBody: null },
    };
  }

  const { data: assets } = await (supabase as any)
    .from('ai_actor_assets')
    .select('asset_type, public_url, storage_path, meta_json')
    .eq('actor_version_id', versionId);

  const assetList = (assets || []) as Array<{
    asset_type: string;
    public_url: string;
    storage_path: string;
    meta_json: Record<string, unknown>;
  }>;

  let headshot: string | null = null;
  let profile: string | null = null;
  let fullBody: string | null = null;

  for (const asset of assetList) {
    const assetType = (asset.asset_type || '').toLowerCase();
    const metaShotType = ((asset.meta_json as any)?.shot_type || '').toLowerCase();
    const url = asset.public_url || asset.storage_path;
    if (!url) continue;

    // Headshot detection
    if (
      assetType === 'reference_headshot' ||
      metaShotType === 'identity_headshot' ||
      metaShotType === 'headshot'
    ) {
      if (!headshot) headshot = url;
    }

    // Profile detection
    if (
      metaShotType === 'profile' ||
      metaShotType === 'identity_profile' ||
      (assetType === 'reference_image' && metaShotType === 'profile')
    ) {
      if (!profile) profile = url;
    }

    // Full body detection
    if (
      assetType === 'reference_full_body' ||
      metaShotType === 'identity_full_body' ||
      metaShotType === 'full_body'
    ) {
      if (!fullBody) fullBody = url;
    }
  }

  const present = {
    headshot: !!headshot,
    profile: !!profile,
    fullBody: !!fullBody,
  };
  const count = [present.headshot, present.profile, present.fullBody].filter(Boolean).length;

  let coverageStatus: AnchorCoverageStatus;
  if (count === 3) coverageStatus = 'complete';
  else if (count === 2) coverageStatus = 'partial';
  else coverageStatus = 'insufficient';

  return {
    coverageStatus,
    presentAnchors: present,
    anchorCount: count,
    anchorUrls: { headshot, profile, fullBody },
  };
}

// ── PG-01: Anchor Coherence ──────────────────────────────────────────────────

/**
 * Evaluate anchor coherence — pairwise similarity between available anchors.
 * Uses evaluate-visual-similarity edge function if available, otherwise
 * returns 'unknown' status (does not block).
 */
export async function evaluateAnchorCoherence(
  actorId: string,
  coverage?: AnchorCoverageResult,
): Promise<AnchorCoherenceResult> {
  // Get coverage if not provided
  const cov = coverage || await evaluateAnchorCoverage(actorId);

  // Need at least 2 anchors to compare
  const anchors = cov.anchorUrls;
  const available = [
    anchors.headshot ? 'headshot' : null,
    anchors.profile ? 'profile' : null,
    anchors.fullBody ? 'fullBody' : null,
  ].filter(Boolean) as string[];

  if (available.length < 2) {
    return {
      coherenceStatus: 'unknown',
      scores: { headshot_profile: null, headshot_fullBody: null, profile_fullBody: null },
      failCount: 0,
    };
  }

  // Build pairwise comparisons
  const pairs: Array<{ key: 'headshot_profile' | 'headshot_fullBody' | 'profile_fullBody'; a: string; b: string }> = [];
  if (anchors.headshot && anchors.profile) {
    pairs.push({ key: 'headshot_profile', a: anchors.headshot, b: anchors.profile });
  }
  if (anchors.headshot && anchors.fullBody) {
    pairs.push({ key: 'headshot_fullBody', a: anchors.headshot, b: anchors.fullBody });
  }
  if (anchors.profile && anchors.fullBody) {
    pairs.push({ key: 'profile_fullBody', a: anchors.profile, b: anchors.fullBody });
  }

  const scores: Record<string, number | null> = {
    headshot_profile: null,
    headshot_fullBody: null,
    profile_fullBody: null,
  };

  let failCount = 0;

  for (const pair of pairs) {
    try {
      const { data, error } = await supabase.functions.invoke('evaluate-visual-similarity', {
        body: {
          anchorUrl: pair.a,
          candidateUrl: pair.b,
          evaluationType: 'anchor_coherence',
        },
      });

      if (error || !data) {
        console.warn(`[AnchorCoherence] Failed to evaluate ${pair.key}:`, error);
        scores[pair.key] = null;
        continue;
      }

      // Normalize score to 0-10 scale
      const rawScore = data.overall_score ?? data.similarity_score ?? 5;
      const normalizedScore = Math.min(10, Math.max(0, rawScore));
      scores[pair.key] = normalizedScore;

      if (normalizedScore < COHERENCE_FAIL_THRESHOLD) {
        failCount++;
      }
    } catch (e) {
      console.warn(`[AnchorCoherence] Exception evaluating ${pair.key}:`, (e as Error).message);
      scores[pair.key] = null;
    }
  }

  // If no pairs could be evaluated, return unknown
  const evaluated = Object.values(scores).filter(s => s !== null).length;
  if (evaluated === 0) {
    return {
      coherenceStatus: 'unknown',
      scores: scores as any,
      failCount: 0,
    };
  }

  let coherenceStatus: AnchorCoherenceStatus;
  if (failCount === 0) coherenceStatus = 'coherent';
  else if (failCount === 1) coherenceStatus = 'marginal';
  else coherenceStatus = 'incoherent';

  return {
    coherenceStatus,
    scores: scores as any,
    failCount,
  };
}

// ── Combined Pre-check ───────────────────────────────────────────────────────

/**
 * Run full anchor pre-check (PG-00 + PG-01).
 * Returns deterministic gating decision.
 */
export async function runAnchorPrecheck(actorId: string): Promise<AnchorPrecheckResult> {
  const coverage = await evaluateAnchorCoverage(actorId);
  const reasons: string[] = [];
  let blocked = false;
  let cap: number | null = null;

  // PG-00: Coverage gate
  if (coverage.coverageStatus === 'insufficient') {
    blocked = true;
    const missing: string[] = [];
    if (!coverage.presentAnchors.headshot) missing.push('headshot');
    if (!coverage.presentAnchors.profile) missing.push('profile');
    if (!coverage.presentAnchors.fullBody) missing.push('full body');
    reasons.push(`Insufficient anchor coverage: missing ${missing.join(', ')}`);
  } else if (coverage.coverageStatus === 'partial') {
    cap = 79;
    const missing: string[] = [];
    if (!coverage.presentAnchors.headshot) missing.push('headshot');
    if (!coverage.presentAnchors.profile) missing.push('profile');
    if (!coverage.presentAnchors.fullBody) missing.push('full body');
    reasons.push(`Partial anchor coverage: missing ${missing.join(', ')} (score capped at 79)`);
  }

  // PG-01: Coherence gate (only if not already blocked by coverage)
  let coherence: AnchorCoherenceResult;
  if (!blocked) {
    coherence = await evaluateAnchorCoherence(actorId, coverage);
    if (coherence.coherenceStatus === 'incoherent') {
      blocked = true;
      reasons.push(`Anchor set is incoherent: ${coherence.failCount} pairwise comparison(s) failed (similarity < ${COHERENCE_FAIL_THRESHOLD}/10)`);
    } else if (coherence.coherenceStatus === 'marginal') {
      cap = cap !== null ? Math.min(cap, 79) : 79;
      reasons.push(`Anchor coherence is marginal: 1 pairwise comparison failed (score capped at 79)`);
    }
  } else {
    // Skip coherence evaluation if already blocked
    coherence = {
      coherenceStatus: 'unknown',
      scores: { headshot_profile: null, headshot_fullBody: null, profile_fullBody: null },
      failCount: 0,
    };
  }

  console.log(
    `[AnchorPrecheck] actor=${actorId} coverage=${coverage.coverageStatus} coherence=${coherence.coherenceStatus} blocked=${blocked} cap=${cap}`,
    { reasons }
  );

  return {
    coverageStatus: coverage.coverageStatus,
    coherenceStatus: coherence.coherenceStatus,
    coverage,
    coherence,
    blocked,
    cap,
    reasons,
  };
}

/**
 * Persist anchor gate statuses back to the ai_actors row.
 */
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
