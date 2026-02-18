/**
 * PackageBar — approval-aware deliverable chain driven by the canonical stage ladder.
 * Shows Approved ✅ / Draft 🟡 / Missing 🔲 per stage and lets the user click into a version.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getLadderForFormat } from '@/lib/stages/registry';
import { ALL_DOC_TYPE_LABELS } from '@/lib/can-promote-to-script';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, FileQuestion } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  projectId: string;
  format: string;
  onDocClick?: (docId: string, docType: string, versionId: string | null) => void;
}

type DocStatus = 'approved' | 'draft' | 'missing';

interface StageInfo {
  docType: string;
  label: string;
  status: DocStatus;
  docId: string | null;
  versionId: string | null;
}

function getLabel(docType: string): string {
  return ALL_DOC_TYPE_LABELS[docType] ?? docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function PackageBar({ projectId, format, onDocClick }: Props) {
  const ladder = getLadderForFormat(format);

  const { data: stages = [], isLoading } = useQuery<StageInfo[]>({
    queryKey: ['package-bar', projectId, format],
    queryFn: async () => {
      // Fetch all project_documents for this project
      const { data: docs } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type, latest_version_id')
        .eq('project_id', projectId);

      const docMap = new Map<string, any>((docs || []).map((d: any) => [d.doc_type, d]));

      // Fetch version statuses
      const latestIds = (docs || [])
        .filter((d: any) => d.latest_version_id)
        .map((d: any) => d.latest_version_id as string);

      let versionMap = new Map<string, any>();
      if (latestIds.length > 0) {
        const { data: versions } = await (supabase as any)
          .from('project_document_versions')
          .select('id, status, document_id')
          .in('id', latestIds);
        versionMap = new Map((versions || []).map((v: any) => [v.id, v]));
      }

      // Fetch approved (final) versions per doc to determine "approved" status
      const docIds = (docs || []).map((d: any) => d.id as string);
      let approvedDocIds = new Set<string>();
      if (docIds.length > 0) {
        const { data: finalVers } = await (supabase as any)
          .from('project_document_versions')
          .select('document_id')
          .in('document_id', docIds)
          .eq('status', 'final')
          .limit(500);
        (finalVers || []).forEach((v: any) => approvedDocIds.add(v.document_id));
      }

      return ladder.map((docType) => {
        const doc = docMap.get(docType);
        if (!doc) {
          return { docType, label: getLabel(docType), status: 'missing' as DocStatus, docId: null, versionId: null };
        }
        const latestVer = doc.latest_version_id ? versionMap.get(doc.latest_version_id) : null;
        let status: DocStatus = 'draft';
        if (approvedDocIds.has(doc.id)) status = 'approved';
        return {
          docType,
          label: getLabel(docType),
          status,
          docId: doc.id,
          versionId: doc.latest_version_id || null,
        };
      });
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex gap-1 animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-5 w-16 rounded bg-muted/40" />
        ))}
      </div>
    );
  }

  const STATUS_CONFIG: Record<DocStatus, { icon: React.ReactNode; chip: string; tooltip: string }> = {
    approved: {
      icon: <CheckCircle2 className="h-3 w-3 shrink-0 text-[hsl(var(--chart-2))]" />,
      chip: 'border-[hsl(var(--chart-2)/0.3)] bg-[hsl(var(--chart-2)/0.1)] text-[hsl(var(--chart-2))]',
      tooltip: 'Approved (Final)',
    },
    draft: {
      icon: <Circle className="h-3 w-3 shrink-0 text-[hsl(var(--chart-4))]" />,
      chip: 'border-[hsl(var(--chart-4)/0.3)] bg-[hsl(var(--chart-4)/0.1)] text-[hsl(var(--chart-4))]',
      tooltip: 'Draft',
    },
    missing: {
      icon: <FileQuestion className="h-3 w-3 shrink-0 text-muted-foreground/40" />,
      chip: 'border-border/30 bg-muted/20 text-muted-foreground/50',
      tooltip: 'Missing',
    },
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1 flex-wrap">
        {stages.map((stage, idx) => {
          const cfg = STATUS_CONFIG[stage.status];
          const clickable = stage.status !== 'missing' && stage.docId;
          return (
            <div key={stage.docType} className="flex items-center">
              {idx > 0 && <div className="w-2 h-px bg-border/30 shrink-0" />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-medium transition-all',
                      cfg.chip,
                      clickable
                        ? 'cursor-pointer hover:opacity-80'
                        : 'cursor-default',
                    )}
                    disabled={!clickable}
                    onClick={() => {
                      if (clickable && onDocClick) {
                        onDocClick(stage.docId!, stage.docType, stage.versionId);
                      }
                    }}
                  >
                    {cfg.icon}
                    <span className="whitespace-nowrap">{stage.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">{stage.label}</p>
                  <p className="text-muted-foreground">{cfg.tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
