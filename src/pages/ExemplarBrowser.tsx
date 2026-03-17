import { useState } from 'react';
import { motion } from 'framer-motion';
import { Award, Loader2, AlertCircle } from 'lucide-react';
import { Header } from '@/components/Header';
import { Card, CardContent } from '@/components/ui/card';
import { useExemplarIdeas, type ExemplarFilters } from '@/hooks/useExemplarIdeas';
import { ExemplarFiltersBar } from '@/components/exemplars/ExemplarFiltersBar';
import { ExemplarCard } from '@/components/exemplars/ExemplarCard';
import { ExemplarDetailDrawer } from '@/components/exemplars/ExemplarDetailDrawer';
import { ExemplarCompareDrawer } from '@/components/exemplars/ExemplarCompareDrawer';
import { SimilarExemplarsDrawer } from '@/components/exemplars/SimilarExemplarsDrawer';
import type { PitchIdea } from '@/hooks/usePitchIdeas';

export default function ExemplarBrowser() {
  const [filters, setFilters] = useState<ExemplarFilters>({ ciMin: 95, sortBy: 'ci_desc' });
  const { exemplars, isLoading, error } = useExemplarIdeas(filters);

  // Drawer state
  const [detailIdea, setDetailIdea] = useState<PitchIdea | null>(null);
  const [compareExemplar, setCompareExemplar] = useState<PitchIdea | null>(null);
  const [compareSource, setCompareSource] = useState<PitchIdea | null>(null);
  const [similarSource, setSimilarSource] = useState<PitchIdea | null>(null);

  const handleCompare = (exemplar: PitchIdea) => {
    // If we have a detail idea open, compare against it; otherwise set it as source
    if (detailIdea) {
      setCompareSource(detailIdea);
      setCompareExemplar(exemplar);
    } else {
      setCompareExemplar(exemplar);
      setCompareSource(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <motion.main
        className="container py-8 space-y-6"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Title */}
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">
            <Award className="h-7 w-7 text-primary" />
            Exemplar Ideas
          </h1>
          <p className="text-muted-foreground mt-1">
            Browse, search, and benchmark against the highest-performing pitch ideas in your slate.
          </p>
        </div>

        {/* Filters */}
        <ExemplarFiltersBar filters={filters} onChange={setFilters} resultCount={exemplars.length} />

        {/* Error state */}
        {error && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="py-4 flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              Failed to load exemplars. Please try again.
            </CardContent>
          </Card>
        )}

        {/* Loading state */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : exemplars.length === 0 ? (
          /* Empty state */
          <Card className="border-border/30">
            <CardContent className="py-16 text-center text-muted-foreground">
              <Award className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">No exemplar ideas found</p>
              <p className="text-sm mt-1">
                {filters.ciMin && filters.ciMin > 90
                  ? 'Try lowering the CI threshold or removing filters.'
                  : 'Generate some high-scoring pitch ideas first.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          /* Results grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {exemplars.map((idea, i) => (
              <motion.div
                key={idea.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i < 9 ? i * 0.04 : 0 }}
              >
                <ExemplarCard
                  idea={idea}
                  onOpen={setDetailIdea}
                  onCompare={handleCompare}
                  onFindSimilar={setSimilarSource}
                />
              </motion.div>
            ))}
          </div>
        )}
      </motion.main>

      {/* Drawers */}
      <ExemplarDetailDrawer
        open={!!detailIdea}
        onOpenChange={open => { if (!open) setDetailIdea(null); }}
        idea={detailIdea}
        onCompare={exemplar => {
          setCompareSource(detailIdea);
          setCompareExemplar(exemplar);
        }}
        onFindSimilar={idea => {
          setDetailIdea(null);
          setSimilarSource(idea);
        }}
      />

      <ExemplarCompareDrawer
        open={!!compareExemplar}
        onOpenChange={open => { if (!open) { setCompareExemplar(null); setCompareSource(null); } }}
        currentIdea={compareSource}
        exemplar={compareExemplar}
      />

      <SimilarExemplarsDrawer
        open={!!similarSource}
        onOpenChange={open => { if (!open) setSimilarSource(null); }}
        sourceIdea={similarSource}
        onCompare={exemplar => {
          setCompareSource(similarSource);
          setCompareExemplar(exemplar);
          setSimilarSource(null);
        }}
        onOpen={idea => {
          setSimilarSource(null);
          setDetailIdea(idea);
        }}
      />
    </div>
  );
}
