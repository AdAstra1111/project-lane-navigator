/**
 * Period / Lore Plausibility Layer — Evaluates visual elements against
 * historical period, geography, technology stage, and world rules.
 * 
 * Rule-based for clear anachronisms; AI-assisted for nuanced checks.
 */

import type { CanonConstraints } from './types';

// ── Types ──

export type PlausibilityLevel =
  | 'valid'
  | 'unlikely'
  | 'impossible'
  | 'tension'
  | 'contradiction'
  | 'anachronism'
  | 'material_mismatch'
  | 'unknown';

export interface PlausibilityCheck {
  domain: 'historical' | 'lore' | 'material' | 'technology' | 'cultural' | 'architectural';
  level: PlausibilityLevel;
  detail: string;
}

export interface PlausibilityReport {
  canonCompatibility: PlausibilityLevel;
  loreCompatibility: PlausibilityLevel;
  historicalCompatibility: PlausibilityLevel;
  materialCompatibility: PlausibilityLevel;
  checks: PlausibilityCheck[];
  promptConstraints: string[];
}

// ── Era / Technology mapping ──

interface EraTechProfile {
  keywords: RegExp;
  forbidden: RegExp;
  forbiddenLabel: string;
  materials: RegExp;
  materialLabel: string;
}

const ERA_PROFILES: EraTechProfile[] = [
  {
    keywords: /\b(ancient|roman|greek|egyptian|bronze age|iron age|mesopotamian|babylonian|sumerian)\b/i,
    forbidden: /\b(gun|firearm|cannon|musket|printing press|clock|compass|glass window|paper|book|steel|concrete|electric|phone|car|computer)\b/i,
    forbiddenLabel: 'Post-classical technology',
    materials: /\b(plastic|nylon|polyester|synthetic|rubber|aluminum|stainless steel)\b/i,
    materialLabel: 'Synthetic or industrial materials',
  },
  {
    keywords: /\b(medieval|dark ages|middle ages|feudal|viking|crusade|11th|12th|13th|14th century)\b/i,
    forbidden: /\b(gun|firearm|printing press|telescope|microscope|electric|phone|car|computer|photography|steam engine|railway)\b/i,
    forbiddenLabel: 'Post-medieval technology',
    materials: /\b(plastic|nylon|polyester|synthetic|rubber|aluminum|stainless steel|zipper)\b/i,
    materialLabel: 'Industrial materials',
  },
  {
    keywords: /\b(renaissance|tudor|elizabethan|15th|16th century)\b/i,
    forbidden: /\b(electric|phone|car|computer|photography|steam engine|railway|telegraph|radio)\b/i,
    forbiddenLabel: 'Industrial-era technology',
    materials: /\b(plastic|nylon|polyester|synthetic|rubber|aluminum|stainless steel)\b/i,
    materialLabel: 'Synthetic materials',
  },
  {
    keywords: /\b(victorian|19th century|1800s|regency|empire|napoleonic|civil war|western frontier)\b/i,
    forbidden: /\b(electric light|phone|car|computer|television|radio|airplane|helicopter|neon|LED)\b/i,
    forbiddenLabel: 'Electrical-era technology',
    materials: /\b(plastic|nylon|polyester|synthetic|lycra|spandex)\b/i,
    materialLabel: 'Synthetic fabric',
  },
];

// ── Architecture mapping ──

const ARCHITECTURE_RULES: { era: RegExp; forbidden: RegExp; label: string }[] = [
  {
    era: /\b(medieval|dark ages|viking|feudal)\b/i,
    forbidden: /\b(skyscraper|glass tower|modernist|brutalist|art deco|steel frame|concrete tower)\b/i,
    label: 'Modern architecture in medieval setting',
  },
  {
    era: /\b(ancient|roman|greek|egyptian)\b/i,
    forbidden: /\b(gothic cathedral|flying buttress|stained glass|brick building|timber frame)\b/i,
    label: 'Post-ancient architectural style',
  },
];

// ── Evaluator ──

/**
 * Evaluate period/lore plausibility for a text (prompt or description)
 * against canon constraints.
 */
export function evaluatePeriodLorePlausibility(
  text: string,
  canonConstraints: CanonConstraints,
  worldRules?: string,
): PlausibilityReport {
  const checks: PlausibilityCheck[] = [];
  const promptConstraints: string[] = [];
  const textLower = text.toLowerCase();
  
  const era = (canonConstraints.era || '').toLowerCase();
  
  // 1. Technology checks
  for (const profile of ERA_PROFILES) {
    if (profile.keywords.test(era)) {
      if (profile.forbidden.test(textLower)) {
        checks.push({
          domain: 'technology',
          level: 'anachronism',
          detail: `${profile.forbiddenLabel} detected in ${era} setting`,
        });
        promptConstraints.push(`AVOID: ${profile.forbiddenLabel} — incompatible with ${era} period`);
      }
      if (profile.materials.test(textLower)) {
        checks.push({
          domain: 'material',
          level: 'material_mismatch',
          detail: `${profile.materialLabel} detected in ${era} setting`,
        });
        promptConstraints.push(`AVOID: ${profile.materialLabel} — not available in ${era}`);
      }
    }
  }
  
  // 2. Architecture checks
  for (const rule of ARCHITECTURE_RULES) {
    if (rule.era.test(era) && rule.forbidden.test(textLower)) {
      checks.push({
        domain: 'architectural',
        level: 'anachronism',
        detail: rule.label,
      });
      promptConstraints.push(`AVOID: ${rule.label}`);
    }
  }
  
  // 3. World/lore checks (if world rules provided)
  if (worldRules) {
    const rulesLower = worldRules.toLowerCase();
    // Check for contradictions between text and world rules
    if (rulesLower.includes('no magic') && /\b(magic|spell|enchant|sorcery|wizard|witch)\b/i.test(textLower)) {
      checks.push({ domain: 'lore', level: 'contradiction', detail: 'Magic elements in a no-magic world' });
    }
    if (rulesLower.includes('no technology') && /\b(computer|robot|machine|engine|electric)\b/i.test(textLower)) {
      checks.push({ domain: 'lore', level: 'contradiction', detail: 'Technology in a no-technology world' });
    }
  }
  
  // Aggregate
  const hasAnachronism = checks.some(c => c.level === 'anachronism');
  const hasMaterialMismatch = checks.some(c => c.level === 'material_mismatch');
  const hasLoreContradiction = checks.some(c => c.domain === 'lore' && c.level === 'contradiction');
  
  return {
    canonCompatibility: checks.length === 0 ? 'valid' : hasAnachronism ? 'impossible' : 'tension',
    loreCompatibility: hasLoreContradiction ? 'contradiction' : 'valid',
    historicalCompatibility: hasAnachronism ? 'impossible' : hasMaterialMismatch ? 'unlikely' : 'valid',
    materialCompatibility: hasMaterialMismatch ? 'impossible' : 'valid',
    checks,
    promptConstraints,
  };
}

/**
 * Generate period/lore constraint block for prompt injection.
 */
export function formatPeriodConstraintsBlock(
  canonConstraints: CanonConstraints,
  worldRules?: string,
): string {
  const lines: string[] = [];
  
  if (canonConstraints.era) {
    lines.push(`[PERIOD: ${canonConstraints.era}]`);
    
    // Find matching era profile and add constraints
    for (const profile of ERA_PROFILES) {
      if (profile.keywords.test(canonConstraints.era)) {
        lines.push(`FORBIDDEN TECHNOLOGY: ${profile.forbiddenLabel}`);
        lines.push(`FORBIDDEN MATERIALS: ${profile.materialLabel}`);
        break;
      }
    }
  }
  
  if (canonConstraints.geography) {
    lines.push(`[GEOGRAPHY: ${canonConstraints.geography}]`);
  }
  
  if (worldRules) {
    lines.push(`[WORLD RULES: ${worldRules.slice(0, 200)}]`);
  }
  
  return lines.join('\n');
}
