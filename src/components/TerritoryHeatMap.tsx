import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Globe } from 'lucide-react';
import type { ProjectPartner } from '@/hooks/useProjectAttachments';

interface TerritoryData {
  name: string;
  count: number;
  types: string[];
}

// Map common territory/country names to region groups
const REGION_MAP: Record<string, string> = {
  // Europe
  uk: 'Europe', 'united kingdom': 'Europe', france: 'Europe', germany: 'Europe',
  italy: 'Europe', spain: 'Europe', scandinavia: 'Europe', nordic: 'Europe',
  benelux: 'Europe', netherlands: 'Europe', ireland: 'Europe', europe: 'Europe',
  austria: 'Europe', switzerland: 'Europe', portugal: 'Europe', greece: 'Europe',
  poland: 'Europe', czech: 'Europe', romania: 'Europe', hungary: 'Europe',
  // North America
  us: 'North America', usa: 'North America', 'united states': 'North America',
  canada: 'North America', 'north america': 'North America', mexico: 'North America',
  // Asia Pacific
  australia: 'Asia Pacific', 'new zealand': 'Asia Pacific', japan: 'Asia Pacific',
  korea: 'Asia Pacific', china: 'Asia Pacific', india: 'Asia Pacific',
  'asia pacific': 'Asia Pacific', 'south east asia': 'Asia Pacific', asia: 'Asia Pacific',
  // Latin America
  brazil: 'Latin America', argentina: 'Latin America', colombia: 'Latin America',
  chile: 'Latin America', 'latin america': 'Latin America', 'south america': 'Latin America',
  // Middle East & Africa
  'middle east': 'Middle East & Africa', africa: 'Middle East & Africa',
  'south africa': 'Middle East & Africa', israel: 'Middle East & Africa',
  dubai: 'Middle East & Africa', uae: 'Middle East & Africa', mena: 'Middle East & Africa',
  // Global
  global: 'Global', worldwide: 'Global', international: 'Global',
};

const REGIONS = ['North America', 'Europe', 'Asia Pacific', 'Latin America', 'Middle East & Africa', 'Global'];

const REGION_COLORS: Record<string, string> = {
  'North America': 'hsl(220, 70%, 55%)',
  'Europe': 'hsl(160, 60%, 45%)',
  'Asia Pacific': 'hsl(280, 55%, 55%)',
  'Latin America': 'hsl(35, 75%, 50%)',
  'Middle East & Africa': 'hsl(350, 60%, 55%)',
  'Global': 'hsl(200, 50%, 50%)',
};

function classifyTerritory(territory: string): string {
  const lower = territory.toLowerCase().trim();
  for (const [key, region] of Object.entries(REGION_MAP)) {
    if (lower.includes(key)) return region;
  }
  return 'Other';
}

interface Props {
  partners: ProjectPartner[];
  castTerritories: string[];
  incentiveJurisdictions: string[];
}

export function TerritoryHeatMap({ partners, castTerritories, incentiveJurisdictions }: Props) {
  const regionData = useMemo(() => {
    const regions: Record<string, { count: number; sources: Set<string> }> = {};

    // Partners
    for (const p of partners) {
      if (!p.territory) continue;
      const region = classifyTerritory(p.territory);
      if (!regions[region]) regions[region] = { count: 0, sources: new Set() };
      regions[region].count++;
      regions[region].sources.add(`Partner: ${p.partner_name}`);
    }

    // Cast territories
    for (const t of castTerritories) {
      const region = classifyTerritory(t);
      if (!regions[region]) regions[region] = { count: 0, sources: new Set() };
      regions[region].count++;
      regions[region].sources.add(`Cast territory: ${t}`);
    }

    // Incentive jurisdictions
    for (const j of incentiveJurisdictions) {
      const region = classifyTerritory(j);
      if (!regions[region]) regions[region] = { count: 0, sources: new Set() };
      regions[region].count++;
      regions[region].sources.add(`Incentive: ${j}`);
    }

    return regions;
  }, [partners, castTerritories, incentiveJurisdictions]);

  const maxCount = Math.max(...Object.values(regionData).map(r => r.count), 1);
  const totalPieces = Object.values(regionData).reduce((s, r) => s + r.count, 0);

  if (totalPieces === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.3 }}
      className="glass-card rounded-xl p-6"
    >
      <div className="flex items-center gap-2 mb-4">
        <Globe className="h-5 w-5 text-primary" />
        <h3 className="font-display font-semibold text-foreground">Territory Coverage</h3>
        <span className="text-xs text-muted-foreground ml-auto">{totalPieces} financing pieces</span>
      </div>

      {/* Visual heat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        {REGIONS.filter(r => regionData[r]).map(region => {
          const data = regionData[region];
          const intensity = data.count / maxCount;
          const color = REGION_COLORS[region] || 'hsl(200, 50%, 50%)';

          return (
            <motion.div
              key={region}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="relative rounded-lg p-4 overflow-hidden border border-border/50"
              style={{
                background: `linear-gradient(135deg, ${color}${Math.round(intensity * 30 + 5).toString(16).padStart(2, '0')}, transparent)`,
              }}
            >
              {/* Intensity indicator */}
              <div
                className="absolute bottom-0 left-0 right-0 rounded-b-lg"
                style={{
                  height: `${intensity * 100}%`,
                  background: `${color}15`,
                }}
              />
              <div className="relative z-10">
                <p className="text-xs font-medium text-foreground">{region}</p>
                <p className="text-2xl font-display font-bold text-foreground mt-1">{data.count}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {[...data.sources].slice(0, 2).map((s, i) => (
                    <span key={i} className="text-[10px] text-muted-foreground truncate max-w-full">
                      {s}
                    </span>
                  ))}
                  {data.sources.size > 2 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{data.sources.size - 2} more
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Concentration bar */}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Regional concentration</p>
        <div className="flex h-3 rounded-full overflow-hidden bg-muted/30">
          {REGIONS.filter(r => regionData[r]).map(region => {
            const data = regionData[region];
            const pct = (data.count / totalPieces) * 100;
            return (
              <motion.div
                key={region}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ backgroundColor: REGION_COLORS[region] }}
                title={`${region}: ${Math.round(pct)}%`}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3">
          {REGIONS.filter(r => regionData[r]).map(region => (
            <div key={region} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: REGION_COLORS[region] }} />
              <span className="text-[10px] text-muted-foreground">{region}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
