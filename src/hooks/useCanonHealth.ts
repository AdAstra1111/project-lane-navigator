/**
 * useCanonHealth — Derives deterministic canon completeness from real DB data.
 * Consumes: useProjectCanon, useCanonLocations, useProject, project_images.
 * Returns section-level health status for the Canon Control Layer.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProjectCanon, type CanonJson } from '@/hooks/useProjectCanon';
import { useCanonLocations } from '@/hooks/useCanonLocations';
import { useProject } from '@/hooks/useProjects';

export type CanonSectionStatus = 'complete' | 'partial' | 'missing';

export interface CanonSectionHealth {
  key: string;
  label: string;
  status: CanonSectionStatus;
  summary: string;
}

export interface VisualAlignmentStats {
  charactersDefined: number;
  charactersLinked: number;
  locationsDefined: number;
  locationsLinked: number;
}

export interface CanonHealthResult {
  sections: CanonSectionHealth[];
  overallStatus: CanonSectionStatus;
  stats: {
    characterCount: number;
    locationCount: number;
    toneDefined: boolean;
    formatDefined: boolean;
  };
  visualAlignment: VisualAlignmentStats;
  canon: CanonJson;
  isLoading: boolean;
}

function hasContent(v: unknown): boolean {
  if (!v) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return false;
}

function deriveCharacterSection(canon: CanonJson, linkedCount: number): CanonSectionHealth {
  const chars = canon.characters || [];
  const named = chars.filter(c => c.name && c.name.trim().length > 0);
  if (named.length === 0) {
    return { key: 'characters', label: 'Characters', status: 'missing', summary: 'No canonical characters defined' };
  }
  const hasRoles = named.some(c => c.role && c.role.trim().length > 0);
  const hasTraits = named.some(c => c.traits && c.traits.trim().length > 0);
  if (hasRoles && hasTraits) {
    const linkedNote = linkedCount > 0 ? `, ${linkedCount} with linked visual identity` : '';
    return { key: 'characters', label: 'Characters', status: 'complete', summary: `${named.length} named character${named.length !== 1 ? 's' : ''} with roles and traits${linkedNote}` };
  }
  return { key: 'characters', label: 'Characters', status: 'partial', summary: `${named.length} named character${named.length !== 1 ? 's' : ''} found, some missing roles or traits` };
}

function deriveWorldSection(canon: CanonJson, locationCount: number, locationsLinked: number): CanonSectionHealth {
  const hasWorldRules = hasContent(canon.world_rules);
  const hasLocations = hasContent(canon.locations) || locationCount > 0;
  if (!hasWorldRules && !hasLocations) {
    return { key: 'world', label: 'World & Locations', status: 'missing', summary: 'No world description or locations defined' };
  }
  const parts: string[] = [];
  if (hasWorldRules) parts.push('world description present');
  if (locationCount > 0) {
    parts.push(`${locationCount} key location${locationCount !== 1 ? 's' : ''}`);
    if (locationsLinked > 0) parts.push(`${locationsLinked} with visuals`);
  } else if (hasContent(canon.locations)) {
    parts.push('location data present');
  }
  const allPresent = hasWorldRules && (locationCount > 0 || hasContent(canon.locations));
  return { key: 'world', label: 'World & Locations', status: allPresent ? 'complete' : 'partial', summary: parts.join(', ') };
}

function deriveToneSection(canon: CanonJson, projectTone: string | null, genres: string[] | null): CanonSectionHealth {
  const hasToneStyle = hasContent(canon.tone_style);
  const hasTone = hasToneStyle || (!!projectTone && projectTone.trim().length > 0);
  const hasGenres = !!genres && genres.length > 0;
  if (!hasTone && !hasGenres) {
    return { key: 'tone', label: 'Tone & Style', status: 'missing', summary: 'No tone or genre information defined' };
  }
  const parts: string[] = [];
  if (hasGenres) parts.push(`Genre: ${genres!.join(', ')}`);
  if (hasToneStyle) parts.push('tone & style notes present');
  else if (hasTone) parts.push(`Tone: ${projectTone}`);
  return { key: 'tone', label: 'Tone & Style', status: (hasTone && hasGenres) ? 'complete' : 'partial', summary: parts.join(' · ') };
}

function deriveFormatSection(canon: CanonJson, projectFormat: string | null, assignedLane: string | null): CanonSectionHealth {
  const hasConstraints = hasContent(canon.format_constraints);
  const hasFormat = !!projectFormat && projectFormat.trim().length > 0;
  const hasLane = !!assignedLane && assignedLane.trim().length > 0;
  if (!hasConstraints && !hasFormat && !hasLane) {
    return { key: 'format', label: 'Format & Constraints', status: 'missing', summary: 'No format, lane, or constraint data' };
  }
  const parts: string[] = [];
  if (hasFormat) parts.push(`Format: ${projectFormat}`);
  if (hasLane) parts.push(`Lane: ${assignedLane}`);
  if (hasConstraints) parts.push('constraints defined');
  return { key: 'format', label: 'Format & Constraints', status: (hasFormat || hasLane) ? 'complete' : 'partial', summary: parts.join(' · ') };
}

function derivePremiseSection(canon: CanonJson): CanonSectionHealth {
  const hasLogline = hasContent(canon.logline);
  const hasPremise = hasContent(canon.premise);
  if (!hasLogline && !hasPremise) {
    return { key: 'premise', label: 'Premise / Core Story', status: 'missing', summary: 'No logline or premise defined' };
  }
  const parts: string[] = [];
  if (hasLogline) parts.push('logline present');
  if (hasPremise) parts.push('premise present');
  const hasOngoing = hasContent(canon.ongoing_threads);
  if (hasOngoing) parts.push('ongoing threads tracked');
  return { key: 'premise', label: 'Premise / Core Story', status: (hasLogline && hasPremise) ? 'complete' : 'partial', summary: parts.join(', ') };
}

export function useCanonHealth(projectId: string | undefined): CanonHealthResult {
  const { canon, isLoading: canonLoading } = useProjectCanon(projectId);
  const { locations, isLoading: locLoading } = useCanonLocations(projectId);
  const { project, isLoading: projLoading } = useProject(projectId);

  // Fetch visual alignment stats from project_images
  const { data: visualStats, isLoading: visualLoading } = useQuery({
    queryKey: ['canon-visual-alignment', projectId],
    queryFn: async () => {
      if (!projectId) return { charLinked: 0, locLinked: 0 };

      // Character images: count distinct subjects with is_primary=true and asset_group=character
      const { data: charImages } = await (supabase as any)
        .from('project_images')
        .select('subject')
        .eq('project_id', projectId)
        .eq('asset_group', 'character')
        .eq('is_primary', true)
        .eq('curation_state', 'active');

      const charSubjects = new Set((charImages || []).map((i: any) => i.subject).filter(Boolean));

      // Location images: count distinct canon_location_id or subject_ref with primary
      const { data: locImages } = await (supabase as any)
        .from('project_images')
        .select('subject_ref, canon_location_id')
        .eq('project_id', projectId)
        .eq('asset_group', 'world')
        .eq('is_primary', true)
        .eq('curation_state', 'active');

      const locRefs = new Set(
        (locImages || []).map((i: any) => i.canon_location_id || i.subject_ref).filter(Boolean)
      );

      return { charLinked: charSubjects.size, locLinked: locRefs.size };
    },
    enabled: !!projectId,
    staleTime: 15_000,
  });

  const isLoading = canonLoading || locLoading || projLoading || visualLoading;

  const characterCount = (canon.characters || []).filter(c => c.name?.trim()).length;
  const locationCount = locations.length;
  const toneDefined = hasContent(canon.tone_style) || !!(project as any)?.tone;
  const formatDefined = !!(project as any)?.format || hasContent(canon.format_constraints);

  const charLinked = visualStats?.charLinked ?? 0;
  const locLinked = visualStats?.locLinked ?? 0;

  const charSection = deriveCharacterSection(canon, charLinked);
  const worldSection = deriveWorldSection(canon, locationCount, locLinked);
  const toneSection = deriveToneSection(canon, (project as any)?.tone ?? null, (project as any)?.genres ?? null);
  const formatSection = deriveFormatSection(canon, (project as any)?.format ?? null, (project as any)?.assigned_lane ?? null);
  const premiseSection = derivePremiseSection(canon);

  // Visual alignment section
  const visualAlignmentSection: CanonSectionHealth = (() => {
    if (characterCount === 0 && locationCount === 0) {
      return { key: 'visual', label: 'Visual Canon Alignment', status: 'missing' as const, summary: 'No canon entities to align visuals against' };
    }
    const parts: string[] = [];
    if (characterCount > 0) parts.push(`Characters linked: ${charLinked} / ${characterCount}`);
    if (locationCount > 0) parts.push(`Locations linked: ${locLinked} / ${locationCount}`);
    const totalDefined = characterCount + locationCount;
    const totalLinked = charLinked + locLinked;
    const status: CanonSectionStatus = totalLinked >= totalDefined && totalDefined > 0
      ? 'complete'
      : totalLinked > 0 ? 'partial' : 'missing';
    return { key: 'visual', label: 'Visual Canon Alignment', status, summary: parts.join(' · ') };
  })();

  const sections = [premiseSection, charSection, worldSection, toneSection, formatSection, visualAlignmentSection];

  const overallStatus: CanonSectionStatus = (() => {
    const statuses = sections.map(s => s.status);
    if (statuses.every(s => s === 'complete')) return 'complete';
    if (statuses.every(s => s === 'missing')) return 'missing';
    return 'partial';
  })();

  return {
    sections,
    overallStatus,
    stats: { characterCount, locationCount, toneDefined, formatDefined },
    visualAlignment: {
      charactersDefined: characterCount,
      charactersLinked: charLinked,
      locationsDefined: locationCount,
      locationsLinked: locLinked,
    },
    canon,
    isLoading,
  };
}
