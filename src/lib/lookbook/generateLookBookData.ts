/**
 * generateLookBookData — Assembles Look Book slides from canonical project state.
 * Uses resolveAllCanonImages for section-accurate image resolution,
 * matching the same DB queries as the workspace panels.
 */
import { supabase } from '@/integrations/supabase/client';
import { getCanonicalProjectState } from '@/lib/canon/getCanonicalProjectState';
import type { LookBookData, LookBookVisualIdentity, SlideContent, LookBookColorSystem } from './types';
import { resolveImageStylePolicy } from '@/lib/images/stylePolicy';
import { resolveAllCanonImages } from './resolveCanonImages';
import { normalizeCanonText } from './normalizeCanonText';

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

/* ── Content-strengthening helpers ── */

function buildVisualLanguageCopy(
  canon: Record<string, unknown>,
  genre: string,
  tone: string,
  imageStyle: string,
): { body: string; bullets: string[] } {
  const period = (canon.world_rules as string || '').match(/\b(19\d{2}|20\d{2}|18\d{2}|contemporary|modern|medieval|victorian|future|futuristic)\b/i)?.[0] || '';
  const worldRules = (canon.world_rules as string) || '';
  const toneStyle = (canon.tone_style as string) || tone || '';

  // Build a project-specific visual thesis
  const fragments: string[] = [];
  if (period) fragments.push(`rooted in the texture and light of ${period.toLowerCase().includes('19') || period.toLowerCase().includes('18') ? `the ${period}s` : period.toLowerCase()}`);
  if (toneStyle) fragments.push(`carrying the emotional weight of ${toneStyle.toLowerCase()}`);
  if (genre) fragments.push(`filtered through the grammar of ${genre.toLowerCase()}`);

  const body = fragments.length > 0
    ? `A deliberate visual system ${fragments.join(', ')}. Every frame is designed to immerse the audience in the world before a single word is spoken — atmosphere, texture, and light do the storytelling.`
    : 'A unified visual philosophy where atmosphere, colour, and composition serve the narrative. The image system is designed to be felt before it is understood — each frame functions as emotional evidence.';

  // Build specific bullets from canon data
  const bullets: string[] = [];
  const styleLabel = imageStyle.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());

  if (worldRules && worldRules.length > 20) {
    const worldSnippet = worldRules.slice(0, 80).replace(/[.!]?\s*$/, '');
    bullets.push(`World-grounded palette: ${worldSnippet}`);
  } else {
    bullets.push(`${styleLabel} tonality — naturalistic colour, controlled contrast, cinematic depth of field`);
  }

  if (toneStyle) {
    bullets.push(`Emotional register: ${toneStyle} — every lighting choice and composition reinforces this`);
  }

  if (period) {
    bullets.push(`Period authenticity in production design, costume texture, and environmental detail`);
  } else {
    bullets.push(`Consistent environmental design language across all locations and scenes`);
  }

  bullets.push('Visual continuity between marketing materials, key art, and in-narrative imagery');

  return { body, bullets };
}

function buildStoryEngineCopy(
  canon: Record<string, unknown>,
  format: string,
  genre: string,
  logline: string,
): { body: string; bodySecondary: string; bullets: string[] } {
  const formatConstraints = (canon.format_constraints as string) || '';
  const toneStyle = (canon.tone_style as string) || '';
  const isSeries = format.includes('series') || format.includes('vertical') || format.includes('limited');

  let body: string;
  if (formatConstraints && formatConstraints.length > 30) {
    body = formatConstraints.slice(0, 400);
  } else if (isSeries) {
    body = `A serialised narrative engineered for sustained emotional investment. The dramatic architecture is designed so that each episode compounds tension, deepens character, and raises the stakes — the audience is always leaning forward.`;
  } else {
    body = `A tightly structured narrative built around escalating dramatic pressure. The story is designed to sustain audience engagement from the opening image to the final frame through careful emotional calibration and narrative momentum.`;
  }

  let bodySecondary = '';
  if (toneStyle) {
    bodySecondary = `The tonal register — ${toneStyle.toLowerCase()} — governs pacing, revelation timing, and the balance between tension and release across the full narrative arc.`;
  }

  const bullets: string[] = [];
  if (isSeries) {
    bullets.push('Episode-end hooks create compulsive viewing momentum');
    bullets.push('Character arcs calibrated across the full season trajectory');
    bullets.push('Escalating dramatic stakes with controlled revelation pacing');
    if (genre.toLowerCase().includes('thriller') || genre.toLowerCase().includes('crime')) {
      bullets.push('Investigative or procedural spine sustains episodic structure');
    } else {
      bullets.push('Thematic deepening rewards sustained audience attention');
    }
  } else {
    bullets.push('Three-act escalation with controlled tonal shifts');
    bullets.push('Character transformation as the primary engine of dramatic momentum');
    bullets.push('Audience alignment shifts create re-watch value');
  }

  return { body, bodySecondary, bullets };
}

function buildThemesCopy(
  canon: Record<string, unknown>,
  genre: string,
  tone: string,
): { body: string; bodySecondary: string } {
  const toneStyle = (canon.tone_style as string) || tone || '';
  const worldRules = (canon.world_rules as string) || '';
  const logline = (canon.logline as string) || '';

  let body = toneStyle;
  if (typeof toneStyle === 'string' && toneStyle.length < 60) {
    // Enrich thin tone descriptions
    const enrichments: string[] = [];
    if (genre) enrichments.push(`operating within the conventions of ${genre.toLowerCase()}`);
    if (worldRules && worldRules.length > 20) enrichments.push(`shaped by the pressures and rules of its world`);
    body = toneStyle + (enrichments.length ? ` — ${enrichments.join(', ')}.` : '.');
  }

  let bodySecondary = '';
  if (logline) {
    bodySecondary = `At its core, the project explores the tension between what characters want and what the world allows them to have. The thematic architecture operates beneath the surface of genre, giving the audience something to feel long after the credits.`;
  }

  return { body, bodySecondary };
}

export async function generateLookBookData(
  projectId: string,
  branding: { companyName: string | null; companyLogoUrl: string | null },
): Promise<LookBookData> {
  // 1. Load project metadata
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('title, genres, format, tone, assigned_lane, comparable_titles, target_audience')
    .eq('id', projectId)
    .maybeSingle();

  if (projectErr) throw new Error('Could not load project data: ' + projectErr.message);
  if (!project) throw new Error('Project not found — check access permissions');
  console.log('[LookBook] ✓ project loaded:', (project as any).title);

  const genre = Array.isArray((project as any).genres) ? (project as any).genres.join(', ') : '';
  const format = ((project as any).format || '').toLowerCase();
  const tone = (project as any).tone || '';

  // 2. Load canonical state
  const canonicalState = await getCanonicalProjectState(projectId);
  const canon = canonicalState.state;
  console.log('[LookBook] ✓ canon loaded, source:', canonicalState.source);

  // 3. Load document versions for synopsis/statement
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

  // 4. Resolve canonical images per section — SAME logic as workspace
  const canonImages = await resolveAllCanonImages(projectId);

  const coverImageUrl =
    canonImages.poster_directions.images.find(i => i.role === 'poster_primary')?.signedUrl ||
    canonImages.poster_directions.images[0]?.signedUrl ||
    '';

  const worldImages = canonImages.world_locations.images;
  const worldImageUrl = worldImages[0]?.signedUrl || '';
  const atmosphereImages = canonImages.atmosphere_lighting.images;
  const textureImages = canonImages.texture_detail.images;
  const motifImages = canonImages.symbolic_motifs.images;

  // Build character image maps
  const charImages = canonImages.character_identity.images;
  const characterImageMap = new Map<string, string>();
  for (const img of charImages) {
    if (img.entity_id && img.signedUrl && !characterImageMap.has(img.entity_id)) {
      characterImageMap.set(img.entity_id, img.signedUrl);
    }
  }
  const characterNameImageMap = new Map<string, string>();
  for (const img of charImages) {
    if (img.subject && img.signedUrl && !characterNameImageMap.has(img.subject.toLowerCase())) {
      characterNameImageMap.set(img.subject.toLowerCase(), img.signedUrl);
    }
  }

  // 5. Build identity
  const identity = resolveIdentity(canon, genre);
  const stylePolicy = resolveImageStylePolicy({
    format: (project as any).format,
    genres: (project as any).genres || [],
    tone,
  });
  const logline = (canon.logline as string) || '';
  const title = (project as any).title || 'Untitled Project';
  const writerCredit = 'Written by Sebastian Street';
  const companyName = branding.companyName || 'Paradox House';

  // 6. Build slides with strengthened content
  const slides: SlideContent[] = [];

  // ── COVER ──
  slides.push({
    type: 'cover',
    title,
    subtitle: logline,
    credit: writerCredit,
    companyName,
    companyLogoUrl: branding.companyLogoUrl || null,
    imageUrl: coverImageUrl || undefined,
    _debug_image_ids: canonImages.poster_directions.imageIds.slice(0, 1),
  });

  // ── OVERVIEW ──
  const overviewBody = logline || (canon.premise as string) || synopsis.slice(0, 300);
  const overviewSecondary = logline && ((canon.premise as string) || synopsis.slice(0, 500))
    ? ((canon.premise as string) || synopsis.slice(0, 500))
    : undefined;
  slides.push({
    type: 'overview',
    title: 'Project Overview',
    body: overviewBody,
    bodySecondary: overviewSecondary !== overviewBody ? overviewSecondary : undefined,
    bullets: [
      genre ? `Genre: ${genre}` : '',
      (project as any).format ? `Format: ${(project as any).format}` : '',
      (canon.tone_style as string) ? `Tone: ${canon.tone_style}` : '',
      (project as any).target_audience ? `Audience: ${(project as any).target_audience}` : '',
      (project as any).assigned_lane ? `Lane: ${(project as any).assigned_lane}` : '',
    ].filter(Boolean),
  });

  // ── WORLD ──
  if (canon.world_rules || canon.locations || canon.timeline || worldImages.length > 0) {
    slides.push({
      type: 'world',
      title: 'The World',
      body: (canon.world_rules as string) || undefined,
      bodySecondary: (canon.locations as string) || undefined,
      quote: (canon.timeline as string) || undefined,
      imageUrl: worldImageUrl || undefined,
      imageUrls: worldImages.slice(0, 4).map(i => i.signedUrl).filter(Boolean) as string[],
      _debug_image_ids: canonImages.world_locations.imageIds,
    });
  }

  // ── CHARACTERS ──
  const chars = canon.characters;
  if (Array.isArray(chars) && chars.length > 0) {
    slides.push({
      type: 'characters',
      title: 'Characters',
      characters: chars.slice(0, 6).map((c: any) => {
        const charImgUrl =
          (c.id && characterImageMap.get(c.id)) ||
          (c.name && characterNameImageMap.get(c.name?.toLowerCase())) ||
          '';
        // Strengthen description — combine available fields
        const descParts = [c.goals, c.traits, c.description].filter(Boolean);
        const desc = descParts.join(' — ') || 'Role to be defined.';
        return {
          name: c.name || 'Unnamed',
          role: c.role || c.archetype || '',
          description: desc.slice(0, 200),
          imageUrl: charImgUrl || undefined,
        };
      }),
      _debug_image_ids: canonImages.character_identity.imageIds,
    });
  }

  // ── THEMES ──
  const themesRaw = (canon.tone_style as string) || tone || '';
  if (themesRaw) {
    const themesCopy = buildThemesCopy(canon, genre, tone);
    slides.push({
      type: 'themes',
      title: 'Themes & Tone',
      body: themesCopy.body,
      bodySecondary: themesCopy.bodySecondary || undefined,
    });
  }

  // ── VISUAL LANGUAGE ──
  const visualImages = [...atmosphereImages, ...textureImages];
  const vlCopy = buildVisualLanguageCopy(canon, genre, tone, identity.imageStyle);
  slides.push({
    type: 'visual_language',
    title: 'Visual Language',
    body: vlCopy.body,
    imageUrl: visualImages[0]?.signedUrl || undefined,
    imageUrls: visualImages.slice(0, 4).map(i => i.signedUrl).filter(Boolean) as string[],
    bullets: vlCopy.bullets,
    _debug_image_ids: [...canonImages.atmosphere_lighting.imageIds, ...canonImages.texture_detail.imageIds],
  });

  // ── STORY ENGINE ──
  if (format.includes('series') || format.includes('vertical') || format.includes('limited') || format.includes('feature') || format.includes('film') || logline) {
    const seCopy = buildStoryEngineCopy(canon, format, genre, logline);
    slides.push({
      type: 'story_engine',
      title: 'Story Engine',
      body: seCopy.body,
      bodySecondary: seCopy.bodySecondary || undefined,
      bullets: seCopy.bullets,
      imageUrl: motifImages[0]?.signedUrl || undefined,
      _debug_image_ids: canonImages.symbolic_motifs.imageIds.slice(0, 1),
    });
  }

  // ── COMPARABLES ──
  const comps = parseComparables((canon as any).comparables || (project as any).comparable_titles);
  if (comps.length > 0) {
    slides.push({
      type: 'comparables',
      title: 'Comparables',
      comparables: comps,
    });
  }

  // ── CREATIVE STATEMENT ──
  if (creativeStatement) {
    slides.push({
      type: 'creative_statement',
      title: 'Creative Vision',
      body: creativeStatement.slice(0, 500),
      credit: writerCredit,
    });
  }

  // ── CLOSING ──
  slides.push({
    type: 'closing',
    title,
    subtitle: logline,
    credit: writerCredit,
    companyName,
    companyLogoUrl: branding.companyLogoUrl || null,
  });

  // Debug provenance
  const provenanceSummary = slides
    .filter(s => s._debug_image_ids?.length)
    .map(s => `${s.type}: ${s._debug_image_ids!.length} images`)
    .join(', ');
  console.log('[LookBook] ✓ generation complete — slides:', slides.length, '| images:', provenanceSummary);

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
