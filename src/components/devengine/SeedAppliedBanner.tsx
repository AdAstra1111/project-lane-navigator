import { useState, useEffect, useMemo } from 'react';
import { X, Sprout, FileText, Users, BarChart3, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { saveProjectLaneRulesetPrefs, type RulesetPrefs } from '@/lib/rulesets/uiState';
import { buildPrefsDraft } from '@/lib/pitch/devseedHelpers';

interface SeedDraft {
  logline?: string;
  source_pitch_idea_id?: string;
  concept_expansion_id?: string | null;
  lane?: string;
  applied_at?: string;
  [key: string]: unknown;
}

interface Props {
  projectId: string;
  userId: string;
  lane: string;
  seedDraft: SeedDraft;
  historyLen: number;
  docs: Array<{ id: string; doc_type: string; title: string }>;
  onSelectDoc: (docId: string) => void;
  prefsExist: boolean;
  onPrefsApplied?: () => void;
}

const LS_KEY = (uid: string, pid: string) => `seed_banner_dismissed:${uid}:${pid}`;

export function SeedAppliedBanner({
  projectId, userId, lane, seedDraft, historyLen, docs, onSelectDoc, prefsExist, onPrefsApplied,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [applyingPrefs, setApplyingPrefs] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY(userId, projectId)) === '1') setDismissed(true);
    } catch { /* ignore */ }
  }, [userId, projectId]);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(LS_KEY(userId, projectId), '1'); } catch { /* ignore */ }
  };

  const treatmentDoc = useMemo(() => docs.find(d => d.doc_type === 'treatment'), [docs]);
  const charDoc = useMemo(() => docs.find(d => d.doc_type === 'character_bible'), [docs]);
  const marketDoc = useMemo(() => docs.find(d => d.doc_type === 'market_sheet'), [docs]);

  const appliedAt = seedDraft.applied_at
    ? new Date(seedDraft.applied_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const handleApplyPrefs = async () => {
    setApplyingPrefs(true);
    try {
      if (!seedDraft.concept_expansion_id) {
        toast.info('Seed provenance missing expansion id');
        return;
      }
      const { data: exp } = await supabase
        .from('concept_expansions')
        .select('raw_response')
        .eq('id', seedDraft.concept_expansion_id)
        .maybeSingle();
      if (!exp?.raw_response) {
        toast.error('DevSeed expansion not found');
        return;
      }
      const prefsDraft = buildPrefsDraft(exp.raw_response, lane);
      if (Object.keys(prefsDraft).length === 0) {
        toast.info('No prefs suggestions in seed');
        return;
      }
      await saveProjectLaneRulesetPrefs(projectId, lane, prefsDraft as RulesetPrefs, userId);
      toast.success('Lane prefs applied from seed');
      onPrefsApplied?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to apply prefs');
    } finally {
      setApplyingPrefs(false);
    }
  };

  if (dismissed) return null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 relative">
      <button
        onClick={dismiss}
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss seed banner"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-2.5">
        <Sprout className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div className="space-y-2 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">Seed Applied</span>
            {appliedAt && (
              <span className="text-xs text-muted-foreground">{appliedAt}</span>
            )}
            {historyLen > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {historyLen} previous seed{historyLen > 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          {/* Provenance */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {seedDraft.lane && <span>Lane: <span className="text-foreground">{seedDraft.lane}</span></span>}
            {seedDraft.source_pitch_idea_id && (
              <span>Pitch: <span className="text-foreground font-mono">{seedDraft.source_pitch_idea_id.slice(0, 8)}…</span></span>
            )}
            {seedDraft.concept_expansion_id && (
              <span>Expansion: <span className="text-foreground font-mono">{seedDraft.concept_expansion_id.slice(0, 8)}…</span></span>
            )}
          </div>

          {/* Quick Links */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {treatmentDoc && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onSelectDoc(treatmentDoc.id)}>
                <FileText className="h-3 w-3" /> Treatment
              </Button>
            )}
            {charDoc && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onSelectDoc(charDoc.id)}>
                <Users className="h-3 w-3" /> Characters
              </Button>
            )}
            {marketDoc && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onSelectDoc(marketDoc.id)}>
                <BarChart3 className="h-3 w-3" /> Market Sheet
              </Button>
            )}

            {/* Prefs CTA */}
            {!prefsExist ? (
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleApplyPrefs}
                disabled={applyingPrefs}
              >
                <Settings2 className="h-3 w-3" />
                {applyingPrefs ? 'Applying…' : 'Apply Seed Prefs'}
              </Button>
            ) : (
              <Badge variant="secondary" className="text-[10px] h-7 flex items-center gap-1">
                <Settings2 className="h-3 w-3" /> Prefs active
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
