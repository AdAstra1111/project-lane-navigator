import { useState } from 'react';
import { motion } from 'framer-motion';
import { Users, UserPlus, X, Shield, Eye, Pencil, Crown, Link2, Copy, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  useProjectCollaborators,
  ROLE_LABELS,
  type ProjectRole,
  type ProjectCollaborator,
} from '@/hooks/useCollaboration';
import { useInviteLinks } from '@/hooks/useInviteLinks';
import { toast } from 'sonner';

const ROLE_ICONS: Record<ProjectRole, React.ElementType> = {
  producer: Crown,
  sales_agent: Eye,
  lawyer: Shield,
  creative: Pencil,
};

const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  producer: 'Full access — edit, delete, manage team',
  sales_agent: 'Views packaging, cast, territories, buyer matches',
  lawyer: 'Views co-pro treaties, incentives, finance scenarios',
  creative: 'Views analysis, notes, script versions',
};

function CollaboratorRow({
  collab,
  isOwner,
  onRemove,
  onRoleChange,
}: {
  collab: ProjectCollaborator;
  isOwner: boolean;
  onRemove: () => void;
  onRoleChange: (role: ProjectRole) => void;
}) {
  const Icon = ROLE_ICONS[collab.role];

  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {collab.display_name || collab.email}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{ROLE_LABELS[collab.role]}</span>
            {collab.status === 'pending' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-accent/10 text-accent border-accent/30">
                Pending
              </Badge>
            )}
          </div>
        </div>
      </div>
      {isOwner && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Select value={collab.role} onValueChange={(v) => onRoleChange(v as ProjectRole)}>
            <SelectTrigger className="h-7 w-[130px] text-xs border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROLE_LABELS) as ProjectRole[]).map(role => (
                <SelectItem key={role} value={role} className="text-xs">
                  {ROLE_LABELS[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
            <X className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
      )}
    </div>
  );
}

interface ProjectCollaboratorsPanelProps {
  projectId: string;
  isOwner: boolean;
}

export function ProjectCollaboratorsPanel({ projectId, isOwner }: ProjectCollaboratorsPanelProps) {
  const { collaborators, isLoading, remove, updateRole } = useProjectCollaborators(projectId);
  const { links, create: createLink, remove: removeLink, getInviteUrl } = useInviteLinks(projectId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [role, setRole] = useState<ProjectRole>('creative');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const handleCreateLink = async () => {
    const result = await createLink.mutateAsync({ role });
    const url = getInviteUrl(result.token);
    await navigator.clipboard.writeText(url);
    setCopiedToken(result.token);
    toast.success('Invite link copied to clipboard!');
    setTimeout(() => setCopiedToken(null), 3000);
  };

  const handleCopyLink = async (token: string) => {
    await navigator.clipboard.writeText(getInviteUrl(token));
    setCopiedToken(token);
    toast.success('Link copied!');
    setTimeout(() => setCopiedToken(null), 3000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.3 }}
      className="glass-card rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-lg">Team</h3>
          {collaborators.length > 0 && (
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
              {collaborators.length}
            </span>
          )}
        </div>
        {isOwner && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs">
                <UserPlus className="h-3 w-3 mr-1" />
                Invite
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="font-display">Create Invite Link</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Role for invitee</label>
                  <Select value={role} onValueChange={v => setRole(v as ProjectRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ROLE_LABELS) as ProjectRole[]).map(r => (
                        <SelectItem key={r} value={r}>
                          <div>
                            <p className="font-medium">{ROLE_LABELS[r]}</p>
                            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleCreateLink}
                  disabled={createLink.isPending}
                  className="w-full"
                >
                  <Link2 className="h-4 w-4 mr-1.5" />
                  {createLink.isPending ? 'Creating…' : 'Create & Copy Link'}
                </Button>

                {links.length > 0 && (
                  <div className="border-t border-border pt-3 space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">Active Links</p>
                    {links.map((link: any) => (
                      <div key={link.id} className="flex items-center justify-between text-xs bg-muted/50 rounded-lg px-3 py-2">
                        <div>
                          <span className="font-medium text-foreground">{ROLE_LABELS[link.role as ProjectRole]}</span>
                          <span className="text-muted-foreground ml-2">
                            {link.use_count} use{link.use_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => handleCopyLink(link.token)}
                          >
                            {copiedToken === link.token ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => removeLink.mutate(link.id)}
                          >
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : collaborators.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {isOwner ? 'No team members yet. Invite collaborators to share this project.' : 'No other team members.'}
        </p>
      ) : (
        <div className="space-y-1">
          {collaborators.map(collab => (
            <CollaboratorRow
              key={collab.id}
              collab={collab}
              isOwner={isOwner}
              onRemove={() => remove.mutate(collab.id)}
              onRoleChange={(newRole) => updateRole.mutate({ collaboratorId: collab.id, role: newRole })}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}
