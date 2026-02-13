/**
 * Grant Matching Engine — Matches documentary project to grant funds.
 */

import { useState, useEffect } from 'react';
import { Landmark, ExternalLink, Calendar, MapPin, Target, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

const KNOWN_FUNDS = [
  { name: 'Sundance Documentary Fund', body: 'Sundance Institute', max_amount: 100000, currency: 'USD', url: 'https://www.sundance.org/programs/documentary-fund', topics: ['social-issue', 'political', 'investigative', 'portrait'], territories: ['US', 'International'] },
  { name: 'BFI Doc Society Fund', body: 'BFI / Doc Society', max_amount: 50000, currency: 'GBP', url: 'https://www.docsociety.org/', topics: ['social-issue', 'political', 'nature', 'historical', 'investigative'], territories: ['UK', 'International'] },
  { name: 'IDFA Bertha Fund', body: 'IDFA', max_amount: 50000, currency: 'EUR', url: 'https://www.idfa.nl/en/info/idfa-bertha-fund', topics: ['social-issue', 'political', 'portrait', 'investigative'], territories: ['Global South', 'Developing Countries'] },
  { name: 'Catapult Film Fund', body: 'Catapult', max_amount: 35000, currency: 'USD', url: 'https://catapultfilmfund.org/', topics: ['social-issue', 'investigative', 'portrait', 'science'], territories: ['US', 'International'] },
  { name: 'PBS / ITVS', body: 'PBS', max_amount: 200000, currency: 'USD', url: 'https://itvs.org/', topics: ['social-issue', 'political', 'historical', 'science', 'nature'], territories: ['US'] },
  { name: 'Arte Documentary', body: 'Arte', max_amount: 150000, currency: 'EUR', url: 'https://www.arte.tv/', topics: ['social-issue', 'political', 'nature', 'historical', 'music-arts', 'science'], territories: ['Europe', 'France', 'Germany'] },
  { name: 'BBC Storyville', body: 'BBC', max_amount: 250000, currency: 'GBP', url: 'https://www.bbc.co.uk/programmes/b006mfx6', topics: ['social-issue', 'political', 'portrait', 'investigative', 'historical'], territories: ['UK', 'International'] },
  { name: 'Chicken & Egg Pictures', body: 'Chicken & Egg', max_amount: 50000, currency: 'USD', url: 'https://chickeneggpics.org/', topics: ['social-issue', 'political', 'portrait'], territories: ['US', 'International'] },
  { name: 'Ford Foundation JustFilms', body: 'Ford Foundation', max_amount: 150000, currency: 'USD', url: 'https://www.fordfoundation.org/work/challenging-inequality/justfilms/', topics: ['social-issue', 'political', 'investigative'], territories: ['International'] },
  { name: 'Screen Australia Documentary', body: 'Screen Australia', max_amount: 200000, currency: 'AUD', url: 'https://www.screenaustralia.gov.au/funding-and-support/documentary', topics: ['social-issue', 'nature', 'historical', 'portrait', 'science'], territories: ['Australia'] },
];

interface Props {
  projectId: string;
  genres: string[];
}

interface GrantMatch {
  name: string;
  body: string;
  max_amount: number;
  currency: string;
  url: string;
  match_score: number;
  reason: string;
}

function matchGenreToTopics(genres: string[]): string[] {
  const mapping: Record<string, string[]> = {
    'Social Issue': ['social-issue'],
    'Political': ['political'],
    'Nature / Environment': ['nature'],
    'Historical': ['historical'],
    'True Crime': ['investigative'],
    'Music / Arts': ['music-arts'],
    'Sports': ['sports'],
    'Science / Tech': ['science'],
    'Portrait / Biography': ['portrait'],
    'Investigative': ['investigative'],
  };
  const topics: string[] = [];
  for (const g of genres) {
    if (mapping[g]) topics.push(...mapping[g]);
  }
  return [...new Set(topics)];
}

export function GrantMatchingPanel({ projectId, genres }: Props) {
  const { user } = useAuth();
  const [matches, setMatches] = useState<GrantMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);

  const runMatching = () => {
    setLoading(true);
    const topics = matchGenreToTopics(genres);

    const scored = KNOWN_FUNDS.map(fund => {
      const topicOverlap = fund.topics.filter(t => topics.includes(t)).length;
      const topicScore = fund.topics.length > 0 ? (topicOverlap / Math.max(topics.length, 1)) * 60 : 30;
      const baseScore = 40 + topicScore;
      const score = Math.min(100, Math.round(baseScore));
      const reasons = [];
      if (topicOverlap > 0) reasons.push(`${topicOverlap} topic match${topicOverlap > 1 ? 'es' : ''}`);
      else reasons.push('General eligibility');

      return {
        name: fund.name,
        body: fund.body,
        max_amount: fund.max_amount,
        currency: fund.currency,
        url: fund.url,
        match_score: score,
        reason: reasons.join(', '),
      };
    }).sort((a, b) => b.match_score - a.match_score);

    setMatches(scored);
    setLoading(false);
  };

  const saveMatch = async (match: GrantMatch) => {
    if (!user) return;
    try {
      await supabase.from('grant_matches').insert({
        project_id: projectId,
        user_id: user.id,
        fund_name: match.name,
        fund_body: match.body,
        max_amount: match.max_amount,
        currency: match.currency,
        eligibility_match: match.match_score,
        topic_relevance: match.match_score,
        url: match.url,
        status: 'identified',
      } as any);
      setSaved(prev => [...prev, match.name]);
      toast.success(`${match.name} saved to pipeline`);
    } catch {
      toast.error('Failed to save grant match');
    }
  };

  useEffect(() => { runMatching(); }, [genres.join(',')]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h5 className="text-sm font-medium text-foreground">Grant Matching Engine</h5>
          <p className="text-xs text-muted-foreground">Matched to {genres.join(', ') || 'your topics'}</p>
        </div>
        <Button size="sm" variant="outline" onClick={runMatching} disabled={loading} className="text-xs gap-1.5">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
          Refresh
        </Button>
      </div>

      <div className="space-y-2">
        {matches.map(match => (
          <div key={match.name} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Landmark className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span className="text-sm font-medium text-foreground truncate">{match.name}</span>
                <Badge variant="outline" className={`text-[10px] ${
                  match.match_score >= 70 ? 'border-emerald-500/40 text-emerald-400' :
                  match.match_score >= 50 ? 'border-amber-500/40 text-amber-400' :
                  'border-muted text-muted-foreground'
                }`}>
                  {match.match_score}% match
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>Up to {match.currency} {match.max_amount.toLocaleString()}</span>
                <span>{match.reason}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <a href={match.url} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]">
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </a>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[10px]"
                onClick={() => saveMatch(match)}
                disabled={saved.includes(match.name)}
              >
                {saved.includes(match.name) ? '✓ Saved' : 'Track'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
