/**
 * Review Schema Registry — maps each DeliverableType to rubric sections,
 * prompt modifiers, convergence rules, and forbidden critique.
 * Format overlays (Phase 4) and hallucination safeguards (Phase 8) are included.
 */

import type { DeliverableType, DevelopmentBehavior } from './dev-os-config';
import { getFormatGuardrails, verticalBeatMinimum, behaviorConfig } from './dev-os-config';

// ── Types ──

export interface RubricSection {
  dimension: string;
  weight: number;
  description: string;
}

export interface ReviewSchema {
  rubricSections: RubricSection[];
  analysisPromptModifier: string;
  rewritePromptModifier: string;
  convergenceRules: { minCI: number; minGP: number };
  forbiddenCritique: string[];
}

// ── Registry ──

const registry: Record<DeliverableType, ReviewSchema> = {
  topline_narrative: {
    rubricSections: [
      { dimension: 'Logline Clarity', weight: 25, description: 'Is the logline immediately compelling and clear?' },
      { dimension: 'Synopsis Coherence', weight: 25, description: 'Does the synopsis convey a complete story with emotional logic?' },
      { dimension: 'Story Pillars', weight: 25, description: 'Are theme, protagonist, stakes, and tone clearly articulated?' },
      { dimension: 'Market Positioning', weight: 25, description: 'Does the topline position the project for its target audience?' },
    ],
    analysisPromptModifier: 'This is a TOPLINE NARRATIVE (logline + synopsis + story pillars). Evaluate logline clarity, synopsis coherence, story pillar completeness, and market positioning. Do NOT critique scene construction or dialogue.',
    rewritePromptModifier: 'Sharpen the logline, strengthen the synopsis arc, and ensure story pillars are specific and compelling. Do NOT add scenes or dialogue.',
    convergenceRules: { minCI: 65, minGP: 60 },
    forbiddenCritique: ['dialogue quality', 'scene construction', 'slugline formatting', 'act structure'],
  },
  idea: {
    rubricSections: [
      { dimension: 'Concept Spark', weight: 35, description: 'Is the core idea compelling and original?' },
      { dimension: 'Emotional Promise', weight: 35, description: 'Does the concept promise a strong emotional experience?' },
      { dimension: 'Audience Clarity', weight: 30, description: 'Is the target audience identifiable?' },
    ],
    analysisPromptModifier: 'This is an IDEA — evaluate concept strength, emotional promise, and audience clarity. Do NOT critique scene construction, dialogue, or structure.',
    rewritePromptModifier: 'Sharpen the concept hook and clarify the emotional promise. Do NOT add scenes or dialogue.',
    convergenceRules: { minCI: 60, minGP: 50 },
    forbiddenCritique: ['dialogue quality', 'scene construction', 'act structure', 'slugline formatting'],
  },
  concept_brief: {
    rubricSections: [
      { dimension: 'Hook Clarity', weight: 25, description: 'Is the hook immediately graspable?' },
      { dimension: 'Market Positioning', weight: 20, description: 'Is the market position clear?' },
      { dimension: 'Audience Targeting', weight: 20, description: 'Is the audience well-defined?' },
      { dimension: 'Originality', weight: 20, description: 'Does it feel fresh?' },
      { dimension: 'Emotional Promise', weight: 15, description: 'Is the emotional engine clear?' },
    ],
    analysisPromptModifier: 'This is a CONCEPT BRIEF — evaluate hook clarity, market positioning, audience targeting, originality, and emotional promise. Do NOT critique scene construction or dialogue.',
    rewritePromptModifier: 'Strengthen the hook and clarify market positioning. Do NOT add scenes or dialogue.',
    convergenceRules: { minCI: 65, minGP: 55 },
    forbiddenCritique: ['scene construction', 'dialogue quality', 'visual storytelling', 'subtext'],
  },
  market_sheet: {
    rubricSections: [
      { dimension: 'Budget Band Logic', weight: 25, description: 'Is the budget positioning realistic?' },
      { dimension: 'Buyer Positioning', weight: 25, description: 'Are target buyers identifiable?' },
      { dimension: 'Territory Appeal', weight: 25, description: 'Does the project have international appeal?' },
      { dimension: 'Franchise Potential', weight: 25, description: 'Is there sequel/series/IP extension potential?' },
    ],
    analysisPromptModifier: 'This is a MARKET SHEET — evaluate budget logic, buyer positioning, territory appeal, and franchise potential. Do NOT critique creative writing quality.',
    rewritePromptModifier: 'Strengthen market positioning and buyer clarity. Do NOT add creative content.',
    convergenceRules: { minCI: 55, minGP: 70 },
    forbiddenCritique: ['dialogue quality', 'scene construction', 'character depth', 'emotional impact'],
  },
  vertical_market_sheet: {
    rubricSections: [
      { dimension: 'Platform Targeting', weight: 25, description: 'Are target platforms/distributors clearly identified for vertical drama?' },
      { dimension: 'Audience & Demo Clarity', weight: 25, description: 'Is the mobile-first audience well-defined?' },
      { dimension: 'Comp Titles & Trends', weight: 25, description: 'Are relevant vertical drama comparables cited?' },
      { dimension: 'Revenue Model', weight: 25, description: 'Is the monetization strategy (ad-supported, freemium, premium) clear?' },
    ],
    analysisPromptModifier: 'This is a VERTICAL MARKET SHEET — evaluate platform targeting, audience demographics, comparable vertical titles, and revenue/monetization model. Do NOT critique creative writing quality.',
    rewritePromptModifier: 'Strengthen platform fit, audience definition, and comparable analysis. Do NOT add creative content.',
    convergenceRules: { minCI: 55, minGP: 70 },
    forbiddenCritique: ['dialogue quality', 'scene construction', 'character depth', 'emotional impact'],
  },
  blueprint: {
    rubricSections: [
      { dimension: 'Act Logic', weight: 30, description: 'Does the act structure hold?' },
      { dimension: 'Escalation Curve', weight: 25, description: 'Does tension build consistently?' },
      { dimension: 'Midpoint Shift', weight: 20, description: 'Is there a meaningful midpoint reversal?' },
      { dimension: 'Climax Inevitability', weight: 25, description: 'Does the climax feel earned?' },
    ],
    analysisPromptModifier: 'This is a BLUEPRINT — evaluate act logic, escalation curve, midpoint shift, and climax inevitability. Do NOT critique line-level writing, dialogue, or prose quality.',
    rewritePromptModifier: 'Strengthen structural architecture. Do NOT add dialogue or line-level prose edits.',
    convergenceRules: { minCI: 70, minGP: 60 },
    forbiddenCritique: ['dialogue quality', 'line edits', 'prose style', 'formatting'],
  },
  architecture: {
    rubricSections: [
      { dimension: 'Reversal Integrity', weight: 25, description: 'Do reversals land with impact?' },
      { dimension: 'Payoff Mapping', weight: 25, description: 'Are setups paid off systematically?' },
      { dimension: 'Structural Symmetry', weight: 25, description: 'Is the structure balanced and intentional?' },
      { dimension: 'Character Arc Math', weight: 25, description: 'Do character arcs track logically?' },
    ],
    analysisPromptModifier: 'This is ARCHITECTURE — evaluate reversal integrity, payoff mapping, structural symmetry, and character arc logic. Do NOT critique dialogue or prose.',
    rewritePromptModifier: 'Strengthen architectural precision. Do NOT rewrite dialogue or prose.',
    convergenceRules: { minCI: 70, minGP: 60 },
    forbiddenCritique: ['dialogue quality', 'prose style', 'scene description quality'],
  },
  character_bible: {
    rubricSections: [
      { dimension: 'Psychological Coherence', weight: 30, description: 'Are characters psychologically consistent?' },
      { dimension: 'Desire vs Need', weight: 25, description: 'Is the want/need distinction clear?' },
      { dimension: 'Moral Flaw', weight: 20, description: 'Is the flaw dramatically productive?' },
      { dimension: 'Casting Clarity', weight: 25, description: 'Is the character castable as described?' },
    ],
    analysisPromptModifier: 'This is a CHARACTER BIBLE — evaluate psychological coherence, desire vs need, moral flaw, and casting clarity. Do NOT critique plot or scene structure.',
    rewritePromptModifier: 'Deepen character psychology and castability. Do NOT restructure plot.',
    convergenceRules: { minCI: 70, minGP: 55 },
    forbiddenCritique: ['plot structure', 'act breaks', 'scene construction', 'pacing'],
  },
  beat_sheet: {
    rubricSections: [
      { dimension: 'Beat Density', weight: 30, description: 'Is the beat count appropriate for the runtime?' },
      { dimension: 'Escalation Pacing', weight: 25, description: 'Does each beat escalate stakes?' },
      { dimension: 'Cliff Positioning', weight: 20, description: 'Are cliffhangers well-placed (episodic)?' },
      { dimension: 'Runtime Estimate', weight: 25, description: 'Does the beat count map to target runtime?' },
    ],
    analysisPromptModifier: 'This is a BEAT SHEET — evaluate beat density, escalation pacing, cliff positioning, and runtime estimate. Do NOT critique dialogue or prose quality.',
    rewritePromptModifier: 'Tighten beat density and escalation logic. Do NOT add dialogue.',
    convergenceRules: { minCI: 70, minGP: 65 },
    forbiddenCritique: ['dialogue quality', 'prose style', 'visual description'],
  },
  script: {
    rubricSections: [
      { dimension: 'Scene Construction', weight: 20, description: 'Are scenes well-constructed with clear purpose?' },
      { dimension: 'Dialogue', weight: 20, description: 'Is dialogue distinctive and purposeful?' },
      { dimension: 'Subtext', weight: 15, description: 'Is subtext present beneath surface dialogue?' },
      { dimension: 'Visual Storytelling', weight: 15, description: 'Does the writing think cinematically?' },
      { dimension: 'Emotional Impact', weight: 15, description: 'Does the material move the reader?' },
      { dimension: 'Production Feasibility', weight: 15, description: 'Is the script producible at its budget tier?' },
    ],
    analysisPromptModifier: 'This is a SCRIPT — full evaluation of scene construction, dialogue, subtext, visual storytelling, emotional impact, and production feasibility.',
    rewritePromptModifier: 'Apply full script rewrite with attention to all craft dimensions.',
    convergenceRules: { minCI: 75, minGP: 75 },
    forbiddenCritique: [],
  },
  production_draft: {
    rubricSections: [
      { dimension: 'Budget Realism', weight: 30, description: 'Is the script producible at its stated budget?' },
      { dimension: 'Shoot Efficiency', weight: 25, description: 'Can this be scheduled efficiently?' },
      { dimension: 'Trailer Moments', weight: 20, description: 'Are there clear marketing trailer beats?' },
      { dimension: 'Sales Clarity', weight: 25, description: 'Can this be pitched to buyers clearly?' },
    ],
    analysisPromptModifier: 'This is a PRODUCTION DRAFT — evaluate budget realism, shoot efficiency, trailer moments, and sales clarity.',
    rewritePromptModifier: 'Optimize for production feasibility and sales clarity.',
    convergenceRules: { minCI: 80, minGP: 80 },
    forbiddenCritique: [],
  },
  deck: {
    rubricSections: [
      { dimension: 'Factual Integrity', weight: 40, description: 'Is all content factually accurate?' },
      { dimension: 'Structural Coherence', weight: 30, description: 'Is the deck well-organized?' },
      { dimension: 'Audience Targeting', weight: 30, description: 'Is the intended audience clear?' },
    ],
    analysisPromptModifier: 'This is a DECK — evaluate factual integrity and structural coherence. Do NOT invent characters, fabricate scenes, or generate scene headings. Use [PLACEHOLDER] for missing information.',
    rewritePromptModifier: 'Improve structure and clarity ONLY. Do NOT invent any content. Use [PLACEHOLDER] for missing info.',
    convergenceRules: { minCI: 65, minGP: 70 },
    forbiddenCritique: ['dialogue quality', 'scene construction', 'visual storytelling', 'subtext', 'character depth'],
  },
  documentary_outline: {
    rubricSections: [
      { dimension: 'Factual Integrity', weight: 35, description: 'Is all content factually grounded?' },
      { dimension: 'Discovery Arc', weight: 25, description: 'Does the outline build a compelling discovery journey?' },
      { dimension: 'Emotional Truth', weight: 20, description: 'Does it convey emotional truth without fabrication?' },
      { dimension: 'Structure Shaping', weight: 20, description: 'Is the structure clear and purposeful?' },
    ],
    analysisPromptModifier: 'This is a DOCUMENTARY OUTLINE — evaluate factual integrity, discovery arc, emotional truth, and structure. Do NOT invent characters, fabricate scenes, or generate scene headings (INT./EXT.). Emotional truth is allowed but fictionalization is PROHIBITED.',
    rewritePromptModifier: 'Improve structure and discovery arc ONLY. Do NOT invent characters, fabricate scenes, or add INT./EXT. sluglines. Use [PLACEHOLDER] for any missing factual information.',
    convergenceRules: { minCI: 65, minGP: 60 },
    forbiddenCritique: ['dialogue quality', 'scene construction as fiction', 'character invention', 'fabricated scenes'],
  },
  format_rules: {
    rubricSections: [
      { dimension: 'Rule Clarity', weight: 35, description: 'Are format rules clearly defined and unambiguous?' },
      { dimension: 'Duration Alignment', weight: 30, description: 'Do rules align with canonical episode duration?' },
      { dimension: 'Platform Fit', weight: 20, description: 'Are rules appropriate for the target platform?' },
      { dimension: 'Completeness', weight: 15, description: 'Are all key format dimensions covered?' },
    ],
    analysisPromptModifier: 'This is a FORMAT RULES document — evaluate rule clarity, duration alignment, platform fit, and completeness. Do NOT evaluate narrative craft.',
    rewritePromptModifier: 'Sharpen rule definitions and ensure duration alignment. Do NOT add narrative content.',
    convergenceRules: { minCI: 60, minGP: 55 },
    forbiddenCritique: ['dialogue quality', 'scene construction', 'character depth'],
  },
  season_arc: {
    rubricSections: [
      { dimension: 'Arc Architecture', weight: 30, description: 'Is the season arc structurally sound?' },
      { dimension: 'Escalation Logic', weight: 25, description: 'Does tension build across the season?' },
      { dimension: 'Episode Count Alignment', weight: 25, description: 'Does arc match canonical episode count?' },
      { dimension: 'Thematic Spine', weight: 20, description: 'Is the thematic throughline clear?' },
    ],
    analysisPromptModifier: 'This is a SEASON ARC — evaluate arc architecture, escalation logic, episode count alignment, and thematic spine. Do NOT evaluate individual dialogue or scene-level craft.',
    rewritePromptModifier: 'Strengthen arc structure and escalation. Ensure episode count matches canonical qualifications.',
    convergenceRules: { minCI: 65, minGP: 60 },
    forbiddenCritique: ['dialogue quality', 'prose style', 'individual scene blocking'],
  },
  episode_grid: {
    rubricSections: [
      { dimension: 'Grid Completeness', weight: 30, description: 'Does grid cover all canonical episodes?' },
      { dimension: 'Hook Design', weight: 25, description: 'Does each episode have a clear hook and cliffhanger?' },
      { dimension: 'Escalation Curve', weight: 25, description: 'Does intensity build across episodes?' },
      { dimension: 'Engine Distribution', weight: 20, description: 'Are emotional engines distributed proportionally?' },
    ],
    analysisPromptModifier: 'This is an EPISODE GRID — evaluate grid completeness (must match canonical episode count), hook design, escalation curve, and engine distribution. Do NOT evaluate dialogue or prose.',
    rewritePromptModifier: 'Ensure grid covers exactly the canonical episode count. Strengthen hooks and escalation.',
    convergenceRules: { minCI: 60, minGP: 55 },
    forbiddenCritique: ['dialogue quality', 'prose style', 'scene blocking'],
  },
  vertical_episode_beats: {
    rubricSections: [
      { dimension: 'Beat Density', weight: 30, description: 'Does beat count meet duration-based minimum?' },
      { dimension: 'Hook & Cliffhanger', weight: 25, description: 'Are scroll-stop hooks and micro-cliffhangers present?' },
      { dimension: 'Escalation', weight: 25, description: 'Does each episode escalate tension?' },
      { dimension: 'Character Agency', weight: 20, description: 'Do characters drive the action?' },
    ],
    analysisPromptModifier: 'This is EPISODE BEATS for a vertical drama — evaluate beat density per episode duration, hook design (3-10 second window), cliffhanger endings, escalation, and character agency. Do NOT evaluate prose style.',
    rewritePromptModifier: 'Sharpen beat density, hooks, and cliffhangers. Ensure beats-per-minute meets format requirements.',
    convergenceRules: { minCI: 65, minGP: 60 },
    forbiddenCritique: ['prose style', 'literary quality', 'feature-film pacing'],
  },
  series_writer: {
    rubricSections: [
      { dimension: 'Canon Consistency', weight: 30, description: 'Does the episode maintain character/relationship consistency with canon?' },
      { dimension: 'Escalation & Pacing', weight: 25, description: 'Does tension escalate from the previous episode with vertical pacing?' },
      { dimension: 'Hook & Cliffhanger', weight: 25, description: 'Does the episode open with an immediate hook and end with a cliffhanger?' },
      { dimension: 'Arc Alignment', weight: 20, description: 'Does the episode advance the season arc per the episode grid?' },
    ],
    analysisPromptModifier: 'This is a SERIES WRITER episode — evaluate canon consistency, emotional escalation from the previous episode, hook/cliffhanger presence, and season arc alignment. Enforce vertical drama pacing.',
    rewritePromptModifier: 'Maintain strict canon. Sharpen hooks and cliffhangers. Ensure escalation from previous episode.',
    convergenceRules: { minCI: 70, minGP: 70 },
    forbiddenCritique: ['feature-film pacing', 'literary quality', 'canon changes'],
  },
};

// ── Public API ──

export function getReviewSchema(deliverableType: DeliverableType): ReviewSchema {
  return registry[deliverableType] || registry.script;
}

/**
 * Build format overlay prompt modifier based on project format.
 */
export function getFormatOverlay(
  format: string,
  episodeDurationSeconds?: number | null,
  episodeDurationMinSeconds?: number | null,
  episodeDurationMaxSeconds?: number | null,
): string {
  const g = getFormatGuardrails(format);
  const parts: string[] = [];

  if (g.softMinMinutes && g.softMaxMinutes) {
    parts.push(`FORMAT: Feature Film — target ${g.softMinMinutes}-${g.softMaxMinutes} minutes.`);
  }
  if (g.requiresThreeActSpine) parts.push('3-act spine required.');
  if (g.requiresMidpointReversal) parts.push('Midpoint reversal expected.');

  if (format === 'tv-series' || format === 'limited-series') {
    parts.push('FORMAT: TV Series — evaluate pilot engine clarity, season escalation logic, and character longevity.');
  }

  if (format === 'vertical-drama') {
    const min = episodeDurationMinSeconds || episodeDurationSeconds || 120;
    const max = episodeDurationMaxSeconds || episodeDurationSeconds || min;
    const mid = Math.round((min + max) / 2);
    const beatMinCount = verticalBeatMinimum(mid);
    const rangeStr = min !== max ? `${min}–${max}s (midpoint ${mid}s)` : `${min}s`;
    parts.push(`FORMAT: Vertical Drama — episode target ${rangeStr}. Hook required within 3-10 seconds. Mandatory micro-cliffhanger per episode. Minimum ${beatMinCount} beats per episode. BEAT = a distinct moment of story change that creates forward motion.`);
  }

  if (g.noFictionalization) {
    parts.push('FORMAT: Documentary — NO fictionalization. Emotional truth allowed. Discovery arc structure. Structure shaping only — never invent scenes or characters.');
  }

  return parts.join(' ');
}

/**
 * Build behavior modifier for prompts.
 */
export function getBehaviorModifier(behavior: DevelopmentBehavior): string {
  const cfg = behaviorConfig[behavior];
  switch (behavior) {
    case 'efficiency':
      return 'BEHAVIOR MODE: Efficiency — prioritise speed and directness. Lower convergence bar. Focus on actionable, production-ready improvements. Skip deep thematic analysis.';
    case 'prestige':
      return `BEHAVIOR MODE: Prestige — apply highest creative standards. Require minimum ${cfg.minRewriteCycles || 2} rewrite cycles. Deep thematic and structural analysis. Festival/awards positioning awareness.`;
    default:
      return 'BEHAVIOR MODE: Market — balanced creative-commercial analysis. Standard convergence thresholds.';
  }
}

/**
 * Build non-hallucination safeguard prompt for documentary/deck deliverables.
 */
export function getHallucinationGuard(deliverableType: DeliverableType, format: string): string {
  const guards: string[] = [];

  if (deliverableType === 'deck' || deliverableType === 'documentary_outline') {
    guards.push(
      'HALLUCINATION SAFEGUARD: Do NOT invent characters, fabricate scenes, or generate scene headings.',
      'Use [PLACEHOLDER] for any missing information.',
      'If you detect INT./EXT. sluglines in your output for a documentary, flag this as an error.',
    );
  }

  if (format === 'documentary' || format === 'documentary-series' || format === 'hybrid-documentary') {
    guards.push(
      'DOCUMENTARY GUARD: Never fictionalize. Emotional truth is allowed but invented scenes, characters, or dialogue are PROHIBITED.',
      'Structure shaping and thematic analysis only.',
    );
  }

  return guards.join('\n');
}

/**
 * Compose the full system prompt modifier for a given deliverable + format + behavior.
 */
export function composePromptContext(
  deliverableType: DeliverableType,
  format: string,
  behavior: DevelopmentBehavior,
  episodeDurationSeconds?: number | null,
  episodeDurationMinSeconds?: number | null,
  episodeDurationMaxSeconds?: number | null,
): string {
  const schema = getReviewSchema(deliverableType);
  const parts = [
    schema.analysisPromptModifier,
    getFormatOverlay(format, episodeDurationSeconds, episodeDurationMinSeconds, episodeDurationMaxSeconds),
    getBehaviorModifier(behavior),
  ];

  const hallucinationGuard = getHallucinationGuard(deliverableType, format);
  if (hallucinationGuard) parts.push(hallucinationGuard);

  const forbidden = schema.forbiddenCritique;
  if (forbidden.length > 0) {
    parts.push(`FORBIDDEN CRITIQUE (do NOT evaluate): ${forbidden.join(', ')}.`);
  }

  return parts.filter(Boolean).join('\n\n');
}
