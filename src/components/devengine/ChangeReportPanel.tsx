/**
 * ChangeReportPanel — displays the latest deterministic change report
 * for a script document, keyed by source doc ID.
 * Includes Universe Ripple Scan with optional manifest-based scoping.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, AlertTriangle, FileText, MapPin, Users, ShieldAlert, Search, Loader2, Plus } from 'lucide-react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { isScriptDocType } from '@/lib/script_change';
import { parseUniverseManifest, manifestDocIds, MANIFEST_TEMPLATE, type ManifestIndices } from '@/lib/universe_manifest/manifest';
import { toast } from 'sonner';

interface ChangeReportPanelProps {
  projectId: string;
  sourceDocId: string;
  sourceDocType: string;
}

interface RippleMatch {
  doc_type: string;
  document_id: string;
  title: string;
  matches: Array<{ term: string; count: number }>;
}

type RippleScope = 'project' | 'universe' | 'season' | 'episode';

const FLAG_ICONS: Record<string, typeof AlertTriangle> = {
  CONTINUITY_RISK: AlertTriangle,
  NEC_RISK: ShieldAlert,
  CHARACTER_CHANGE: Users,
  LOCATION_CHANGE: MapPin,
  SETUP_PAYOFF_RISK: AlertTriangle,
  TONE_SHIFT: FileText,
};

const FLAG_COLORS: Record<string, string> = {
  CONTINUITY_RISK: 'text-amber-500',
  NEC_RISK: 'text-destructive',
  CHARACTER_CHANGE: 'text-blue-500',
  LOCATION_CHANGE: 'text-emerald-500',
  SETUP_PAYOFF_RISK: 'text-amber-500',
  TONE_SHIFT: 'text-purple-500',
};

export function ChangeReportPanel({ projectId, sourceDocId, sourceDocType }: ChangeReportPanelProps) {
  const [open, setOpen] = useState(false);
  const [rippleResults, setRippleResults] = useState<RippleMatch[] | null>(null);
  const [rippleLoading, setRippleLoading] = useState(false);
  const [rippleScope, setRippleScope] = useState<RippleScope>('project');
  const [creatingManifest, setCreatingManifest] = useState(false);
  const queryClient = useQueryClient();

  // Keyed by source doc ID
  const derivedDocType = `change_report__${sourceDocId}`;

  // ── Load change report ──
  const { data: report, isLoading } = useQuery({
    queryKey: ['change-report', projectId, sourceDocId],
    queryFn: async () => {
      const { data: doc } = await (supabase as any)
        .from('project_documents')
        .select('id')
        .eq('project_id', projectId)
        .eq('doc_type', derivedDocType)
        .limit(1)
        .maybeSingle();

      if (!doc) return null;

      const { data: version } = await (supabase as any)
        .from('project_document_versions')
        .select('plaintext, created_at')
        .eq('document_id', doc.id)
        .eq('is_current', true)
        .limit(1)
        .maybeSingle();

      if (!version?.plaintext) return null;

      try {
        return { ...JSON.parse(version.plaintext), _created_at: version.created_at };
      } catch {
        return null;
      }
    },
    enabled: !!projectId && !!sourceDocId,
    staleTime: 30_000,
  });

  // ── Load universe manifest (optional) ──
  const { data: manifestData } = useQuery({
    queryKey: ['universe-manifest', projectId],
    queryFn: async () => {
      const { data: doc } = await (supabase as any)
        .from('project_documents')
        .select('id')
        .eq('project_id', projectId)
        .eq('doc_type', 'universe_manifest')
        .limit(1)
        .maybeSingle();

      if (!doc) return { exists: false as const };

      const { data: version } = await (supabase as any)
        .from('project_document_versions')
        .select('plaintext')
        .eq('document_id', doc.id)
        .eq('is_current', true)
        .limit(1)
        .maybeSingle();

      if (!version?.plaintext) return { exists: true as const, parseResult: { ok: false, errors: ['No version content'] } };

      const parseResult = parseUniverseManifest(version.plaintext);
      return { exists: true as const, parseResult };
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const manifestIndices = useMemo<ManifestIndices | null>(() => {
    if (!manifestData?.exists || !manifestData.parseResult?.ok || !manifestData.parseResult.manifest) return null;
    return manifestDocIds(manifestData.parseResult.manifest);
  }, [manifestData]);

  const sourceEpisodeInfo = manifestIndices?.episodeIndexByDocId.get(sourceDocId) || null;

  // Available scopes
  const availableScopes = useMemo<RippleScope[]>(() => {
    const scopes: RippleScope[] = ['project'];
    if (manifestIndices) {
      scopes.push('universe');
      if (sourceEpisodeInfo) {
        scopes.push('season', 'episode');
      }
    }
    return scopes;
  }, [manifestIndices, sourceEpisodeInfo]);

  // Reset scope if no longer available
  useEffect(() => {
    if (!availableScopes.includes(rippleScope)) {
      setRippleScope('project');
    }
  }, [availableScopes, rippleScope]);

  // ── Create manifest CTA (idempotent) ──
  const createManifest = useCallback(async () => {
    setCreatingManifest(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }

      // Idempotent: check if already exists
      const { data: existing } = await (supabase as any)
        .from('project_documents')
        .select('id')
        .eq('project_id', projectId)
        .eq('doc_type', 'universe_manifest')
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        queryClient.invalidateQueries({ queryKey: ['universe-manifest', projectId] });
        toast.success('Universe Manifest already exists');
        return;
      }

      const { data: newDoc, error: docErr } = await (supabase as any)
        .from('project_documents')
        .insert({
          project_id: projectId,
          user_id: user.id,
          doc_type: 'universe_manifest',
          title: 'Universe Manifest',
          file_name: 'universe_manifest.json',
          file_path: `${user.id}/${projectId}/universe_manifest.json`,
          extraction_status: 'complete',
          source: 'user',
        })
        .select('id')
        .single();

      if (docErr || !newDoc) {
        // Conflict — re-check
        const { data: retryExisting } = await (supabase as any)
          .from('project_documents')
          .select('id')
          .eq('project_id', projectId)
          .eq('doc_type', 'universe_manifest')
          .limit(1)
          .maybeSingle();
        if (retryExisting?.id) {
          queryClient.invalidateQueries({ queryKey: ['universe-manifest', projectId] });
          toast.success('Universe Manifest already exists');
          return;
        }
        toast.error('Failed to create manifest');
        return;
      }

      await (supabase as any)
        .from('project_document_versions')
        .insert({
          document_id: newDoc.id,
          version_number: 1,
          plaintext: MANIFEST_TEMPLATE,
          status: 'draft',
          is_current: true,
          created_by: user.id,
          label: 'v1 (template)',
        });

      queryClient.invalidateQueries({ queryKey: ['universe-manifest', projectId] });
      toast.success('Universe Manifest created — edit it to add doc IDs');
    } catch (err) {
      console.error('[manifest] Create error:', err);
      toast.error('Failed to create manifest');
    } finally {
      setCreatingManifest(false);
    }
  }, [projectId, queryClient]);

  // ── Ripple scan ──
  const runRippleScan = useCallback(async () => {
    if (!report) return;
    setRippleLoading(true);
    setRippleResults(null);

    try {
      const searchTerms: string[] = [
        ...(report.removed_characters || []),
        ...(report.removed_locations || []),
      ];

      if (searchTerms.length === 0) {
        setRippleResults([]);
        return;
      }

      // Fetch all docs in project, excluding the source doc
      const { data: docs } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type, title')
        .eq('project_id', projectId)
        .neq('id', sourceDocId || '');

      if (!docs) { setRippleResults([]); return; }

      // Filter candidates based on scope
      let candidateDocs: any[];

      if (rippleScope === 'project') {
        // Original behavior: script docs only, exclude derived
        candidateDocs = docs.filter((d: any) =>
          isScriptDocType(d.doc_type) &&
          !d.doc_type.startsWith('change_report__') &&
          !d.doc_type.startsWith('scene_graph__')
        );
      } else if (manifestIndices) {
        // Manifest-scoped: filter by membership set
        let membershipSet: Set<string>;
        if (rippleScope === 'universe') {
          membershipSet = manifestIndices.universe;
        } else if (rippleScope === 'season' && sourceEpisodeInfo) {
          membershipSet = manifestIndices.bySeason.get(sourceEpisodeInfo.season) || new Set();
        } else if (rippleScope === 'episode' && sourceEpisodeInfo) {
          membershipSet = manifestIndices.byEpisode.get(sourceEpisodeInfo.key) || new Set();
        } else {
          membershipSet = new Set();
        }

        candidateDocs = docs.filter((d: any) =>
          membershipSet.has(d.id) &&
          !d.doc_type.startsWith('change_report__') &&
          !d.doc_type.startsWith('scene_graph__') &&
          d.doc_type !== 'universe_manifest'
        );
      } else {
        candidateDocs = [];
      }

      if (candidateDocs.length === 0) { setRippleResults([]); return; }

      // Fetch current versions
      const docIds = candidateDocs.map((d: any) => d.id);
      const { data: versions } = await (supabase as any)
        .from('project_document_versions')
        .select('document_id, plaintext')
        .in('document_id', docIds)
        .eq('is_current', true);

      if (!versions) { setRippleResults([]); return; }

      const results: RippleMatch[] = [];
      for (const ver of versions) {
        if (!ver.plaintext) continue;
        const text = ver.plaintext as string;
        const docMeta = candidateDocs.find((d: any) => d.id === ver.document_id);
        if (!docMeta) continue;

        const matches: Array<{ term: string; count: number }> = [];
        for (const term of searchTerms) {
          const isUpper = term === term.toUpperCase();
          let count = 0;
          let idx = 0;
          while (true) {
            const found = isUpper
              ? text.indexOf(term, idx)
              : text.toLowerCase().indexOf(term.toLowerCase(), idx);
            if (found === -1) break;
            count++;
            idx = found + term.length;
          }
          if (count > 0) matches.push({ term, count });
        }

        if (matches.length > 0) {
          results.push({
            doc_type: docMeta.doc_type,
            document_id: docMeta.id,
            title: docMeta.title || docMeta.doc_type,
            matches,
          });
        }
      }

      setRippleResults(results);
    } catch (err) {
      console.error('[ripple-scan] Error:', err);
      setRippleResults([]);
    } finally {
      setRippleLoading(false);
    }
  }, [report, projectId, sourceDocId, rippleScope, manifestIndices, sourceEpisodeInfo]);

  if (isLoading || !report) return null;

  const stats = report.stats;
  const changedScenes = report.changed_scenes || [];
  const impactFlags = report.impact_flags || [];
  const staleDocs = report.stale_docs || [];
  const fixPlan = report.fix_plan || [];
  const hasRemovedEntities = (report.removed_characters?.length > 0) || (report.removed_locations?.length > 0);
  const manifestExists = manifestData?.exists ?? false;
  const manifestErrors = (manifestData?.exists && !manifestData.parseResult?.ok) ? (manifestData.parseResult?.errors || []) : [];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 text-xs bg-muted/40 hover:bg-muted/60 rounded-md transition-colors">
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="font-medium">Latest Change Report</span>
        {impactFlags.length > 0 && (
          <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-amber-600 border-amber-300">
            {impactFlags.length} flag{impactFlags.length !== 1 ? 's' : ''}
          </Badge>
        )}
        {stats && (
          <span className="ml-auto text-muted-foreground text-[10px]">
            {stats.change_pct?.toFixed(1)}% changed · {changedScenes.length} scene{changedScenes.length !== 1 ? 's' : ''}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1">
        <div className="border rounded-md p-3 space-y-3 text-xs bg-card">
          {/* Stats */}
          {stats && (
            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              <span>Old: {stats.old_len?.toLocaleString()} chars</span>
              <span>New: {stats.new_len?.toLocaleString()} chars</span>
              <span className="text-green-600">+{stats.added?.toLocaleString()}</span>
              <span className="text-destructive">-{stats.removed?.toLocaleString()}</span>
              <span>{stats.hunks} hunk{stats.hunks !== 1 ? 's' : ''}</span>
            </div>
          )}

          {/* Changed Scenes */}
          {changedScenes.length > 0 && (
            <div>
              <div className="font-medium text-[10px] text-muted-foreground mb-1">Changed Scenes</div>
              <div className="space-y-0.5">
                {changedScenes.map((s: any) => (
                  <div key={s.scene_id} className="text-[11px] flex items-center gap-1.5">
                    <Badge variant="secondary" className="text-[9px] h-4 px-1 font-mono">#{s.ordinal}</Badge>
                    <span className="truncate">{s.slugline}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Impact Flags */}
          {impactFlags.length > 0 && (
            <div>
              <div className="font-medium text-[10px] text-muted-foreground mb-1">Impact Flags</div>
              <div className="space-y-1">
                {impactFlags.map((f: any, i: number) => {
                  const Icon = FLAG_ICONS[f.code] || AlertTriangle;
                  const color = FLAG_COLORS[f.code] || 'text-muted-foreground';
                  return (
                    <div key={i} className="flex items-start gap-1.5 text-[11px]">
                      <Icon className={`h-3 w-3 mt-0.5 shrink-0 ${color}`} />
                      <span>
                        <span className="font-medium">{f.code.replace(/_/g, ' ')}</span>
                        {' — '}
                        {f.detail}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stale Docs */}
          {staleDocs.length > 0 && (
            <div>
              <div className="font-medium text-[10px] text-muted-foreground mb-1">Potentially Stale Documents</div>
              <div className="space-y-0.5">
                {staleDocs.map((d: any, i: number) => (
                  <div key={i} className="text-[11px] text-amber-600">
                    ⚠ {d.doc_type.replace(/_/g, ' ')} — {d.reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fix Plan */}
          {fixPlan.length > 0 && (
            <div>
              <div className="font-medium text-[10px] text-muted-foreground mb-1">Suggested Actions</div>
              <div className="space-y-0.5">
                {fixPlan.map((f: any, i: number) => (
                  <div key={i} className="text-[11px] flex items-start gap-1">
                    <span className="text-muted-foreground">•</span>
                    <span><span className="font-medium">{f.action.replace(/_/g, ' ')}</span>: {f.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Universe Ripple Scan */}
          {hasRemovedEntities && (
            <div className="pt-1 border-t space-y-2">
              {/* Scope selector + scan button */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] gap-1"
                  onClick={runRippleScan}
                  disabled={rippleLoading}
                >
                  {rippleLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                  Scan for references
                </Button>

                {availableScopes.length > 1 && (
                  <Select value={rippleScope} onValueChange={(v) => setRippleScope(v as RippleScope)}>
                    <SelectTrigger className="h-6 text-[10px] w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableScopes.map(s => (
                        <SelectItem key={s} value={s} className="text-[11px]">
                          {s === 'project' ? 'Project' : s === 'universe' ? 'Universe' : s === 'season' ? `Season ${sourceEpisodeInfo?.season}` : `Episode ${sourceEpisodeInfo?.key}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {!manifestExists && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] gap-1 text-muted-foreground"
                    onClick={createManifest}
                    disabled={creatingManifest}
                  >
                    {creatingManifest ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Create Universe Manifest
                  </Button>
                )}
              </div>

              {/* Manifest errors */}
              {manifestErrors.length > 0 && (
                <div className="text-[10px] text-destructive">
                  ⚠ Manifest error: {manifestErrors[0]}
                </div>
              )}

              {/* Ripple results */}
              {rippleResults !== null && (
                <div className="space-y-1">
                  {rippleResults.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground">
                      No references to removed entities found{rippleScope !== 'project' ? ` in ${rippleScope} scope` : ''}.
                    </div>
                  ) : (
                    <>
                      <div className="font-medium text-[10px] text-amber-600 mb-1">
                        Found references in {rippleResults.length} document{rippleResults.length !== 1 ? 's' : ''}:
                      </div>
                      {rippleResults.map((r, i) => (
                        <div key={i} className="text-[11px] pl-2 border-l-2 border-amber-300 py-0.5">
                          <span className="font-medium">{r.title}</span>
                          <span className="text-muted-foreground"> ({r.doc_type.replace(/_/g, ' ')})</span>
                          <div className="flex flex-wrap gap-1.5 mt-0.5">
                            {r.matches.map((m, j) => (
                              <Badge key={j} variant="outline" className="text-[9px] h-4 px-1 text-amber-600 border-amber-300">
                                {m.term} ×{m.count}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
