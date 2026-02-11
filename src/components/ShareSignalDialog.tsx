import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Share2, Copy, Check, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSharedSignals } from '@/hooks/useSharedSignals';
import { toast } from 'sonner';

interface ShareSignalDialogProps {
  signalId: string;
  signalName: string;
  signalType: 'story' | 'cast';
}

interface Recipient {
  user_id: string;
  display_name: string;
  source: string; // project title or "Company"
}

export function ShareSignalDialog({ signalId, signalName, signalType }: ShareSignalDialogProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const { share } = useSharedSignals();

  // Fetch all collaborators across user's projects
  const { data: recipients = [], isLoading } = useQuery({
    queryKey: ['share-recipients'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // Get projects user owns
      const { data: ownedProjects } = await supabase
        .from('projects')
        .select('id, title')
        .eq('user_id', user.id);

      // Get collaborators for those projects
      const projectIds = (ownedProjects || []).map(p => p.id);
      if (projectIds.length === 0) return [];

      const { data: collabs } = await supabase
        .from('project_collaborators')
        .select('user_id, email, project_id')
        .in('project_id', projectIds)
        .eq('status', 'accepted');

      if (!collabs || collabs.length === 0) return [];

      // Get profiles
      const userIds = [...new Set(collabs.map(c => c.user_id).filter(id => id !== user.id))];
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p.display_name]));
      const projectMap = new Map((ownedProjects || []).map(p => [p.id, p.title]));

      // Deduplicate by user_id, collect project sources
      const recipientMap = new Map<string, Recipient>();
      for (const c of collabs) {
        if (c.user_id === user.id) continue;
        if (!recipientMap.has(c.user_id)) {
          recipientMap.set(c.user_id, {
            user_id: c.user_id,
            display_name: profileMap.get(c.user_id) || c.email || 'Team member',
            source: projectMap.get(c.project_id) || '',
          });
        }
      }

      return Array.from(recipientMap.values());
    },
    enabled: open,
  });

  const toggleRecipient = (uid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const handleShare = () => {
    if (selected.size === 0) {
      toast.error('Select at least one recipient');
      return;
    }
    share.mutate(
      {
        signalId,
        signalType,
        signalName,
        recipientIds: Array.from(selected),
        note,
      },
      { onSuccess: () => { setOpen(false); setSelected(new Set()); setNote(''); } }
    );
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}/trends?highlight=${signalType}-${signalId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success('Link copied');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="text-muted-foreground hover:text-primary transition-colors p-1 rounded"
          title="Share signal"
        >
          <Share2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-display">Share Signal</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground truncate">{signalName}</p>

        {/* Copy link */}
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleCopyLink}>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied!' : 'Copy shareable link'}
        </Button>

        {/* Recipients */}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Share with collaborators</p>
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin" /></div>
          ) : recipients.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No collaborators found. Invite partners to your projects first.</p>
          ) : (
            recipients.map(r => (
              <label
                key={r.user_id}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(r.user_id)}
                  onCheckedChange={() => toggleRecipient(r.user_id)}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium block truncate">{r.display_name}</span>
                  {r.source && <span className="text-xs text-muted-foreground">{r.source}</span>}
                </div>
              </label>
            ))
          )}
        </div>

        {/* Note */}
        <Textarea
          placeholder="Add a note (optional)..."
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          className="text-sm"
        />

        <Button
          onClick={handleShare}
          disabled={selected.size === 0 || share.isPending}
          className="w-full gap-2"
        >
          {share.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Share with {selected.size} {selected.size === 1 ? 'person' : 'people'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
