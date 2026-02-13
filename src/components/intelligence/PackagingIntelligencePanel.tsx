import { useState } from 'react';
import { Loader2, Package, Users, Crosshair, Globe, TrendingUp, AlertTriangle, Flame, Target, DollarSign, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OperationProgress } from '@/components/OperationProgress';

const STAGES = [
  { at: 10, label: 'Analysing project profile…' },
  { at: 25, label: 'Evaluating role attractiveness…' },
  { at: 45, label: 'Running director targeting logic…' },
  { at: 65, label: 'Assessing sales & finance positioning…' },
  { at: 80, label: 'Building attachment strategy…' },
  { at: 95, label: 'Simulating package heat…' },
];

interface HeatAxis { score: number; rationale: string; }
interface RoleAnalysis {
  character: string;
  role_type: string;
  magnetism_score: number;
  rationale: string;
  casting_notes: string;
}

interface PackagingResult {
  package_profile: {
    project_scale: string;
    genre_position: string;
    attachment_leverage: string;
  };
  role_analysis: RoleAnalysis[];
  director_targeting: {
    profile_type: string;
    reasoning: string;
    finance_impact: string;
  };
  sales_positioning: {
    international_appeal: { score: number; rationale: string };
    presales_viability: string;
    tax_incentive_dependency: string;
    equity_risk: string;
    risk_mitigation: string[];
  };
  attachment_strategy: {
    primary_path: string;
    secondary_path: string;
    tertiary_path: string;
  };
  heat_simulation: {
    talent_heat: HeatAxis;
    market_moment: HeatAxis;
    festival_strategy: HeatAxis;
    streamer_pitch: HeatAxis;
    overall_confidence: number;
  };
  castability_risk: boolean;
}

interface Props {
  projectTitle: string;
  format: string;
  genres: string[];
  lane: string;
  budget?: string;
  scoringGrid?: Record<string, number | null>;
  riskFlags?: string[];
  developmentTier?: string | null;
  greenlightVerdict?: string;
  greenlightSummary?: string;
  coverageSummary?: string;
  characters?: any[];
}

export function PackagingIntelligencePanel({
  projectTitle, format, genres, lane, budget,
  scoringGrid, riskFlags, developmentTier,
  greenlightVerdict, greenlightSummary, coverageSummary, characters,
}: Props) {
  const [result, setResult] = useState<PackagingResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('packaging-intelligence', {
        body: {
          projectTitle, format, genres, lane, budget,
          scoringGrid, riskFlags, developmentTier,
          greenlightVerdict, greenlightSummary,
          coverageSummary: coverageSummary?.slice(0, 2000),
          characters: characters?.slice(0, 15),
        },
      });
      if (error) throw error;
      setResult(data);
    } catch (e: any) {
      toast.error(e?.message || 'Packaging intelligence failed');
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (s: number) =>
    s >= 7 ? 'text-emerald-400' : s >= 5 ? 'text-amber-400' : 'text-red-400';

  const levelColor = (level: string) => {
    const l = level?.toLowerCase();
    if (l === 'low') return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    if (l === 'strong' || l === 'high') return 'text-red-400 border-red-500/30 bg-red-500/10';
    return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
  };

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Packaging & Attachment Intelligence</h4>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Package className="h-3.5 w-3.5 mr-1.5" />}
          Run Analysis
        </Button>
      </div>

      <OperationProgress isActive={loading} stages={STAGES} />

      {!result && !loading && (
        <p className="text-sm text-muted-foreground">
          Converts development analysis into actionable packaging strategy for talent attachment, director targeting, sales leverage, and finance positioning.
        </p>
      )}

      {result && (
        <div className="space-y-5">
          {/* Package Profile */}
          <div className="glass-card rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Package Profile Summary</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ProfileCard label="Project Scale" value={result.package_profile.project_scale} icon={DollarSign} />
              <ProfileCard label="Genre Position" value={result.package_profile.genre_position} icon={Target} />
              <ProfileCard label="Attachment Leverage" value={result.package_profile.attachment_leverage} icon={Users} />
            </div>
          </div>

          {/* Role Attractiveness */}
          {result.role_analysis?.length > 0 && (
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Role Attractiveness Analysis</p>
                {result.castability_risk && (
                  <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30 bg-red-500/10 ml-auto">
                    <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Castability Risk
                  </Badge>
                )}
              </div>
              <div className="space-y-3">
                {result.role_analysis.map((role, i) => (
                  <div key={i} className="bg-muted/20 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{role.character}</span>
                        <Badge variant="secondary" className="text-[10px]">{role.role_type}</Badge>
                      </div>
                      <span className={`text-lg font-display font-bold ${scoreColor(role.magnetism_score)}`}>
                        {role.magnetism_score}<span className="text-xs text-muted-foreground">/10</span>
                      </span>
                    </div>
                    <Progress value={role.magnetism_score * 10} className="h-1 mb-1.5" />
                    <p className="text-xs text-muted-foreground">{role.rationale}</p>
                    {role.casting_notes && (
                      <p className="text-xs text-primary/80 mt-1 italic">{role.casting_notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Director Targeting */}
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Crosshair className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Director Targeting Logic</p>
            </div>
            <div className="space-y-2">
              <Badge variant="outline" className="text-xs">{result.director_targeting.profile_type}</Badge>
              <p className="text-sm text-foreground">{result.director_targeting.reasoning}</p>
              <p className="text-xs text-primary/80 italic">{result.director_targeting.finance_impact}</p>
            </div>
          </div>

          {/* Sales & Finance Positioning */}
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Sales & Finance Positioning</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div>
                <span className="text-[10px] text-muted-foreground">Intl. Appeal</span>
                <div className={`text-lg font-display font-bold ${scoreColor(result.sales_positioning.international_appeal.score)}`}>
                  {result.sales_positioning.international_appeal.score}<span className="text-xs text-muted-foreground">/10</span>
                </div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Pre-Sales</span>
                <Badge variant="outline" className={`mt-1 text-[10px] ${levelColor(result.sales_positioning.presales_viability)}`}>
                  {result.sales_positioning.presales_viability}
                </Badge>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Tax Incentive Dep.</span>
                <Badge variant="outline" className={`mt-1 text-[10px] ${levelColor(result.sales_positioning.tax_incentive_dependency)}`}>
                  {result.sales_positioning.tax_incentive_dependency}
                </Badge>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Equity Risk</span>
                <Badge variant="outline" className={`mt-1 text-[10px] ${levelColor(result.sales_positioning.equity_risk)}`}>
                  {result.sales_positioning.equity_risk}
                </Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-1">{result.sales_positioning.international_appeal.rationale}</p>
            {result.sales_positioning.risk_mitigation?.length > 0 && (
              <div className="mt-2 space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Risk Mitigation</span>
                {result.sales_positioning.risk_mitigation.map((m, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
                    <span className="text-foreground">{m}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attachment Strategy */}
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Map className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Attachment Strategy</p>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Primary Path', text: result.attachment_strategy.primary_path },
                { label: 'Secondary Path', text: result.attachment_strategy.secondary_path },
                { label: 'Tertiary Path', text: result.attachment_strategy.tertiary_path },
              ].map((s) => (
                <div key={s.label}>
                  <Badge variant="secondary" className="mb-1 text-[10px]">{s.label}</Badge>
                  <p className="text-sm text-foreground">{s.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Heat Simulation */}
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <Flame className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Heat Simulation</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-muted-foreground">Overall Confidence</span>
                <div className={`text-xl font-display font-bold ${scoreColor(result.heat_simulation.overall_confidence)}`}>
                  {result.heat_simulation.overall_confidence}<span className="text-xs text-muted-foreground">/10</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                { key: 'talent_heat', label: 'Talent Heat', icon: Users },
                { key: 'market_moment', label: 'Market Moment', icon: TrendingUp },
                { key: 'festival_strategy', label: 'Festival Strategy', icon: Target },
                { key: 'streamer_pitch', label: 'Streamer Pitch', icon: Globe },
              ] as const).map(({ key, label, icon: Icon }) => {
                const axis = result.heat_simulation[key];
                if (!axis) return null;
                return (
                  <div key={key} className="bg-muted/20 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{label}</span>
                      </div>
                      <span className={`text-lg font-display font-bold ${scoreColor(axis.score)}`}>
                        {axis.score}<span className="text-xs text-muted-foreground">/10</span>
                      </span>
                    </div>
                    <Progress value={axis.score * 10} className="h-1 mb-1.5" />
                    <p className="text-xs text-muted-foreground">{axis.rationale}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof DollarSign }) {
  return (
    <div className="bg-muted/20 rounded-lg p-3 text-center">
      <Icon className="h-4 w-4 text-primary mx-auto mb-1.5" />
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
