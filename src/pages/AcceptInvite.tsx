import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Redirect to auth with return URL
      navigate(`/auth?redirect=${encodeURIComponent(`/invite?token=${token}`)}`);
      return;
    }

    if (!token) {
      setStatus('error');
      setMessage('No invite token provided.');
      return;
    }

    const accept = async () => {
      const { data, error } = await supabase.rpc('accept_invite_link', { _token: token });

      if (error) {
        setStatus('error');
        setMessage(error.message);
        return;
      }

      const result = data as any;
      if (result?.error) {
        setStatus('error');
        setMessage(result.error);
      } else {
        setStatus('success');
        setProjectId(result.project_id);
      }
    };

    accept();
  }, [user, authLoading, token, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="glass-card rounded-xl p-8 max-w-md w-full text-center space-y-4">
        {status === 'loading' && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Accepting invite…</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
            <h2 className="text-xl font-display font-semibold text-foreground">You're in!</h2>
            <p className="text-muted-foreground">You've been added as a collaborator.</p>
            <Button onClick={() => navigate(`/projects/${projectId}`)} className="mt-2">
              Open Project
            </Button>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="h-10 w-10 text-destructive mx-auto" />
            <h2 className="text-xl font-display font-semibold text-foreground">Invite Failed</h2>
            <p className="text-muted-foreground">{message}</p>
            <Link to="/dashboard">
              <Button variant="outline" className="mt-2">Go to Dashboard</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
