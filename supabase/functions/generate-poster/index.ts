import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveImageGenerationConfig, buildImageRepositoryMeta } from "../_shared/imageGenerationResolver.ts";
import type { ImageRole, ImageStyleMode } from "../_shared/imageGenerationResolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── World Lock + Context + Style Policy ──────────────────────────────────────

// ── Image Style Policy (inline — mirrors src/lib/images/stylePolicy.ts) ─────

type ImageStyleMode = 'photorealistic_cinematic' | 'stylised_animation' | 'stylised_graphic' | 'stylised_experimental' | 'stylised_period_painterly';

interface ImageStylePolicy {
  mode: ImageStyleMode;
  rationale: string;
  styleDirectives: string;
  negativeStyleConstraints: string;
  isDefault: boolean;
}

const PHOTOREAL_DIRECTIVES = [
  'Photorealistic cinematic imagery',
  'Shot on high-end cinema camera (ARRI Alexa / RED Monstro aesthetic)',
  'Real-world materials, textures, and surfaces',
  'Believable natural or motivated lighting',
  'Cinematic depth of field with professional lens characteristics',
  'Grounded, tactile, physically plausible composition',
  'Premium theatrical realism — this should look like a still from a major motion picture',
].join('. ');

const PHOTOREAL_NEGATIVES = [
  'painterly', 'illustrative', 'cartoon', 'anime', 'graphic-novel style',
  'concept art rendering', 'abstract', 'surreal', 'watercolor',
  'oil painting', 'sketch', 'line art', 'cel-shaded', 'pop art',
  'storybook illustration', 'digital painting', 'CGI render look',
  'overly stylised', 'artificial looking', 'plastic skin texture',
  'uncanny valley', 'stock photo aesthetic',
].join(', ');

const ANIMATION_FORMATS = ['animation', 'anim-feature', 'anim-series', 'animated'];
const GRAPHIC_GENRES = ['graphic-novel', 'comic', 'manga'];

function resolveImageStylePolicy(format: string, genres: string[]): ImageStylePolicy {
  const f = format.toLowerCase();
  const gs = genres.map(g => g.toLowerCase());
  
  if (ANIMATION_FORMATS.some(af => f.includes(af))) {
    return {
      mode: 'stylised_animation', rationale: `Animation format: ${format}`, isDefault: false,
      styleDirectives: 'Stylised animated visual language. Bold shapes, expressive character design. Professional animation studio quality.',
      negativeStyleConstraints: 'photorealistic, live-action, stock photo, uncanny valley, cheap CGI',
    };
  }
  if (gs.some(g => GRAPHIC_GENRES.some(gg => g.includes(gg)))) {
    return {
      mode: 'stylised_graphic', rationale: `Graphic genre: ${gs.join(', ')}`, isDefault: false,
      styleDirectives: 'Graphic novel / comic book visual style. Bold ink work, dramatic panel composition.',
      negativeStyleConstraints: 'photorealistic, live-action, stock photo',
    };
  }
  return {
    mode: 'photorealistic_cinematic', rationale: 'Default — photorealistic cinematic', isDefault: true,
    styleDirectives: PHOTOREAL_DIRECTIVES,
    negativeStyleConstraints: PHOTOREAL_NEGATIVES,
  };
}

// ── World Lock ───────────────────────────────────────────────────────────────

interface WorldLock {

  era: string;
  geography: string;
  culture: string;
  architecture: string;
  wardrobe: string;
  technology: string;
  prohibitions: string[];
}

interface PosterPromptInputs {
  title: string;
  format: string;
  genres: string[];
  tone: string;
  budget_range: string;
  target_audience: string;
  comparable_titles: string;
  assigned_lane: string | null;
  logline: string | null;
  canon_summary: string | null;
  characters: string | null;
  conflict: string | null;
  themes: string | null;
  world_setting: string | null;
  worldLock: WorldLock;
}

interface StrategyContext {
  title: string;
  logline: string | null;
  characters: string | null;
  worldSetting: string | null;
  conflict: string | null;
  themes: string | null;
  primaryGenre: string;
  genreVisual: string;
  toneVisual: string;
  compReference: string;
  worldLock: WorldLock;
  writerCredit: string;
  companyCredit: string;
  stylePolicy: ImageStylePolicy;
}

// ── Derive World Lock from canon data ────────────────────────────────────────

function deriveWorldLock(inputs: Omit<PosterPromptInputs, "worldLock">): WorldLock {
  const ws = (inputs.world_setting || "").toLowerCase();
  const cs = (inputs.canon_summary || "").toLowerCase();
  const combined = `${ws} ${cs} ${inputs.logline || ""} ${inputs.themes || ""}`.toLowerCase();
  const genres = inputs.genres.map(g => g.toLowerCase());

  // Detect era
  let era = "contemporary";
  if (/feudal|samurai|shogun|edo|sengoku|medieval japan/i.test(combined)) era = "feudal Japan";
  else if (/medieval|middle ages|crusade|knight/i.test(combined)) era = "medieval Europe";
  else if (/victorian|1800s|19th century|gaslight/i.test(combined)) era = "Victorian era";
  else if (/renaissance|1500s|16th century/i.test(combined)) era = "Renaissance";
  else if (/ancient rome|roman empire|gladiator/i.test(combined)) era = "ancient Rome";
  else if (/ancient greece|sparta|athen/i.test(combined)) era = "ancient Greece";
  else if (/colonial|1700s|18th century|revolution/i.test(combined)) era = "18th century colonial";
  else if (/1920s|jazz age|prohibition|gatsby/i.test(combined)) era = "1920s";
  else if (/1940s|world war ii|wwii|ww2|blitz/i.test(combined)) era = "1940s wartime";
  else if (/1950s|post.?war|cold war/i.test(combined)) era = "1950s";
  else if (/1960s|sixties|civil rights/i.test(combined)) era = "1960s";
  else if (/1970s|seventies|disco/i.test(combined)) era = "1970s";
  else if (/1980s|eighties/i.test(combined)) era = "1980s";
  else if (/1990s|nineties/i.test(combined)) era = "1990s";
  else if (/futur|2[1-9]\d\d|space|dystop|cyberpunk/i.test(combined)) era = "near-future or futuristic";
  else if (/prehistoric|stone age|cave/i.test(combined)) era = "prehistoric";

  // Detect geography/culture
  let geography = "unspecified";
  let culture = "unspecified";
  if (/japan|tokyo|kyoto|osaka|samurai|shogun/i.test(combined)) { geography = "Japan"; culture = "Japanese"; }
  else if (/korea|seoul|korean/i.test(combined)) { geography = "Korea"; culture = "Korean"; }
  else if (/china|beijing|shanghai|chinese|dynasty/i.test(combined)) { geography = "China"; culture = "Chinese"; }
  else if (/india|mumbai|delhi|bollywood|indian/i.test(combined)) { geography = "India"; culture = "Indian"; }
  else if (/nigeria|lagos|nollywood|african/i.test(combined)) { geography = "West Africa"; culture = "West African"; }
  else if (/london|british|england|uk|scottish|wales/i.test(combined)) { geography = "United Kingdom"; culture = "British"; }
  else if (/paris|french|france/i.test(combined)) { geography = "France"; culture = "French"; }
  else if (/new york|los angeles|american|usa|united states/i.test(combined)) { geography = "United States"; culture = "American"; }
  else if (/mexico|mexican|cartel/i.test(combined)) { geography = "Mexico"; culture = "Mexican"; }
  else if (/brazil|brazilian|rio/i.test(combined)) { geography = "Brazil"; culture = "Brazilian"; }
  else if (/middle east|arab|persian|iran|iraq/i.test(combined)) { geography = "Middle East"; culture = "Middle Eastern"; }
  else if (/scandinav|viking|norse|sweden|norway|denmark/i.test(combined)) { geography = "Scandinavia"; culture = "Scandinavian/Norse"; }

  // Architecture + wardrobe from era/culture
  const archMap: Record<string, string> = {
    "feudal Japan": "traditional Japanese architecture — wooden temples, sliding shoji screens, tiled roofs, castle keeps",
    "medieval Europe": "stone castles, Gothic cathedrals, thatched villages",
    "Victorian era": "ornate Victorian buildings, gas-lit streets, industrial architecture",
    "contemporary": "modern architecture appropriate to the setting",
  };
  const wardrobeMap: Record<string, string> = {
    "feudal Japan": "traditional Japanese garments — kimono, hakama, samurai armor, period-accurate clothing",
    "medieval Europe": "medieval European clothing — tunics, armor, cloaks",
    "Victorian era": "Victorian-era clothing — long coats, corsets, top hats",
    "contemporary": "modern clothing appropriate to the setting and characters",
  };

  const architecture = archMap[era] || `architecture consistent with ${era} ${geography !== "unspecified" ? geography : "setting"}`;
  const wardrobe = wardrobeMap[era] || `clothing consistent with ${era} ${culture !== "unspecified" ? culture : "setting"}`;

  // Technology level
  let technology = "no anachronistic technology";
  if (era === "feudal Japan") technology = "no modern technology, no electronics, no firearms — only period weapons and tools";
  else if (era.includes("medieval")) technology = "no modern technology — only medieval tools, weapons, and crafts";
  else if (era === "contemporary") technology = "modern technology appropriate to setting";
  else if (era.includes("futur")) technology = "futuristic technology consistent with the setting";

  // Build prohibition list
  const prohibitions: string[] = [];
  
  // Always prohibit unless the project IS that genre
  if (!genres.includes("sci-fi") && !era.includes("futur")) {
    prohibitions.push("NO sci-fi imagery, NO spaceships, NO alien worlds, NO futuristic technology, NO neon cyberpunk");
  }
  if (!genres.includes("fantasy") && !combined.includes("magic")) {
    prohibitions.push("NO fantasy creatures, NO dragons, NO magic spells, NO wizards");
  }
  if (era === "feudal Japan") {
    prohibitions.push(
      "NO European/Western architecture or clothing",
      "NO colonial American imagery",
      "NO Victorian or Regency aesthetics",
      "NO modern cityscapes or skyscrapers",
      "NO guns or modern weapons",
    );
  }
  if (geography === "Japan" || culture === "Japanese") {
    prohibitions.push("NO non-Japanese cultural elements unless explicitly in the story");
  }
  if (!genres.includes("romance")) {
    prohibitions.push("NO romantic novel cover aesthetic");
  }
  if (!genres.includes("western")) {
    prohibitions.push("NO Wild West or American frontier imagery");
  }
  // Generic quality prohibitions
  prohibitions.push(
    "NO stock photo aesthetic",
    "NO AI-generated artifacts or glitches",
    "NO cartoonish or anime style unless the project is animation",
  );

  return { era, geography, culture, architecture, wardrobe, technology, prohibitions };
}

// ── Visual Maps ──────────────────────────────────────────────────────────────

const toneVisuals: Record<string, string> = {
  dark: "moody shadows, desaturated palette, noir-inspired lighting",
  light: "warm golden light, hopeful atmosphere, soft focus backgrounds",
  gritty: "raw textures, urban decay, handheld documentary feel",
  comedic: "bright natural colors, dynamic composition, playful energy",
  thriller: "high contrast, tension-filled composition, cool blue tones",
  dramatic: "deep cinematic shadows, rich warm tones, emotional weight",
  horror: "deep blacks, unsettling atmosphere, eerie fog, cold tones",
  romantic: "soft bokeh, warm sunset tones, intimate framing",
  epic: "sweeping vista, grand scale, dramatic sky, golden hour",
  satirical: "sharp contrast, bold framing, high-saturation photography",
  whimsical: "warm soft tones, magical-hour lighting, intimate atmosphere",
  suspenseful: "high contrast, silhouettes, tension, atmospheric haze",
};

const genreMotifs: Record<string, string> = {
  drama: "emotional portraiture, dramatic lighting",
  thriller: "shadowy figures, tension, urban nightscape",
  horror: "darkness, isolation, dread",
  comedy: "vibrant colors, expressive characters",
  "sci-fi": "futuristic elements, technological atmosphere",
  romance: "intimate composition, warm tones",
  action: "dynamic movement, explosive energy",
  crime: "noir aesthetics, urban grit",
  mystery: "obscured faces, fog, enigmatic composition",
  fantasy: "otherworldly landscapes, atmospheric depth",
  war: "epic scale, visceral intensity, smoke and earth",
  western: "vast landscapes, dusty atmosphere, golden light",
  musical: "vibrant stage lighting, performance energy",
  animation: "stylised animated visual language, bold shapes, professional animation quality",
  documentary: "authentic textures, photographic realism",
  "true-crime": "evidence board aesthetic, cold case atmosphere",
};

// ── Strategy Definitions ─────────────────────────────────────────────────────

const POSTER_STRATEGIES = [
  {
    key: "character",
    label: "Character Focus",
    briefing: (ctx: StrategyContext) =>
      `Cinematic key art for "${ctx.title}". ` +
      `The lead character dominates the frame — intense emotional expression, cinematic close-up or medium shot. ` +
      (ctx.characters ? `Character: ${ctx.characters}. ` : "") +
      `Set in ${ctx.worldLock.era}, ${ctx.worldLock.geography !== "unspecified" ? ctx.worldLock.geography : "the story's world"}. ` +
      `${ctx.worldLock.wardrobe}. ${ctx.worldLock.architecture} visible in background. ` +
      `${ctx.toneVisual}. ` +
      `Full cinematic composition filling the entire frame — use every inch for storytelling.`,
  },
  {
    key: "world",
    label: "World / Environment",
    briefing: (ctx: StrategyContext) =>
      `Cinematic key art for "${ctx.title}". ` +
      `The setting dominates — vast, atmospheric, cinematic scale. ` +
      (ctx.worldSetting ? `Setting: ${ctx.worldSetting}. ` : "") +
      `Set in ${ctx.worldLock.era}, ${ctx.worldLock.geography !== "unspecified" ? ctx.worldLock.geography : "the story's world"}. ` +
      `${ctx.worldLock.architecture}. ` +
      `Any human figure is small or silhouetted against the landscape. ` +
      `Epic composition, sweeping vista. ${ctx.toneVisual}. ` +
      `Full cinematic composition — use the entire canvas for the world.`,
  },
  {
    key: "conflict",
    label: "Conflict / Action",
    briefing: (ctx: StrategyContext) =>
      `Cinematic key art for "${ctx.title}". ` +
      `Captures the central conflict — dynamic tension, confrontation, high stakes. ` +
      (ctx.conflict ? `Conflict: ${ctx.conflict}. ` : "") +
      `Set in ${ctx.worldLock.era}, ${ctx.worldLock.geography !== "unspecified" ? ctx.worldLock.geography : "the story's world"}. ` +
      `${ctx.worldLock.wardrobe}. ${ctx.worldLock.technology}. ` +
      `Dramatic angles, sense of motion and danger. ${ctx.toneVisual}. ` +
      `Full cinematic composition — no reserved blank areas, use every part of the frame.`,
  },
  {
    key: "prestige",
    label: "Symbolic / Prestige",
    briefing: (ctx: StrategyContext) =>
      `Prestige festival-style cinematic key art for "${ctx.title}". ` +
      `Minimalist, metaphor-driven, symbolic. A24 / Cannes aesthetic. ` +
      (ctx.themes ? `Themes: ${ctx.themes}. ` : "") +
      `Visual elements drawn from ${ctx.worldLock.era} ${ctx.worldLock.culture !== "unspecified" ? ctx.worldLock.culture : ""} world. ` +
      `Restrained color palette, elegant negative space. ${ctx.toneVisual}. ` +
      `Full atmospheric composition filling the entire canvas — no empty zones.`,
  },
  {
    key: "commercial",
    label: "Commercial / High-Concept",
    briefing: (ctx: StrategyContext) =>
      `Commercial cinematic key art for "${ctx.title}". ` +
      `Bold, clear visual hook — sells from across a room. ` +
      (ctx.logline ? `Hook: ${ctx.logline.slice(0, 150)}. ` : "") +
      `Set in ${ctx.worldLock.era}, ${ctx.worldLock.geography !== "unspecified" ? ctx.worldLock.geography : "the story's world"}. ` +
      `${ctx.worldLock.wardrobe}. Strong focal point. ${ctx.toneVisual}. Mainstream appeal. ` +
      `Full cinematic composition — use the entire frame, no blank zones.`,
  },
  {
    key: "genre",
    label: "Genre Pure",
    briefing: (ctx: StrategyContext) =>
      `Genre-forward cinematic key art for "${ctx.title}" that fully commits to ${ctx.primaryGenre} genre conventions. ` +
      `Every visual cue signals the genre immediately — ${ctx.genreVisual || "dramatic cinematography"}. ` +
      `Set in ${ctx.worldLock.era}, ${ctx.worldLock.geography !== "unspecified" ? ctx.worldLock.geography : "the story's world"}. ` +
      `${ctx.worldLock.wardrobe}. ${ctx.worldLock.architecture}. ${ctx.toneVisual}. ` +
      `Full cinematic composition — fill the entire frame with genre-defining imagery.`,
  },
] as const;

// ── Resolve project truth ────────────────────────────────────────────────────

async function resolveProjectInputs(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
): Promise<PosterPromptInputs> {
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("title, format, genres, tone, budget_range, target_audience, comparable_titles, assigned_lane, source_pitch_idea_id")
    .eq("id", projectId)
    .single();

  if (projErr || !project) throw new Error(`Project not found: ${projErr?.message}`);

  let logline: string | null = null;
  if (project.source_pitch_idea_id) {
    const { data: pitch } = await supabase
      .from("pitch_ideas")
      .select("logline")
      .eq("id", project.source_pitch_idea_id)
      .single();
    if (pitch?.logline) logline = pitch.logline;
  }

  if (!logline) {
    const { data: ideaDoc } = await supabase
      .from("project_documents")
      .select("plaintext")
      .eq("project_id", projectId)
      .eq("doc_type", "idea")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ideaDoc?.plaintext) {
      const match = ideaDoc.plaintext.match(/\*?\*?Logline:?\*?\*?\s*(.+?)(?:\n|$)/i);
      if (match) logline = match[1].trim().slice(0, 300);
    }
  }

  let canon_summary: string | null = null;
  let characters: string | null = null;
  let conflict: string | null = null;
  let themes: string | null = null;
  let world_setting: string | null = null;

  const { data: canon } = await supabase
    .from("project_canon")
    .select("canon_json")
    .eq("project_id", projectId)
    .maybeSingle();
  if (canon?.canon_json) {
    const cj = canon.canon_json as any;
    const parts: string[] = [];
    if (cj.world_description) { parts.push(cj.world_description); world_setting = cj.world_description; }
    if (cj.seed_draft?.premise) parts.push(cj.seed_draft.premise);
    if (cj.setting) { parts.push(cj.setting); if (!world_setting) world_setting = cj.setting; }
    if (cj.locations) parts.push(typeof cj.locations === "string" ? cj.locations : JSON.stringify(cj.locations));
    if (cj.world_rules) parts.push(cj.world_rules);
    if (cj.premise) { parts.push(cj.premise); if (!logline) logline = cj.premise; }
    if (cj.logline) { if (!logline) logline = cj.logline; }
    if (cj.tone_style) { /* add to tone context */ }
    canon_summary = parts.join(". ").slice(0, 500) || null;

    if (cj.characters && Array.isArray(cj.characters)) {
      characters = cj.characters.map((c: any) => {
        if (typeof c === "string") return c;
        const name = c.name || "Unknown";
        const role = c.role ? ` (${c.role})` : "";
        return `${name}${role}`;
      }).slice(0, 4).join(", ");
    } else if (cj.protagonist) {
      characters = cj.protagonist;
    }

    if (cj.central_conflict) conflict = cj.central_conflict;
    if (cj.themes) {
      themes = Array.isArray(cj.themes) ? cj.themes.slice(0, 4).join(", ") : String(cj.themes);
    }
  }

  // Try character_bible doc for characters if still missing
  if (!characters) {
    const { data: charDoc } = await supabase
      .from("project_documents")
      .select("plaintext")
      .eq("project_id", projectId)
      .eq("doc_type", "character_bible")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (charDoc?.plaintext) {
      const nameMatches = charDoc.plaintext.match(/^##?\s+(.+)/gm);
      if (nameMatches) {
        characters = nameMatches.slice(0, 3).map((m: string) => m.replace(/^#+\s*/, "").trim()).join(", ");
      }
    }
  }

  // Try concept_brief for conflict/themes if still missing
  if (!conflict || !themes) {
    const { data: conceptDoc } = await supabase
      .from("project_documents")
      .select("plaintext")
      .eq("project_id", projectId)
      .eq("doc_type", "concept_brief")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (conceptDoc?.plaintext) {
      if (!conflict) {
        const cm = conceptDoc.plaintext.match(/(?:conflict|stakes|tension):?\s*(.+?)(?:\n|$)/i);
        if (cm) conflict = cm[1].trim().slice(0, 200);
      }
      if (!themes) {
        const tm = conceptDoc.plaintext.match(/(?:themes?):?\s*(.+?)(?:\n|$)/i);
        if (tm) themes = tm[1].trim().slice(0, 200);
      }
    }
  }

  const baseInputs = {
    title: project.title || "Untitled Project",
    format: project.format || "film",
    genres: project.genres || [],
    tone: project.tone || "dramatic",
    budget_range: project.budget_range || "",
    target_audience: project.target_audience || "",
    comparable_titles: project.comparable_titles || "",
    assigned_lane: project.assigned_lane,
    logline,
    canon_summary,
    characters,
    conflict,
    themes,
    world_setting,
  };

  return { ...baseInputs, worldLock: deriveWorldLock(baseInputs) };
}

// ── Resolve company branding ─────────────────────────────────────────────────

async function resolveCompanyBranding(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
): Promise<{ companyName: string; writerCredit: string }> {
  let companyName = "Paradox House";
  try {
    const { data: links } = await supabase
      .from("project_company_links")
      .select("company_id")
      .eq("project_id", projectId)
      .limit(1);
    if (links?.length) {
      const { data: company } = await supabase
        .from("production_companies")
        .select("name")
        .eq("id", (links[0] as any).company_id)
        .single();
      if (company?.name) companyName = company.name;
    }
  } catch { /* use default */ }

  return { companyName, writerCredit: "Written by Sebastian Street" };
}

// ── Build strategy context ───────────────────────────────────────────────────

function buildStrategyContext(inputs: PosterPromptInputs, branding: { companyName: string; writerCredit: string }): StrategyContext {
  const primaryGenre = inputs.genres[0] || "drama";
  const toneVisual = toneVisuals[inputs.tone?.toLowerCase()] || "cinematic atmosphere, professional lighting";
  const genreVisual = inputs.genres
    .map(g => genreMotifs[g?.toLowerCase()] || "")
    .filter(Boolean)
    .join(", ");

  let compReference = "";
  if (inputs.comparable_titles) {
    const comps = inputs.comparable_titles.split(",").map(s => s.trim()).filter(Boolean).slice(0, 3);
    if (comps.length > 0) compReference = `Visual inspiration from posters of films like ${comps.join(", ")}. `;
  }

  const stylePolicy = resolveImageStylePolicy(inputs.format, inputs.genres);

  return {
    title: inputs.title,
    logline: inputs.logline,
    characters: inputs.characters,
    worldSetting: inputs.world_setting,
    conflict: inputs.conflict,
    themes: inputs.themes,
    primaryGenre,
    genreVisual,
    toneVisual,
    compReference,
    worldLock: inputs.worldLock,
    writerCredit: branding.writerCredit,
    companyCredit: branding.companyName,
    stylePolicy,
  };
}

// ── Build final prompt ───────────────────────────────────────────────────────

function buildStrategyPrompt(strategy: typeof POSTER_STRATEGIES[number], ctx: StrategyContext): string {
  const base = strategy.briefing(ctx);

  // Style policy enforcement (global)
  const stylePolicyBlock = [
    `IMAGE STYLE POLICY (MANDATORY):`,
    `${ctx.stylePolicy.styleDirectives}`,
    `DO NOT render in these styles: ${ctx.stylePolicy.negativeStyleConstraints}`,
  ].join("\n");

  // World lock enforcement
  const worldLockBlock = [
    `CRITICAL WORLD CONSTRAINTS:`,
    `- Era: ${ctx.worldLock.era}`,
    ctx.worldLock.geography !== "unspecified" ? `- Geography: ${ctx.worldLock.geography}` : null,
    ctx.worldLock.culture !== "unspecified" ? `- Culture: ${ctx.worldLock.culture}` : null,
    `- Architecture: ${ctx.worldLock.architecture}`,
    `- Wardrobe: ${ctx.worldLock.wardrobe}`,
    `- Technology: ${ctx.worldLock.technology}`,
  ].filter(Boolean).join("\n");

  // Negative prompting
  const prohibitions = ctx.worldLock.prohibitions.length > 0
    ? `ABSOLUTE PROHIBITIONS:\n${ctx.worldLock.prohibitions.join("\n")}\n${ctx.stylePolicy.negativeStyleConstraints}`
    : `ABSOLUTE PROHIBITIONS:\n${ctx.stylePolicy.negativeStyleConstraints}`;

  // Text treatment — EXPLICITLY prohibit hallucinated names/credits
  const textTreatment = [
    `POSTER TEXT TREATMENT (CRITICAL — READ CAREFULLY):`,
    `- DO NOT render any text, titles, names, credits, or billing blocks on the image`,
    `- DO NOT invent actor names, producer names, studio names, or any credits`,
    `- DO NOT add any typography, lettering, or text overlays of any kind`,
    `- DO NOT render title cards, credit blocks, or any written words`,
    `- Generate ONLY the visual key art / background image — pure artwork, zero text`,
    `- Text and credits will be composited separately by the rendering system`,
    `- The bottom 20–25% of the image MUST be either:`,
    `  (a) a clean atmospheric gradient fading to dark/black, or`,
    `  (b) a moody out-of-focus negative space zone`,
    `  This zone is where title typography will be placed — keep it clean and dark`,
  ].join("\n");

  // Composition instructions — enforce cinematic poster composition
  const composition = [
    `CINEMATIC POSTER COMPOSITION (MANDATORY):`,
    `- This image is the KEY ART for a theatrical movie poster — treat it with that gravity`,
    `- The composition must follow the classic cinematic poster structure:`,
    `  TOP 15%: atmospheric sky, vignette, or environmental context`,
    `  MIDDLE 40–60%: primary visual subject (character, scene, symbolic element)`,
    `  LOWER 25%: atmospheric gradient fading to near-black — this is the TITLE ZONE`,
    `- The lower gradient zone MUST be clean, dark, and uncluttered — no detail, no bright elements`,
    `- Use dramatic cinematic lighting: motivated sources, depth, atmosphere`,
    `- Strong focal point with clear visual hierarchy`,
    `- Portrait 2:3 aspect ratio`,
    `- The overall feel must be PREMIUM THEATRICAL — as if this will be printed 27"×40" for a cinema lobby`,
    ctx.stylePolicy.mode === 'photorealistic_cinematic'
      ? `- Photorealistic 4K quality — shot on ARRI Alexa or RED, professional cinematography`
      : `- High production value ${ctx.stylePolicy.mode.replace(/_/g, ' ')} rendering — studio quality`,
    `- Color grade should feel cohesive and intentional, not flat or over-saturated`,
    `- DO NOT place any subject matter in the bottom 20% — that space is reserved for typography`,
  ].join("\n");

  return [base, stylePolicyBlock, ctx.compReference, worldLockBlock, prohibitions, textTreatment, composition].filter(Boolean).join("\n\n");
}

// ── Provider Adapter ─────────────────────────────────────────────────────────

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
        if (part?.type === "image_url" && part?.image_url?.url) {
          return parseDataUrl(part.image_url.url as string);
        }
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
  const dataArr = data?.data as Array<Record<string, unknown>> | undefined;
  if (dataArr?.length) {
    const b64 = dataArr[0]?.b64_json as string;
    if (b64) {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return { imageDataUrl: `data:image/png;base64,${b64}`, format: "png", rawBytes: bytes };
    }
  }
  throw new Error(`No image found in AI response. Keys: ${JSON.stringify(Object.keys(data || {}))}`);
}

function parseDataUrl(dataUrl: string): ProviderImageResult {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw new Error(`Invalid image data URL format`);
  const format = match[1];
  const rawBytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  return { imageDataUrl: dataUrl, format, rawBytes };
}

// ── Image generation ─────────────────────────────────────────────────────────

async function generateImage(apiKey: string, prompt: string, model: string, gatewayUrl: string): Promise<ProviderImageResult> {
  const aiResponse = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    if (aiResponse.status === 429) throw new Error("Rate limit exceeded");
    if (aiResponse.status === 402) throw new Error("Payment required");
    throw new Error(`AI gateway error [${aiResponse.status}]: ${errText}`);
  }

  const aiData = await aiResponse.json();
  return extractImageFromResponse(aiData);
}

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
    const { project_id, mode, strategy_key } = body;
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve project truth + branding
    const inputs = await resolveProjectInputs(supabase, project_id);
    const branding = await resolveCompanyBranding(supabase, project_id);
    const strategyCtx = buildStrategyContext(inputs, branding);

    console.log("World lock:", JSON.stringify(inputs.worldLock, null, 2));

    // Resolve image generation config via shared API resolver
    const styleMode = strategyCtx.stylePolicy.mode as ImageStyleMode;

    // ── Mode: multi_concept — generate 6 strategy posters ──
    if (mode === "multi_concept") {
      const strategies = strategy_key
        ? POSTER_STRATEGIES.filter(s => s.key === strategy_key)
        : [...POSTER_STRATEGIES];

      const results: Array<{
        strategy_key: string;
        strategy_label: string;
        poster_id: string;
        status: string;
        error?: string;
      }> = [];

      const { data: existingPosters } = await supabase
        .from("project_posters")
        .select("version_number")
        .eq("project_id", project_id)
        .order("version_number", { ascending: false })
        .limit(1);
      let nextVersion = (existingPosters?.[0]?.version_number || 0) + 1;

      for (const strategy of strategies) {
        const prompt = buildStrategyPrompt(strategy, strategyCtx);
        const versionNum = nextVersion++;

        // Resolve provider/model via shared API resolver
        const variantInput = { role: 'poster_variant' as ImageRole, styleMode, strategyKey: strategy.key };
        const genConfig = resolveImageGenerationConfig(variantInput);
        const repoMeta = buildImageRepositoryMeta(genConfig, variantInput);

        const { data: posterRecord, error: insertErr } = await supabase
          .from("project_posters")
          .insert({
            project_id,
            user_id: user.id,
            version_number: versionNum,
            status: "generating",
            source_type: "generated",
            aspect_ratio: "2:3",
            layout_variant: strategy.key,
            prompt_text: prompt,
            prompt_inputs: { ...inputs, strategy_key: strategy.key, strategy_label: strategy.label, world_lock: inputs.worldLock },
            provider: genConfig.provider,
            model: genConfig.model,
            render_status: "key_art_only",
            is_active: false,
          })
          .select()
          .single();

        if (insertErr) {
          results.push({ strategy_key: strategy.key, strategy_label: strategy.label, poster_id: "", status: "failed", error: insertErr.message });
          continue;
        }

        try {
          const imageResult = await generateImage(LOVABLE_API_KEY, prompt, genConfig.model, genConfig.gatewayUrl);

          const keyArtPath = `${project_id}/key-art/v${versionNum}-${strategy.key}.${imageResult.format}`;
          const { error: uploadErr } = await supabase.storage
            .from("project-posters")
            .upload(keyArtPath, imageResult.rawBytes, {
              contentType: `image/${imageResult.format}`,
              upsert: true,
            });

          if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

          await supabase.from("project_posters")
            .update({
              status: "ready",
              key_art_storage_path: keyArtPath,
              rendered_storage_path: keyArtPath,
              render_status: "key_art_only",
            })
            .eq("id", posterRecord.id);

          // Register into canonical project_images repository with resolver metadata
          const { error: repoErr } = await supabase.from("project_images").insert({
            project_id,
            role: "poster_variant",
            entity_id: null,
            strategy_key: strategy.key,
            prompt_used: prompt,
            negative_prompt: strategyCtx.stylePolicy.negativeStyleConstraints || "",
            canon_constraints: { world_lock: inputs.worldLock },
            storage_path: keyArtPath,
            storage_bucket: "project-posters",
            is_primary: false,
            is_active: true,
            source_poster_id: posterRecord.id,
            user_id: user.id,
            created_by: user.id,
            provider: genConfig.provider,
            model: genConfig.model,
            style_mode: styleMode,
            generation_config: repoMeta,
          });
          if (repoErr) {
            console.error(`[project_images] insert failed for strategy=${strategy.key}:`, repoErr.message);
          }

          results.push({ strategy_key: strategy.key, strategy_label: strategy.label, poster_id: posterRecord.id, status: "ready" });
        } catch (genErr: unknown) {
          const errMsg = genErr instanceof Error ? genErr.message : "Generation failed";
          await supabase.from("project_posters").update({ status: "failed", error_message: errMsg }).eq("id", posterRecord.id);
          results.push({ strategy_key: strategy.key, strategy_label: strategy.label, poster_id: posterRecord.id, status: "failed", error: errMsg });
          if (errMsg.includes("Rate limit") || errMsg.includes("Payment required")) break;
        }
      }

      return new Response(JSON.stringify({ results, inputs_used: inputs, world_lock: inputs.worldLock }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Mode: generate (legacy single poster) ──
    const primaryInput = { role: 'poster_primary' as ImageRole, styleMode, strategyKey: 'commercial' };
    const primaryGenConfig = resolveImageGenerationConfig(primaryInput);
    const primaryRepoMeta = buildImageRepositoryMeta(primaryGenConfig, primaryInput);

    const prompt = buildStrategyPrompt(POSTER_STRATEGIES[4], strategyCtx);

    const { data: existingPosters } = await supabase
      .from("project_posters")
      .select("version_number")
      .eq("project_id", project_id)
      .order("version_number", { ascending: false })
      .limit(1);
    const nextVersion = (existingPosters?.[0]?.version_number || 0) + 1;

    const { data: posterRecord, error: insertErr } = await supabase
      .from("project_posters")
      .insert({
        project_id,
        user_id: user.id,
        version_number: nextVersion,
        status: "generating",
        source_type: "generated",
        aspect_ratio: "2:3",
        layout_variant: "cinematic-dark",
        prompt_text: prompt,
        prompt_inputs: inputs,
        provider: primaryGenConfig.provider,
        model: primaryGenConfig.model,
        render_status: "key_art_only",
      })
      .select()
      .single();

    if (insertErr) throw new Error(`Failed to create poster record: ${insertErr.message}`);

    try {
      const imageResult = await generateImage(LOVABLE_API_KEY, prompt, primaryGenConfig.model, primaryGenConfig.gatewayUrl);

      const keyArtPath = `${project_id}/key-art/v${nextVersion}.${imageResult.format}`;
      const { error: uploadErr } = await supabase.storage
        .from("project-posters")
        .upload(keyArtPath, imageResult.rawBytes, {
          contentType: `image/${imageResult.format}`,
          upsert: true,
        });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      await supabase.from("project_posters")
        .update({ is_active: false })
        .eq("project_id", project_id)
        .neq("id", posterRecord.id);

      const { data: updatedPoster, error: updateErr } = await supabase
        .from("project_posters")
        .update({
          status: "ready",
          is_active: true,
          key_art_storage_path: keyArtPath,
          rendered_storage_path: keyArtPath,
          render_status: "key_art_only",
        })
        .eq("id", posterRecord.id)
        .select()
        .single();

      if (updateErr) throw new Error(`Failed to update poster: ${updateErr.message}`);

      // Register into canonical project_images repository
      await supabase.from("project_images")
        .update({ is_primary: false, is_active: false })
        .eq("project_id", project_id)
        .eq("role", "poster_primary")
        .eq("is_primary", true);

      const { error: repoErr } = await supabase.from("project_images").insert({
        project_id,
        role: "poster_primary",
        entity_id: null,
        strategy_key: "commercial",
        prompt_used: prompt,
        negative_prompt: strategyCtx.stylePolicy.negativeStyleConstraints || "",
        canon_constraints: { world_lock: inputs.worldLock },
        storage_path: keyArtPath,
        storage_bucket: "project-posters",
        is_primary: true,
        is_active: true,
        source_poster_id: posterRecord.id,
        user_id: user.id,
        created_by: user.id,
        provider: primaryGenConfig.provider,
        model: primaryGenConfig.model,
        style_mode: styleMode,
        generation_config: primaryRepoMeta,
      });
      if (repoErr) {
        console.error(`[project_images] legacy insert failed:`, repoErr.message);
      }

      return new Response(JSON.stringify({ poster: updatedPoster }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (genErr: unknown) {
      const errMsg = genErr instanceof Error ? genErr.message : "Unknown generation error";
      await supabase.from("project_posters").update({ status: "failed", error_message: errMsg }).eq("id", posterRecord.id);
      return new Response(JSON.stringify({ error: errMsg, poster_id: posterRecord.id }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-poster error:", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
