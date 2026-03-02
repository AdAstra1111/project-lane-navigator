import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Link2Off } from 'lucide-react';
import type { TrendSignal } from '@/hooks/useTrends';

interface Citation {
  title?: string;
  url: string;
  source?: string;
  snippet?: string;
}

function parseHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function parseCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.filter((item): item is Citation => {
    if (!item || typeof item !== 'object') return false;
    const url = (item as any).url;
    if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) return false;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

interface TrendSignalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signal: TrendSignal | null;
}

export function TrendSignalModal({ open, onOpenChange, signal }: TrendSignalModalProps) {
  if (!signal) return null;

  const citations = parseCitations(signal.source_citations);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-display font-bold text-foreground leading-tight pr-6">
            {signal.name}
          </DialogTitle>
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <Badge variant="outline" className="text-[10px] h-5">{signal.category}</Badge>
            <Badge variant="outline" className="text-[10px] h-5">{signal.cycle_phase}</Badge>
            <Badge variant="outline" className="text-[10px] h-5 font-mono">{signal.strength}/10</Badge>
            <Badge variant={signal.velocity === 'Rising' ? 'default' : 'secondary'} className="text-[10px] h-5">{signal.velocity}</Badge>
            {signal.saturation_risk && signal.saturation_risk !== 'Low' && (
              <Badge variant="destructive" className="text-[10px] h-5">Sat: {signal.saturation_risk}</Badge>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Explanation */}
          <p className="text-sm text-foreground leading-relaxed">{signal.explanation}</p>

          {/* Forecast */}
          {signal.forecast && (
            <div className="border-l-2 border-primary/30 pl-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">12-month forecast:</span> {signal.forecast}
              </p>
            </div>
          )}

          {/* Meta */}
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
            {signal.region && <span className="bg-muted/50 rounded px-1.5 py-0.5">{signal.region}</span>}
            {signal.budget_tier && <span className="bg-muted/50 rounded px-1.5 py-0.5">{signal.budget_tier}</span>}
            {signal.target_buyer && <span className="bg-muted/50 rounded px-1.5 py-0.5">{signal.target_buyer}</span>}
            {signal.production_type && <span className="bg-muted/50 rounded px-1.5 py-0.5">{signal.production_type}</span>}
          </div>

          {/* Sources */}
          <div className="border-t border-border/30 pt-3">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
              Sources {citations.length > 0 && `(${citations.length})`}
            </h4>
            {citations.length > 0 ? (
              <ul className="space-y-1.5">
                {citations.map((c, i) => (
                  <li key={i}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2 hover:border-primary/40 hover:bg-primary/5 transition-colors group"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-foreground group-hover:text-primary transition-colors truncate block">
                          {c.title || parseHostname(c.url)}
                        </span>
                        {c.snippet && (
                          <span className="text-[11px] text-muted-foreground line-clamp-2 block mt-0.5">{c.snippet}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground/70 block mt-0.5">{parseHostname(c.url)}</span>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-border/30 bg-muted/10 px-3 py-3">
                <Link2Off className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">No sources were stored for this signal.</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">Use Refresh to attach sources from the next intelligence cycle.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
