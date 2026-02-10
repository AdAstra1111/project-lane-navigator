/**
 * Buyer/Market Match Engine
 * Scores buyers against a project's metadata to surface likely fits.
 */

export interface BuyerMatch {
  buyerId: string;
  buyerName: string;
  companyType: string;
  score: number;          // 0-100
  matchReasons: string[];
  dealTypes: string[];
  territories: string[];
  marketPresence: string;
  appetiteNotes: string;
  recentAcquisitions: string;
}

interface MarketBuyer {
  id: string;
  name: string;
  company_type: string;
  genres_acquired: string[];
  budget_sweet_spot: string[];
  formats: string[];
  territories: string[];
  recent_acquisitions: string;
  appetite_notes: string;
  deal_types: string[];
  tone_preferences: string[];
  market_presence: string;
  status: string;
  confidence: string;
}

interface ProjectContext {
  format: string;
  genres: string[];
  budget_range: string;
  tone: string;
  target_audience: string;
  assigned_lane: string | null;
  cast_territories: string[];
}

export function matchBuyersToProject(
  buyers: MarketBuyer[],
  project: ProjectContext,
): BuyerMatch[] {
  const matches: BuyerMatch[] = [];

  for (const buyer of buyers) {
    if (buyer.status !== 'active') continue;

    let score = 0;
    const reasons: string[] = [];

    // Genre overlap (max 35 pts)
    const genreOverlap = project.genres.filter(g =>
      buyer.genres_acquired.some(bg => bg.toLowerCase() === g.toLowerCase())
    );
    if (genreOverlap.length > 0) {
      const genreScore = Math.min(35, (genreOverlap.length / Math.max(project.genres.length, 1)) * 35);
      score += genreScore;
      reasons.push(`Genre match: ${genreOverlap.join(', ')}`);
    }

    // Format match (max 20 pts)
    if (buyer.formats.some(f => f.toLowerCase().includes(project.format === 'tv-series' ? 'tv' : 'film'))) {
      score += 20;
      reasons.push(`Acquires ${project.format === 'tv-series' ? 'TV series' : 'films'}`);
    }

    // Budget alignment (max 20 pts)
    if (buyer.budget_sweet_spot.some(b => b === project.budget_range)) {
      score += 20;
      reasons.push('Budget range aligns');
    } else if (buyer.budget_sweet_spot.length === 0) {
      // No specific budget preference = partial match
      score += 5;
    }

    // Tone match (max 10 pts)
    if (project.tone && buyer.tone_preferences.some(t => t.toLowerCase() === project.tone.toLowerCase())) {
      score += 10;
      reasons.push('Tone preference match');
    }

    // Territory overlap with cast (max 15 pts)
    const territoryOverlap = project.cast_territories.filter(t =>
      buyer.territories.some(bt => bt.toLowerCase() === t.toLowerCase())
    );
    if (territoryOverlap.length > 0) {
      const terrScore = Math.min(15, territoryOverlap.length * 5);
      score += terrScore;
      reasons.push(`Territory coverage: ${territoryOverlap.join(', ')}`);
    } else if (buyer.territories.length === 0) {
      score += 3; // Global buyer
    }

    // Only include if reasonably matched
    if (score >= 25 && reasons.length >= 2) {
      matches.push({
        buyerId: buyer.id,
        buyerName: buyer.name,
        companyType: buyer.company_type,
        score: Math.min(100, score),
        matchReasons: reasons,
        dealTypes: buyer.deal_types,
        territories: buyer.territories,
        marketPresence: buyer.market_presence,
        appetiteNotes: buyer.appetite_notes,
        recentAcquisitions: buyer.recent_acquisitions,
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 10);
}
