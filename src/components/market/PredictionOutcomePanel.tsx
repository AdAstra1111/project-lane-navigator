import { useState } from 'react';
import { motion } from 'framer-motion';
import { Target, Plus, TrendingUp, TrendingDown, Clock, CheckCircle2, XCircle, BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { usePredictionOutcomes } from '@/hooks/useTrendEngines';
import { format } from 'date-fns';

const OUTCOMES = [
  { value: 'fully-financed', label: 'Fully Financed', icon: CheckCircle2, color: 'text-emerald-400' },
  { value: 'partially-financed', label: 'Partially Financed', icon: TrendingUp, color: 'text-amber-400' },
  { value: 'stalled', label: 'Stalled', icon: Clock, color: 'text-orange-400' },
  { value: 'abandoned', label: 'Abandoned', icon: XCircle, color: 'text-red-400' },
  { value: 'pending', label: 'Pending', icon: Clock, color: 'text-muted-foreground' },
];

const DISTRIBUTION_TYPES = [
  'Theatrical', 'Streamer', 'Hybrid', 'Direct-to-digital', 'Broadcast', 'Festival-only', 'Other', '',
];

interface Props {
  projectId: string;
  currentTrendScore: number;
}

export function PredictionOutcomePanel({ projectId, currentTrendScore }: Props) {
  const { outcomes, recordOutcome } = usePredictionOutcomes(projectId);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [distribution, setDistribution] = useState('');
  const [revenue, setRevenue] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (!outcome) return;
    recordOutcome.mutate({
      predicted_viability: currentTrendScore,
      actual_financing_outcome: outcome,
      distribution_type: distribution,
      revenue_if_known: revenue,
      notes,
    }, {
      onSuccess: () => {
        setOpen(false);
        setOutcome('');
        setDistribution('');
        setRevenue('');
        setNotes('');
      },
    });
  };

  // Calculate accuracy metrics
  const resolved = outcomes.filter(o => o.actual_financing_outcome !== 'pending');
  const accuracyRate = resolved.length > 0
    ? Math.round((resolved.filter(o => {
        const predicted = o.predicted_viability;
        const wasSuccess = ['fully-financed', 'partially-financed'].includes(o.actual_financing_outcome);
        return (predicted >= 50 && wasSuccess) || (predicted < 50 && !wasSuccess);
      }).length / resolved.length) * 100)
    : null;

  return (
    <div className="space-y-3">
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <h4 className="font-display font-semibold text-foreground text-sm">Prediction Accuracy</h4>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="text-xs">
                <Plus className="h-3 w-3 mr-1" /> Record Outcome
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="font-display">Record Financing Outcome</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="glass-card rounded-lg p-3 flex items-center gap-3">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">Current Trend Score</p>
                    <p className="text-lg font-bold font-display text-foreground">{currentTrendScore}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground ml-auto">This will be saved as the predicted viability</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Actual Outcome</Label>
                  <Select value={outcome} onValueChange={setOutcome}>
                    <SelectTrigger><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                    <SelectContent>
                      {OUTCOMES.filter(o => o.value !== 'pending').map(o => (
                        <SelectItem key={o.value} value={o.value}>
                          <span className="flex items-center gap-2">
                            <o.icon className={cn('h-3.5 w-3.5', o.color)} />
                            {o.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Distribution Type</Label>
                  <Select value={distribution} onValueChange={setDistribution}>
                    <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                    <SelectContent>
                      {DISTRIBUTION_TYPES.filter(Boolean).map(d => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Revenue (if known)</Label>
                  <Input value={revenue} onChange={e => setRevenue(e.target.value)} placeholder="e.g. $2.5M" />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Notes</Label>
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Context on the outcome..." rows={2} />
                </div>

                <Button onClick={handleSubmit} disabled={!outcome || recordOutcome.isPending} className="w-full">
                  {recordOutcome.isPending ? 'Saving…' : 'Save Outcome'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Accuracy KPI */}
        {accuracyRate !== null ? (
          <div className="flex items-center gap-3 mb-3">
            <div className={cn(
              'text-2xl font-bold font-display',
              accuracyRate >= 70 ? 'text-emerald-400' : accuracyRate >= 50 ? 'text-amber-400' : 'text-red-400'
            )}>
              {accuracyRate}%
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Prediction accuracy</p>
              <p className="text-[10px] text-muted-foreground">{resolved.length} resolved outcome{resolved.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mb-3">No resolved outcomes yet. Record financing results to track prediction accuracy.</p>
        )}

        {/* Outcome History */}
        {outcomes.length > 0 && (
          <div className="space-y-2">
            {outcomes.slice(0, 5).map((o) => {
              const config = OUTCOMES.find(oc => oc.value === o.actual_financing_outcome) || OUTCOMES[4];
              const Icon = config.icon;
              return (
                <motion.div
                  key={o.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30"
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', config.color)} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-foreground">{config.label}</span>
                    {o.distribution_type && (
                      <span className="text-[10px] text-muted-foreground ml-2">• {o.distribution_type}</span>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    Predicted: {Math.round(o.predicted_viability)}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {format(new Date(o.created_at), 'dd MMM yy')}
                  </span>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
