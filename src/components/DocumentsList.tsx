import { motion } from 'framer-motion';
import { FileText, File, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import { ProjectDocument } from '@/lib/types';

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

function getStatusLabel(doc: ProjectDocument) {
  switch (doc.extraction_status) {
    case 'success':
      return doc.total_pages
        ? `${doc.total_pages} pages extracted`
        : 'Text extracted';
    case 'partial':
      return `${doc.pages_analyzed} of ${doc.total_pages} pages analysed`;
    case 'failed':
      return doc.error_message || 'Extraction failed';
    default:
      return 'Pending';
  }
}

interface DocumentsListProps {
  documents: ProjectDocument[];
}

export function DocumentsList({ documents }: DocumentsListProps) {
  if (documents.length === 0) return null;

  return (
    <div>
      <div className="space-y-2">
        {documents.map((doc, index) => (
          <motion.div
            key={doc.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + index * 0.05, duration: 0.2 }}
            className="glass-card rounded-lg px-4 py-3 flex items-center gap-3"
          >
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {doc.file_name}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {getStatusIcon(doc.extraction_status)}
                <span className="text-xs text-muted-foreground">
                  {getStatusLabel(doc)}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
