import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveImageGenerationConfig, buildImageRepositoryMeta } from "../_shared/imageGenerationResolver.ts";
import type { ImageRole, ImageStyleMode } from "../_shared/imageGenerationResolver.ts";
import { resolveVisualStyleProfile, validateStyleOrError } from "../_shared/visualStyleAuthority.ts";
import type { VisualStyleLock } from "../_shared/visualStyleAuthority.ts";
import { resolveFormatToLane, resolvePrestigeStyle, assemblePrestigePrompt } from "../_shared/prestigeStyleSystem.ts";
import type { StyleComposite } from "../_shared/prestigeStyleSystem.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Style Policy ─────────────────────────────────────────────────────────────

type LocalImageStyleMode = "photorealistic_cinematic" | "stylised_animation" | "stylised_graphic" | "stylised_experimental" | "stylised_period_painterly";

interface ImageStylePolicy {
  mode: LocalImageStyleMode;
  styleDirectives: string;
  negativeStyleConstraints: string;
}

const PHOTOREAL_DIRECTIVES =
  "Photorealistic cinematic imagery. Live-action film still. Shot on ARRI Alexa or RED cinema camera with premium anamorphic lenses. Real-world materials, textures, surfaces. Believable natural or motivated cinematic lighting. Real lens behaviour including subtle flares, bokeh, and depth of field. Premium theatrical realism. No illustration, no concept art, no digital painting, no CGI render look.";
const PHOTOREAL_NEGATIVES =
  "painterly, illustrative, cartoon, anime, graphic-novel style, concept art rendering, abstract, surreal, watercolor, oil painting, sketch, line art, cel-shaded, pop art, storybook illustration, digital painting, CGI render look, stock photo aesthetic, 3D render, Unreal Engine, video game screenshot";

const ANIMATION_FORMATS = ["animation", "anim-feature", "anim-series", "animated"];
const GRAPHIC_GENRES = ["graphic-novel", "comic", "manga"];

function resolveStylePolicy(format: string, genres: string[]): ImageStylePolicy {
  const f = format.toLowerCase();
  const gs = genres.map(g => g.toLowerCase());
  if (ANIMATION_FORMATS.some(af => f.includes(af))) {
    return { mode: "stylised_animation", styleDirectives: "Stylised animated visual language. Professional animation studio quality.", negativeStyleConstraints: "photorealistic, live-action, stock photo" };
  }
  if (gs.some(g => GRAPHIC_GENRES.some(gg => g.includes(gg)))) {
    return { mode: "stylised_graphic", styleDirectives: "Graphic novel / comic book visual style. Bold ink work.", negativeStyleConstraints: "photorealistic, live-action, stock photo" };
  }
  return { mode: "photorealistic_cinematic", styleDirectives: PHOTOREAL_DIRECTIVES, negativeStyleConstraints: PHOTOREAL_NEGATIVES };
}

// ── Shot taxonomy prompt builders ────────────────────────────────────────────

type AssetGroup = "character" | "world" | "key_moment" | "visual_language" | "poster";
type ShotType = "close_up" | "medium" | "wide" | "full_body" | "profile" | "over_shoulder" | "detail" | "tableau" | "emotional_variant" | "atmospheric" | "time_variant" | "lighting_ref" | "texture_ref" | "composition_ref" | "color_ref" | "identity_headshot" | "identity_profile" | "identity_full_body";
type LookbookSection = "world" | "character" | "key_moment" | "visual_language";

const SHOT_PACKS: Record<AssetGroup, ShotType[]> = {
  character: ["close_up", "medium", "full_body", "profile", "emotional_variant"],
  world: ["wide", "atmospheric", "detail", "time_variant"],
  key_moment: ["tableau", "medium", "close_up", "wide"],
  visual_language: ["lighting_ref", "texture_ref", "composition_ref", "color_ref"],
  poster: [],
};

interface SectionContext {
  title: string;
  format: string;
  genres: string[];
  tone: string;
  worldDescription: string;
  characters: string;
  conflict: string;
  themes: string;
  logline: string;
  stylePolicy: ImageStylePolicy;
  characterName?: string;
  locationName?: string;
  locationDescription?: string;
  worldBindingBlock?: string;
  locationBindingBlock?: string;
  characterBindingBlock?: string;
  /** Bound character names from canonical binding resolution */
  boundCharacterNames?: string[];
}

// ── Canonical Visual Binding Types ──────────────────────────────────────────
interface CharacterBinding {
  character_name: string;
  dna_version_id: string | null;
  identity_signature: Record<string, unknown> | null;
  locked_invariants: Record<string, unknown> | null;
  traits_summary: string;
}

interface LocationBinding {
  location_id: string;
  canonical_name: string;
  description: string | null;
  location_type: string;
  geography: string | null;
  interior_or_exterior: string | null;
  era_relevance: string | null;
  story_importance: string;
}

interface WorldBinding {
  era: string;
  geography: string;
  architecture: string;
  social_structure: string;
  costume_language: string;
  environmental_palette: string;
  technology_level: string;
  cultural_markers: string;
  world_rules: string[];
  bound: boolean;
}

interface CanonicalBindingResult {
  characters: CharacterBinding[];
  locations: LocationBinding[];
  world: WorldBinding;
  characterPromptBlock: string;
  locationPromptBlock: string;
  worldPromptBlock: string;
  binding_status: 'bound' | 'partially_bound' | 'unbound';
  missing: string[];
  targeting_mode: 'exact' | 'derived' | 'heuristic';
}
// ── Section → canonical entity mapping ──────────────────────────────────────
const SECTION_BINDING_RELEVANCE: Record<string, { characters: boolean; locations: boolean; world: boolean }> = {
  character: { characters: true, locations: false, world: true },
  world: { characters: false, locations: true, world: true },
  key_moment: { characters: true, locations: true, world: true },
  visual_language: { characters: false, locations: true, world: true },
};

async function resolveCharacterBindings(
  sb: any, projectId: string, sectionKey: string,
  explicitCharacterName?: string, explicitCharacterNames?: string[],
): Promise<CharacterBinding[]> {
  if (!SECTION_BINDING_RELEVANCE[sectionKey]?.characters) return [];
  const { data: dnaRows } = await sb
    .from("character_visual_dna")
    .select("id, character_name, locked_invariants, identity_signature, version_number")
    .eq("project_id", projectId).eq("is_current", true)
    .order("character_name").limit(10);
  if (!dnaRows?.length) return [];

  // Build exact target set from explicit params
  const exactTargets = new Set<string>();
  if (explicitCharacterName) exactTargets.add(explicitCharacterName.toLowerCase());
  if (explicitCharacterNames?.length) {
    for (const n of explicitCharacterNames) exactTargets.add(n.toLowerCase());
  }

  const bindings: CharacterBinding[] = [];
  for (const dna of dnaRows) {
    const nameLC = dna.character_name?.toLowerCase() || '';
    // If exact targets specified, only bind those exact characters
    if (exactTargets.size > 0 && !exactTargets.has(nameLC)) continue;
    const sig = dna.identity_signature as Record<string, unknown> | null;
    const locked = dna.locked_invariants as Record<string, unknown> | null;
    const traitParts: string[] = [];
    if (sig) {
      for (const k of ['face', 'body', 'silhouette', 'wardrobe']) {
        if (sig[k]) traitParts.push(`${k}: ${typeof sig[k] === 'string' ? sig[k] : JSON.stringify(sig[k])}`);
      }
    }
    if (locked) {
      const entries = Object.entries(locked).filter(([_, v]) => v);
      if (entries.length) traitParts.push(`Locked: ${entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('; ')}`);
    }
    bindings.push({ character_name: dna.character_name, dna_version_id: dna.id, identity_signature: sig, locked_invariants: locked, traits_summary: traitParts.join('. ') || `${dna.character_name}` });
    // If no exact targets, cap at 3 (heuristic mode)
    if (exactTargets.size === 0 && bindings.length >= 3) break;
  }
  return bindings;
}

async function resolveLocationBindings(
  sb: any, projectId: string, sectionKey: string,
  explicitLocationId?: string | null, explicitLocationName?: string,
  explicitLocationIds?: string[],
): Promise<LocationBinding[]> {
  if (!SECTION_BINDING_RELEVANCE[sectionKey]?.locations) return [];

  // If exact IDs provided, query those specifically
  if (explicitLocationIds?.length) {
    const { data: exactRows } = await sb.from("canon_locations")
      .select("id, canonical_name, description, location_type, geography, interior_or_exterior, era_relevance, story_importance")
      .eq("project_id", projectId).eq("active", true)
      .in("id", explicitLocationIds);
    if (exactRows?.length) {
      return exactRows.map((loc: any) => ({
        location_id: loc.id, canonical_name: loc.canonical_name, description: loc.description,
        location_type: loc.location_type || 'unspecified', geography: loc.geography,
        interior_or_exterior: loc.interior_or_exterior, era_relevance: loc.era_relevance,
        story_importance: loc.story_importance || 'secondary',
      }));
    }
  }

  let q = sb.from("canon_locations")
    .select("id, canonical_name, description, location_type, geography, interior_or_exterior, era_relevance, story_importance")
    .eq("project_id", projectId).eq("active", true);
  if (explicitLocationId) q = q.eq("id", explicitLocationId);
  q = q.order("story_importance", { ascending: true }).limit(6);
  const { data: locRows } = await q;
  if (!locRows?.length) return [];
  let filtered = locRows;
  if (explicitLocationName && !explicitLocationId) {
    const norm = explicitLocationName.toLowerCase();
    const match = locRows.filter((l: any) => l.canonical_name?.toLowerCase().includes(norm));
    if (match.length) filtered = match;
  }
  return filtered.map((loc: any) => ({
    location_id: loc.id, canonical_name: loc.canonical_name, description: loc.description,
    location_type: loc.location_type || 'unspecified', geography: loc.geography,
    interior_or_exterior: loc.interior_or_exterior, era_relevance: loc.era_relevance,
    story_importance: loc.story_importance || 'secondary',
  }));
}

function resolveWorldBinding(canonJson: any): WorldBinding {
  if (!canonJson) return { era: '', geography: '', architecture: '', social_structure: '', costume_language: '', environmental_palette: '', technology_level: '', cultural_markers: '', world_rules: [], bound: false };
  const cj = canonJson;
  const worldRules: string[] = [];
  if (Array.isArray(cj.world_rules)) worldRules.push(...cj.world_rules.filter((r: any) => typeof r === 'string'));
  else if (typeof cj.world_rules === 'string' && cj.world_rules.trim()) worldRules.push(cj.world_rules);
  const worldDesc = cj.world_description || cj.setting || '';
  return {
    era: cj.era || cj.period || cj.time_period || '',
    geography: cj.geography || '', architecture: cj.architecture || '',
    social_structure: cj.social_structure || cj.class_structure || '',
    costume_language: cj.costume_language || cj.wardrobe || '',
    environmental_palette: cj.color_palette || cj.palette || '',
    technology_level: cj.technology_level || cj.technology || '',
    cultural_markers: cj.cultural_markers || cj.culture || '',
    world_rules: worldRules,
    bound: !!(worldDesc || cj.era || cj.period || worldRules.length > 0),
  };
}

function buildCharacterBindingBlock(chars: CharacterBinding[], shotType?: ShotType | null): string {
  if (!chars.length) return '';
  const names = chars.map(c => c.character_name);
  const nameList = names.map(n => `"${n}"`).join(', ');

  const lines = [
    '[MANDATORY CAST REQUIREMENT — DO NOT OMIT OR SUBSTITUTE]',
    '',
    `This image MUST include the following character${chars.length > 1 ? 's' : ''}:`,
  ];
  for (const c of chars) {
    lines.push(`- ${c.character_name}`);
    if (c.traits_summary) lines.push(`  Visual DNA: ${c.traits_summary}`);
  }

  lines.push('');
  lines.push(`ALL listed characters (${nameList}) MUST be visible and recognizable in the frame.`);
  lines.push('Do NOT omit any listed character.');
  lines.push('Do NOT replace with generic, unnamed, or different individuals.');
  lines.push('Do NOT alter identity, face, build, or silhouette.');
  lines.push('');

  // Shot-specific framing enforcement
  if (shotType) {
    lines.push('[SHOT-SPECIFIC FRAMING REQUIREMENT]');
    switch (shotType) {
      case 'wide':
        lines.push(`WIDE SHOT: ${nameList} must be visible in full or near-full body within the environment.`);
        lines.push('Environment is dominant but characters must be identifiable — no silhouettes that obscure identity.');
        break;
      case 'medium':
        lines.push(`MEDIUM SHOT: ${nameList} framed waist-up. Facial identity must be clearly readable.`);
        lines.push('Environment is secondary to character presence.');
        break;
      case 'close_up':
        lines.push(`CLOSE-UP: ${chars.length === 1 ? `${nameList} fills the frame.` : `Tightly grouped — ${nameList} both visible.`} Face dominant, identity must match DNA exactly.`);
        break;
      case 'tableau':
        lines.push(`TABLEAU: ALL characters (${nameList}) must appear simultaneously in deliberate cinematic staging.`);
        lines.push('Multi-character composition — no character may be cropped out or reduced to background blur.');
        lines.push('Interaction or spatial arrangement must reflect a narrative moment.');
        break;
      case 'over_shoulder':
        lines.push(`OVER-SHOULDER: ${nameList} — one character in foreground (partial), other facing camera. Both must be recognizable.`);
        break;
      case 'full_body':
        lines.push(`FULL BODY: ${nameList} visible head to toe. Proportions and silhouette must match character DNA.`);
        break;
      case 'emotional_variant':
        lines.push(`EMOTIONAL VARIANT: ${nameList} — same character(s), different emotional state. Identity MUST remain identical.`);
        break;
      default:
        lines.push(`${nameList} must be clearly present and identifiable in this composition.`);
        break;
    }
    lines.push('');
  }

  // No-dropout rule for multi-character
  if (chars.length > 1) {
    lines.push('[NO CHARACTER DROPOUT]');
    lines.push(`All ${chars.length} characters MUST appear in the frame simultaneously.`);
    lines.push('Do NOT reduce to a single character.');
    lines.push('Do NOT split into separate implied shots.');
    lines.push('Do NOT place any required character fully off-screen or obscured.');
    lines.push('');
  }

  // Identity enforcement
  lines.push('[IDENTITY LOCK ENFORCEMENT]');
  lines.push('Facial structure, skin tone, age, build, and defining features');
  lines.push('must remain consistent with the provided character DNA.');
  lines.push('No variation, reinterpretation, or stylization.');
  lines.push('');
  lines.push('[COMPOSITION GUARDRAIL]');
  lines.push('This is a live-action cinematic frame with real actors.');
  lines.push('Do NOT generate symbolic abstraction that removes characters from the scene.');
  lines.push('Symbolism must come from staging, lighting, and composition — not character omission.');

  return lines.join('\n');
}

function buildLocationBindingBlock(locs: LocationBinding[]): string {
  if (!locs.length) return '';
  const lines = ['[CANONICAL LOCATION BINDING — ARCHITECTURAL CONTINUITY REQUIRED]', ''];
  for (const l of locs) {
    lines.push(`LOCATION: "${l.canonical_name}" (${l.location_type}${l.interior_or_exterior ? `, ${l.interior_or_exterior}` : ''})`);
    if (l.description) lines.push(`  ${l.description}`);
    if (l.geography) lines.push(`  Geography: ${l.geography}`);
    if (l.era_relevance) lines.push(`  Era: ${l.era_relevance}`);
    lines.push(`  ENFORCE: Preserve recognizable architectural identity, geography, layout.`);
    lines.push('');
  }
  return lines.join('\n');
}

function buildWorldBindingBlock(world: WorldBinding): string {
  if (!world.bound) return '';
  const lines = ['[CANONICAL WORLD BINDING — PROJECT UNIVERSE COHERENCE REQUIRED]', ''];
  if (world.era) lines.push(`ERA/PERIOD: ${world.era}`);
  if (world.geography) lines.push(`GEOGRAPHY: ${world.geography}`);
  if (world.architecture) lines.push(`ARCHITECTURE: ${world.architecture}`);
  if (world.social_structure) lines.push(`SOCIAL STRUCTURE: ${world.social_structure}`);
  if (world.costume_language) lines.push(`COSTUME/MATERIAL: ${world.costume_language}`);
  if (world.environmental_palette) lines.push(`PALETTE: ${world.environmental_palette}`);
  if (world.technology_level) lines.push(`TECHNOLOGY: ${world.technology_level}`);
  if (world.cultural_markers) lines.push(`CULTURAL MARKERS: ${world.cultural_markers}`);
  if (world.world_rules.length > 0) { lines.push(`WORLD RULES:`); for (const r of world.world_rules.slice(0, 5)) lines.push(`  - ${r}`); }
  lines.push('', `ENFORCE: All imagery must belong to THIS project's world. No generic fantasy substitution.`);
  return lines.join('\n');
}

async function resolveCanonicalBindings(
  sb: any, projectId: string, sectionKey: string, canonJson: any,
  explicitCharacterName?: string, explicitLocationId?: string | null, explicitLocationName?: string,
  explicitCharacterNames?: string[], explicitLocationIds?: string[],
): Promise<CanonicalBindingResult> {
  // Determine if caller provided exact targets
  const hasExactCharTarget = !!(explicitCharacterName || explicitCharacterNames?.length);
  const hasExactLocTarget = !!(explicitLocationId || explicitLocationIds?.length);

  const [characters, locations] = await Promise.all([
    resolveCharacterBindings(sb, projectId, sectionKey, explicitCharacterName, explicitCharacterNames),
    resolveLocationBindings(sb, projectId, sectionKey, explicitLocationId, explicitLocationName, explicitLocationIds),
  ]);
  const world = resolveWorldBinding(canonJson);
  const characterPromptBlock = buildCharacterBindingBlock(characters, null);
  const locationPromptBlock = buildLocationBindingBlock(locations);
  const worldPromptBlock = buildWorldBindingBlock(world);
  const missing: string[] = [];
  const rel = SECTION_BINDING_RELEVANCE[sectionKey] || { characters: false, locations: false, world: true };
  if (rel.characters && !characters.length) missing.push('missing_character_binding');
  if (rel.locations && !locations.length) missing.push('missing_location_binding');
  if (rel.world && !world.bound) missing.push('missing_world_binding');
  const binding_status = missing.length === 0 ? 'bound' : missing.length < 3 ? 'partially_bound' : 'unbound';

  // Compute targeting_mode: exact if caller specified targets, derived if section-rules resolved, heuristic if broad fallback
  const targeting_mode: 'exact' | 'derived' | 'heuristic' =
    (hasExactCharTarget || hasExactLocTarget) ? 'exact'
    : (characters.length > 0 || locations.length > 0) ? 'derived'
    : 'heuristic';

  console.log(`[CanonicalBinding] section=${sectionKey} chars=${characters.length} locs=${locations.length} world=${world.bound} status=${binding_status} targeting=${targeting_mode}`);
  return { characters, locations, world, characterPromptBlock, locationPromptBlock, worldPromptBlock, binding_status, missing, targeting_mode };
}

const SHOT_FRAMING: Record<ShotType, string> = {
  close_up: "Extreme close-up or tight close-up. Face filling the frame. Intimate, emotional, every pore visible. Shallow depth of field.",
  medium: "Medium shot, waist-up. Character in environment context. Balanced composition. Clear facial expression with setting visible.",
  wide: "Wide establishing shot. Sweeping, immersive cinematic scale. Characters small in frame against vast environment. Epic scope.",
  full_body: "Full body shot, head to toe. Character standing in environment. Clear silhouette and posture. Fashion editorial quality.",
  profile: "Profile view, side-on. Dramatic rim lighting. Strong silhouette against atmospheric background. Contemplative mood.",
  over_shoulder: "Over-the-shoulder perspective. Looking past one figure toward another or toward the scene. Creates depth and narrative tension.",
  detail: "Macro or detail shot. Close focus on a specific texture, object, or environmental detail. Shallow depth of field, rich texture.",
  tableau: "Tableau composition. Multiple figures arranged in deliberate, cinematic blocking — as staged for a real camera on a real film set. Precise spatial relationships, motivated positioning. Shot as a wide or mid-wide with cinema lens. Real actors, real environment, real physics. NOT a painting or illustration.",
  emotional_variant: "Same character, different emotional state. Raw emotional expression — tension, vulnerability, determination, or joy. Character-defining moment.",
  atmospheric: "Atmospheric mid-shot. Focus on mood, weather, light quality. Fog, rain, golden hour, or dramatic clouds. Environmental storytelling.",
  time_variant: "Same location, different time of day. Dawn/dusk/night variant. Dramatic lighting shift. Temporal contrast.",
  lighting_ref: "Lighting reference — real film set lighting setup. Show practical and motivated light sources. Key light direction, fill ratio, color temperature, hard vs soft shadows. As seen on a professional film set with cinema-grade lighting fixtures. Real environments, real physics of light.",
  texture_ref: "Material and surface reference — real-world production design. Close-up on key physical materials: weathered wood, concrete, fabric weave, skin texture, metal patina, natural stone. Shot with macro lens, shallow DOF. Tactile, grounded, zero abstraction.",
  composition_ref: "Cinematography composition reference — real camera framing. Demonstrate specific framing grammar: rule of thirds, leading lines, negative space, symmetry. Show an actual physical environment framed through a cinema lens. No abstract or symbolic composition.",
  color_ref: "Color grading reference — real-world color palette in context. Show actual environments and surfaces demonstrating the project's chromatic identity: dominant hues, accent temperature, saturation level. Grounded in physical space, not abstract color fields.",
  identity_headshot: "IDENTITY REFERENCE — Front-facing headshot. Head and shoulders centered in frame. Plain neutral grey or off-white backdrop. Soft, even studio lighting (key + fill, no dramatic shadows). Neutral expression. No environmental context. No narrative elements. Clean casting-photo style. Face clearly visible, eyes to camera.",
  identity_profile: "IDENTITY REFERENCE — Three-quarter or side profile view. Head and upper body. Plain neutral backdrop. Soft studio lighting revealing facial structure from the side. Neutral expression. No environmental context. Clean reference photography style.",
  identity_full_body: "IDENTITY REFERENCE — Full body, head to toe, centered in frame. Neutral standing pose showing full proportions. Plain neutral grey or off-white backdrop. Even studio lighting. Baseline neutral wardrobe (simple, non-costume clothing). No environmental context, no props, no narrative. Casting reference style.",
};

// ── Shot-type specific identity enforcement ──────────────────────────────────

const SHOT_TYPE_IDENTITY_CONSTRAINTS: Partial<Record<ShotType, string>> = {
  identity_full_body: "Full-body framing MUST preserve accurate human proportions consistent with identity reference. Do NOT reinterpret height, build, or body type. Head-to-body ratio must match reference exactly.",
  full_body: "Full-body framing MUST preserve accurate human proportions consistent with identity reference. Do NOT reinterpret height, build, or body type. Head-to-body ratio must match reference exactly.",
  close_up: "Facial structure MUST match identity reference exactly. Eye shape, nose, jawline, cheekbone structure must be identical.",
  identity_headshot: "Facial structure MUST match identity reference exactly. Eye shape, nose, jawline, cheekbone structure must be identical.",
  medium: "Character proportions and facial structure must match identity reference. Waist-up framing must preserve build and shoulder width.",
  profile: "Side profile must match identity reference — nose shape, jawline angle, brow ridge, forehead slope must be consistent.",
  identity_profile: "Side profile must match identity reference — nose shape, jawline angle, brow ridge, forehead slope must be consistent.",
};

/**
 * Build the full identity lock mandate for prompt injection.
 * This is the hardest constraint — placed right after canon facts.
 */
function buildIdentityLockMandate(characterName: string, identitySignatureBlock: string | null): string {
  const lines = [
    `[IDENTITY LOCK — DO NOT DEVIATE]`,
    ``,
    `This character MUST match the same person defined by the locked identity images.`,
    ``,
    `Maintain STRICT consistency in:`,
    `- Facial structure (exact match — eye shape, eye spacing, nose shape, jawline, cheekbone structure, brow ridge)`,
    `- Body proportions (height, build, shoulder width, head-to-body ratio)`,
    `- Posture and silhouette`,
    `- Skin tone, complexion, and facial proportions`,
    `- Hair color, hair texture, hairline position`,
    `- Wardrobe baseline (unless explicitly changed by state modifier)`,
    ``,
    `This is the SAME individual, not a variation or reinterpretation.`,
    ``,
    `REJECT:`,
    `- Different face, different age, different build, different ethnicity`,
    `- Different bone structure, different head-to-body ratio`,
    `- Idealized or beautified version of the reference`,
    `- "Similar-looking person" — must be UNMISTAKABLY identical`,
  ];

  if (identitySignatureBlock) {
    lines.push('', identitySignatureBlock);
  }

  return lines.join('\n');
}

function buildIdentityPrompt(characterName: string, shotType: ShotType, ctx: SectionContext): string {
  const framing = SHOT_FRAMING[shotType];
  const characterDesc = ctx.characters || "A distinctive individual with clear, memorable features.";

  return [
    `CHARACTER IDENTITY REFERENCE for "${characterName}" from "${ctx.title}".`,
    ``,
    `${framing}`,
    ``,
    `CHARACTER: ${characterName}. ${characterDesc}`,
    ``,
    `IDENTITY MANDATE:`,
    `- This is a CASTING REFERENCE photo, not a film still`,
    `- Plain neutral grey or off-white studio backdrop`,
    `- Soft, even studio lighting — no dramatic shadows, no colored gels`,
    `- Neutral baseline wardrobe — simple, non-costume clothing appropriate to the character`,
    `- NO environmental context, NO props, NO narrative elements`,
    `- NO cinematic framing tricks — clean, direct, unambiguous reference`,
    `- The same person must be recognizable across all identity reference images`,
    `- Consistent facial structure, skin tone, hair, and body proportions`,
    ``,
    `PHOTOREALISM: ${ctx.stylePolicy.styleDirectives}`,
    ``,
    `ABSOLUTE PROHIBITIONS:`,
    `- No cinematic scene context or environmental storytelling`,
    `- No dramatic or emotional poses`,
    `- No action, no motion blur, no dynamic composition`,
    `- No text, titles, watermarks, or typography`,
    `- No illustration, painting, or CGI look`,
    `- ${ctx.stylePolicy.negativeStyleConstraints}`,
    ``,
    `TECHNICAL: High-resolution studio photography quality. Even lighting. Sharp focus across entire subject.`,
  ].join("\n");
}

function buildPackPrompt(assetGroup: AssetGroup, shotType: ShotType, ctx: SectionContext): string {
  const framing = SHOT_FRAMING[shotType];

  let subjectDescription = "";
  switch (assetGroup) {
    case "character":
      subjectDescription = ctx.characterName
        ? `Character: ${ctx.characterName}. ${ctx.characters || "A compelling screen presence with emotional depth."}`
        : ctx.characters || "The protagonist — a compelling screen presence with emotional depth.";
      break;
    case "world":
      if (ctx.locationName) {
        subjectDescription = `Location: "${ctx.locationName}". ${ctx.locationDescription || ctx.worldDescription || "A cinematic environment rendered with atmospheric depth."}`;
      } else {
        subjectDescription = ctx.worldDescription || "The story's world rendered with atmospheric depth and cinematic grandeur.";
      }
      break;
    case "key_moment": {
      const castLine = ctx.boundCharacterNames?.length
        ? `Characters who MUST appear: ${ctx.boundCharacterNames.join(', ')}. `
        : '';
      subjectDescription = [
        castLine,
        ctx.conflict || ctx.logline || "A pivotal dramatic scene of tension and emotional stakes.",
        "Stage this as a real moment captured on a live-action film set with real actors in a real physical environment.",
        "Symbolic meaning must emerge through staging, composition, lighting, and actor placement — NOT through illustrative, painterly, or concept-art rendering.",
        "This must look like a production still from a theatrically released live-action film.",
      ].filter(Boolean).join(" ");
      break;
    }
    case "visual_language":
      subjectDescription = `Production design reference for "${ctx.title}". Focus on real-world cinematography: lighting setups, lens choices, color grading, practical textures, and architectural composition. No abstract or symbolic imagery.`;
      break;
  }

  const driftExclusions = [
    'No dragons, no fantasy creatures, no mythical beasts, no supernatural entities',
    'No symbolic fantasy imagery, no magical effects, no sci-fi elements unless explicitly part of the project',
    'Ground all imagery in real-world production design',
  ].join('. ');

  return [
    `A cinematic film still for "${ctx.title}".`,
    ``,
    `SHOT TYPE: ${framing}`,
    ``,
    `SUBJECT: ${subjectDescription}`,
    ``,
    `TONE: ${ctx.tone || "dramatic"}. Genre: ${ctx.genres?.join(", ") || "drama"}.`,
    ``,
    `PHOTOREALISM MANDATE: ${ctx.stylePolicy.styleDirectives}`,
    ``,
    `ABSOLUTE PROHIBITIONS:`,
    `- ${ctx.stylePolicy.negativeStyleConstraints}`,
    `- No text, titles, watermarks, or typography of any kind`,
    `- No illustrated or painted look`,
    `- ${driftExclusions}`,
    `- Must look indistinguishable from a still frame from a theatrically released film`,
    ``,
    `TECHNICAL: Premium cinematic quality. Anamorphic lens characteristics.`,
  ].join("\n");
}

function buildSectionPrompt(section: LookbookSection, ctx: SectionContext, variantIndex: number): string {
  const pack = SHOT_PACKS[section === "character" ? "character" : section === "world" ? "world" : section === "key_moment" ? "key_moment" : "visual_language"];
  const shotType = pack[variantIndex % pack.length];
  return buildPackPrompt(section as AssetGroup, shotType, ctx);
}

// ── Image generation ─────────────────────────────────────────────────────────

interface ProviderImageResult {
  imageDataUrl: string;
  format: string;
  rawBytes: Uint8Array;
}

function extractImageFromResponse(aiData: unknown): ProviderImageResult {
  const data = aiData as Record<string, unknown>;
  const choices = data?.choices as Array<Record<string, unknown>> | undefined;
  if (choices?.length) {
    const message = choices[0]?.message as Record<string, unknown> | undefined;
    const images = message?.images as Array<Record<string, unknown>> | undefined;
    if (images?.length) {
      const imageUrl = (images[0]?.image_url as Record<string, unknown>)?.url as string;
      if (imageUrl) return parseDataUrl(imageUrl);
    }
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === "image_url" && part?.image_url?.url) return parseDataUrl(part.image_url.url as string);
        if (part?.inline_data?.data && part?.inline_data?.mime_type) {
          const mimeType = part.inline_data.mime_type as string;
          const ext = mimeType.split("/")[1] || "png";
          const b64 = part.inline_data.data as string;
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          return { imageDataUrl: `data:${mimeType};base64,${b64}`, format: ext, rawBytes: bytes };
        }
      }
    }
  }
  throw new Error("No image found in AI response");
}

function parseDataUrl(dataUrl: string): ProviderImageResult {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URL format");
  const format = match[1];
  const rawBytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  return { imageDataUrl: dataUrl, format, rawBytes };
}

async function generateImage(
  apiKey: string,
  prompt: string,
  model: string,
  gatewayUrl: string,
  referenceImageUrls?: string[],
  requestedWidth?: number,
  requestedHeight?: number,
): Promise<ProviderImageResult> {
  const content: Array<Record<string, unknown>> = [];
  if (referenceImageUrls?.length) {
    for (const url of referenceImageUrls) {
      content.push({ type: "image_url", image_url: { url } });
    }
  }
  content.push({ type: "text", text: prompt });

  // Build request body — include size hints when available
  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content }],
    modalities: ["image", "text"],
  };

  // Pass explicit image size parameters to provider when available
  // The provider may or may not honor these, which is why we measure actual output
  if (requestedWidth && requestedHeight) {
    requestBody.image_size = { width: requestedWidth, height: requestedHeight };
    console.log(`[generateImage] Requesting explicit dimensions: ${requestedWidth}x${requestedHeight}`);
  }

  const resp = await fetch(gatewayUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AI gateway error [${resp.status}]: ${errText}`);
  }
  return extractImageFromResponse(await resp.json());
}

/**
 * Measure actual image dimensions from raw PNG/JPEG bytes.
 * Returns { width, height } or null if unreadable.
 */
function measureImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG: bytes 16-19 = width, 20-23 = height (big-endian uint32)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    if (bytes.length < 24) return null;
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (width > 0 && height > 0 && width < 20000 && height < 20000) return { width, height };
  }
  // JPEG: scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let offset = 2;
    while (offset < bytes.length - 8) {
      if (bytes[offset] !== 0xFF) { offset++; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xC0 || marker === 0xC2) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        if (width > 0 && height > 0 && width < 20000 && height < 20000) return { width, height };
      }
      const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + segLen;
    }
  }
  // WebP: RIFF....WEBPVP8 header
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    // VP8 lossy: width at offset 26, height at 28 (little-endian uint16)
    if (bytes.length >= 30 && bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3FFF;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3FFF;
      if (width > 0 && height > 0) return { width, height };
    }
  }
  return null;
}

// ── Role mapping ─────────────────────────────────────────────────────────────

const SECTION_TO_ROLE: Record<LookbookSection, string> = {
  world: "world_establishing",
  character: "character_primary",
  key_moment: "visual_reference",
  visual_language: "visual_reference",
};

const SECTION_TO_ASSET_GROUP: Record<LookbookSection, AssetGroup> = {
  world: "world",
  character: "character",
  key_moment: "key_moment",
  visual_language: "visual_language",
};

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      project_id, section, count = 4, entity_id, character_name,
      character_names: requestedCharacterNames,
      asset_group: requestedAssetGroup, pack_mode = false,
      base_look_mode = false,
      location_name, location_description,
      location_ref_mode = false,
      location_id = null,
      location_ids: requestedLocationIds,
      state_key = null,
      state_label = null,
      state_prompt_modifier = null,
      identity_mode = false,
      identity_anchor_paths = null,
      identity_notes = null,
      identity_canon_facts = null,
      identity_traits_block = null,
      identity_signature_block = null,
      forced_shot_type = null,
      // ── VERTICAL COMPLIANCE: explicit aspect ratio from client ──
      width: requestedWidth = null,
      height: requestedHeight = null,
      aspect_ratio: requestedAspectRatio = null,
    } = body as {
      project_id: string;
      section: LookbookSection;
      count?: number;
      entity_id?: string;
      character_name?: string;
      character_names?: string[];
      asset_group?: AssetGroup;
      pack_mode?: boolean;
      base_look_mode?: boolean;
      location_name?: string;
      location_description?: string;
      location_ref_mode?: boolean;
      location_id?: string | null;
      location_ids?: string[];
      state_key?: string | null;
      state_label?: string | null;
      state_prompt_modifier?: string | null;
      identity_mode?: boolean;
      identity_anchor_paths?: { headshot?: string; fullBody?: string } | null;
      identity_notes?: string | null;
      identity_canon_facts?: string | null;
      identity_traits_block?: string | null;
      identity_signature_block?: string | null;
      forced_shot_type?: string | null;
      width?: number | null;
      height?: number | null;
      aspect_ratio?: string | null;
    };

    // IEL: location_binding_write_enforcement — warn if world image without canon location_id
    if (requestedAssetGroup === "world" && location_name && !location_id) {
      console.warn("[IEL:location_binding_write_enforcement_violation] World image generation requested without location_id — subject_ref fallback only");
    }

    if (!project_id || !section) {
      return new Response(JSON.stringify({ error: "project_id and section required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validSections: LookbookSection[] = ["world", "character", "key_moment", "visual_language"];
    if (!validSections.includes(section)) {
      return new Response(JSON.stringify({ error: `Invalid section: ${section}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── VSAL: Resolve Visual Style Authority (soft — warns but does not block) ──
    const styleResolution = await resolveVisualStyleProfile(supabase, project_id);
    let visualStyleLock = styleResolution.lock;
    let vsalPromptBlock = styleResolution.promptBlock;
    if (!styleResolution.found || !styleResolution.complete) {
      console.warn(`[VSAL:soft] No complete visual style profile — proceeding without style authority (${styleResolution.error})`);
      visualStyleLock = null;
      vsalPromptBlock = null;
    }

    // Load project context — includes default_prestige_style for style precedence
    const { data: project } = await supabase
      .from("projects")
      .select("title, format, genres, tone, default_prestige_style")
      .eq("id", project_id)
      .single();
    if (!project) throw new Error("Project not found");

    // ── PRESTIGE STYLE SYSTEM: Resolve lane + style ─────────────────────────
    const resolvedLane = resolveFormatToLane(project.format || "film");
    const { styleKey: resolvedStyleKey, source: styleSource } = resolvePrestigeStyle({
      projectDefault: project.default_prestige_style,
      laneKey: resolvedLane,
    });
    const prestigeComposite: StyleComposite = assemblePrestigePrompt(resolvedLane, resolvedStyleKey, styleSource);
    console.log(`[prestige] lane=${resolvedLane} style=${resolvedStyleKey} source=${styleSource} aspect=${prestigeComposite.aspectRatio}`);

    // Load canon
    let worldDescription = "";
    let characters = "";
    let conflict = "";
    let themes = "";
    let logline = "";

    const { data: canon } = await supabase
      .from("project_canon")
      .select("canon_json")
      .eq("project_id", project_id)
      .maybeSingle();
    if (canon?.canon_json) {
      const cj = canon.canon_json as any;
      worldDescription = cj.world_description || cj.setting || cj.locations || "";
      logline = cj.logline || cj.premise || "";
      conflict = cj.central_conflict || "";
      themes = Array.isArray(cj.themes) ? cj.themes.join(", ") : (cj.themes || "");
      if (cj.characters && Array.isArray(cj.characters)) {
        characters = cj.characters.map((c: any) => typeof c === "string" ? c : `${c.name || "Unknown"} (${c.role || ""})`).slice(0, 4).join(", ");
      }
    }

    // ── CANONICAL VISUAL BINDING: Auto-resolve character, location, world ──
    const canonicalBindings = await resolveCanonicalBindings(
      supabase, project_id, section, canon?.canon_json || null,
      character_name, location_id, location_name,
      requestedCharacterNames, requestedLocationIds,
    );

    const stylePolicy = resolveStylePolicy(project.format || "film", project.genres || []);
    const imageRole = SECTION_TO_ROLE[section] as ImageRole;
    const styleMode = stylePolicy.mode as ImageStyleMode;
    const assetGroup = requestedAssetGroup || SECTION_TO_ASSET_GROUP[section];

    const ctx: SectionContext = {
      title: project.title || "Untitled",
      format: project.format || "film",
      genres: project.genres || [],
      tone: project.tone || "dramatic",
      worldDescription,
      characters,
      conflict,
      themes,
      logline,
      stylePolicy,
      characterName: character_name,
      locationName: location_name,
      locationDescription: location_description,
      worldBindingBlock: canonicalBindings.worldPromptBlock,
      locationBindingBlock: canonicalBindings.locationPromptBlock,
      characterBindingBlock: canonicalBindings.characterPromptBlock,
      boundCharacterNames: canonicalBindings.characters.map(c => c.character_name),
    };

    // ── Resolve identity anchor signed URLs if provided ──
    const identityReferenceUrls: string[] = [];
    let identityLockUsed = false;
    let headshotAnchorUsed = false;
    let fullBodyAnchorUsed = false;

    if (identity_anchor_paths && (identity_anchor_paths.headshot || identity_anchor_paths.fullBody)) {
      if (identity_anchor_paths.headshot) {
        try {
          const { data: signedData } = await supabase.storage
            .from("project-posters")
            .createSignedUrl(identity_anchor_paths.headshot, 3600);
          if (signedData?.signedUrl) {
            identityReferenceUrls.push(signedData.signedUrl);
            headshotAnchorUsed = true;
          }
        } catch (e) {
          console.warn(`[lookbook-image] Failed to resolve headshot anchor: ${identity_anchor_paths.headshot}`, e);
        }
      }
      if (identity_anchor_paths.fullBody) {
        try {
          const { data: signedData } = await supabase.storage
            .from("project-posters")
            .createSignedUrl(identity_anchor_paths.fullBody, 3600);
          if (signedData?.signedUrl) {
            identityReferenceUrls.push(signedData.signedUrl);
            fullBodyAnchorUsed = true;
          }
        } catch (e) {
          console.warn(`[lookbook-image] Failed to resolve full-body anchor: ${identity_anchor_paths.fullBody}`, e);
        }
      }
      identityLockUsed = headshotAnchorUsed || fullBodyAnchorUsed;
    }

    console.log(`[lookbook-image] Identity lock: ${identityLockUsed ? 'ACTIVE' : 'INACTIVE'}, headshot: ${headshotAnchorUsed}, fullBody: ${fullBodyAnchorUsed}, notes: ${identity_notes ? 'YES' : 'NO'}, signature: ${identity_signature_block ? 'YES' : 'NO'}`);

    // ── IEL: NEVER allow character generation without anchors when they exist ──
    // If identity_anchor_paths were provided but failed to resolve, that's a hard error
    if (identity_anchor_paths && assetGroup === "character" && !identityLockUsed) {
      console.error(`[lookbook-image] IEL VIOLATION: identity anchors provided but failed to resolve — aborting character generation`);
      return new Response(JSON.stringify({
        error: "Identity anchors provided but could not be resolved. Generation aborted to prevent drift.",
        identity_lock_failed: true,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine shots to generate
    // ── Single-slot mode: forced_shot_type overrides all pack logic ──
    const IDENTITY_PACK: ShotType[] = ["identity_headshot", "identity_profile", "identity_full_body"];
    const BASE_LOOK_PACK: ShotType[] = ["close_up", "profile", "full_body", "full_body", "medium"];
    const LOCATION_REF_PACK: ShotType[] = ["wide", "atmospheric", "detail", "time_variant"];

    let shotsToGenerate: ShotType[];
    if (forced_shot_type) {
      // Deterministic single-slot mode — generate exactly this shot type
      shotsToGenerate = [forced_shot_type as ShotType];
    } else if (identity_mode && assetGroup === "character") {
      shotsToGenerate = IDENTITY_PACK;
    } else if (base_look_mode && assetGroup === "character") {
      shotsToGenerate = BASE_LOOK_PACK;
    } else if (location_ref_mode && assetGroup === "world") {
      shotsToGenerate = LOCATION_REF_PACK;
    } else if (pack_mode) {
      shotsToGenerate = (SHOT_PACKS[assetGroup] || []);
    } else {
      shotsToGenerate = [];
    }

    // When forced or pack mode, limit to count
    if (shotsToGenerate.length > 0 && !forced_shot_type) {
      shotsToGenerate = shotsToGenerate.slice(0, Math.min(count, shotsToGenerate.length));
    }

    const genCount = shotsToGenerate.length > 0 ? shotsToGenerate.length : Math.min(Math.max(count, 1), 6);

    const results: Array<{ image_id: string; status: string; shot_type?: string; error?: string; identity_locked?: boolean }> = [];

    // ── VERTICAL COMPLIANCE: Resolve effective aspect + dimensions ──
    // Priority: client-specified > prestige system > default
    const isVerticalDramaProject = (project.format || "").toLowerCase().includes("vertical") || resolvedLane === "vertical_drama";
    const effectiveAspect = requestedAspectRatio || prestigeComposite.aspectRatio || "16:9";
    const effectiveWidth = requestedWidth || prestigeComposite.width || 1280;
    const effectiveHeight = requestedHeight || prestigeComposite.height || 720;
    console.log(`[vertical-compliance] isVD=${isVerticalDramaProject} effectiveAspect=${effectiveAspect} dims=${effectiveWidth}x${effectiveHeight}`);

    for (let i = 0; i < genCount; i++) {
      const shotType = shotsToGenerate[i] || null;

      // ── PROMPT ASSEMBLY — strict priority order ──
      // 1. Base prompt (shot framing + subject)
      // 2. Canon facts (highest data priority)
      // 3. Identity lock mandate (hard constraint)
      // 4. Identity signature (structured face/body/silhouette)
      // 5. Visual traits block (source-tagged)
      // 6. User notes (subordinate)
      // 7. State modifier
      // 8. Shot-type specific constraints

      const isIdentityShot = shotType?.startsWith("identity_");
      const isIdentityGeneration = identity_mode || (forced_shot_type && isIdentityShot);

      // Step 1: Base prompt
      let prompt: string;
      if (isIdentityGeneration && isIdentityShot && character_name) {
        prompt = buildIdentityPrompt(character_name, shotType as ShotType, ctx);
      } else {
        prompt = shotType
          ? buildPackPrompt(assetGroup, shotType, ctx)
          : buildSectionPrompt(section, ctx, i);
      }

      // ── VERTICAL COMPLIANCE: Inject strict aspect instruction into prompt ──
      if (isVerticalDramaProject && !isIdentityShot) {
        prompt = `[MANDATORY ASPECT RATIO: 9:16 PORTRAIT VERTICAL — NATIVE PHONE-SCREEN COMPOSITION]
This image MUST be composed as a native 9:16 vertical/portrait image for mobile phone screens.

FRAMING RULES:
- The image height must be significantly taller than its width (ratio ≈ 1.78:1 height-to-width)
- Frame all subjects vertically — tall compositions, NOT wide/landscape staging
- Subject should fill the vertical frame naturally
- Use vertical depth (foreground-to-background along a vertical axis)
- Mobile-native portrait framing is MANDATORY
- Do NOT compose a landscape/widescreen image
- Do NOT use letterboxing, pillarboxing, or cinematic widescreen framing
- Do NOT create a square image
- Think of this as a phone wallpaper or Instagram Story frame

\n${prompt}`;
      } else if (isVerticalDramaProject && isIdentityShot) {
        // Identity shots get their specific aspect
        const identityAspectMap: Record<string, string> = {
          identity_headshot: "1:1 SQUARE",
          identity_profile: "3:4 PORTRAIT",
          identity_full_body: "2:3 TALL PORTRAIT",
        };
        const aspectLabel = identityAspectMap[shotType || ""] || "PORTRAIT";
        prompt = `[MANDATORY ASPECT RATIO: ${aspectLabel}]\nThis identity reference image must be composed in ${aspectLabel} orientation.\n\n${prompt}`;
      }

      // Step 2: Canon facts (highest priority data)
      if (identity_canon_facts) {
        prompt += `\n\nCANON CHARACTER FACTS: ${identity_canon_facts}`;
      }

      // Step 3: Identity lock mandate (hard constraint — applies to ALL character shots when locked)
      if (identityLockUsed && assetGroup === "character" && character_name) {
        prompt += `\n\n${buildIdentityLockMandate(character_name, identity_signature_block || null)}`;
      }

      // Step 4: Visual traits block (source-tagged, prioritized)
      if (identity_traits_block) {
        prompt += `\n\n${identity_traits_block}`;
      }

      // Step 5: User identity notes (subordinate to canon and lock)
      if (identity_notes) {
        prompt += `\n\nUSER IDENTITY GUIDANCE (subordinate to canon and identity lock): ${identity_notes}`;
      }

      // Step 6: State variant modifier
      if (state_prompt_modifier) {
        prompt += `\n\nSTATE VARIANT: ${state_prompt_modifier}\nThis is a state-specific reference showing the subject in this particular condition/state. Maintain visual continuity with the base reference while clearly showing the state change. The PERSON remains the same — only the state changes.`;
      }

      // Step 7: Shot-type specific identity constraints
      if (identityLockUsed && shotType && SHOT_TYPE_IDENTITY_CONSTRAINTS[shotType as ShotType]) {
        prompt += `\n\nSHOT-TYPE CONSTRAINT: ${SHOT_TYPE_IDENTITY_CONSTRAINTS[shotType as ShotType]}`;
      }

      // Step 8: VSAL — Visual Style Authority Lock (if available)
      if (vsalPromptBlock) {
        prompt += `\n\n${vsalPromptBlock}`;
        if (visualStyleLock && visualStyleLock.forbid.length > 0) {
          prompt += `\n\nADDITIONAL PROHIBITIONS (VSAL): ${visualStyleLock.forbid.join(", ")}`;
        }
      }

      // Step 9: CANONICAL VISUAL BINDING — character, location, world truth
      // Injected AFTER identity lock (which is character-specific) to layer project-wide binding
      if (!isIdentityGeneration) {
        // For non-identity shots, build shot-specific character binding with framing rules
        if (canonicalBindings.characters.length > 0) {
          const shotSpecificCharBlock = buildCharacterBindingBlock(canonicalBindings.characters, shotType as ShotType | null);
          prompt += `\n\n${shotSpecificCharBlock}`;
        }
        if (canonicalBindings.locationPromptBlock) {
          prompt += `\n\n${canonicalBindings.locationPromptBlock}`;
        }
      }
      // World binding always applies (even to identity shots — grounds the project universe)
      if (canonicalBindings.worldPromptBlock) {
        prompt += `\n\n${canonicalBindings.worldPromptBlock}`;
      }

      const resolverInput = { role: imageRole, styleMode, strategyKey: `lookbook_${section}` };
      const genConfig = resolveImageGenerationConfig(resolverInput);
      const repoMeta = buildImageRepositoryMeta(genConfig, resolverInput);

      // Use identity references for ALL character generation when locked
      const refsForThisShot = (identityLockUsed && assetGroup === "character") ? identityReferenceUrls : [];

      try {
        const imageResult = await generateImage(LOVABLE_API_KEY, prompt, genConfig.model, genConfig.gatewayUrl, refsForThisShot.length > 0 ? refsForThisShot : undefined, effectiveWidth, effectiveHeight);

        const identitySegment = identity_mode ? '-identity' : '';
        const stateSegment = state_key ? `-${state_key}` : '';
        const storagePath = `${project_id}/lookbook/${section}/${Date.now()}-${shotType || `v${i}`}${identitySegment}${stateSegment}.${imageResult.format}`;
        const { error: uploadErr } = await supabase.storage
          .from("project-posters")
          .upload(storagePath, imageResult.rawBytes, {
            contentType: `image/${imageResult.format}`,
            upsert: true,
          });
        if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

        // ── VERTICAL COMPLIANCE: Measure ACTUAL output dimensions, not requested ──
        const measuredDims = measureImageDimensions(imageResult.rawBytes);
        const storedWidth = measuredDims?.width ?? effectiveWidth;
        const storedHeight = measuredDims?.height ?? effectiveHeight;
        const dimsSource = measuredDims ? 'measured' : 'requested_fallback';
        
        // Check if actual output matches requested aspect ratio
        const actualRatio = storedWidth > 0 ? storedHeight / storedWidth : 0;
        const requestedRatio = effectiveWidth > 0 ? effectiveHeight / effectiveWidth : 0;
        const aspectDrift = Math.abs(actualRatio - requestedRatio);
        const aspectCompliant = aspectDrift < 0.15;
        
        if (!aspectCompliant && isVerticalDramaProject) {
          console.warn(`[vertical-compliance] ASPECT DRIFT: requested ${effectiveWidth}x${effectiveHeight} (ratio=${requestedRatio.toFixed(2)}), got ${storedWidth}x${storedHeight} (ratio=${actualRatio.toFixed(2)}), drift=${aspectDrift.toFixed(2)}`);
        }
        console.log(`[vertical-compliance] dims_source=${dimsSource} actual=${storedWidth}x${storedHeight} requested=${effectiveWidth}x${effectiveHeight} compliant=${aspectCompliant}`);

        const { data: imgRecord, error: insertErr } = await supabase
          .from("project_images")
          .insert({
            project_id,
            role: imageRole,
            entity_id: entity_id || null,
            strategy_key: isIdentityGeneration ? "character_identity" : `lookbook_${section}`,
            prompt_used: prompt,
            negative_prompt: isIdentityGeneration
              ? "cinematic scene, environmental context, narrative elements, dramatic lighting, props, costumes, action poses, text, watermarks, illustration, painting, CGI"
              : stylePolicy.negativeStyleConstraints,
            canon_constraints: { source_feature: isIdentityGeneration ? "character_identity_engine" : "lookbook_engine", section },
            storage_path: storagePath,
            storage_bucket: "project-posters",
            width: storedWidth,
            height: storedHeight,
            is_primary: false,
            is_active: true,
            source_poster_id: null,
            user_id: user.id,
            created_by: user.id,
            provider: genConfig.provider,
            model: genConfig.model,
            style_mode: styleMode,
            generation_config: {
              ...repoMeta,
              source_feature: isIdentityGeneration ? "character_identity_engine" : "lookbook_engine",
              section,
              variant_index: i,
              shot_type: shotType,
              state_key: state_key || null,
              // Full audit trail
              identity_mode: identity_mode || isIdentityGeneration || false,
              identity_locked: identityLockUsed,
              identity_headshot_anchor_used: headshotAnchorUsed,
              identity_full_body_anchor_used: fullBodyAnchorUsed,
              identity_anchors_count: identityReferenceUrls.length,
              identity_notes_used: !!identity_notes,
              identity_canon_facts_used: !!identity_canon_facts,
              identity_traits_used: !!identity_traits_block,
              identity_signature_used: !!identity_signature_block,
              identity_lock_strength: (headshotAnchorUsed && fullBodyAnchorUsed) ? 'strong' : (headshotAnchorUsed || fullBodyAnchorUsed) ? 'partial' : 'none',
              state_variant_used: !!state_prompt_modifier,
              // Canonical Visual Binding provenance
              canonical_binding_status: canonicalBindings.binding_status,
              canonical_binding_missing: canonicalBindings.missing,
              targeting_mode: canonicalBindings.targeting_mode,
              requested_character_names: requestedCharacterNames || (character_name ? [character_name] : []),
              resolved_character_names: canonicalBindings.characters.map(c => c.character_name),
              expected_character_count: canonicalBindings.characters.length,
              bound_dna_version_ids: canonicalBindings.characters.map(c => c.dna_version_id).filter(Boolean),
              requested_location_ids: requestedLocationIds || (location_id ? [location_id] : []),
              resolved_location_ids: canonicalBindings.locations.map(l => l.location_id),
              resolved_location_names: canonicalBindings.locations.map(l => l.canonical_name),
              world_binding_active: canonicalBindings.world.bound,
              world_binding_era: canonicalBindings.world.era || null,
              // ── VERTICAL COMPLIANCE: audit trail ──
              requested_aspect_ratio: effectiveAspect,
              requested_width: effectiveWidth,
              requested_height: effectiveHeight,
              actual_width: storedWidth,
              actual_height: storedHeight,
              dims_source: dimsSource,
              aspect_compliant: aspectCompliant,
              aspect_drift: aspectDrift,
              vertical_drama_project: isVerticalDramaProject,
            },
            asset_group: assetGroup,
            subject: character_name || location_name || null,
            shot_type: shotType,
            curation_state: "candidate",
            subject_type: assetGroup === "character" ? "character"
              : (assetGroup === "world" && location_name) ? "location"
              : assetGroup === "world" ? "world"
              : assetGroup === "key_moment" ? "moment"
              : assetGroup === "visual_language" ? "production_design"
              : null,
            subject_ref: character_name || location_name || null,
            location_ref: location_name || null,
            canon_location_id: location_id || null,
            generation_purpose: isIdentityGeneration ? "character_identity"
              : state_key ? `state_variant_${state_key}`
              : base_look_mode ? "character_reference"
              : location_ref_mode ? "location_reference"
              : `lookbook_${section}`,
            state_key: state_key || null,
            state_label: state_label || null,
            // ── PRESTIGE STYLE SYSTEM: persist lane + style metadata ──
            lane_key: resolvedLane,
            prestige_style: resolvedStyleKey,
          })
          .select("id")
          .single();

        if (insertErr) {
          console.error(`[lookbook-image] repo insert error for variant ${i}:`, insertErr.message);
          results.push({ image_id: "", status: "stored_no_repo", shot_type: shotType || undefined, error: insertErr.message, identity_locked: identityLockUsed });
        } else {
          results.push({ image_id: imgRecord.id, status: "ready", shot_type: shotType || undefined, identity_locked: identityLockUsed });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[lookbook-image] generation error for ${section} ${shotType || `variant ${i}`}:`, msg);
        results.push({ image_id: "", status: "failed", shot_type: shotType || undefined, error: msg });
      }
    }

    return new Response(JSON.stringify({
      section, asset_group: assetGroup, results,
      canonical_binding: {
        status: canonicalBindings.binding_status,
        characters_bound: canonicalBindings.characters.length,
        locations_bound: canonicalBindings.locations.length,
        world_bound: canonicalBindings.world.bound,
        missing: canonicalBindings.missing,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-lookbook-image error:", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
