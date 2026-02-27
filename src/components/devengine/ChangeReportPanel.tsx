/**
 * ChangeReportPanel — displays the latest deterministic change report
 * for a script document. Collapsible, minimal, no LLM.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, AlertTriangle, FileText, MapPin, Users, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

interface ChangeReportPanelProps {
  projectId: string;
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

export function ChangeReportPanel({ projectId }: ChangeReportPanelProps) {
  const [open, setOpen] = useState(false);

  const { data: report, isLoading } = useQuery({
    queryKey: ['change-report', projectId],
    queryFn: async () => {
      // Find the change_report doc for this project
      const { data: doc } = await (supabase as any)
        .from('project_documents')
        .select('id')
        .eq('project_id', projectId)
        .eq('doc_type', 'change_report')
        .limit(1)
        .maybeSingle();

      if (!doc) return null;

      // Get current version
      const { data: version } = await (supabase as any)
        .from('project_document_versions')
        .select('plaintext, created_at')
        .eq('document_id', doc.id)
        .eq('is_current', true)
        .limit(1)
        .maybeSingle();

      if (!version?.plaintext) return null;

      try {
        return {
          ...JSON.parse(version.plaintext),
          _created_at: version.created_at,
        };
      } catch {
        return null;
      }
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  if (isLoading || !report) return null;

  const stats = report.stats;
  const changedScenes = report.changed_scenes || [];
  const impactFlags = report.impact_flags || [];
  const staleDocs = report.stale_docs || [];
  const fixPlan = report.fix_plan || [];

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
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
