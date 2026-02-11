import { useState } from 'react';
import { motion } from 'framer-motion';
import { ListPlus, Check } from 'lucide-react';
import { CastTrend } from '@/hooks/useTrends';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendScoreBadges } from '@/components/TrendScoreBadges';
import { ShareSignalDialog } from '@/components/ShareSignalDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePersonImage } from '@/hooks/usePersonImage';
import { useProjects } from '@/hooks/useProjects';
import { useTalentTriage } from '@/hooks/useTalentTriage';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

const TREND_TYPE_STYLES: Record<string, string> = {
  Emerging: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Accelerating: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Resurgent: 'bg-[hsl(260,50%,55%)]/15 text-[hsl(260,50%,70%)] border-[hsl(260,50%,55%)]/30',
};

const PHASE_STYLES: Record<string, string> = {
  Early: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Building: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Peaking: 'bg-red-500/15 text-red-400 border-red-500/30',
};

interface CastTrendCardProps {
  trend: CastTrend;
  index: number;
  isArchived?: boolean;
}

function ShortlistButton({ trend }: { trend: CastTrend }) {
  const { projects } = useProjects();
  const [open, setOpen] = useState(false);
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-primary">
          <ListPlus className="h-3.5 w-3.5" />
          Shortlist
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">Add to project triage</p>
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-2">No projects yet</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {projects.map(p => (
              <ShortlistProjectRow
                key={p.id}
                projectId={p.id}
                projectTitle={p.title}
                actorName={trend.actor_name}
                context={trend.explanation}
                added={addedTo.has(p.id)}
                onAdded={() => setAddedTo(prev => new Set(prev).add(p.id))}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ShortlistProjectRow({
  projectId,
  projectTitle,
  actorName,
  context,
  added,
  onAdded,
}: {
  projectId: string;
  projectTitle: string;
  actorName: string;
  context: string;
  added: boolean;
  onAdded: () => void;
}) {
  const { addItems } = useTalentTriage(projectId);
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    setLoading(true);
    await addItems([{
      person_name: actorName,
      person_type: 'cast',
      suggestion_source: 'cast-trends',
      suggestion_context: context,
    }]);
    setLoading(false);
    onAdded();
    toast.success(`${actorName} added to ${projectTitle} triage`);
  };

  return (
    <button
      onClick={handleAdd}
      disabled={added || loading}
      className="w-full flex items-center justify-between text-left text-xs px-2 py-1.5 rounded hover:bg-muted/60 disabled:opacity-50 transition-colors"
    >
      <span className="truncate">{projectTitle}</span>
      {added && <Check className="h-3 w-3 text-emerald-400 shrink-0" />}
    </button>
  );
}

export function CastTrendCard({ trend, index, isArchived }: CastTrendCardProps) {
  const imageUrl = usePersonImage(trend.actor_name);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className="glass-card rounded-lg p-5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {/* Profile Photo */}
          <div className="h-12 w-12 rounded-full bg-muted/60 overflow-hidden shrink-0 border border-border/50">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={trend.actor_name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm font-medium">
                {trend.actor_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <h4 className="font-display font-semibold text-foreground">{trend.actor_name}</h4>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              {trend.region && <span>{trend.region}</span>}
              {trend.region && trend.age_band && <span>·</span>}
              {trend.age_band && <span>{trend.age_band}</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Badge className={`text-[10px] px-2 py-0.5 border ${TREND_TYPE_STYLES[trend.trend_type] ?? ''}`}>
            {trend.trend_type}
          </Badge>
          <Badge className={`text-[10px] px-2 py-0.5 border ${PHASE_STYLES[trend.cycle_phase] ?? ''}`}>
            {trend.cycle_phase}
          </Badge>
        </div>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{trend.explanation}</p>

      {/* Scoring Badges */}
      <TrendScoreBadges
        strength={trend.strength}
        velocity={trend.velocity}
        saturationRisk={trend.saturation_risk}
      />

      {/* Forecast */}
      {trend.forecast && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
          12-month forecast: {trend.forecast}
        </p>
      )}

      {(trend.sales_leverage || trend.timing_window) && (
        <div className="flex gap-2 flex-wrap text-xs">
          {trend.sales_leverage && (
            <span className="bg-primary/10 text-primary rounded px-2 py-0.5 font-medium">{trend.sales_leverage}</span>
          )}
          {trend.timing_window && (
            <span className="bg-muted/60 text-foreground rounded px-2 py-0.5">{trend.timing_window}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex gap-1.5 flex-wrap">
          {trend.genre_relevance?.slice(0, 3).map(g => (
            <span key={g} className="bg-muted/50 rounded px-1.5 py-0.5">{g}</span>
          ))}
          {trend.market_alignment && (
            <span className="bg-muted/50 rounded px-1.5 py-0.5">{trend.market_alignment}</span>
          )}
          {trend.target_buyer && (
            <span className="bg-muted/50 rounded px-1.5 py-0.5">{trend.target_buyer}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isArchived && <ShortlistButton trend={trend} />}
          <ShareSignalDialog signalId={trend.id} signalName={trend.actor_name} signalType="cast" />
          <span>
            {isArchived && trend.archived_at
              ? `Archived ${formatDistanceToNow(new Date(trend.archived_at), { addSuffix: true })}`
              : `Detected ${formatDistanceToNow(new Date(trend.first_detected_at), { addSuffix: true })}`}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
