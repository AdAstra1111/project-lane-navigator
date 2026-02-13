import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRODUCTION_TYPE_PROMPTS: Record<string, string> = {
  film: `For a NARRATIVE FEATURE FILM, generate:
- Treatment: 8-15 page narrative treatment with three-act structure, key scenes, turning points, and visual storytelling notes
- Character Bible: protagonist, antagonist, and 3-5 supporting characters with arcs, motivations, flaws, and transformation
- World Bible: setting rules, time period, visual palette, cultural context, and production design notes
- Tone Doc: tonal references, directorial approach, cinematography style, score direction, and comparable tonal touchstones
- Arc Map: act-by-act breakdown with emotional beats, thematic progression, and climax structure`,

  'tv-series': `For a TV SERIES, generate:
- Treatment: 8-15 page series bible covering pilot storyline, season arc, episode cadence, and long-term series potential
- Character Bible: ensemble cast with individual arcs per season, relationship dynamics, and evolution across seasons
- World Bible: series universe rules, recurring locations, mythology/lore, and expandable world elements
- Tone Doc: episodic tone consistency, cold open strategy, act break patterns, and tonal evolution across seasons
- Arc Map: season arc with A/B/C storylines, mid-season pivot, finale setup, and cliffhanger strategy`,

  documentary: `For a DOCUMENTARY, generate:
- Treatment: 8-15 page editorial approach covering subject access, narrative structure (chronological/thematic/character-driven), and interview strategy
- Character Bible: key subjects/interviewees with their story significance, access level, and narrative role
- World Bible: historical/social context, archival material plan, location significance, and visual evidence strategy
- Tone Doc: observational vs directed approach, voice-over strategy, music approach, and editorial perspective
- Arc Map: thematic progression through chapters/acts, revelation structure, and emotional journey for viewer`,

  'documentary-series': `For a DOCUMENTARY SERIES, generate:
- Treatment: 8-15 page series approach with episode breakdown, thematic throughlines, and cross-episode narrative
- Character Bible: recurring subjects across episodes, expert contributors, and narrative anchors
- World Bible: investigative framework, evidence chain, access strategy, and archival/research plan
- Tone Doc: series visual identity, pacing between episodes, revelatory structure, and audience engagement strategy
- Arc Map: episode-by-episode breakdown with individual and overarching narrative arcs`,

  'short-film': `For a SHORT FILM, generate:
- Treatment: 4-8 page treatment focused on economy of storytelling, single dramatic question, and visual impact
- Character Bible: 1-3 characters with compressed arcs, immediate stakes, and memorable defining traits
- World Bible: contained world-building, single location maximization, and visual symbolism
- Tone Doc: festival-friendly tonal positioning, visual signature, and emotional precision
- Arc Map: compressed three-act or vignette structure with precise emotional beats`,

  'digital-series': `For a DIGITAL SERIES, generate:
- Treatment: 8-12 page approach covering platform-native storytelling, episode length strategy, and binge vs weekly release
- Character Bible: digitally-native characters, parasocial engagement hooks, and community-driven arcs
- World Bible: platform-specific world rules, interactive elements, and cross-platform expansion potential
- Tone Doc: platform tone alignment, thumbnail/scroll-stop strategy, and algorithmic-friendly pacing
- Arc Map: micro-episode structure, season hooks, and audience retention beats`,

  commercial: `For a COMMERCIAL/ADVERT, generate:
- Treatment: 3-6 page campaign treatment covering hero spot concept, extended cut, and cutdown strategy
- Character Bible: brand persona, talent/spokesperson approach, and audience identification characters
- World Bible: brand universe rules, visual brand language, and campaign extensibility
- Tone Doc: brand voice alignment, emotional trigger strategy, music/sound design direction, and cultural moment positioning
- Arc Map: spot narrative arc (problem-solution-aspiration), campaign rollout sequence, and cross-media touchpoints`,

  'branded-content': `For BRANDED CONTENT, generate:
- Treatment: 6-10 page content strategy covering editorial narrative, brand integration approach, and distribution plan
- Character Bible: content hosts/talent, brand ambassadors, and audience surrogate characters
- World Bible: content universe tied to brand values, recurring formats, and community integration
- Tone Doc: editorial vs commercial balance, authenticity markers, and platform-native tone
- Arc Map: content series arc, brand message layering, and audience journey from awareness to conversion`,

  'vertical-drama': `For a VERTICAL DRAMA, generate:
- Treatment: 4-8 page mobile-first narrative approach, scroll-native storytelling, and episode micro-structure
- Character Bible: characters optimized for close-up intimacy, direct-to-camera moments, and parasocial hooks
- World Bible: vertically-framed world rules, POV constraints, and platform-native visual language
- Tone Doc: mobile viewing context, notification-interrupt pacing, sound-on vs sound-off strategy, and caption integration
- Arc Map: micro-episode beats (30-90 seconds), season hook structure, and daily/weekly release cadence`,

  'music-video': `For a MUSIC VIDEO, generate:
- Treatment: 4-6 page visual concept tied to track structure, artist persona, and visual narrative
- Character Bible: artist performance persona, narrative characters (if applicable), and visual archetypes
- World Bible: visual universe rules, color palette, set/location design, and choreography/movement language
- Tone Doc: visual references, editing rhythm synced to track, VFX approach, and cultural/aesthetic positioning
- Arc Map: verse/chorus/bridge visual progression, performance vs narrative balance, and climax visual moment`,

  'proof-of-concept': `For a PROOF OF CONCEPT, generate:
- Treatment: 3-6 page focused pitch demonstrating scalability from proof to full production
- Character Bible: core characters that demonstrate range and series/feature potential
- World Bible: world rules that hint at larger mythology while staying contained for proof budget
- Tone Doc: production value strategy (maximize limited resources), visual ambition markers
- Arc Map: self-contained dramatic arc that serves as both standalone and pilot/opening for larger work`,
};

function parseSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {
    treatment: '',
    character_bible: '',
    world_bible: '',
    tone_doc: '',
    arc_map: '',
  };

  const markers = [
    { key: 'treatment', patterns: ['## TREATMENT', '## Treatment', '# TREATMENT', '# Treatment', '**TREATMENT**', '**Treatment**'] },
    { key: 'character_bible', patterns: ['## CHARACTER BIBLE', '## Character Bible', '# CHARACTER BIBLE', '# Character Bible', '**CHARACTER BIBLE**', '**Character Bible**'] },
    { key: 'world_bible', patterns: ['## WORLD BIBLE', '## World Bible', '# WORLD BIBLE', '# World Bible', '**WORLD BIBLE**', '**World Bible**'] },
    { key: 'tone_doc', patterns: ['## TONE DOC', '## Tone Doc', '# TONE DOC', '# Tone Doc', '**TONE DOC**', '**Tone Doc**', '## TONE DOCUMENT', '## Tone Document'] },
    { key: 'arc_map', patterns: ['## ARC MAP', '## Arc Map', '# ARC MAP', '# Arc Map', '**ARC MAP**', '**Arc Map**'] },
  ];

  // Find positions of each section
  const positions: { key: string; index: number }[] = [];
  for (const m of markers) {
    for (const p of m.patterns) {
      const idx = text.indexOf(p);
      if (idx !== -1) {
        positions.push({ key: m.key, index: idx });
        break;
      }
    }
  }

  positions.sort((a, b) => a.index - b.index);

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index;
    const end = i + 1 < positions.length ? positions[i + 1].index : text.length;
    // Skip the header line itself
    const headerEnd = text.indexOf('\n', start);
    sections[positions[i].key] = text.slice(headerEnd !== -1 ? headerEnd + 1 : start, end).trim();
  }

  // Fallback: if no sections found, put everything in treatment
  if (positions.length === 0) {
    sections.treatment = text;
  }

  return sections;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { pitchIdea, productionType } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const typeKey = productionType || 'film';
    const typePrompt = PRODUCTION_TYPE_PROMPTS[typeKey] || PRODUCTION_TYPE_PROMPTS.film;

    const systemPrompt = `You are an elite development executive and creative producer. You expand pitch concepts into production-ready development packages.

${typePrompt}

CRITICAL FORMAT RULES:
- Use these exact markdown headers to separate each section:
  ## TREATMENT
  ## CHARACTER BIBLE
  ## WORLD BIBLE
  ## TONE DOC
  ## ARC MAP
- Every output must be specific to this concept — no generic templates
- Treatment must be detailed narrative prose (8-15 pages equivalent), not bullet points
- Character bible must include psychological depth, not just descriptions
- All outputs must be internally consistent
- Reference the concept's genre, tone, budget band, and target lane throughout
- Be production-aware: flag any elements that affect budget or schedule`;

    const userPrompt = `Expand this pitch concept into a full development package:

TITLE: ${pitchIdea.title}
LOGLINE: ${pitchIdea.logline}
ONE-PAGE PITCH: ${pitchIdea.one_page_pitch}
GENRE: ${pitchIdea.genre}
PRODUCTION TYPE: ${typeKey}
BUDGET BAND: ${pitchIdea.budget_band}
RECOMMENDED LANE: ${pitchIdea.recommended_lane}
RISK LEVEL: ${pitchIdea.risk_level}
COMPARABLES: ${(pitchIdea.comps || []).join(', ')}
WHY US: ${pitchIdea.why_us || 'N/A'}

Generate the complete development package with all five sections using the exact headers specified.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limited, try again shortly" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "Credits required" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content in AI response");

    const expansion = parseSections(content);

    return new Response(JSON.stringify(expansion), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("expand-concept error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
