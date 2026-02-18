/**
 * ShareWithModal — Two tabs: Share Link (signed URL export) | Share with People (permissioned).
 * Uses ProjectPackage resolver as single source of truth.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Copy, Link2, UserPlus, RefreshCw, Loader2, Check, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import type { ProjectPackage } from '@/hooks/useProjectPackage';

type Scope = 'approved_preferred' | 'approved_only' | 'latest_only';
type Expiry = '86400' | '604800' | '2592000';
type Role = 'viewer' | 'commenter' | 'editor';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  projectTitle: string;
  pkg?: ProjectPackage | null;
}

export function ShareWithModal({ open, onOpenChange, projectId, projectTitle, pkg }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [linkScope, setLinkScope] = useState<Scope>('approved_preferred');
  const [linkExpiry, setLinkExpiry] = useState<Expiry>('604800');
  const [copiedLink, setCopiedLink] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<{ url: string; expiresAt: string } | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('viewer');

  // Summary for the user
  const packageSummary = pkg
    ? `${pkg.deliverables.length + pkg.season_scripts.length} documents (${pkg.approvedCount} approved)`
    : 'Loading…';

  // ─ Generate share link (delegates to export-package edge function) ─
  const generateLink = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('export-package', {
        body: {
          projectId,
          scope: linkScope,
          include_master_script: true,
          expiresInSeconds: Number(linkExpiry),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { signed_url: string; expires_at: string; doc_count: number };
    },
    onSuccess: (data) => {
      setGeneratedLink({ url: data.signed_url, expiresAt: data.expires_at });
      toast.success(`Package exported (${data.doc_count} docs). Link ready.`);
    },
    onError: (err: any) => {
      toast.error('Export failed: ' + (err.message || 'Unknown error'));
    },
  });

  const handleCopyLink = async () => {
    if (!generatedLink) return;
    const text = generatedLink.url;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for iframes / non-secure contexts
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Could not copy — please copy the link manually');
    }
  };

  // ─ Existing shares ─
  const { data: shares = [] } = useQuery({
    queryKey: ['project-shares', projectId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('project_shares')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: open,
  });

  const addShare = useMutation({
    mutationFn: async () => {
      if (!newEmail.trim()) throw new Error('Email required');
      const { error } = await (supabase as any)
        .from('project_shares')
        .insert({
          project_id: projectId,
          email: newEmail.trim().toLowerCase(),
          role: newRole,
          invited_by: user?.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewEmail('');
      toast.success('Invite added');
      qc.invalidateQueries({ queryKey: ['project-shares', projectId] });
    },
    onError: (err: any) => {
      toast.error('Failed to add invite: ' + (err.message || 'Unknown error'));
    },
  });

  const removeShare = useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await (supabase as any)
        .from('project_shares')
        .delete()
        .eq('id', shareId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-shares', projectId] });
    },
  });

  const ROLE_LABELS: Record<Role, string> = {
    viewer: 'Viewer',
    commenter: 'Commenter',
    editor: 'Editor',
  };

  const EXPIRY_LABELS: Record<Expiry, string> = {
    '86400': '1 day',
    '604800': '7 days',
    '2592000': '30 days',
  };

  const SCOPE_LABELS: Record<Scope, string> = {
    approved_preferred: 'Approved preferred',
    approved_only: 'Approved only',
    latest_only: 'Latest only',
  };

  const inviteMessage = (email: string, role: Role) =>
    `Hi,\n\nYou've been granted ${ROLE_LABELS[role]} access to "${projectTitle}" on IFFY.\n\nLog in to your account and navigate to the project to get started.\n\n— Shared via IFFY`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            Share Project Package
          </DialogTitle>
          {pkg && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{packageSummary}</p>
          )}
        </DialogHeader>

        <Tabs defaultValue="link">
          <TabsList className="w-full">
            <TabsTrigger value="link" className="flex-1">Share Link</TabsTrigger>
            <TabsTrigger value="people" className="flex-1">Share with People</TabsTrigger>
          </TabsList>

          {/* ── LINK TAB ── */}
          <TabsContent value="link" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Document scope</Label>
                <Select
                  value={linkScope}
                  onValueChange={(v) => { setLinkScope(v as Scope); setGeneratedLink(null); }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SCOPE_LABELS) as [Scope, string][]).map(([val, label]) => (
                      <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Expires after</Label>
                <Select
                  value={linkExpiry}
                  onValueChange={(v) => { setLinkExpiry(v as Expiry); setGeneratedLink(null); }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(EXPIRY_LABELS) as [Expiry, string][]).map(([val, label]) => (
                      <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {generatedLink ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={generatedLink.url}
                    className="text-xs h-8 font-mono truncate"
                  />
                  <Button size="sm" variant="outline" className="shrink-0 gap-1 h-8" onClick={handleCopyLink}>
                    {copiedLink
                      ? <Check className="h-3.5 w-3.5 text-[hsl(var(--chart-2))]" />
                      : <Copy className="h-3.5 w-3.5" />}
                    {copiedLink ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Expires {new Date(generatedLink.expiresAt).toLocaleDateString()}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs h-7"
                  onClick={() => { setGeneratedLink(null); generateLink.mutate(); }}
                  disabled={generateLink.isPending}
                >
                  <RefreshCw className="h-3 w-3" />
                  Regenerate link
                </Button>
              </div>
            ) : (
              <Button
                className="w-full gap-2"
                onClick={() => generateLink.mutate()}
                disabled={generateLink.isPending}
              >
                {generateLink.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
                ) : (
                  <><Link2 className="h-4 w-4" />Create share link</>
                )}
              </Button>
            )}

            <p className="text-[10px] text-muted-foreground">
              The link provides a downloadable ZIP of the project package. Anyone with the link can download it until it expires.
            </p>
          </TabsContent>

          {/* ── PEOPLE TAB ── */}
          <TabsContent value="people" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Invite by email</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="name@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="text-xs h-8"
                  onKeyDown={(e) => { if (e.key === 'Enter') addShare.mutate(); }}
                />
                <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
                  <SelectTrigger className="h-8 w-32 text-xs shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(ROLE_LABELS) as [Role, string][]).map(([val, label]) => (
                      <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="shrink-0 h-8 gap-1"
                  onClick={() => addShare.mutate()}
                  disabled={addShare.isPending || !newEmail.trim()}
                >
                  {addShare.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <UserPlus className="h-3.5 w-3.5" />}
                  Add
                </Button>
              </div>
            </div>

            {shares.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Current access</Label>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {shares.map((share: any) => (
                    <div
                      key={share.id}
                      className="flex items-center justify-between px-2 py-1.5 rounded bg-muted/30 text-xs"
                    >
                      <span className="text-foreground truncate">{share.email || share.user_id}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 capitalize">
                          {share.role}
                        </Badge>
                        <button
                          onClick={() => removeShare.mutate(share.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {newEmail && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Invite message (copy & send manually)
                </Label>
                <textarea
                  readOnly
                  value={inviteMessage(newEmail, newRole)}
                  className="w-full text-[10px] font-mono bg-muted/30 rounded p-2 resize-none h-24 border border-border/40 text-muted-foreground"
                />
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Access is granted by role. Viewers can read documents; Commenters can add notes; Editors can modify documents where permitted.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
