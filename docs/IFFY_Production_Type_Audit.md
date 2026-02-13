# IFFY — Production Type Audit: Current AI Prompts, Engines, and Architecture

> Generated 2026-02-13 — Complete inventory of all 13 production types, their AI prompt conditioning, scoring dimensions, workflow stages, and engine coverage.

---

## TABLE OF CONTENTS

1. [Feature Film](#1-feature-film)
2. [TV Series](#2-tv-series)
3. [Documentary Feature](#3-documentary-feature)
4. [Documentary Series](#4-documentary-series)
5. [Hybrid Documentary](#5-hybrid-documentary)
6. [Short Film](#6-short-film)
7. [Commercial / Advert](#7-commercial--advert)
8. [Branded Content](#8-branded-content)
9. [Music Video](#9-music-video)
10. [Proof of Concept](#10-proof-of-concept)
11. [Digital / Social Series](#11-digital--social-series)
12. [Hybrid Project](#12-hybrid-project)
13. [Vertical Drama](#13-vertical-drama)

---

## 1. FEATURE FILM
**Key:** `film` | **Emoji:** 🎬 | **Dashboard Label:** "Feature Film Intelligence"

### AI Conditioning Context
```
This is a NARRATIVE FEATURE FILM. Evaluate through the lens of theatrical/streaming distribution, festival strategy, pre-sales potential, and traditional film financing structures. Do NOT reference series concepts, brand clients, ad revenue, or digital-first metrics.
```

### Allowed Concepts
`pre-sales, equity, gap-finance, tax-credit, co-production, theatrical-release, streaming-deal, festival-premiere, awards-campaign, cast-packaging, sales-agent, minimum-guarantee, recoupment-waterfall, territory-rights, holdback, day-and-date, p&a, backend-participation`

### Disallowed Concepts
`subscriber-model, brand-integration, client-budget, agency-commission, episode-scalability, renewal-probability, platform-algorithm, influencer-leverage, ad-revenue, sponsorship-tier`

### Workflow Stages
`Development → Packaging → Financing → Pre-Production`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Script | 25% | Script strength and revision history |
| Packaging | 30% | Cast, crew, and partner attachments |
| Finance | 25% | Finance scenarios and incentives |
| Market | 20% | Genre, audience, and market positioning |

### KPIs
- Readiness Score (score)
- Finance Readiness (score)
- Deals Closed (count)
- Total Secured (currency)

### Financing Model
`Equity, Pre-Sales, Incentives, Gap, Soft Money, Other`

### Stakeholder Template
`Producer, Director, Writer, Cast, Sales Agent, Financier, Distributor, Co-Producer`

### Deliverables Template
`DCP, ProRes Master, M&E, Subtitles, Key Art, Trailer, EPK, Screener`

### Strategic Roles
`Revenue generation, IP creation, Awards prestige, Slate diversification`

### Market Strategy Focus
`Festival premiere strategy, Sales agent engagement, Territory pre-sales, Awards positioning, P&A planning`

### Active AI Engines

#### Script Coverage (`script-coverage`)
- **Model:** `google/gemini-2.5-pro` (Tier 1)
- **Prompt:** 3-pass system (Analyst → Producer → Notes) using `coverage_prompt_versions` table
- **Scoring:** 7-category Producer Coverage Benchmark Grid (0-10 each): structure, character, dialogue, concept, pacing, genre, commercial
- **Calibration:** Corpus deviation, Masterwork Canon, Commercial Proof, Failure Contrast
- **Risk Flags:** STRUCTURAL RISK, PACING RISK, CHARACTER DEPTH RISK, MARKET RISK, EXECUTION RISK, FINANCE RISK, DEVELOPMENT RISK, GENRE EXECUTION RISK

#### Script Engine (`script-engine`)
- **Model:** `google/gemini-2.5-pro` (Tier 1)
- **Blueprint:** Three-Act Breakdown, Inciting Incident, Midpoint Pivot, Lowest Point, Climax, Resolution, Character Arcs, Thematic Spine
- **Validation:** Protagonist Agency Test, Escalation Test, Engine Sustainability Test, Budget Feasibility, Lane Alignment
- **Modes:** Blueprint, Scene Architecture, Batched Drafting (15-page segments), Quality Scoring

#### Analyze Project (`analyze-project`)
- **Model:** `google/gemini-3-flash-preview` (Tier 2)
- **Output:** Lane classification (7 lanes), Verdict, Structural Read, Creative Signal, Market Reality, Do Next (3), Avoid (3), Lane Not Suitable
- **Uses tool calling** with `classify_project` function

#### Greenlight Simulator (`greenlight-simulate`)
- **Model:** `google/gemini-2.5-pro` (Tier 1)
- **Axes:** Hook Immediacy, Audience Clarity, Retention Potential, Castability, Global Travelability, Budget vs Subscriber Value (each 0-10)
- **Verdict:** GREEN / YELLOW / RED
- **Calibration:** Coverage scores cap verdict (structural <6 blocks green)

#### Smart Packaging (`smart-packaging`)
- **Model:** `google/gemini-3-flash-preview` (Tier 2)
- **Output:** Cast/crew suggestions with name, role, rationale, market_value, availability_window
- **Format-aware:** Standard packaging context for films

#### Comp Analysis (`comp-analysis`)
- **Model:** `google/gemini-3-flash-preview` (Tier 2)

#### Treatment Compare (`treatment-compare`)
- **Model:** `google/gemini-2.5-pro` (Tier 1)

#### Packaging Intelligence (`packaging-intelligence`)
- **Model:** `google/gemini-3-flash-preview` (Tier 2)
- **Output:** Lead Role Magnetism, Director Profile, Pre-sales Viability, Capital Stack, Recoupment Waterfall

#### Finance Predict (`finance-predict`)
- **Model:** `google/gemini-3-flash-preview` (Tier 2)

#### Expand Concept (`expand-concept`)
- **Model:** `google/gemini-3-flash-preview` (Tier 2)

#### Stress Test Concept (`stress-test-concept`)
- **Model:** `google/gemini-2.5-pro` (Tier 1)

#### Project Chat (`project-chat`)
- **Model:** `google/gemini-2.5-flash` (Tier 3)
- **Streaming:** Yes (SSE)
- **Context:** Full project dossier (cast, partners, finance, deals, documents)

---

## 2. TV SERIES
**Key:** `tv-series` | **Emoji:** 📺 | **Dashboard Label:** "Series Intelligence"

### AI Conditioning Context
```
This is a NARRATIVE TV SERIES. Evaluate through the lens of platform/broadcaster commissioning, showrunner strength, series engine sustainability, multi-season potential, and per-episode economics. Do NOT reference theatrical distribution, one-off film financing, or brand clients.
```

### Allowed Concepts
`platform-deal, broadcaster-commission, co-production, deficit-finance, showrunner, series-bible, pilot, writers-room, season-arc, renewal-probability, episode-budget, per-episode-cost, multi-season, platform-fit, territory-rights, format-rights, remake-rights`

### Disallowed Concepts
`theatrical-release, p&a, day-and-date, festival-premiere, client-budget, agency-commission, brand-integration, subscriber-model, influencer-leverage, ad-revenue`

### Workflow Stages
`Development → Packaging → Financing → Pre-Production`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Engine Sustainability | 25% | Episodic repeatability and character elasticity |
| Format Clarity | 20% | Series bible and format definition |
| Platform Alignment | 20% | Platform fit classification |
| Showrunner | 20% | Showrunner viability index |
| Market | 15% | Market positioning and audience |

### KPIs
- TV Readiness (score)
- Renewal Probability (percentage)
- Platform Fit (score)
- Showrunner Index (score)

### Financing Model
`Platform Deal, Broadcaster, Co-Pro, Incentives, Deficit Finance, Other`

### Active AI Engine Differences from Film

#### Script Coverage — TV Structure Engine Block
```
TV STRUCTURE ENGINE — ACTIVATED (this is an episodic project, NOT a feature film)

CRITICAL: Do NOT evaluate this script using feature film logic. Use series-specific development criteria.

SECTION 1 — PILOT EVALUATION (Episode 1):
Score each 0-10:

PILOT HOOK:
- Is there a compelling cold open?
- Is the premise clear within 10-15 pages?
- Does episode 1 end with a strong propulsion question?

SERIES ENGINE:
- Is there a sustainable narrative engine beyond episode 1?
- Does the premise generate 6-8 episodes minimum?
- Is conflict renewable (not exhaustible)?

CHARACTER LONGEVITY:
- Does protagonist have multi-season potential?
- Are secondary characters expandable?
- Is there evolving internal conflict that sustains across seasons?

WORLD DEPTH:
- Is the setting expandable?
- Does the world generate story organically?

CLIFFHANGER STRENGTH:
- Does the episode ending compel next-episode viewing?
- Is the hook organic, not manufactured?

SECTION 2 — SEASON ARC ANALYSIS:
- Season Question Clarity
- Mid-season escalation event
- Episode escalation pattern
- Finale payoff strength
- Setup for future seasons

SECTION 3 — STREAMER ALIGNMENT (Score 0-10):
BINGE PROPULSION, ALGORITHM FRIENDLINESS, RETENTION FACTOR

TV-SPECIFIC RISK FLAGS:
- If pilot resolves central conflict fully → SERIES ENGINE RISK
- If no clear season question → STRUCTURAL RISK
- If protagonist arc completes in season 1 → LONGEVITY RISK
- If tone shifts inconsistently → TONAL RISK

CALIBRATION RULES FOR TV:
- Do NOT evaluate like a feature film
- Do NOT require full narrative closure
- Prioritise renewable conflict over clean resolution
- Prioritise hook density over thematic closure
- A great pilot OPENS questions, it doesn't close them
```

#### Script Engine — TV Blueprint
```
Generate a TV SERIES BLUEPRINT with:
1. Series Overview (premise, world, central question)
2. Season Arc (beginning → midpoint → season climax)
3. Episode Grid (episode titles + one-line summaries for 6-10 episodes)
4. Pilot Beat Breakdown (10-15 key beats)
5. Season Cliffhanger concept
6. Multi-Season Trajectory (2-3 season arcs)
7. Character Arc Summary (protagonist + 2-3 key characters)
8. Thematic Spine (core theme + how it evolves)
```

#### Additional TV-Specific Panels
- `TVReadinessScore` — Series readiness scoring
- `PlatformFitPanel` — Platform alignment analysis
- `RenewalProbabilityPanel` — Multi-season probability
- `SeasonArcPanel` — Season structure analysis
- `SeriesBiblePanel` — Bible completeness tracking
- `ShowrunnerViabilityPanel` — Showrunner index
- `StoryEnginePanel` — Series engine sustainability
- `MultiSeasonFinancePanel` — Per-episode economics

---

## 3. DOCUMENTARY FEATURE
**Key:** `documentary` | **Emoji:** 🎥 | **Dashboard Label:** "Documentary Intelligence"

### AI Conditioning Context
```
This is a DOCUMENTARY FEATURE. Evaluate through the lens of subject access exclusivity, grant funding eligibility, broadcaster/streamer fit, impact campaign potential, and rights clearance. Do NOT reference narrative cast packaging, fictional script structure, or commercial brand clients.
```

### Allowed Concepts
`grants, broadcaster-pre-sales, ngo-partners, impact-investors, impact-campaign, archive-clearance, subject-access, editorial-independence, festival-circuit, educational-distribution, rights-clearance, broadcaster-commission, streamer-acquisition, theatrical-doc`

### Disallowed Concepts
`cast-packaging, cast-attached, talent-tier, minimum-guarantee, recoupment-waterfall, equity-financing, gap-finance, client-budget, agency-commission, brand-integration, subscriber-model, episode-scalability, influencer-leverage`

### Workflow Stages
`Development → Access Secured → Funding Raised → Production → Archive & Clearance → Post → Festival / Broadcast → Distribution`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Cultural Relevance | 20% | Timeliness and cultural significance |
| Access Exclusivity | 20% | Exclusive access to subject matter |
| Festival Potential | 15% | Documentary festival circuit strength |
| Broadcaster Fit | 20% | Broadcaster and streamer alignment |
| Impact Campaign | 15% | Social impact and campaign potential |
| Clearance Risk | 10% | Archive and rights clearance risk |

### KPIs
- Grants Secured (currency)
- Broadcaster Interest (count)
- Impact Score (score)
- Clearance Risk (percentage)

### Active AI Engine Differences

#### Script Coverage — Documentary Story Engine (10-Dimension Master Prompt)
```
DOCUMENTARY STORY ENGINE — ACTIVATED (this is a DOCUMENTARY project, NOT scripted fiction)

You are IFFY's Documentary Story Engine.
You are not a screenwriter.
You are a high-level documentary story strategist, executive producer, festival programmer, legal risk evaluator, and impact producer combined.

CRITICAL REALITY-LOCK RULES:
- Do NOT create fictional characters, scenes, dialogue, or outcomes
- Do NOT add "composite characters"
- Only reference names, entities, claims, and events explicitly present in the submitted material
- If something is not confirmed, label it as UNKNOWN or HYPOTHESIS
- Every major claim must include an EVIDENCE NOTE: [Document Quote], [Confirmed], [Source Needed], [Not Yet Verified]

10 DIMENSIONS:
1. NARRATIVE GRAVITY (Score 0-10)
2. STRUCTURAL INTEGRITY (Score 0-10)
3. EMOTIONAL ARCHITECTURE (Score 0-10)
4. ACCESS & FRAGILITY (Score 0-10)
5. LEGAL & ETHICAL SAFETY (Score 0-10)
6. MARKET POSITIONING (Score 0-10)
7. GRANT & IMPACT POTENTIAL (Score 0-10)
8. COMMERCIAL VIABILITY vs RISK BALANCE (Score 0-10)
9. RED FLAGS
10. STRATEGIC RECOMMENDATIONS

SCORING GRID:
- OVERALL NARRATIVE STRENGTH: X/10
- ACCESS STABILITY: Low / Moderate / Strong
- LEGAL RISK LEVEL: Low / Moderate / High / Severe
- MARKET VIABILITY: Low / Moderate / Strong
- GRANT POTENTIAL: Low / Moderate / Strong / Very Strong
- IMPACT POTENTIAL: Low / Moderate / High / Transformational
- STORY COLLAPSE PROBABILITY: X%
- GREENLIGHT SCORE: X/100
- GRANT PROBABILITY: X/100
- FESTIVAL PROBABILITY: X/100
- IMPACT SCORE: X/100

DEVELOPMENT TIERS:
- Tier A — Commission Ready
- Tier B — Strong With Access Work
- Tier C — Development Required
- Tier D — Concept Rethink Needed

DOCUMENTARY-SPECIFIC RISK FLAGS:
ACCESS FRAGILITY RISK, LEGAL RISK, POLITICAL RISK, MARKET FIT RISK, ARCHIVE COST RISK, IMPACT GAP, INSURANCE RISK, INFORMATIONAL TRAP, NO PROTAGONIST, EMOTIONAL MONOTONY
```

#### Script Engine — Documentary Blueprint (Reality-Locked)
```
Generate a DOCUMENTARY BLUEPRINT using the REALITY-LOCKED system.

9-SECTION OUTPUT STRUCTURE:
1. PROJECT FACT BASE (confirmed subjects, settings, timeframe, access, stakes)
2. CENTRAL QUESTION + THEMATIC ENGINE
3. KNOWN STORY ARC (FACT-BASED with multiple Act 3 outcome paths)
4. SEQUENCES WE CAN PLAN NOW (with evidence notes)
5. INTERVIEW STRATEGY (confirmed + target subjects, question bank)
6. ARCHIVE + VERIFICATION PLAN (with red flags)
7. DISCOVERY PIPELINE (unknowns, direction changers, recalibration process)
8. PRODUCTION BLUEPRINT (shoot blocks, milestones, deliverables plan)

CRITICAL: If concept documents are sparse, mark everything as [Source Needed]. NEVER fill gaps with fiction.
```

#### Additional Documentary-Specific Panels
- `DocumentaryIntelligencePanel` — Tabs: Coverage, Grants, Impact, Legal, Archive, Planning
- `DocumentaryCoveragePanel` — 10-dimension analysis with dated run history
- `GrantMatchingPanel` — BFI, Sundance, IDFA fund matching
- `ImpactCampaignPanel` — Impact strategy and campaign planning
- `ConsentLegalDashboard` — Subject consent and legal tracking
- `ArchiveBudgetPanel` — Archive asset cost tracking
- Database tables: `documentary_profiles, grant_matches, interview_subjects, archive_assets, consent_forms`

#### Smart Packaging — Documentary Context
```
PRODUCTION TYPE CONTEXT: This is a Documentary Feature. Focus on documentary-specialist directors, cinematographers with vérité/observational experience, and editors known for non-fiction storytelling. Do NOT suggest narrative feature talent.
```

---

## 4. DOCUMENTARY SERIES
**Key:** `documentary-series` | **Emoji:** 📹 | **Dashboard Label:** "Doc Series Intelligence"

### AI Conditioning Context
```
This is a DOCUMENTARY SERIES. Evaluate through the lens of multi-episode storytelling, broadcaster/platform commissioning, subject access sustainability across episodes, per-episode economics, and impact campaign potential. Do NOT reference narrative cast packaging, fictional scripts, or commercial brand clients.
```

### Workflow Stages
`Development → Access Secured → Funding Raised → Production → Post → Festival / Broadcast → Distribution`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Cultural Relevance | 20% | Timeliness and cultural significance |
| Access Sustainability | 20% | Multi-episode subject access |
| Format Strength | 15% | Episodic format and structure |
| Broadcaster Fit | 20% | Broadcaster and streamer alignment |
| Impact Campaign | 15% | Social impact potential |
| Clearance Risk | 10% | Archive and rights clearance risk |

### KPIs
- Grants Secured (currency)
- Broadcaster Interest (count)
- Episodes Funded (count)
- Impact Score (score)

### Engine Status
**Shares all documentary engines.** Uses same Documentary Story Engine, Reality-Locked Blueprint, and Documentary Intelligence Suite. Format-level differentiation on multi-episode access sustainability.

---

## 5. HYBRID DOCUMENTARY
**Key:** `hybrid-documentary` | **Emoji:** 🎭 | **Dashboard Label:** "Hybrid Documentary Intelligence"

### AI Conditioning Context
```
This is a HYBRID DOCUMENTARY that blends non-fiction with fiction, animation, or experimental techniques. Evaluate through the lens of documentary integrity, hybrid innovation, grant eligibility, festival potential, and cultural impact. The factual core must remain evidence-anchored even when using creative reconstruction or animation.
```

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Cultural Relevance | 20% | Timeliness and cultural significance |
| Hybrid Innovation | 20% | Strength of fiction/animation/experimental technique |
| Access & Evidence | 15% | Subject access and factual grounding |
| Festival Potential | 15% | Documentary festival circuit strength |
| Broadcaster Fit | 15% | Broadcaster and streamer alignment |
| Impact Campaign | 15% | Social impact potential |

### Engine Status
**Shares documentary engines** with additional `hybrid-design` workflow stage and emphasis on innovation scoring.

---

## 6. SHORT FILM
**Key:** `short-film` | **Emoji:** 🎞️ | **Dashboard Label:** "Short Film Intelligence"

### AI Conditioning Context
```
This is a SHORT FILM. Evaluate through the lens of festival circuit strategy, talent showcase potential, proof-of-concept viability, and IP expansion possibilities. Do NOT reference feature film financing structures, pre-sales, equity, gap financing, or commercial brand clients.
```

### Workflow Stages
`Development → Packaging → Pre-Production → Production → Post → Festival Strategy → Online Release`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Festival Strength | 25% | Festival circuit potential and strategy |
| Talent Exposure | 20% | Talent showcase and discovery potential |
| IP Expansion | 20% | Feature or series expansion potential |
| Proof of Concept | 20% | Technical and creative demonstration |
| Awards Probability | 15% | Awards circuit potential |

### KPIs
- Festival Selections (count)
- Awards Won (count)
- Online Views (count)
- Talent Leverage (count)
- Next Funding (currency)

### Engine Status: ⚠️ USES FILM ENGINES — NO DEDICATED ENGINE
- **Script Coverage:** Uses standard film 3-pass with film scoring grid (wrong fit)
- **Script Engine:** Uses film blueprint (Three-Act Breakdown — wrong for shorts)
- **Greenlight Simulator:** Film-oriented axes (wrong — should assess festival viability, not streamer greenlight)
- **Smart Packaging:** Film packaging context (wrong — should focus on director showcase, not financier packaging)
- **Missing:** Festival submission strategy engine, Short-specific coverage scoring, Director launchpad assessment

---

## 7. COMMERCIAL / ADVERT
**Key:** `commercial` | **Emoji:** 📢 | **Dashboard Label:** "Commercial Intelligence"

### AI Conditioning Context
```
This is a COMMERCIAL / ADVERTISEMENT. Evaluate through the lens of client brief alignment, production margin, director fit, brand guidelines compliance, usage rights, and deliverables matrix. Do NOT reference film financing, festival strategy, equity, pre-sales, or streaming deals.
```

### Workflow Stages
`Brief → Treatment → Awarded → Pre-Pro → Shoot → Post → Delivery → Invoice → Paid`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Brand Alignment | 25% | Brand and creative brief alignment |
| Director Fit | 20% | Director suitability and track record |
| Win Probability | 20% | Pitch win likelihood |
| Portfolio Value | 15% | Strategic value to company portfolio |
| Awards Potential | 20% | Cannes Lions and industry awards potential |

### KPIs
- Margin % (percentage)
- Invoice Status (currency)
- Overdue Amount (currency)
- Portfolio Value (score)

### Engine Status: ⚠️ USES FILM ENGINES — NO DEDICATED ENGINE
- **Script Coverage:** Runs film 3-pass on commercial treatments (wrong — should assess brief alignment, not narrative structure)
- **Script Engine:** Film blueprint (completely wrong — should be treatment builder / storyboard tool)
- **Greenlight Simulator:** Streamer greenlight simulation (wrong — should be pitch win probability)
- **Smart Packaging:** Has format-aware context for commercial directors/DoPs ✅
- **Missing:** Brief alignment engine, Treatment evaluation, Production margin calculator, Usage rights tracker, Deliverables matrix, Client approval workflow

---

## 8. BRANDED CONTENT
**Key:** `branded-content` | **Emoji:** ✨ | **Dashboard Label:** "Branded Content Intelligence"

### AI Conditioning Context
```
This is BRANDED CONTENT. Evaluate through the lens of brand story alignment, cultural authenticity, platform amplification potential, audience engagement, and long-tail IP value. Do NOT reference traditional film financing, festival strategy, equity, pre-sales, or broadcaster commissioning.
```

### Workflow Stages
`Strategy → Creative Development → Brand Approval → Production → Post → Distribution → Performance Tracking`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Brand Story Alignment | 25% | Brand narrative authenticity |
| Cultural Authenticity | 20% | Cultural resonance and authenticity |
| Platform Amplification | 20% | Distribution and amplification strategy |
| IP Expansion | 15% | Long-tail IP potential |
| Audience Engagement | 20% | Audience engagement forecast |

### KPIs
- Brand Satisfaction (score)
- Audience Reach (count)
- Engagement Rate (percentage)
- IP Value (score)

### Engine Status: ⚠️ USES FILM ENGINES — NO DEDICATED ENGINE
- Same issues as Commercial — film engines are wrong fit
- **Missing:** Brand alignment engine, Content strategy planner, Performance analytics dashboard, Platform amplification strategy

---

## 9. MUSIC VIDEO
**Key:** `music-video` | **Emoji:** 🎵 | **Dashboard Label:** "Music Video Intelligence"

### AI Conditioning Context
```
This is a MUSIC VIDEO. Evaluate through the lens of visual storytelling, artist brand alignment, label/commissioner relationship, director treatment strength, and social media release strategy. Do NOT reference film financing, festival strategy, equity, pre-sales, or broadcasting deals.
```

### Workflow Stages
`Brief / Commission → Treatment → Awarded → Pre-Pro → Shoot → Post → Delivery → Release`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Visual Concept | 30% | Treatment strength and originality |
| Director Fit | 25% | Director suitability for artist/genre |
| Production Scope | 20% | Budget vs ambition alignment |
| Release Strategy | 15% | Platform and timing strategy |
| Portfolio Value | 10% | Career and awards value |

### KPIs
- Total Views (count)
- Production Margin (percentage)
- Awards (count)
- Portfolio Value (score)

### Engine Status: ⚠️ USES FILM ENGINES — NO DEDICATED ENGINE
- **Missing:** Treatment strength evaluator, Artist-brand alignment engine, Commissioner relationship tools, Release strategy planner, Social media premiere strategy

---

## 10. PROOF OF CONCEPT
**Key:** `proof-of-concept` | **Emoji:** 🧪 | **Dashboard Label:** "Proof of Concept Intelligence"

### AI Conditioning Context
```
This is a PROOF OF CONCEPT. Evaluate through the lens of IP demonstration potential, feature/series development viability, investor pitch readiness, and technical showcase quality. This is NOT a finished product — it is a strategic tool to unlock bigger production. Do NOT reference distribution, sales, or recoupment.
```

### Workflow Stages
`Concept → Script / Treatment → Funding → Production → Post → Pitch-Ready → Development Deal`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| IP Demonstration | 30% | How well the concept proves the larger project |
| Technical Showcase | 20% | VFX, tone, or world-building proof |
| Pitch Readiness | 25% | Supporting materials and development package |
| Talent Signal | 15% | Director/cast attachment strength |
| Market Viability | 10% | Target project market potential |

### KPIs
- Development Interest (count)
- Funding Unlocked (currency)
- Lab Selections (count)
- Pitch Readiness (score)

### Engine Status: ⚠️ USES FILM ENGINES — NO DEDICATED ENGINE
- **Missing:** IP demonstration evaluator, Pitch readiness assessment, Feature/series conversion analysis, Lab/fund submission strategy

---

## 11. DIGITAL / SOCIAL SERIES
**Key:** `digital-series` | **Emoji:** 📱 | **Dashboard Label:** "Digital Intelligence"

### AI Conditioning Context
```
This is a DIGITAL / SOCIAL SERIES. Evaluate through the lens of platform-native audience growth, content scalability, brand integration potential, subscriber/ad revenue models, and algorithm optimization. Do NOT reference traditional film/TV financing, theatrical distribution, or festival strategy.
```

### Workflow Stages
`Concept → Platform Strategy → Pilot / Proof → Season Funding → Production → Platform Launch → Growth Tracking`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Platform Fit | 25% | Platform and audience alignment |
| Audience Growth | 20% | Growth and retention potential |
| Format Repeatability | 20% | Episode scalability index |
| Influencer Leverage | 15% | Creator and influencer integration |
| Retention Probability | 20% | Viewer retention and engagement |

### KPIs
- Subscriber Growth (percentage)
- Episode Scalability (score)
- Brand Deals (count)
- Retention Rate (percentage)

### Engine Status: ⚠️ USES FILM ENGINES — NO DEDICATED ENGINE
- **Missing:** Platform algorithm strategy, Audience growth engine, Content scalability assessment, Brand integration planner, Analytics-driven iteration tools

---

## 12. HYBRID PROJECT
**Key:** `hybrid` | **Emoji:** 🔀 | **Dashboard Label:** "Hybrid Intelligence"

### AI Conditioning Context
```
This is a HYBRID project that spans multiple formats, platforms, or media types. Evaluate through the lens of cross-platform storytelling, transmedia potential, innovation fund eligibility, and experiential audience engagement. Be flexible with financing and distribution models as hybrid projects defy conventional categorisation.
```

### Workflow Stages
`Concept → Design / Prototype → Funding → Build / Production → Launch → Iteration`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Innovation Factor | 25% | Novelty and cross-platform originality |
| Audience Design | 20% | Multi-touchpoint audience strategy |
| Technical Feasibility | 20% | Technology stack viability |
| Funding Fit | 20% | Innovation fund and partner alignment |
| Cultural Impact | 15% | Cultural significance and reach |

### KPIs
- Audience Reach (count)
- Innovation Score (score)
- Partner Engagement (count)
- Cultural Impact (score)

### Engine Status: ⚠️ USES FILM ENGINES — NO DEDICATED ENGINE
- **Missing:** Transmedia narrative engine, Cross-platform strategy planner, Innovation fund matching, Technology feasibility assessment

---

## 13. VERTICAL DRAMA
**Key:** `vertical-drama` | **Emoji:** 📲 | **Dashboard Label:** "Vertical Drama Intelligence"

### AI Conditioning Context
```
This is a VERTICAL DRAMA — short-form, mobile-first narrative content designed for platforms like TikTok, YouTube Shorts, Instagram Reels, Snapchat, or dedicated vertical drama apps (ReelShort, ShortMax, FlexTV). Evaluate through the lens of episode pacing (1–3 min episodes), cliffhanger design, swipe retention, cast social reach, youth audience appeal, platform algorithm optimization, and brand integration potential. Do NOT reference theatrical distribution, festival strategy, traditional film financing, or long-form television structures.
```

### Workflow Stages
`Concept / Hook → Script (Episodes) → Packaging / Cast → Platform Pitch → Production → Post / Edit → Platform Launch → Growth / Renewal`

### Scoring Dimensions
| Dimension | Weight | Description |
|-----------|--------|-------------|
| Speed to Break-Even | 22% | How fast the title reaches profitability |
| Episode Count Scalability | 18% | Multi-season episode expansion potential |
| CPM Potential | 18% | Ad revenue CPM and in-app purchase viability |
| Micro-Transaction Viability | 15% | Episode unlock, coin purchase, IAP potential |
| Subscriber Funnel Strength | 15% | Free-to-paid conversion and retention |
| Hook & Retention Design | 12% | Cliffhanger density and scroll-stopping power |

### KPIs
- Episode Completion Rate (percentage)
- Series Retention (percentage)
- Days to Break-Even (count)
- CPM Revenue (currency)
- IAP Revenue (currency)
- Subscriber Conversion (percentage)
- Total Views (count)

### Active AI Engine — Vertical Drama Engine Block (in Script Coverage)
```
VERTICAL DRAMA ENGINE — ACTIVATED

SECTION 1 — EPISODE MICRO-STRUCTURE (Score 0-10):
HOOK SPEED: dramatic hook within first 5-15 seconds?
EMOTIONAL SPIKE: clear emotional beat per episode?
CLIFFHANGER DENSITY: every episode ends on reversal/reveal/threat?
CONFLICT CLARITY: central relationship conflict obvious and intense?

SECTION 2 — ARC ENGINE (Score 0-10):
CORE RELATIONSHIP TENSION: Love vs betrayal, power imbalance, secret identity, revenge
ESCALATION CURVE: tension escalates every 3-5 episodes?
TWIST FREQUENCY: reveal every 2-3 episodes?
REWARD CYCLE: small payoffs while larger tension builds?

SECTION 3 — ADDICTION METRICS (Score 0-10):
SCROLL-STOP FACTOR, REWATCH MOMENT, SIMPLE PREMISE CLARITY, ROMANCE/BETRAYAL INTENSITY

VERTICAL-SPECIFIC RISK FLAGS:
- HOOK FAILURE (slow exposition start)
- RETENTION RISK (no clear cliffhanger)
- FORMAT MISALIGNMENT (complex world-building)
- ARC COLLAPSE RISK (escalation plateaus before ep 20)

CALIBRATION:
- Do NOT evaluate thematic depth as primary metric
- Do NOT require subtlety
- Prioritise: Speed, Emotional polarity, Betrayal, Romance intensity, Revenge clarity
```

#### Script Engine — Vertical Drama Blueprint
```
Generate a VERTICAL DRAMA BLUEPRINT with:
1. Episode Hook Cadence (how each 2-5 min ep opens)
2. Emotional Spike Mapping (emotional peaks per episode)
3. Cliffhanger Density (cliffhanger strategy per episode)
4. Retention Mechanics (what keeps viewers swiping to next ep)
5. Season Arc (compressed for short-form)
6. Character Arc Summary
7. Thematic Spine
```

---

## SUMMARY: ENGINE COVERAGE MATRIX

| Production Type | Coverage Engine | Script Engine | Greenlight | Packaging | Finance | Dedicated Panels |
|---|---|---|---|---|---|---|
| Feature Film | ✅ 3-pass + calibration | ✅ Film blueprint | ✅ Streamer sim | ✅ Cast/crew | ✅ | ✅ Full suite |
| TV Series | ✅ TV Structure Engine | ✅ TV blueprint | ✅ (shared) | ✅ | ✅ | ✅ 8 TV panels |
| Documentary | ✅ 10-dim Story Engine | ✅ Reality-locked | ✅ (shared) | ✅ Doc context | ✅ | ✅ 6 doc panels |
| Doc Series | ✅ Shares doc engine | ✅ Shares doc | ✅ (shared) | ✅ Doc context | ✅ | ✅ Shares doc |
| Hybrid Doc | ✅ Shares doc engine | ✅ Shares doc | ✅ (shared) | ✅ Doc context | ✅ | ✅ Shares doc |
| Short Film | ⚠️ Film engine | ⚠️ Film blueprint | ⚠️ Wrong fit | ⚠️ Film context | ⚠️ | ❌ None |
| Commercial | ⚠️ Film engine | ⚠️ Film blueprint | ⚠️ Wrong fit | ✅ Commercial ctx | ⚠️ | ❌ None |
| Branded Content | ⚠️ Film engine | ⚠️ Film blueprint | ⚠️ Wrong fit | ⚠️ Film context | ⚠️ | ❌ None |
| Music Video | ⚠️ Film engine | ⚠️ Film blueprint | ⚠️ Wrong fit | ⚠️ Film context | ⚠️ | ❌ None |
| Proof of Concept | ⚠️ Film engine | ⚠️ Film blueprint | ⚠️ Wrong fit | ⚠️ Film context | ⚠️ | ❌ None |
| Digital Series | ⚠️ Film engine | ⚠️ Film blueprint | ⚠️ Wrong fit | ⚠️ Film context | ⚠️ | ❌ None |
| Hybrid | ⚠️ Film engine | ⚠️ Film blueprint | ⚠️ Wrong fit | ⚠️ Film context | ⚠️ | ❌ None |
| Vertical Drama | ✅ Vertical Engine | ✅ Vertical blueprint | ⚠️ (shared) | ⚠️ Film context | ⚠️ | ❌ None |

**Legend:** ✅ = Dedicated/appropriate | ⚠️ = Using wrong/generic engine | ❌ = Missing entirely
