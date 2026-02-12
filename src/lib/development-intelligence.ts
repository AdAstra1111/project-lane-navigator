/**
 * Development Intelligence: Risk Index, Audience Clarity, Commercial Tension.
 * Pure logic — no DB calls, computed from project data + analysis.
 */

import type { Project, FullAnalysis, CreativeSignal, MarketReality, StructuralRead } from '@/lib/types';
import type { ProjectScript } from '@/hooks/useProjectAttachments';

export interface DevScoreCard {
  label: string;
  score: number;       // 0-100
  level: 'low' | 'medium' | 'high' | 'critical';
  drivers: string[];
}

export interface DevelopmentIntelligence {
  riskIndex: DevScoreCard;
  audienceClarity: DevScoreCard;
  commercialTension: DevScoreCard;
}

function toLevel(score: number, invert = false): 'low' | 'medium' | 'high' | 'critical' {
  const s = invert ? 100 - score : score;
  if (s >= 75) return 'critical';
  if (s >= 50) return 'high';
  if (s >= 25) return 'medium';
  return 'low';
}

// ─── Development Risk Index ──────────────────────────────

function calcRiskIndex(
  project: Project,
  analysis: FullAnalysis | null,
  scripts: ProjectScript[],
  coverageVerdict?: string,
): DevScoreCard {
  let risk = 0;
  const drivers: string[] = [];

  // No script = high risk
  const currentScript = scripts.find(s => s.status === 'current');
  if (!currentScript && scripts.length === 0) {
    risk += 30;
    drivers.push('No script attached');
  } else if (!currentScript) {
    risk += 15;
    drivers.push('No current draft designated');
  }

  // Coverage verdict
  const verdict = coverageVerdict || project.script_coverage_verdict;
  if (verdict === 'PASS') {
    risk += 20;
    drivers.push('Coverage verdict: PASS');
  } else if (!verdict) {
    risk += 10;
    drivers.push('No coverage run yet');
  }

  // IP / chain-of-title flags
  if (!project.comparable_titles) {
    risk += 10;
    drivers.push('No comparable titles set — IP positioning unclear');
  }

  // Genre saturation heuristic
  const saturatedGenres = ['Horror', 'Thriller', 'Rom-Com'];
  const genreOverlap = (project.genres || []).filter(g => saturatedGenres.some(sg => g.toLowerCase().includes(sg.toLowerCase())));
  if (genreOverlap.length > 0) {
    risk += 8;
    drivers.push(`Genre saturation risk: ${genreOverlap.join(', ')}`);
  }

  // Analysis quality
  if (analysis) {
    if (analysis.structural_read?.protagonist_goal_clarity?.toLowerCase().includes('unclear')) {
      risk += 10;
      drivers.push('Protagonist goal clarity is weak');
    }
    if (analysis.creative_signal?.tone_consistency?.toLowerCase().includes('inconsistent')) {
      risk += 8;
      drivers.push('Tone inconsistency flagged');
    }
  } else {
    risk += 10;
    drivers.push('No AI analysis run');
  }

  // No logline
  if (!(project as any).logline && !project.comparable_titles) {
    risk += 5;
    drivers.push('No logline or comparables defined');
  }

  // Lane confidence
  if (project.confidence != null && project.confidence < 0.4) {
    risk += 10;
    drivers.push('Low lane classification confidence');
  }

  const score = Math.min(100, risk);
  return {
    label: 'Development Risk Index',
    score,
    level: toLevel(score),
    drivers: drivers.slice(0, 5),
  };
}

// ─── Audience Clarity Score ──────────────────────────────

function calcAudienceClarity(
  project: Project,
  analysis: FullAnalysis | null,
): DevScoreCard {
  let clarity = 0;
  const drivers: string[] = [];

  // Target audience set
  if (project.target_audience) {
    clarity += 25;
    drivers.push(`Target: ${project.target_audience}`);
  }

  // Genre defined
  if (project.genres?.length > 0) {
    clarity += 20;
    if (project.genres.length <= 3) {
      clarity += 5;
      drivers.push('Focused genre set');
    } else {
      drivers.push('Many genres — may dilute audience focus');
    }
  }

  // Tone set
  if (project.tone) {
    clarity += 15;
    drivers.push(`Tone: ${project.tone}`);
  }

  // Analysis audience insight
  if (analysis?.market_reality?.likely_audience) {
    clarity += 20;
    drivers.push('AI identified likely audience');
  }

  // Tone consistency from creative signal
  if (analysis?.creative_signal?.tone_consistency) {
    const tc = analysis.creative_signal.tone_consistency.toLowerCase();
    if (tc.includes('consistent') || tc.includes('strong')) {
      clarity += 15;
      drivers.push('Tone is consistent throughout');
    } else if (tc.includes('mixed') || tc.includes('inconsistent')) {
      clarity += 5;
      drivers.push('Tone consistency needs work');
    } else {
      clarity += 10;
    }
  }

  const score = Math.min(100, clarity);
  return {
    label: 'Audience Clarity',
    score,
    level: toLevel(score, true), // higher = better, invert for level
    drivers: drivers.slice(0, 5),
  };
}

// ─── Commercial Tension Score ────────────────────────────

function calcCommercialTension(
  project: Project,
  analysis: FullAnalysis | null,
): DevScoreCard {
  let tension = 0;
  const drivers: string[] = [];

  // Budget-to-market fit
  if (project.budget_range) {
    tension += 15;
    drivers.push(`Budget range set: ${project.budget_range}`);
  }

  // Lane classified
  if (project.assigned_lane) {
    tension += 20;
    drivers.push(`Lane: ${project.assigned_lane}`);
  }

  // Lane confidence
  if (project.confidence != null) {
    if (project.confidence >= 0.7) {
      tension += 15;
      drivers.push('High lane confidence');
    } else if (project.confidence >= 0.5) {
      tension += 10;
    } else {
      tension += 5;
      drivers.push('Lane confidence is low');
    }
  }

  // Comparable titles
  if (project.comparable_titles) {
    tension += 15;
    drivers.push('Comparable titles defined');
  }

  // Commercial risks from analysis
  if (analysis?.market_reality?.commercial_risks) {
    const risks = analysis.market_reality.commercial_risks.toLowerCase();
    if (risks.includes('low') || risks.includes('minimal')) {
      tension += 20;
      drivers.push('Low commercial risk identified');
    } else if (risks.includes('high') || risks.includes('significant')) {
      tension += 5;
      drivers.push('Significant commercial risks flagged');
    } else {
      tension += 12;
    }
  }

  // Budget implications
  if (analysis?.market_reality?.budget_implications) {
    tension += 10;
  }

  // Originality signal
  if (analysis?.creative_signal?.originality) {
    const orig = analysis.creative_signal.originality.toLowerCase();
    if (orig.includes('high') || orig.includes('strong') || orig.includes('fresh')) {
      tension += 5;
      drivers.push('High originality signal');
    }
  }

  const score = Math.min(100, tension);
  return {
    label: 'Commercial Tension',
    score,
    level: toLevel(score, true),
    drivers: drivers.slice(0, 5),
  };
}

// ─── Public API ──────────────────────────────────────────

export function calculateDevelopmentIntelligence(
  project: Project,
  scripts: ProjectScript[],
  analysis: FullAnalysis | null,
  coverageVerdict?: string,
): DevelopmentIntelligence {
  return {
    riskIndex: calcRiskIndex(project, analysis, scripts, coverageVerdict),
    audienceClarity: calcAudienceClarity(project, analysis),
    commercialTension: calcCommercialTension(project, analysis),
  };
}
