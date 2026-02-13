import { useState } from 'react';
import { useNavigate, Navigate, useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import authBg from '@/assets/auth-bg.jpg';
import iffyLogo from '@/assets/iffy-logo-v3.png';

type AuthView = 'sign-in' | 'sign-up' | 'forgot-password';

export default function Auth() {
  const { user, loading, signIn, signUp } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const [view, setView] = useState<AuthView>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <img src={iffyLogo} alt="IFFY" className="h-10 w-10 animate-pulse" />
      </div>
    );
  }

  if (user) {
    return <Navigate to={redirectTo || '/dashboard'} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);

    try {
      if (view === 'forgot-password') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/settings`,
        });
        if (error) {
          setError(error.message);
        } else {
          setMessage('Check your email for a password reset link.');
        }
      } else if (view === 'sign-up') {
        const { error } = await signUp(email, password);
        if (error) {
          setError(error.message);
        } else {
          setMessage('Check your email for a confirmation link.');
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          setError(error.message);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const switchView = (v: AuthView) => {
    setView(v);
    setError('');
    setMessage('');
  };

  const titles: Record<AuthView, string> = {
    'sign-in': 'Welcome back',
    'sign-up': 'Create your account',
    'forgot-password': 'Reset your password',
  };

  const subtitles: Record<AuthView, string> = {
    'sign-in': 'From inception to legacy.',
    'sign-up': 'From inception to legacy.',
    'forgot-password': 'Enter your email and we\'ll send you a reset link.',
  };

  return (
    <div className="flex min-h-screen">
      {/* Left: Form */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm"
        >
          <div className="flex items-center gap-3 mb-10">
            <img src={iffyLogo} alt="IFFY logo" className="h-12 w-12 rounded-lg" />
            <div className="flex flex-col leading-none">
              <span className="font-display font-bold text-3xl tracking-tight text-foreground">IFFY</span>
              <span className="text-[10px] text-muted-foreground tracking-widest uppercase">From inception to legacy</span>
            </div>
          </div>

          {view === 'forgot-password' && (
            <button
              onClick={() => switchView('sign-in')}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </button>
          )}

          {view !== 'sign-in' && (
            <>
              <h1 className="text-2xl font-display font-semibold text-foreground mb-1">
                {titles[view]}
              </h1>
              <p className="text-sm text-muted-foreground mb-8">
                {subtitles[view]}
              </p>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-foreground">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="bg-muted border-border/50 focus:border-primary"
              />
            </div>
            {view !== 'forgot-password' && (
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm text-foreground">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="bg-muted border-border/50 focus:border-primary"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            {message && (
              <p className="text-sm text-primary">{message}</p>
            )}

            <Button
              type="submit"
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={submitting}
            >
              {submitting
                ? 'Please wait…'
                : view === 'sign-up'
                ? 'Create Account'
                : view === 'forgot-password'
                ? 'Send Reset Link'
                : 'Sign In'}
            </Button>
          </form>

          {view === 'sign-in' && (
            <button
              type="button"
              onClick={() => switchView('forgot-password')}
              className="mt-3 block w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Forgot your password?
            </button>
          )}

          {view !== 'forgot-password' && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {view === 'sign-up' ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => switchView(view === 'sign-up' ? 'sign-in' : 'sign-up')}
                className="text-primary hover:underline font-medium"
              >
                {view === 'sign-up' ? 'Sign in' : 'Create one'}
              </button>
            </p>
          )}

          <div className="mt-6 flex flex-col gap-2 lg:hidden">
            <Link to="/demo" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors group">
              <span className="h-8 w-8 rounded-full bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center transition-colors">
                <Play className="h-3.5 w-3.5 fill-primary text-primary" />
              </span>
              Watch the trailer
            </Link>
            <Link to="/demo/executive" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors group">
              <span className="h-8 w-8 rounded-full bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center transition-colors">
                <Shield className="h-3.5 w-3.5 text-primary" />
              </span>
              Explore Executive Mode
            </Link>
          </div>
        </motion.div>
      </div>

      {/* Right: Visual */}
      <div className="hidden lg:flex flex-1 items-center justify-center relative overflow-hidden">
        <img
          src={authBg}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-background/40 backdrop-blur-sm" />
        <div className="relative z-10 max-w-md px-8 text-center">
          <p className="text-xs font-display uppercase tracking-[0.2em] text-primary mb-3">Intelligent Film Flow & Yield</p>
          <h2 className="text-3xl font-display font-bold text-foreground mb-4">
            From inception to legacy.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            IFFY guides film and TV projects from development through production to monetisation — preserving context, ownership, and financial clarity at every stage.
          </p>
          <div className="flex flex-col items-center gap-3">
            <Link to="/demo" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors group">
              <span className="h-9 w-9 rounded-full bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center transition-colors">
                <Play className="h-4 w-4 fill-primary text-primary" />
              </span>
              Watch the trailer
            </Link>
            <Link to="/demo/executive" className="inline-flex items-center gap-2 text-sm font-medium text-primary/70 hover:text-primary transition-colors group">
              <span className="h-9 w-9 rounded-full bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center transition-colors">
                <Shield className="h-4 w-4 text-primary" />
              </span>
              Explore Executive Mode
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
