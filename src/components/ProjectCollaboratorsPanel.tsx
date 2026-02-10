import { useState } from 'react';
import { motion } from 'framer-motion';
import { Users, UserPlus, X, Shield, Eye, Pencil, Crown, Mail, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const { collaborators, isLoading, invite, remove, updateRole } = useProjectCollaborators(projectId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('creative');

  const handleInvite = () => {
    if (!email.trim()) return;
    invite.mutate({ email: email.trim(), role }, {
      onSuccess: () => {
        setEmail('');
        setRole('creative');
        setInviteOpen(false);
      },
    });
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
                <DialogTitle className="font-display">Invite Team Member</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Email address</label>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      type="email"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Role</label>
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
                  onClick={handleInvite}
                  disabled={!email.trim() || invite.isPending}
                  className="w-full"
                >
                  {invite.isPending ? 'Sending…' : 'Send Invitation'}
                </Button>
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
