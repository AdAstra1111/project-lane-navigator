import { MonetisationLane, ProjectInput, ClassificationResult, Recommendation, LANE_LABELS } from './types';

function scoreProject(input: ProjectInput): Record<MonetisationLane, number> {
  const scores: Record<MonetisationLane, number> = {
    'studio-streamer': 0,
    'independent-film': 0,
    'low-budget': 0,
    'international-copro': 0,
    'genre-market': 0,
    'prestige-awards': 0,
    'fast-turnaround': 0,
  };

  // Budget scoring
  switch (input.budget_range) {
    case 'under-250k':
      scores['low-budget'] += 5; scores['fast-turnaround'] += 2;
      break;
    case '250k-1m':
      scores['low-budget'] += 4; scores['independent-film'] += 2; scores['genre-market'] += 2;
      break;
    case '1m-5m':
      scores['independent-film'] += 4; scores['genre-market'] += 3; scores['international-copro'] += 2;
      break;
    case '5m-15m':
      scores['independent-film'] += 3; scores['international-copro'] += 3; scores['prestige-awards'] += 2; scores['genre-market'] += 2;
      break;
    case '15m-50m':
      scores['studio-streamer'] += 3; scores['international-copro'] += 3; scores['prestige-awards'] += 2;
      break;
    case '50m-plus':
      scores['studio-streamer'] += 5;
      break;
  }

  // Genre scoring
  const genres = input.genres.map(g => g.toLowerCase());
  if (genres.includes('horror')) { scores['genre-market'] += 3; scores['low-budget'] += 1; }
  if (genres.includes('thriller')) { scores['genre-market'] += 2; scores['independent-film'] += 1; }
  if (genres.includes('action')) { scores['studio-streamer'] += 2; scores['genre-market'] += 2; }
  if (genres.includes('drama')) { scores['prestige-awards'] += 2; scores['independent-film'] += 2; }
  if (genres.includes('comedy')) { scores['studio-streamer'] += 1; scores['independent-film'] += 1; }
  if (genres.includes('sci-fi') || genres.includes('fantasy')) { scores['studio-streamer'] += 2; }
  if (genres.includes('documentary')) { scores['independent-film'] += 2; scores['prestige-awards'] += 1; }
  if (genres.includes('romance')) { scores['independent-film'] += 1; scores['genre-market'] += 1; }
  if (genres.includes('crime')) { scores['genre-market'] += 2; scores['prestige-awards'] += 1; }
  if (genres.includes('war')) { scores['prestige-awards'] += 2; scores['international-copro'] += 1; }
  if (genres.includes('animation')) { scores['studio-streamer'] += 2; }
  if (genres.includes('western')) { scores['genre-market'] += 1; scores['independent-film'] += 1; }
  if (genres.includes('musical')) { scores['studio-streamer'] += 1; scores['prestige-awards'] += 1; }

  // Audience scoring
  switch (input.target_audience) {
    case 'mass-market': scores['studio-streamer'] += 4; break;
    case 'genre-fans': scores['genre-market'] += 3; break;
    case 'festival-arthouse': scores['prestige-awards'] += 3; scores['independent-film'] += 2; break;
    case 'international': scores['international-copro'] += 4; break;
    case 'young-adult': scores['studio-streamer'] += 2; scores['fast-turnaround'] += 2; break;
    case 'adult-drama': scores['prestige-awards'] += 2; scores['independent-film'] += 2; break;
    case 'family': scores['studio-streamer'] += 3; break;
  }

  // Tone scoring
  switch (input.tone) {
    case 'commercial': scores['studio-streamer'] += 3; scores['genre-market'] += 1; break;
    case 'elevated': scores['prestige-awards'] += 3; scores['independent-film'] += 1; break;
    case 'dark-gritty': scores['genre-market'] += 2; scores['prestige-awards'] += 1; break;
    case 'arthouse': scores['independent-film'] += 3; scores['prestige-awards'] += 2; break;
    case 'provocative': scores['prestige-awards'] += 2; scores['fast-turnaround'] += 2; break;
    case 'crowd-pleaser': scores['studio-streamer'] += 2; scores['genre-market'] += 1; break;
    case 'light-comedic': scores['studio-streamer'] += 1; scores['fast-turnaround'] += 1; break;
  }

  // Format scoring — production type aware
  switch (input.format) {
    case 'tv-series':
    case 'digital-series':
    case 'documentary-series':
      scores['studio-streamer'] += 2; scores['fast-turnaround'] += 1;
      break;
    case 'commercial':
    case 'branded-content':
    case 'music-video':
      scores['fast-turnaround'] += 3; scores['genre-market'] += 1;
      break;
    case 'short-film':
    case 'proof-of-concept':
      scores['low-budget'] += 3; scores['prestige-awards'] += 1;
      break;
    case 'hybrid':
      scores['fast-turnaround'] += 2; scores['independent-film'] += 1;
      break;
    default:
      scores['independent-film'] += 1; scores['prestige-awards'] += 1;
  }

  return scores;
}

function generateReasoning(lane: MonetisationLane, input: ProjectInput, confidence: number): string {
  const laneLabel = LANE_LABELS[lane];
  const confidenceText = confidence >= 0.7 ? 'strong' : confidence >= 0.45 ? 'moderate' : 'emerging';
  
  const reasoningMap: Record<MonetisationLane, string> = {
    'studio-streamer': `Your project shows a ${confidenceText} fit for the ${laneLabel} lane. The combination of ${input.budget_range === '50m-plus' ? 'high budget ambition' : 'commercial positioning'}, ${input.tone === 'commercial' ? 'accessible tone' : 'broad appeal'}, and ${input.format === 'tv-series' ? 'series format' : 'theatrical potential'} positions this as a studio or streaming platform play. Projects in this lane benefit from established distribution pipelines and major talent attachments.`,
    'independent-film': `Your project aligns with the ${laneLabel} lane with ${confidenceText} confidence. The ${input.genres.join(', ')} genre blend, combined with a ${input.tone} tone and ${input.target_audience === 'festival-arthouse' ? 'festival-oriented' : 'discerning'} audience targeting, suggests a project best served by the independent ecosystem — where creative vision drives packaging and distribution strategy.`,
    'low-budget': `This project fits the ${laneLabel} lane with ${confidenceText} confidence. At the ${input.budget_range} budget level, the key advantage is creative freedom and faster execution. ${input.genres.includes('Horror') ? 'Horror has historically delivered outsized returns at this budget level. ' : ''}Focus on resource-efficient storytelling and leveraging constraints as creative strengths.`,
    'international-copro': `Your project shows ${confidenceText} alignment with the ${laneLabel} lane. The ${input.target_audience === 'international' ? 'multi-territory audience focus' : 'story elements'} and budget positioning suggest this project could benefit from multi-country financing structures, accessing soft money, tax incentives, and international pre-sales.`,
    'genre-market': `This project fits the ${laneLabel} lane with ${confidenceText} confidence. ${input.genres.join(' and ')} projects have reliable market demand, especially with a ${input.tone} tone. The genre marketplace rewards clear positioning, strong marketing hooks, and efficient production. Consider sales agents and market-driven distribution.`,
    'prestige-awards': `Your project shows ${confidenceText} alignment with the ${laneLabel} lane. The ${input.tone} tone, ${input.genres.join(', ')} genre positioning, and ${input.target_audience === 'adult-drama' || input.target_audience === 'festival-arthouse' ? 'sophisticated audience targeting' : 'elevated approach'} position this for awards consideration and prestige distribution. Talent packaging and festival strategy will be critical.`,
    'fast-turnaround': `This project aligns with the ${laneLabel} lane with ${confidenceText} confidence. The combination of ${input.tone === 'provocative' ? 'topical, provocative content' : 'accessible positioning'} and ${input.budget_range === 'under-250k' || input.budget_range === '250k-1m' ? 'lean budget' : 'quick-execution potential'} suggests a project designed for speed-to-market. First-mover advantage on trending topics or formats is the key value driver.`,
  };

  return reasoningMap[lane];
}

function getRecommendations(lane: MonetisationLane, input: ProjectInput): Recommendation[] {
  const recs: Record<MonetisationLane, Recommendation[]> = {
    'studio-streamer': [
      { category: 'Packaging', title: 'Attach Recognizable Talent', description: 'Focus on A-list or rising-star cast with proven box office or streaming draw. A commercially experienced director strengthens the package.' },
      { category: 'Finance', title: 'Target Studio Deals or Streamer Pitches', description: 'Prepare a pitch deck for major studios or streaming platforms. Consider overall deals and first-look arrangements.' },
      { category: 'Strategy', title: 'Emphasize IP & Franchise Potential', description: 'Highlight sequel potential, universe-building, or existing IP. Studios prioritize properties with long-term value.' },
      { category: 'Market', title: 'Plan Wide Release Strategy', description: 'Position for wide theatrical release or premium streaming premiere with significant marketing support.' },
    ],
    'independent-film': [
      { category: 'Packaging', title: 'Director-Led Package', description: 'Lead with a distinctive directorial voice. Attach emerging or established indie talent who brings critical credibility.' },
      { category: 'Finance', title: 'Equity + Soft Money + Pre-Sales', description: 'Structure financing through equity investors, regional incentives, and territory pre-sales. Consider gap financing.' },
      { category: 'Strategy', title: 'Festival Premiere Strategy', description: 'Target top-tier festivals (Sundance, Cannes, Venice, TIFF) for premiere. Build word-of-mouth and critical momentum.' },
      { category: 'Market', title: 'Sales Agent & Distributor Outreach', description: 'Engage a reputable sales agent early. Platform releases and day-and-date strategies can maximize reach.' },
    ],
    'low-budget': [
      { category: 'Packaging', title: 'Lean Cast & Crew', description: 'Cast unknown but compelling actors. Consider dual-role crew members. Prioritize talent who bring energy over names.' },
      { category: 'Finance', title: 'Self-Finance or Micro-Investors', description: 'Consider personal investment, small private investors, or crowd-equity. Keep the cap table simple.' },
      { category: 'Strategy', title: 'Constraints as Creative Assets', description: 'Limited locations, small cast, and compressed shooting schedules can create intensity and authenticity. Lean into it.' },
      { category: 'Market', title: 'Direct Distribution & VOD', description: 'Consider self-distribution through platforms. Build an audience through social media and direct-to-audience channels.' },
    ],
    'international-copro': [
      { category: 'Packaging', title: 'Multi-Territory Talent', description: 'Attach talent with international recognition. Consider casting from partner countries to satisfy co-production treaty requirements.' },
      { category: 'Finance', title: 'Treaty Co-Production Structure', description: 'Identify eligible co-production treaties. Structure financing to access tax incentives, funds, and broadcaster commitments in each territory.' },
      { category: 'Strategy', title: 'Cultural Universality', description: 'Ensure the story resonates across cultures while honoring local specificity. Universal themes with local color travel best.' },
      { category: 'Market', title: 'International Markets & Festivals', description: 'Target markets like Cannes, Berlin, AFM for pre-sales. Engage sales agents with strong international track records.' },
    ],
    'genre-market': [
      { category: 'Packaging', title: 'Genre-Credible Talent', description: 'Attach actors and directors known within the genre community. A recognizable genre face can anchor pre-sales.' },
      { category: 'Finance', title: 'Pre-Sales Driven Financing', description: 'Genre titles pre-sell well. Engage a sales agent early to lock in territory deals that can finance production.' },
      { category: 'Strategy', title: 'Clear Marketing Hook', description: 'Define a simple, compelling logline and visual identity. Genre audiences respond to clear, bold positioning.' },
      { category: 'Market', title: 'Target Genre Markets & Platforms', description: 'Genre-focused distributors (Shudder, RLJE, etc.) and market screenings at AFM, Cannes Marché, or Frightfest.' },
    ],
    'prestige-awards': [
      { category: 'Packaging', title: 'Oscar-Caliber Talent', description: 'Attach actors and directors with awards track records or rising prestige profiles. Producers with awards relationships are valuable.' },
      { category: 'Finance', title: 'Prestige Financiers & Mini-Majors', description: 'Target financiers like A24, Focus Features, Searchlight, or Neon. These specialize in awards-positioned content.' },
      { category: 'Strategy', title: 'Awards Campaign Planning', description: 'Build an awards strategy from development. Consider premiere timing, screening strategy, and FYC campaign readiness.' },
      { category: 'Market', title: 'Festival-to-Awards Pipeline', description: 'Premiere at a top fall festival (Venice, Telluride, TIFF) and build momentum through the awards season calendar.' },
    ],
    'fast-turnaround': [
      { category: 'Packaging', title: 'Speed-First Talent', description: 'Attach fast-working, available talent. Prioritize actors and crew who can mobilize quickly over marquee names.' },
      { category: 'Finance', title: 'Rapid Financing', description: 'Use gap financing, revenue-sharing, or quick-close equity. Speed of capital deployment is as important as amount.' },
      { category: 'Strategy', title: 'Ride the Wave', description: 'Identify the trend or cultural moment driving this project. Execute while the topic is still in the zeitgeist.' },
      { category: 'Market', title: 'Platform-First Distribution', description: 'Target fast-acquiring platforms like Tubi, Roku Channel, or Amazon Freevee. Quick turnaround to viewer screens.' },
    ],
  };

  return recs[lane] || [];
}

export function classifyProject(input: ProjectInput, trendLaneInfluences?: import('@/lib/trend-influence').TrendLaneInfluence[]): ClassificationResult {
  const scores = scoreProject(input);

  // Apply trend lane influences
  if (trendLaneInfluences) {
    for (const influence of trendLaneInfluences) {
      const lane = influence.lane as MonetisationLane;
      if (lane in scores) {
        scores[lane] = Math.max(0, scores[lane] + influence.boost);
      }
    }
  }
  
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a) as [MonetisationLane, number][];
  const [topLane, topScore] = sorted[0];
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  
  const confidence = totalScore > 0 ? Math.min(topScore / totalScore, 0.95) : 0.5;
  const reasoning = generateReasoning(topLane, input, confidence);
  const recommendations = getRecommendations(topLane, input);

  return {
    lane: topLane,
    confidence,
    reasoning,
    recommendations,
  };
}
