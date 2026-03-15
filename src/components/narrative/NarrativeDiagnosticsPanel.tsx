/**
 * NarrativeDiagnosticsPanel — Unified narrative health findings.
 * Renders backend diagnostics only. Fail-closed.
 */

import { useState } from 'react';
import { useNarrativeDiagnostics, type NarrativeDiagnostic } from '@/hooks/useNarrativeDiagnostics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  RefreshCw,
  ChevronDown,
  AlertCircle,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';

interface Props {
  projectId: string;
}

const SEVERITY_ORDER = ['critical', 'high', 'warning', 'info'] as const;

const SEVERITY_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30', label: 'Critical' },
  high: { color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30', label: 'High' },
  warning: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', label: 'Warning' },
  info: { color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10 border-sky-500/30', label: 'Info' },
};

const FILTER_OPTIONS = ['all', ...SEVERITY_ORDER] as const;

export function NarrativeDiagnosticsPanel({ projectId }: Props) {
  const { data, isLoading, error, refresh } = useNarrativeDiagnostics(projectId);
  const [filter, setFilter] = useState<string>('all');

  // Loading state
  if (isLoading && !data) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Stethoscope className="h-4 w-4 text-muted-foreground" />
            Narrative Diagnostics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Narrative Diagnostics Unavailable</p>
              <p className="text-xs text-muted-foreground">Unable to retrieve diagnostics from backend.</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="mt-2 gap-1.5" onClick={refresh}>
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const diagnostics = data ?? [];

  // Apply filter
  const filtered = filter === 'all' ? diagnostics : diagnostics.filter(d => d.severity === filter);

  // Group by severity
  const grouped = SEVERITY_ORDER.reduce((acc, sev) => {
    acc[sev] = filtered.filter(d => d.severity === sev);
    return acc;
  }, {} as Record<string, NarrativeDiagnostic[]>);

  // Counts
  const criticalHighCount = diagnostics.filter(d => d.severity === 'critical' || d.severity === 'high').length;
  const warningCount = diagnostics.filter(d => d.severity === 'warning').length;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Stethoscope className="h-4 w-4 text-muted-foreground" />
            Narrative Diagnostics
          </CardTitle>
          <Button variant="ghost" size="sm" className="gap-1.5 h-7" onClick={refresh} disabled={isLoading}>
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Unified narrative health findings across all story systems.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary bar */}
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-muted-foreground">Total Issues: <span className="font-semibold text-foreground">{diagnostics.length}</span></span>
          {criticalHighCount > 0 && (
            <span className="text-destructive">Critical/High: <span className="font-semibold">{criticalHighCount}</span></span>
          )}
          {warningCount > 0 && (
            <span className="text-amber-600 dark:text-amber-400">Warnings: <span className="font-semibold">{warningCount}</span></span>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap gap-1.5">
          {FILTER_OPTIONS.map(opt => (
            <Button
              key={opt}
              variant={filter === opt ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-[11px] px-2.5"
              onClick={() => setFilter(opt)}
            >
              {opt === 'all' ? 'All' : SEVERITY_STYLE[opt]?.label ?? opt}
            </Button>
          ))}
        </div>

        {/* Empty state */}
        {diagnostics.length === 0 && (
          <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-3">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span className="text-sm text-muted-foreground">
              No narrative issues detected. Story systems are aligned.
            </span>
          </div>
        )}

        {/* Filtered empty */}
        {diagnostics.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-muted-foreground">No diagnostics match the selected filter.</p>
        )}

        {/* Severity groups */}
        {SEVERITY_ORDER.map(sev => {
          const items = grouped[sev];
          if (!items || items.length === 0) return null;
          const style = SEVERITY_STYLE[sev];
          return (
            <div key={sev} className="space-y-2">
              <h4 className={`text-xs font-semibold uppercase tracking-wide ${style.color}`}>
                {style.label} ({items.length})
              </h4>
              {items.map(d => (
                <DiagnosticCard key={d.diagnostic_id} diagnostic={d} />
              ))}
            </div>
          );
        })}

        {/* Link to repair queue */}
        {diagnostics.length > 0 && (
          <Button
            variant="link"
            size="sm"
            className="text-xs px-0 h-auto"
            onClick={() => {
              const el = document.getElementById('repair-queue-panel');
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            View Repair Plans →
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Diagnostic Card ── */

function DiagnosticCard({ diagnostic }: { diagnostic: NarrativeDiagnostic }) {
  const [expanded, setExpanded] = useState(false);
  const style = SEVERITY_STYLE[diagnostic.severity] ?? SEVERITY_STYLE.info;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className={`rounded-md border ${style.bg} p-3 space-y-2`}>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5 min-w-0 flex-1">
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={`text-[10px] ${style.color}`}>
                {style.label}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {diagnostic.source_system}
              </Badge>
              <ScopeChip scopeType={diagnostic.scope_type} scopeKey={diagnostic.scope_key} />
              {diagnostic.repair_id && (
                <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                  Repair: {diagnostic.repair_status ?? 'linked'}
                </Badge>
              )}
            </div>
            {/* Summary */}
            <p className="text-sm text-foreground">{diagnostic.summary}</p>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="space-y-2 pt-1 border-t border-border/30">
            {diagnostic.details && (
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">Details</span>
                <p className="text-xs text-muted-foreground">{diagnostic.details}</p>
              </div>
            )}
            {diagnostic.scope_key && (
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">Affected Scope</span>
                <p className="text-xs text-muted-foreground">{diagnostic.scope_type}: {diagnostic.scope_key}</p>
              </div>
            )}
            {diagnostic.recommended_action && (
              <div className="rounded border border-primary/20 bg-primary/5 px-2.5 py-2">
                <span className="text-[10px] font-semibold uppercase text-primary">Recommended Action</span>
                <p className="text-xs text-foreground mt-0.5">{diagnostic.recommended_action}</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/* ── Scope Chip ── */

function ScopeChip({ scopeType, scopeKey }: { scopeType: string; scopeKey?: string }) {
  const label = scopeKey ? `${scopeType}: ${scopeKey}` : scopeType;
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      {label}
    </Badge>
  );
}
