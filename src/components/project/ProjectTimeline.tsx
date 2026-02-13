import { motion } from 'framer-motion';
import { Clock, Users, Handshake, FileText, DollarSign, MessageSquare } from 'lucide-react';
import { useProjectUpdates } from '@/hooks/useProjectAttachments';

const TYPE_ICONS: Record<string, React.ElementType> = {
  cast: Users,
  partner: Handshake,
  script: FileText,
  finance: DollarSign,
  note: MessageSquare,
};

interface Props {
  projectId: string;
}

export function ProjectTimeline({ projectId }: Props) {
  const { updates } = useProjectUpdates(projectId);

  if (updates.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.3 }}
      className="space-y-3"
    >
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground text-xl">Updates</h3>
      </div>

      <div className="space-y-2">
        {updates.slice(0, 10).map((update, i) => {
          const Icon = TYPE_ICONS[update.update_type] || MessageSquare;
          return (
            <div key={update.id} className="flex gap-3 text-sm">
              <div className="flex flex-col items-center">
                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Icon className="h-3 w-3 text-muted-foreground" />
                </div>
                {i < Math.min(updates.length, 10) - 1 && (
                  <div className="w-px flex-1 bg-border mt-1" />
                )}
              </div>
              <div className="pb-3 min-w-0">
                <p className="text-foreground font-medium truncate">{update.title}</p>
                {update.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{update.description}</p>
                )}
                {update.impact_summary && (
                  <p className="text-xs text-primary mt-0.5">{update.impact_summary}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {new Date(update.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
