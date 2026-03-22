/**
 * shotListPreflight — Auto-resolves canonical shot list dependency for lookbook pipeline.
 *
 * Phase 18.2: Before lookbook generation, ensures a canonical shot list exists.
 * If missing, invokes the canonical generate-shot-list edge function.
 * If generation fails or project lacks a script, returns explicit status.
 *
 * INVARIANTS:
 * - Lookbook never derives shots directly from script
 * - Shot list truth lives in shot_lists + shot_list_items only
 * - No duplicate shot-list generation logic
 * - No silent fallback to fake shot context
 */
import { supabase } from '@/integrations/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export type ShotListPreflightStatus = 'ready' | 'generated' | 'failed' | 'unavailable';

export interface ShotListPreflightResult {
  status: ShotListPreflightStatus;
  shot_list_id: string | null;
  reason: string | null;
  auto_generated: boolean;
}

// Script doc types eligible for shot list generation (priority order)
const SCRIPT_DOC_TYPES = [
  'feature_script',
  'production_draft',
  'screenplay_draft',
  'episode_script',
  'season_script',
  'season_master_script',
  'script',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if a canonical shot list already exists for this project.
 * Returns shot_list_id if found, null otherwise.
 */
async function findExistingShotList(projectId: string): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from('shot_lists')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data?.length) return null;
  return data[0].id;
}

/**
 * Verify a shot list actually has items (not just an empty header row).
 */
async function shotListHasItems(shotListId: string): Promise<boolean> {
  const { count, error } = await (supabase as any)
    .from('shot_list_items')
    .select('id', { count: 'exact', head: true })
    .eq('shot_list_id', shotListId);

  return !error && (count ?? 0) > 0;
}

/**
 * Find the best script document + version for shot list generation.
 * Returns null if no eligible script exists.
 */
async function findScriptSource(projectId: string): Promise<{
  documentId: string;
  versionId: string;
  docType: string;
} | null> {
  // Fetch all project documents that might be scripts
  const { data: docs, error } = await supabase
    .from('project_documents')
    .select('id, doc_type, latest_version_id')
    .eq('project_id', projectId);

  if (error || !docs?.length) return null;

  // Find best match by priority
  for (const docType of SCRIPT_DOC_TYPES) {
    const match = docs.find((d: any) => d.doc_type === docType && d.latest_version_id);
    if (match) {
      return {
        documentId: match.id,
        versionId: (match as any).latest_version_id,
        docType: (match as any).doc_type,
      };
    }
  }

  return null;
}

/**
 * Invoke the canonical generate-shot-list edge function.
 * Same path used by Shot List page / GenerateShotListModal.
 */
async function invokeCanonicalShotListGeneration(
  projectId: string,
  sourceDocumentId: string,
  sourceVersionId: string,
  userId: string | undefined,
): Promise<{ shot_list_id: string; count: number } | null> {
  const { data, error } = await supabase.functions.invoke('generate-shot-list', {
    body: {
      action: 'generate',
      projectId,
      sourceDocumentId,
      sourceVersionId,
      scope: { mode: 'full' },
      name: 'Shot List — Auto (Lookbook Preflight)',
      userId: userId || null,
    },
  });

  if (error) {
    console.error('[ShotListPreflight] Generation failed:', error);
    return null;
  }

  if (data?.error) {
    console.error('[ShotListPreflight] Generation returned error:', data.error);
    return null;
  }

  return data as { shot_list_id: string; count: number };
}

// ── Main Preflight Function ──────────────────────────────────────────────────

/**
 * Ensure a canonical shot list exists for lookbook consumption.
 *
 * 1. If shot list exists with items → ready
 * 2. If no shot list → attempt canonical generation
 * 3. If generation succeeds → generated
 * 4. If generation fails → failed
 * 5. If no script available → unavailable
 */
export async function ensureCanonicalShotListForLookbook(
  projectId: string,
  userId?: string,
): Promise<ShotListPreflightResult> {
  // Step 1: Check for existing shot list
  const existingId = await findExistingShotList(projectId);

  if (existingId) {
    const hasItems = await shotListHasItems(existingId);
    if (hasItems) {
      return {
        status: 'ready',
        shot_list_id: existingId,
        reason: 'Existing canonical shot list found',
        auto_generated: false,
      };
    }
    // Shot list exists but empty — still treat as needing generation
  }

  // Step 2: Find script source for generation
  const scriptSource = await findScriptSource(projectId);

  if (!scriptSource) {
    return {
      status: 'unavailable',
      shot_list_id: null,
      reason: 'No eligible script document found for shot list generation',
      auto_generated: false,
    };
  }

  // Step 3: Generate canonical shot list
  console.log('[ShotListPreflight] No shot list found — generating from', scriptSource.docType);

  const result = await invokeCanonicalShotListGeneration(
    projectId,
    scriptSource.documentId,
    scriptSource.versionId,
    userId,
  );

  if (!result || !result.shot_list_id) {
    return {
      status: 'failed',
      shot_list_id: null,
      reason: 'Canonical shot list generation failed',
      auto_generated: false,
    };
  }

  // Step 4: Verify the generated shot list has items
  const hasItems = await shotListHasItems(result.shot_list_id);

  if (!hasItems) {
    return {
      status: 'failed',
      shot_list_id: result.shot_list_id,
      reason: `Shot list generated but contains no items (${result.count} expected)`,
      auto_generated: true,
    };
  }

  return {
    status: 'generated',
    shot_list_id: result.shot_list_id,
    reason: `Auto-generated ${result.count} shots from ${scriptSource.docType}`,
    auto_generated: true,
  };
}
