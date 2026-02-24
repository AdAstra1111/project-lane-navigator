/**
 * Canon Pack Manager — Add/remove project documents from a trailer definition pack
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Settings2, Plus, Trash2, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface CanonPackManagerProps {
  projectId: string;
  canonPackId: string;
}

const ROLE_OPTIONS = [
  { value: 'primary', label: 'Primary' },
  { value: 'supporting', label: 'Supporting' },
  { value: 'reference', label: 'Reference' },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  blueprint: 'Blueprint',
  architecture: 'Architecture',
  beat_sheet: 'Beat Sheet',
  character_bible: 'Character Bible',
  concept_brief: 'Concept Brief',
  idea: 'Idea',
  script_pdf: 'Script',
  script_coverage: 'Coverage',
  market_sheet: 'Market Sheet',
  treatment: 'Treatment',
  feature_script: 'Feature Script',
  episode_script: 'Episode Script',
};

export function CanonPackManager({ projectId, canonPackId }: CanonPackManagerProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  // Fetch pack items
  const { data: packItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['canon-pack-items', canonPackId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_definition_pack_items')
        .select('id, document_id, version_id, role, sort_order, notes')
        .eq('pack_id', canonPackId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!canonPackId && open,
  });

  // Fetch project documents
  const { data: projectDocs = [] } = useQuery({
    queryKey: ['project-docs-for-pack', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_documents')
        .select('id, doc_type, title')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId && open,
  });

  const addedDocIds = new Set(packItems.map((i: any) => i.document_id));
  const availableDocs = projectDocs.filter((d: any) => !addedDocIds.has(d.id));

  const addItem = useMutation({
    mutationFn: async (docId: string) => {
      const { error } = await supabase
        .from('trailer_definition_pack_items')
        .insert({
          pack_id: canonPackId,
          project_id: projectId,
          document_id: docId,
          role: 'supporting',
          sort_order: packItems.length,
          include: true,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canon-pack-items', canonPackId] });
      toast.success('Document added to pack');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('trailer_definition_pack_items')
        .delete()
        .eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canon-pack-items', canonPackId] });
      toast.success('Document removed');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateRole = useMutation({
    mutationFn: async ({ itemId, role }: { itemId: string; role: string }) => {
      const { error } = await supabase
        .from('trailer_definition_pack_items')
        .update({ role })
        .eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canon-pack-items', canonPackId] });
    },
  });

  const getDocTitle = (docId: string) => {
    const doc = projectDocs.find((d: any) => d.id === docId);
    return doc?.title || docId.slice(0, 8);
  };

  const getDocType = (docId: string) => {
    const doc = projectDocs.find((d: any) => d.id === docId);
    return doc?.doc_type ? (DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type) : '';
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Manage Pack">
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Canon Pack Documents</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current items */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              Documents in pack ({packItems.length})
            </p>
            {itemsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : packItems.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-3 text-center border border-dashed border-border rounded-md">
                No documents yet. Add from below.
              </p>
            ) : (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-1.5">
                  {packItems.map((item: any) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 p-2 rounded-md border border-border bg-card text-xs"
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{getDocTitle(item.document_id)}</p>
                        <p className="text-[10px] text-muted-foreground">{getDocType(item.document_id)}</p>
                      </div>
                      <Select
                        value={item.role}
                        onValueChange={(role) => updateRole.mutate({ itemId: item.id, role })}
                      >
                        <SelectTrigger className="h-6 w-[90px] text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((r) => (
                            <SelectItem key={r.value} value={r.value} className="text-xs">
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem.mutate(item.id)}
                        disabled={removeItem.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Available documents */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              Available documents ({availableDocs.length})
            </p>
            {availableDocs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2 text-center">
                All documents already added.
              </p>
            ) : (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-1">
                  {availableDocs.map((doc: any) => (
                    <button
                      key={doc.id}
                      onClick={() => addItem.mutate(doc.id)}
                      disabled={addItem.isPending}
                      className="w-full flex items-center gap-2 p-2 rounded-md border border-border hover:border-primary/40 hover:bg-primary/5 text-xs transition-colors text-left"
                    >
                      <Plus className="h-3 w-3 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate">{doc.title || doc.id.slice(0, 8)}</p>
                      </div>
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                      </Badge>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
