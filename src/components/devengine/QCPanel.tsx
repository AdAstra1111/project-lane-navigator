import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, Play, AlertTriangle, CheckCircle, XCircle, Eye,
  Wrench, ChevronRight, Shield, Filter,
} from 'lucide-react';
import { useQCEngine } from '@/hooks/useQCEngine';
import type { QCIssue, QCPassType, QCIssueSeverity } from '@/lib/scene-graph/types';

interface QCPanelProps {
  projectId: string;
  onNavigateToChangeSet?: (changeSetId: string) => void;
  onSelectScene?: (sceneId: string) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-destructive text-destructive-foreground',
  high: 'bg-destructive/80 text-destructive-foreground',
  medium: 'bg-amber-500/90 text-white',
  low: 'bg-muted text-muted-foreground',
};

const CATEGORY_LABELS: Record<string, string> = {
  continuity: 'Continuity',
  setup_payoff: 'Setup/Payoff',
  pacing: 'Pacing',
  arc: 'Arc',
  tone: 'Tone',
};

export function QCPanel({ projectId, onNavigateToChangeSet, onSelectScene }: QCPanelProps) {
  const qc = useQCEngine(projectId);
  const [selectedPasses, setSelectedPasses] = useState<QCPassType[]>(['continuity', 'setup_payoff', 'arc', 'pacing', 'tone']);
  const [selectedMode, setSelectedMode] = useState<'latest' | 'approved_prefer'>('latest');
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());

  const handleRunQC = () => {
    qc.runQC.mutate({ mode: selectedMode, passes: selectedPasses });
  };

  const toggleIssueSelect = (id: string) => {
    setSelectedIssueIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleGenerateFix = () => {
    const ids = selectedIssueIds.size > 0 ? Array.from(selectedIssueIds) : undefined;
    qc.generateFix.mutate({ issueIds: ids, goalLabel: `QC Fix ${new Date().toLocaleDateString()}` });
  };

  // Summary counts from latest run
  const issueCounts = {
    critical: qc.issues.filter(i => i.severity === 'critical').length,
    high: qc.issues.filter(i => i.severity === 'high').length,
    medium: qc.issues.filter(i => i.severity === 'medium').length,
    low: qc.issues.filter(i => i.severity === 'low').length,
  };

  return (
    <div className="space-y-3">
      {/* Run controls */}
      <Card className="border-border/50">
        <CardHeader className="px-3 py-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" /> Quality Control Engine
            </CardTitle>
            <Button size="sm" className="h-7 text-xs gap-1" onClick={handleRunQC} disabled={qc.runQC.isPending}>
              {qc.runQC.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run QC
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={selectedMode} onValueChange={(v) => setSelectedMode(v as any)}>
              <SelectTrigger className="h-7 text-[10px] w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest" className="text-xs">Latest</SelectItem>
                <SelectItem value="approved_prefer" className="text-xs">Approved</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-1 flex-wrap">
              {(['continuity', 'setup_payoff', 'arc', 'pacing', 'tone'] as QCPassType[]).map(pass => (
                <Badge
                  key={pass}
                  variant={selectedPasses.includes(pass) ? 'default' : 'outline'}
                  className="text-[9px] cursor-pointer"
                  onClick={() => {
                    setSelectedPasses(prev =>
                      prev.includes(pass) ? prev.filter(p => p !== pass) : [...prev, pass]
                    );
                  }}
                >
                  {CATEGORY_LABELS[pass] || pass}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Run selector */}
      {qc.runs.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={qc.selectedRunId || ''} onValueChange={qc.setSelectedRunId}>
            <SelectTrigger className="h-7 text-[10px] flex-1">
              <SelectValue placeholder="Select QC run..." />
            </SelectTrigger>
            <SelectContent>
              {qc.runs.map(run => (
                <SelectItem key={run.id} value={run.id} className="text-xs">
                  {new Date(run.created_at).toLocaleString()} — {run.summary || 'No summary'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Summary badges */}
      {qc.selectedRunId && qc.issues.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge className={`text-[9px] ${SEVERITY_COLORS.critical}`}>{issueCounts.critical} Critical</Badge>
          <Badge className={`text-[9px] ${SEVERITY_COLORS.high}`}>{issueCounts.high} High</Badge>
          <Badge className={`text-[9px] ${SEVERITY_COLORS.medium}`}>{issueCounts.medium} Medium</Badge>
          <Badge className={`text-[9px] ${SEVERITY_COLORS.low}`}>{issueCounts.low} Low</Badge>
          <span className="text-[10px] text-muted-foreground ml-1">{qc.issues.length} total</span>
        </div>
      )}

      {/* Filters */}
      {qc.selectedRunId && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <Select value={qc.severityFilter || 'all'} onValueChange={(v) => qc.setSeverityFilter(v === 'all' ? null : v as QCIssueSeverity)}>
            <SelectTrigger className="h-6 text-[9px] w-20">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All</SelectItem>
              <SelectItem value="critical" className="text-xs">Critical</SelectItem>
              <SelectItem value="high" className="text-xs">High</SelectItem>
              <SelectItem value="medium" className="text-xs">Medium</SelectItem>
              <SelectItem value="low" className="text-xs">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={qc.categoryFilter || 'all'} onValueChange={(v) => qc.setCategoryFilter(v === 'all' ? null : v as QCPassType)}>
            <SelectTrigger className="h-6 text-[9px] w-24">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All</SelectItem>
              <SelectItem value="continuity" className="text-xs">Continuity</SelectItem>
              <SelectItem value="setup_payoff" className="text-xs">Setup/Payoff</SelectItem>
              <SelectItem value="arc" className="text-xs">Arc</SelectItem>
              <SelectItem value="pacing" className="text-xs">Pacing</SelectItem>
              <SelectItem value="tone" className="text-xs">Tone</SelectItem>
            </SelectContent>
          </Select>
          <Select value={qc.statusFilter || 'all'} onValueChange={(v) => qc.setStatusFilter(v === 'all' ? null : v)}>
            <SelectTrigger className="h-6 text-[9px] w-24">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All</SelectItem>
              <SelectItem value="open" className="text-xs">Open</SelectItem>
              <SelectItem value="acknowledged" className="text-xs">Acknowledged</SelectItem>
              <SelectItem value="fixed" className="text-xs">Fixed</SelectItem>
              <SelectItem value="dismissed" className="text-xs">Dismissed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Issues list */}
      {qc.selectedRunId && (
        <>
          {qc.isIssuesLoading ? (
            <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : qc.issues.length === 0 ? (
            <Card className="border-border/50">
              <CardContent className="p-4 text-center">
                <CheckCircle className="h-5 w-5 text-primary mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">No issues found for this run.</p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-1.5">
                {qc.issues.map(issue => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    isSelected={selectedIssueIds.has(issue.id)}
                    onToggleSelect={() => toggleIssueSelect(issue.id)}
                    onAcknowledge={() => qc.updateIssueStatus.mutate({ issueId: issue.id, status: 'acknowledged' })}
                    onDismiss={() => qc.updateIssueStatus.mutate({ issueId: issue.id, status: 'dismissed' })}
                    onSelectScene={onSelectScene}
                    isUpdating={qc.updateIssueStatus.isPending}
                  />
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Generate Fix button */}
          {qc.issues.filter(i => i.status === 'open').length > 0 && (
            <>
              <Separator />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-7 text-xs gap-1"
                  onClick={handleGenerateFix}
                  disabled={qc.generateFix.isPending}
                >
                  {qc.generateFix.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                  {selectedIssueIds.size > 0
                    ? `Generate Fix for ${selectedIssueIds.size} Selected`
                    : `Generate Fix for All Open (${qc.issues.filter(i => i.status === 'open').length})`
                  }
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {/* Empty state */}
      {qc.runs.length === 0 && !qc.runQC.isPending && (
        <Card className="border-border/50">
          <CardContent className="p-4 text-center">
            <Shield className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Run a QC pass to detect structural and story issues.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function IssueCard({
  issue, isSelected, onToggleSelect, onAcknowledge, onDismiss, onSelectScene, isUpdating,
}: {
  issue: QCIssue;
  isSelected: boolean;
  onToggleSelect: () => void;
  onAcknowledge: () => void;
  onDismiss: () => void;
  onSelectScene?: (sceneId: string) => void;
  isUpdating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={`border-border/50 ${isSelected ? 'ring-1 ring-primary' : ''}`}>
      <CardContent className="p-2 space-y-1">
        <div className="flex items-start gap-1.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="mt-0.5 h-3 w-3 rounded border-border"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <Badge className={`text-[8px] px-1 py-0 ${SEVERITY_COLORS[issue.severity]}`}>
                {issue.severity}
              </Badge>
              <Badge variant="outline" className="text-[8px] px-1 py-0">
                {CATEGORY_LABELS[issue.category] || issue.category}
              </Badge>
              {issue.status !== 'open' && (
                <Badge variant="secondary" className="text-[8px] px-1 py-0">{issue.status}</Badge>
              )}
            </div>
            <p className="text-[11px] font-medium mt-0.5 leading-tight">{issue.title}</p>
            <p className="text-[10px] text-muted-foreground leading-snug">{issue.description}</p>
          </div>
          <button onClick={() => setExpanded(!expanded)} className="p-0.5 hover:bg-muted rounded">
            <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </div>

        {expanded && (
          <div className="ml-5 space-y-1.5">
            {/* Evidence */}
            {issue.evidence.length > 0 && (
              <div className="space-y-1">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Evidence</span>
                {issue.evidence.map((ev, idx) => (
                  <div key={idx} className="text-[10px] bg-muted/30 rounded p-1.5 border border-border/30">
                    <p className="text-muted-foreground">{ev.note}</p>
                    {ev.excerpt && <p className="font-mono text-[9px] mt-0.5 line-clamp-3">{ev.excerpt}</p>}
                    {ev.scene_id && onSelectScene && (
                      <button
                        className="text-[9px] text-primary hover:underline mt-0.5 flex items-center gap-0.5"
                        onClick={() => onSelectScene(ev.scene_id)}
                      >
                        <Eye className="h-2.5 w-2.5" /> Open scene
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-1">
              {issue.status === 'open' && (
                <>
                  <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5" onClick={onAcknowledge} disabled={isUpdating}>
                    Acknowledge
                  </Button>
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5" onClick={onDismiss} disabled={isUpdating}>
                    <XCircle className="h-2.5 w-2.5 mr-0.5" /> Dismiss
                  </Button>
                </>
              )}
              {issue.linked_change_set_id && (
                <Badge variant="secondary" className="text-[8px]">
                  Linked to Change Set
                </Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
