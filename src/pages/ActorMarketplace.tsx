/**
 * ActorMarketplace — Phase 16: Browse, filter, and cast public marketplace actors.
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store, Search, Users, Loader2, Crown, ArrowUpDown,
  SlidersHorizontal, Film, Sparkles, ShieldCheck, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import {
  getPublicMarketplaceActors,
  type MarketplaceActorProfile,
  type PricingTier,
} from '@/lib/aiCast/marketplaceIntelligence';
import { getActorThumbnail } from '@/lib/aiCast/identityStrength';
import { useAIActors } from '@/lib/aiCast/useAICast';

type SortMode = 'quality' | 'usage' | 'name' | 'tier';
type FilterTier = 'all' | 'free' | 'standard' | 'premium' | 'signature';

const TIER_CONFIG: Record<string, { label: string; badgeClass: string; dotClass: string }> = {
  free: { label: 'Free', badgeClass: 'text-muted-foreground border-border', dotClass: 'bg-muted-foreground' },
  standard: { label: 'Standard', badgeClass: 'text-sky-400 border-sky-400/30', dotClass: 'bg-sky-400' },
  premium: { label: 'Premium', badgeClass: 'text-violet-400 border-violet-400/30', dotClass: 'bg-violet-400' },
  signature: { label: 'Signature', badgeClass: 'text-amber-400 border-amber-400/30', dotClass: 'bg-amber-400' },
};

const REUSE_TIER_CONFIG: Record<string, { label: string; className: string }> = {
  signature: { label: 'Signature', className: 'text-amber-400 border-amber-400/30' },
  reliable: { label: 'Reliable', className: 'text-emerald-400 border-emerald-400/30' },
  emerging: { label: 'Emerging', className: 'text-sky-400 border-sky-400/30' },
  unvalidated: { label: 'Unvalidated', className: 'text-muted-foreground border-border' },
};

export default function ActorMarketplace() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('quality');
  const [filterTier, setFilterTier] = useState<FilterTier>('all');

  const { data: marketplaceActors, isLoading } = useQuery({
    queryKey: ['marketplace-actors'],
    queryFn: getPublicMarketplaceActors,
    staleTime: 30_000,
  });

  // Get actor versions for thumbnails
  const { data: actorsData } = useAIActors();
  const versionMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of actorsData?.actors || []) {
      m.set(a.id, a);
    }
    return m;
  }, [actorsData]);

  const filtered = useMemo(() => {
    let list = marketplaceActors || [];

    // Text search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.actor_name.toLowerCase().includes(q) ||
        a.tags.some(t => t.toLowerCase().includes(q)) ||
        a.description.toLowerCase().includes(q)
      );
    }

    // Tier filter
    if (filterTier !== 'all') {
      list = list.filter(a => a.pricing_tier === filterTier);
    }

    // Sort
    list = [...list].sort((a, b) => {
      if (sortMode === 'name') return a.actor_name.localeCompare(b.actor_name);
      if (sortMode === 'usage') return b.project_count - a.project_count;
      if (sortMode === 'tier') {
        const order: Record<string, number> = { signature: 0, premium: 1, standard: 2, free: 3 };
        return (order[a.pricing_tier] ?? 3) - (order[b.pricing_tier] ?? 3);
      }
      // quality (default)
      return (b.quality_score ?? -1) - (a.quality_score ?? -1);
    });

    return list;
  }, [marketplaceActors, search, filterTier, sortMode]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
            <Store className="h-5 w-5" /> Actor Marketplace
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Browse and cast reusable AI performers from the global roster
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => navigate('/ai-cast')}>
          <Users className="h-3.5 w-3.5" /> My Actors
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search actors by name, tags, description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>
        <Select value={filterTier} onValueChange={v => setFilterTier(v as FilterTier)}>
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <SlidersHorizontal className="h-3 w-3 mr-1" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Tiers</SelectItem>
            <SelectItem value="free" className="text-xs">Free</SelectItem>
            <SelectItem value="standard" className="text-xs">Standard</SelectItem>
            <SelectItem value="premium" className="text-xs">Premium</SelectItem>
            <SelectItem value="signature" className="text-xs">Signature</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortMode} onValueChange={v => setSortMode(v as SortMode)}>
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <ArrowUpDown className="h-3 w-3 mr-1" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="quality" className="text-xs">Highest Quality</SelectItem>
            <SelectItem value="usage" className="text-xs">Most Used</SelectItem>
            <SelectItem value="tier" className="text-xs">Pricing Tier</SelectItem>
            <SelectItem value="name" className="text-xs">Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
        <span>{(marketplaceActors || []).length} listed actor{(marketplaceActors || []).length !== 1 ? 's' : ''}</span>
        <span>{filtered.length} showing</span>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <Store className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {(marketplaceActors || []).length === 0
              ? 'No actors are currently listed on the marketplace.'
              : 'No actors match your search.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(actor => (
            <MarketplaceActorCard
              key={actor.actor_id}
              actor={actor}
              actorData={versionMap.get(actor.actor_id)}
              onClick={() => navigate(`/ai-cast`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Marketplace Actor Card ──────────────────────────────────────────────────

function MarketplaceActorCard({
  actor,
  actorData,
  onClick,
}: {
  actor: MarketplaceActorProfile;
  actorData: any;
  onClick: () => void;
}) {
  const thumbnail = actorData
    ? getActorThumbnail(actorData.ai_actor_versions, actorData.approved_version_id)
    : null;

  const tierCfg = TIER_CONFIG[actor.pricing_tier] || TIER_CONFIG.free;
  const reuseCfg = REUSE_TIER_CONFIG[actor.reusability_tier] || REUSE_TIER_CONFIG.unvalidated;

  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border border-border/50 bg-card/50 hover:bg-muted/20 transition-colors overflow-hidden group"
    >
      {/* Image */}
      <div className="aspect-[3/2] bg-muted/10 relative overflow-hidden">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={actor.actor_name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Users className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}

        {/* Top-right badges */}
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          {actor.roster_ready && (
            <span className="rounded-full text-[8px] px-1.5 py-0.5 font-medium bg-amber-500/90 text-white inline-flex items-center gap-0.5">
              <Crown className="h-2 w-2" /> Roster
            </span>
          )}
          <span className={cn(
            'rounded-full text-[8px] px-1.5 py-0.5 font-medium border bg-background/80 backdrop-blur-sm',
            tierCfg.badgeClass
          )}>
            {tierCfg.label}
          </span>
        </div>

        {/* Quality overlay */}
        {actor.quality_score != null && (
          <div className="absolute bottom-2 left-2">
            <span className="rounded-full text-[9px] px-2 py-0.5 font-medium bg-background/80 backdrop-blur-sm text-foreground border border-border/30">
              Q: {actor.quality_score}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground truncate">{actor.actor_name}</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <p className="text-[11px] text-muted-foreground line-clamp-2">
          {actor.description || 'No description'}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {actor.reusability_tier !== 'unvalidated' && (
            <Badge variant="outline" className={cn('text-[9px] h-5', reuseCfg.className)}>
              {reuseCfg.label}
            </Badge>
          )}
          {actor.project_count > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Film className="h-2.5 w-2.5" /> {actor.project_count} project{actor.project_count > 1 ? 's' : ''}
            </span>
          )}
          {actor.usage_count > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Sparkles className="h-2.5 w-2.5" /> {actor.usage_count} cast{actor.usage_count > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {actor.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {actor.tags.slice(0, 4).map(tag => (
              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
