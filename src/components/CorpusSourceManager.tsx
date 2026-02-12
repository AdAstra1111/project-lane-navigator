import { useState } from 'react';
import { Plus, Trash2, Play, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  useApprovedSources,
  useAddSource,
  useUpdateSource,
  useDeleteSource,
  useIngestSource,
} from '@/hooks/useCorpus';

const STATUS_BADGES: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle2 }> = {
  APPROVED: { variant: 'default', icon: CheckCircle2 },
  PENDING: { variant: 'secondary', icon: Clock },
  REJECTED: { variant: 'destructive', icon: XCircle },
};

export function CorpusSourceManager() {
  const { data: sources = [], isLoading } = useApprovedSources();
  const addSource = useAddSource();
  const updateSource = useUpdateSource();
  const deleteSource = useDeleteSource();
  const ingestSource = useIngestSource();

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', source_url: '', format: 'pdf', license_reference: '', rights_status: 'PENDING' });

  const handleAdd = () => {
    if (!form.title.trim() || !form.source_url.trim()) return;
    addSource.mutate(form, { onSuccess: () => { setShowAdd(false); setForm({ title: '', source_url: '', format: 'pdf', license_reference: '', rights_status: 'PENDING' }); } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Approved Script Sources</h3>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Source</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Script Source</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Title</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Chinatown (1974)" /></div>
              <div><Label>URL</Label><Input value={form.source_url} onChange={e => setForm(f => ({ ...f, source_url: e.target.value }))} placeholder="https://..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Format</Label>
                  <Select value={form.format} onValueChange={v => setForm(f => ({ ...f, format: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pdf">PDF</SelectItem>
                      <SelectItem value="html">HTML</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Rights Status</Label>
                  <Select value={form.rights_status} onValueChange={v => setForm(f => ({ ...f, rights_status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="APPROVED">Approved</SelectItem>
                      <SelectItem value="REJECTED">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>License Reference</Label><Input value={form.license_reference} onChange={e => setForm(f => ({ ...f, license_reference: e.target.value }))} placeholder="License or rights reference" /></div>
              <Button onClick={handleAdd} disabled={addSource.isPending} className="w-full">
                {addSource.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Add Source
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : sources.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No sources added yet. Add an approved script URL to begin building your corpus.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>License</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map(src => {
              const badge = STATUS_BADGES[src.rights_status] || STATUS_BADGES.PENDING;
              const Icon = badge.icon;
              return (
                <TableRow key={src.id}>
                  <TableCell className="font-medium">{src.title || '(untitled)'}</TableCell>
                  <TableCell><Badge variant="outline">{src.format.toUpperCase()}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={badge.variant} className="gap-1">
                      <Icon className="w-3 h-3" />{src.rights_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{src.license_reference || '—'}</TableCell>
                  <TableCell className="text-right space-x-1">
                    {src.rights_status !== 'APPROVED' && (
                      <Button size="sm" variant="outline" onClick={() => updateSource.mutate({ id: src.id, rights_status: 'APPROVED' })}>
                        Approve
                      </Button>
                    )}
                    {src.rights_status === 'APPROVED' && (
                      <Button size="sm" onClick={() => ingestSource.mutate(src.id)} disabled={ingestSource.isPending}>
                        {ingestSource.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                        Ingest
                      </Button>
                    )}
                    <ConfirmDialog
                      title="Delete Source"
                      description="This will remove the source and all ingested data. This cannot be undone."
                      onConfirm={() => deleteSource.mutate(src.id)}
                    >
                      <Button size="sm" variant="ghost">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </ConfirmDialog>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

    </div>
  );
}
