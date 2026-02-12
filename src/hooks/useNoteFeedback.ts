import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface StructuredNote {
  note_id: string;
  section: string;
  category: string;
  priority: number;
  title: string;
  note_text: string;
  evidence: { type: string; ref: string }[];
  prescription: string;
  safe_fix: string;
  bold_fix: string;
  tags: string[];
}

export interface NoteFeedbackEntry {
  id: string;
  note_id: string;
  tag: string;
  writer_status: string;
  user_edit: string | null;
  reason: string | null;
  category: string | null;
  priority: number | null;
  section: string | null;
  created_by: string;
  created_at: string;
}

export function useNoteFeedback(coverageRunId: string | null) {
  const { user } = useAuth();
  const [feedbackMap, setFeedbackMap] = useState<Record<string, NoteFeedbackEntry>>({});
  const [teamFeedback, setTeamFeedback] = useState<Record<string, NoteFeedbackEntry[]>>({});
  const [loading, setLoading] = useState(false);

  const loadFeedback = useCallback(async () => {
    if (!coverageRunId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('coverage_feedback_notes')
        .select('*')
        .eq('coverage_run_id', coverageRunId);

      if (data) {
        const myMap: Record<string, NoteFeedbackEntry> = {};
        const team: Record<string, NoteFeedbackEntry[]> = {};
        (data as any[]).forEach(d => {
          if (!team[d.note_id]) team[d.note_id] = [];
          team[d.note_id].push(d);
          if (d.created_by === user?.id) {
            myMap[d.note_id] = d;
          }
        });
        setFeedbackMap(myMap);
        setTeamFeedback(team);
      }
    } finally {
      setLoading(false);
    }
  }, [coverageRunId, user?.id]);

  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  const upsertFeedback = useCallback(async (
    noteId: string,
    payload: {
      tag?: string;
      writer_status?: string;
      user_edit?: string;
      reason?: string;
      note_snapshot?: any;
      category?: string;
      priority?: number;
      section?: string;
    }
  ) => {
    if (!user || !coverageRunId) return;

    const existing = feedbackMap[noteId];

    try {
      if (existing) {
        await supabase
          .from('coverage_feedback_notes')
          .update({
            ...payload,
            note_snapshot: payload.note_snapshot ? JSON.stringify(payload.note_snapshot) : undefined,
          } as any)
          .eq('id', existing.id);
      } else {
        await supabase
          .from('coverage_feedback_notes')
          .insert({
            coverage_run_id: coverageRunId,
            note_id: noteId,
            tag: payload.tag || 'great',
            writer_status: payload.writer_status || 'open',
            user_edit: payload.user_edit || null,
            reason: payload.reason || null,
            note_snapshot: payload.note_snapshot || null,
            category: payload.category || null,
            priority: payload.priority || null,
            section: payload.section || null,
            created_by: user.id,
          } as any);
      }

      await loadFeedback();
    } catch (e: any) {
      toast.error('Failed to save feedback');
      throw e;
    }
  }, [user, coverageRunId, feedbackMap, loadFeedback]);

  const getTeamStats = useCallback((noteId: string) => {
    const entries = teamFeedback[noteId] || [];
    const stats = { open: 0, accepted: 0, rejected: 0, resolved: 0, great: 0, wrong: 0, vague: 0, conflict: false };
    const tags = new Set<string>();
    entries.forEach(e => {
      const st = e.writer_status as keyof typeof stats;
      if (st in stats && typeof stats[st] === 'number') (stats[st] as number)++;
      tags.add(e.tag);
    });
    stats.great = entries.filter(e => e.tag === 'great').length;
    stats.wrong = entries.filter(e => e.tag === 'wrong').length;
    stats.vague = entries.filter(e => e.tag === 'vague').length;
    stats.conflict = tags.has('great') && (tags.has('wrong') || tags.has('vague'));
    return stats;
  }, [teamFeedback]);

  return { feedbackMap, teamFeedback, loading, upsertFeedback, getTeamStats, loadFeedback };
}
