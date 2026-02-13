import { useCorpusIntegrityStatus } from '@/hooks/useCorpusIntegrity';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';

export function CorpusIntegrityBanner() {
  const { data: status } = useCorpusIntegrityStatus();
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  if (!status || status.pass || dismissed) return null;

  return (
    <div className="bg-destructive text-destructive-foreground px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>
          <strong>Corpus Integrity Check FAILED</strong> — baselines may be unreliable.
        </span>
        <button
          onClick={() => navigate('/settings')}
          className="underline underline-offset-2 hover:opacity-80 font-medium"
        >
          View details
        </button>
      </div>
      <button onClick={() => setDismissed(true)} className="hover:opacity-80 shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
