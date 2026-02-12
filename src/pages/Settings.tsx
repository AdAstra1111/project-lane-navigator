import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Mail, LogOut, Save, Loader2, Crown, BookOpen, FlaskConical, Activity } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import { CorpusSourceManager } from '@/components/CorpusSourceManager';
import { CorpusHealthDashboard } from '@/components/CorpusHealthDashboard';

export default function Settings() {
  const { user, signOut } = useAuth();
  const { plan } = useSubscription();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [loaded, setLoaded] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['my-profile', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data && !loaded) {
        setDisplayName(data.display_name || '');
        setLoaded(true);
      }
      return data;
    },
    enabled: !!user,
  });

  const updateProfile = useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: displayName.trim() || null })
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      toast({ title: 'Profile updated' });
    },
    onError: () => {
      toast({ title: 'Failed to update profile', variant: 'destructive' });
    },
  });

  const updatePassword = useMutation({
    mutationFn: async (newPassword: string) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Password updated' });
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (e: any) => {
      toast({ title: 'Failed to update password', description: e.message, variant: 'destructive' });
    },
  });

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handlePasswordChange = () => {
    if (newPassword.length < 6) {
      toast({ title: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    updatePassword.mutate(newPassword);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-8 max-w-2xl">
        <h1 className="font-display text-2xl font-bold text-foreground mb-8">Settings</h1>

        {/* Profile */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-6 mb-6"
        >
          <h2 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-primary" /> Profile
          </h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email || ''} disabled className="mt-1 opacity-60" />
            </div>
            <div>
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="mt-1"
              />
            </div>
            <Button
              onClick={() => updateProfile.mutate()}
              disabled={updateProfile.isPending}
              size="sm"
            >
              {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save Profile
            </Button>
          </div>
        </motion.section>

        {/* Password */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card rounded-xl p-6 mb-6"
        >
          <h2 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" /> Change Password
          </h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1"
              />
            </div>
            <Button
              onClick={handlePasswordChange}
              disabled={updatePassword.isPending || !newPassword}
              variant="outline"
              size="sm"
            >
              {updatePassword.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Update Password
            </Button>
          </div>
        </motion.section>

        {/* Subscription */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card rounded-xl p-6 mb-6"
        >
          <h2 className="font-display font-semibold text-foreground mb-2 flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" /> Subscription
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            Current plan: <span className="font-semibold text-foreground capitalize">{plan}</span>
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate('/pricing')}>
            {plan === 'free' ? 'Upgrade Plan' : 'Manage Plan'}
          </Button>
        </motion.section>

        {/* Script Corpus */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card rounded-xl p-6 mb-6"
        >
          <h2 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" /> Script Corpus
          </h2>
          <CorpusSourceManager />
        </motion.section>

        {/* Corpus Health */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.17 }}
          className="glass-card rounded-xl p-6 mb-6"
        >
          <CorpusHealthDashboard />
        </motion.section>

        {/* About */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card rounded-xl p-6 mb-6"
        >
          <h2 className="font-display font-semibold text-foreground mb-2">About IFFY</h2>
          <p className="text-xs font-display uppercase tracking-[0.15em] text-primary mb-2">Intelligent Film Flow & Yield</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            IFFY is a project intelligence system that guides film and TV projects from inception through production to monetisation and beyond — preserving context, ownership, and financial clarity at every stage.
          </p>
        </motion.section>

        {/* Calibration Lab — internal link */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22 }}
          className="glass-card rounded-xl p-6 mb-6"
        >
          <h2 className="font-display font-semibold text-foreground mb-2 flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" /> Calibration Lab
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            Compare IFFY viability predictions against real-world outcomes. Paradox House members only.
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate('/calibration-lab')}>
            Open Calibration Lab
          </Button>
        </motion.section>

        {/* Account */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card rounded-xl p-6"
        >
          <h2 className="font-display font-semibold text-foreground mb-4">Account</h2>
          <Button variant="destructive" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-1" /> Sign Out
          </Button>
        </motion.section>
      </main>
    </div>
  );
}
