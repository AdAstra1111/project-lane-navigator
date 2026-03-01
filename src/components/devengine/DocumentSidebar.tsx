/**
 * DocumentSidebar — Document list, version selector, and paste dialog.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, ClipboardPaste, GitBranch, Loader2, Trash2, ShieldCheck, GripVertical, Package, ChevronRight } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DELIVERABLE_LABELS } from '@/lib/dev-os-config';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

import { getDocTypeLabel, getDocDisplayName } from '@/lib/can-promote-to-script';

const SYSTEM_DOC_TYPES = new Set(['project_overview', 'creative_brief', 'market_positioning', 'canon', 'nec']);

const STORAGE_KEY = 'devEngine.leftTrayWidth';
const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 220;

function getStoredWidth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(v)));
  } catch {}
  return DEFAULT_WIDTH;
}

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
  /** Map of document_id -> approved_version_id */
  approvedVersionMap?: Record<string, string>;
  /** Current project title — used to prefix display names */
  projectTitle?: string;
  /** Project format — used for format-specific label overrides */
  format?: string | null;
  /** Callback to navigate to the Package tab */
  onOpenPackage?: () => void;
}

export function DocumentSidebar({
  documents, docsLoading, selectedDocId, selectDocument, deleteDocument, deleteVersion,
  versions, selectedVersionId, setSelectedVersionId, createPaste, latestVersionMap = {},
  approvedVersionMap = {}, projectTitle = '', format, onOpenPackage,
}: DocumentSidebarProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteType, setPasteType] = useState('idea');
  const [pasteText, setPasteText] = useState('');

  // Resizable width
  const [width, setWidth] = useState(getStoredWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + ev.clientX - startX.current));
      setWidth(newW);
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setWidth(w => { try { localStorage.setItem(STORAGE_KEY, String(w)); } catch {} return w; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    createPaste.mutate({ title: pasteTitle || 'Pasted Document', docType: pasteType, text: pasteText.trim() });
    setPasteOpen(false);
    setPasteTitle('');
    setPasteText('');
  };

  const renderDocItem = (doc: any) => {
    const hasApproved = !!approvedVersionMap[doc.id];
    const docTypeLabel = getDocTypeLabel(doc.doc_type, format);
    const displayName = getDocDisplayName(projectTitle, doc.doc_type, format);
    return (
      <div
        key={doc.id}
        className={`w-full text-left p-2 rounded-md transition-colors text-sm cursor-pointer ${
          selectedDocId === doc.id
            ? 'bg-primary/10 border border-primary/30'
            : 'hover:bg-muted/50 border border-transparent'
        }`}
        onClick={() => selectDocument(doc.id)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <p className={`font-medium text-foreground text-[11px] ${
              selectedDocId === doc.id ? 'line-clamp-2' : 'truncate'
            }`} aria-label={displayName}>{displayName}</p>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[300px] text-xs">
            <p>{displayName}</p>
            <p className="text-muted-foreground text-[10px]">{docTypeLabel}</p>
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-[8px] px-1 py-0">
              {docTypeLabel}
            </Badge>
            {hasApproved && (
              <Badge variant="outline" className="text-[7px] px-1 py-0 h-3 border-yellow-500/40 text-yellow-500 bg-yellow-500/10"
                aria-label="Approved version exists">
                <ShieldCheck className="h-2.5 w-2.5" />
              </Badge>
            )}
            <span className="text-[9px] text-muted-foreground">
              {doc.source === 'generated' ? '✨' : doc.source === 'paste' ? '📋' : '📄'}
            </span>
          </div>
          <div onClick={e => e.stopPropagation()}>
            <ConfirmDialog
              title="Delete Document"
              description={`Delete "${displayName}" and all its versions?`}
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
    );
  };

  return (
    <div className="relative flex" style={{ width }}>
      <div className="flex-1 min-w-0 space-y-3">
    <TooltipProvider delayDuration={300}>
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
                      <SelectItem value="idea">Idea</SelectItem>
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
            {/* System Docs group */}
            {(() => {
              const systemDocs = documents.filter(d => SYSTEM_DOC_TYPES.has(d.doc_type));
              const regularDocs = documents.filter(d => !SYSTEM_DOC_TYPES.has(d.doc_type));
              return (
                <>
                  {systemDocs.length > 0 && (
                    <Collapsible defaultOpen={false}>
                      <CollapsibleTrigger className="w-full flex items-center gap-1 px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
                        <ChevronRight className="h-3 w-3 transition-transform data-[state=open]:rotate-90" />
                        System Docs ({systemDocs.length})
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-0.5 pl-1 border-l border-border/40 ml-2 mb-2">
                        {systemDocs.map(doc => renderDocItem(doc))}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  {regularDocs.map(doc => renderDocItem(doc))}
                </>
              );
            })()}
            {documents.length === 0 && !docsLoading && (
              <p className="text-[10px] text-muted-foreground p-3 text-center">No documents yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Project Package shortcut */}
      {onOpenPackage && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs gap-1.5 h-7 justify-start"
          onClick={onOpenPackage}
        >
          <Package className="h-3 w-3 text-primary" />
          Project Package
        </Button>
      )}

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
                const selectedDocObj = documents.find(d => d.id === selectedDocId);
                const isLatestForDoc = selectedDocObj && latestVersionMap[selectedDocObj.doc_type] === v.id;
                const isApprovedVersion = selectedDocId ? approvedVersionMap[selectedDocId] === v.id : false;
                const versionDisplayName = projectTitle
                  ? `${projectTitle} — ${getDocTypeLabel(selectedDocObj?.doc_type, format)} — v${v.version_number}`
                  : `v${v.version_number}`;
                return (
                <Tooltip key={v.id}>
                  <TooltipTrigger asChild>
                <div
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
                      {isApprovedVersion && (
                        <Badge variant="outline" className="text-[7px] px-1 py-0 h-3 border-yellow-500/40 text-yellow-500 bg-yellow-500/10"
                          aria-label="Active Approved">
                          <ShieldCheck className="h-2.5 w-2.5 mr-0.5" /> Active Approved
                        </Badge>
                      )}
                      {!isApprovedVersion && v.approval_status === 'approved' && (
                        <Badge variant="outline" className="text-[7px] px-1 py-0 h-3 border-yellow-500/20 text-yellow-500/60"
                          aria-label="Previously approved">
                          Approved
                        </Badge>
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
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs max-w-[280px]">
                    <p className="font-medium">{versionDisplayName}</p>
                    <p className="text-muted-foreground text-[10px]">
                      {new Date(v.created_at).toLocaleString()}
                      {isApprovedVersion && ' · Active Approved'}
                      {!isApprovedVersion && v.approval_status === 'approved' && ' · Previously Approved'}
                    </p>
                    {v.change_summary && <p className="text-muted-foreground text-[10px] mt-0.5">{v.change_summary}</p>}
                  </TooltipContent>
                </Tooltip>
              );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </TooltipProvider>
    </div>
      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 w-2 h-full cursor-col-resize flex items-center justify-center hover:bg-primary/10 transition-colors group z-10"
        onMouseDown={onMouseDown}
        aria-label="Resize document tray"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground" />
      </div>
    </div>
  );
}
