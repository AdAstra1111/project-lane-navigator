import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Star, ThumbsDown, HelpCircle, RotateCcw, ChevronDown, ChevronUp,
  GripVertical, Trash2, ArrowUp, ArrowDown, Sparkles, Ban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CastInfoDialog } from '@/components/CastInfoDialog';
import type { TalentTriageItem, TriageStatus } from '@/hooks/useTalentTriage';

interface Props {
  unsorted: TalentTriageItem[];
  shortlisted: TalentTriageItem[];
  maybes: TalentTriageItem[];
  nos: TalentTriageItem[];
  passed: TalentTriageItem[];
  onUpdateStatus: (id: string, status: TriageStatus) => void;
  onUpdatePriority: (id: string, rank: number) => void;
  onDelete: (id: string) => void;
  onRequestReplacement?: (item: TalentTriageItem) => void;
  projectContext?: { title: string; format: string; budget_range: string; genres: string[] };
}

const statusConfig: Record<TriageStatus, { label: string; icon: any; color: string }> = {
  unsorted: { label: 'Unsorted', icon: Sparkles, color: 'text-muted-foreground' },
  shortlist: { label: 'Shortlist', icon: Star, color: 'text-amber-400' },
  maybe: { label: 'Maybe', icon: HelpCircle, color: 'text-blue-400' },
  no: { label: 'No', icon: Ban, color: 'text-orange-400' },
  pass: { label: 'Pass', icon: ThumbsDown, color: 'text-red-400' },
};

function TriageCard({
  item,
  onUpdateStatus,
  onUpdatePriority,
  onDelete,
  onRequestReplacement,
  showPriorityControls,
  listLength,
  projectContext,
}: {
  item: TalentTriageItem;
  onUpdateStatus: (id: string, status: TriageStatus) => void;
  onUpdatePriority: (id: string, rank: number) => void;
  onDelete: (id: string) => void;
  onRequestReplacement?: (item: TalentTriageItem) => void;
  showPriorityControls: boolean;
  listLength: number;
  projectContext?: Props['projectContext'];
}) {
  const [selectedPerson, setSelectedPerson] = useState<{ name: string; reason: string } | null>(null);

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="border border-border rounded-lg p-3 bg-card"
      >
        <div className="flex items-start gap-2">
          {showPriorityControls && (
            <div className="flex flex-col items-center gap-0.5 pt-0.5">
              <button
                onClick={() => onUpdatePriority(item.id, Math.max(0, item.priority_rank - 1))}
                disabled={item.priority_rank === 0}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <GripVertical className="h-3 w-3 text-muted-foreground/50" />
              <button
                onClick={() => onUpdatePriority(item.id, item.priority_rank + 1)}
                disabled={item.priority_rank >= listLength - 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={() => setSelectedPerson({ name: item.person_name, reason: `${item.role_suggestion} · ${item.suggestion_context}` })}
                className="font-semibold text-sm text-foreground hover:text-primary transition-colors cursor-pointer truncate"
              >
                {item.person_name}
              </button>
              {item.role_suggestion && (
                <span className="text-xs text-muted-foreground truncate">· {item.role_suggestion}</span>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize shrink-0">
                {item.person_type}
              </Badge>
            </div>

            {item.creative_fit && (
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-1">{item.creative_fit}</p>
            )}
            {item.commercial_case && (
              <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-1">{item.commercial_case}</p>
            )}

            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {item.status !== 'shortlist' && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-amber-400 hover:text-amber-300"
                  onClick={() => onUpdateStatus(item.id, 'shortlist')}>
                  <Star className="h-3 w-3 mr-1" /> Shortlist
                </Button>
              )}
              {item.status !== 'maybe' && item.status !== 'no' && item.status !== 'pass' && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-blue-400 hover:text-blue-300"
                  onClick={() => onUpdateStatus(item.id, 'maybe')}>
                  <HelpCircle className="h-3 w-3 mr-1" /> Maybe
                </Button>
              )}
              {item.status !== 'no' && item.status !== 'pass' && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-orange-400 hover:text-orange-300"
                  onClick={() => onUpdateStatus(item.id, 'no')}>
                  <Ban className="h-3 w-3 mr-1" /> No
                </Button>
              )}
              {item.status !== 'pass' && item.status !== 'no' && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-red-400 hover:text-red-300"
                  onClick={() => onUpdateStatus(item.id, 'pass')}>
                  <ThumbsDown className="h-3 w-3 mr-1" /> Pass
                </Button>
              )}
              {(item.status === 'pass' || item.status === 'no') && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onUpdateStatus(item.id, 'unsorted')}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Restore
                </Button>
              )}
              {item.status === 'pass' && onRequestReplacement && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-primary hover:text-primary/80"
                  onClick={() => onRequestReplacement(item)}>
                  <Sparkles className="h-3 w-3 mr-1" /> Suggest replacement
                </Button>
              )}
            </div>
          </div>

          <button
            onClick={() => onDelete(item.id)}
            className="text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </motion.div>

      {selectedPerson && projectContext && (
        <CastInfoDialog
          personName={selectedPerson.name}
          reason={selectedPerson.reason}
          open={!!selectedPerson}
          onOpenChange={(open) => { if (!open) setSelectedPerson(null); }}
          projectContext={projectContext}
        />
      )}
    </>
  );
}

function TriageColumn({
  status,
  items,
  onUpdateStatus,
  onUpdatePriority,
  onDelete,
  onRequestReplacement,
  defaultOpen = true,
  projectContext,
}: {
  status: TriageStatus;
  items: TalentTriageItem[];
  onUpdateStatus: Props['onUpdateStatus'];
  onUpdatePriority: Props['onUpdatePriority'];
  onDelete: Props['onDelete'];
  onRequestReplacement?: Props['onRequestReplacement'];
  defaultOpen?: boolean;
  projectContext?: Props['projectContext'];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const config = statusConfig[status];
  const Icon = config.icon;

  if (items.length === 0 && (status === 'pass' || status === 'no')) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left mb-2 group"
      >
        <Icon className={`h-4 w-4 ${config.color}`} />
        <span className="font-display font-semibold text-sm text-foreground">{config.label}</span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{items.length}</Badge>
        <span className="ml-auto text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="space-y-2 overflow-hidden"
          >
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 italic py-2 pl-6">No names here yet</p>
            ) : (
              items.map(item => (
                <TriageCard
                  key={item.id}
                  item={item}
                  onUpdateStatus={onUpdateStatus}
                  onUpdatePriority={onUpdatePriority}
                  onDelete={onDelete}
                  onRequestReplacement={onRequestReplacement}
                  showPriorityControls={status === 'shortlist'}
                  listLength={items.length}
                  projectContext={projectContext}
                />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TalentTriageBoard({
  unsorted, shortlisted, maybes, nos, passed,
  onUpdateStatus, onUpdatePriority, onDelete, onRequestReplacement,
  projectContext,
}: Props) {
  const total = unsorted.length + shortlisted.length + maybes.length + nos.length + passed.length;
  if (total === 0) return null;

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-2">
        <h4 className="font-display font-semibold text-sm text-foreground">Talent Triage</h4>
        <Badge variant="outline" className="text-[10px]">{total} suggestions</Badge>
      </div>

      <div className="space-y-4">
        <TriageColumn status="unsorted" items={unsorted}
          onUpdateStatus={onUpdateStatus} onUpdatePriority={onUpdatePriority}
          onDelete={onDelete} projectContext={projectContext} />

        <TriageColumn status="shortlist" items={shortlisted}
          onUpdateStatus={onUpdateStatus} onUpdatePriority={onUpdatePriority}
          onDelete={onDelete} projectContext={projectContext} />

        <TriageColumn status="maybe" items={maybes}
          onUpdateStatus={onUpdateStatus} onUpdatePriority={onUpdatePriority}
          onDelete={onDelete} projectContext={projectContext} />

        <TriageColumn status="no" items={nos} defaultOpen={false}
          onUpdateStatus={onUpdateStatus} onUpdatePriority={onUpdatePriority}
          onDelete={onDelete} projectContext={projectContext} />

        <TriageColumn status="pass" items={passed} defaultOpen={false}
          onUpdateStatus={onUpdateStatus} onUpdatePriority={onUpdatePriority}
          onDelete={onDelete} onRequestReplacement={onRequestReplacement}
          projectContext={projectContext} />
      </div>
    </div>
  );
}
