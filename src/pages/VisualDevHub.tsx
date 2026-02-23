/**
 * Visual Dev Hub — Central page for all visual development tools.
 */
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Clapperboard, Image, Film, Download,
  Play, Sparkles, Layers, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const SECTIONS = [
  {
    title: 'Visual Units',
    description: 'Canonical visual unit library extracted from your script — the foundation for storyboards and trailers.',
    icon: Layers,
    cta: 'Review Visual Units',
    href: (id: string) => `/projects/${id}/visual-units`,
    badge: 'Canonical',
  },
  {
    title: 'Shot Lists',
    description: 'AI-generated shot plans per scene with coverage, framing, and movement direction.',
    icon: Clapperboard,
    cta: 'View Shot Lists',
    href: (id: string) => `/projects/${id}/shot-list`,
  },
  {
    title: 'Storyboard Pipeline',
    description: 'Render storyboard frames from visual units, manage render queues, and export contact sheets.',
    icon: Image,
    cta: 'Open Storyboard Pipeline',
    href: (id: string) => `/projects/${id}/storyboard-pipeline`,
  },
  {
    title: 'Storyboard Viewer',
    description: 'Browse rendered storyboard panels in strip or grid view, with animatic preview.',
    icon: Play,
    cta: 'View Storyboards',
    href: (id: string) => `/projects/${id}/storyboards`,
  },
  {
    title: 'Trailer Intelligence',
    description: 'Blueprint → Clips → Assembly pipeline for AI-generated pitch trailers.',
    icon: Film,
    cta: 'Open Trailer Hub',
    href: (id: string) => `/projects/${id}/visual-dev/trailer`,
    highlight: true,
    badge: 'New',
  },
];

export default function VisualDevHub() {
  const { id: projectId } = useParams<{ id: string }>();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={`/projects/${projectId}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold">Visual Development</h1>
            <p className="text-xs text-muted-foreground">
              Visual Units → Storyboards → Animatic → Trailer Intelligence
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {SECTIONS.map((section) => (
            <Link key={section.title} to={section.href(projectId!)}>
              <Card className={`h-full transition-all hover:shadow-md hover:border-primary/30 cursor-pointer ${section.highlight ? 'border-primary/40 bg-primary/5' : ''}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <section.icon className="h-5 w-5 text-primary" />
                    <CardTitle className="text-sm">{section.title}</CardTitle>
                    {section.badge && (
                      <Badge variant={section.highlight ? 'default' : 'secondary'} className="text-[9px] h-4 px-1.5">
                        {section.badge}
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs leading-relaxed">
                    {section.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center text-xs text-primary font-medium gap-1">
                    {section.cta}
                    <ChevronRight className="h-3 w-3" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </motion.div>
      </main>
    </div>
  );
}
