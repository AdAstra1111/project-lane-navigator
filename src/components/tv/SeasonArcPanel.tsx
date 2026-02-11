import { useState } from 'react';
import { Loader2, Sparkles, Milestone, Flag, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ArcResult {
  midpoint_hook: { score: number; description: string };
  finale_hook: { score: number; description: string };
  arc_cohesion: number;
  cliffhanger_potential: string;
  season_structure_notes: string;
}

export function SeasonArcPanel({
  projectTitle,
  scriptText,
}: {
  projectTitle: string;
  scriptText: string | null;
}) {
  const [result, setResult] = useState<ArcResult | null>(null);
  const [loading, setLoading] = useState(false);

  const analyse = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-project', {
        body: {
          mode: 'tv-season-arc',
          projectTitle,
          scriptText: scriptText?.slice(0, 8000),
        },
      });
      if (error) throw error;
      setResult(data);
    } catch {
      toast.error('Season arc analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (s: number) => s >= 70 ? 'text-emerald-400' : s >= 40 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Milestone className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Season Arc Evaluation</h4>
        </div>
        <Button size="sm" variant="outline" onClick={analyse} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
          Evaluate Arc
        </Button>
      </div>

      {!result && !loading && (
        <p className="text-sm text-muted-foreground">
          Scores the midpoint escalation and finale hook — critical for platform commissioning decisions.
        </p>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="glass-card rounded-lg p-3 text-center">
              <Flag className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
              <p className="text-xs text-muted-foreground">Midpoint Hook</p>
              <p className={`text-2xl font-display font-bold ${scoreColor(result.midpoint_hook.score)}`}>{result.midpoint_hook.score}</p>
              <p className="text-xs text-muted-foreground mt-1">{result.midpoint_hook.description}</p>
            </div>
            <div className="glass-card rounded-lg p-3 text-center">
              <Zap className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
              <p className="text-xs text-muted-foreground">Finale Hook</p>
              <p className={`text-2xl font-display font-bold ${scoreColor(result.finale_hook.score)}`}>{result.finale_hook.score}</p>
              <p className="text-xs text-muted-foreground mt-1">{result.finale_hook.description}</p>
            </div>
            <div className="glass-card rounded-lg p-3 text-center">
              <Milestone className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
              <p className="text-xs text-muted-foreground">Arc Cohesion</p>
              <p className={`text-2xl font-display font-bold ${scoreColor(result.arc_cohesion)}`}>{result.arc_cohesion}</p>
            </div>
          </div>

          <div className="glass-card rounded-lg p-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Cliffhanger Potential</p>
            <p className="text-sm text-foreground">{result.cliffhanger_potential}</p>
          </div>

          {result.season_structure_notes && (
            <div className="glass-card rounded-lg p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Structure Notes</p>
              <p className="text-sm text-foreground leading-relaxed">{result.season_structure_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}