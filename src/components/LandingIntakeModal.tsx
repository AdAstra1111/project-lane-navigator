import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, AlertCircle, X, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPendingUpload, deletePendingUpload, pendingEntryToFile, type PendingUpload } from '@/lib/pendingUploads';
import { runLandingIntake, type IntakeProgress } from '@/lib/intake/runLandingIntake';
import { toast } from 'sonner';

interface LandingIntakeModalProps {
  pendingUploadId: string | null;
  onDismiss: () => void;
}

export function LandingIntakeModal({ pendingUploadId, onDismiss }: LandingIntakeModalProps) {
  const navigate = useNavigate();
  const [upload, setUpload] = useState<PendingUpload | null>(null);
  const [progress, setProgress] = useState<IntakeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Load pending upload from IndexedDB
  useEffect(() => {
    if (!pendingUploadId) return;
    getPendingUpload(pendingUploadId).then(u => {
      if (u) {
        setUpload(u);
      } else {
        setError('Pending upload not found — it may have expired.');
      }
    }).catch(() => setError('Failed to read pending upload'));
  }, [pendingUploadId]);

  // Auto-start intake when upload is loaded
  const startIntake = useCallback(async () => {
    if (!upload || running) return;
    setRunning(true);
    setError(null);

    try {
      const files = upload.files.map(pendingEntryToFile);
      const result = await runLandingIntake(files, setProgress);

      // Cleanup
      await deletePendingUpload(upload.id);
      // Clear query param
      const url = new URL(window.location.href);
      url.searchParams.delete('pendingUploadId');
      url.searchParams.delete('autoIntake');
      window.history.replaceState({}, '', url.pathname + url.search);

      toast.success(`"${result.title}" created — opening project…`);
      navigate(`/projects/${result.projectId}/development`, { replace: true });
    } catch (err: any) {
      console.error('Intake failed:', err);
      setError(err.message || 'Intake failed');
      setRunning(false);
    }
  }, [upload, running, navigate]);

  useEffect(() => {
    if (upload && !running && !error) {
      startIntake();
    }
  }, [upload, running, error, startIntake]);

  if (!pendingUploadId) return null;

  const stepIcons: Record<string, React.ReactNode> = {
    uploading: <Loader2 className="h-5 w-5 animate-spin text-primary" />,
    creating: <Loader2 className="h-5 w-5 animate-spin text-primary" />,
    extracting: <Loader2 className="h-5 w-5 animate-spin text-primary" />,
    analyzing: <Loader2 className="h-5 w-5 animate-spin text-primary" />,
    done: <CheckCircle2 className="h-5 w-5 text-green-500" />,
    error: <AlertCircle className="h-5 w-5 text-destructive" />,
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="glass-card rounded-xl p-6 w-full max-w-md mx-4 shadow-xl"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-lg text-foreground">Processing your script</h3>
            {!running && (
              <button onClick={onDismiss} className="p-1 rounded-md text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* File list */}
          {upload && (
            <div className="mb-4 space-y-1.5">
              {upload.files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs">({(f.size / 1024 / 1024).toFixed(1)} MB)</span>
                </div>
              ))}
            </div>
          )}

          {/* Progress */}
          {progress && (
            <div className="flex items-center gap-3 py-3">
              {stepIcons[progress.step] || stepIcons.uploading}
              <span className="text-sm text-foreground">{progress.message}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-3 space-y-3">
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { setError(null); startIntake(); }}>
                  Retry
                </Button>
                <Button size="sm" variant="outline" onClick={onDismiss}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {!progress && !error && !upload && (
            <div className="flex items-center gap-3 py-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Loading files…</span>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
