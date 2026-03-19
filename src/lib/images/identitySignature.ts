/**
 * Identity Signature Model — Structured face/body/silhouette/wardrobe profile.
 * Derived from visual traits + identity notes. Used for prompt injection.
 * 
 * This does NOT require ML — it synthesizes from canon traits and user notes.
 */

import type { CharacterTrait } from './characterTraits';

export interface FaceSignature {
  eyeSpacing: string | null;
  jawShape: string | null;
  cheekboneStructure: string | null;
  noseProfile: string | null;
  distinctiveFeatures: string[];
}

export interface BodySignature {
  heightClass: 'short' | 'average' | 'tall' | null;
  build: string | null;
  shoulderWidth: string | null;
  limbProportions: string | null;
}

export interface SilhouetteSignature {
  posture: string | null;
  stanceTendency: string | null;
  presence: 'compact' | 'imposing' | 'neutral' | null;
}

export interface WardrobeBaseline {
  style: string | null;
  fit: string | null;
  paletteRange: string | null;
}

export interface IdentitySignature {
  face: FaceSignature;
  body: BodySignature;
  silhouette: SilhouetteSignature;
  wardrobeBaseline: WardrobeBaseline;
}

/**
 * Derive identity signature from resolved visual traits.
 */
export function deriveIdentitySignature(traits: CharacterTrait[]): IdentitySignature {
  const face: FaceSignature = {
    eyeSpacing: null,
    jawShape: null,
    cheekboneStructure: null,
    noseProfile: null,
    distinctiveFeatures: [],
  };
  const body: BodySignature = {
    heightClass: null,
    build: null,
    shoulderWidth: null,
    limbProportions: null,
  };
  const silhouette: SilhouetteSignature = {
    posture: null,
    stanceTendency: null,
    presence: null,
  };
  const wardrobeBaseline: WardrobeBaseline = {
    style: null,
    fit: null,
    paletteRange: null,
  };

  for (const t of traits) {
    const lower = t.label.toLowerCase();

    // Face
    if (t.category === 'face') {
      if (/jaw/i.test(lower)) face.jawShape = t.label;
      else if (/cheek/i.test(lower)) face.cheekboneStructure = t.label;
      else if (/nose/i.test(lower)) face.noseProfile = t.label;
      else if (/eye/i.test(lower)) face.eyeSpacing = t.label;
      else face.distinctiveFeatures.push(t.label);
    }

    // Build / height
    if (t.category === 'build') {
      if (/tall|towering|lanky/i.test(lower)) body.heightClass = 'tall';
      else if (/short|compact|petite/i.test(lower)) body.heightClass = 'short';
      else if (/average|medium/i.test(lower)) body.heightClass = 'average';
      
      if (/broad/i.test(lower)) body.shoulderWidth = 'broad';
      else if (/narrow/i.test(lower)) body.shoulderWidth = 'narrow';

      // General build descriptor
      if (/lean|slim|slender|wiry|thin/i.test(lower)) body.build = t.label;
      else if (/muscular|athletic|combat/i.test(lower)) body.build = t.label;
      else if (/stocky|heavy|bulky|stout/i.test(lower)) body.build = t.label;
      else if (!body.build) body.build = t.label;
    }

    // Posture
    if (t.category === 'posture') {
      silhouette.posture = t.label;
      if (/imposing|commanding/i.test(lower)) silhouette.presence = 'imposing';
      else if (/compact|hunched/i.test(lower)) silhouette.presence = 'compact';
      else silhouette.presence = 'neutral';
    }

    // Clothing
    if (t.category === 'clothing') {
      if (/utilitarian|worn|practical|work/i.test(lower)) wardrobeBaseline.style = 'utilitarian';
      else if (/formal|elegant|refined|suit/i.test(lower)) wardrobeBaseline.style = 'formal';
      else if (/military|uniform|armou?r/i.test(lower)) wardrobeBaseline.style = 'military';
      else if (/casual|plain|simple/i.test(lower)) wardrobeBaseline.style = 'casual';
      else if (!wardrobeBaseline.style) wardrobeBaseline.style = t.label;

      if (/tight|fitted|structured/i.test(lower)) wardrobeBaseline.fit = 'structured';
      else if (/loose|flowing|oversized/i.test(lower)) wardrobeBaseline.fit = 'loose';
    }

    // Markers as face distinctive features
    if (t.category === 'marker') {
      face.distinctiveFeatures.push(t.label);
    }
  }

  return { face, body, silhouette, wardrobeBaseline };
}

/**
 * Format identity signature for prompt injection.
 */
export function formatIdentitySignatureBlock(sig: IdentitySignature): string {
  const lines: string[] = ['[IDENTITY SIGNATURE]'];

  // Face
  const faceLines: string[] = [];
  if (sig.face.jawShape) faceLines.push(`Jaw: ${sig.face.jawShape}`);
  if (sig.face.cheekboneStructure) faceLines.push(`Cheekbones: ${sig.face.cheekboneStructure}`);
  if (sig.face.noseProfile) faceLines.push(`Nose: ${sig.face.noseProfile}`);
  if (sig.face.eyeSpacing) faceLines.push(`Eyes: ${sig.face.eyeSpacing}`);
  if (sig.face.distinctiveFeatures.length > 0) faceLines.push(`Distinctive: ${sig.face.distinctiveFeatures.join(', ')}`);
  if (faceLines.length > 0) {
    lines.push('', 'Face:', ...faceLines.map(l => `  - ${l}`));
  }

  // Body
  const bodyLines: string[] = [];
  if (sig.body.heightClass) bodyLines.push(`Height: ${sig.body.heightClass}`);
  if (sig.body.build) bodyLines.push(`Build: ${sig.body.build}`);
  if (sig.body.shoulderWidth) bodyLines.push(`Shoulders: ${sig.body.shoulderWidth}`);
  if (sig.body.limbProportions) bodyLines.push(`Limbs: ${sig.body.limbProportions}`);
  if (bodyLines.length > 0) {
    lines.push('', 'Body:', ...bodyLines.map(l => `  - ${l}`));
  }

  // Silhouette
  const silLines: string[] = [];
  if (sig.silhouette.posture) silLines.push(`Posture: ${sig.silhouette.posture}`);
  if (sig.silhouette.presence) silLines.push(`Presence: ${sig.silhouette.presence}`);
  if (silLines.length > 0) {
    lines.push('', 'Silhouette:', ...silLines.map(l => `  - ${l}`));
  }

  // Wardrobe
  const wardLines: string[] = [];
  if (sig.wardrobeBaseline.style) wardLines.push(`Style: ${sig.wardrobeBaseline.style}`);
  if (sig.wardrobeBaseline.fit) wardLines.push(`Fit: ${sig.wardrobeBaseline.fit}`);
  if (sig.wardrobeBaseline.paletteRange) wardLines.push(`Palette: ${sig.wardrobeBaseline.paletteRange}`);
  if (wardLines.length > 0) {
    lines.push('', 'Wardrobe baseline:', ...wardLines.map(l => `  - ${l}`));
  }

  // If nothing was derived, return empty
  if (lines.length <= 1) return '';

  return lines.join('\n');
}

/**
 * Check if signature has meaningful content.
 */
export function hasIdentitySignature(sig: IdentitySignature): boolean {
  return !!(
    sig.face.jawShape || sig.face.cheekboneStructure || sig.face.noseProfile ||
    sig.face.eyeSpacing || sig.face.distinctiveFeatures.length > 0 ||
    sig.body.heightClass || sig.body.build || sig.body.shoulderWidth ||
    sig.silhouette.posture || sig.silhouette.presence ||
    sig.wardrobeBaseline.style
  );
}
