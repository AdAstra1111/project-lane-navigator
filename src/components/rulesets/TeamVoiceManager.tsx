import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTeamVoices, type TeamVoice, type TeamVoiceSource } from '@/hooks/useTeamVoices';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  lane: string;
  userId: string;
  onVoiceCreated?: (voice: TeamVoice) => void;
}

interface ProjectDoc {
  id: string;
  doc_type: string;
  title: string;
  latest_version_id: string | null;
}

const PREFERRED_DOC_TYPES = ['script', 'outline', 'treatment', 'bible', 'character_bible', 'beat_sheet', 'topline_narrative'];

export function TeamVoiceManager({ open, onOpenChange, projectId, lane, userId, onVoiceCreated }: Props) {
  const { voices, buildTeamVoice, updateTeamVoice, deleteTeamVoice } = useTeamVoices(userId);
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [editingVoice, setEditingVoice] = useState<TeamVoice | null>(null);

  // Create form
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [cowrittenDocs, setCowrittenDocs] = useState<Set<string>>(new Set());

  // Load project docs
  useEffect(() => {
    if (!open || !projectId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type, title, latest_version_id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (data) {
        // Sort preferred types first
        const sorted = [...data].sort((a: ProjectDoc, b: ProjectDoc) => {
          const aP = PREFERRED_DOC_TYPES.includes(a.doc_type) ? 0 : 1;
          const bP = PREFERRED_DOC_TYPES.includes(b.doc_type) ? 0 : 1;
          return aP - bP;
        });
        setProjectDocs(sorted);
      }
    })();
  }, [open, projectId]);

  const resetForm = () => {
    setLabel('');
    setDescription('');
    setSelectedDocs(new Set());
    setCowrittenDocs(new Set());
    setEditingVoice(null);
    setMode('list');
  };

  const handleCreate = async () => {
    if (!label.trim() || selectedDocs.size === 0) {
      toast.error('Please enter a label and select at least one document');
      return;
    }

    const sources: TeamVoiceSource[] = Array.from(selectedDocs).map(docId => {
      const doc = projectDocs.find(d => d.id === docId);
      return {
        docId,
        versionId: doc?.latest_version_id || undefined,
        title: doc?.title || doc?.doc_type || undefined,
        isCowritten: cowrittenDocs.has(docId),
        projectId,
      };
    });

    try {
      const result = await buildTeamVoice.mutateAsync({
        label: label.trim(),
        description: description.trim() || undefined,
        projectId,
        lane,
        sources,
      });
      toast.success(`Team Voice "${result.label}" created`);
      onVoiceCreated?.(result);
      resetForm();
    } catch (e: any) {
      toast.error(e.message || 'Failed to create team voice');
    }
  };

  const handleRegenerate = async (voice: TeamVoice) => {
    if (selectedDocs.size === 0) {
      toast.error('Select at least one document');
      return;
    }

    const sources: TeamVoiceSource[] = Array.from(selectedDocs).map(docId => {
      const doc = projectDocs.find(d => d.id === docId);
      return {
        docId,
        versionId: doc?.latest_version_id || undefined,
        title: doc?.title || doc?.doc_type || undefined,
        isCowritten: cowrittenDocs.has(docId),
        projectId,
      };
    });

    try {
      const result = await updateTeamVoice.mutateAsync({
        teamVoiceId: voice.id,
        description: description.trim() || undefined,
        sources,
      });
      toast.success(`Team Voice "${result.label}" updated`);
      resetForm();
    } catch (e: any) {
      toast.error(e.message || 'Failed to update team voice');
    }
  };

  const handleDelete = async (voice: TeamVoice) => {
    try {
      await deleteTeamVoice.mutateAsync(voice.id);
      toast.success(`Deleted "${voice.label}"`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete');
    }
  };

  const toggleDoc = (docId: string) => {
    setSelectedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const isGenerating = buildTeamVoice.isPending || updateTeamVoice.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {mode === 'list' ? 'Team Voices' : mode === 'create' ? 'Create Team Voice' : `Edit: ${editingVoice?.label}`}
          </DialogTitle>
        </DialogHeader>

        {mode === 'list' && (
          <div className="space-y-3">
            {voices.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No team voices yet. Create one from your project documents.
              </p>
            )}
            {voices.map(v => (
              <div key={v.id} className="border border-border/50 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">{v.label}</p>
                    {v.lane_group && <Badge variant="outline" className="text-[8px]">{v.lane_group}</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => {
                        setEditingVoice(v);
                        setLabel(v.label);
                        setDescription(v.description || '');
                        setMode('edit');
                      }}
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={() => handleDelete(v)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">{v.profile_json?.summary || v.description}</p>
                {v.profile_json?.signature_moves?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {v.profile_json.signature_moves.map((m, i) => (
                      <Badge key={i} variant="secondary" className="text-[8px]">{m}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <Button size="sm" className="w-full" onClick={() => setMode('create')}>
              <Plus className="h-3 w-3 mr-1" /> Create New Team Voice
            </Button>
          </div>
        )}

        {(mode === 'create' || mode === 'edit') && (
          <div className="space-y-4">
            {mode === 'create' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Label</Label>
                  <Input
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                    placeholder="e.g. Paradox House Room v1"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Description (optional)</Label>
                  <Textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Short description of this writing voice..."
                    className="text-xs min-h-[60px]"
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">
                Select sample documents ({selectedDocs.size} selected)
              </Label>
              <div className="max-h-[200px] overflow-y-auto space-y-1 border border-border/50 rounded-md p-2">
                {projectDocs.map(doc => (
                  <div key={doc.id} className="flex items-center gap-2 py-1">
                    <Checkbox
                      checked={selectedDocs.has(doc.id)}
                      onCheckedChange={() => toggleDoc(doc.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] truncate">{doc.title || doc.doc_type}</p>
                      <p className="text-[8px] text-muted-foreground">{doc.doc_type.replace(/_/g, ' ')}</p>
                    </div>
                    {selectedDocs.has(doc.id) && (
                      <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={cowrittenDocs.has(doc.id)}
                          onCheckedChange={() => {
                            setCowrittenDocs(prev => {
                              const next = new Set(prev);
                              if (next.has(doc.id)) next.delete(doc.id);
                              else next.add(doc.id);
                              return next;
                            });
                          }}
                          className="h-3 w-3"
                        />
                        Co-written
                      </label>
                    )}
                  </div>
                ))}
                {projectDocs.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-2">
                    No documents found in this project
                  </p>
                )}
              </div>
            </div>

            {/* Profile preview for edit mode */}
            {mode === 'edit' && editingVoice?.profile_json && (
              <div className="bg-muted/30 p-2 rounded-md space-y-1">
                <p className="text-[9px] font-medium">Current Profile</p>
                <p className="text-[9px] text-muted-foreground">{editingVoice.profile_json.summary}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={resetForm} className="text-xs">
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-xs flex-1"
                disabled={isGenerating || (mode === 'create' && (!label.trim() || selectedDocs.size === 0)) || (mode === 'edit' && selectedDocs.size === 0)}
                onClick={() => {
                  if (mode === 'create') handleCreate();
                  else if (editingVoice) handleRegenerate(editingVoice);
                }}
              >
                {isGenerating ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Generating…</>
                ) : mode === 'create' ? (
                  'Generate Team Voice from Samples'
                ) : (
                  'Regenerate Profile'
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
