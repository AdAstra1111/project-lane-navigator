/**
 * Trailer Hub — Entry page for the Trailer Intelligence pipeline.
 * Blueprint → Clips → Assembly
 */
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Film, Clapperboard, Scissors, Music,
  ChevronRight, CheckCircle2, Circle, ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const STEPS = [
  {
    step: 1,
    title: 'Trailer Blueprint',
    description: 'Generate an arc-driven blueprint with beats, segments, and timing targets from your script.',
    icon: Film,
    cta: 'Open Blueprint Studio',
    href: (id: string) => `/projects/${id}/trailer-pipeline`,
    enabled: true,
  },
  {
    step: 2,
    title: 'Clip Candidates',
    description: 'Generate 2–3 AI video candidates per beat using Veo or Runway, then select the best.',
    icon: Clapperboard,
    cta: 'Open Clip Studio',
    href: (id: string) => `/projects/${id}/trailer-clips`,
    enabled: true,
  },
  {
    step: 3,
    title: 'Trailer Assembly',
    description: 'Arrange clips on a timeline, trim, reorder, add text cards, and render the final trailer.',
    icon: Scissors,
    cta: 'Open Timeline Studio',
    href: (id: string) => `/projects/${id}/trailer-assemble`,
    enabled: true,
  },
  {
    step: 4,
    title: 'Audio & Export',
    description: 'Add music bed, SFX, mix audio, and export the final MP4 with a full deliverables package.',
    icon: Music,
    cta: 'Audio in Timeline Studio',
    href: (id: string) => `/projects/${id}/trailer-assemble`,
    enabled: true,
  },
];

export default function TrailerHub() {
  const { id: projectId } = useParams<{ id: string }>();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1000px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={`/projects/${projectId}/visual-dev`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Film className="h-5 w-5 text-primary" />
              Trailer Intelligence
            </h1>
            <p className="text-xs text-muted-foreground">
              Blueprint → Clips → Assembly → Export
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-[1000px] mx-auto px-4 py-6">
        {/* Pipeline steps */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          {STEPS.map((step, idx) => (
            <div key={step.step}>
              <Link to={step.href(projectId!)}>
                <Card className="transition-all hover:shadow-md hover:border-primary/30 cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-4">
                    {/* Step number */}
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                      {step.step}
                    </div>

                    {/* Icon */}
                    <step.icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{step.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {step.description}
                      </p>
                    </div>

                    {/* CTA */}
                    <div className="flex items-center text-xs text-primary font-medium gap-1 flex-shrink-0">
                      {step.cta}
                      <ChevronRight className="h-3 w-3" />
                    </div>
                  </CardContent>
                </Card>
              </Link>

              {idx < STEPS.length - 1 && (
                <div className="flex justify-center py-1">
                  <ArrowRight className="h-3 w-3 text-muted-foreground/40 rotate-90" />
                </div>
              )}
            </div>
          ))}
        </motion.div>

        {/* Quick links */}
        <Separator className="my-6" />
        <div className="flex flex-wrap gap-2">
          <Link to={`/projects/${projectId}/visual-dev`}>
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              <ArrowLeft className="h-3 w-3" />
              Visual Dev Hub
            </Button>
          </Link>
          <Link to={`/projects/${projectId}/storyboard-pipeline`}>
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              Storyboard Pipeline
            </Button>
          </Link>
          <Link to={`/projects/${projectId}/visual-units`}>
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              Visual Units
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
