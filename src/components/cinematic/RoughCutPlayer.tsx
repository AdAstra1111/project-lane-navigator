/**
 * Rough Cut Player — Playlist-mode player that auto-advances through shots.
 * Shows timeline, clickable shot list, and playback controls.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Film, Play, Pause, SkipForward, SkipBack, Loader2, AlertCircle, Download,
} from "lucide-react";
import { toast } from "sonner";

interface TimelineClip {
  shotIndex: number;
  srcPath: string;
  publicUrl?: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

interface TimelineV1 {
  version: string;
  fps: number;
  resolution: string;
  totalDurationSec: number;
  tracks: { type: string; clips: TimelineClip[] }[];
}

interface RoughCutRow {
  id: string;
  project_id: string;
  job_id: string;
  plan_id: string;
  status: string;
  timeline_json: TimelineV1;
  artifact_json: Record<string, unknown>;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface RoughCutPlayerProps {
  projectId: string;
  jobId: string;
  planId: string;
  allShotsComplete: boolean;
}

export default function RoughCutPlayer({ projectId, jobId, planId, allShotsComplete }: RoughCutPlayerProps) {
  const qc = useQueryClient();

  const { data: roughCuts, isLoading } = useQuery({
    queryKey: ["rough-cuts", jobId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rough_cuts")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data || []) as RoughCutRow[];
    },
    enabled: !!jobId,
  });

  const createRoughCut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("create-rough-cut", {
        body: { job_id: jobId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["rough-cuts", jobId] });
      if (data?.idempotent) {
        toast.info("Rough cut already exists");
      } else {
        toast.success("Rough cut generated");
      }
    },
    onError: (e: any) => toast.error("Failed: " + e.message),
  });

  const latestCut = roughCuts?.[0];
  const hasComplete = latestCut?.status === "complete";

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Film className="h-4 w-4" /> Rough Cut
          </CardTitle>
          {!hasComplete && allShotsComplete && (
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={createRoughCut.isPending}
              onClick={() => createRoughCut.mutate()}
            >
              {createRoughCut.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Film className="h-3 w-3 mr-1" />
              )}
              Generate Rough Cut
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {isLoading ? (
          <div className="text-xs text-muted-foreground py-2">Loading…</div>
        ) : !latestCut ? (
          <div className="text-xs text-muted-foreground py-2">
            {allShotsComplete
              ? "No rough cut yet. Click Generate to create one."
              : "Waiting for all shots to complete…"}
          </div>
        ) : latestCut.status === "error" ? (
          <div className="text-xs text-destructive flex items-center gap-1 py-2">
            <AlertCircle className="h-3 w-3" />
            {latestCut.last_error || "Assembly failed"}
          </div>
        ) : latestCut.status === "running" || latestCut.status === "queued" ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Assembling rough cut…
          </div>
        ) : (
          <PlaylistPlayer timeline={latestCut.timeline_json} />
        )}
      </CardContent>
    </Card>
  );
}

/* ── Playlist Player ── */

function PlaylistPlayer({ timeline }: { timeline: TimelineV1 }) {
  const clips = timeline.tracks?.[0]?.clips || [];
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const currentClip = clips[currentIdx];
  const progressPct = clips.length > 0
    ? ((currentClip?.startSec || 0) / Math.max(timeline.totalDurationSec, 0.001)) * 100
    : 0;

  const handleEnded = useCallback(() => {
    if (currentIdx < clips.length - 1) {
      setCurrentIdx(prev => prev + 1);
    } else {
      setIsPlaying(false);
    }
  }, [currentIdx, clips.length]);

  // Auto-play next clip
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !currentClip?.publicUrl) return;
    v.src = currentClip.publicUrl;
    v.load();
    if (isPlaying) {
      v.play().catch(() => {});
    }
  }, [currentIdx, currentClip?.publicUrl, isPlaying]);

  const jumpTo = (idx: number) => {
    setCurrentIdx(idx);
    setIsPlaying(true);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
    } else {
      v.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  if (clips.length === 0) {
    return <div className="text-xs text-muted-foreground py-2">No clips in timeline.</div>;
  }

  return (
    <div className="space-y-2">
      {/* Video */}
      <div className="rounded border border-border overflow-hidden bg-black">
        <video
          ref={videoRef}
          onEnded={handleEnded}
          controls={false}
          preload="metadata"
          className="w-full"
          style={{ maxHeight: "320px" }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={currentIdx === 0}
          onClick={() => jumpTo(Math.max(0, currentIdx - 1))}
        >
          <SkipBack className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={togglePlay}
        >
          {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={currentIdx >= clips.length - 1}
          onClick={() => jumpTo(Math.min(clips.length - 1, currentIdx + 1))}
        >
          <SkipForward className="h-3 w-3" />
        </Button>
        <div className="flex-1">
          <Progress value={progressPct} className="h-1.5" />
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {currentClip?.startSec.toFixed(1)}s / {timeline.totalDurationSec.toFixed(1)}s
        </span>
      </div>

      {/* Shot list */}
      <div className="space-y-0.5">
        <p className="text-[10px] font-medium text-muted-foreground">Shots ({clips.length})</p>
        <div className="max-h-[160px] overflow-y-auto space-y-0.5">
          {clips.map((clip, idx) => (
            <button
              key={clip.shotIndex}
              className={`w-full flex items-center gap-2 text-[10px] px-2 py-1 rounded transition-colors text-left ${
                idx === currentIdx
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted/50 text-foreground"
              }`}
              onClick={() => jumpTo(idx)}
            >
              <span className="font-mono w-5">#{clip.shotIndex}</span>
              <span className="font-mono text-muted-foreground">
                {clip.startSec.toFixed(1)}s–{clip.endSec.toFixed(1)}s
              </span>
              <span className="font-mono">{clip.durationSec.toFixed(1)}s</span>
              {idx === currentIdx && (
                <Badge className="text-[8px] px-1 py-0 ml-auto bg-primary/20 text-primary">
                  playing
                </Badge>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Export timeline */}
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => {
          const blob = new Blob([JSON.stringify(timeline, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `rough-cut-timeline-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        <Download className="h-3 w-3 mr-1" /> Export Timeline
      </Button>
    </div>
  );
}
