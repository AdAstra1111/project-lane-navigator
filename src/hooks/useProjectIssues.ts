/**
 * useProjectIssues — Full lifecycle hook for persistent project issues.
 * Handles: fetch, stage, manual-resolve, dismiss, generate-fixes, apply, verify.
 */
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────

export type IssueCategory = 'structural' | 'continuity' | 'pacing' | 'dialogue' | 'polish';
export type IssueStatus = 'open' | 'staged' | 'resolved' | 'dismissed';
export type VerifyStatus = 'pass' | 'fail' | 'skipped' | null;

export const CATEGORY_ORDER: IssueCategory[] = ['structural', 'continuity', 'pacing', 'dialogue', 'polish'];

export const CATEGORY_COLORS: Record<IssueCategory, string> = {
  structural: 'border-red-500/40 text-red-400 bg-red-500/5',
  continuity: 'border-orange-500/40 text-orange-400 bg-orange-500/5',
  pacing: 'border-amber-500/40 text-amber-400 bg-amber-500/5',
  dialogue: 'border-blue-500/40 text-blue-400 bg-blue-500/5',
  polish: 'border-violet-500/40 text-violet-400 bg-violet-500/5',
};

export const NARRATIVE_PRESETS: Record<string, { label: string; categories: IssueCategory[] }> = {
  all: { label: 'All Issues', categories: ['structural', 'continuity', 'pacing', 'dialogue', 'polish'] },
  structure: { label: 'Structure Pass', categories: ['structural', 'continuity'] },
  pacing: { label: 'Pacing Pass', categories: ['pacing'] },
  dialogue: { label: 'Dialogue Pass', categories: ['dialogue', 'polish'] },
};

export interface ProjectIssue {
  id: string;
  project_id: string;
  doc_type: string;
  doc_version_id: string | null;
  anchor: string | null;
  category: IssueCategory;
  severity: number;
  status: IssueStatus;
  summary: string;
  detail: string;
  evidence_snippet: string | null;
  fingerprint: string;
  created_from_run_id: string | null;
  last_seen_run_id: string | null;
  resolution_mode: 'staged' | 'manual';
  staged_fix_choice: any | null;
  verify_status: VerifyStatus;
  verify_detail: string | null;
  created_at: string;
  updated_at: string;
}

export interface FixOption {
  option_label: string;
  approach: string;
  instruction: string;
  impact: string;
  recommended: boolean;
}

// ── API helpers ────────────────────────────────────────────────────────────

async function callIssuesFunction(fnName: string, body: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    }
  );
  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(result.error || `${fnName} failed`);
  return result;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useProjectIssues(projectId: string | undefined) {
  const qc = useQueryClient();

  // Fetch all non-dismissed issues
  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['project-issues', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('project_issues')
        .select('*')
        .eq('project_id', projectId)
        .not('status', 'eq', 'dismissed')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ProjectIssue[];
    },
    enabled: !!projectId,
    staleTime: 10_000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['project-issues', projectId] });
  }

  // Sorted by narrative-first order
  const sorted = [...issues].sort((a, b) => {
    const catA = CATEGORY_ORDER.indexOf(a.category);
    const catB = CATEGORY_ORDER.indexOf(b.category);
    if (catA !== catB) return catA - catB;
    if (b.severity !== a.severity) return b.severity - a.severity;
    return (a.anchor || '').localeCompare(b.anchor || '');
  });

  // Upsert notes from a run into persistent issues
  const upsertFromRun = useMutation({
    mutationFn: async (params: {
      doc_type: string;
      doc_version_id?: string;
      run_id?: string;
      notes: Array<{
        category: string;
        severity: number;
        anchor?: string;
        summary: string;
        detail: string;
        evidence_snippet?: string;
      }>;
    }) => {
      return callIssuesFunction('upsert-issues', { project_id: projectId, ...params });
    },
    onSuccess: (data) => {
      toast.success(`${data.upserted_count} issue(s) synced`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Stage an issue with a chosen fix
  const stageIssue = useMutation({
    mutationFn: async (params: { issueId: string; fixChoice: FixOption }) => {
      const { error } = await (supabase as any)
        .from('project_issues')
        .update({ status: 'staged', staged_fix_choice: params.fixChoice })
        .eq('id', params.issueId);
      if (error) throw error;

      await (supabase as any).from('project_issue_events').insert({
        issue_id: params.issueId,
        event_type: 'staged',
        payload: { fix_choice: params.fixChoice },
      });
    },
    onSuccess: () => { toast.success('Fix staged'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Manual resolve (no rewrite needed)
  const resolveManually = useMutation({
    mutationFn: async (params: { issueId: string; reason?: string }) => {
      const { error } = await (supabase as any)
        .from('project_issues')
        .update({ status: 'resolved', resolution_mode: 'manual', verify_status: 'skipped' })
        .eq('id', params.issueId);
      if (error) throw error;

      await (supabase as any).from('project_issue_events').insert({
        issue_id: params.issueId,
        event_type: 'resolved',
        payload: { mode: 'manual', reason: params.reason },
      });
    },
    onSuccess: () => { toast.success('Issue marked resolved'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Dismiss
  const dismissIssue = useMutation({
    mutationFn: async (params: { issueId: string; reason?: string }) => {
      const { error } = await (supabase as any)
        .from('project_issues')
        .update({ status: 'dismissed' })
        .eq('id', params.issueId);
      if (error) throw error;

      await (supabase as any).from('project_issue_events').insert({
        issue_id: params.issueId,
        event_type: 'dismissed',
        payload: { reason: params.reason },
      });
    },
    onSuccess: () => { toast.success('Issue dismissed'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Unstage — revert staged back to open
  const unstageIssue = useMutation({
    mutationFn: async (issueId: string) => {
      const { error } = await (supabase as any)
        .from('project_issues')
        .update({ status: 'open', staged_fix_choice: null })
        .eq('id', issueId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Fix unstaged'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Generate fix options for multiple issues
  const generateFixes = useMutation({
    mutationFn: async (params: {
      issue_ids: string[];
      current_text: string;
      doc_version_id?: string;
    }) => {
      return callIssuesFunction('generate-issue-fixes', { project_id: projectId, ...params });
    },
    onSuccess: () => toast.success('Fix options generated'),
    onError: (e: Error) => toast.error(e.message),
  });

  // Apply all staged fixes in one rewrite
  const applyStaged = useMutation({
    mutationFn: async (params: {
      doc_type: string;
      base_doc_version_id: string;
      issue_ids: string[];
    }) => {
      return callIssuesFunction('apply-staged-fixes', { project_id: projectId, ...params });
    },
    onSuccess: (data) => {
      toast.success(`New version v${data.new_version_number} created with ${data.applied_count} fix(es) applied`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Verify fixes in new version
  const verifyFixes = useMutation({
    mutationFn: async (params: {
      issue_ids: string[];
      new_doc_version_id: string;
      new_text?: string;
    }) => {
      return callIssuesFunction('verify-issue-fixes', { project_id: projectId, ...params });
    },
    onSuccess: (data) => {
      toast.success(
        `Verification complete: ${data.resolved_count} resolved, ${data.reopened_count} reopened`
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    issues: sorted,
    isLoading,
    openIssues: sorted.filter(i => i.status === 'open'),
    stagedIssues: sorted.filter(i => i.status === 'staged'),
    resolvedIssues: sorted.filter(i => i.status === 'resolved'),
    upsertFromRun,
    stageIssue,
    resolveManually,
    dismissIssue,
    unstageIssue,
    generateFixes,
    applyStaged,
    verifyFixes,
  };
}
