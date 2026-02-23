/**
 * Trailer Timeline Studio — Editorial control, rendering, and export
 */
import { useState, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Film, Play, Loader2, Check, Download, RefreshCw,
  ChevronUp, ChevronDown, Scissors, Type, AlertTriangle, Clapperboard,
  FileJson, FileText, Clock, GripVertical, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBlueprints } from '@/lib/trailerPipeline/useTrailerPipeline';
import { useTrailerCut, useTrailerCuts, useAssemblerMutations } from '@/lib/trailerPipeline/assemblerHooks';
import { useClipsList } from '@/lib/trailerPipeline/clipHooks';
import { renderTrailerCut } from '@/lib/trailerPipeline/renderTrailerCut';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import jsPDF from 'jspdf';

const ROLE_COLORS: Record<string, string> = {
  hook: 'bg-red-500/20 text-red-300',
  cold_open: 'bg-red-500/20 text-red-300',
  world_establish: 'bg-blue-500/20 text-blue-300',
  world: 'bg-blue-500/20 text-blue-300',
  protagonist_intro: 'bg-green-500/20 text-green-300',
  character_intro: 'bg-green-500/20 text-green-300',
  inciting_incident: 'bg-amber-500/20 text-amber-300',
  rising_action_1: 'bg-orange-500/20 text-orange-300',
  rising_action_2: 'bg-orange-500/20 text-orange-300',
  montage_peak: 'bg-purple-500/20 text-purple-300',
  emotional_beat: 'bg-pink-500/20 text-pink-300',
  climax_tease: 'bg-red-600/20 text-red-400',
  stinger: 'bg-yellow-500/20 text-yellow-300',
  title_card: 'bg-muted text-muted-foreground',
  atmosphere: 'bg-indigo-500/20 text-indigo-300',
  tension_build: 'bg-violet-500/20 text-violet-300',
  rupture: 'bg-rose-500/20 text-rose-300',
};

function formatTimecode(ms: number): string {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  const frac = Math.round((totalSec % 1) * 100);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(frac).padStart(2, '0')}`;
}

export default function TrailerTimelineStudio() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const blueprintId = searchParams.get('blueprintId') || undefined;
  const cutId = searchParams.get('cutId') || undefined;
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number } | null>(null);
  const [editingBeat, setEditingBeat] = useState<number | null>(null);

  // Queries
  const { data: bpListData } = useBlueprints(projectId);
  const { data: cutsData } = useTrailerCuts(projectId, blueprintId);
  const { data: cutData } = useTrailerCut(projectId, cutId);
  const { data: clipsData } = useClipsList(projectId, blueprintId);

  // Mutations
  const { createCut, updateBeat, reorderBeats, finalizeRun, setCutStatus, exportBeatlist } =
    useAssemblerMutations(projectId);

  const blueprints = (bpListData?.blueprints || []).filter((bp: any) => bp.status === 'complete');
  const cuts = cutsData?.cuts || [];
  const cut = cutData?.cut || null;
  const timeline: any[] = cut?.timeline || [];
  const clips = clipsData?.clips || [];
  const totalDurationMs = cut?.duration_ms || 0;

  // Clips for a given beat (for swap dropdown)
  const getClipsForBeat = useCallback((beatIndex: number) => {
    return clips.filter((c: any) => c.beat_index === beatIndex && (c.status === 'complete' || c.status === 'selected'));
  }, [clips]);

  // Total effective duration from timeline
  const effectiveDuration = useMemo(() =>
    timeline.reduce((s: number, t: any) => s + (t.effective_duration_ms || t.duration_ms || 0), 0),
    [timeline]
  );

  const handleCreateCut = () => {
    if (!blueprintId) return;
    createCut.mutate({ blueprintId }, {
      onSuccess: (data) => {
        setSearchParams({ blueprintId: blueprintId!, cutId: data.cutId });
      },
    });
  };

  const handleUpdateBeat = (beatIndex: number, updates: any) => {
    if (!cutId) return;
    updateBeat.mutate({ cutId, beatIndex, ...updates });
  };

  const handleMoveBeat = (fromIdx: number, direction: 'up' | 'down') => {
    if (!cutId) return;
    const toIdx = direction === 'up' ? fromIdx - 1 : fromIdx + 1;
    if (toIdx < 0 || toIdx >= timeline.length) return;
    const indices = timeline.map((_: any, i: number) => i);
    [indices[fromIdx], indices[toIdx]] = [indices[toIdx], indices[fromIdx]];
    reorderBeats.mutate({ cutId, orderedBeatIndices: indices });
  };

  const handleRender = async () => {
    if (!cutId || !projectId) return;
    setIsRendering(true);
    setRenderProgress({ done: 0, total: timeline.length });

    try {
      await setCutStatus.mutateAsync({ cutId, status: 'rendering' });

      // Build TimelineEntry[] from cut timeline for renderer
      const renderTimeline = timeline.map((t: any) => ({
        beat_index: t.beat_index,
        role: t.role,
        duration_ms: t.effective_duration_ms || t.duration_ms,
        clip_id: t.clip_id,
        clip_url: t.clip_url,
        media_type: t.media_type || 'video',
        text_overlay: t.is_text_card ? t.text_content : t.text_overlay,
        audio_cue: t.audio_cue,
      }));

      const blob = await renderTrailerCut(renderTimeline, {
        width: cut?.render_width || 1280,
        height: cut?.render_height || 720,
        fps: cut?.render_fps || 24,
        onProgress: (done, total) => setRenderProgress({ done, total }),
      });

      await setCutStatus.mutateAsync({ cutId, status: 'uploading' });

      const storagePath = `${projectId}/runs/${cutId}/final.webm`;
      const { error: uploadErr } = await supabase.storage.from('trailers').upload(storagePath, blob, {
        contentType: 'video/webm', upsert: true,
      });
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

      const { data: pubData } = supabase.storage.from('trailers').getPublicUrl(storagePath);
      const publicUrl = pubData?.publicUrl || '';

      await finalizeRun.mutateAsync({ cutId, outputPath: storagePath, publicUrl });
      toast.success('Trailer rendered and finalized!');
    } catch (err: any) {
      await setCutStatus.mutateAsync({ cutId, status: 'failed', error: err.message });
      toast.error(err.message);
    } finally {
      setIsRendering(false);
      setRenderProgress(null);
    }
  };

  // ─── Export functions ───

  const handleDownloadEDL = () => {
    if (!cut?.edl_export) return;
    const blob = new Blob([JSON.stringify(cut.edl_export, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trailer-edl-${(cutId || '').slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('EDL downloaded');
  };

  const handleDownloadBeatlist = async () => {
    if (!cutId) return;
    try {
      const result = await exportBeatlist.mutateAsync(cutId);
      const blob = new Blob([JSON.stringify(result.beatlist, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trailer-beatlist-${cutId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Beatlist downloaded');
    } catch {}
  };

  const handleExportMiniBoard = async () => {
    if (!cut || !timeline.length) return;
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();

      doc.setFontSize(16);
      doc.text('Trailer Board', 14, 15);
      doc.setFontSize(9);
      doc.text(`${cut.arc_type || 'main'} · ${formatTimecode(totalDurationMs)} · ${timeline.length} beats`, 14, 22);

      const cols = 4;
      const rows = 3;
      const beatsPerPage = cols * rows;
      const cardW = (pageW - 28) / cols;
      const cardH = (pageH - 40) / rows;
      const thumbH = cardH * 0.55;

      for (let i = 0; i < timeline.length; i++) {
        if (i > 0 && i % beatsPerPage === 0) {
          doc.addPage();
        }

        const pageIdx = i % beatsPerPage;
        const col = pageIdx % cols;
        const row = Math.floor(pageIdx / cols);
        const x = 14 + col * cardW;
        const y = 30 + row * cardH;

        const beat = timeline[i];

        // Card border
        doc.setDrawColor(100);
        doc.setLineWidth(0.3);
        doc.rect(x, y, cardW - 2, cardH - 2);

        // Thumbnail placeholder
        doc.setFillColor(30, 30, 46);
        doc.rect(x + 1, y + 1, cardW - 4, thumbH, 'F');

        if (beat.is_text_card) {
          doc.setFontSize(8);
          doc.setTextColor(255);
          doc.text(beat.text_content || 'TEXT', x + cardW / 2 - 1, y + thumbH / 2, { align: 'center' });
        } else {
          doc.setFontSize(7);
          doc.setTextColor(150);
          doc.text(beat.has_clip ? '▶ clip' : '⬜ no clip', x + cardW / 2 - 1, y + thumbH / 2, { align: 'center' });
        }

        // Beat info
        doc.setTextColor(40);
        doc.setFontSize(7);
        const infoY = y + thumbH + 4;
        doc.text(`#${i} ${beat.role}`, x + 2, infoY);
        doc.text(formatTimecode(beat.start_ms || 0), x + 2, infoY + 4);
        doc.text(`${beat.effective_duration_ms || beat.duration_ms}ms`, x + 2, infoY + 8);
        if (beat.provider) {
          doc.setFontSize(6);
          doc.text(beat.provider.toUpperCase(), x + cardW - 14, infoY);
        }
      }

      // Save locally
      doc.save(`trailer-board-${(cutId || '').slice(0, 8)}.pdf`);

      // Also upload to storage
      const pdfBlob = doc.output('blob');
      const storagePath = `${projectId}/runs/${cutId}/board.pdf`;
      await supabase.storage.from('trailers').upload(storagePath, pdfBlob, {
        contentType: 'application/pdf', upsert: true,
      });

      toast.success('Mini-board PDF exported');
    } catch (err: any) {
      toast.error(`PDF export failed: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={`/projects/${projectId}/trailer-clips${blueprintId ? `?blueprintId=${blueprintId}` : ''}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <Film className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Timeline Studio</h1>
          <Badge variant="outline" className="text-[10px]">v1</Badge>

          <div className="ml-auto flex items-center gap-2">
            {cut?.status === 'ready' && cut?.public_url && (
              <a href={cut.public_url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="text-xs">
                  <Play className="h-3 w-3 mr-1" /> Watch
                </Button>
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: Controls */}
        <div className="lg:col-span-3 space-y-4">
          {/* Blueprint Selector */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clapperboard className="h-4 w-4" />
                Blueprint
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select
                value={blueprintId || ''}
                onValueChange={(v) => setSearchParams({ blueprintId: v })}
              >
                <SelectTrigger className="text-xs"><SelectValue placeholder="Select blueprint" /></SelectTrigger>
                <SelectContent>
                  {blueprints.map((bp: any) => (
                    <SelectItem key={bp.id} value={bp.id}>
                      {bp.arc_type} · {(bp.edl || []).length} beats · {bp.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                size="sm" className="w-full"
                onClick={handleCreateCut}
                disabled={!blueprintId || createCut.isPending}
              >
                {createCut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                Create Trailer Cut
              </Button>
            </CardContent>
          </Card>

          {/* Cut List */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cuts</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[200px]">
                {cuts.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No cuts yet</p>
                ) : (
                  <div className="space-y-1">
                    {cuts.map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => setSearchParams({ blueprintId: blueprintId || c.blueprint_id, cutId: c.id })}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                          cutId === c.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted border border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono">{c.id.slice(0, 8)}</span>
                          <Badge variant={
                            c.status === 'ready' ? 'default' :
                            c.status === 'failed' ? 'destructive' :
                            c.status === 'rendering' ? 'secondary' : 'outline'
                          } className="text-[10px]">{c.status}</Badge>
                        </div>
                        <div className="text-muted-foreground">
                          {c.arc_type || 'cut'} · {formatTimecode(c.duration_ms || 0)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Render + Export */}
          {cutId && cut && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Film className="h-4 w-4" />
                  Render & Export
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  size="sm" className="w-full"
                  onClick={handleRender}
                  disabled={isRendering || cut.status === 'rendering'}
                >
                  {isRendering ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                  Render Trailer (WebM)
                </Button>

                {isRendering && renderProgress && (
                  <div className="space-y-1">
                    <Progress value={renderProgress.total > 0 ? (renderProgress.done / renderProgress.total) * 100 : 0} className="h-2" />
                    <p className="text-[10px] text-muted-foreground text-center">
                      {renderProgress.done}/{renderProgress.total} beats
                    </p>
                  </div>
                )}

                <Separator />

                <p className="text-[10px] text-muted-foreground font-medium">Export Package</p>
                <div className="grid grid-cols-1 gap-1">
                  <Button size="sm" variant="outline" className="text-xs justify-start" onClick={handleDownloadEDL}>
                    <FileJson className="h-3 w-3 mr-1.5" /> EDL JSON
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs justify-start" onClick={handleDownloadBeatlist}>
                    <FileText className="h-3 w-3 mr-1.5" /> Beatlist JSON
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs justify-start" onClick={handleExportMiniBoard}>
                    <Download className="h-3 w-3 mr-1.5" /> Mini-Board PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT: Timeline */}
        <div className="lg:col-span-9 space-y-4">
          {!cutId ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                <Clapperboard className="h-8 w-8 mx-auto mb-2 opacity-50" />
                Select a blueprint and create a cut to view the timeline
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Video Preview */}
              {cut?.status === 'ready' && cut?.public_url && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Preview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <video controls className="w-full rounded border border-border" src={cut.public_url} />
                  </CardContent>
                </Card>
              )}

              {/* Duration Bar */}
              <Card>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono text-base">{formatTimecode(effectiveDuration)}</span>
                      <span className="text-muted-foreground">· {timeline.length} beats</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{timeline.filter((t: any) => t.has_clip).length} clips</span>
                      <span>·</span>
                      <span>{timeline.filter((t: any) => !t.has_clip && !t.is_text_card).length} missing</span>
                    </div>
                  </div>

                  {/* Visual timeline bar */}
                  <div className="mt-2 flex rounded overflow-hidden h-6 bg-muted/30">
                    {timeline.map((t: any, idx: number) => {
                      const pct = effectiveDuration > 0
                        ? ((t.effective_duration_ms || t.duration_ms) / effectiveDuration) * 100
                        : 100 / timeline.length;
                      return (
                        <div
                          key={idx}
                          className={`h-full border-r border-background/50 transition-all cursor-pointer hover:opacity-80 ${
                            t.is_text_card ? 'bg-muted-foreground/30' :
                            t.has_clip ? 'bg-primary/60' : 'bg-destructive/30'
                          } ${editingBeat === idx ? 'ring-2 ring-primary' : ''}`}
                          style={{ width: `${Math.max(1, pct)}%` }}
                          title={`${t.role} — ${formatTimecode(t.start_ms || 0)}`}
                          onClick={() => setEditingBeat(editingBeat === idx ? null : idx)}
                        />
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Beat List */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>Beat Timeline</span>
                    <span className="font-mono text-muted-foreground text-xs">{timeline.length} beats</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-[calc(100vh-350px)]">
                    <div className="space-y-1">
                      {timeline.map((beat: any, idx: number) => {
                        const isEditing = editingBeat === idx;
                        const beatClips = getClipsForBeat(beat.beat_index);

                        return (
                          <div key={idx} className={`border rounded overflow-hidden transition-all ${
                            isEditing ? 'border-primary/50 bg-primary/5' : 'border-border'
                          }`}>
                            <div
                              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/20"
                              onClick={() => setEditingBeat(isEditing ? null : idx)}
                            >
                              <GripVertical className="h-3 w-3 text-muted-foreground/40" />

                              <span className="text-[10px] font-mono text-muted-foreground w-12">
                                {formatTimecode(beat.start_ms || 0)}
                              </span>

                              <Badge className={`text-[10px] ${ROLE_COLORS[beat.role] || 'bg-muted text-muted-foreground'}`}>
                                {beat.role}
                              </Badge>

                              <span className="text-xs font-mono">
                                {beat.effective_duration_ms || beat.duration_ms}ms
                              </span>

                              {beat.is_text_card && (
                                <Badge variant="outline" className="text-[9px]">
                                  <Type className="h-2.5 w-2.5 mr-0.5" /> TEXT
                                </Badge>
                              )}

                              {beat.trim_in_ms > 0 || beat.trim_out_ms > 0 ? (
                                <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400">
                                  <Scissors className="h-2.5 w-2.5 mr-0.5" /> trimmed
                                </Badge>
                              ) : null}

                              {beat.provider && (
                                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${
                                  beat.provider === 'runway' ? 'border-rose-500/50 text-rose-400' :
                                  beat.provider === 'veo' ? 'border-sky-500/50 text-sky-400' :
                                  'border-muted-foreground/50 text-muted-foreground'
                                }`}>
                                  {beat.provider.toUpperCase()}
                                </Badge>
                              )}

                              {!beat.has_clip && !beat.is_text_card && (
                                <AlertTriangle className="h-3 w-3 text-amber-400 ml-auto" />
                              )}

                              {beat.has_clip && <Check className="h-3 w-3 text-green-400 ml-auto" />}

                              {/* Reorder buttons */}
                              <div className="flex gap-0.5 ml-1">
                                <Button
                                  size="sm" variant="ghost" className="h-5 w-5 p-0"
                                  disabled={idx === 0 || reorderBeats.isPending}
                                  onClick={(e) => { e.stopPropagation(); handleMoveBeat(idx, 'up'); }}
                                >
                                  <ChevronUp className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm" variant="ghost" className="h-5 w-5 p-0"
                                  disabled={idx === timeline.length - 1 || reorderBeats.isPending}
                                  onClick={(e) => { e.stopPropagation(); handleMoveBeat(idx, 'down'); }}
                                >
                                  <ChevronDown className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>

                            {/* Editing panel */}
                            {isEditing && (
                              <div className="px-3 pb-3 pt-1 border-t border-border bg-muted/10 space-y-3">
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <Label className="text-[10px]">Duration (ms)</Label>
                                    <Input
                                      type="number"
                                      className="h-7 text-xs"
                                      defaultValue={beat.duration_ms}
                                      onBlur={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val) && val !== beat.duration_ms) {
                                          handleUpdateBeat(idx, { duration_ms: val });
                                        }
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-[10px]">Trim In (ms)</Label>
                                    <Input
                                      type="number"
                                      className="h-7 text-xs"
                                      defaultValue={beat.trim_in_ms || 0}
                                      onBlur={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val) && val !== (beat.trim_in_ms || 0)) {
                                          handleUpdateBeat(idx, { trim_in_ms: val });
                                        }
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-[10px]">Trim Out (ms)</Label>
                                    <Input
                                      type="number"
                                      className="h-7 text-xs"
                                      defaultValue={beat.trim_out_ms || 0}
                                      onBlur={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val) && val !== (beat.trim_out_ms || 0)) {
                                          handleUpdateBeat(idx, { trim_out_ms: val });
                                        }
                                      }}
                                    />
                                  </div>
                                </div>

                                {/* Clip swap */}
                                {!beat.is_text_card && beatClips.length > 0 && (
                                  <div>
                                    <Label className="text-[10px]">Clip</Label>
                                    <Select
                                      value={beat.clip_id || ''}
                                      onValueChange={(v) => handleUpdateBeat(idx, { clip_id: v || null })}
                                    >
                                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="No clip" /></SelectTrigger>
                                      <SelectContent>
                                        {beatClips.map((c: any) => (
                                          <SelectItem key={c.id} value={c.id}>
                                            {c.provider} #{c.candidate_index || 1} — {c.id.slice(0, 8)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                )}

                                {/* Clip preview */}
                                {beat.clip_url && (
                                  <div>
                                    {beat.media_type === 'video' ? (
                                      <video controls className="w-full max-w-sm rounded aspect-video" src={beat.clip_url} preload="metadata" />
                                    ) : (
                                      <img src={beat.clip_url} alt="" className="w-full max-w-sm rounded aspect-video object-cover" />
                                    )}
                                  </div>
                                )}

                                {beat.is_text_card && beat.text_content && (
                                  <div className="bg-muted/30 rounded p-3 text-center">
                                    <p className="text-sm font-semibold">{beat.text_content}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
