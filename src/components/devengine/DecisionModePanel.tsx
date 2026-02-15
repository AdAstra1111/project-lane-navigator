/**
 * DecisionModePanel — Streamlined "Decision Mode" panel.
 * Shows decisions list, global directions, document viewer header, and single primary CTA.
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, Sparkles, AlertTriangle, ArrowRight, Lightbulb, FileText, Clock,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { DecisionCard, type Decision, type DecisionOption } from './DecisionCard';
import { toast } from 'sonner';

interface GlobalDirection {
  id: string;
  direction: string;
  why: string;
}

interface DecisionModePanelProps {
  projectId: string;
  documentId?: string | null;
  versionId?: string | null;
  documentText?: string;
  docType?: string;
  versionNumber?: number;
  updatedAt?: string;
  /** Pre-loaded decisions from OPTIONS run */
  decisions?: Decision[];
  globalDirections?: GlobalDirection[];
  /** Auto-run job context */
  jobId?: string | null;
  isAutoRunPaused?: boolean;
  /** Callbacks */
  onRewriteComplete?: () => void;
  onAutoRunContinue?: (
    selectedOptions: Array<{ note_id: string; option_id: string; custom_direction?: string }>,
    globalDirections?: string[]
  ) => void | Promise<void>;
  onGenerateOptions?: () => void;
  isGeneratingOptions?: boolean;
  /** Available versions for "continue from" dropdown */
  availableVersions?: Array<{ id: string; version_number: number; label?: string | null }>;
}

async function callDevEngine(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Dev engine error');
  return result;
}

export function DecisionModePanel({
  projectId, documentId, versionId, documentText,
  docType, versionNumber, updatedAt,
  decisions: externalDecisions, globalDirections: externalDirections,
  jobId, isAutoRunPaused,
  onRewriteComplete, onAutoRunContinue, onGenerateOptions,
  isGeneratingOptions, availableVersions,
}: DecisionModePanelProps) {
  const [decisions, setDecisions] = useState<Decision[]>(externalDecisions || []);
  const [globalDirections, setGlobalDirections] = useState<GlobalDirection[]>(externalDirections || []);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [customDirections, setCustomDirections] = useState<Record<string, string>>({});
  const [isApplying, setIsApplying] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [continueVersionId, setContinueVersionId] = useState<string>('latest');

  // Sync external decisions
  useEffect(() => {
    if (externalDecisions && externalDecisions.length > 0) {
      setDecisions(externalDecisions);
      const autoSelections: Record<string, string> = {};
      for (const d of externalDecisions) {
        const rec = d.recommended_option_id || d.recommended;
        if (rec) autoSelections[d.note_id] = rec;
      }
      setSelectedOptions(autoSelections);
    }
  }, [externalDecisions]);

  useEffect(() => {
    if (externalDirections) setGlobalDirections(externalDirections);
  }, [externalDirections]);

  const handleGenerateOptions = useCallback(async () => {
    if (onGenerateOptions) { onGenerateOptions(); return; }
    if (!documentId || !versionId) return;
    setIsLoadingOptions(true);
    try {
      const result = await callDevEngine('options', { projectId, documentId, versionId });
      const opts = result?.options || {};
      setDecisions(opts.decisions || []);
      setGlobalDirections(opts.global_directions || []);
      const autoSelections: Record<string, string> = {};
      for (const d of (opts.decisions || [])) {
        const rec = d.recommended_option_id || d.recommended;
        if (rec) autoSelections[d.note_id] = rec;
      }
      setSelectedOptions(autoSelections);
    } catch (e: any) {
      toast.error(`Options failed: ${e.message}`);
    } finally {
      setIsLoadingOptions(false);
    }
  }, [projectId, documentId, versionId, onGenerateOptions]);

  const handleSelectOption = useCallback((noteId: string, optionId: string) => {
    setSelectedOptions(prev => ({
      ...prev,
      [noteId]: prev[noteId] === optionId ? '' : optionId,
    }));
  }, []);

  const handleCustomDirection = useCallback((noteId: string, text: string) => {
    setCustomDirections(prev => ({ ...prev, [noteId]: text }));
  }, []);

  // Blocker coverage validation
  const blockerDecisions = useMemo(() => decisions.filter(d => d.severity === 'blocker'), [decisions]);
  const uncoveredBlockers = useMemo(() => blockerDecisions.filter(d => !selectedOptions[d.note_id]), [blockerDecisions, selectedOptions]);
  const allBlockersCovered = uncoveredBlockers.length === 0;
  const selectedCount = Object.values(selectedOptions).filter(Boolean).length;

  const applyingRef = React.useRef(false);
  const handleApplyDecisions = useCallback(async () => {
    if (!allBlockersCovered) {
      toast.error(`Select options for all ${uncoveredBlockers.length} blocker(s) first`);
      return;
    }
    if (applyingRef.current) return;
    applyingRef.current = true;
    setIsApplying(true);
    try {
      const opts = Object.entries(selectedOptions)
        .filter(([, optId]) => !!optId)
        .map(([noteId, optionId]) => ({
          note_id: noteId,
          option_id: optionId,
          custom_direction: customDirections[noteId] || undefined,
        }));
      const gd = globalDirections.map(d => d.direction);

      if (jobId && onAutoRunContinue) {
        await onAutoRunContinue(opts, gd);
      } else {
        if (!documentId || !versionId) return;
        const effectiveVersionId = continueVersionId === 'latest' ? versionId : continueVersionId;
        await callDevEngine('rewrite', {
          projectId, documentId, versionId: effectiveVersionId,
          selectedOptions: opts, globalDirections: gd,
          approvedNotes: [], protectItems: [],
        });
        toast.success('Decisions applied — new version created');
        onRewriteComplete?.();
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIsApplying(false);
      applyingRef.current = false;
    }
  }, [allBlockersCovered, selectedOptions, customDirections, globalDirections, jobId, documentId, versionId, continueVersionId, projectId, onAutoRunContinue, onRewriteComplete, uncoveredBlockers.length]);

  const loading = isGeneratingOptions || isLoadingOptions;

  return (
    <div className="space-y-3" id="decision-panel-anchor">
      {/* Document Viewer Header */}
      {(docType || versionNumber) && (
        <div className="flex items-center gap-2 px-1">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-foreground">{docType || 'Document'}</span>
          {versionNumber && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0">v{versionNumber}</Badge>
          )}
          {updatedAt && (
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {new Date(updatedAt).toLocaleDateString()}
            </span>
          )}
          {documentText && (
            <span className="text-[9px] text-muted-foreground">
              {documentText.length.toLocaleString()} chars
            </span>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <Card className="border-primary/20">
          <CardContent className="py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Generating decision options…
          </CardContent>
        </Card>
      )}

      {/* Main Decision Panel */}
      {!loading && (
        <Card className="border-primary/20">
          <CardHeader className="py-2 px-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                Decision Mode
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {blockerDecisions.length > 0 && (
                  <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[9px] px-1.5 py-0">
                    {blockerDecisions.length} Blocker{blockerDecisions.length !== 1 ? 's' : ''}
                  </Badge>
                )}
                {decisions.length > 0 && (
                  <Badge className="bg-primary/10 text-primary border-primary/30 text-[9px] px-1.5 py-0">
                    {selectedCount}/{decisions.length} selected
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="px-2 pb-2 space-y-2">
            {/* Global Directions */}
            {globalDirections.length > 0 && (
              <div className="space-y-1 p-2 rounded border border-primary/20 bg-primary/5">
                <div className="flex items-center gap-1 text-[10px] font-medium text-primary">
                  <Lightbulb className="h-3 w-3" />
                  Global Directions
                </div>
                {globalDirections.map((d) => (
                  <div key={d.id} className="flex items-start gap-1.5">
                    <ArrowRight className="h-2.5 w-2.5 mt-0.5 text-primary/60 shrink-0" />
                    <div>
                      <p className="text-[10px] text-foreground font-medium">{d.direction}</p>
                      <p className="text-[9px] text-muted-foreground">{d.why}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {decisions.length === 0 && !loading && (
              <div className="text-center py-4 space-y-2">
                <p className="text-xs text-muted-foreground">No decision options yet.</p>
                <Button size="sm" className="h-7 text-xs gap-1" onClick={handleGenerateOptions}
                  disabled={!documentId || !versionId}>
                  <Sparkles className="h-3 w-3" /> Generate Options
                </Button>
              </div>
            )}

            {/* Decision items */}
            {decisions.length > 0 && (
              <ScrollArea className="max-h-[500px]">
                <div className="space-y-2">
                  {decisions.map((decision) => (
                    <DecisionCard
                      key={decision.note_id}
                      decision={decision}
                      selectedOptionId={selectedOptions[decision.note_id]}
                      customDirection={customDirections[decision.note_id]}
                      onSelectOption={(optId) => handleSelectOption(decision.note_id, optId)}
                      onCustomDirection={(text) => handleCustomDirection(decision.note_id, text)}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Continue from version dropdown */}
            {!jobId && availableVersions && availableVersions.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">Continue from:</span>
                <Select value={continueVersionId} onValueChange={setContinueVersionId}>
                  <SelectTrigger className="h-6 text-[10px] flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest">Latest version</SelectItem>
                    {availableVersions.map(v => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.version_number}{v.label ? ` · ${v.label}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Uncovered blockers warning */}
            {!allBlockersCovered && decisions.length > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-destructive p-1.5 rounded bg-destructive/10 border border-destructive/20">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Select an option for all {uncoveredBlockers.length} uncovered blocker(s) before applying.
              </div>
            )}

            {/* Primary CTA */}
            {decisions.length > 0 && (
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 w-full"
                onClick={handleApplyDecisions}
                disabled={isApplying || !allBlockersCovered}
              >
                {isApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {jobId ? 'Apply Decisions & Continue Auto-Run' : 'Apply Decisions'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
