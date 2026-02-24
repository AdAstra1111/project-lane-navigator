/**
 * Trailer Hub — Entry page for the Trailer Intelligence pipeline.
 * Reads ?tab= to mount the correct sub-view directly.
 */
import { lazy, Suspense, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { updateSearchParams } from '@/lib/searchParams';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Clapperboard, Scissors, Music,
  ChevronRight, Sparkles, Archive, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBlueprints } from '@/lib/trailerPipeline/useTrailerPipeline';
import { LegacyBlueprintTab } from '@/components/trailer/cinematic/LegacyBlueprintTab';

const TrailerPipeline = lazy(() => import('./TrailerPipeline'));
const ClipCandidatesStudio = lazy(() => import('./ClipCandidatesStudio'));
const TrailerTimelineStudio = lazy(() => import('./TrailerTimelineStudio'));

const STEPS = [
  {
    step: 1,
    title: 'Trailer Script v2 (Cinematic)',
    description: 'Generate a cinematic trailer script with rhythm grid, shot design, and AI judge scoring.',
    icon: Sparkles,
    cta: 'Open Cinematic Studio',
    tab: 'blueprints',
    enabled: true,
  },
  {
    step: 2,
    title: 'Clip Candidates',
    description: 'Generate 2–3 AI video candidates per beat using Veo or Runway, then select the best.',
    icon: Clapperboard,
    cta: 'Open Clip Studio',
    tab: 'clips',
    enabled: true,
  },
  {
    step: 3,
    title: 'Trailer Assembly',
    description: 'Arrange clips on a timeline, trim, reorder, add text cards, and render the final trailer.',
    icon: Scissors,
    cta: 'Open Timeline Studio',
    tab: 'assemble',
    enabled: true,
  },
  {
    step: 4,
    title: 'Audio & Export',
    description: 'Add music bed, SFX, mix audio, and export the final MP4 with a full deliverables package.',
    icon: Music,
    cta: 'Audio in Timeline Studio',
    tab: 'assemble',
    enabled: true,
  },
];

const LOADING_FALLBACK = (
  <div className="flex items-center justify-center p-12">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
);

const ALLOWED_TABS = new Set(['blueprints', 'clips', 'assemble']);

export default function TrailerHub() {
  const { id: projectId } = useParams<{ id: string }>();
  // ⚠ Do not use setSearchParams({ ... }) — it wipes drawer/drawerTab. Use updateSearchParams().
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const { data: bpListData } = useBlueprints(projectId);
  const hasLegacyBlueprints = (bpListData?.blueprints || []).length > 0;

  // Coerce missing/invalid tab to 'blueprints', preserving all other params
  useEffect(() => {
    if (!tabParam || !ALLOWED_TABS.has(tabParam)) {
      updateSearchParams(setSearchParams, p => p.set('tab', 'blueprints'), { replace: true });
    }
  }, [tabParam, setSearchParams]);

  // If tab param maps to a direct sub-view, render it
  if (tabParam === 'blueprints') {
    return (
      <Suspense fallback={LOADING_FALLBACK}>
        <TrailerPipeline />
      </Suspense>
    );
  }
  if (tabParam === 'clips') {
    return (
      <Suspense fallback={LOADING_FALLBACK}>
        <ClipCandidatesStudio />
      </Suspense>
    );
  }
  if (tabParam === 'assemble') {
    return (
      <Suspense fallback={LOADING_FALLBACK}>
        <TrailerTimelineStudio />
      </Suspense>
    );
  }

  // Default: show hub overview
  return (
    <div className="max-w-[1000px] mx-auto px-4 py-6">
      <Tabs defaultValue="cinematic">
        <TabsList className="mb-3">
          <TabsTrigger value="cinematic" className="text-xs gap-1.5">
            <Sparkles className="h-3 w-3" /> Pipeline
          </TabsTrigger>
          {hasLegacyBlueprints && (
            <TabsTrigger value="legacy" className="text-xs gap-1.5 text-muted-foreground">
              <Archive className="h-3 w-3" /> v1 Blueprints
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="cinematic">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-px rounded-md border border-border/15 overflow-hidden"
          >
            {STEPS.map((step, idx) => (
              <button
                key={step.step}
                className={`w-full text-left flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-muted/25 cursor-pointer${idx < STEPS.length - 1 ? ' border-b border-border/10' : ''}`}
                onClick={() => updateSearchParams(setSearchParams, p => p.set('tab', step.tab))}
              >
                <span className="flex-shrink-0 text-[11px] font-medium text-muted-foreground/50 w-4 text-right tabular-nums">
                  {step.step}
                </span>
                <step.icon className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground/90">{step.title}</p>
                  <p className="text-[11px] text-muted-foreground/70 line-clamp-1 max-w-md">{step.description}</p>
                </div>
                <span className="flex items-center text-[11px] text-muted-foreground hover:text-foreground/80 gap-0.5 flex-shrink-0 transition-colors">
                  {step.cta}
                  <ChevronRight className="h-3 w-3" />
                </span>
              </button>
            ))}
          </motion.div>
        </TabsContent>

        {hasLegacyBlueprints && (
          <TabsContent value="legacy">
            <LegacyBlueprintTab projectId={projectId!} />
          </TabsContent>
        )}
      </Tabs>

      <Separator className="my-6" />
      <div className="flex flex-wrap gap-2">
        <Link to={`/projects/${projectId}/visual-dev`}>
          <Button variant="outline" size="sm" className="text-xs gap-1.5">
            <ArrowLeft className="h-3 w-3" /> Visual Dev Hub
          </Button>
        </Link>
        <Link to={`/projects/${projectId}/storyboard-pipeline`}>
          <Button variant="outline" size="sm" className="text-xs gap-1.5">Storyboard Pipeline</Button>
        </Link>
        <Link to={`/projects/${projectId}/visual-units`}>
          <Button variant="outline" size="sm" className="text-xs gap-1.5">Visual Units</Button>
        </Link>
      </div>
    </div>
  );
}
