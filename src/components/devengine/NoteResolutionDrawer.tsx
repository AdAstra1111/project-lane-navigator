/**
 * NoteResolutionDrawer — Unified drawer for viewing fix options, choosing a fix,
 * and applying it to the correct target document/version.
 * Used for all note types: regular, carried, deferred, forwarded.
 */
import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Loader2, Check, X, Wand2, Shield, AlertTriangle, Clock, ExternalLink, Sparkles,
} from 'lucide-react';

export interface FixOption {
  id: string;
  title: string;
  description: string;
  patch_strategy?: string;
  instructions?: string;
  expected_effect?: string;
  risk_level?: string;
}

export interface NoteForResolution {
  id?: string;
  note_key?: string;
  source: 'regular' | 'carried' | 'deferred' | 'forwarded';
  summary: string;
  detail?: string;
  category?: string;
  severity?: string;
  target_doc_type?: string;
  source_doc_type?: string;
  fix_options?: FixOption[];
  recommended_fix_id?: string;
  note_data?: any; // full note payload for backend
}

interface NoteResolutionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: NoteForResolution | null;
  projectId: string;
  currentVersionId?: string;
  onApplied?: (result: { new_version_id: string; new_version_number: number; approved: boolean }) => void;
  onResolved?: (noteId: string) => void;
  onDeferred?: (noteId: string) => void;
  onOpenWritersRoom?: (note: NoteForResolution) => void;
}

export function NoteResolutionDrawer({
  open, onOpenChange, note, projectId, currentVersionId, onApplied, onResolved, onDeferred, onOpenWritersRoom,
}: NoteResolutionDrawerProps) {
  const [fixOptions, setFixOptions] = useState<FixOption[]>([]);
  const [recommendedId, setRecommendedId] = useState<string | null>(null);
  const [selectedFixId, setSelectedFixId] = useState<string | null>(null);
  const [approveAfter, setApproveAfter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when note changes
  const currentNoteId = note?.id || note?.note_key || '';

  const loadFixOptions = useCallback(async () => {
    if (!note || !projectId) return;

    // If note already has fix options, use them
    if (note.fix_options && note.fix_options.length > 0) {
      setFixOptions(note.fix_options);
      setRecommendedId(note.recommended_fix_id || note.fix_options[0]?.id || null);
      setSelectedFixId(note.recommended_fix_id || note.fix_options[0]?.id || null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await supabase.functions.invoke('apply-note-fix', {
        body: {
          action: 'get_fix_options',
          project_id: projectId,
          note_id: note.id || note.note_key,
          note_data: note.note_data || {
            description: note.summary,
            detail: note.detail,
            category: note.category,
            target_doc_type: note.target_doc_type,
          },
          target_doc_type: note.target_doc_type,
          base_version_id: currentVersionId,
        },
      });

      if (resp.error) throw new Error(resp.error.message);
      const data = resp.data;
      const options = data.fix_options || [];
      setFixOptions(options);
      setRecommendedId(data.recommended_fix_id || options[0]?.id || null);
      setSelectedFixId(data.recommended_fix_id || options[0]?.id || null);
    } catch (e: any) {
      setError(e.message);
      toast.error('Failed to generate fix options');
    } finally {
      setLoading(false);
    }
  }, [note, projectId, currentVersionId]);

  // Auto-load when drawer opens
  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen && note) {
      setFixOptions(note.fix_options || []);
      setSelectedFixId(note.recommended_fix_id || null);
      setRecommendedId(note.recommended_fix_id || null);
      setApproveAfter(false);
      setApplied(false);
      setError(null);
      if (!note.fix_options?.length) {
        // Defer to next tick so state is set
        setTimeout(() => loadFixOptions(), 0);
      } else {
        setSelectedFixId(note.recommended_fix_id || note.fix_options[0]?.id || null);
        setRecommendedId(note.recommended_fix_id || note.fix_options[0]?.id || null);
      }
    }
    onOpenChange(isOpen);
  }, [note, onOpenChange, loadFixOptions]);

  const handleApplyFix = useCallback(async () => {
    if (!note || !projectId || !selectedFixId) return;
    const fix = fixOptions.find(f => f.id === selectedFixId);
    if (!fix) { toast.error('Select a fix option'); return; }

    setApplying(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await supabase.functions.invoke('apply-note-fix', {
        body: {
          action: 'apply_fix',
          project_id: projectId,
          note_id: note.id || note.note_key,
          note_source: note.source,
          note_data: note.note_data || {
            description: note.summary,
            detail: note.detail,
            category: note.category,
            target_doc_type: note.target_doc_type,
          },
          fix_id: selectedFixId,
          fix_object: fix,
          target_doc_type: note.target_doc_type,
          base_version_id: currentVersionId,
          approve_after_apply: approveAfter,
        },
      });

      if (resp.error) throw new Error(resp.error.message);
      const data = resp.data;

      if (data.error) {
        if (data.needs_doc_creation) {
          toast.error(`Target document "${note.target_doc_type}" doesn't exist yet. Create it first or defer this note.`);
        } else {
          throw new Error(data.error);
        }
        return;
      }

      toast.success(`Fix applied → v${data.new_version_number}${data.approved ? ' (approved)' : ''}`);
      setApplied(true);
      onApplied?.(data);
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message || 'Failed to apply fix');
    } finally {
      setApplying(false);
    }
  }, [note, projectId, selectedFixId, fixOptions, approveAfter, currentVersionId, onApplied, onOpenChange]);

  const handleMarkResolved = useCallback(async () => {
    if (!note) return;
    const noteId = note.id || note.note_key || '';
    onResolved?.(noteId);
    onOpenChange(false);
  }, [note, onResolved, onOpenChange]);

  const handleDefer = useCallback(() => {
    if (!note) return;
    const noteId = note.id || note.note_key || '';
    onDeferred?.(noteId);
    onOpenChange(false);
  }, [note, onDeferred, onOpenChange]);

  if (!note) return null;

  const selectedFix = fixOptions.find(f => f.id === selectedFixId);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Note Resolution
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
          <div className="space-y-3 pr-2">
            {/* Note summary */}
            <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {note.category && <Badge variant="outline" className="text-[9px]">{note.category}</Badge>}
                {note.severity && (
                  <Badge variant="outline" className={`text-[9px] ${note.severity === 'blocker' ? 'text-destructive border-destructive/30' : note.severity === 'high' ? 'text-amber-500 border-amber-500/30' : 'text-muted-foreground'}`}>
                    {note.severity}
                  </Badge>
                )}
                {note.source_doc_type && <Badge variant="outline" className="text-[9px]">From: {note.source_doc_type.replace(/_/g, ' ')}</Badge>}
                {note.target_doc_type && <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">Target: {note.target_doc_type.replace(/_/g, ' ')}</Badge>}
              </div>
              <p className="text-sm text-foreground">{note.summary}</p>
              {note.detail && <p className="text-xs text-muted-foreground">{note.detail}</p>}
            </div>

            {/* Fix options */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Fix Options</p>
                {fixOptions.length === 0 && !loading && (
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={loadFixOptions}>
                    <Wand2 className="h-3 w-3" />Generate fixes
                  </Button>
                )}
              </div>

              {loading && (
                <div className="flex items-center gap-2 p-4 justify-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs">Generating fix options…</span>
                </div>
              )}

              {error && (
                <div className="p-2 rounded border border-destructive/30 bg-destructive/5 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />{error}
                </div>
              )}

              {fixOptions.map((fix) => (
                <button
                  key={fix.id}
                  className={`w-full text-left rounded-lg border p-3 space-y-1 transition-colors ${
                    selectedFixId === fix.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border/50 bg-background hover:border-border'
                  }`}
                  onClick={() => setSelectedFixId(fix.id)}
                >
                  <div className="flex items-center gap-1.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selectedFixId === fix.id ? 'border-primary' : 'border-muted-foreground/30'
                    }`}>
                      {selectedFixId === fix.id && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                    </div>
                    <span className="text-xs font-medium text-foreground">{fix.title}</span>
                    {recommendedId === fix.id && (
                      <Badge variant="outline" className="text-[7px] px-1 py-0 border-primary/40 text-primary">Recommended</Badge>
                    )}
                    {fix.risk_level && (
                      <Badge variant="outline" className={`text-[7px] px-1 py-0 ${
                        fix.risk_level === 'high' ? 'text-destructive border-destructive/30' :
                        fix.risk_level === 'med' ? 'text-amber-500 border-amber-500/30' :
                        'text-emerald-500 border-emerald-500/30'
                      }`}>
                        {fix.risk_level} risk
                      </Badge>
                    )}
                    {fix.patch_strategy && (
                      <Badge variant="outline" className="text-[7px] px-1 py-0 text-muted-foreground">{fix.patch_strategy.replace(/_/g, ' ')}</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground pl-5">{fix.description}</p>
                  {fix.expected_effect && selectedFixId === fix.id && (
                    <p className="text-[10px] text-primary/80 pl-5 italic">Expected: {fix.expected_effect}</p>
                  )}
                </button>
              ))}
            </div>

            {/* Approve after apply option */}
            {fixOptions.length > 0 && selectedFixId && (
              <div className="flex items-center gap-2 p-2 rounded border border-border/30 bg-muted/20">
                <Checkbox
                  id="approve-after"
                  checked={approveAfter}
                  onCheckedChange={(c) => setApproveAfter(!!c)}
                />
                <label htmlFor="approve-after" className="text-[11px] text-muted-foreground cursor-pointer">
                  Approve this version after applying (mark as Active Approved)
                </label>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 pt-2 border-t border-border/30 flex-wrap shrink-0">
          <div className="flex items-center gap-1.5 mr-auto">
            {onOpenWritersRoom && note && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1 border-accent/30 text-accent-foreground hover:bg-accent/10" onClick={() => { onOpenWritersRoom(note); onOpenChange(false); }}>
                <Sparkles className="h-3 w-3" />Writers' Room
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={handleMarkResolved}>
              <Check className="h-3 w-3" />Mark Resolved
            </Button>
            {onDeferred && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={handleDefer}>
                <Clock className="h-3 w-3" />Defer
              </Button>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            className={`h-7 text-xs gap-1.5 ${applied ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
            onClick={applied ? () => onOpenChange(false) : handleApplyFix}
            disabled={applying || (!applied && (!selectedFixId || fixOptions.length === 0))}
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {applied ? 'Applied ✓' : 'Apply Fix'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
