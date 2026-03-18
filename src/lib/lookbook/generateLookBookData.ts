/**
 * generateLookBookData — Assembles Look Book slides from canonical project state.
 * Uses getCanonicalProjectState for authoritative content sourcing.
 * Runs client-side, pulling from Supabase.
 */
import { supabase } from '@/integrations/supabase/client';
import { getCanonicalProjectState } from '@/lib/canon/getCanonicalProjectState';
import type { LookBookData, LookBookVisualIdentity, SlideContent, LookBookColorSystem } from './types';

// ── Color palettes by tone/genre ──
const COLOR_PALETTES: Record<string, LookBookColorSystem> = {
  dark: {
    bg: '#0A0A0F', bgSecondary: '#131318',
    text: '#F0EDE8', textMuted: '#8A8680',
    accent: '#C4913A', accentMuted: 'rgba(196, 145, 58, 0.25)',
    gradientFrom: '#0A0A0F', gradientTo: '#1A1510',
  },
  thriller: {
    bg: '#070B12', bgSecondary: '#0D1420',
    text: '#E8ECF0', textMuted: '#6B7B8D',
    accent: '#4A90D9', accentMuted: 'rgba(74, 144, 217, 0.2)',
    gradientFrom: '#070B12', gradientTo: '#0A1525',
  },
  warm: {
    bg: '#100A06', bgSecondary: '#1A1208',
    text: '#F0E8DD', textMuted: '#9A8A72',
    accent: '#D4874A', accentMuted: 'rgba(212, 135, 74, 0.2)',
    gradientFrom: '#100A06', gradientTo: '#1F1508',
  },
  prestige: {
    bg: '#08080C', bgSecondary: '#111118',
    text: '#EEEEF2', textMuted: '#7A7A88',
    accent: '#B89A5A', accentMuted: 'rgba(184, 154, 90, 0.2)',
    gradientFrom: '#08080C', gradientTo: '#151218',
  },
  horror: {
    bg: '#0A0506', bgSecondary: '#160A0C',
    text: '#F0E5E5', textMuted: '#8A6565',
    accent: '#C44040', accentMuted: 'rgba(196, 64, 64, 0.2)',
    gradientFrom: '#0A0506', gradientTo: '#1A0A0A',
  },
  verdant: {
    bg: '#060C08', bgSecondary: '#0C180E',
    text: '#E8F0EA', textMuted: '#6A8A70',
    accent: '#5AAE6A', accentMuted: 'rgba(90, 174, 106, 0.2)',
    gradientFrom: '#060C08', gradientTo: '#0A1A0C',
  },
  oceanic: {
    bg: '#06090E', bgSecondary: '#0A1018',
    text: '#E5ECF5', textMuted: '#6580A0',
    accent: '#3A8ABF', accentMuted: 'rgba(58, 138, 191, 0.2)',
    gradientFrom: '#06090E', gradientTo: '#081520',
  },
};

function resolveColorPalette(tone?: string, genre?: string): LookBookColorSystem {
  const t = (tone || '').toLowerCase();
  const g = (genre || '').toLowerCase();
  if (t.includes('dark') || t.includes('noir') || g.includes('drama')) return COLOR_PALETTES.dark;
  if (g.includes('thriller') || g.includes('crime') || t.includes('cold')) return COLOR_PALETTES.thriller;
  if (g.includes('horror') || t.includes('horror')) return COLOR_PALETTES.horror;
  if (t.includes('warm') || g.includes('romance') || g.includes('comedy')) return COLOR_PALETTES.warm;
  if (g.includes('adventure') || g.includes('nature') || g.includes('fantasy')) return COLOR_PALETTES.verdant;
  if (g.includes('sci-fi') || g.includes('scifi')) return COLOR_PALETTES.oceanic;
  return COLOR_PALETTES.prestige;
}

function resolveIdentity(canonState: Record<string, unknown>, genre?: string): LookBookVisualIdentity {
  const tone = (canonState.tone_style as string) || '';
  const colors = resolveColorPalette(tone, genre);
  const t = tone.toLowerCase();
  return {
    colors,
    typography: {
      titleFont: 'Fraunces',
      bodyFont: 'DM Sans',
      titleUppercase: t.includes('thriller') || t.includes('action') || t.includes('horror'),
    },
    imageStyle: t.includes('cold') || t.includes('thriller') ? 'cinematic-cold'
      : t.includes('vintage') || t.includes('period') ? 'vintage'
      : t.includes('dark') ? 'high-contrast'
      : 'cinematic-warm',
  };
}

function parseComparables(text?: string): Array<{ title: string; reason: string }> {
  if (!text) return [];
  return text.split('\n').filter(Boolean).slice(0, 4).map(line => {
    const match = line.match(/^[•\-*]?\s*(.+?)(?:\s*[-–—:]\s*(.+))?$/);
    if (match) return { title: match[1].trim(), reason: match[2]?.trim() || '' };
    return { title: line.trim(), reason: '' };
  });
}

export async function generateLookBookData(
  projectId: string,
  branding: { companyName: string | null; companyLogoUrl: string | null },
): Promise<LookBookData> {
  // 1. Load project metadata
  const { data: project } = await supabase
    .from('projects')
    .select('title, genre, format, logline, themes, tone, assigned_lane')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error('Project not found');

  // 2. Load canonical state (authoritative source of truth)
  const canonicalState = await getCanonicalProjectState(projectId);
  const canon = canonicalState.state;

  // 3. Load current document versions for synopsis/statement
  const { data: docs } = await supabase
    .from('project_documents')
    .select('doc_type, latest_version_id')
    .eq('project_id', projectId)
    .in('doc_type', ['concept_brief', 'topline_narrative', 'treatment', 'blueprint']);

  let synopsis = '';
  let creativeStatement = '';
  if (docs?.length) {
    const versionIds = docs.map((d: any) => d.latest_version_id).filter(Boolean);
    if (versionIds.length) {
      // Use is_current versions for authoritative content
      const { data: versions } = await supabase
        .from('project_document_versions')
        .select('plaintext, deliverable_type, is_current')
        .in('id', versionIds)
        .eq('is_current', true);
      
      for (const v of versions || []) {
        const text = (v as any).plaintext || '';
        if (text.length > synopsis.length && (v as any).deliverable_type !== 'treatment') {
          synopsis = text.slice(0, 800);
        }
        if ((v as any).deliverable_type === 'treatment' || (v as any).deliverable_type === 'blueprint') {
          creativeStatement = text.slice(0, 600);
        }
      }

      // Fallback: if no is_current versions found, use the latest_version_id versions
      if (!synopsis && !creativeStatement) {
        const { data: fallbackVersions } = await supabase
          .from('project_document_versions')
          .select('plaintext, deliverable_type')
          .in('id', versionIds);
        for (const v of fallbackVersions || []) {
          const text = (v as any).plaintext || '';
          if (text.length > synopsis.length && (v as any).deliverable_type !== 'treatment') {
            synopsis = text.slice(0, 800);
          }
          if ((v as any).deliverable_type === 'treatment' || (v as any).deliverable_type === 'blueprint') {
            creativeStatement = text.slice(0, 600);
          }
        }
      }
    }
  }

  // 4. Load active poster for cover
  let coverImageUrl = '';
  try {
    const { data: activePoster } = await (supabase as any)
      .from('project_posters')
      .select('key_art_storage_path')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (activePoster?.key_art_storage_path) {
      const { data: signed } = await supabase.storage
        .from('poster-assets')
        .createSignedUrl(activePoster.key_art_storage_path, 3600);
      if (signed?.signedUrl) coverImageUrl = signed.signedUrl;
    }
  } catch { /* poster table may not exist yet */ }

  // 5. Build identity from canonical state
  const identity = resolveIdentity(canon, (project as any).genre);
  const logline = (canon.logline as string) || (project as any).logline || '';
  const title = (project as any).title || 'Untitled Project';
  const writerCredit = 'Written by Sebastian Street';
  const companyName = branding.companyName || 'Paradox House';

  // 6. Build slides from canonical content
  const slides: SlideContent[] = [];

  // COVER
  slides.push({
    type: 'cover',
    title,
    subtitle: logline,
    credit: writerCredit,
    companyName,
    companyLogoUrl: branding.companyLogoUrl || null,
    imageUrl: coverImageUrl || undefined,
  });

  // OVERVIEW — use canonical premise over raw synopsis
  const overviewBody = logline;
  const overviewDetail = (canon.premise as string) || synopsis.slice(0, 500);
  slides.push({
    type: 'overview',
    title: 'Project Overview',
    body: overviewBody,
    bodySecondary: overviewDetail || undefined,
    bullets: [
      (project as any).genre ? `Genre: ${(project as any).genre}` : '',
      (project as any).format ? `Format: ${(project as any).format}` : '',
      (canon.tone_style as string) ? `Tone: ${canon.tone_style}` : '',
    ].filter(Boolean),
  });

  // WORLD & SETTING
  if (canon.world_rules || canon.locations || canon.timeline) {
    slides.push({
      type: 'world',
      title: 'The World',
      body: (canon.world_rules as string) || undefined,
      bodySecondary: (canon.locations as string) || undefined,
      quote: (canon.timeline as string) || undefined,
    });
  }

  // CHARACTERS — from canonical state
  const chars = canon.characters;
  if (Array.isArray(chars) && chars.length > 0) {
    slides.push({
      type: 'characters',
      title: 'Characters',
      characters: chars.slice(0, 5).map((c: any) => ({
        name: c.name || 'Unnamed',
        role: c.role || '',
        description: c.goals || c.traits || c.description || '',
      })),
    });
  }

  // THEMES & TONE
  const themes = (project as any).themes || (canon.tone_style as string);
  if (themes) {
    slides.push({
      type: 'themes',
      title: 'Themes & Tone',
      body: typeof themes === 'string' ? themes : Array.isArray(themes) ? themes.join(' · ') : '',
      bodySecondary: (canon.tone_style as string) || undefined,
    });
  }

  // VISUAL LANGUAGE
  slides.push({
    type: 'visual_language',
    title: 'Visual Language',
    bullets: [
      `Palette: ${identity.imageStyle.replace(/-/g, ' ')}`,
      identity.typography.titleUppercase ? 'Bold, graphic title treatment' : 'Elegant, refined typography',
      'Cinematic compositions with intentional framing',
      'Consistent color grading throughout',
    ],
  });

  // STORY ENGINE (series)
  const format = ((project as any).format || '').toLowerCase();
  if (format.includes('series') || format.includes('vertical') || format.includes('limited')) {
    slides.push({
      type: 'story_engine',
      title: 'Story Engine',
      body: (canon.format_constraints as string) || 'A serialised narrative designed for sustained audience engagement.',
      bullets: [
        'Each episode ends on a dramatic question',
        'Character arcs span the full season',
        'Escalating stakes across the narrative',
      ],
    });
  }

  // COMPARABLES
  const comps = parseComparables((canon as any).comparables);
  if (comps.length > 0) {
    slides.push({
      type: 'comparables',
      title: 'Comparables',
      comparables: comps,
    });
  }

  // CREATIVE STATEMENT
  if (creativeStatement) {
    slides.push({
      type: 'creative_statement',
      title: 'Creative Vision',
      body: creativeStatement.slice(0, 500),
      credit: writerCredit,
    });
  }

  // CLOSING
  slides.push({
    type: 'closing',
    title,
    subtitle: logline,
    credit: writerCredit,
    companyName,
    companyLogoUrl: branding.companyLogoUrl || null,
  });

  return {
    projectId,
    projectTitle: title,
    identity,
    slides,
    generatedAt: new Date().toISOString(),
    writerCredit,
    companyName,
    companyLogoUrl: branding.companyLogoUrl || null,
  };
}
