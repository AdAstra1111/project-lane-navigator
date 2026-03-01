import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Fingerprint, FileText, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { saveProjectLaneRulesetPrefs, loadProjectLaneRulesetPrefs, type RulesetPrefs } from '@/lib/rulesets/uiState';
import { computeMetrics, buildFingerprint, checkCompliance, type StyleFingerprint } from '@/lib/styleFingerprint';

interface ScriptOption {
  id: string;
  title: string;
  project_id: string;
  doc_type: string;
  created_at: string;
  project_title?: string;
}

interface Props {
  projectId: string;
  userId: string;
  lane: string;
  /** Currently displayed text for compliance check */
  activeText?: string;
}

const SCRIPT_DOC_TYPES = ['script', 'screenplay', 'episode_script', 'season_script', 'complete_season_script'];

export function StyleSourcesPanel({ projectId, userId, lane, activeText }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scripts, setScripts] = useState<ScriptOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState(false);
  const [fingerprint, setFingerprint] = useState<StyleFingerprint | null>(null);
  const [compliance, setCompliance] = useState<ReturnType<typeof checkCompliance> | null>(null);

  // Load existing fingerprint from prefs
  useEffect(() => {
    loadProjectLaneRulesetPrefs(projectId, lane).then(prefs => {
      const fp = (prefs as any).style_fingerprint as StyleFingerprint | undefined;
      if (fp) {
        setFingerprint(fp);
        if (fp.sources) {
          setSelected(new Set(fp.sources.map(s => s.doc_id)));
        }
      }
    });
  }, [projectId, lane]);

  // Auto-run compliance when text or fingerprint changes
  useEffect(() => {
    if (fingerprint && activeText && activeText.length > 200) {
      setCompliance(checkCompliance(activeText, fingerprint));
    } else {
      setCompliance(null);
    }
  }, [fingerprint, activeText]);

  const loadScripts = async () => {
    setLoading(true);
    try {
      // Get all script-type docs across user's projects
      const { data } = await supabase
        .from('project_documents')
        .select('id, title, project_id, doc_type, created_at, plaintext, extracted_text')
        .in('doc_type', SCRIPT_DOC_TYPES)
        .not('extracted_text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!data || data.length === 0) {
        // Fallback: also check docs with plaintext
        const { data: fallback } = await supabase
          .from('project_documents')
          .select('id, title, project_id, doc_type, created_at')
          .in('doc_type', SCRIPT_DOC_TYPES)
          .not('plaintext', 'is', null)
          .order('created_at', { ascending: false })
          .limit(50);
        setScripts((fallback || []).map(d => ({ ...d, title: d.title || 'Untitled' })));
      } else {
        setScripts(data.map(d => ({ ...d, title: d.title || 'Untitled' })));
      }
    } catch {
      toast.error('Failed to load scripts');
    } finally {
      setLoading(false);
    }
  };

  const openPicker = () => {
    setPickerOpen(true);
    loadScripts();
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      else toast.info('Maximum 5 style sources');
      return next;
    });
  };

  const handleBuildFingerprint = async () => {
    if (selected.size === 0) { toast.info('Select at least 1 script'); return; }
    setBuilding(true);
    try {
      const ids = Array.from(selected);

      // Load text for each selected script
      const { data: docs } = await supabase
        .from('project_documents')
        .select('id, title, project_id, plaintext, extracted_text')
        .in('id', ids);

      if (!docs || docs.length === 0) { toast.error('No text found for selected scripts'); return; }

      const metricsArr = [];
      const sources = [];

      for (const doc of docs) {
        const text = doc.extracted_text || doc.plaintext || '';
        if (text.length < 100) continue;
        metricsArr.push(computeMetrics(text));
        sources.push({ doc_id: doc.id, title: doc.title || 'Untitled', project_id: doc.project_id });
      }

      if (metricsArr.length === 0) { toast.error('No usable text in selected scripts'); return; }

      const fp = buildFingerprint(metricsArr, sources);
      setFingerprint(fp);

      // Merge into prefs
      const existing = await loadProjectLaneRulesetPrefs(projectId, lane);
      const merged: RulesetPrefs = {
        ...existing,
        style_sources: sources as any,
        style_fingerprint: fp as any,
      };
      await saveProjectLaneRulesetPrefs(projectId, lane, merged, userId);

      toast.success(`Style fingerprint built from ${sources.length} script(s)`);
      setPickerOpen(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to build fingerprint');
    } finally {
      setBuilding(false);
    }
  };

  const withinCount = compliance?.filter(c => c.within).length ?? 0;
  const totalChecks = compliance?.length ?? 0;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Fingerprint className="h-4 w-4 text-primary" />
          Writing Style Sources
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {fingerprint ? (
          <>
            <div className="flex flex-wrap gap-1">
              {fingerprint.sources.map(s => (
                <Badge key={s.doc_id} variant="secondary" className="text-[10px]">
                  <FileText className="h-3 w-3 mr-0.5" />
                  {s.title.slice(0, 20)}{s.title.length > 20 ? '…' : ''}
                </Badge>
              ))}
            </div>

            {/* Targets summary */}
            <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
              <span>Dialogue: {(fingerprint.targets.dialogue_ratio.min * 100).toFixed(0)}–{(fingerprint.targets.dialogue_ratio.max * 100).toFixed(0)}%</span>
              <span>Sent avg: {fingerprint.targets.sentence_len_avg.min}–{fingerprint.targets.sentence_len_avg.max}w</span>
              <span>Dial len: {fingerprint.targets.avg_dialogue_line_len.min}–{fingerprint.targets.avg_dialogue_line_len.max}w</span>
              <span>Slug/100: {fingerprint.targets.slugline_density.min}–{fingerprint.targets.slugline_density.max}</span>
            </div>

            {/* Compliance readout */}
            {compliance && (
              <div className="space-y-1 pt-1 border-t border-border/50">
                <div className="flex items-center gap-1 text-xs font-medium">
                  {withinCount === totalChecks ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                  )}
                  <span>{withinCount}/{totalChecks} metrics in band</span>
                </div>
                {compliance.filter(c => !c.within).map(c => (
                  <div key={c.metric} className="text-[10px] text-destructive">
                    {c.metric}: {c.value} ({c.delta})
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" size="sm" className="h-7 text-xs w-full gap-1" onClick={openPicker}>
              <RefreshCw className="h-3 w-3" /> Update Sources
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" className="h-7 text-xs w-full gap-1" onClick={openPicker}>
            <Fingerprint className="h-3 w-3" /> Select Style Sources
          </Button>
        )}
      </CardContent>

      {/* Picker Dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fingerprint className="h-5 w-5" />
              Select Style Source Scripts (1–5)
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : scripts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No scripts found. Upload or generate scripts first.
            </p>
          ) : (
            <ScrollArea className="max-h-[350px]">
              <div className="space-y-1">
                {scripts.map(s => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.has(s.id)}
                      onCheckedChange={() => toggleSelect(s.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{s.title}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.doc_type} • {new Date(s.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </ScrollArea>
          )}

          <div className="flex justify-between items-center pt-2">
            <span className="text-xs text-muted-foreground">{selected.size}/5 selected</span>
            <Button
              onClick={handleBuildFingerprint}
              disabled={selected.size === 0 || building}
              size="sm"
              className="gap-1"
            >
              {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
              {building ? 'Building…' : 'Build Fingerprint'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
