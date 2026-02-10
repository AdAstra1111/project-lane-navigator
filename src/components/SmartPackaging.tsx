import { useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Loader2, Users, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CastInfoDialog } from '@/components/CastInfoDialog';

interface PackagingSuggestion {
  name: string;
  role: string;
  rationale: string;
  market_value: string;
  availability_window: string;
}

interface Props {
  projectTitle: string;
  format: string;
  genres: string[];
  budgetRange: string;
  tone: string;
  assignedLane: string | null;
}

export function SmartPackaging({ projectTitle, format, genres, budgetRange, tone, assignedLane }: Props) {
  const [suggestions, setSuggestions] = useState<PackagingSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<{ name: string; reason: string } | null>(null);

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('smart-packaging', {
        body: { projectTitle, format, genres, budgetRange, tone, assignedLane },
      });
      if (error) throw error;
      setSuggestions(data?.suggestions || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to get packaging suggestions');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold text-foreground">Smart Packaging</h3>
        </div>
        <Button size="sm" variant="outline" onClick={fetchSuggestions} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Users className="h-3.5 w-3.5 mr-1" />}
          {suggestions.length > 0 ? 'Refresh' : 'Get Suggestions'}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        AI recommends cast & director combinations to maximize financeability based on genre, budget, and market trends.
      </p>

      {suggestions.length > 0 && (
        <div className="space-y-3">
          {suggestions.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="border border-border rounded-lg p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Star className="h-3.5 w-3.5 text-amber-400" />
                    <button
                      onClick={() => setSelectedPerson({ name: s.name, reason: `${s.role} · ${s.rationale}` })}
                      className="font-semibold text-sm text-foreground hover:text-primary transition-colors cursor-pointer"
                    >
                      {s.name}
                    </button>
                    <span className="text-xs text-muted-foreground">· {s.role}</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.rationale}</p>
                </div>
              </div>
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span>Market Value: <span className="text-foreground font-medium">{s.market_value}</span></span>
                <span>Window: <span className="text-foreground font-medium">{s.availability_window}</span></span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {selectedPerson && (
        <CastInfoDialog
          personName={selectedPerson.name}
          reason={selectedPerson.reason}
          open={!!selectedPerson}
          onOpenChange={(open) => { if (!open) setSelectedPerson(null); }}
          projectContext={{ title: projectTitle, format, budget_range: budgetRange, genres }}
        />
      )}
    </motion.div>
  );
}
