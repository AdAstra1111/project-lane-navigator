/**
 * DocSetManager — Project-level doc set CRUD panel.
 * Lists doc sets, create/rename/delete, edit items, set default.
 */
import { useState, useEffect, useCallback } from 'react';
import { useDocSets, type DocSet, type DocSetWithItems, docSetItemOrder } from '@/hooks/useDocSets';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Plus, Star, Trash2, Edit2, ChevronUp, ChevronDown, Loader2, Layers, Save,
} from 'lucide-react';

interface DocSetManagerProps {
  projectId: string;
}

interface ProjectDoc {
  id: string;
  title: string;
  doc_type: string;
  updated_at: string;
}

export function DocSetManager({ projectId }: DocSetManagerProps) {
  const ds = useDocSets(projectId);
  const sets = ds.listQuery.data || [];

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<string[]>([]);
  const [editLoading, setEditLoading] = useState(false);

  // Create state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Project documents
  const docsQuery = useQuery<ProjectDoc[]>({
    queryKey: ['doc-set-project-docs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_documents')
        .select('id, title, doc_type, updated_at')
        .eq('project_id', projectId)
        .order('doc_type')
        .order('title');
      if (error) throw error;
      return (data || []) as ProjectDoc[];
    },
  });
  const projectDocs = docsQuery.data || [];

  const handleCreate = useCallback(() => {
    if (!newName.trim()) return;
    ds.createDocSet.mutate({ name: newName.trim(), description: newDesc.trim() || undefined }, {
      onSuccess: () => { setShowCreate(false); setNewName(''); setNewDesc(''); },
    });
  }, [newName, newDesc, ds.createDocSet]);

  const handleEdit = useCallback(async (docSetId: string) => {
    setEditLoading(true);
    try {
      const full = await ds.fetchDocSet(docSetId);
      setEditingId(docSetId);
      setEditItems(docSetItemOrder(full.items));
    } catch {
      // ignore
    } finally {
      setEditLoading(false);
    }
  }, [ds]);

  const toggleDoc = useCallback((docId: string) => {
    setEditItems(prev =>
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  }, []);

  const moveItem = useCallback((idx: number, dir: -1 | 1) => {
    setEditItems(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const handleSaveItems = useCallback(() => {
    if (!editingId) return;
    ds.upsertItems.mutate({ docSetId: editingId, documentIds: editItems }, {
      onSuccess: () => setEditingId(null),
    });
  }, [editingId, editItems, ds.upsertItems]);

  const handleRename = useCallback((setId: string) => {
    if (!renameValue.trim()) return;
    ds.updateDocSet.mutate({ id: setId, name: renameValue.trim() }, {
      onSuccess: () => setRenamingId(null),
    });
  }, [renameValue, ds.updateDocSet]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Doc Sets
          </CardTitle>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowCreate(true)}>
            <Plus className="h-3 w-3" /> New
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {ds.listQuery.isLoading ? (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : sets.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No doc sets yet. Create one to control which documents feed your tools.</p>
        ) : (
          <div className="space-y-1.5">
            {sets.map(s => (
              <div key={s.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
                <div className="flex-1 min-w-0">
                  {renamingId === s.id ? (
                    <div className="flex gap-1">
                      <Input
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        className="h-6 text-xs"
                        onKeyDown={e => e.key === 'Enter' && handleRename(s.id)}
                        autoFocus
                      />
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1" onClick={() => handleRename(s.id)}>
                        <Save className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1" onClick={() => setRenamingId(null)}>✕</Button>
                    </div>
                  ) : (
                    <span className="font-medium truncate">{s.name}</span>
                  )}
                  {s.description && <p className="text-[10px] text-muted-foreground truncate">{s.description}</p>}
                </div>
                {s.is_default && <Badge variant="secondary" className="text-[8px] px-1 shrink-0">Default</Badge>}
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" title="Edit items"
                  onClick={() => handleEdit(s.id)} disabled={editLoading}>
                  <Edit2 className="h-3 w-3" />
                </Button>
                {!s.is_default && (
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" title="Set as default"
                    onClick={() => ds.setDefault.mutate(s.id)} disabled={ds.setDefault.isPending}>
                    <Star className="h-3 w-3" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" title="Rename"
                  onClick={() => { setRenamingId(s.id); setRenameValue(s.name); }}>
                  <Edit2 className="h-2.5 w-2.5 text-muted-foreground" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive" title="Delete"
                  onClick={() => { if (confirm(`Delete doc set "${s.name}"?`)) ds.deleteDocSet.mutate(s.id); }}
                  disabled={ds.deleteDocSet.isPending}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">New Doc Set</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} className="text-sm" autoFocus />
            <Input placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} className="text-sm" />
            <Button className="w-full text-xs h-8" disabled={!newName.trim() || ds.createDocSet.isPending} onClick={handleCreate}>
              {ds.createDocSet.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit items dialog */}
      <Dialog open={!!editingId} onOpenChange={(open) => { if (!open) setEditingId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Edit Doc Set Items</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              Select documents ({editItems.length} selected)
            </p>
            <ScrollArea className="h-48 border rounded-md p-2">
              <div className="space-y-1">
                {projectDocs.map(doc => (
                  <label key={doc.id} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-muted/50 rounded px-1">
                    <Checkbox
                      checked={editItems.includes(doc.id)}
                      onCheckedChange={() => toggleDoc(doc.id)}
                    />
                    <span className="text-xs flex-1 truncate">{doc.title || doc.doc_type}</span>
                    <Badge variant="outline" className="text-[8px] px-1 shrink-0">{doc.doc_type}</Badge>
                  </label>
                ))}
              </div>
            </ScrollArea>

            {/* Ordering */}
            {editItems.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Order</p>
                <div className="space-y-0.5 max-h-32 overflow-auto">
                  {editItems.map((docId, idx) => {
                    const doc = projectDocs.find(d => d.id === docId);
                    return (
                      <div key={docId} className="flex items-center gap-1 text-[10px] px-1 py-0.5 rounded bg-muted/30">
                        <span className="font-mono text-muted-foreground w-4">{idx + 1}</span>
                        <span className="flex-1 truncate">{doc?.title || docId.slice(0, 8)}</span>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" disabled={idx === 0}
                          onClick={() => moveItem(idx, -1)}>
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" disabled={idx === editItems.length - 1}
                          onClick={() => moveItem(idx, 1)}>
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <Button className="w-full text-xs h-8" onClick={handleSaveItems} disabled={ds.upsertItems.isPending}>
              {ds.upsertItems.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
              Save Items
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
