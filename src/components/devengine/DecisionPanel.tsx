/**
 * DecisionPanel — Shows decisions for blockers/high-impact notes, allows selection, triggers rewrite.
 * Used both in manual dev-engine flow and auto-run decision gates.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CheckCircle2, Loader2, Sparkles, AlertTriangle, ArrowRight, Lightbulb,
  Play, ChevronDown,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';

interface DecisionOption {
  option_id: string;
  title: string;
  what_changes: string[];
  creative_tradeoff: string;
  commercial_lift: number;
}

interface Decision {
  note_id: string;
  severity: string;
  note: string;
  options: DecisionOption[];
  recommended: string;
}

interface GlobalDirection {
  id: string;
  direction: string;
  why: string;
}

interface DecisionPanelProps {
  projectId: string;
  documentId?: string | null;
  versionId?: string | null;
  documentText?: string;
  /** Pre-loaded decisions (from notes or options run) */
  decisions?: Decision[];
  globalDirections?: GlobalDirection[];
  /** Auto-run job context */
  jobId?: string | null;
  /** Called after rewrite completes (manual mode) */
  onRewriteComplete?: () => void;
  /** Called after apply-decisions-and-continue (auto-run mode) */
  onAutoRunContinue?: () => void;
  /** Loading state indicator */
  isGeneratingOptions?: boolean;
  /** Available versions for "continue from" dropdown */
  availableVersions?: Array<{ id: string; version_number: number; label?: string }>;
}

async function callAutoRun(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Auto-run error');
  return result;
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

function OptionCard({
  option, isSelected, isRecommended, onSelect,
}: {
  option: DecisionOption;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded px-2.5 py-2 border transition-all ${
        isSelected
          ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/30'
          : 'border-border/30 bg-muted/20 hover:border-border/60'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
          isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
        }`}>
          {isSelected && <CheckCircle2 className="h-2.5 w-2.5 text-primary-foreground" />}
        </div>
        <span className="text-[11px] font-medium text-foreground">{option.title}</span>
        {isRecommended && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/40 text-primary bg-primary/10">
            Recommended
          </Badge>
        )}
        {option.commercial_lift > 0 && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-emerald-500/30 text-emerald-500">
            +{option.commercial_lift} GP
          </Badge>
        )}
      </div>
      <div className="pl-5 space-y-0.5">
        <div className="flex flex-wrap gap-0.5">
          {option.what_changes.map((c, i) => (
            <Badge key={i} variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground border-border/40">
              {c}
            </Badge>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground italic">{option.creative_tradeoff}</p>
      </div>
    </button>
  );
}

function DecisionItem({
  decision,
  selectedOptionId,
  customDirection,
  onSelectOption,
  onCustomDirection,
}: {
  decision: Decision;
  selectedOptionId?: string;
  customDirection?: string;
  onSelectOption: (optionId: string) => void;
  onCustomDirection: (text: string) => void;
}) {
  const [showCustom, setShowCustom] = useState(false);
  const severityColor = decision.severity === 'blocker'
    ? 'border-destructive/40 bg-destructive/5'
    : 'border-amber-500/40 bg-amber-500/5';
  const severityLabel = decision.severity === 'blocker' ? '🔴 Blocker' : '🟠 High Impact';
  const severityBadge = decision.severity === 'blocker'
    ? 'bg-destructive/20 text-destructive border-destructive/30'
    : 'bg-amber-500/20 text-amber-400 border-amber-500/30';

  return (
    <div className={`rounded border p-2.5 space-y-2 ${severityColor}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${severityBadge}`}>{severityLabel}</Badge>
        {selectedOptionId && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/40 text-primary bg-primary/10">
            ✓ Selected
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-foreground leading-relaxed">{decision.note}</p>

      <div className="space-y-1.5">
        {decision.options.map((opt) => (
          <OptionCard
            key={opt.option_id}
            option={opt}
            isSelected={selectedOptionId === opt.option_id}
            isRecommended={decision.recommended === opt.option_id}
            onSelect={() => onSelectOption(opt.option_id)}
          />
        ))}
      </div>

      <Collapsible open={showCustom} onOpenChange={setShowCustom}>
        <CollapsibleTrigger className="text-[9px] text-primary hover:underline flex items-center gap-0.5">
          <ChevronDown className={`h-2.5 w-2.5 transition-transform ${showCustom ? 'rotate-180' : ''}`} />
          Custom direction
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1">
          <Textarea
            placeholder="Add your own direction for this note..."
            value={customDirection || ''}
            onChange={(e) => onCustomDirection(e.target.value)}
            className="text-[10px] min-h-[50px] h-12"
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function DecisionPanel({
  projectId, documentId, versionId, documentText,
  decisions: externalDecisions, globalDirections: externalDirections,
  jobId, onRewriteComplete, onAutoRunContinue,
  isGeneratingOptions, availableVersions,
}: DecisionPanelProps) {
  const [decisions, setDecisions] = useState<Decision[]>(externalDecisions || []);
  const [globalDirections, setGlobalDirections] = useState<GlobalDirection[]>(externalDirections || []);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [customDirections, setCustomDirections] = useState<Record<string, string>>({});
  const [isApplying, setIsApplying] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [continueVersionId, setContinueVersionId] = useState<string>(versionId || 'latest');

  // Sync external decisions
  useEffect(() => {
    if (externalDecisions && externalDecisions.length > 0) {
      setDecisions(externalDecisions);
      // Auto-select recommended options
      const autoSelections: Record<string, string> = {};
      for (const d of externalDecisions) {
        if (d.recommended) autoSelections[d.note_id] = d.recommended;
      }
      setSelectedOptions(autoSelections);
    }
  }, [externalDecisions]);

  useEffect(() => {
    if (externalDirections) setGlobalDirections(externalDirections);
  }, [externalDirections]);

  const handleGenerateOptions = useCallback(async () => {
    if (!documentId || !versionId) return;
    setIsLoadingOptions(true);
    try {
      const result = await callDevEngine('options', { projectId, documentId, versionId });
      const opts = result?.options || {};
      setDecisions(opts.decisions || []);
      setGlobalDirections(opts.global_directions || []);
      // Auto-select recommended
      const autoSelections: Record<string, string> = {};
      for (const d of (opts.decisions || [])) {
        if (d.recommended) autoSelections[d.note_id] = d.recommended;
      }
      setSelectedOptions(autoSelections);
    } catch (e: any) {
      console.error('Failed to generate options:', e.message);
    } finally {
      setIsLoadingOptions(false);
    }
  }, [projectId, documentId, versionId]);

  const handleSelectOption = useCallback((noteId: string, optionId: string) => {
    setSelectedOptions(prev => ({
      ...prev,
      [noteId]: prev[noteId] === optionId ? '' : optionId,
    }));
  }, []);

  const handleCustomDirection = useCallback((noteId: string, text: string) => {
    setCustomDirections(prev => ({ ...prev, [noteId]: text }));
  }, []);

  // Count how many blocker decisions are covered
  const blockerDecisions = decisions.filter(d => d.severity === 'blocker');
  const uncoveredBlockers = blockerDecisions.filter(d => !selectedOptions[d.note_id]);
  const allBlockersCovered = uncoveredBlockers.length === 0;
  const selectedCount = Object.values(selectedOptions).filter(Boolean).length;

  const applyingRef = useRef(false);
  const handleApplyDecisions = useCallback(async () => {
    if (!allBlockersCovered) return;
    if (applyingRef.current) return; // prevent duplicate calls
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

      if (jobId) {
        // Auto-run mode: apply decisions and continue
        await callAutoRun('apply-decisions-and-continue', {
          jobId,
          selectedOptions: opts,
          globalDirections: gd,
        });
        onAutoRunContinue?.();
      } else {
        // Manual mode: call rewrite directly
        if (!documentId || !versionId) return;
        await callDevEngine('rewrite', {
          projectId,
          documentId,
          versionId: continueVersionId === 'latest' ? versionId : continueVersionId,
          selectedOptions: opts,
          globalDirections: gd,
          approvedNotes: [],
          protectItems: [],
        });
        onRewriteComplete?.();
      }
    } catch (e: any) {
      console.error('Apply decisions failed:', e.message);
    } finally {
      setIsApplying(false);
      applyingRef.current = false;
    }
  }, [allBlockersCovered, selectedOptions, customDirections, globalDirections, jobId, documentId, versionId, continueVersionId, projectId, onAutoRunContinue, onRewriteComplete]);

  const loading = isGeneratingOptions || isLoadingOptions;

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardContent className="py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Generating decision options…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            Decisions Required
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {blockerDecisions.length > 0 && (
              <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[9px] px-1.5 py-0">
                {blockerDecisions.length} Blockers
              </Badge>
            )}
            <Badge className="bg-primary/10 text-primary border-primary/30 text-[9px] px-1.5 py-0">
              {selectedCount}/{decisions.length} selected
            </Badge>
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

        {/* No decisions available — generate button */}
        {decisions.length === 0 && (
          <div className="text-center py-4 space-y-2">
            <p className="text-xs text-muted-foreground">No decision options available yet.</p>
            <Button size="sm" className="h-7 text-xs gap-1" onClick={handleGenerateOptions}
              disabled={!documentId || !versionId}>
              <Sparkles className="h-3 w-3" /> Generate Options
            </Button>
          </div>
        )}

        {/* Decision items */}
        <ScrollArea className="max-h-[500px]">
          <div className="space-y-2">
            {decisions.map((decision) => (
              <DecisionItem
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

        {/* Document text preview */}
        {documentText && (
          <Collapsible>
            <CollapsibleTrigger className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 w-full py-1">
              <ChevronDown className="h-3 w-3" />
              Preview document ({documentText.length.toLocaleString()} chars)
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-[200px] mt-1 rounded border border-border/40 bg-muted/20 p-2">
                <pre className="text-[10px] text-foreground/80 whitespace-pre-wrap font-body">
                  {documentText.slice(0, 5000)}{documentText.length > 5000 ? '\n\n... (truncated)' : ''}
                </pre>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Continue from version dropdown */}
        {availableVersions && availableVersions.length > 1 && (
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

        {/* Action buttons */}
        {decisions.length > 0 && (
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-7 text-xs gap-1 flex-1"
              onClick={handleApplyDecisions}
              disabled={isApplying || !allBlockersCovered}
            >
              {isApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {jobId ? 'Apply & Continue Auto-Run' : 'Apply Decisions'}
            </Button>
            {!jobId && documentId && versionId && decisions.length === 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={handleGenerateOptions}
                disabled={isLoadingOptions}
              >
                {isLoadingOptions ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Generate Options
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
