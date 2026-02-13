import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Brain, Loader2, Play, Layers, BookOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  useCorpusCalibrations,
  useCorpusPlaybooks,
  useAggregateCorpus,
  useGeneratePlaybooks,
} from '@/hooks/useCorpusInsights';

const CHART_COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

export function CorpusInsightsDashboard() {
  const { data: calibrations = [], isLoading } = useCorpusCalibrations();
  const { data: playbooks = [] } = useCorpusPlaybooks();
  const aggregate = useAggregateCorpus();
  const genPlaybooks = useGeneratePlaybooks();
  const [showPlaybooks, setShowPlaybooks] = useState(false);

  const pageData = calibrations.map(c => ({
    name: c.production_type,
    pages: Math.round(c.median_page_count),
    scenes: Math.round(c.median_scene_count),
  }));

  const dialogueData = calibrations.map(c => ({
    name: c.production_type,
    ratio: Math.round((c.median_dialogue_ratio || 0) * 100),
  }));

  const castData = calibrations.map(c => ({
    name: c.production_type,
    cast: Math.round(c.median_cast_size),
    locations: Math.round(c.median_location_count),
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Corpus Intelligence</h3>
          <Badge variant="secondary">{calibrations.length} formats</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => aggregate.mutate()} disabled={aggregate.isPending}>
            {aggregate.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Layers className="w-4 h-4 mr-1" />}
            Rebuild Models
          </Button>
          <Button size="sm" variant="outline" onClick={() => genPlaybooks.mutate()} disabled={genPlaybooks.isPending}>
            {genPlaybooks.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <BookOpen className="w-4 h-4 mr-1" />}
            Generate Playbooks
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : calibrations.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No calibration data yet. Analyze corpus scripts first, then rebuild models.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Page Count + Scene Count */}
          <div className="border border-border rounded-lg p-4 bg-card">
            <h4 className="text-xs font-semibold text-muted-foreground mb-3">Median Pages & Scenes by Format</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={pageData}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="pages" fill="hsl(var(--primary))" name="Pages" radius={[2, 2, 0, 0]} />
                <Bar dataKey="scenes" fill="hsl(var(--accent))" name="Scenes" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Dialogue Ratio */}
          <div className="border border-border rounded-lg p-4 bg-card">
            <h4 className="text-xs font-semibold text-muted-foreground mb-3">Dialogue Ratio by Format (%)</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dialogueData}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip contentStyle={{ fontSize: 11, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="ratio" fill="#f59e0b" name="Dialogue %" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Cast + Locations */}
          <div className="border border-border rounded-lg p-4 bg-card">
            <h4 className="text-xs font-semibold text-muted-foreground mb-3">Median Cast & Locations</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={castData}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="cast" fill="#10b981" name="Cast" radius={[2, 2, 0, 0]} />
                <Bar dataKey="locations" fill="#8b5cf6" name="Locations" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Calibration Stats Table */}
          <div className="border border-border rounded-lg p-4 bg-card">
            <h4 className="text-xs font-semibold text-muted-foreground mb-3">Calibration Summary</h4>
            <div className="space-y-2">
              {calibrations.map(c => (
                <div key={c.production_type} className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0">
                  <span className="font-medium text-foreground capitalize">{c.production_type}</span>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{c.sample_size} scripts</span>
                    <span>~{Math.round(c.median_runtime)} min</span>
                    <span>Quality: {Math.round(c.median_quality_score)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Playbooks */}
      {playbooks.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowPlaybooks(!showPlaybooks)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <BookOpen className="h-3 w-3" /> {showPlaybooks ? 'Hide' : 'Show'} Rewrite Playbooks ({playbooks.length})
          </button>
          {showPlaybooks && (
            <div className="space-y-2">
              {playbooks.map((pb, i) => (
                <div key={i} className="p-3 rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground">{pb.name}</span>
                    {pb.priority && <Badge variant="outline" className="text-[9px]">P{pb.priority}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{pb.description}</p>
                  <div className="space-y-0.5">
                    {pb.operations.map((op, j) => (
                      <p key={j} className="text-xs text-muted-foreground pl-2 before:content-['→'] before:mr-1.5 before:text-primary/60">{op}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
