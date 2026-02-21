import { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { GitMerge, ArrowRightLeft, ShieldAlert, Shield, ShieldOff, Pencil, Lock, ScanSearch, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { GovernanceBadge } from './GovernanceBadge';
import type { ProjectScenario, MergeRiskReport, GovernanceScanResult } from '@/hooks/useStateGraph';

interface DiffChange {
  path: string;
  a: unknown;
  b: unknown;
}

interface DiffResult {
  aScenarioId: string;
  bScenarioId: string;
  changes: DiffChange[];
  truncated: boolean;
}

interface MergePreview {
  targetScenarioId: string;
  sourceScenarioId: string;
  strategy: string;
  paths_applied: string[];
  protected_hits: string[];
  would_change_count: number;
  is_locked: boolean;
}

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
  onMerge: (params: { sourceScenarioId: string; targetScenarioId: string; paths?: string[]; strategy?: string; force?: boolean }) => void;
  isMerging: boolean;
  onUpdateProtectedPaths: (params: { scenarioId: string; protectedPaths: string[] }) => void;
  isUpdatingProtected: boolean;
  onSetLock: (params: { scenarioId: string; isLocked: boolean; protectedPaths?: string[] }) => void;
  isSavingLock: boolean;
  onScanGovernance: (params: { scenarioId: string; apply?: boolean }) => Promise<GovernanceScanResult>;
  isScanningGovernance: boolean;
  onEvaluateMergeRisk: (params: { sourceScenarioId: string; targetScenarioId: string; paths?: string[]; strategy?: string; force?: boolean }) => Promise<MergeRiskReport>;
  isEvaluatingRisk: boolean;
  onRequestApproval: (params: { sourceScenarioId?: string; targetScenarioId?: string; scenarioId?: string; riskReport?: any; payload?: any }) => void;
  isRequestingApproval: boolean;
  onApplyApprovedMerge?: (params: { sourceScenarioId?: string; targetScenarioId: string; force?: boolean }) => void;
  isApplyingApproved?: boolean;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

const RISK_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  low: 'outline',
  medium: 'secondary',
  high: 'destructive',
  critical: 'destructive',
};

export function ScenarioDiffMergePanel({
  projectId,
  scenarios,
  activeScenarioId,
  onMerge,
  isMerging,
  onUpdateProtectedPaths,
  isUpdatingProtected,
  onSetLock,
  isSavingLock,
  onScanGovernance,
  isScanningGovernance,
  onEvaluateMergeRisk,
  isEvaluatingRisk,
  onRequestApproval,
  isRequestingApproval,
  onApplyApprovedMerge,
  isApplyingApproved,
}: Props) {
  const nonArchived = useMemo(() => scenarios.filter(s => !s.is_archived), [scenarios]);

  const defaultSource = useMemo(() => {
    const branch = nonArchived.find(s => s.scenario_type === 'custom');
    const rec = nonArchived.find(s => s.is_recommended);
    return branch?.id ?? rec?.id ?? nonArchived[0]?.id ?? '';
  }, [nonArchived]);

  const defaultTarget = useMemo(() => {
    if (activeScenarioId) return activeScenarioId;
    const baseline = nonArchived.find(s => s.scenario_type === 'baseline');
    return baseline?.id ?? nonArchived[0]?.id ?? '';
  }, [nonArchived, activeScenarioId]);

  const [sourceId, setSourceId] = useState(defaultSource);
  const [targetId, setTargetId] = useState(defaultTarget);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [isDiffing, setIsDiffing] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<string>('overwrite');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Phase 5.1: Quick Edit state
  const [editPath, setEditPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editedRows, setEditedRows] = useState<Map<string, string>>(new Map());

  // Phase 5.1: Lock after merge
  const [lockAfterMerge, setLockAfterMerge] = useState(false);

  // Phase 5.1: Confirmation dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingMergeForce, setPendingMergeForce] = useState(false);

  // Phase 5.2: Risk report + governance
  const [riskReport, setRiskReport] = useState<MergeRiskReport | null>(null);
  const [govScan, setGovScan] = useState<GovernanceScanResult | null>(null);

  // Phase 5.9: Approval status from backend
  const [approvalStatus, setApprovalStatus] = useState<{
    pending: boolean;
    approval_valid_now: boolean;
    required_domain: string;
    latest_request?: { at: string; domain: string; paths_count: number; has_merge_context?: boolean; strategy?: string | null };
    latest_decision?: { at: string; approved: boolean; domain?: string; decided_by?: string; note?: string };
  } | null>(null);

  // Fetch approval status when source/target change or after risk evaluation
  useEffect(() => {
    if (!sourceId || !targetId || sourceId === targetId) {
      setApprovalStatus(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('simulation-engine', {
          body: { action: 'get_merge_approval_status', projectId, sourceScenarioId: sourceId, targetScenarioId: targetId },
        });
        if (cancelled || data?.error) {
          if (!cancelled) setApprovalStatus(null);
          return;
        }
        if (!cancelled) setApprovalStatus(data);
      } catch {
        if (!cancelled) setApprovalStatus(null);
      }
    })();
    return () => { cancelled = true; };
  }, [sourceId, targetId, projectId, riskReport?.requires_approval]);

  const computeDiff = async () => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setIsDiffing(true);
    setDiffError(null);
    setDiff(null);
    setPreview(null);
    setEditedRows(new Map());
    setRiskReport(null);
    try {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'diff_scenarios', projectId, aScenarioId: sourceId, bScenarioId: targetId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const result = data as DiffResult;
      setDiff(result);
      setSelected(new Set(result.changes.map(c => c.path)));
    } catch (e: any) {
      setDiffError(e.message ?? 'Diff failed');
    } finally {
      setIsDiffing(false);
    }
  };

  const runPreview = async () => {
    if (!diff || selected.size === 0) return;
    setIsPreviewing(true);
    try {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: {
          action: 'merge_scenario_overrides',
          projectId,
          sourceScenarioId: sourceId,
          targetScenarioId: targetId,
          paths: Array.from(selected),
          strategy,
          preview: true,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPreview(data as MergePreview);

      // Auto-evaluate risk
      try {
        const risk = await onEvaluateMergeRisk({
          sourceScenarioId: sourceId,
          targetScenarioId: targetId,
          paths: Array.from(selected),
          strategy,
        });
        setRiskReport(risk);
      } catch (_) { /* non-fatal */ }
    } catch (e: any) {
      setDiffError(e.message ?? 'Preview failed');
    } finally {
      setIsPreviewing(false);
    }
  };

  const initiatemerge = useCallback(async () => {
    if (!diff || selected.size === 0) return;

    // Auto-run preview if stale
    if (!preview) {
      setIsPreviewing(true);
      try {
        const { data, error } = await supabase.functions.invoke('simulation-engine', {
          body: {
            action: 'merge_scenario_overrides',
            projectId,
            sourceScenarioId: sourceId,
            targetScenarioId: targetId,
            paths: Array.from(selected),
            strategy,
            preview: true,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        const p = data as MergePreview;
        setPreview(p);

        // Auto-evaluate risk
        try {
          const risk = await onEvaluateMergeRisk({
            sourceScenarioId: sourceId,
            targetScenarioId: targetId,
            paths: Array.from(selected),
            strategy,
          });
          setRiskReport(risk);
        } catch (_) { /* non-fatal */ }

        const needsForce = p.is_locked || p.protected_hits.length > 0;
        setPendingMergeForce(needsForce);
        setShowConfirmDialog(true);
      } catch (e: any) {
        setDiffError(e.message ?? 'Preview failed');
      } finally {
        setIsPreviewing(false);
      }
      return;
    }

    const needsForce = preview.is_locked || preview.protected_hits.length > 0;
    setPendingMergeForce(needsForce);
    setShowConfirmDialog(true);
  }, [diff, selected, preview, projectId, sourceId, targetId, strategy, onEvaluateMergeRisk]);

  const executemerge = () => {
    // If approval required and not forcing, request approval instead
    if (riskReport?.requires_approval && !pendingMergeForce) {
      setShowConfirmDialog(false);
      onRequestApproval({
        sourceScenarioId: sourceId,
        targetScenarioId: targetId,
        riskReport: {
          risk_score: riskReport.risk_score,
          risk_level: riskReport.risk_level,
          conflicts: riskReport.conflicts,
        },
      });
      return;
    }

    setShowConfirmDialog(false);

    onMerge({
      sourceScenarioId: sourceId,
      targetScenarioId: targetId,
      paths: Array.from(selected),
      strategy,
      force: pendingMergeForce ? true : undefined,
    });

    // Lock after merge
    if (lockAfterMerge && targetId) {
      const tgt = nonArchived.find(s => s.id === targetId);
      setTimeout(() => {
        onSetLock({
          scenarioId: targetId,
          isLocked: true,
          protectedPaths: tgt?.protected_paths,
        });
      }, 500);
    }
  };

  const toggleAll = (checked: boolean) => {
    if (!diff) return;
    setSelected(checked ? new Set(diff.changes.map(c => c.path)) : new Set());
  };

  const scenarioLabel = (id: string) => {
    const s = nonArchived.find(sc => sc.id === id);
    return s?.name ?? id.slice(0, 8);
  };

  const targetScenario = nonArchived.find(s => s.id === targetId);

  const isPathProtected = (path: string) => {
    return targetScenario?.protected_paths?.some(
      pp => path === pp || path.startsWith(pp + '.')
    ) ?? false;
  };

  const toggleProtection = (path: string) => {
    if (!targetScenario) return;
    const current = targetScenario.protected_paths ?? [];
    const exactMatch = current.includes(path);
    const newPaths = exactMatch
      ? current.filter(p => p !== path)
      : [...current, path];
    onUpdateProtectedPaths({ scenarioId: targetId, protectedPaths: newPaths });
  };

  // Quick edit handlers
  const openEdit = (change: DiffChange) => {
    setEditPath(change.path);
    const edited = editedRows.get(change.path);
    setEditValue(edited ?? formatValue(change.b));
  };

  const saveEdit = () => {
    if (editPath) {
      const next = new Map(editedRows);
      next.set(editPath, editValue);
      setEditedRows(next);
    }
    setEditPath(null);
  };

  const handleScanGovernance = async () => {
    if (!targetId) return;
    try {
      const result = await onScanGovernance({ scenarioId: targetId, apply: true });
      setGovScan(result);
    } catch (_) { /* handled by hook */ }
  };

  const applyGovernanceSuggestions = () => {
    if (!govScan || !targetScenario) return;
    const current = targetScenario.protected_paths ?? [];
    const merged = [...new Set([...current, ...govScan.suggested_protected_paths])];
    onUpdateProtectedPaths({ scenarioId: targetId, protectedPaths: merged });
    toast.success(`Applied ${govScan.suggested_protected_paths.length} suggested paths`);
  };

  const editingChange = diff?.changes.find(c => c.path === editPath);

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitMerge className="h-4 w-4" />
          Scenario Diff &amp; Merge
          {targetScenario?.is_locked && (
            <Badge variant="destructive" className="text-[10px] ml-1">🔒 Locked</Badge>
          )}
          {(targetScenario?.protected_paths?.length ?? 0) > 0 && (
            <Badge variant="outline" className="text-[10px]">
              <Shield className="h-3 w-3 mr-0.5" />
              {targetScenario!.protected_paths.length} protected
            </Badge>
          )}
          {targetScenario && (
            <GovernanceBadge
              score={targetScenario.governance?.governance_confidence_score ?? null}
              protectedPathsCount={targetScenario.protected_paths?.length ?? 0}
              requireApproval={targetScenario.governance?.merge_policy?.require_approval}
              riskThreshold={targetScenario.governance?.merge_policy?.risk_threshold}
            />
          )}
          {targetScenario?.governance?.merge_policy?.require_owner_admin && (
            <Badge variant="destructive" className="text-[9px]">Owner/Admin only</Badge>
          )}
          {targetScenario?.governance?.merge_policy?.allow_self_approve === false && targetScenario?.governance?.merge_policy?.require_approval && (
            <Badge variant="outline" className="text-[9px]">No self-approve</Badge>
          )}
          {riskReport && (
            <Badge variant={RISK_BADGE_VARIANT[riskReport.risk_level] ?? 'outline'} className="text-[10px]">
              Risk: {riskReport.risk_level} ({riskReport.risk_score})
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Selectors */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[160px]">
            <label className="text-[10px] text-muted-foreground font-medium">Source</label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {nonArchived.map(s => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}{s.is_locked ? ' 🔒' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground shrink-0 mb-1" />
          <div className="space-y-1 min-w-[160px]">
            <label className="text-[10px] text-muted-foreground font-medium">Target</label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {nonArchived.map(s => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}{s.is_locked ? ' 🔒' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={isDiffing || !sourceId || !targetId || sourceId === targetId}
            onClick={computeDiff}
          >
            {isDiffing ? 'Computing…' : 'Compute Diff'}
          </Button>
        </div>

        {diffError && <div className="text-xs text-destructive">{diffError}</div>}

        {/* Governance Bar */}
        {diff && (
          <div className="flex items-center gap-2 flex-wrap rounded border border-border/30 bg-muted/10 px-3 py-2">
            <ScanSearch className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">Governance</span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              disabled={isScanningGovernance || !targetId}
              onClick={handleScanGovernance}
            >
              {isScanningGovernance ? 'Scanning…' : 'Scan Governance'}
            </Button>
            {govScan && (
              <>
                <Badge variant="outline" className="text-[10px]">{govScan.suggested_protected_paths.length} suggested</Badge>
                <Badge variant="outline" className="text-[10px]">{govScan.critical_paths.length} critical</Badge>
                {govScan.risk_hotspots.length > 0 && (
                  <Badge variant="destructive" className="text-[10px]">{govScan.risk_hotspots.length} hotspots</Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  disabled={isUpdatingProtected}
                  onClick={applyGovernanceSuggestions}
                >
                  Apply as Protected
                </Button>
              </>
            )}
          </div>
        )}

        {/* Diff table */}
        {diff && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px]">{diff.changes.length} change{diff.changes.length !== 1 ? 's' : ''}</Badge>
              {diff.truncated && <Badge variant="destructive" className="text-[10px]">Truncated</Badge>}
              <span className="text-[10px] text-muted-foreground">{selected.size} selected</span>
              {editedRows.size > 0 && (
                <Badge variant="secondary" className="text-[10px]">{editedRows.size} edited</Badge>
              )}
              {/* Select all / none */}
              <div className="ml-auto flex gap-1">
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => toggleAll(true)}>All</Button>
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => toggleAll(false)}>None</Button>
              </div>
            </div>

            {diff.changes.length === 0 ? (
              <div className="text-xs text-muted-foreground">No differences found.</div>
            ) : (
              <>
                <div className="rounded border border-border/30 overflow-auto max-h-64">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-muted/20 border-b border-border/20">
                        <th className="px-2 py-1.5 text-left w-8">
                          <Checkbox
                            checked={selected.size === diff.changes.length}
                            onCheckedChange={(c) => toggleAll(!!c)}
                          />
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Path</th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{scenarioLabel(sourceId)} (A)</th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{scenarioLabel(targetId)} (B)</th>
                        <th className="px-2 py-1.5 text-center font-medium text-muted-foreground w-16">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.changes.map(c => {
                        const prot = isPathProtected(c.path);
                        const edited = editedRows.has(c.path);
                        const isCritical = govScan?.critical_paths?.includes(c.path);
                        return (
                          <tr key={c.path} className={`border-b border-border/10 hover:bg-muted/10 ${prot ? 'bg-destructive/5' : ''}`}>
                            <td className="px-2 py-1">
                              <Checkbox
                                checked={selected.has(c.path)}
                                onCheckedChange={(checked) => {
                                  const next = new Set(selected);
                                  checked ? next.add(c.path) : next.delete(c.path);
                                  setSelected(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1 font-mono text-[10px]">
                              {c.path}
                              {prot && <ShieldAlert className="inline h-3 w-3 ml-1 text-destructive" />}
                              {isCritical && <AlertTriangle className="inline h-3 w-3 ml-1 text-destructive" />}
                              {edited && <Badge variant="secondary" className="text-[8px] ml-1 py-0">Edited</Badge>}
                            </td>
                            <td className="px-2 py-1 text-foreground">{formatValue(c.a)}</td>
                            <td className="px-2 py-1 text-muted-foreground">
                              {edited ? editedRows.get(c.path) : formatValue(c.b)}
                            </td>
                            <td className="px-2 py-1 text-center">
                              <div className="flex items-center justify-center gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0"
                                  title="Edit override"
                                  onClick={() => openEdit(c)}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={`h-5 w-5 p-0 ${prot ? 'text-destructive' : 'text-muted-foreground'}`}
                                  title={prot ? 'Unprotect path' : 'Protect path'}
                                  disabled={isUpdatingProtected}
                                  onClick={() => toggleProtection(c.path)}
                                >
                                  {prot ? <ShieldOff className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Preview summary */}
                {preview && (
                  <div className="text-xs flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground">
                      Would apply <strong>{preview.would_change_count}</strong> path(s)
                    </span>
                    {preview.protected_hits.length > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
                        {preview.protected_hits.length} protected
                      </Badge>
                    )}
                    {preview.is_locked && (
                      <Badge variant="destructive" className="text-[10px]">🔒 Locked</Badge>
                    )}
                  </div>
                )}

                {/* Risk summary */}
                {riskReport && (
                  <div className="rounded border border-border/30 bg-muted/10 px-3 py-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[10px] font-medium">Merge Risk Assessment</span>
                      <Badge variant={RISK_BADGE_VARIANT[riskReport.risk_level] ?? 'outline'} className="text-[10px]">
                        {riskReport.risk_level} ({riskReport.risk_score}/100)
                      </Badge>
                      {riskReport.requires_approval && (
                        <Badge variant="destructive" className="text-[10px]">Approval Required</Badge>
                      )}
                    </div>
                    {riskReport.conflicts.length > 0 && (
                      <ul className="text-[10px] text-muted-foreground list-disc list-inside">
                        {riskReport.conflicts.map((c, i) => (
                          <li key={i}><strong>{c.type}:</strong> {c.message}</li>
                        ))}
                      </ul>
                    )}
                    {riskReport.recommended_actions.length > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        {riskReport.recommended_actions.map((a, i) => (
                          <div key={i}>→ {a}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Approval status pill (Phase 5.10 + 5.12) */}
                {approvalStatus && (approvalStatus.pending || approvalStatus.approval_valid_now || approvalStatus.latest_decision) && !riskReport?.requires_approval && (
                  <div className="flex items-center gap-2 text-[10px] flex-wrap">
                    {approvalStatus.pending && (
                      <>
                        <Badge variant="secondary" className="text-[10px]">
                          <Clock className="h-3 w-3 mr-0.5" />Pending approval ({approvalStatus.required_domain})
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => {
                            setApprovalStatus(null);
                            supabase.functions.invoke('simulation-engine', {
                              body: { action: 'get_merge_approval_status', projectId, sourceScenarioId: sourceId, targetScenarioId: targetId },
                            }).then(({ data }) => {
                              if (data && !data.error) setApprovalStatus(data);
                            });
                          }}
                        >
                          Refresh
                        </Button>
                      </>
                    )}
                    {approvalStatus.approval_valid_now && !approvalStatus.pending && (
                      <div className="w-full rounded border border-primary/30 bg-primary/5 px-3 py-2 flex items-center gap-2 flex-wrap">
                        <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-xs font-medium text-primary">Approved — Apply Now</span>
                        <Badge variant="outline" className="text-[9px] capitalize">{approvalStatus.required_domain}</Badge>
                        {approvalStatus.latest_decision?.at && (
                          <span className="text-[10px] text-muted-foreground">
                            expires {new Date(new Date(approvalStatus.latest_decision.at).getTime() + 24*60*60*1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        {onApplyApprovedMerge && (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-6 px-2 text-[10px] ml-auto"
                            disabled={isApplyingApproved || isMerging}
                            onClick={() => onApplyApprovedMerge({ sourceScenarioId: sourceId, targetScenarioId: targetId })}
                          >
                            {isApplyingApproved ? 'Applying…' : 'Apply Approved Merge'}
                          </Button>
                        )}
                      </div>
                    )}
                    {!approvalStatus.pending && !approvalStatus.approval_valid_now && approvalStatus.latest_decision && (
                      <>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {approvalStatus.latest_decision.approved ? 'Expired' : 'Rejected'}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          disabled={isRequestingApproval}
                          onClick={() => {
                            onRequestApproval({
                              sourceScenarioId: sourceId,
                              targetScenarioId: targetId,
                              riskReport: riskReport ? {
                                risk_score: riskReport.risk_score,
                                risk_level: riskReport.risk_level,
                                conflicts: riskReport.conflicts,
                                paths: Array.from(selected),
                              } : { paths: Array.from(selected) },
                            });
                          }}
                        >
                          Request Again
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/* Approval required banner */}
                {riskReport?.requires_approval && (
                  <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 space-y-2">
                    <div className="text-xs font-medium text-destructive flex items-center gap-1.5">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      {targetScenario?.governance?.merge_policy?.require_owner_admin
                        ? 'Owner/Admin Approval Required'
                        : 'Approval Required'}
                      {' — '}{riskReport.approval_reason ?? 'This merge requires approval before proceeding.'}
                    </div>
                    {approvalStatus && (
                      <div className="text-[10px] flex items-center gap-1.5">
                        {approvalStatus.approval_valid_now ? (
                          <>
                            <CheckCircle className="h-3 w-3 text-primary" />
                            <span className="text-primary font-medium">Approved — you can merge now (no force needed)</span>
                            {approvalStatus.latest_decision?.at && (
                              <span className="text-muted-foreground ml-1">
                                expires {new Date(new Date(approvalStatus.latest_decision.at).getTime() + 24*60*60*1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </>
                        ) : approvalStatus.latest_decision?.approved ? (
                          <>
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">Approval expired — request again or force merge</span>
                          </>
                        ) : approvalStatus.pending ? (
                          <>
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">Pending approval — awaiting decision</span>
                          </>
                        ) : approvalStatus.latest_decision ? (
                          <>
                            <ShieldAlert className="h-3 w-3 text-destructive" />
                            <span className="text-destructive">Approval rejected — request again or force merge</span>
                          </>
                        ) : null}
                      </div>
                    )}
                    {!approvalStatus && (
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        No approval requested yet
                      </div>
                    )}
                    <div className="flex gap-2">
                      {approvalStatus?.approval_valid_now ? (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 px-3 text-[10px]"
                            disabled={isMerging}
                            onClick={() => {
                              setPendingMergeForce(false);
                              setShowConfirmDialog(true);
                            }}
                          >
                            Merge (Approved)
                          </Button>
                          {onApplyApprovedMerge && (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7 px-3 text-[10px]"
                              disabled={isApplyingApproved || isMerging}
                              onClick={() => onApplyApprovedMerge({ sourceScenarioId: sourceId, targetScenarioId: targetId })}
                            >
                              {isApplyingApproved ? 'Applying…' : 'Apply Approved Merge'}
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 px-3 text-[10px]"
                          disabled={isRequestingApproval}
                          onClick={() => {
                            onRequestApproval({
                              sourceScenarioId: sourceId,
                              targetScenarioId: targetId,
                              riskReport: {
                                risk_score: riskReport.risk_score,
                                risk_level: riskReport.risk_level,
                                conflicts: riskReport.conflicts,
                                paths: Array.from(selected),
                              },
                            });
                          }}
                        >
                          {isRequestingApproval ? 'Requesting…' : 'Request Approval'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-3 text-[10px]"
                        disabled={isMerging}
                        onClick={() => {
                          setPendingMergeForce(true);
                          setShowConfirmDialog(true);
                        }}
                      >
                        Force Merge
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-medium">Strategy</label>
                    <Select value={strategy} onValueChange={setStrategy}>
                      <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="overwrite" className="text-xs">Overwrite</SelectItem>
                        <SelectItem value="fill_missing" className="text-xs">Fill Missing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2 mt-4">
                    <Checkbox
                      id="lock-after-merge"
                      checked={lockAfterMerge}
                      onCheckedChange={(c) => setLockAfterMerge(!!c)}
                    />
                    <label htmlFor="lock-after-merge" className="text-[10px] text-muted-foreground cursor-pointer flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Lock target after merge
                    </label>
                  </div>

                  <div className="flex gap-2 mt-4 ml-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={isPreviewing || isEvaluatingRisk || selected.size === 0}
                      onClick={runPreview}
                    >
                      {isPreviewing ? 'Previewing…' : 'Preview Merge'}
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      disabled={isMerging || isPreviewing || selected.size === 0}
                      onClick={initiatemerge}
                    >
                      {isMerging ? 'Merging…' : `Merge ${selected.size} into Target`}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Confirm Merge</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Review the merge details below before proceeding.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {preview?.is_locked && (
              <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                <Lock className="h-4 w-4 shrink-0" />
                Target scenario is locked. Force is required.
              </div>
            )}
            <div className="text-xs space-y-1">
              <div><strong>{selected.size}</strong> path(s) selected for merge</div>
              <div>Strategy: <Badge variant="outline" className="text-[10px]">{strategy}</Badge></div>
              {preview && (
                <div>Would change: <strong>{preview.would_change_count}</strong> path(s)</div>
              )}
            </div>

            {/* Risk report in dialog */}
            {riskReport && (
              <div className="space-y-1">
                <div className="text-xs flex items-center gap-2">
                  <span className="font-medium">Risk:</span>
                  <Badge variant={RISK_BADGE_VARIANT[riskReport.risk_level] ?? 'outline'} className="text-[10px]">
                    {riskReport.risk_level} ({riskReport.risk_score}/100)
                  </Badge>
                </div>
                {riskReport.conflicts.length > 0 && (
                  <ul className="text-[10px] text-muted-foreground list-disc list-inside">
                    {riskReport.conflicts.map((c, i) => (
                      <li key={i}><strong>{c.type}:</strong> {c.message}</li>
                    ))}
                  </ul>
                )}
                {riskReport.requires_approval && (
                  <div className="text-[10px] text-destructive font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {riskReport.approval_reason ?? 'Approval required for this merge'}
                  </div>
                )}
              </div>
            )}

            {preview && preview.protected_hits.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-destructive flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" />
                  {preview.protected_hits.length} protected path(s) affected:
                </div>
                <ul className="text-[10px] text-muted-foreground list-disc list-inside max-h-32 overflow-auto">
                  {preview.protected_hits.slice(0, 8).map(p => (
                    <li key={p} className="font-mono">{p}</li>
                  ))}
                  {preview.protected_hits.length > 8 && (
                    <li>…and {preview.protected_hits.length - 8} more</li>
                  )}
                </ul>
              </div>
            )}
            {lockAfterMerge && (
              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Lock className="h-3 w-3" /> Target will be locked after merge
              </div>
            )}
            {editedRows.size > 0 && (
              <div className="text-[10px] text-destructive">
                ⚠ {editedRows.size} edited row(s) will not be applied (backend support pending)
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            {riskReport?.requires_approval && !pendingMergeForce ? (
              <Button
                size="sm"
                className="text-xs"
                variant="destructive"
                disabled={isRequestingApproval}
                onClick={executemerge}
              >
                {isRequestingApproval ? 'Requesting…' : 'Request Approval'}
              </Button>
            ) : (
              <Button
                size="sm"
                className="text-xs"
                variant={pendingMergeForce ? 'destructive' : 'default'}
                disabled={isMerging}
                onClick={executemerge}
              >
                {isMerging
                  ? 'Merging…'
                  : pendingMergeForce
                    ? 'Proceed (Force Merge)'
                    : 'Proceed (Merge)'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Edit Dialog */}
      <Dialog open={!!editPath} onOpenChange={(open) => { if (!open) setEditPath(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Edit Override</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Edit the target value for this path. Changes are local until merge.
            </DialogDescription>
          </DialogHeader>
          {editingChange && (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-medium">Path</label>
                <div className="text-xs font-mono bg-muted/20 rounded px-2 py-1">{editingChange.path}</div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-medium">Source Value (A)</label>
                <div className="text-xs bg-muted/20 rounded px-2 py-1">{formatValue(editingChange.a)}</div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-medium">Target Value (B) — editable</label>
                <Input
                  className="text-xs font-mono h-8"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setEditPath(null)}>
              Cancel
            </Button>
            <Button size="sm" className="text-xs" onClick={saveEdit}>
              Apply Edit (Local)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
