/**
 * Period / Lore Plausibility Constraint Engine — Evaluates visual elements against
 * historical period, geography, technology stage, material availability, and world rules.
 * 
 * Severity levels: contradiction | high_tension | mild_tension | valid
 */

import type { CanonConstraints } from './types';

// ── Types ──

export type PlausibilitySeverity = 'contradiction' | 'high_tension' | 'mild_tension' | 'valid';

export interface PlausibilityCheck {
  domain: 'historical' | 'lore' | 'material' | 'technology' | 'cultural' | 'architectural';
  severity: PlausibilitySeverity;
  detail: string;
  element: string;
  constraint: string;
}

export interface PlausibilityReport {
  canonCompatibility: PlausibilitySeverity;
  loreCompatibility: PlausibilitySeverity;
  historicalCompatibility: PlausibilitySeverity;
  materialCompatibility: PlausibilitySeverity;
  checks: PlausibilityCheck[];
  promptConstraints: string[];
  overallSeverity: PlausibilitySeverity;
}

// ── Era / Technology Profiles ──

interface EraTechProfile {
  keywords: RegExp;
  /** Items that absolutely did not exist */
  impossible: { pattern: RegExp; label: string }[];
  /** Items that are highly unlikely / anachronistic tension */
  unlikely: { pattern: RegExp; label: string }[];
  /** Materials that did not exist */
  forbiddenMaterials: { pattern: RegExp; label: string }[];
}

const ERA_PROFILES: EraTechProfile[] = [
  {
    keywords: /\b(ancient|roman|greek|egyptian|bronze age|iron age|mesopotamian|babylonian|sumerian|classical antiquity)\b/i,
    impossible: [
      { pattern: /\b(gun|firearm|cannon|musket|rifle|pistol)\b/i, label: 'Firearms' },
      { pattern: /\b(printing press|movable type|newspaper|printed book)\b/i, label: 'Printing technology' },
      { pattern: /\b(clock|watch|timepiece|compass|magnetic)\b/i, label: 'Mechanical instruments' },
      { pattern: /\b(glass window|windowpane|stained glass)\b/i, label: 'Glass windows' },
      { pattern: /\b(paper|parchment book|codex)\b/i, label: 'Paper/codex' },
      { pattern: /\b(steel|cast iron|blast furnace)\b/i, label: 'Steel/cast iron' },
      { pattern: /\b(concrete|cement|mortar mix)\b/i, label: 'Modern concrete' },
      { pattern: /\b(electric|phone|car|computer|television|radio|photograph)\b/i, label: 'Electrical technology' },
      { pattern: /\b(game\s?boy|nintendo|playstation|xbox|video\s?game|console)\b/i, label: 'Video games' },
    ],
    unlikely: [
      { pattern: /\b(silk)\b/i, label: 'Silk (limited availability)' },
      { pattern: /\b(cotton)\b/i, label: 'Cotton (regional availability)' },
    ],
    forbiddenMaterials: [
      { pattern: /\b(plastic|nylon|polyester|synthetic|rubber|aluminum|stainless\s?steel|polycarbonate|styrofoam|vinyl|PVC|acrylic|spandex|lycra|neoprene|kevlar|carbon\s?fiber|fiberglass)\b/i, label: 'Synthetic/industrial materials' },
      { pattern: /\b(zipper|velcro|snap\s?button|elastic\s?band)\b/i, label: 'Modern fasteners' },
    ],
  },
  {
    keywords: /\b(medieval|dark ages|middle ages|feudal|viking|crusade|11th|12th|13th|14th century|1[1-4]\d{2}s?)\b/i,
    impossible: [
      { pattern: /\b(gun|firearm|musket|rifle|pistol|revolver)\b/i, label: 'Firearms (pre-gunpowder era)' },
      { pattern: /\b(printing press|printed|newspaper)\b/i, label: 'Printing press' },
      { pattern: /\b(telescope|microscope|lens)\b/i, label: 'Optical instruments' },
      { pattern: /\b(electric|phone|car|computer|television|radio|photograph)\b/i, label: 'Electrical technology' },
      { pattern: /\b(steam engine|railway|train|locomotive)\b/i, label: 'Steam technology' },
      { pattern: /\b(game\s?boy|nintendo|playstation|xbox|video\s?game)\b/i, label: 'Video games' },
      { pattern: /\b(microwave|refrigerator|air\s?condition|washing\s?machine)\b/i, label: 'Modern appliances' },
    ],
    unlikely: [
      { pattern: /\b(pocket watch|mechanical clock)\b/i, label: 'Mechanical clocks (late medieval)' },
      { pattern: /\b(spectacles|eyeglasses)\b/i, label: 'Eyeglasses (late 13th century)' },
    ],
    forbiddenMaterials: [
      { pattern: /\b(plastic|nylon|polyester|synthetic|rubber|aluminum|stainless\s?steel|polycarbonate|styrofoam|vinyl|PVC|acrylic|spandex|lycra|zipper|velcro)\b/i, label: 'Industrial/synthetic materials' },
    ],
  },
  {
    keywords: /\b(renaissance|tudor|elizabethan|15th|16th century|1[45]\d{2}s?)\b/i,
    impossible: [
      { pattern: /\b(electric|phone|car|computer|television|radio|photograph|telegraph)\b/i, label: 'Electrical technology' },
      { pattern: /\b(steam engine|railway|train|locomotive)\b/i, label: 'Steam technology' },
      { pattern: /\b(game\s?boy|nintendo|playstation|xbox|video\s?game)\b/i, label: 'Video games' },
    ],
    unlikely: [
      { pattern: /\b(telescope)\b/i, label: 'Telescope (late Renaissance only)' },
    ],
    forbiddenMaterials: [
      { pattern: /\b(plastic|nylon|polyester|synthetic|rubber|aluminum|stainless\s?steel|polycarbonate|styrofoam|vinyl|PVC|spandex|lycra)\b/i, label: 'Synthetic materials' },
    ],
  },
  {
    keywords: /\b(victorian|19th century|1800s|regency|empire|napoleonic|civil war|western frontier|1[89]\d{2}s?)\b/i,
    impossible: [
      { pattern: /\b(electric\s?light|phone|smartphone|car|automobile|computer|television|radio|airplane|helicopter|neon|LED)\b/i, label: 'Electrical-era technology' },
      { pattern: /\b(game\s?boy|nintendo|playstation|xbox|video\s?game)\b/i, label: 'Video games' },
    ],
    unlikely: [
      { pattern: /\b(photograph|daguerreotype)\b/i, label: 'Photography (mid-19th century only)' },
    ],
    forbiddenMaterials: [
      { pattern: /\b(plastic|nylon|polyester|synthetic|lycra|spandex|polycarbonate|styrofoam|vinyl|PVC)\b/i, label: 'Synthetic fabric/plastic' },
    ],
  },
  {
    keywords: /\b(1900s|1910s|1920s|edwardian|roaring twenties|jazz age|prohibition)\b/i,
    impossible: [
      { pattern: /\b(television|TV|computer|laptop|smartphone|cell\s?phone|internet|wifi|satellite)\b/i, label: 'Post-WWII electronics' },
      { pattern: /\b(game\s?boy|nintendo|playstation|xbox|video\s?game)\b/i, label: 'Video games' },
      { pattern: /\b(jet|helicopter|missile|rocket)\b/i, label: 'Jet/rocket technology' },
    ],
    unlikely: [],
    forbiddenMaterials: [
      { pattern: /\b(nylon|polyester|spandex|lycra|polycarbonate|PVC)\b/i, label: 'Post-1930s synthetics' },
    ],
  },
  {
    keywords: /\b(1930s|1940s|world war|ww2|wwii|great depression|art deco era)\b/i,
    impossible: [
      { pattern: /\b(computer|laptop|smartphone|cell\s?phone|internet|wifi|satellite|microwave oven)\b/i, label: 'Post-1950s electronics' },
      { pattern: /\b(game\s?boy|nintendo|playstation|xbox|video\s?game)\b/i, label: 'Video games' },
    ],
    unlikely: [
      { pattern: /\b(television|TV)\b/i, label: 'Television (very early/rare)' },
    ],
    forbiddenMaterials: [
      { pattern: /\b(polycarbonate|spandex|lycra|PVC|kevlar|carbon\s?fiber|gore.?tex)\b/i, label: 'Post-1960s synthetics' },
    ],
  },
  {
    keywords: /\b(1950s|1960s|cold war|space age|mid.?century|post.?war)\b/i,
    impossible: [
      { pattern: /\b(smartphone|cell\s?phone|internet|wifi|laptop|tablet|streaming)\b/i, label: 'Digital-era technology' },
      { pattern: /\b(game\s?boy|nintendo|playstation|xbox)\b/i, label: 'Console gaming (post-1970s)' },
    ],
    unlikely: [
      { pattern: /\b(computer)\b/i, label: 'Computers (room-sized, institutional only)' },
    ],
    forbiddenMaterials: [
      { pattern: /\b(gore.?tex|carbon\s?fiber|kevlar)\b/i, label: 'Post-1970s advanced materials' },
    ],
  },
  {
    keywords: /\b(1970s|seventies|disco|punk)\b/i,
    impossible: [
      { pattern: /\b(smartphone|cell\s?phone|internet|wifi|laptop|tablet|streaming|bluetooth|usb)\b/i, label: 'Digital/mobile technology' },
      { pattern: /\b(game\s?boy)\b/i, label: 'Game Boy (released 1989)' },
      { pattern: /\b(playstation|xbox)\b/i, label: 'Modern consoles (1990s+)' },
      { pattern: /\b(CD|compact disc|DVD|blu.?ray)\b/i, label: 'Optical media' },
    ],
    unlikely: [
      { pattern: /\b(personal computer|PC|apple computer)\b/i, label: 'Personal computers (late 1970s only)' },
    ],
    forbiddenMaterials: [],
  },
];

// ── Architecture Rules ──

const ARCHITECTURE_RULES: { era: RegExp; forbidden: { pattern: RegExp; label: string }[] }[] = [
  {
    era: /\b(medieval|dark ages|viking|feudal|1[1-4]\d{2})\b/i,
    forbidden: [
      { pattern: /\b(skyscraper|glass tower|modernist|brutalist|art deco|steel frame|concrete tower|glass curtain wall)\b/i, label: 'Modern architecture in medieval setting' },
      { pattern: /\b(elevator|escalator|air conditioning|central heating)\b/i, label: 'Modern building systems in medieval setting' },
    ],
  },
  {
    era: /\b(ancient|roman|greek|egyptian|bronze|iron age)\b/i,
    forbidden: [
      { pattern: /\b(gothic cathedral|flying buttress|stained glass window|pointed arch|brick building|timber frame|half.?timber)\b/i, label: 'Post-ancient architectural style' },
    ],
  },
  {
    era: /\b(victorian|regency|georgian|19th century)\b/i,
    forbidden: [
      { pattern: /\b(glass curtain wall|brutalist|modernist|deconstructivist|parametric)\b/i, label: 'Post-Victorian architecture' },
    ],
  },
];

// ── Cultural / World Rules ──

interface WorldRuleCheck {
  condition: RegExp;
  forbidden: RegExp;
  label: string;
}

const WORLD_RULE_CHECKS: WorldRuleCheck[] = [
  { condition: /no magic/i, forbidden: /\b(magic|spell|enchant|sorcery|wizard|witch|wand|potion|conjure|summon)\b/i, label: 'Magic elements in a no-magic world' },
  { condition: /no technology/i, forbidden: /\b(computer|robot|machine|engine|electric|battery|circuit)\b/i, label: 'Technology in a no-technology world' },
  { condition: /no gunpowder/i, forbidden: /\b(gun|firearm|cannon|musket|rifle|pistol|gunpowder|explosive)\b/i, label: 'Gunpowder weapons in gunpowder-free world' },
  { condition: /no electricity/i, forbidden: /\b(electric|light\s?bulb|neon|LED|battery|generator|power\s?grid)\b/i, label: 'Electricity in electricity-free world' },
  { condition: /no flight/i, forbidden: /\b(airplane|aircraft|helicopter|flying machine|airship|zeppelin)\b/i, label: 'Flight in no-flight world' },
  { condition: /pre.?steel|no steel/i, forbidden: /\b(steel|stainless|steel\s?weapon|steel\s?sword|steel\s?armor)\b/i, label: 'Steel in a pre-steel world' },
];

// ── Evaluator ──

export function evaluatePeriodLorePlausibility(
  text: string,
  canonConstraints: CanonConstraints,
  worldRules?: string,
): PlausibilityReport {
  const checks: PlausibilityCheck[] = [];
  const promptConstraints: string[] = [];
  const textLower = text.toLowerCase();
  const era = (canonConstraints.era || '').toLowerCase();
  
  // 1. Technology checks — by era profile
  for (const profile of ERA_PROFILES) {
    if (!profile.keywords.test(era)) continue;
    
    for (const item of profile.impossible) {
      if (item.pattern.test(textLower)) {
        const match = textLower.match(item.pattern)?.[0] || '';
        checks.push({
          domain: 'technology', severity: 'contradiction',
          detail: `${item.label} detected in ${era} setting`,
          element: match, constraint: `Not available in ${era}`,
        });
        promptConstraints.push(`FORBIDDEN: ${item.label} — impossible in ${era}`);
      }
    }
    
    for (const item of profile.unlikely) {
      if (item.pattern.test(textLower)) {
        const match = textLower.match(item.pattern)?.[0] || '';
        checks.push({
          domain: 'technology', severity: 'mild_tension',
          detail: `${item.label} — unusual for ${era}`,
          element: match, constraint: `Limited availability in ${era}`,
        });
      }
    }
    
    // 2. Material checks
    for (const mat of profile.forbiddenMaterials) {
      if (mat.pattern.test(textLower)) {
        const match = textLower.match(mat.pattern)?.[0] || '';
        checks.push({
          domain: 'material', severity: 'contradiction',
          detail: `${mat.label} detected in ${era} setting`,
          element: match, constraint: `Material not available in ${era}`,
        });
        promptConstraints.push(`FORBIDDEN MATERIAL: ${mat.label} — not in ${era}`);
      }
    }
  }
  
  // 3. Architecture checks
  for (const rule of ARCHITECTURE_RULES) {
    if (!rule.era.test(era)) continue;
    for (const item of rule.forbidden) {
      if (item.pattern.test(textLower)) {
        const match = textLower.match(item.pattern)?.[0] || '';
        checks.push({
          domain: 'architectural', severity: 'contradiction',
          detail: item.label, element: match, constraint: `Architectural style mismatch for ${era}`,
        });
        promptConstraints.push(`FORBIDDEN ARCHITECTURE: ${item.label}`);
      }
    }
  }
  
  // 4. World/lore rule checks
  if (worldRules) {
    for (const rule of WORLD_RULE_CHECKS) {
      if (rule.condition.test(worldRules) && rule.forbidden.test(textLower)) {
        const match = textLower.match(rule.forbidden)?.[0] || '';
        checks.push({
          domain: 'lore', severity: 'contradiction',
          detail: rule.label, element: match, constraint: `World rule violation`,
        });
        promptConstraints.push(`WORLD RULE VIOLATION: ${rule.label}`);
      }
    }
  }
  
  // 5. Cultural checks from canon constraints
  if (canonConstraints.forbidden_elements) {
    for (const forbidden of canonConstraints.forbidden_elements) {
      const pattern = new RegExp(`\\b${forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (pattern.test(textLower)) {
        checks.push({
          domain: 'cultural', severity: 'high_tension',
          detail: `Forbidden element "${forbidden}" detected`,
          element: forbidden, constraint: 'Explicitly forbidden by canon constraints',
        });
      }
    }
  }
  
  // Aggregate severities
  const hasContradiction = checks.some(c => c.severity === 'contradiction');
  const hasHighTension = checks.some(c => c.severity === 'high_tension');
  const hasMildTension = checks.some(c => c.severity === 'mild_tension');
  const hasLoreContradiction = checks.some(c => c.domain === 'lore' && c.severity === 'contradiction');
  const hasMaterialContradiction = checks.some(c => c.domain === 'material' && c.severity === 'contradiction');
  const hasTechContradiction = checks.some(c => c.domain === 'technology' && c.severity === 'contradiction');
  
  const overallSeverity: PlausibilitySeverity = hasContradiction ? 'contradiction' :
    hasHighTension ? 'high_tension' : hasMildTension ? 'mild_tension' : 'valid';
  
  return {
    canonCompatibility: hasContradiction ? 'contradiction' : hasHighTension ? 'high_tension' : 'valid',
    loreCompatibility: hasLoreContradiction ? 'contradiction' : 'valid',
    historicalCompatibility: hasTechContradiction ? 'contradiction' : hasMildTension ? 'mild_tension' : 'valid',
    materialCompatibility: hasMaterialContradiction ? 'contradiction' : 'valid',
    checks,
    promptConstraints,
    overallSeverity,
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
    
    for (const profile of ERA_PROFILES) {
      if (profile.keywords.test(canonConstraints.era)) {
        const impossibleLabels = profile.impossible.map(i => i.label).join(', ');
        const materialLabels = profile.forbiddenMaterials.map(m => m.label).join(', ');
        if (impossibleLabels) lines.push(`FORBIDDEN TECHNOLOGY: ${impossibleLabels}`);
        if (materialLabels) lines.push(`FORBIDDEN MATERIALS: ${materialLabels}`);
        break;
      }
    }
  }
  
  if (canonConstraints.geography) {
    lines.push(`[GEOGRAPHY: ${canonConstraints.geography}]`);
  }
  
  if (worldRules) {
    lines.push(`[WORLD RULES: ${worldRules.slice(0, 300)}]`);
  }
  
  if (canonConstraints.forbidden_elements?.length) {
    lines.push(`[FORBIDDEN ELEMENTS: ${canonConstraints.forbidden_elements.join(', ')}]`);
  }
  
  return lines.join('\n');
}
