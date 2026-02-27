/**
 * ChangeReportPanel — displays the latest deterministic change report
 * for a script document, keyed by source doc type. Includes Universe Ripple Scan.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, AlertTriangle, FileText, MapPin, Users, ShieldAlert, Search, Loader2 } from 'lucide-react';
import { useState, useCallback } from 'react';
import { isScriptDocType } from '@/lib/script_change';

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

  // Keyed by source doc ID
  const derivedDocType = `change_report__${sourceDocId}`;

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

      // Fetch all script-like docs in project, excluding the source doc
      const { data: docs } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type, title')
        .eq('project_id', projectId)
        .neq('id', sourceDocId || '');

      if (!docs) { setRippleResults([]); return; }

      const scriptDocs = docs.filter((d: any) => isScriptDocType(d.doc_type));
      if (scriptDocs.length === 0) { setRippleResults([]); return; }

      // Fetch current versions for these docs
      const docIds = scriptDocs.map((d: any) => d.id);
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
        const docMeta = scriptDocs.find((d: any) => d.id === ver.document_id);
        if (!docMeta) continue;

        const matches: Array<{ term: string; count: number }> = [];
        for (const term of searchTerms) {
          // Case-insensitive search for locations, case-sensitive for characters (uppercase)
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
  }, [report, projectId, sourceDocId]);

  if (isLoading || !report) return null;

  const stats = report.stats;
  const changedScenes = report.changed_scenes || [];
  const impactFlags = report.impact_flags || [];
  const staleDocs = report.stale_docs || [];
  const fixPlan = report.fix_plan || [];
  const hasRemovedEntities = (report.removed_characters?.length > 0) || (report.removed_locations?.length > 0);

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
            <div className="pt-1 border-t">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1"
                onClick={runRippleScan}
                disabled={rippleLoading}
              >
                {rippleLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                Scan project scripts for references
              </Button>

              {rippleResults !== null && (
                <div className="mt-2 space-y-1">
                  {rippleResults.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground">No references to removed entities found in other scripts.</div>
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
