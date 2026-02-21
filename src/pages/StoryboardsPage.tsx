/**
 * StoryboardsPage — Scene strip / grid view of storyboard panels for a shot list.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Lock, Unlock, Download, Loader2, ImagePlus, Upload,
  ArrowLeft, LayoutGrid, List, Film, Sparkles, Camera,
} from 'lucide-react';
import { useShotList } from '@/hooks/useShotList';
import { useStoryboards, type StoryboardBoard } from '@/hooks/useStoryboards';
import { toast } from 'sonner';
import jsPDF from 'jspdf';

export default function StoryboardsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const shotListId = searchParams.get('list') || undefined;

  const { data: project } = useQuery({
    queryKey: ['storyboard-project', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('title, format').eq('id', projectId!).single();
      return data;
    },
    enabled: !!projectId,
  });

  const { items: shotItems, itemsLoading } = useShotList(projectId, shotListId);
  const { boards, isLoading, autoCreate, updateBoard, uploadImage, toggleLock, getImageUrl } = useStoryboards(projectId, shotListId);

  // Auto-create boards when shot items arrive
  const didAutoCreate = useRef(false);
  useEffect(() => {
    if (shotItems.length > 0 && !didAutoCreate.current && !isLoading) {
      didAutoCreate.current = true;
      autoCreate.mutate(shotItems);
    }
  }, [shotItems, isLoading]);

  const [viewMode, setViewMode] = useState<'strip' | 'grid'>('strip');
  const [activeScene, setActiveScene] = useState<string | null>(null);

  // Scenes
  const scenes = useMemo(() => {
    const map = new Map<string, { count: number; locked: number }>();
    for (const b of boards) {
      const e = map.get(b.scene_number) || { count: 0, locked: 0 };
      e.count++;
      if (b.locked) e.locked++;
      map.set(b.scene_number, e);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const na = parseInt(a[0]), nb = parseInt(b[0]);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a[0].localeCompare(b[0]);
    });
  }, [boards]);

  const visibleBoards = useMemo(() => {
    if (!activeScene) return boards;
    return boards.filter(b => b.scene_number === activeScene);
  }, [boards, activeScene]);

  // Board Book PDF export
  const exportBoardBook = useCallback(async () => {
    if (boards.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape' });
    const date = new Date().toISOString().slice(0, 10);

    // Cover page
    doc.setFontSize(24);
    doc.text(project?.title || 'Project', 148, 80, { align: 'center' });
    doc.setFontSize(14);
    doc.text('Storyboard Board Book', 148, 95, { align: 'center' });
    doc.setFontSize(10);
    doc.text(date, 148, 108, { align: 'center' });
    doc.text(`${boards.length} panels · ${scenes.length} scenes`, 148, 116, { align: 'center' });

    // Group by scene
    const grouped = new Map<string, StoryboardBoard[]>();
    for (const b of boards) {
      const arr = grouped.get(b.scene_number) || [];
      arr.push(b);
      grouped.set(b.scene_number, arr);
    }

    for (const [sceneNum, scenePanels] of grouped) {
      doc.addPage();
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(`Scene ${sceneNum}`, 14, 20);
      doc.setFont('helvetica', 'normal');

      let y = 30;
      let col = 0;
      const panelW = 130;
      const panelH = 45;

      for (const panel of scenePanels) {
        const x = 14 + col * (panelW + 10);

        // Panel box
        doc.setDrawColor(180);
        doc.rect(x, y, panelW, panelH);

        // Image placeholder area
        const imgW = 50;
        doc.setFillColor(240, 240, 240);
        doc.rect(x + 1, y + 1, imgW, panelH - 2, 'F');

        if (panel.image_asset_path) {
          doc.setFontSize(7);
          doc.text('[Image]', x + imgW / 2, y + panelH / 2, { align: 'center' });
        } else {
          doc.setFontSize(7);
          doc.setTextColor(160);
          doc.text('No image', x + imgW / 2, y + panelH / 2, { align: 'center' });
          doc.setTextColor(0);
        }

        // Text area
        const textX = x + imgW + 4;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text(`Shot ${panel.shot_number}`, textX, y + 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);

        const lines = doc.splitTextToSize(panel.panel_text || '', panelW - imgW - 8);
        doc.text(lines.slice(0, 5), textX, y + 12);

        if (panel.camera_notes) {
          doc.setTextColor(100);
          doc.text(`Cam: ${panel.camera_notes}`.slice(0, 60), textX, y + panelH - 6);
          doc.setTextColor(0);
        }

        col++;
        if (col >= 2) {
          col = 0;
          y += panelH + 8;
          if (y > 165) {
            doc.addPage();
            doc.setFontSize(10);
            doc.text(`Scene ${sceneNum} (cont.)`, 14, 15);
            y = 25;
          }
        }
      }
    }

    doc.save(`${project?.title || 'Project'} - Storyboards - Board Book - ${date}.pdf`);
    toast.success('Board Book PDF exported');
  }, [boards, scenes, project]);

  const loading = isLoading || itemsLoading;

  return (
    <PageTransition>
      <Header />
      <div className="min-h-screen bg-background pt-16">
        <div className="max-w-[1600px] mx-auto px-4 py-6">
          {/* Top bar */}
          <div className="flex items-center gap-3 mb-6">
            <Link to={`/projects/${projectId}/shot-list${shotListId ? `?list=${shotListId}` : ''}`}>
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                <ArrowLeft className="h-3 w-3" />
                Shot List
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-lg font-bold flex items-center gap-2">
                <Film className="h-5 w-5 text-primary" />
                Storyboards
              </h1>
              {project?.title && (
                <p className="text-xs text-muted-foreground">{project.title} · {boards.length} panels</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Tabs value={viewMode} onValueChange={v => setViewMode(v as any)}>
                <TabsList className="h-7">
                  <TabsTrigger value="strip" className="text-xs h-6 px-2 gap-1">
                    <List className="h-3 w-3" />Strip
                  </TabsTrigger>
                  <TabsTrigger value="grid" className="text-xs h-6 px-2 gap-1">
                    <LayoutGrid className="h-3 w-3" />Grid
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={exportBoardBook}>
                <Download className="h-3 w-3" />Board Book
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : boards.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Film className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No storyboard panels yet. They'll be created automatically from the shot list.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex gap-4">
              {/* Scene sidebar (strip view) */}
              {viewMode === 'strip' && (
                <div className="w-48 shrink-0">
                  <Card>
                    <CardHeader className="py-3 px-3">
                      <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Scenes</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="max-h-[70vh]">
                        <button
                          onClick={() => setActiveScene(null)}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors ${!activeScene ? 'bg-primary/10 text-primary font-medium' : 'text-foreground'}`}
                        >
                          All ({boards.length})
                        </button>
                        {scenes.map(([num, info]) => (
                          <button
                            key={num}
                            onClick={() => setActiveScene(num)}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors border-t border-border/30 ${activeScene === num ? 'bg-primary/10 text-primary font-medium' : 'text-foreground'}`}
                          >
                            <div className="flex items-center justify-between">
                              <span>SC {num}</span>
                              <div className="flex items-center gap-1">
                                {info.locked > 0 && <Lock className="h-2.5 w-2.5 text-[hsl(var(--chart-4))]" />}
                                <Badge variant="outline" className="text-[8px] px-1">{info.count}</Badge>
                              </div>
                            </div>
                          </button>
                        ))}
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Panels */}
              <div className="flex-1 min-w-0">
                {viewMode === 'strip' ? (
                  <div className="space-y-3">
                    {visibleBoards.map(board => (
                      <StoryboardPanel
                        key={board.id}
                        board={board}
                        onUpdate={(updates) => updateBoard.mutate({ boardId: board.id, updates })}
                        onUpload={(file) => uploadImage.mutate({ boardId: board.id, file })}
                        onToggleLock={() => toggleLock.mutate({ boardIds: [board.id], locked: !board.locked })}
                        getImageUrl={getImageUrl}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {visibleBoards.map(board => (
                      <StoryboardGridCard
                        key={board.id}
                        board={board}
                        onUpload={(file) => uploadImage.mutate({ boardId: board.id, file })}
                        onToggleLock={() => toggleLock.mutate({ boardIds: [board.id], locked: !board.locked })}
                        getImageUrl={getImageUrl}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}

// ── Strip Panel ──
function StoryboardPanel({
  board, onUpdate, onUpload, onToggleLock, getImageUrl,
}: {
  board: StoryboardBoard;
  onUpdate: (updates: Partial<StoryboardBoard>) => void;
  onUpload: (file: File) => void;
  onToggleLock: () => void;
  getImageUrl: (path: string) => Promise<string | null>;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (board.image_asset_path) {
      getImageUrl(board.image_asset_path).then(setImgUrl);
    }
  }, [board.image_asset_path]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onUpload(f);
    e.target.value = '';
  };

  const isVertical = board.aspect_ratio === '9:16';

  return (
    <Card className={`${board.locked ? 'border-[hsl(var(--chart-4)/0.3)]' : ''}`}>
      <CardContent className="p-4">
        <div className="flex gap-4">
          {/* Image area */}
          <div
            className={`shrink-0 rounded-md border border-border bg-muted/30 flex items-center justify-center overflow-hidden ${
              isVertical ? 'w-24 h-[170px]' : 'w-40 h-[90px]'
            }`}
          >
            {imgUrl ? (
              <img src={imgUrl} alt={`Shot ${board.shot_number}`} className="w-full h-full object-cover" />
            ) : (
              <div className="text-center">
                <ImagePlus className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
                <p className="text-[9px] text-muted-foreground">No image</p>
              </div>
            )}
          </div>

          {/* Text fields */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px]">SC {board.scene_number} / Shot {board.shot_number}</Badge>
                <Badge variant="outline" className="text-[9px] text-muted-foreground">{board.aspect_ratio}</Badge>
                {board.locked && (
                  <Badge variant="outline" className="text-[8px] gap-0.5 border-[hsl(var(--chart-4)/0.3)] text-[hsl(var(--chart-4))]">
                    <Lock className="h-2 w-2" />Locked
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => fileRef.current?.click()}>
                        <Upload className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">Upload image</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-40 cursor-not-allowed">
                        <Sparkles className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">AI generation coming soon</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onToggleLock}>
                        {board.locked ? <Lock className="h-3 w-3 text-[hsl(var(--chart-4))]" /> : <Unlock className="h-3 w-3" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">{board.locked ? 'Unlock' : 'Lock'}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <Textarea
              value={board.panel_text}
              onChange={e => onUpdate({ panel_text: e.target.value })}
              className="text-xs min-h-[60px] resize-none"
              placeholder="Panel description…"
            />

            <div className="grid grid-cols-3 gap-2">
              <Input
                value={board.framing_notes || ''}
                onChange={e => onUpdate({ framing_notes: e.target.value })}
                placeholder="Framing…"
                className="h-6 text-[10px]"
              />
              <Input
                value={board.camera_notes || ''}
                onChange={e => onUpdate({ camera_notes: e.target.value })}
                placeholder="Camera…"
                className="h-6 text-[10px]"
              />
              <Input
                value={board.composition_notes || ''}
                onChange={e => onUpdate({ composition_notes: e.target.value })}
                placeholder="Composition…"
                className="h-6 text-[10px]"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Grid Card ──
function StoryboardGridCard({
  board, onUpload, onToggleLock, getImageUrl,
}: {
  board: StoryboardBoard;
  onUpload: (file: File) => void;
  onToggleLock: () => void;
  getImageUrl: (path: string) => Promise<string | null>;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (board.image_asset_path) {
      getImageUrl(board.image_asset_path).then(setImgUrl);
    }
  }, [board.image_asset_path]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onUpload(f);
    e.target.value = '';
  };

  const isVertical = board.aspect_ratio === '9:16';

  return (
    <Card className={`overflow-hidden ${board.locked ? 'border-[hsl(var(--chart-4)/0.3)]' : ''}`}>
      <div
        className={`w-full bg-muted/30 flex items-center justify-center overflow-hidden ${
          isVertical ? 'aspect-[9/16] max-h-48' : 'aspect-video'
        }`}
        onClick={() => fileRef.current?.click()}
      >
        {imgUrl ? (
          <img src={imgUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="text-center cursor-pointer">
            <ImagePlus className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
            <p className="text-[9px] text-muted-foreground">Click to upload</p>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
      <CardContent className="p-2">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-[8px]">SC {board.scene_number} / {board.shot_number}</Badge>
          <button onClick={onToggleLock} className="text-muted-foreground hover:text-foreground">
            {board.locked ? <Lock className="h-2.5 w-2.5 text-[hsl(var(--chart-4))]" /> : <Unlock className="h-2.5 w-2.5" />}
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground mt-1 line-clamp-2">{board.panel_text}</p>
      </CardContent>
    </Card>
  );
}
