import { useState, useCallback } from 'react';
import { Search, Loader2, Plus, User, ExternalLink, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { CastInfoDialog } from '@/components/talent/CastInfoDialog';
import { toast } from 'sonner';
import type { PackagingMode } from '@/components/SmartPackaging';

interface TmdbSearchResult {
  tmdb_id: number;
  name: string;
  known_for_department: string;
  profile_url: string | null;
  popularity: number;
  known_for: { title: string; year: string; media_type: string }[];
}

interface Props {
  mode: PackagingMode;
  onAddToTriage: (items: {
    person_name: string;
    person_type: string;
    suggestion_source: string;
    suggestion_context?: string;
    role_suggestion?: string;
  }[]) => Promise<void>;
  onAddToWishlist?: (input: { actor_name: string; role_name: string; status: string }) => void;
  existingNames: Set<string>;
  existingCastNames?: Set<string>;
  projectContext?: { title: string; format: string; budget_range: string; genres: string[] };
}

export function TalentSearch({ mode, onAddToTriage, onAddToWishlist, existingNames, existingCastNames, projectContext }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addingWishlistId, setAddingWishlistId] = useState<number | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<{ name: string; reason: string } | null>(null);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q || q.length < 2) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('tmdb-lookup', {
        body: { name: q, mode: 'search' },
      });
      if (error) throw error;
      setResults(data?.results || []);
    } catch (e: any) {
      toast.error('Search failed');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleAdd = async (result: TmdbSearchResult) => {
    setAddingId(result.tmdb_id);
    try {
      const knownForStr = result.known_for.map(k => `${k.title} (${k.year})`).join(', ');
      await onAddToTriage([{
        person_name: result.name,
        person_type: mode === 'crew' ? 'crew' : 'cast',
        suggestion_source: 'manual-search',
        suggestion_context: knownForStr || result.known_for_department,
        role_suggestion: result.known_for_department,
      }]);
      toast.success(`${result.name} added to triage`);
    } catch {
      toast.error('Failed to add');
    } finally {
      setAddingId(null);
    }
  };

  const handleAddToWishlist = async (result: TmdbSearchResult) => {
    if (!onAddToWishlist) return;
    setAddingWishlistId(result.tmdb_id);
    try {
      onAddToWishlist({
        actor_name: result.name,
        role_name: result.known_for_department || '',
        status: 'wishlist',
      });
      toast.success(`${result.name} added to wishlist`);
    } finally {
      setAddingWishlistId(null);
    }
  };

  const alreadyExists = (name: string) => existingNames.has(name.toLowerCase());
  const alreadyInCast = (name: string) => existingCastNames?.has(name.toLowerCase()) ?? false;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={mode === 'crew' ? 'Search directors, DPs, writers…' : 'Search actors by name…'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            className="pl-8 h-8 text-sm bg-background"
          />
        </div>
        <Button size="sm" variant="outline" onClick={search} disabled={loading || query.trim().length < 2} className="h-8">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Search'}
        </Button>
      </div>

      <AnimatePresence>
        {results.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="space-y-1.5 overflow-hidden"
          >
            {results.map(r => {
              const exists = alreadyExists(r.name);
              return (
                <motion.div
                  key={r.tmdb_id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2.5 border border-border rounded-lg p-2.5 bg-card"
                >
                  <Avatar className="h-10 w-10 shrink-0">
                    {r.profile_url && <AvatarImage src={r.profile_url} alt={r.name} className="object-cover" />}
                    <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedPerson({ name: r.name, reason: r.known_for_department })}
                        className="font-semibold text-sm text-foreground hover:text-primary transition-colors truncate cursor-pointer"
                      >
                        {r.name}
                      </button>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize shrink-0">
                        {r.known_for_department || 'Unknown'}
                      </Badge>
                    </div>
                    {r.known_for.length > 0 && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {r.known_for.map(k => `${k.title}${k.year ? ` (${k.year})` : ''}`).join(' · ')}
                      </p>
                    )}
                  </div>

                  {exists ? (
                    <Badge variant="secondary" className="text-[10px] shrink-0">In triage</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-primary hover:text-primary/80 shrink-0"
                      onClick={() => handleAdd(r)}
                      disabled={addingId === r.tmdb_id}
                    >
                      {addingId === r.tmdb_id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <><Plus className="h-3 w-3 mr-1" /> Triage</>
                      )}
                    </Button>
                  )}
                  {onAddToWishlist && (
                    alreadyInCast(r.name) ? (
                      <Badge variant="secondary" className="text-[10px] shrink-0">On wishlist</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300 shrink-0"
                        onClick={() => handleAddToWishlist(r)}
                        disabled={addingWishlistId === r.tmdb_id}
                      >
                        {addingWishlistId === r.tmdb_id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <><Star className="h-3 w-3 mr-1" /> Wishlist</>
                        )}
                      </Button>
                    )
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {selectedPerson && projectContext && (
        <CastInfoDialog
          personName={selectedPerson.name}
          reason={selectedPerson.reason}
          open={!!selectedPerson}
          onOpenChange={open => { if (!open) setSelectedPerson(null); }}
          projectContext={projectContext}
        />
      )}
    </div>
  );
}
