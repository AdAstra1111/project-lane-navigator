/**
 * CanonAuditPanel — Shows continuity audit results grouped by severity
 * with selectable fix options (radio-style) and a single Apply All button.
 */
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Shield, Loader2, AlertTriangle, AlertOctagon, Info, CheckCircle2,
  Wrench, X, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import type { ContinuityIssue, ContinuityRun } from '@/hooks/useCanonAudit';

interface CanonAuditPanelProps {
  latestRun: ContinuityRun | null;
  issues: ContinuityIssue[];
  isRunning: boolean;
  isApplyingFix: boolean;
  onStartAudit: () => void;
  onApplyFix: (issueId: string, selectedFixOption?: string) => void;
  onDismiss: (issueId: string) => void;
  hasScript: boolean;
}

const SEVERITY_CONFIG = {
  BLOCKER: { icon: AlertOctagon, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Blockers' },
  MAJOR: { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', label: 'Major' },
  MINOR: { icon: Info, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', label: 'Minor' },
  NIT: { icon: Info, color: 'text-muted-foreground', bg: 'bg-muted/20', border: 'border-border/50', label: 'Nit' },
} as const;

export function CanonAuditPanel({
  latestRun, issues, isRunning, isApplyingFix,
  onStartAudit, onApplyFix, onDismiss, hasScript,
}: CanonAuditPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ BLOCKER: true, MAJOR: true });
  const [selectedFix, setSelectedFix] = useState<Record<string, number>>({});

  const openIssues = issues.filter(i => i.status === 'open');
  const grouped: Record<string, ContinuityIssue[]> = { BLOCKER: [], MAJOR: [], MINOR: [], NIT: [] };
  for (const issue of openIssues) {
    (grouped[issue.severity] || grouped.NIT).push(issue);
  }

  const appliedCount = issues.filter(i => i.status === 'applied').length;
  const dismissedCount = issues.filter(i => i.status === 'dismissed').length;

  // Count how many fixable issues have a selection
  const fixableIssues = openIssues.filter(i =>
    (i.severity === 'BLOCKER' || i.severity === 'MAJOR') && i.fix_options && i.fix_options.length > 0
  );
  const selectedCount = fixableIssues.filter(i => selectedFix[i.id] !== undefined).length;
  // Also count fixable issues without options (auto-fix)
  const autoFixIssues = openIssues.filter(i =>
    (i.severity === 'BLOCKER' || i.severity === 'MAJOR') && (!i.fix_options || i.fix_options.length === 0)
  );
  const totalReady = selectedCount + autoFixIssues.length;

  const handleApplyAll = () => {
    // Apply each issue sequentially — those with selections get the chosen option
    for (const issue of openIssues) {
      if (issue.severity !== 'BLOCKER' && issue.severity !== 'MAJOR') continue;
      const idx = selectedFix[issue.id];
      if (issue.fix_options && issue.fix_options.length > 0 && idx === undefined) continue; // skip unselected
      const selected = idx !== undefined && issue.fix_options?.[idx] ? issue.fix_options[idx] : undefined;
      onApplyFix(issue.id, selected);
    }
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Canon Audit
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={onStartAudit}
            disabled={isRunning || !hasScript}
          >
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
            {isRunning ? 'Auditing...' : 'Audit Canon'}
          </Button>
        </div>

        {latestRun && (
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className={`text-[9px] ${
              latestRun.status === 'completed' ? 'border-emerald-500/30 text-emerald-400' :
              latestRun.status === 'completed_with_blockers' ? 'border-red-500/30 text-red-400' :
              latestRun.status === 'running' ? 'border-amber-500/30 text-amber-400' :
              'border-destructive/30 text-destructive'
            }`}>
              {latestRun.status === 'completed' ? '✓ Passed' :
               latestRun.status === 'completed_with_blockers' ? '✗ Blockers Found' :
               latestRun.status === 'running' ? 'Running...' : 'Failed'}
            </Badge>
            {appliedCount > 0 && (
              <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">
                {appliedCount} fixed
              </Badge>
            )}
            {dismissedCount > 0 && (
              <Badge variant="outline" className="text-[9px] border-muted text-muted-foreground">
                {dismissedCount} dismissed
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      {latestRun && openIssues.length > 0 && (
        <CardContent className="pt-0 space-y-3">
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {(['BLOCKER', 'MAJOR', 'MINOR', 'NIT'] as const).map(severity => {
                const items = grouped[severity];
                if (items.length === 0) return null;
                const cfg = SEVERITY_CONFIG[severity];
                const Icon = cfg.icon;
                const isOpen = expanded[severity] ?? false;

                return (
                  <div key={severity} className={`rounded-lg border ${cfg.border} ${cfg.bg}`}>
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 text-left"
                      onClick={() => setExpanded(prev => ({ ...prev, [severity]: !isOpen }))}
                    >
                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                      <span className={`text-xs font-medium ${cfg.color}`}>
                        {cfg.label} ({items.length})
                      </span>
                    </button>

                    {isOpen && (
                      <div className="px-3 pb-2 space-y-2">
                        {items.map(issue => {
                          const hasOptions = issue.fix_options && issue.fix_options.length > 0;
                          const currentSelection = selectedFix[issue.id];
                          const isSelected = currentSelection !== undefined;

                          return (
                            <div key={issue.id} className={`bg-background/50 rounded p-2 space-y-1.5 border transition-colors ${
                              isSelected ? 'border-primary/30' : 'border-transparent'
                            }`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-medium text-foreground">{issue.title}</p>
                                    {isSelected && (
                                      <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                                    )}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {issue.issue_type} • {issue.claim_in_episode?.slice(0, 80)}
                                    {(issue.claim_in_episode?.length || 0) > 80 ? '...' : ''}
                                  </p>
                                  {issue.why_it_conflicts && (
                                    <p className="text-[10px] text-muted-foreground mt-1 italic">
                                      {issue.why_it_conflicts.slice(0, 120)}
                                    </p>
                                  )}
                                </div>
                                {severity !== 'BLOCKER' && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-1.5 text-[10px] text-muted-foreground shrink-0"
                                    onClick={() => onDismiss(issue.id)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>

                              {/* ── Selectable Fix Options (radio-style) ── */}
                              {hasOptions && (
                                <div className="space-y-1 mt-1">
                                  <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wide">Select fix:</p>
                                  {issue.fix_options!.slice(0, 4).map((opt: string, i: number) => {
                                    const optSelected = currentSelection === i;
                                    return (
                                      <button
                                        key={i}
                                        onClick={(e) => { e.stopPropagation(); setSelectedFix(prev => ({ ...prev, [issue.id]: i })); }}
                                        className={`w-full text-left rounded px-2 py-1.5 border transition-all ${
                                          optSelected
                                            ? 'border-primary/60 bg-primary/10'
                                            : 'border-border/30 bg-muted/20 hover:border-border/60'
                                        }`}
                                      >
                                        <div className="flex items-center gap-1.5">
                                          <div className={`h-3 w-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                            optSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                                          }`}>
                                            {optSelected && <CheckCircle2 className="h-2 w-2 text-primary-foreground" />}
                                          </div>
                                          <span className="text-[10px] text-foreground leading-snug">{opt}</span>
                                          {i === 0 && (
                                            <Badge variant="outline" className="text-[7px] px-1 py-0 border-primary/40 text-primary bg-primary/10 ml-auto shrink-0">
                                              Suggested
                                            </Badge>
                                          )}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* ── Single Apply All Button ── */}
          <div className="flex items-center justify-between pt-1 border-t border-border/30">
            <span className="text-[10px] text-muted-foreground">
              {totalReady > 0
                ? `${totalReady} fix${totalReady > 1 ? 'es' : ''} ready to apply`
                : 'Select fix options above'}
            </span>
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleApplyAll}
              disabled={isApplyingFix || totalReady === 0}
            >
              {isApplyingFix ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
              Apply Fixes ({totalReady})
            </Button>
          </div>
        </CardContent>
      )}

      {latestRun && openIssues.length === 0 && latestRun.status !== 'running' && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-2 py-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="text-xs text-emerald-400">No open continuity issues</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
