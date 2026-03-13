/**
 * DocumentViewer — Creator UI document reading & approval experience.
 * Handles: standard docs, episode-grid navigation, season scripts.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import {
  CheckCircle2, Loader2, RefreshCw, Download, ChevronLeft, ChevronRight,
  AlertCircle, FileText, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useCreatorDocument } from '@/hooks/useCreatorDocument';
import { STAGE_LABELS } from '@/components/creator/stageLabels';

// Script-type stages that get screenplay formatting
const SCRIPT_STAGES = new Set(['season_script', 'feature_script', 'script']);

// Episode-navigable stages
const EPISODE_STAGES = new Set(['season_script', 'vertical_episode_beats', 'episode_grid']);

interface DocumentViewerProps {
  projectId: string;
  stage: string;
  episodeCount?: number;
  onApproved?: () => void;
}

export function DocumentViewer({ projectId, stage, episodeCount, onApproved }: DocumentViewerProps) {
  const label = STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ');
  const { content, isApproved, isGenerating, isLoading, approve, isApproving, versionNumber, metaJson }
    = useCreatorDocument(projectId, stage);

  const isScript = SCRIPT_STAGES.has(stage);
  const isEpisodic = EPISODE_STAGES.has(stage) && (episodeCount ?? 0) > 1;

  // Episode navigation state
  const [activeEpisode, setActiveEpisode] = useState(1);
  const contentRef = useRef<HTMLDivElement>(null);

  // Parse episodes from content (looks for "EPISODE N" or "EP N" headers)
  const episodes = useMemo(() => {
    if (!isEpisodic || !content) return [];
    const matches: { number: number; start: number }[] = [];
    const re = /(?:^|\n)(?:EPISODE|EP\.?\s*)(\d+)/gi;
    let m;
    while ((m = re.exec(content)) !== null) {
      matches.push({ number: parseInt(m[1], 10), start: m.index });
    }
    return matches;
  }, [content, isEpisodic]);

  const totalEpisodes = episodes.length > 0 ? episodes.length : episodeCount ?? 1;

  // Get content slice for current episode
  const displayContent = useMemo(() => {
    if (!content) return '';
    if (!isEpisodic || episodes.length === 0) return content;

    const idx = episodes.findIndex(e => e.number === activeEpisode);
    if (idx === -1) return content;
    const start = episodes[idx].start;
    const end = episodes[idx + 1]?.start ?? content.length;
    return content.slice(start, end).trim();
  }, [content, isEpisodic, episodes, activeEpisode]);

  // Scroll to top when episode changes
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeEpisode]);

  // Handle approve + cascade
  const handleApprove = async () => {
    await approve();
    onApproved?.();
  };

  // ── Loading state ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading {label}…</span>
        </div>
      </div>
    );
  }

  // ── Generating state ─────────────────────────────────────────────────────
  if (isGenerating) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="relative">
            <div className="h-12 w-12 rounded-full border-2 border-amber-400/20 border-t-amber-400 animate-spin" />
            <Sparkles className="h-5 w-5 text-amber-400 absolute inset-0 m-auto" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-1">
              Generating {label}…
            </p>
            <p className="text-xs text-muted-foreground">
              IFFY is working on this. It'll be ready in a few minutes.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium mb-1">{label}</p>
            <p className="text-xs text-muted-foreground">
              This document hasn't been generated yet. Turn on Auto-Run or trigger generation from the pipeline.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Main document view ───────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      {/* Document header */}
      <div className="px-6 py-3 border-b border-border/20 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground shrink-0">
            {label}
          </h2>
          {versionNumber !== null && (
            <span className="text-[10px] text-muted-foreground/50">v{versionNumber}</span>
          )}
          {isApproved && (
            <Badge className="text-[9px] px-1.5 py-0 h-4 bg-emerald-500/15 text-emerald-400 border-emerald-500/20 font-normal">
              Approved ✓
            </Badge>
          )}
          {/* CI/GP from metaJson */}
          {metaJson?.ci && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal">
              CI {metaJson.ci}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground">
            <RefreshCw className="h-3 w-3" />
            Regenerate
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground">
            <Download className="h-3 w-3" />
            Export
          </Button>
          {!isApproved && (
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white border-0"
              onClick={handleApprove}
              disabled={isApproving}
            >
              {isApproving
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <CheckCircle2 className="h-3 w-3" />
              }
              Approve & continue
            </Button>
          )}
          {isApproved && (
            <div className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approved
            </div>
          )}
        </div>
      </div>

      {/* Episode navigation strip — only for episodic content */}
      {isEpisodic && totalEpisodes > 1 && (
        <div className="px-6 py-2 border-b border-border/10 flex items-center gap-2 shrink-0 overflow-x-auto">
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 shrink-0"
            disabled={activeEpisode <= 1}
            onClick={() => setActiveEpisode(e => Math.max(1, e - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>

          <div className="flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-none">
            {Array.from({ length: Math.min(totalEpisodes, 60) }, (_, i) => i + 1).map(ep => (
              <button
                key={ep}
                onClick={() => setActiveEpisode(ep)}
                className={cn(
                  "h-5 min-w-[1.5rem] px-1 rounded text-[9px] font-mono transition-colors shrink-0",
                  activeEpisode === ep
                    ? "bg-amber-500 text-black font-bold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {ep}
              </button>
            ))}
          </div>

          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 shrink-0"
            disabled={activeEpisode >= totalEpisodes}
            onClick={() => setActiveEpisode(e => Math.min(totalEpisodes, e + 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>

          <span className="text-[10px] text-muted-foreground shrink-0">
            {activeEpisode} / {totalEpisodes}
          </span>
        </div>
      )}

      {/* Document body */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        <div className={cn(
          "mx-auto py-8 px-8",
          isScript ? "max-w-2xl" : "max-w-3xl"
        )}>
          {isScript ? (
            <ScriptContent content={displayContent} />
          ) : (
            <ProseContent content={displayContent} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Prose content — standard documents ──────────────────────────────────────

function ProseContent({ content }: { content: string }) {
  // Try to render with section headings styled nicely
  const sections = content.split(/\n(?=[A-Z][A-Z\s]{3,}(?:\n|$))/);

  if (sections.length <= 1) {
    return (
      <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
        {content}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sections.map((section, i) => {
        const lines = section.trim().split('\n');
        const firstLine = lines[0];
        const isHeading = firstLine === firstLine.toUpperCase() && firstLine.length < 60;
        const rest = lines.slice(isHeading ? 1 : 0).join('\n').trim();

        return (
          <div key={i}>
            {isHeading && (
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                {firstLine}
              </h3>
            )}
            {rest && (
              <p className="text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap">
                {rest}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Script content — screenplay formatting ───────────────────────────────────

function ScriptContent({ content }: { content: string }) {
  const lines = content.split('\n');

  return (
    <div className="font-mono text-sm leading-relaxed space-y-0">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const isSceneHeading = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(trimmed);
        const isCharacterCue = trimmed === trimmed.toUpperCase() && trimmed.length > 0 && trimmed.length < 40 && !/[.!?]$/.test(trimmed) && !/^(INT|EXT|CUT|FADE|DISSOLVE|SMASH)/.test(trimmed) && i > 0;
        const isParenthetical = /^\(.*\)$/.test(trimmed);
        const isAction = !isSceneHeading && !isCharacterCue && !isParenthetical && trimmed.length > 0;

        if (!trimmed) return <div key={i} className="h-3" />;

        return (
          <div
            key={i}
            className={cn(
              "leading-relaxed",
              isSceneHeading && "font-bold text-foreground mt-5 mb-1 text-xs tracking-wide uppercase",
              isCharacterCue && "text-center font-semibold text-foreground/90 mt-3 mb-0.5",
              isParenthetical && "text-center text-muted-foreground text-xs italic ml-16 mr-16",
              isAction && "text-foreground/80 text-xs"
            )}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
}
