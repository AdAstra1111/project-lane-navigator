/**
 * Canon Constraint Builder — Extracts visual constraints from project canon
 * to inject into all image generation prompts.
 */

import type { CanonConstraints } from './types';

/**
 * Build canon constraints from canonical project state.
 * These are injected as hard gates into every image prompt.
 */
export function buildCanonConstraints(
  canonState: Record<string, unknown>,
  projectMeta?: { genre?: string; format?: string; tone?: string },
): CanonConstraints {
  const constraints: CanonConstraints = {};
  const forbidden: string[] = [];

  // Extract era/timeline
  const timeline = (canonState.timeline as string) || '';
  if (timeline) {
    constraints.era = timeline.slice(0, 200);
  }

  // Extract world rules for geography, culture, architecture, technology
  const worldRules = (canonState.world_rules as string) || '';
  if (worldRules) {
    constraints.geography = worldRules.slice(0, 300);
  }

  // Extract locations for architecture cues
  const locations = (canonState.locations as string) || '';
  if (locations) {
    constraints.architecture = locations.slice(0, 200);
  }

  // Extract tone/style
  const toneStyle = (canonState.tone_style as string) || projectMeta?.tone || '';
  if (toneStyle) {
    constraints.tone_style = toneStyle.slice(0, 200);
  }

  // Extract forbidden changes as visual constraints
  const forbidden_changes = (canonState.forbidden_changes as string) || '';
  if (forbidden_changes) {
    forbidden_changes.split('\n').filter(Boolean).forEach(line => {
      forbidden.push(line.trim());
    });
  }

  // Genre-based forbidden elements
  const genre = (projectMeta?.genre || '').toLowerCase();
  if (genre.includes('period') || genre.includes('historical')) {
    forbidden.push('modern technology', 'contemporary clothing', 'electric lights (unless period-appropriate)');
  }
  if (!genre.includes('sci-fi') && !genre.includes('scifi') && !genre.includes('fantasy')) {
    forbidden.push('sci-fi elements', 'fantasy creatures', 'magic effects');
  }

  if (forbidden.length > 0) {
    constraints.forbidden_elements = forbidden;
  }

  return constraints;
}

/**
 * Format canon constraints into prompt blocks for image generation.
 */
export function formatCanonPromptBlock(constraints: CanonConstraints): string {
  const lines: string[] = ['[CANON CONSTRAINTS — DO NOT VIOLATE]'];

  if (constraints.era) lines.push(`ERA/PERIOD: ${constraints.era}`);
  if (constraints.geography) lines.push(`WORLD: ${constraints.geography}`);
  if (constraints.culture) lines.push(`CULTURE: ${constraints.culture}`);
  if (constraints.architecture) lines.push(`ARCHITECTURE: ${constraints.architecture}`);
  if (constraints.wardrobe) lines.push(`WARDROBE: ${constraints.wardrobe}`);
  if (constraints.technology_level) lines.push(`TECHNOLOGY: ${constraints.technology_level}`);
  if (constraints.tone_style) lines.push(`TONE/STYLE: ${constraints.tone_style}`);

  if (constraints.forbidden_elements?.length) {
    lines.push(`FORBIDDEN: ${constraints.forbidden_elements.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format a negative prompt from canon constraints.
 */
export function formatCanonNegativePrompt(constraints: CanonConstraints): string {
  const parts: string[] = [];

  if (constraints.forbidden_elements?.length) {
    parts.push(...constraints.forbidden_elements);
  }

  // Always include quality negatives
  parts.push('blurry', 'low quality', 'watermark', 'text overlay', 'UI elements');

  return parts.join(', ');
}
