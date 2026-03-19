/**
 * Visual Production Hub — Primary operational workspace for all image work.
 * Cast photos, character identity, world references, visual canon, approval, and archive.
 */
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Clapperboard, Image, Film,
  Play, Layers, ChevronRight, ChevronDown, Users, Globe, RotateCcw, Palette, Grid3X3, BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { CharacterBaseLookPanel } from '@/components/images/CharacterBaseLookPanel';
import { WorldLocationLookPanel } from '@/components/images/WorldLocationLookPanel';
import { VisualCanonResetPanel } from '@/components/images/VisualCanonResetPanel';
import { VisualChangeStudio } from '@/components/images/VisualChangeStudio';
import { VisualSetCurationPanel } from '@/components/images/VisualSetCurationPanel';
import { StoryIngestionPanel } from '@/components/project/StoryIngestionPanel';
import { supabase } from '@/integrations/supabase/client';

const PRODUCTION_TOOLS = [
  {
    title: 'Visual Units',
    description: 'Canonical visual units extracted from your script.',
    icon: Layers,
    cta: 'Review Visual Units',
    href: (id: string) => `/projects/${id}/visual-units`,
  },
  {
    title: 'Shot Lists',
    description: 'AI-generated shot plans per scene.',
    icon: Clapperboard,
    cta: 'View Shot Lists',
    href: (id: string) => `/projects/${id}/shot-list`,
  },
  {
    title: 'Storyboard Pipeline',
    description: 'Render storyboard frames and export contact sheets.',
    icon: Image,
    cta: 'Open Storyboard Pipeline',
    href: (id: string) => `/projects/${id}/storyboard-pipeline`,
  },
  {
    title: 'Storyboard Viewer',
    description: 'Browse rendered panels with animatic preview.',
    icon: Play,
    cta: 'View Storyboards',
    href: (id: string) => `/projects/${id}/storyboards`,
  },
  {
    title: 'Trailer Intelligence',
    description: 'Blueprint → Clips → Assembly for pitch trailers.',
    icon: Film,
    cta: 'Open Trailer Hub',
    href: (id: string) => `/projects/${id}/visual-dev/trailer`,
    badge: 'New',
  },
];

function WorkSection({
  icon,
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full">
        <div className={cn(
          'flex items-center justify-between w-full px-4 py-3 rounded-lg border transition-colors',
          open ? 'bg-card border-border' : 'bg-card/30 border-border/50 hover:bg-card/60',
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex items-center justify-center h-8 w-8 rounded-md',
              open ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {icon}
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-[11px] text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <ChevronDown className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-3 pb-1 px-1">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function VisualDevHub() {
  const { id: projectId } = useParams<{ id: string }>();
  const [characters, setCharacters] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);

  // Load canon data for Change Studio targets
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('project_canon')
        .select('canon_json')
        .eq('project_id', projectId)
        .maybeSingle();
      if (data?.canon_json) {
        const canon = data.canon_json;
        if (Array.isArray(canon.characters)) {
          setCharacters(canon.characters.map((c: any) =>
            typeof c === 'string' ? c : (c.name || c.character_name || '')).filter(Boolean));
        }
        if (Array.isArray(canon.locations)) {
          setLocations(canon.locations.map((l: any) =>
            typeof l === 'string' ? l : (l.name || l.location_name || '')).filter(Boolean));
        }
      }
    })();
  }, [projectId]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={`/projects/${projectId}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold">Visual Production Hub</h1>
            <p className="text-xs text-muted-foreground">
              Cast photos, character identity, world references, visual canon management.
            </p>
          </div>
        </div>
      </header>

        <main className="max-w-[1200px] mx-auto px-4 py-6 space-y-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* ═══ STORY INGESTION ═══ */}
          <WorkSection
            icon={<BookOpen className="h-4 w-4" />}
            title="Story Ingestion Engine"
            subtitle="Parse script into scenes, characters, locations, props, and state variants"
            defaultOpen={false}
          >
            {projectId && <StoryIngestionPanel projectId={projectId} />}
          </WorkSection>

          {/* ═══ PRIMARY: Cast Photos & Identity ═══ */}
          <WorkSection
            icon={<Users className="h-4 w-4" />}
            title="Cast Photos & Identity"
            subtitle="Headshots, profile views, full-body anchors, and continuity lock"
            defaultOpen={true}
          >
            {projectId && <CharacterBaseLookPanel projectId={projectId} />}
          </WorkSection>

          {/* ═══ World & Location References ═══ */}
          <WorkSection
            icon={<Globe className="h-4 w-4" />}
            title="World & Location References"
            subtitle="Establishing shots, atmospheric details, environmental storytelling"
            defaultOpen={false}
          >
            {projectId && <WorldLocationLookPanel projectId={projectId} />}
          </WorkSection>

          {/* ═══ Visual Canon Reset & Rebuild ═══ */}
          <WorkSection
            icon={<RotateCcw className="h-4 w-4" />}
            title="Visual Canon Reset & Rebuild"
            subtitle="Reset active canon, review required slots, approve or archive"
            defaultOpen={false}
          >
            {projectId && <VisualCanonResetPanel projectId={projectId} />}
          </WorkSection>

          {/* ═══ Visual Change Studio ═══ */}
          <WorkSection
            icon={<Palette className="h-4 w-4" />}
            title="Visual Change Studio"
            subtitle="What-if scenarios — explore visual changes without mutating canon"
            defaultOpen={false}
          >
            {projectId && (
              <VisualChangeStudio
                projectId={projectId}
                characters={characters}
                locations={locations}
              />
            )}
          </WorkSection>

          {/* ═══ Visual Set Curation ═══ */}
          <WorkSection
            icon={<Grid3X3 className="h-4 w-4" />}
            title="Visual Set Curation"
            subtitle="Slot-based curation loop — approve, replace, lock canonical output sets"
            defaultOpen={false}
          >
            {projectId && <VisualSetCurationPanel projectId={projectId} />}
          </WorkSection>

          {/* ═══ Production Tools ═══ */}
          <div className="pt-4 border-t border-border/30">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">
              Production Tools
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {PRODUCTION_TOOLS.map((tool) => (
                <Link key={tool.title} to={tool.href(projectId!)}>
                  <Card className="h-full transition-all hover:shadow-md hover:border-primary/30 cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <tool.icon className="h-4 w-4 text-primary" />
                        <CardTitle className="text-sm">{tool.title}</CardTitle>
                        {tool.badge && (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                            {tool.badge}
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="text-xs leading-relaxed">
                        {tool.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center text-xs text-primary font-medium gap-1">
                        {tool.cta}
                        <ChevronRight className="h-3 w-3" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
