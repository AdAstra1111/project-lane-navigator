import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, File, CheckCircle2, AlertCircle, AlertTriangle, RotateCw, Trash2, Sparkles, ChevronRight, Eye, ScanSearch } from 'lucide-react';
import { ProjectDocument, DocumentType, DOC_TYPE_LABELS } from '@/lib/types';
import { getDocTypeLabel } from '@/lib/can-promote-to-script';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useExtractDocuments } from '@/hooks/useExtractDocuments';
import { OperationProgress, EXTRACT_STAGES } from '@/components/OperationProgress';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

function getStatusIcon(status: string) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case 'partial':
      return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    default:
      return <File className="h-4 w-4 text-muted-foreground" />;
  }
}

function getIngestionSourceLabel(source?: string) {
  switch (source) {
    case 'ocr': return 'OCR';
    case 'pdf_text': return 'PDF Text';
    case 'docx': return 'DOCX';
    case 'plain': return 'Plain Text';
    default: return 'Unknown';
  }
}

function getIngestionSourceColor(source?: string) {
  switch (source) {
    case 'ocr': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'pdf_text': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'docx': return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
    case 'plain': return 'bg-muted text-muted-foreground border-border/50';
    default: return 'bg-muted text-muted-foreground border-border/50';
  }
}

function getEffectiveText(doc: ProjectDocument): string | null {
  return doc.extracted_text || doc.version_plaintext || null;
}

function getStatusLabel(doc: ProjectDocument) {
  const effectiveText = getEffectiveText(doc);
  const charCount = doc.char_count || (effectiveText ? effectiveText.length : 0);
  const charInfo = charCount ? ` · ${charCount.toLocaleString()} chars` : '';
  // Dev-engine docs with version content are healthy
  if (!doc.file_path && effectiveText) {
    return `Dev Engine document${charInfo}`;
  }
  switch (doc.extraction_status) {
    case 'success':
      return (doc.total_pages ? `${doc.total_pages} pages extracted` : 'Text extracted') + charInfo;
    case 'partial':
      return `${doc.pages_analyzed} of ${doc.total_pages} pages analysed${charInfo}`;
    case 'failed':
      return doc.error_message || 'Extraction failed';
    default:
      return 'Pending';
  }
}

const DOC_TYPE_COLORS: Record<DocumentType, string> = {
  script: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  treatment: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  deck: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  lookbook: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  schedule: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  budget: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  trailer_script: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  document: 'bg-muted text-muted-foreground border-border/50',
};

interface DocumentsListProps {
  documents: ProjectDocument[];
  projectId?: string;
}

export function DocumentsList({ documents, projectId }: DocumentsListProps) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const extract = useExtractDocuments(projectId);

  if (documents.length === 0) return null;

  const hasUnextracted = documents.some(d => {
    // Dev-engine docs with version content don't need extraction
    if (!d.file_path && getEffectiveText(d)) return false;
    return d.extraction_status !== 'success' || !getEffectiveText(d);
  });

  const isDocHealthy = (doc: ProjectDocument) => {
    const effectiveText = getEffectiveText(doc);
    if (!doc.file_path && effectiveText && effectiveText.length >= 500) return true;
    return doc.extraction_status === 'success' && (doc.char_count || 0) >= 1500;
  };

  const handleReanalyze = async (doc: ProjectDocument) => {
    if (!projectId) return;
    setReanalyzingId(doc.id);
    try {
      // First re-extract text for this specific doc
      const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-documents', {
        body: { projectId, documentPaths: [doc.file_path] },
      });
      if (extractError) throw new Error(extractError.message || 'Extraction failed');

      // Then re-run full analysis with all project docs
      const { data: project } = await supabase
        .from('projects')
        .select('title, format, genres, budget_range, target_audience, tone, comparable_titles')
        .eq('id', projectId)
        .single();

      const { data: allDocs } = await supabase
        .from('project_documents')
        .select('file_path')
        .eq('project_id', projectId);

      const allPaths = (allDocs || []).map(d => d.file_path).filter((p): p is string => !!p && p.trim() !== '');

      const { data: analysisData, error: analysisError } = await supabase.functions.invoke('analyze-project', {
        body: {
          projectInput: {
            id: projectId,
            title: project?.title || '',
            format: project?.format || 'film',
            genres: project?.genres || [],
            budget_range: project?.budget_range || '',
            target_audience: project?.target_audience || '',
            tone: project?.tone || '',
            comparable_titles: project?.comparable_titles || '',
          },
          documentPaths: allPaths,
        },
      });

      if (analysisError) throw new Error(analysisError.message || 'Analysis failed');
      if (analysisData?.error === 'extraction_too_thin') {
        toast.error(analysisData.message || 'Document text too thin for analysis');
        queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
        return;
      }
      if (analysisData?.error) throw new Error(analysisData.error);

      // The edge function returns the parsed analysis directly
      const analysis = analysisData;
      if (analysis?.lane) {
        await supabase
          .from('projects')
          .update({
            analysis_passes: analysis as any,
            assigned_lane: analysis.lane || null,
            confidence: analysis.confidence ?? null,
            reasoning: analysis.rationale || null,
          })
          .eq('id', projectId);
      }

      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success(`Re-analysed ${doc.file_name}`);
    } catch (e: any) {
      toast.error(e.message || 'Re-analysis failed');
    } finally {
      setReanalyzingId(null);
    }
  };

  const handleChangeType = async (docId: string, newType: DocumentType) => {
    try {
      const { error } = await supabase
        .from('project_documents')
        .update({ doc_type: newType } as any)
        .eq('id', docId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      toast.success(`Labelled as ${DOC_TYPE_LABELS[newType]}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update type');
    } finally {
      setEditingTypeId(null);
    }
  };

  const handleDelete = async (doc: ProjectDocument) => {
    setDeletingId(doc.id);
    try {
      if (doc.file_path) {
        await supabase.storage.from('project-documents').remove([doc.file_path]);
      }
      const { error } = await supabase.from('project_documents').delete().eq('id', doc.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success(`Deleted ${doc.file_name}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete document');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="space-y-2">
        {documents.map((doc, index) => {
          const healthy = isDocHealthy(doc);
          return (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.05, duration: 0.2 }}
              className="glass-card rounded-lg overflow-hidden group"
            >
              <div className="px-4 py-3 flex items-center gap-3">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground truncate">
                      {doc.file_name}
                    </p>
                    {editingTypeId === doc.id ? (
                      <Select
                        defaultValue={doc.doc_type || 'document'}
                        onValueChange={(v) => handleChangeType(doc.id, v as DocumentType)}
                      >
                        <SelectTrigger className="h-6 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(DOC_TYPE_LABELS).map(([key, label]) => (
                            <SelectItem key={key} value={key} className="text-xs">{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge
                        variant="outline"
                        className={`text-[10px] cursor-pointer hover:opacity-80 ${DOC_TYPE_COLORS[(doc.doc_type as DocumentType) || 'document']}`}
                        onClick={() => setEditingTypeId(doc.id)}
                      >
                        {getDocTypeLabel(doc.doc_type)}
                      </Badge>
                    )}
                    {doc.ingestion_source && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${getIngestionSourceColor(doc.ingestion_source)}`}
                      >
                        <ScanSearch className="h-2.5 w-2.5 mr-0.5" />
                        {getIngestionSourceLabel(doc.ingestion_source)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {(!doc.file_path && getEffectiveText(doc)) ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : getStatusIcon(doc.extraction_status)}
                    <span className="text-xs text-muted-foreground">
                      {getStatusLabel(doc)}
                    </span>
                    {!healthy && doc.extraction_status !== 'pending' && !(!doc.file_path && getEffectiveText(doc)) && (
                      <span className="text-[10px] text-destructive font-medium ml-1">
                        — Analysis blocked
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {getEffectiveText(doc) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 opacity-0 group-hover:opacity-100 transition-all"
                          onClick={() => setPreviewDocId(previewDocId === doc.id ? null : doc.id)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">Preview text</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-all"
                        onClick={() => handleReanalyze(doc)}
                        disabled={reanalyzingId === doc.id}
                      >
                        <Sparkles className={`h-3.5 w-3.5 ${reanalyzingId === doc.id ? 'animate-pulse' : ''}`} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">Re-extract &amp; re-analyse</TooltipContent>
                  </Tooltip>
                  <ConfirmDialog
                    title={`Delete ${doc.file_name}?`}
                    description="This will permanently remove the document and its extracted text. This cannot be undone."
                    onConfirm={() => handleDelete(doc)}
                  >
                    <button
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                      disabled={deletingId === doc.id}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </ConfirmDialog>
                </div>
              </div>

              {/* Text Preview */}
              {previewDocId === doc.id && getEffectiveText(doc) && (
                <div className="border-t border-border/30 px-4 py-3 bg-muted/20">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Text Preview (first 2,000 chars)
                  </p>
                  <pre className="text-xs text-foreground/80 whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono leading-relaxed">
                    {getEffectiveText(doc)!.slice(0, 2000)}
                    {getEffectiveText(doc)!.length > 2000 && '\n\n[...truncated]'}
                  </pre>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {hasUnextracted && projectId && (
        <>
          <OperationProgress isActive={extract.isPending} stages={EXTRACT_STAGES} className="mt-3" />
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full text-xs gap-1.5"
            onClick={() => extract.mutate()}
            disabled={extract.isPending}
          >
            <RotateCw className={`h-3 w-3 ${extract.isPending ? 'animate-spin' : ''}`} />
            {extract.isPending ? 'Extracting…' : 'Re-extract Document Text'}
          </Button>
        </>
      )}
    </div>
  );
}
