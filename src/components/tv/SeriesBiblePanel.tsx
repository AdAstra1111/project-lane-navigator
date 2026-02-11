import { useState } from 'react';
import { Loader2, BookOpen, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';

interface BibleResult {
  strength_score: number;
  world_building: number;
  character_depth: number;
  tone_guide_clarity: number;
  episode_format_definition: number;
  strengths: string[];
  gaps: string[];
}

export function SeriesBiblePanel({
  projectTitle,
  scriptText,
}: {
  projectTitle: string;
  scriptText: string | null;
}) {
  const [result, setResult] = useState<BibleResult | null>(null);
  const [loading, setLoading] = useState(false);

  const analyse = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-project', {
        body: { mode: 'tv-series-bible', projectTitle, scriptText: scriptText?.slice(0, 8000) },
      });
      if (error) throw error;
      setResult(data);
    } catch {
      toast.error('Series bible analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (s: number) => s >= 70 ? 'text-emerald-400' : s >= 40 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Series Bible Strength</h4>
        </div>
        <Button size="sm" variant="outline" onClick={analyse} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
          Score Bible
        </Button>
      </div>

      {!result && !loading && (
        <p className="text-sm text-muted-foreground">
          Evaluates series bible completeness — world-building, character depth, tone guide, and episode format definition.
        </p>
      )}

      {result && (
        <div className="space-y-4">
          <div className="text-center">
            <p className={`text-4xl font-display font-bold ${scoreColor(result.strength_score)}`}>
              {result.strength_score}<span className="text-lg text-muted-foreground">/100</span>
            </p>
            <p className="text-xs text-muted-foreground">Overall Bible Strength</p>
          </div>

          <div className="space-y-3">
            {[
              { label: 'World Building', value: result.world_building },
              { label: 'Character Depth', value: result.character_depth },
              { label: 'Tone Guide Clarity', value: result.tone_guide_clarity },
              { label: 'Episode Format Definition', value: result.episode_format_definition },
            ].map(item => (
              <div key={item.label} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className={scoreColor(item.value)}>{item.value}%</span>
                </div>
                <Progress value={item.value} className="h-1.5" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Strengths</p>
              </div>
              <ul className="space-y-1">
                {result.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-foreground">{s}</li>
                ))}
              </ul>
            </div>
            <div className="glass-card rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Gaps</p>
              </div>
              <ul className="space-y-1">
                {result.gaps.map((s, i) => (
                  <li key={i} className="text-xs text-foreground">{s}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}