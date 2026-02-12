/**
 * Sales & Delivery Intelligence Engine
 * Revenue probability, platform suitability, and marketing alignment scoring.
 */

import type { Project } from '@/lib/types';
import type { ProjectDeal } from '@/hooks/useDeals';

// ── Revenue Probability Index ──

export interface RevenueProbabilityResult {
  totalWeightedRevenue: number;
  dealBreakdown: {
    territory: string;
    buyerName: string;
    amount: number;
    probability: number;
    weightedAmount: number;
    dealType: string;
    status: string;
  }[];
  riskFlags: string[];
  confidence: 'high' | 'medium' | 'low';
}

const STATUS_PROBABILITY: Record<string, number> = {
  closed: 1.0,
  signed: 1.0,
  'term-sheet': 0.8,
  negotiating: 0.5,
  offered: 0.25,
  passed: 0,
};

const TERRITORY_WEIGHT: Record<string, number> = {
  'North America': 1.0, 'USA': 1.0, 'UK': 0.9, 'Germany': 0.85, 'France': 0.85,
  'Japan': 0.8, 'Australia': 0.8, 'Italy': 0.75, 'Spain': 0.75, 'Scandinavia': 0.7,
  'South Korea': 0.7, 'China': 0.65, 'Latin America': 0.6, 'Middle East': 0.55,
  'Africa': 0.4, 'Southeast Asia': 0.5,
};

function getTerritoryWeight(territory: string): number {
  const key = Object.keys(TERRITORY_WEIGHT).find(
    k => territory.toLowerCase().includes(k.toLowerCase())
  );
  return key ? TERRITORY_WEIGHT[key] : 0.5;
}

export function calculateRevenueProbability(deals: ProjectDeal[]): RevenueProbabilityResult {
  const riskFlags: string[] = [];

  const dealBreakdown = deals
    .filter(d => d.status !== 'passed')
    .map(d => {
      const amount = parseFloat(d.minimum_guarantee?.replace(/[^0-9.]/g, '') || '0') || 0;
      const statusProb = STATUS_PROBABILITY[d.status] ?? 0.25;
      const territoryW = getTerritoryWeight(d.territory);
      const probability = Math.round(statusProb * territoryW * 100) / 100;
      return {
        territory: d.territory || 'Unassigned',
        buyerName: d.buyer_name || 'Unknown',
        amount,
        probability,
        weightedAmount: Math.round(amount * probability),
        dealType: d.deal_type,
        status: d.status,
      };
    })
    .sort((a, b) => b.weightedAmount - a.weightedAmount);

  const totalWeightedRevenue = dealBreakdown.reduce((s, d) => s + d.weightedAmount, 0);

  // Risk flags
  const territories = new Set(deals.filter(d => d.status === 'closed').map(d => d.territory));
  if (territories.size < 2 && deals.length > 0) riskFlags.push('Revenue concentrated in fewer than 2 territories');
  const allOffered = deals.filter(d => d.status === 'offered');
  if (allOffered.length > 3 && deals.filter(d => d.status === 'closed').length === 0) {
    riskFlags.push('Multiple offers but no closings — buyer hesitancy signal');
  }
  const passed = deals.filter(d => d.status === 'passed');
  if (passed.length >= 3) riskFlags.push(`${passed.length} deals passed — review positioning`);

  const closedCount = deals.filter(d => d.status === 'closed').length;
  const confidence = closedCount >= 3 ? 'high' : closedCount >= 1 ? 'medium' : 'low';

  return { totalWeightedRevenue, dealBreakdown, riskFlags, confidence };
}

// ── Platform Suitability Score ──

export interface PlatformMatch {
  platform: string;
  score: number;
  reasons: string[];
}

interface PlatformProfile {
  name: string;
  preferredFormats: string[];
  preferredGenres: string[];
  budgetRange: [string, string]; // min, max labels
  tonePrefs: string[];
  lanePrefs: string[];
}

const PLATFORMS: PlatformProfile[] = [
  {
    name: 'Netflix',
    preferredFormats: ['film', 'tv-series'],
    preferredGenres: ['thriller', 'sci-fi', 'action', 'drama', 'horror', 'romance', 'comedy'],
    budgetRange: ['mid', 'high'],
    tonePrefs: ['dark', 'gritty', 'elevated', 'suspenseful'],
    lanePrefs: ['Studio/Streamer', 'Genre/Market-Driven'],
  },
  {
    name: 'Amazon/MGM',
    preferredFormats: ['film', 'tv-series'],
    preferredGenres: ['thriller', 'drama', 'action', 'comedy', 'sci-fi'],
    budgetRange: ['mid', 'high'],
    tonePrefs: ['elevated', 'dark', 'witty'],
    lanePrefs: ['Studio/Streamer', 'Prestige/Awards', 'Independent Film'],
  },
  {
    name: 'Apple TV+',
    preferredFormats: ['film', 'tv-series'],
    preferredGenres: ['drama', 'thriller', 'sci-fi', 'documentary'],
    budgetRange: ['high', 'high'],
    tonePrefs: ['elevated', 'prestige', 'intimate'],
    lanePrefs: ['Prestige/Awards', 'Studio/Streamer'],
  },
  {
    name: 'A24 / MUBI / Neon',
    preferredFormats: ['film'],
    preferredGenres: ['drama', 'horror', 'thriller', 'comedy'],
    budgetRange: ['low', 'mid'],
    tonePrefs: ['auteur', 'arthouse', 'dark', 'intimate', 'surreal'],
    lanePrefs: ['Independent Film', 'Prestige/Awards', 'Low-Budget/Microbudget'],
  },
  {
    name: 'Theatrical Wide',
    preferredFormats: ['film'],
    preferredGenres: ['action', 'comedy', 'horror', 'family', 'animation', 'sci-fi'],
    budgetRange: ['mid', 'high'],
    tonePrefs: ['fun', 'exciting', 'scary', 'family-friendly'],
    lanePrefs: ['Studio/Streamer', 'Genre/Market-Driven'],
  },
  {
    name: 'Broadcast / Cable',
    preferredFormats: ['tv-series'],
    preferredGenres: ['drama', 'crime', 'procedural', 'comedy', 'reality'],
    budgetRange: ['low', 'mid'],
    tonePrefs: ['mainstream', 'accessible', 'warm'],
    lanePrefs: ['Genre/Market-Driven', 'Fast-Turnaround/Trend-Based'],
  },
];

const BUDGET_TIERS: Record<string, number> = {
  'micro': 0, 'low': 1, 'mid': 2, 'medium': 2, 'high': 3, 'studio': 3,
};

function budgetTier(range?: string): number {
  if (!range) return 1;
  const lower = range.toLowerCase();
  for (const [key, val] of Object.entries(BUDGET_TIERS)) {
    if (lower.includes(key)) return val;
  }
  return 1;
}

export function calculatePlatformSuitability(project: Project): PlatformMatch[] {
  const genres = (project.genres || []).map(g => g.toLowerCase());
  const tone = (project.tone || '').toLowerCase();
  const format = project.format || '';
  const lane = project.assigned_lane || '';
  const budget = budgetTier(project.budget_range);

  return PLATFORMS.map(p => {
    let score = 0;
    const reasons: string[] = [];

    // Format match (+25)
    if (p.preferredFormats.includes(format)) { score += 25; reasons.push('Format match'); }

    // Genre overlap (+30 max)
    const genreOverlap = genres.filter(g => p.preferredGenres.some(pg => g.includes(pg) || pg.includes(g)));
    const genreScore = Math.min(30, genreOverlap.length * 10);
    score += genreScore;
    if (genreOverlap.length > 0) reasons.push(`${genreOverlap.length} genre match(es)`);

    // Budget fit (+20)
    const [minLabel, maxLabel] = p.budgetRange;
    const minTier = BUDGET_TIERS[minLabel] ?? 1;
    const maxTier = BUDGET_TIERS[maxLabel] ?? 3;
    if (budget >= minTier && budget <= maxTier) { score += 20; reasons.push('Budget range fits'); }
    else if (Math.abs(budget - minTier) <= 1 || Math.abs(budget - maxTier) <= 1) { score += 8; }

    // Tone match (+15)
    if (tone && p.tonePrefs.some(t => tone.includes(t) || t.includes(tone))) {
      score += 15; reasons.push('Tone alignment');
    }

    // Lane match (+10)
    if (lane && p.lanePrefs.includes(lane)) { score += 10; reasons.push('Lane alignment'); }

    return { platform: p.name, score: Math.min(100, score), reasons };
  })
    .sort((a, b) => b.score - a.score);
}

// ── Marketing Alignment ──

export interface MarketingItem {
  territory: string;
  materials: { name: string; ready: boolean }[];
  readinessPct: number;
}

export function calculateMarketingAlignment(
  deals: ProjectDeal[],
  deliverables?: { territory: string; status: string; item_name: string }[],
): MarketingItem[] {
  const activeTerritories = [...new Set(
    deals
      .filter(d => d.status !== 'passed' && d.territory)
      .map(d => d.territory)
  )];

  if (activeTerritories.length === 0) return [];

  const allDeliverables = deliverables || [];

  return activeTerritories.map(territory => {
    const territoryDeliverables = allDeliverables.filter(
      d => d.territory === territory || d.territory === '' || !d.territory
    );

    const STANDARD_MATERIALS = ['Trailer', 'Key Art', 'Press Kit', 'Screener', 'Technical Specs'];
    const materials = STANDARD_MATERIALS.map(name => {
      const match = territoryDeliverables.find(
        d => d.item_name.toLowerCase().includes(name.toLowerCase())
      );
      return { name, ready: match ? (match.status === 'delivered' || match.status === 'approved') : false };
    });

    const readyCount = materials.filter(m => m.ready).length;
    return {
      territory,
      materials,
      readinessPct: Math.round((readyCount / materials.length) * 100),
    };
  }).sort((a, b) => b.readinessPct - a.readinessPct);
}
