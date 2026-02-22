/**
 * AnimaticEditor — Timeline editor for animatic panels with duration, markers, and export.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Lock, Unlock, Download, Loader2, Play, Clock, Plus, Trash2,
  AlertTriangle, RefreshCw, GripVertical, Film, FileJson, FileText,
  Mic, Music, Volume2, StickyNote,
} from 'lucide-react';
import { useAnimatic, type AnimaticPanel, type AnimaticMarker } from '@/hooks/useAnimatic';
import type { StoryboardBoard } from '@/hooks/useStoryboards';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AnimaticEditorProps {
  projectId: string;
  shotListId: string;
  boards: StoryboardBoard[];
  isVertical: boolean;
  getImageUrl: (path: string) => Promise<string | null>;
}

export default function AnimaticEditor({ projectId, shotListId, boards, isVertical, getImageUrl }: AnimaticEditorProps) {
  const {
    animatic, panels, markers, totalDuration, isLoading,
    createAnimatic, updatePanel, addMarker, deleteMarker,
    syncFromBoards, renderAnimatic, isOutOfDate,
    exportTimingCSV, exportTimingJSON,
  } = useAnimatic(projectId, shotListId);

  const [newMarkerType, setNewMarkerType] = useState<string>('note');
  const [newMarkerText, setNewMarkerText] = useState('');
  const [newMarkerTime, setNewMarkerTime] = useState('0');

  const outOfDate = animatic ? isOutOfDate(boards) : false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!animatic) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Film className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            No animatic yet. Create one from your {boards.length} storyboard panels.
          </p>
          <Button
            onClick={() => createAnimatic.mutate({ boards, isVertical })}
            disabled={createAnimatic.isPending || boards.length === 0}
            className="gap-2"
          >
            {createAnimatic.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Create Animatic
          </Button>
        </CardContent>
      </Card>
    );
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`;
  };

  const handleAddMarker = () => {
    if (!newMarkerText.trim()) return;
    addMarker.mutate({
      time_seconds: parseFloat(newMarkerTime) || 0,
      marker_type: newMarkerType,
      text: newMarkerText.trim(),
    });
    setNewMarkerText('');
  };

  const markerIcon = (type: string) => {
    switch (type) {
      case 'vo': return <Mic className="h-3 w-3" />;
      case 'sfx': return <Volume2 className="h-3 w-3" />;
      case 'music': return <Music className="h-3 w-3" />;
      default: return <StickyNote className="h-3 w-3" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Film className="h-4 w-4 text-primary" />
            Animatic
          </h3>
          <Badge variant="outline" className="text-[9px]">
            {panels.length} panels · {formatTime(totalDuration)}
          </Badge>
          <Badge
            variant={animatic.status === 'ready' ? 'default' : 'outline'}
            className={`text-[9px] ${animatic.status === 'rendering' ? 'animate-pulse' : ''}`}
          >
            {animatic.status}
          </Badge>
          {outOfDate && (
            <Badge variant="destructive" className="text-[9px] gap-1">
              <AlertTriangle className="h-2.5 w-2.5" />
              Out of date
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {outOfDate && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1"
              onClick={() => syncFromBoards.mutate(boards)}
              disabled={syncFromBoards.isPending}
            >
              {syncFromBoards.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Sync
            </Button>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={exportTimingCSV}>
                  <FileText className="h-3 w-3" />CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs">Download timing CSV</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={exportTimingJSON}>
                  <FileJson className="h-3 w-3" />JSON
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs">Download timing JSON</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            size="sm"
            className="text-xs gap-1"
            onClick={() => renderAnimatic.mutate()}
            disabled={renderAnimatic.isPending || animatic.status === 'rendering'}
          >
            {renderAnimatic.isPending || animatic.status === 'rendering'
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Download className="h-3 w-3" />
            }
            Render MP4
          </Button>
        </div>
      </div>

      {/* Render download */}
      {animatic.status === 'ready' && animatic.render_asset_path && (
        <RenderDownload path={animatic.render_asset_path} />
      )}

      {/* Timeline panels */}
      <Card>
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Timeline — {panels.length} panels
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[50vh]">
            <div className="divide-y divide-border/30">
              {panels.map((panel, idx) => (
                <AnimaticPanelRow
                  key={panel.id}
                  panel={panel}
                  index={idx}
                  cumulativeTime={panels.slice(0, idx).reduce((s, p) => s + Number(p.duration_seconds), 0)}
                  board={boards.find(b => b.id === panel.storyboard_board_id)}
                  getImageUrl={getImageUrl}
                  onUpdateDuration={(d) => updatePanel.mutate({ panelId: panel.id, updates: { duration_seconds: d } })}
                  onToggleLock={() => updatePanel.mutate({ panelId: panel.id, updates: { locked: !panel.locked } })}
                  onUpdateTransition={(t) => updatePanel.mutate({ panelId: panel.id, updates: { transition: t } })}
                />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Markers */}
      <Card>
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Markers ({markers.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          {markers.map(m => (
            <div key={m.id} className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="text-[8px] gap-1 shrink-0">
                {markerIcon(m.marker_type)}
                {formatTime(Number(m.time_seconds))}
              </Badge>
              <span className="flex-1 text-muted-foreground truncate">{m.text}</span>
              <button
                onClick={() => deleteMarker.mutate(m.id)}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}

          {/* Add marker form */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/30">
            <Select value={newMarkerType} onValueChange={setNewMarkerType}>
              <SelectTrigger className="h-7 w-20 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vo" className="text-xs">VO</SelectItem>
                <SelectItem value="sfx" className="text-xs">SFX</SelectItem>
                <SelectItem value="music" className="text-xs">Music</SelectItem>
                <SelectItem value="note" className="text-xs">Note</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={newMarkerTime}
              onChange={e => setNewMarkerTime(e.target.value)}
              placeholder="Time (s)"
              className="h-7 w-16 text-[10px]"
              type="number"
              step="0.1"
            />
            <Input
              value={newMarkerText}
              onChange={e => setNewMarkerText(e.target.value)}
              placeholder="Marker text…"
              className="h-7 flex-1 text-[10px]"
              onKeyDown={e => e.key === 'Enter' && handleAddMarker()}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] gap-1"
              onClick={handleAddMarker}
              disabled={!newMarkerText.trim() || addMarker.isPending}
            >
              <Plus className="h-3 w-3" />Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Panel Row ──
function AnimaticPanelRow({
  panel, index, cumulativeTime, board, getImageUrl, onUpdateDuration, onToggleLock, onUpdateTransition,
}: {
  panel: AnimaticPanel;
  index: number;
  cumulativeTime: number;
  board?: StoryboardBoard;
  getImageUrl: (path: string) => Promise<string | null>;
  onUpdateDuration: (d: number) => void;
  onToggleLock: () => void;
  onUpdateTransition: (t: string) => void;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [durationInput, setDurationInput] = useState(String(panel.duration_seconds));

  useEffect(() => {
    if (board?.image_asset_path) {
      getImageUrl(board.image_asset_path).then(setImgUrl);
    }
  }, [board?.image_asset_path]);

  useEffect(() => {
    setDurationInput(String(panel.duration_seconds));
  }, [panel.duration_seconds]);

  const commitDuration = () => {
    const val = parseFloat(durationInput);
    if (!isNaN(val) && val > 0 && val !== panel.duration_seconds) {
      onUpdateDuration(val);
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`;
  };

  return (
    <div className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors ${panel.locked ? 'bg-[hsl(var(--chart-4)/0.05)]' : ''}`}>
      {/* Grip */}
      <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0 cursor-grab" />

      {/* Thumbnail */}
      <div className="w-12 h-8 rounded bg-muted/50 overflow-hidden shrink-0 flex items-center justify-center">
        {imgUrl ? (
          <img src={imgUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Film className="h-3 w-3 text-muted-foreground/40" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium">SC {panel.scene_number} / Shot {panel.shot_number}</span>
          <span className="text-[9px] text-muted-foreground">#{index + 1}</span>
        </div>
        {board?.panel_text && (
          <p className="text-[9px] text-muted-foreground truncate">{board.panel_text}</p>
        )}
      </div>

      {/* Timecode */}
      <Badge variant="outline" className="text-[8px] shrink-0 gap-1">
        <Clock className="h-2 w-2" />
        {formatTime(cumulativeTime)}
      </Badge>

      {/* Duration */}
      <Input
        value={durationInput}
        onChange={e => setDurationInput(e.target.value)}
        onBlur={commitDuration}
        onKeyDown={e => e.key === 'Enter' && commitDuration()}
        className="h-6 w-14 text-[10px] text-center"
        type="number"
        step="0.1"
        min="0.1"
        disabled={panel.locked}
      />
      <span className="text-[9px] text-muted-foreground">s</span>

      {/* Transition */}
      <Select value={panel.transition || 'cut'} onValueChange={onUpdateTransition} disabled={panel.locked}>
        <SelectTrigger className="h-6 w-16 text-[10px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="cut" className="text-xs">Cut</SelectItem>
          <SelectItem value="fade" className="text-xs">Fade</SelectItem>
        </SelectContent>
      </Select>

      {/* Lock */}
      <button onClick={onToggleLock} className="text-muted-foreground hover:text-foreground transition-colors">
        {panel.locked ? <Lock className="h-3 w-3 text-[hsl(var(--chart-4))]" /> : <Unlock className="h-3 w-3" />}
      </button>
    </div>
  );
}

// ── Render Download ──
function RenderDownload({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    supabase.storage.from('exports').createSignedUrl(path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl || null));
  }, [path]);

  if (!url) return null;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="py-3 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Animatic ready</span>
        </div>
        <a href={url} download className="inline-flex">
          <Button size="sm" className="text-xs gap-1">
            <Download className="h-3 w-3" />
            Download MP4
          </Button>
        </a>
      </CardContent>
    </Card>
  );
}
