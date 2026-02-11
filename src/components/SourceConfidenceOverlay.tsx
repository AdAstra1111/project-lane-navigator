import { motion } from 'framer-motion';
import { Database, Shield, Clock, RefreshCw, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useDataSources, useEngineSourceMappings, useModelVersionLog, effectiveSourceConfidence, type DataSource } from '@/hooks/useDataSources';
import { format as fmtDate } from 'date-fns';

interface Props {
  productionType: string;
  engines: { id: string; engine_name: string }[];
}

function FreshnessBadge({ source }: { source: DataSource }) {
  if (!source.last_refresh) return <Badge variant="outline" className="text-[10px] text-muted-foreground">Unknown</Badge>;
  const daysSince = Math.floor((Date.now() - new Date(source.last_refresh).getTime()) / (1000 * 60 * 60 * 24));
  const color = daysSince <= 7 ? 'text-emerald-400 border-emerald-500/30' : daysSince <= 30 ? 'text-amber-400 border-amber-500/30' : 'text-red-400 border-red-500/30';
  return (
    <Badge variant="outline" className={cn('text-[10px]', color)}>
      <Clock className="h-2.5 w-2.5 mr-0.5" />
      {daysSince}d ago
    </Badge>
  );
}

export function SourceConfidenceOverlay({ productionType, engines }: Props) {
  const { data: sources = [] } = useDataSources(productionType);
  const { data: mappings = [] } = useEngineSourceMappings();
  const { data: versionLog = [] } = useModelVersionLog(productionType);

  const latestVersion = versionLog.length > 0 ? versionLog[0] : null;
  const latestRecalibration = versionLog.find(v => v.change_type === 'recalibration' || v.change_type === 'weight_adjustment');

  // Overall source health
  const activeSources = sources.filter(s => s.status === 'active');
  const avgReliability = activeSources.length > 0
    ? activeSources.reduce((s, src) => s + src.reliability_score, 0) / activeSources.length
    : 0;
  const staleSources = activeSources.filter(s => {
    if (!s.last_refresh) return true;
    const days = (Date.now() - new Date(s.last_refresh).getTime()) / (1000 * 60 * 60 * 24);
    const limits: Record<string, number> = { daily: 3, weekly: 14, monthly: 45, quarterly: 120 };
    return days > (limits[s.refresh_frequency] || 45);
  });

  // Per-engine confidence
  const engineConfidences = engines.map(e => {
    const result = effectiveSourceConfidence(sources, mappings, e.id);
    return { ...e, ...result };
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5 space-y-4"
    >
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Database className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-display font-semibold text-foreground text-sm">
            Data Source Governance
          </h4>
          <p className="text-xs text-muted-foreground">
            Source freshness, reliability & model versioning
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-card/50 rounded-lg p-3 text-center border border-border/30">
          <span className="text-lg font-bold font-display text-foreground">{activeSources.length}</span>
          <p className="text-[10px] text-muted-foreground">Active Sources</p>
        </div>
        <div className="bg-card/50 rounded-lg p-3 text-center border border-border/30">
          <span className={cn('text-lg font-bold font-display', avgReliability >= 0.7 ? 'text-emerald-400' : avgReliability >= 0.4 ? 'text-amber-400' : 'text-red-400')}>
            {(avgReliability * 100).toFixed(0)}%
          </span>
          <p className="text-[10px] text-muted-foreground">Avg Reliability</p>
        </div>
        <div className="bg-card/50 rounded-lg p-3 text-center border border-border/30">
          <span className={cn('text-lg font-bold font-display', staleSources.length === 0 ? 'text-emerald-400' : 'text-amber-400')}>
            {staleSources.length}
          </span>
          <p className="text-[10px] text-muted-foreground">Stale Sources</p>
        </div>
        <div className="bg-card/50 rounded-lg p-3 text-center border border-border/30">
          <span className="text-lg font-bold font-display text-foreground">
            {latestVersion?.version_label || 'v1.0'}
          </span>
          <p className="text-[10px] text-muted-foreground">Model Version</p>
        </div>
      </div>

      {/* Source list */}
      {activeSources.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Registered Sources</p>
          {activeSources.map(source => (
            <div key={source.id} className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-card/30">
              <Shield className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-foreground flex-1 truncate">{source.source_name}</span>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">{source.source_type}</Badge>
              <span className="text-[10px] text-muted-foreground font-mono">{(source.reliability_score * 100).toFixed(0)}%</span>
              <FreshnessBadge source={source} />
            </div>
          ))}
        </div>
      )}

      {/* Engine confidence from sources */}
      {engineConfidences.filter(e => e.totalSources > 0).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Engine Source Confidence</p>
          {engineConfidences.filter(e => e.totalSources > 0).map(e => (
            <div key={e.id} className="flex items-center gap-2 py-1 px-2">
              <span className="text-xs text-foreground flex-1 truncate">{e.engine_name}</span>
              <span className="text-[10px] text-muted-foreground">{e.totalSources} src</span>
              {e.staleCount > 0 && (
                <span className="text-[10px] text-amber-400">{e.staleCount} stale</span>
              )}
              <span className={cn(
                'text-xs font-mono font-semibold',
                e.confidence >= 0.7 ? 'text-emerald-400' : e.confidence >= 0.4 ? 'text-amber-400' : 'text-red-400'
              )}>
                {(e.confidence * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Last recalibration */}
      <div className="border-t border-border/30 pt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
        <RefreshCw className="h-3 w-3" />
        <span>
          Last recalibration: {latestRecalibration
            ? fmtDate(new Date(latestRecalibration.created_at), 'MMM d, yyyy')
            : 'Never'}
        </span>
        {latestVersion && (
          <>
            <span className="mx-1">·</span>
            <Layers className="h-3 w-3" />
            <span>Model: {latestVersion.version_label || 'v1.0'}</span>
          </>
        )}
      </div>
    </motion.div>
  );
}
