/**
 * Canon Control Layer — The canonical source of truth workspace.
 * Surfaces real project canon state, completeness, and visual alignment.
 * DB-driven, deterministic status derivation, no placeholder content.
 */
import { useParams, Link } from 'react-router-dom';
import {
  BookOpen, Users, Globe, Palette, Film, FileText, Eye,
  ChevronDown, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useCanonHealth, type CanonSectionStatus } from '@/hooks/useCanonHealth';
import { useCanonLocations } from '@/hooks/useCanonLocations';
import { useProject } from '@/hooks/useProjects';
import { useCanonicalState } from '@/hooks/useCanonicalState';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/* ── Status helpers ── */

const STATUS_CONFIG: Record<CanonSectionStatus, { icon: typeof CheckCircle2; color: string; label: string }> = {
  complete: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Complete' },
  partial:  { icon: AlertTriangle, color: 'text-amber-400', label: 'Partial' },
  missing:  { icon: XCircle, color: 'text-muted-foreground/60', label: 'Missing' },
};

function StatusBadge({ status }: { status: CanonSectionStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 text-xs font-medium ${cfg.color} border-border/40`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

const SECTION_ICONS: Record<string, typeof BookOpen> = {
  premise: FileText,
  characters: Users,
  world: Globe,
  tone: Palette,
  format: Film,
  visual: Eye,
};
 
/* ── Canon text normalizer ── */
function normalizeCanonText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join('\n');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  if (value == null) return '';
  return String(value).trim();
}

/* ── Section content renderers ── */

function PremiseContent({ canon }: { canon: any }) {
  const hasLogline = normalizeCanonText(canon.logline);
  const hasPremise = normalizeCanonText(canon.premise);
  const hasThreads = normalizeCanonText(canon.ongoing_threads);
  if (!hasLogline && !hasPremise) {
    return <p className="text-sm text-muted-foreground/70 italic">No logline or premise has been defined for this project.</p>;
  }
  return (
    <div className="space-y-3">
      {hasLogline && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Logline</h4>
          <p className="text-sm text-foreground/90 leading-relaxed">{normalizeCanonText(canon.logline)}</p>
        </div>
      )}
      {hasPremise && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Premise</h4>
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{canon.premise}</p>
        </div>
      )}
      {hasThreads && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Ongoing Threads</h4>
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{canon.ongoing_threads}</p>
        </div>
      )}
    </div>
  );
}

function CharactersContent({ canon, linkedCount }: { canon: any; linkedCount: number }) {
  const chars = (canon.characters || []).filter((c: any) => c.name?.trim());
  if (chars.length === 0) {
    return <p className="text-sm text-muted-foreground/70 italic">No canonical characters found. Define characters in the Canon Editor.</p>;
  }
  return (
    <div className="grid gap-2">
      {chars.map((c: any, i: number) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border border-border/30 bg-muted/20 px-3 py-2.5">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Users className="h-4 w-4 text-primary/70" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">{c.name}</span>
              {c.role && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/30 text-muted-foreground">{c.role}</Badge>}
            </div>
            {c.traits && <p className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-1">{c.traits}</p>}
            {c.goals && <p className="text-xs text-muted-foreground/60 mt-0.5 line-clamp-1">Goals: {c.goals}</p>}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground/50 mt-1">{linkedCount} of {chars.length} with linked visual identity</p>
    </div>
  );
}

function WorldContent({ canon, locations }: { canon: any; locations: any[] }) {
  const hasWorldRules = canon.world_rules?.trim();
  const hasTimeline = canon.timeline?.trim();

  return (
    <div className="space-y-3">
      {hasWorldRules && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">World Rules</h4>
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{canon.world_rules}</p>
        </div>
      )}
      {hasTimeline && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Timeline</h4>
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{canon.timeline}</p>
        </div>
      )}
      {locations.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Key Locations ({locations.length})</h4>
          <div className="grid gap-1.5">
            {locations.slice(0, 12).map(loc => (
              <div key={loc.id} className="flex items-center gap-2 text-sm rounded border border-border/20 bg-muted/10 px-2.5 py-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                <span className="text-foreground/90 truncate">{loc.canonical_name}</span>
                <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto border-border/20 text-muted-foreground/60">{loc.story_importance}</Badge>
              </div>
            ))}
          </div>
        </div>
      ) : (
        !hasWorldRules && <p className="text-sm text-muted-foreground/70 italic">No world description or locations defined.</p>
      )}
    </div>
  );
}

function ToneContent({ canon, project }: { canon: any; project: any }) {
  const genres = project?.genres as string[] | null;
  const tone = canon.tone_style?.trim() || project?.tone;
  if (!tone && (!genres || genres.length === 0)) {
    return <p className="text-sm text-muted-foreground/70 italic">No tone or genre information defined.</p>;
  }
  return (
    <div className="space-y-3">
      {genres && genres.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Genres</h4>
          <div className="flex flex-wrap gap-1.5">
            {genres.map((g: string) => (
              <Badge key={g} variant="secondary" className="text-xs">{g}</Badge>
            ))}
          </div>
        </div>
      )}
      {tone && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Tone & Style</h4>
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{typeof tone === 'string' ? tone : JSON.stringify(tone)}</p>
        </div>
      )}
      {project?.assigned_lane && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Visual Lane</h4>
          <Badge variant="outline" className="text-xs">{project.assigned_lane}</Badge>
        </div>
      )}
    </div>
  );
}

function FormatContent({ canon, project }: { canon: any; project: any }) {
  const hasConstraints = canon.format_constraints?.trim();
  const hasForbidden = canon.forbidden_changes?.trim();
  const format = project?.format;
  const lane = project?.assigned_lane;
  if (!hasConstraints && !format && !lane && !hasForbidden) {
    return <p className="text-sm text-muted-foreground/70 italic">No format, lane, or constraint data defined.</p>;
  }
  return (
    <div className="space-y-3">
      {format && (
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Format:</h4>
          <span className="text-sm text-foreground/90">{format}</span>
        </div>
      )}
      {lane && (
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lane:</h4>
          <Badge variant="outline" className="text-xs">{lane}</Badge>
        </div>
      )}
      {hasConstraints && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Format Constraints</h4>
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{canon.format_constraints}</p>
        </div>
      )}
      {hasForbidden && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Forbidden Changes</h4>
          <p className="text-sm text-destructive/80 leading-relaxed whitespace-pre-wrap">{canon.forbidden_changes}</p>
        </div>
      )}
    </div>
  );
}

function VisualAlignmentContent({ alignment }: { alignment: { charactersDefined: number; charactersLinked: number; locationsDefined: number; locationsLinked: number } }) {
  const { charactersDefined, charactersLinked, locationsDefined, locationsLinked } = alignment;
  if (charactersDefined === 0 && locationsDefined === 0) {
    return <p className="text-sm text-muted-foreground/70 italic">No canon entities to align visuals against. Define characters or locations first.</p>;
  }
  return (
    <div className="space-y-2">
      {charactersDefined > 0 && (
        <div className="flex items-center justify-between rounded border border-border/20 bg-muted/10 px-3 py-2">
          <span className="text-sm text-foreground/90">Character identities linked</span>
          <span className="text-sm font-medium text-foreground">{charactersLinked} / {charactersDefined}</span>
        </div>
      )}
      {locationsDefined > 0 && (
        <div className="flex items-center justify-between rounded border border-border/20 bg-muted/10 px-3 py-2">
          <span className="text-sm text-foreground/90">Location visuals linked</span>
          <span className="text-sm font-medium text-foreground">{locationsLinked} / {locationsDefined}</span>
        </div>
      )}
      {(charactersDefined - charactersLinked + locationsDefined - locationsLinked) > 0 && (
        <p className="text-xs text-amber-400/80 mt-1">
          {charactersDefined - charactersLinked + locationsDefined - locationsLinked} visual slot{(charactersDefined - charactersLinked + locationsDefined - locationsLinked) !== 1 ? 's' : ''} missing coverage
        </p>
      )}
    </div>
  );
}

/* ── Section content dispatcher ── */
function SectionContent({ sectionKey, canon, locations, project, visualAlignment, charLinked }: {
  sectionKey: string;
  canon: any;
  locations: any[];
  project: any;
  visualAlignment: any;
  charLinked: number;
}) {
  switch (sectionKey) {
    case 'premise': return <PremiseContent canon={canon} />;
    case 'characters': return <CharactersContent canon={canon} linkedCount={charLinked} />;
    case 'world': return <WorldContent canon={canon} locations={locations} />;
    case 'tone': return <ToneContent canon={canon} project={project} />;
    case 'format': return <FormatContent canon={canon} project={project} />;
    case 'visual': return <VisualAlignmentContent alignment={visualAlignment} />;
    default: return null;
  }
}

/* ── Main page ── */

export default function CanonControlLayer() {
  const { id: projectId } = useParams<{ id: string }>();
  const { sections, overallStatus, stats, visualAlignment, canon, isLoading } = useCanonHealth(projectId);
  const { locations } = useCanonLocations(projectId);
  const { project } = useProject(projectId);
  const { sourceLabel, refetch: refetchCanonState } = useCanonicalState(projectId);
  const qc = useQueryClient();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    premise: true, characters: true, world: true, tone: false, format: false, visual: true,
  });

  const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['project-canon', projectId] });
    qc.invalidateQueries({ queryKey: ['canon-locations', projectId] });
    qc.invalidateQueries({ queryKey: ['canon-visual-alignment', projectId] });
    refetchCanonState();
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto pb-20">
      {/* ── Header / Status Strip ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-display font-semibold text-foreground truncate">Project Canon</h1>
              <p className="text-xs text-muted-foreground/70 truncate">Source: {sourceLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={overallStatus} />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground/60 leading-relaxed">
          The canonical source of truth for characters, world, format, tone, and downstream visual alignment.
        </p>

        {/* ── Stats Chips ── */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="text-xs border-border/30 text-muted-foreground gap-1">
            <Users className="h-3 w-3" /> Characters: {stats.characterCount}
          </Badge>
          <Badge variant="outline" className="text-xs border-border/30 text-muted-foreground gap-1">
            <Globe className="h-3 w-3" /> Locations: {stats.locationCount}
          </Badge>
          <Badge variant="outline" className={`text-xs border-border/30 gap-1 ${stats.toneDefined ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
            <Palette className="h-3 w-3" /> Tone: {stats.toneDefined ? 'Yes' : 'No'}
          </Badge>
          <Badge variant="outline" className={`text-xs border-border/30 gap-1 ${stats.formatDefined ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
            <Film className="h-3 w-3" /> Format: {stats.formatDefined ? 'Yes' : 'No'}
          </Badge>
          {(visualAlignment.charactersDefined > 0 || visualAlignment.locationsDefined > 0) && (
            <Badge variant="outline" className="text-xs border-border/30 text-muted-foreground gap-1">
              <Eye className="h-3 w-3" /> Visual: {visualAlignment.charactersLinked + visualAlignment.locationsLinked} / {visualAlignment.charactersDefined + visualAlignment.locationsDefined} linked
            </Badge>
          )}
        </div>
      </div>

      {/* ── Canon Health Card ── */}
      <Card className="border-border/30 bg-card/50">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Canon Readiness</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-1.5">
            {sections.map(s => (
              <div key={s.key} className="flex items-center gap-3 rounded-md px-2.5 py-2 hover:bg-muted/20 transition-colors">
                <StatusBadge status={s.status} />
                <span className="text-sm font-medium text-foreground/90 w-36 flex-shrink-0">{s.label}</span>
                <span className="text-xs text-muted-foreground/70 truncate">{s.summary}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Collapsible Canon Sections ── */}
      {sections.map(section => {
        const Icon = SECTION_ICONS[section.key] || BookOpen;
        const isOpen = openSections[section.key] ?? false;
        return (
          <Collapsible key={section.key} open={isOpen} onOpenChange={() => toggleSection(section.key)}>
            <Card className="border-border/30 bg-card/50 overflow-hidden">
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left">
                  <Icon className="h-4 w-4 text-muted-foreground/70 flex-shrink-0" />
                  <span className="text-sm font-medium text-foreground flex-1">{section.label}</span>
                  <StatusBadge status={section.status} />
                  <ChevronDown className={`h-4 w-4 text-muted-foreground/50 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 pt-1 border-t border-border/20">
                  <SectionContent
                    sectionKey={section.key}
                    canon={canon}
                    locations={locations}
                    project={project}
                    visualAlignment={visualAlignment}
                    charLinked={visualAlignment.charactersLinked}
                  />
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })}

      {/* ── Actions ── */}
      {projectId && (
        <div className="flex flex-wrap gap-2 pt-2">
          <Link to={`/projects/${projectId}/visual-dev`}>
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Visual Workspace
            </Button>
          </Link>
          <Link to={`/projects/${projectId}/lookbook`}>
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              <BookOpen className="h-3.5 w-3.5" /> Look Book
            </Button>
          </Link>
          <Link to={`/projects/${projectId}/script`}>
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Canon Editor
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
