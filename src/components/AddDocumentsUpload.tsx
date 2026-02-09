import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Plus, X, FileText, File, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md', '.docx', '.doc', '.fdx', '.fountain'];
const ACCEPTED_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;

const SCRIPT_EXTENSIONS = ['pdf', 'fdx', 'fountain', 'docx', 'doc', 'txt'];

function looksLikeScript(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (!SCRIPT_EXTENSIONS.includes(ext)) return false;
  const lower = fileName.toLowerCase();
  // Heuristic: if it contains script-related keywords, it's likely a script
  const scriptKeywords = ['script', 'screenplay', 'draft', 'teleplay', 'pilot', 'episode'];
  if (scriptKeywords.some(k => lower.includes(k))) return true;
  // .fdx and .fountain are always scripts
  if (ext === 'fdx' || ext === 'fountain') return true;
  // For PDF/DOCX, we'll ask the user
  return true;
}

interface ScriptDetection {
  files: File[];
  scriptFiles: File[];
}

interface AddDocumentsUploadProps {
  existingCount: number;
  onUpload: (files: File[], scriptInfo?: { isLatestDraft: boolean; scriptFiles: string[] }) => void;
  isUploading: boolean;
}

export function AddDocumentsUpload({ existingCount, onUpload, isUploading }: AddDocumentsUploadProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [scriptDialog, setScriptDialog] = useState<ScriptDetection | null>(null);

  const maxNew = MAX_FILES - existingCount;

  const validateFile = (file: File): string | null => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext) && !ACCEPTED_TYPES.includes(file.type)) {
      return `"${file.name}" is not a supported file type.`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `"${file.name}" exceeds the 10MB limit.`;
    }
    return null;
  };

  const addFiles = (newFiles: FileList | File[]) => {
    setError(null);
    const fileArray = Array.from(newFiles);

    if (files.length + fileArray.length > maxNew) {
      setError(`You can add up to ${maxNew} more file${maxNew !== 1 ? 's' : ''}.`);
      return;
    }

    for (const file of fileArray) {
      const err = validateFile(file);
      if (err) { setError(err); return; }
    }

    const existing = new Set(files.map(f => f.name));
    const unique = fileArray.filter(f => !existing.has(f.name));
    setFiles(prev => [...prev, ...unique]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setError(null);
  };

  const handleSubmit = () => {
    if (files.length === 0) return;
    
    // Check if any uploaded files look like scripts
    const scriptFiles = files.filter(f => looksLikeScript(f.name));
    
    if (scriptFiles.length > 0) {
      setScriptDialog({ files, scriptFiles });
    } else {
      onUpload(files);
      setFiles([]);
      setIsExpanded(false);
    }
  };

  const handleScriptResponse = (isLatestDraft: boolean) => {
    if (!scriptDialog) return;
    const scriptFileNames = scriptDialog.scriptFiles.map(f => f.name);
    onUpload(scriptDialog.files, { isLatestDraft, scriptFiles: scriptFileNames });
    setScriptDialog(null);
    setFiles([]);
    setIsExpanded(false);
  };

  const handleNotAScript = () => {
    if (!scriptDialog) return;
    onUpload(scriptDialog.files);
    setScriptDialog(null);
    setFiles([]);
    setIsExpanded(false);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return <FileText className="h-4 w-4 text-red-400" />;
    if (ext === 'fdx' || ext === 'fountain') return <FileText className="h-4 w-4 text-blue-400" />;
    return <File className="h-4 w-4 text-muted-foreground" />;
  };

  if (maxNew <= 0 && !isExpanded) return null;

  if (!isExpanded) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsExpanded(true)}
        className="gap-1.5"
        disabled={isUploading}
      >
        <Plus className="h-4 w-4" />
        Add Documents
      </Button>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="space-y-3"
      >
        {/* Drop zone */}
        <div
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          className={cn(
            'relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-all duration-200',
            isDragging ? 'border-primary bg-primary/5' : 'border-border/50 bg-muted/30 hover:border-border hover:bg-muted/50'
          )}
        >
          <input
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS.join(',')}
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <Upload className={cn('h-6 w-6 transition-colors', isDragging ? 'text-primary' : 'text-muted-foreground')} />
          <p className="text-sm text-muted-foreground">
            Drop files or click to browse · Up to {maxNew} more
          </p>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Staged files */}
        <AnimatePresence>
          {files.map((file, i) => (
            <motion.div
              key={file.name}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-3 glass-card rounded-lg px-4 py-3"
            >
              {getFileIcon(file.name)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={files.length === 0 || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Uploading…
              </>
            ) : (
              `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFiles([]); setIsExpanded(false); setError(null); }}
            disabled={isUploading}
          >
            Cancel
          </Button>
        </div>
      </motion.div>

      {/* Script Detection Dialog */}
      <AlertDialog open={!!scriptDialog} onOpenChange={(open) => { if (!open) setScriptDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Script Detected
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                {scriptDialog?.scriptFiles.length === 1
                  ? `"${scriptDialog.scriptFiles[0].name}" looks like a script.`
                  : `${scriptDialog?.scriptFiles.length} files look like scripts.`}
              </span>
              <span className="block font-medium text-foreground">
                Is this the latest draft?
              </span>
              <span className="block text-xs">
                If yes, it will be marked as the current script and previous versions will be archived. The project's intelligence will be updated automatically.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" size="sm" onClick={handleNotAScript}>
              Not a Script
            </Button>
            <Button variant="secondary" size="sm" onClick={() => handleScriptResponse(false)}>
              No, It's an Older Draft
            </Button>
            <Button size="sm" onClick={() => handleScriptResponse(true)}>
              Yes, Latest Draft
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
