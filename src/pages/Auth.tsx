import { useState } from 'react';
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import authBg from '@/assets/auth-bg.jpg';

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
        <div className="h-8 w-8 rounded-md bg-primary animate-pulse" />
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
    'sign-in': 'Sign in to manage your projects.',
    'sign-up': 'Start classifying your creative projects.',
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
          <div className="flex items-center gap-2 mb-10">
            <div className="h-10 w-10 rounded-md bg-primary flex items-center justify-center">
              <span className="font-display font-bold text-primary-foreground">IF</span>
            </div>
            <span className="font-display font-bold text-2xl tracking-tight text-foreground">IFFY</span>
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

          <h1 className="text-2xl font-display font-semibold text-foreground mb-1">
            {titles[view]}
          </h1>
          <p className="text-sm text-muted-foreground mb-8">
            {subtitles[view]}
          </p>

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
          <h2 className="text-3xl font-display font-bold text-foreground mb-4">
            Know your lane.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            IFFY helps producers classify creative projects into clear monetisation lanes — so you always know what to build, how to package it, and where it belongs.
          </p>
        </div>
      </div>
    </div>
  );
}
