import { useState } from 'react';
import { Loader2, Repeat, Users, Sparkles, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface StoryEngineResult {
  episodic_repeatability: { score: number; reasoning: string };
  character_elasticity: { score: number; reasoning: string };
  engine_description: string;
  sustainability_rating: 'strong' | 'moderate' | 'weak';
  suggestions: string[];
}

export function StoryEnginePanel({
  projectId,
  projectTitle,
  format,
  genres,
  scriptText,
}: {
  projectId: string;
  projectTitle: string;
  format: string;
  genres: string[];
  scriptText: string | null;
}) {
  const [result, setResult] = useState<StoryEngineResult | null>(null);
  const [loading, setLoading] = useState(false);

  const analyse = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-project', {
        body: {
          mode: 'tv-story-engine',
          projectTitle,
          format,
          genres,
          scriptText: scriptText?.slice(0, 8000),
        },
      });
      if (error) throw error;
      setResult(data);
    } catch (e: any) {
      toast.error('Story engine analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const ratingColor = {
    strong: 'text-emerald-400',
    moderate: 'text-amber-400',
    weak: 'text-red-400',
  };

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Repeat className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Story Engine Analysis</h4>
        </div>
        <Button size="sm" variant="outline" onClick={analyse} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
          Analyse Engine
        </Button>
      </div>

      {!result && !loading && (
        <p className="text-sm text-muted-foreground">
          Evaluates whether the series concept has a sustainable story engine — can it generate 
          compelling episodes repeatedly without exhausting its premise?
        </p>
      )}

      {result && (
        <div className="space-y-4">
          <div className="glass-card rounded-lg p-4 border-l-4 border-primary">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Story Engine</p>
            <p className="text-sm text-foreground leading-relaxed">{result.engine_description}</p>
            <p className="text-xs mt-2">
              Sustainability: <span className={`font-semibold ${ratingColor[result.sustainability_rating]}`}>
                {result.sustainability_rating.toUpperCase()}
              </span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ScoreCard
              icon={Repeat}
              label="Episodic Repeatability"
              score={result.episodic_repeatability.score}
              reasoning={result.episodic_repeatability.reasoning}
            />
            <ScoreCard
              icon={Users}
              label="Character Elasticity"
              score={result.character_elasticity.score}
              reasoning={result.character_elasticity.reasoning}
            />
          </div>

          {result.suggestions.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Suggestions</p>
              <ul className="space-y-1">
                {result.suggestions.map((s, i) => (
                  <li key={i} className="text-sm text-foreground flex gap-2">
                    <TrendingUp className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreCard({ icon: Icon, label, score, reasoning }: {
  icon: React.ElementType;
  label: string;
  score: number;
  reasoning: string;
}) {
  const color = score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="glass-card rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-2xl font-display font-bold ${color}`}>{score}<span className="text-sm text-muted-foreground">/100</span></p>
      <p className="text-xs text-muted-foreground leading-relaxed">{reasoning}</p>
    </div>
  );
}