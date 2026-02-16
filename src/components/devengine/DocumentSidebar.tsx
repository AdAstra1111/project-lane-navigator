/**
 * DocumentSidebar — Document list, version selector, and paste dialog.
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, ClipboardPaste, GitBranch, Loader2, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DELIVERABLE_LABELS } from '@/lib/dev-os-config';

const DOC_TYPE_LABELS: Record<string, string> = {
  idea: 'Idea', logline: 'Logline', one_pager: 'One-Pager', treatment: 'Treatment',
  script: 'Script', blueprint: 'Blueprint', architecture: 'Architecture',
  notes: 'Notes', outline: 'Outline', deck_text: 'Deck', other: 'Other',
  concept_brief: 'Concept Brief', market_sheet: 'Market Sheet',
  character_bible: 'Character Bible', beat_sheet: 'Beat Sheet',
  production_draft: 'Production Draft', deck: 'Deck', documentary_outline: 'Doc Outline',
  format_rules: 'Format Rules', season_arc: 'Season Arc',
  episode_grid: 'Episode Grid', vertical_episode_beats: 'Episode Beats',
  vertical_market_sheet: 'Market Sheet (VD)',
};

interface DocumentSidebarProps {
  documents: any[];
  docsLoading: boolean;
  selectedDocId: string | null;
  selectDocument: (id: string) => void;
  deleteDocument: { mutate: (id: string) => void };
  deleteVersion?: { mutate: (id: string) => void };
  versions: any[];
  selectedVersionId: string | null;
  setSelectedVersionId: (id: string) => void;
  createPaste: { mutate: (data: any) => void; isPending: boolean };
  /** Map of doc_type -> latest_version_id from project_documents */
  latestVersionMap?: Record<string, string>;
}

export function DocumentSidebar({
  documents, docsLoading, selectedDocId, selectDocument, deleteDocument, deleteVersion,
  versions, selectedVersionId, setSelectedVersionId, createPaste, latestVersionMap = {},
}: DocumentSidebarProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteType, setPasteType] = useState('treatment');
  const [pasteText, setPasteText] = useState('');

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    createPaste.mutate({ title: pasteTitle || 'Pasted Document', docType: pasteType, text: pasteText.trim() });
    setPasteOpen(false);
    setPasteTitle('');
    setPasteText('');
  };

  return (
    <div className="space-y-3">
      {/* Documents */}
      <Card>
        <CardHeader className="py-2.5 px-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs">Documents</CardTitle>
            <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2">
                  <Plus className="h-3 w-3" /> New
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Paste New Document</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="Title" value={pasteTitle} onChange={e => setPasteTitle(e.target.value)} />
                  <Select value={pasteType} onValueChange={setPasteType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(DELIVERABLE_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                      <SelectItem value="treatment">Treatment</SelectItem>
                      <SelectItem value="logline">Logline</SelectItem>
                      <SelectItem value="one_pager">One-Pager</SelectItem>
                      <SelectItem value="outline">Outline</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea placeholder="Paste material here…" value={pasteText}
                    onChange={e => setPasteText(e.target.value)} className="min-h-[200px] font-mono text-sm" />
                  <Button onClick={handlePaste} disabled={!pasteText.trim() || createPaste.isPending} className="w-full">
                    {createPaste.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ClipboardPaste className="h-4 w-4 mr-2" />}
                    Create Document
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <div className="max-h-[calc(100vh-420px)] overflow-y-auto space-y-1">
            {documents.map(doc => (
              <div
                key={doc.id}
                className={`w-full text-left p-2 rounded-md transition-colors text-sm cursor-pointer ${
                  selectedDocId === doc.id
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-muted/50 border border-transparent'
                }`}
                onClick={() => selectDocument(doc.id)}
              >
                <p className="font-medium text-foreground truncate text-[11px]">{doc.title || doc.file_name}</p>
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[8px] px-1 py-0">
                      {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                    </Badge>
                    <span className="text-[9px] text-muted-foreground">
                      {doc.source === 'generated' ? '✨' : doc.source === 'paste' ? '📋' : '📄'}
                    </span>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <ConfirmDialog
                      title="Delete Document"
                      description={`Delete "${doc.title || doc.file_name}" and all its versions?`}
                      confirmLabel="Delete"
                      variant="destructive"
                      onConfirm={() => deleteDocument.mutate(doc.id)}
                    >
                      <button className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </ConfirmDialog>
                  </div>
                </div>
              </div>
            ))}
            {documents.length === 0 && !docsLoading && (
              <p className="text-[10px] text-muted-foreground p-3 text-center">No documents yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Versions */}
      {selectedDocId && versions.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-[10px] flex items-center gap-1.5 text-muted-foreground">
              <GitBranch className="h-3 w-3" /> Versions ({versions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            <div className="space-y-0.5 max-h-[160px] overflow-y-auto">
              {versions.map(v => {
                // Check if this version is the project's latest for this doc type
                const selectedDocObj = documents.find(d => d.id === selectedDocId);
                const isLatestForDoc = selectedDocObj && latestVersionMap[selectedDocObj.doc_type] === v.id;
                return (
                <div
                  key={v.id}
                  onClick={() => setSelectedVersionId(v.id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-[10px] transition-colors cursor-pointer ${
                    selectedVersionId === v.id
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted/50'
                  } ${isLatestForDoc ? 'ring-1 ring-primary/40' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium flex items-center gap-1">
                      v{v.version_number}
                      {isLatestForDoc && (
                        <Badge variant="default" className="text-[7px] px-1 py-0 h-3 bg-primary/80">LATEST</Badge>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[8px]">{new Date(v.created_at).toLocaleDateString()}</span>
                      {deleteVersion && versions.length > 1 && (
                        <div onClick={e => e.stopPropagation()}>
                          <ConfirmDialog
                            title="Delete Version"
                            description={`Delete v${v.version_number}? This cannot be undone.`}
                            confirmLabel="Delete"
                            variant="destructive"
                            onConfirm={() => deleteVersion.mutate(v.id)}
                          >
                            <button className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </ConfirmDialog>
                        </div>
                      )}
                    </div>
                  </div>
                  {v.change_summary && <span className="text-[8px] block mt-0.5 truncate opacity-70">{v.change_summary}</span>}
                </div>
              );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
