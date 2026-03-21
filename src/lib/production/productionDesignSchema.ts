/**
 * Production Design Schema — Defines the visual production design language for a project.
 * 
 * Used by world slides, themes, visual language, and background image selection
 * to ensure generated imagery is consistent with the project's production design.
 */

// ── Location Design ──────────────────────────────────────────────────────────

export interface LocationDesign {
  /** Canon location name */
  name: string;
  /** Architecture style */
  architecture?: string;
  /** Interior/exterior/both */
  interiorExterior?: 'interior' | 'exterior' | 'both';
  /** Key materials */
  materials?: string[];
  /** Lighting quality */
  lightingQuality?: string;
  /** Color palette descriptors */
  colorPalette?: string[];
  /** Time of day associations */
  timeAssociations?: string[];
  /** Production design notes */
  designNotes?: string;
}

// ── Atmosphere Profile ───────────────────────────────────────────────────────

export interface AtmosphereProfile {
  /** Primary lighting approach */
  lighting: 'natural' | 'practical' | 'mixed' | 'stylized';
  /** Color temperature */
  colorTemperature: 'warm' | 'cool' | 'neutral' | 'mixed';
  /** Contrast level */
  contrast: 'low' | 'medium' | 'high' | 'extreme';
  /** Texture quality */
  textureQuality: 'smooth' | 'gritty' | 'organic' | 'refined';
  /** Atmosphere density */
  atmosphereDensity: 'clear' | 'hazy' | 'dense' | 'smoky';
}

// ── Costume Design ───────────────────────────────────────────────────────────

export interface CostumeDesign {
  /** Character name */
  characterName: string;
  /** Overall silhouette */
  silhouette?: string;
  /** Color palette */
  palette?: string[];
  /** Key materials */
  materials?: string[];
  /** Period accuracy notes */
  periodNotes?: string;
  /** Status/class indicators */
  statusIndicators?: string;
  /** Evolution across story */
  evolution?: string;
}

// ── Production Design System ─────────────────────────────────────────────────

export interface ProductionDesignSystem {
  /** Project period/era */
  period?: string;
  /** Geographic setting */
  geography?: string;
  /** Social/class context */
  socialContext?: string;
  /** Key locations */
  locations: LocationDesign[];
  /** Atmosphere profile */
  atmosphere: AtmosphereProfile;
  /** Costume designs per character */
  costumes: CostumeDesign[];
  /** Forbidden visual elements */
  forbiddenElements?: string[];
  /** Production design notes */
  designPhilosophy?: string;
}

// ── Extractors ───────────────────────────────────────────────────────────────

/**
 * Extract a basic production design system from canon data.
 * This is a heuristic extraction — not a replacement for explicit production design input.
 */
export function extractProductionDesignFromCanon(
  canon: Record<string, unknown>,
  characters?: Array<{ name: string; role?: string; traits?: string }>,
): ProductionDesignSystem {
  const worldRules = String(canon.world_rules || '');
  const toneStyle = String(canon.tone_style || '');
  const locations = String(canon.locations || '');

  // Extract period
  const periodMatch = worldRules.match(/\b(ancient|medieval|renaissance|victorian|edwardian|1[89]\d{2}s?|20\d{2}s?|contemporary|modern|futuristic|near.?future)\b/i);
  const period = periodMatch?.[0] || undefined;

  // Extract atmosphere from tone
  const atmosphere: AtmosphereProfile = {
    lighting: toneStyle.includes('noir') || toneStyle.includes('dark') ? 'practical'
      : toneStyle.includes('natural') ? 'natural'
      : 'mixed',
    colorTemperature: toneStyle.includes('warm') ? 'warm'
      : toneStyle.includes('cold') || toneStyle.includes('bleak') ? 'cool'
      : 'neutral',
    contrast: toneStyle.includes('high contrast') || toneStyle.includes('noir') ? 'high'
      : toneStyle.includes('soft') ? 'low'
      : 'medium',
    textureQuality: toneStyle.includes('gritty') || toneStyle.includes('raw') ? 'gritty'
      : toneStyle.includes('refined') || toneStyle.includes('elegant') ? 'refined'
      : 'organic',
    atmosphereDensity: toneStyle.includes('hazy') || toneStyle.includes('misty') ? 'hazy'
      : toneStyle.includes('smoky') ? 'smoky'
      : 'clear',
  };

  // Extract locations
  const locationDesigns: LocationDesign[] = locations
    .split(/[,;\n]/)
    .map(l => l.trim())
    .filter(l => l.length > 2)
    .slice(0, 8)
    .map(name => ({ name }));

  // Extract costume designs from characters
  const costumes: CostumeDesign[] = (characters || []).map(char => ({
    characterName: char.name,
    periodNotes: period,
  }));

  return {
    period,
    locations: locationDesigns,
    atmosphere,
    costumes,
    designPhilosophy: toneStyle || undefined,
  };
}

/**
 * Generate production design prompt fragments for image generation.
 */
export function getProductionDesignPromptFragments(
  design: ProductionDesignSystem,
): { environment: string; lighting: string; texture: string } {
  const envParts: string[] = [];
  if (design.period) envParts.push(`${design.period} era`);
  if (design.geography) envParts.push(design.geography);
  if (design.socialContext) envParts.push(design.socialContext);

  const lightParts: string[] = [];
  lightParts.push(`${design.atmosphere.lighting} lighting`);
  lightParts.push(`${design.atmosphere.colorTemperature} color temperature`);
  lightParts.push(`${design.atmosphere.contrast} contrast`);

  const texParts: string[] = [];
  texParts.push(`${design.atmosphere.textureQuality} texture`);
  if (design.atmosphere.atmosphereDensity !== 'clear') {
    texParts.push(`${design.atmosphere.atmosphereDensity} atmosphere`);
  }

  return {
    environment: envParts.join(', ') || 'cinematic environment',
    lighting: lightParts.join(', '),
    texture: texParts.join(', '),
  };
}
