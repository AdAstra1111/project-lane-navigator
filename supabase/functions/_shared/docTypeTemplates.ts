/**
 * docTypeTemplates.ts — Canonical scaffold templates for each document type.
 *
 * Purpose: Every document generation starts from a defined markdown skeleton.
 * The LLM's job is to FILL the template with high-quality project-specific content,
 * not to invent structure. This guarantees:
 *  - Output is always markdown (never JSON)
 *  - All required sections are present
 *  - Consistent format across generations and rewrite cycles
 *  - Less token waste on structural decisions → more on content quality
 *
 * Usage: inject into user prompt via buildTemplatePrompt().
 */

export interface TemplateContext {
  title?: string;
  format?: string;
  episodeCount?: number;
  episodeDurationMin?: number;
  episodeDurationMax?: number;
  lane?: string;
}

/** Returns the canonical template for a doc type, with context substituted. */
export function getDocTypeTemplate(docType: string, ctx: TemplateContext = {}): string | null {
  const title = ctx.title || "the project";
  const epCount = ctx.episodeCount || 30;
  const durMin = ctx.episodeDurationMin || 120;
  const durMax = ctx.episodeDurationMax || 180;
  const format = ctx.format || "vertical-drama";

  switch (docType) {
    // ─────────────────────────────────────────────────────────────────────────────
    case "idea":
      return `# ${title}

## LOGLINE
[One sentence — active protagonist + specific conflict + concrete stakes.]

## PREMISE
[2–3 paragraphs maximum. The core dramatic proposition: who, what situation, what's at stake, why now. Keep it concise and commercially legible.]

## GENRE & HOOK
**Genre:** [Primary genre]
**Unique hook:** [One sentence — the single element that makes this idea distinctive.]`;

    // ─────────────────────────────────────────────────────────────────────────────
    case "concept_brief":
      return `# CONCEPT BRIEF: ${title}

## LOGLINE
[One sentence — active protagonist + specific conflict + concrete stakes. No passive voice.]

## CORE PREMISE
[2–3 paragraphs. What is this story? Establish the dramatic world, the central tension, and the emotional engine that sustains the full run. Be specific — character names, situation, inciting force.]

## GENRE & TONE
**Genre:** [Primary genre / Sub-genre]
**Tone:** [Describe the emotional register — e.g. tense, romantic, darkly comic, emotionally devastating]
**Comparable titles:** [2–3 recent titles in same genre/tone space]

## THEMATIC SPINE
[The central question or human truth this story is really about. One paragraph. Not plot — meaning.]

## UNIQUE SELLING PROPOSITION
[What makes this distinct from anything currently in the market? One paragraph — be specific, not generic.]

## TARGET AUDIENCE
**Primary:** [Age range, platform behaviour, viewing context]
**Secondary:** [Broader crossover audience]

## SERIES POTENTIAL
[For episodic formats: how does this premise sustain ${epCount} episodes? What is the escalation engine?]`;

    // ─────────────────────────────────────────────────────────────────────────────
    case "market_sheet":
      return `# MARKET SHEET: ${title}

## MARKET POSITIONING
[One paragraph situating this project in the current market landscape. What gap does it fill?]

## COMPARABLE TITLES
| Title | Studio / Platform | Year | Relevance |
|---|---|---|---|
| [Comp 1] | [Studio] | [Year] | [Why it's a relevant comp] |
| [Comp 2] | [Studio] | [Year] | [Why it's a relevant comp] |
| [Comp 3] | [Studio] | [Year] | [Why it's a relevant comp] |

## TARGET AUDIENCE
**Primary demographic:** [Age, gender skew, platform, viewing behaviour]
**Psychographic profile:** [Values, interests, why this content appeals to them]
**Audience size estimate:** [Rough addressable audience figure with rationale]

## BUDGET BAND
**Estimated range:** [Budget band — e.g. micro, low, mid, high]
**Cost drivers:** [What makes this expensive or economical to produce]
**Comparable budget references:** [What similar projects cost]

## DISTRIBUTION STRATEGY
**Primary platform:** [Target distributor / platform with rationale]
**Secondary windows:** [International sales, streaming, theatrical, etc.]
**Release strategy:** [Binge, weekly, event, etc.]

## REVENUE MODEL
**Revenue streams:** [Licensing, presales, streaming deals, tax credits, brand partnerships]
**Projected return profile:** [Conservative/realistic/upside scenarios]

## COMMERCIAL HOOK
[One paragraph — the specific, distinctive element that makes a buyer lean forward. Not genre — the USP in commercial terms.]`;

    // ─────────────────────────────────────────────────────────────────────────────
    case "vertical_market_sheet":
      return `# VERTICAL MARKET SHEET: ${title}

## SERIES OVERVIEW
**Format:** Vertical drama / short-form episodic
**Episode count:** ${epCount} episodes
**Episode duration:** ${durMin}–${durMax} seconds per episode
**One-line pitch:** [Distilled in one sentence for a platform acquisition deck]

## PLATFORM TARGETING
**Primary platform:** [Named platform — e.g. TikTok Series, YouTube Shorts, Instagram Reels, Webtoon, Quibi-style OTT]
**Rationale:** [Why this platform fits the content and audience]
**Secondary platforms:** [Cross-posting / windowing opportunities]

## AUDIENCE DEMOGRAPHICS
**Core viewer:** [Age range, gender skew, platform behaviour]
**Viewing context:** [Where and how they watch — commute, lunch break, before sleep, etc.]
**Engagement pattern:** [Binge / daily habit / social sharing behaviour]

## COMPARABLE VERTICAL TITLES
| Title | Platform | Episodes | Performance Signal |
|---|---|---|---|
| [Comp 1] | [Platform] | [#] | [Views / subscriber growth / viral reach] |
| [Comp 2] | [Platform] | [#] | [Views / subscriber growth / viral reach] |
| [Comp 3] | [Platform] | [#] | [Views / subscriber growth / viral reach] |

## MONETISATION MODEL
**Primary revenue:** [Creator fund / ad revenue / brand deal / platform licensing / AVOD / SVOD]
**Secondary revenue:** [Merchandise, IP licensing, live event, sequel/spin-off rights]
**Episode economics:** [Estimated cost-per-episode vs projected revenue at scale]

## TREND & CULTURAL FIT
[Why is this the right content for right now? Specific cultural moment, genre trend, or platform appetite this taps into.]

## CONTENT DIFFERENTIATION
[What makes this stand out from the existing vertical drama landscape? Specific creative/commercial angle.]`;

    // ─────────────────────────────────────────────────────────────────────────────
    case "format_rules":
      return `# FORMAT RULES: ${title}

## EPISODE SPECIFICATIONS
- **Duration:** ${durMin}–${durMax} seconds per episode
- **Episode count:** ${epCount} episodes per season
- **Target platform:** [Primary distribution platform]
- **Aspect ratio:** [9:16 vertical / 16:9 landscape / square]

## STRUCTURAL EPISODE TEMPLATE

### HOOK (0–10 seconds)
[Specification: what must happen in the first 10 seconds? Visual rule, conflict beat, or dialogue hook requirement.]

### ACT 1 — SETUP (10–45 seconds)
[Scene structure: how many scenes, what dramatic function, pacing rule]

### ACT 2 — ESCALATION (45–[X] seconds)
[Scene structure: complication, turn, or revelation requirement]

### ACT 3 — CLIFFHANGER ([X]–end)
[Cliffhanger specification: what type of unresolved tension must close every episode?]

## SCENE CONSTRUCTION RULES
- **Scenes per episode:** [Min–max]
- **Location limit per episode:** [Max number of distinct locations]
- **Cast per episode:** [Max number of speaking roles]
- **Dialogue rule:** [e.g. no scene longer than 30 seconds of continuous dialogue]

## VISUAL & PRODUCTION CONSTRAINTS
- **Shot type priority:** [e.g. close-up and medium — no wide establishing shots]
- **Camera movement:** [e.g. handheld encouraged / static forbidden / etc.]
- **On-screen text:** [Rules for captions, title cards, etc.]

## PACING & BEAT DENSITY
- **Beats per episode:** [Target beat count]
- **Emotional beat requirement:** [Every episode must contain: hook beat, escalation beat, turn beat, cliffhanger beat]
- **Silence rule:** [Maximum sustained silence before a beat must land]

## VERTICAL-SPECIFIC RULES
[Rules specific to mobile-first viewing: scroll-stopping frame composition, text-safe zones, audio-off legibility, etc.]

## SCOPE BOUNDARY
> Format Rules govern HOW episodes are made. Story content belongs in Season Arc and Episode Grid. Character descriptions belong in Character Bible.`;

    // ─────────────────────────────────────────────────────────────────────────────
    case "character_bible":
      return `# CHARACTER BIBLE: ${title}

## PRINCIPAL CHARACTERS (CANONICAL — Tier 1)

> These are the story-defining characters. Each requires full structural depth.
> Canon-sensitive — changes here affect continuity tracking and drift detection.

### [CHARACTER NAME 1] — [Narrative Role]
**Social Position:** [Place in hierarchy / class / institution — e.g. "junior associate at a white-shoe law firm", "second son of a minor aristocratic house"]
**Functional Role:** [What they DO in the world — their job, duty, or operational function]
**World Embedding:** [Where/how they operate — physical location, daily environment, institutional context]
**Want:** [Concrete external goal — specific and measurable]
**Need:** [Internal truth they resist — must conflict with Want]
**Wound:** [Specific formative experience — not vague, name the event]
**Flaw:** [Internal limitation that generates story friction]
**Voice:** [Speech register, vocabulary level, verbal tics, what they avoid saying]
**Arc:** [Start state → breaking point → end state — concrete trajectory]

---

### [CHARACTER NAME 2] — [Narrative Role]
**Social Position:** [Hierarchy placement]
**Functional Role:** [Operational function]
**World Embedding:** [Environment and context]
**Want:** [External goal]
**Need:** [Internal truth]
**Wound:** [Formative experience]
**Flaw:** [Internal limitation]
**Voice:** [Speech pattern]
**Arc:** [Transformation trajectory]

---

### [CHARACTER NAME 3] — [Narrative Role]
[Same structure as above]

---

## ANTAGONIST / OPPOSITION FORCE (CANONICAL — Tier 1)

### [Antagonist Name] — [Narrative Role]
**Social Position:** [Where they sit in the power structure]
**Functional Role:** [How they exert influence or control]
**World Embedding:** [Their operational domain]
**Nature of opposition:** [Active villain / systemic force / internal antagonist / rival]
**Motivation:** [Concrete goal — not "evil" — what they want and why they believe they're right]
**Impact on protagonist:** [Specific pressure mechanism on the lead arc]

---

## RELATIONSHIP MAP

### [Character 1] ↔ [Character 2]
**Nature:** [Relationship type — professional, familial, romantic, adversarial]
**Power dynamic:** [Who holds leverage and why]
**Central tension:** [What they want from each other vs what they get]
**Evolution:** [How this relationship changes across the story]

### [Character 1] ↔ [Character 3]
[Same structure]

### [Character 2] ↔ [Character 3]
[Same structure]

---

## SUPPORTING CHARACTERS (OPTIONAL — Tier 2)

> Include here ONLY if they are recurring characters with meaningful narrative function.
> They may be promoted to Principal if their narrative weight increases.
> Incidental scene roles (guards, drivers, clerks) should NOT appear here — they are generated at scene level.

### [SUPPORTING CHARACTER NAME] — [Narrative Role]
**Social Position:** [Hierarchy placement]
**Functional Role:** [What they do]
**World Embedding:** [Where they operate]
**Key Relationship:** [Connection to a principal character — dynamic and function]

---

> **Note on World Density:** A lived-in world is conveyed through the institutional context,
> power structures, and social systems embedded in principal character descriptions — NOT
> through a separate list of background characters. Scene-level roles (attendants, officers,
> vendors) are generated dynamically and do not require Character Bible entries.`;

    // ─────────────────────────────────────────────────────────────────────────────
    case "season_arc":
      return `# SEASON ARC: ${title}
*${epCount} Episodes*

## SERIES PREMISE (DRAMATIC SPINE)
[The central dramatic question that drives the entire season. One paragraph. Everything hangs on this.]

## ARC STRUCTURE

### ACT 1 — ESTABLISHMENT (Episodes 1–[X])
**Episodes:** 1–[X]
**Central function:** [What this act establishes — world, characters, conflict, stakes]
**Key turning point:** Episode [N] — [What irrevocably changes and why it's the point of no return]

### ACT 2 — ESCALATION (Episodes [X]–[Y])
**Episodes:** [X]–[Y]
**Central function:** [How the central conflict deepens, complications multiply, cost rises]
**Midpoint:** Episode [N] — [The false peak or devastating reversal that reorients the story]
**Key turning point:** Episode [N] — [The lowest point / darkest moment before the final push]

### ACT 3 — RESOLUTION (Episodes [Y]–${epCount})
**Episodes:** [Y]–${epCount}
**Central function:** [How the central conflict resolves — what's won, what's lost, what's transformed]
**Climax:** Episode [N] — [The decisive confrontation or revelation]
**Finale:** Episode ${epCount} — [How it ends — resolution + implication of future]

## CHARACTER ARCS

### [Lead Character] Arc
**Start state:** [Who they are at Episode 1]
**Midpoint fracture:** [What breaks them open]
**End state:** [Who they are at Episode ${epCount}]

### [Second Lead] Arc
[Same structure]

### Relationship Arc (Central Romantic/Dramatic Pairing)
**Start:** [Dynamic at Episode 1]
**Rupture point:** [Episode N — what tears them apart or tests them most severely]
**Resolution:** [How it lands at Episode ${epCount}]

## KEY EPISODE ANCHORS
| Episode | Function | Event |
|---|---|---|
| 1 | Inciting incident | [What launches everything] |
| [N] | First major turn | [What changes the game] |
| [N] | Midpoint | [Reversal / false victory / revelation] |
| [N] | Dark night | [All seems lost] |
| [N] | Climax | [Decisive confrontation] |
| ${epCount} | Finale | [Resolution] |

## THEMATIC ARC
[How the season's central theme (from Concept Brief) is dramatised, tested, and answered across ${epCount} episodes. One paragraph.]

## TONE MAP
**Episodes 1–[X]:** [Emotional register — e.g. tense intrigue, slow burn]
**Episodes [X]–[Y]:** [Escalation — e.g. mounting paranoia, romantic tension]
**Episodes [Y]–${epCount}:** [Climax register — e.g. full-throttle, emotionally devastating]`;

    // ─────────────────────────────────────────────────────────────────────────────
    case "treatment":
      return `# TREATMENT: ${title}

## LOGLINE
[One sentence — protagonist, conflict, stakes]

## THE WORLD
[Establish the world of the story — time, place, social/cultural context. 1–2 paragraphs. Not backstory — the living, breathing world the audience enters.]

## THE STORY

### ACT ONE
[Establish protagonist in their ordinary world. Introduce the central conflict. Inciting incident that propels them into the story. End on the moment of commitment — the point of no return.]

### ACT TWO
[The protagonist pursues their goal. Obstacles multiply. The cost rises. Midpoint reversal. The protagonist is forced to change tactics or confront a deeper truth. Darkest moment before the final turn.]

### ACT THREE
[The protagonist brings everything to bear on the central conflict. Climactic confrontation. Resolution — what is won, what is lost, what is transformed. Final image.]

## CHARACTERS

### [Lead Character Name]
[Who they are at the start. What they want. What they're afraid of. What they need to learn. How the story changes them.]

### [Secondary Character Name]
[Role in the story. Relationship to lead. Dramatic function.]

## TONE & VISUAL LANGUAGE
[How this story looks and feels. Tonal reference points. Visual approach. Pacing.]

## WHY NOW
[Why this story matters now. Cultural/emotional resonance. Market context — brief.]`;

    // ─────────────────────────────────────────────────────────────────────────────
    case "topline_narrative":
    case "long_synopsis":
      return `# TOPLINE NARRATIVE: ${title}

## LOGLINE
[One sentence — protagonist, conflict, stakes]

## SHORT SYNOPSIS (50 words)
[Compressed version for pitch decks and one-page summaries]

## FULL SYNOPSIS
[Full narrative summary — beginning to end. Present tense. Include the key turning points, the emotional spine, and the resolution. This is not a scene list — it's a dramatic narrative told compellingly.]

## SERIES ENGINE (if episodic)
[What is the repeating engine that drives episode-to-episode momentum? What question keeps the audience watching?]

## STORY PILLARS
1. **[Pillar 1 — e.g. Identity]:** [How this theme is dramatised in the story]
2. **[Pillar 2 — e.g. Betrayal]:** [How this theme is dramatised in the story]
3. **[Pillar 3 — e.g. Redemption]:** [How this theme is dramatised in the story]`;

    // ─────────────────────────────────────────────────────────────────────────────
    case "episode_grid":
    case "vertical_episode_grid":
      return `# EPISODE GRID: ${title}
*${epCount} Episodes — Each entry uses the standardised format below*

**Format per episode:**
\`\`\`
## EPISODE N: [Active specific title — e.g. "Leila Finds the Burner Phone"]
PREMISE: [Who does what, specifically, and what changes as a result]
HOOK: [Specific opening image or line that demands the viewer keep watching]
CORE MOVE: [The one new story fact that is true after this episode]
CHARACTER COST: [What this episode extracts from the focal character]
CLIFFHANGER: [Specific final beat — unresolved, pulling to next episode]
ARC POSITION: [COLD OPEN WORLD | INCITING DISRUPTION | ESCALATION | COMPLICATION | MIDPOINT TURN | DARK SPIRAL | PRE-CLIMAX | CLIMAX | RESOLUTION | AFTERMATH]
TONE: [Dominant emotional register]
\`\`\`

Every episode must have a unique CORE MOVE and CLIFFHANGER. No two episodes may feel structurally identical.`;

    // ─────────────────────────────────────────────────────────────────────────────
    default:
      return null; // No template — generation proceeds as normal
  }
}

/**
 * Builds the template injection block for use in a user prompt.
 * Returns null if no template exists for the doc type.
 */
export function buildTemplatePrompt(docType: string, ctx: TemplateContext = {}): string | null {
  const template = getDocTypeTemplate(docType, ctx);
  if (!template) return null;
  return `\n\n═══════════════════════════════════════
DOCUMENT TEMPLATE — MANDATORY SCAFFOLD
═══════════════════════════════════════
Fill in EVERY section of this template with high-quality, project-specific content.
Replace every [bracketed description] with real material — do not leave any brackets unfilled.
Output the complete filled-in template as your response. Do not add sections not in the template.
Do not output JSON, code blocks, or any non-markdown formatting.

${template}
═══════════════════════════════════════`;
}
