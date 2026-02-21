/**
 * ShotListPage — Full shot list module with scene sidebar, table, filters, inline edit, lock, exports.
 */
import { useState, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Lock, Unlock, Download, FileText, RefreshCw, Loader2,
  ChevronDown, ChevronRight, Filter, Camera, AlertTriangle,
  ArrowLeft, Trash2,
} from 'lucide-react';
import { useShotList, type ShotListItem } from '@/hooks/useShotList';
import { toast } from 'sonner';
import jsPDF from 'jspdf';

const SHOT_TYPE_OPTIONS = ['WS', 'MS', 'CU', 'ECU', 'OTS', 'POV', 'INSERT', '2SHOT', 'AERIAL', 'TRACKING'];

export default function ShotListPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const shotListIdParam = searchParams.get('list');

  const { data: project } = useQuery({
    queryKey: ['shot-list-project', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('title, format').eq('id', projectId!).single();
      return data;
    },
    enabled: !!projectId,
  });

  const { shotLists, items, listsLoading, itemsLoading, regenerate, toggleLock, updateItem, deleteShotList } = useShotList(projectId, shotListIdParam || undefined);

  const activeShotList = shotLists.find(sl => sl.id === shotListIdParam) || shotLists[0];
  const activeItems = shotListIdParam ? items : [];

  // Filters
  const [filterScene, setFilterScene] = useState<string | null>(null);
  const [filterShotType, setFilterShotType] = useState<string | null>(null);
  const [filterCharacter, setFilterCharacter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Scenes list
  const scenes = useMemo(() => {
    const map = new Map<string, { heading: string; count: number; locked: number }>();
    for (const item of activeItems) {
      const existing = map.get(item.scene_number) || { heading: item.scene_heading, count: 0, locked: 0 };
      existing.count++;
      if (item.locked) existing.locked++;
      map.set(item.scene_number, existing);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const na = parseInt(a[0]), nb = parseInt(b[0]);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a[0].localeCompare(b[0]);
    });
  }, [activeItems]);

  // Filtered items
  const filteredItems = useMemo(() => {
    let result = activeItems;
    if (filterScene) result = result.filter(i => i.scene_number === filterScene);
    if (filterShotType) result = result.filter(i => i.shot_type === filterShotType);
    if (filterCharacter) {
      const lc = filterCharacter.toLowerCase();
      result = result.filter(i =>
        (i.characters_present || []).some((c: string) => c.toLowerCase().includes(lc))
      );
    }
    return result;
  }, [activeItems, filterScene, filterShotType, filterCharacter]);

  // Group by scene
  const groupedByScene = useMemo(() => {
    const groups = new Map<string, ShotListItem[]>();
    for (const item of filteredItems) {
      const arr = groups.get(item.scene_number) || [];
      arr.push(item);
      groups.set(item.scene_number, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      const na = parseInt(a[0]), nb = parseInt(b[0]);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredItems]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map(i => i.id)));
    }
  };

  const handleBulkLock = (locked: boolean) => {
    if (selectedIds.size === 0) return;
    toggleLock.mutate({ itemIds: Array.from(selectedIds), locked });
    setSelectedIds(new Set());
  };

  const handleRegenScene = (sceneNumber: string) => {
    if (!activeShotList) return;
    const isVD = project?.format?.toLowerCase().includes('vertical');
    regenerate.mutate({
      shotListId: activeShotList.id,
      scope: { scene_numbers: [sceneNumber] },
      isVerticalDrama: isVD,
    });
  };

  const handleRegenAll = () => {
    if (!activeShotList) return;
    const isVD = project?.format?.toLowerCase().includes('vertical');
    regenerate.mutate({
      shotListId: activeShotList.id,
      isVerticalDrama: isVD,
    });
  };

  // Export CSV
  const exportCSV = useCallback(() => {
    if (activeItems.length === 0) return;
    const headers = ['Scene', 'Heading', 'Shot#', 'Type', 'Framing', 'Action', 'Camera', 'Duration(s)', 'Location', 'ToD', 'Characters', 'Props/Set', 'Audio', 'Locked'];
    const rows = activeItems.map(i => [
      i.scene_number, i.scene_heading, i.shot_number, i.shot_type,
      i.framing, i.action, i.camera_movement, i.duration_est_seconds || '',
      i.location || '', i.time_of_day || '',
      (i.characters_present || []).join('; '),
      i.props_or_set_notes || '', i.audio_notes || '', i.locked ? 'YES' : '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${project?.title || 'Project'} - Shot List - ${date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast.success('CSV exported');
  }, [activeItems, project]);

  // Export PDF
  const exportPDF = useCallback(() => {
    if (activeItems.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape' });
    const date = new Date().toISOString().slice(0, 10);
    doc.setFontSize(16);
    doc.text(`${project?.title || 'Project'} — Shot List`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${date} · ${activeItems.length} shots · ${scenes.length} scenes`, 14, 28);

    let y = 38;
    for (const [sceneNum, sceneItems] of groupedByScene) {
      if (y > 180) { doc.addPage(); y = 20; }
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`Scene ${sceneNum}: ${sceneItems[0]?.scene_heading || ''}`, 14, y);
      y += 6;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');

      for (const item of sceneItems) {
        if (y > 190) { doc.addPage(); y = 20; }
        const lock = item.locked ? ' 🔒' : '';
        doc.text(
          `  ${item.shot_number}. [${item.shot_type}] ${item.framing} — ${item.action.slice(0, 80)} (${item.camera_movement})${lock}`,
          14, y
        );
        y += 4.5;
      }
      y += 3;
    }

    doc.save(`${project?.title || 'Project'} - Shot List - ${date}.pdf`);
    toast.success('PDF exported');
  }, [activeItems, scenes, groupedByScene, project]);

  const isOutOfDate = activeShotList?.status === 'out_of_date';

  return (
    <PageTransition>
      <Header />
      <div className="min-h-screen bg-background pt-16">
        <div className="max-w-[1600px] mx-auto px-4 py-6">
          {/* Top bar */}
          <div className="flex items-center gap-3 mb-6">
            <Link to={`/projects/${projectId}/development`}>
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                <ArrowLeft className="h-3 w-3" />
                Back
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-lg font-bold flex items-center gap-2">
                <Camera className="h-5 w-5 text-primary" />
                Shot List
                {activeShotList && (
                  <span className="text-muted-foreground font-normal text-sm">— {activeShotList.name}</span>
                )}
              </h1>
              {project?.title && (
                <p className="text-xs text-muted-foreground">{project.title}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isOutOfDate && (
                <Badge variant="outline" className="text-[10px] border-[hsl(var(--chart-4)/0.4)] text-[hsl(var(--chart-4))] gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Out of date
                </Badge>
              )}
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={handleRegenAll} disabled={regenerate.isPending}>
                {regenerate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Regen Unlocked
              </Button>
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={exportCSV}>
                <Download className="h-3 w-3" />CSV
              </Button>
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={exportPDF}>
                <FileText className="h-3 w-3" />PDF
              </Button>
            </div>
          </div>

          {/* No shot list yet */}
          {!listsLoading && shotLists.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <Camera className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No shot lists yet. Generate one from a script document in the Development Engine.</p>
              </CardContent>
            </Card>
          )}

          {activeShotList && (
            <div className="flex gap-4">
              {/* Scene Sidebar */}
              <div className="w-56 shrink-0">
                <Card>
                  <CardHeader className="py-3 px-3">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Scenes</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="max-h-[70vh]">
                      <button
                        onClick={() => setFilterScene(null)}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors ${!filterScene ? 'bg-primary/10 text-primary font-medium' : 'text-foreground'}`}
                      >
                        All Scenes ({activeItems.length})
                      </button>
                      {scenes.map(([num, info]) => (
                        <button
                          key={num}
                          onClick={() => setFilterScene(num)}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors border-t border-border/30 ${filterScene === num ? 'bg-primary/10 text-primary font-medium' : 'text-foreground'}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="truncate">SC {num}</span>
                            <div className="flex items-center gap-1">
                              {info.locked > 0 && <Lock className="h-2.5 w-2.5 text-[hsl(var(--chart-4))]" />}
                              <Badge variant="outline" className="text-[8px] px-1">{info.count}</Badge>
                            </div>
                          </div>
                          <p className="text-[9px] text-muted-foreground truncate mt-0.5">{info.heading}</p>
                        </button>
                      ))}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>

              {/* Main Table */}
              <div className="flex-1 min-w-0">
                {/* Filters + Bulk */}
                <div className="flex items-center gap-2 mb-3">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={filterShotType || 'all'} onValueChange={v => setFilterShotType(v === 'all' ? null : v)}>
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue placeholder="Shot type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All types</SelectItem>
                      {SHOT_TYPE_OPTIONS.map(t => (
                        <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Filter character…"
                    value={filterCharacter}
                    onChange={e => setFilterCharacter(e.target.value)}
                    className="h-7 w-36 text-xs"
                  />
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1" onClick={selectAll}>
                      <Checkbox checked={selectedIds.size === filteredItems.length && filteredItems.length > 0} />
                      {selectedIds.size > 0 ? `${selectedIds.size} sel.` : 'Select all'}
                    </Button>
                    {selectedIds.size > 0 && (
                      <>
                        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => handleBulkLock(true)}>
                          <Lock className="h-2.5 w-2.5" />Lock
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => handleBulkLock(false)}>
                          <Unlock className="h-2.5 w-2.5" />Unlock
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Stats bar */}
                <div className="flex items-center gap-3 mb-3 text-[10px] text-muted-foreground">
                  <span>{filteredItems.length} shots</span>
                  <span>{scenes.length} scenes</span>
                  <span>{filteredItems.filter(i => i.locked).length} locked</span>
                  {activeShotList.episode_number && <span>EP {activeShotList.episode_number}</span>}
                </div>

                {/* Grouped items */}
                {itemsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groupedByScene.map(([sceneNum, sceneItems]) => (
                      <SceneGroup
                        key={sceneNum}
                        sceneNumber={sceneNum}
                        heading={sceneItems[0]?.scene_heading || ''}
                        items={sceneItems}
                        selectedIds={selectedIds}
                        onToggleSelect={toggleSelect}
                        onToggleLock={(id, locked) => toggleLock.mutate({ itemIds: [id], locked })}
                        onUpdateItem={(id, updates) => updateItem.mutate({ itemId: id, updates })}
                        onRegenScene={() => handleRegenScene(sceneNum)}
                        regenPending={regenerate.isPending}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Shot list selector if multiple */}
          {shotLists.length > 1 && (
            <div className="mt-6">
              <p className="text-xs text-muted-foreground mb-2">Other shot lists:</p>
              <div className="flex flex-wrap gap-2">
                {shotLists.filter(sl => sl.id !== activeShotList?.id).map(sl => (
                  <Link key={sl.id} to={`/projects/${projectId}/shot-list?list=${sl.id}`}>
                    <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted/50">
                      {sl.name} · {sl.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}

// ── Scene Group (Collapsible) ──
function SceneGroup({
  sceneNumber, heading, items, selectedIds, onToggleSelect,
  onToggleLock, onUpdateItem, onRegenScene, regenPending,
}: {
  sceneNumber: string;
  heading: string;
  items: ShotListItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleLock: (id: string, locked: boolean) => void;
  onUpdateItem: (id: string, updates: Partial<ShotListItem>) => void;
  onRegenScene: () => void;
  regenPending: boolean;
}) {
  const [open, setOpen] = useState(true);
  const lockedCount = items.filter(i => i.locked).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border bg-card">
        <CollapsibleTrigger className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
          {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <span className="text-xs font-medium">SC {sceneNumber}</span>
          <span className="text-[10px] text-muted-foreground truncate flex-1 text-left">{heading}</span>
          <div className="flex items-center gap-1.5">
            {lockedCount > 0 && (
              <Badge variant="outline" className="text-[8px] gap-0.5">
                <Lock className="h-2 w-2" />{lockedCount}
              </Badge>
            )}
            <Badge variant="outline" className="text-[8px]">{items.length} shots</Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[9px] gap-0.5 px-1.5"
              onClick={e => { e.stopPropagation(); onRegenScene(); }}
              disabled={regenPending}
            >
              <RefreshCw className="h-2.5 w-2.5" />Regen
            </Button>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border">
            {/* Header row */}
            <div className="grid grid-cols-[32px_40px_60px_100px_1fr_90px_70px_32px] gap-1 px-3 py-1.5 text-[9px] text-muted-foreground font-medium uppercase tracking-wider bg-muted/20">
              <span></span>
              <span>#</span>
              <span>Type</span>
              <span>Framing</span>
              <span>Action</span>
              <span>Camera</span>
              <span>Dur</span>
              <span></span>
            </div>
            {items.map(item => (
              <ShotRow
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                onToggleSelect={() => onToggleSelect(item.id)}
                onToggleLock={() => onToggleLock(item.id, !item.locked)}
                onUpdate={(updates) => onUpdateItem(item.id, updates)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Shot Row (Inline Editable) ──
function ShotRow({
  item, selected, onToggleSelect, onToggleLock, onUpdate,
}: {
  item: ShotListItem;
  selected: boolean;
  onToggleSelect: () => void;
  onToggleLock: () => void;
  onUpdate: (updates: Partial<ShotListItem>) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  const handleBlur = (field: string, value: string) => {
    setEditing(null);
    if ((item as any)[field] !== value) {
      onUpdate({ [field]: value });
    }
  };

  return (
    <div className={`grid grid-cols-[32px_40px_60px_100px_1fr_90px_70px_32px] gap-1 px-3 py-1.5 text-xs border-t border-border/30 hover:bg-muted/20 transition-colors items-center ${item.locked ? 'bg-[hsl(var(--chart-4)/0.03)]' : ''}`}>
      <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
      <span className="text-muted-foreground">{item.shot_number}</span>

      {/* Shot Type */}
      <Select value={item.shot_type} onValueChange={v => onUpdate({ shot_type: v })}>
        <SelectTrigger className="h-6 text-[10px] px-1 border-0 bg-transparent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SHOT_TYPE_OPTIONS.map(t => (
            <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Framing */}
      {editing === 'framing' ? (
        <Input
          autoFocus
          defaultValue={item.framing}
          className="h-6 text-[10px] px-1"
          onBlur={e => handleBlur('framing', e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <span
          className="truncate cursor-text text-[10px] text-foreground"
          onClick={() => setEditing('framing')}
        >
          {item.framing || '—'}
        </span>
      )}

      {/* Action */}
      {editing === 'action' ? (
        <Input
          autoFocus
          defaultValue={item.action}
          className="h-6 text-[10px] px-1"
          onBlur={e => handleBlur('action', e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <span
          className="truncate cursor-text text-[10px] text-foreground"
          onClick={() => setEditing('action')}
        >
          {item.action || '—'}
        </span>
      )}

      {/* Camera Movement */}
      {editing === 'camera_movement' ? (
        <Input
          autoFocus
          defaultValue={item.camera_movement}
          className="h-6 text-[10px] px-1"
          onBlur={e => handleBlur('camera_movement', e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <span
          className="truncate cursor-text text-[10px] text-muted-foreground"
          onClick={() => setEditing('camera_movement')}
        >
          {item.camera_movement || '—'}
        </span>
      )}

      {/* Duration */}
      <span className="text-[10px] text-muted-foreground">
        {item.duration_est_seconds ? `${item.duration_est_seconds}s` : '—'}
      </span>

      {/* Lock */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={onToggleLock} className="text-muted-foreground hover:text-foreground transition-colors">
              {item.locked ? <Lock className="h-3 w-3 text-[hsl(var(--chart-4))]" /> : <Unlock className="h-3 w-3" />}
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">{item.locked ? 'Unlock shot' : 'Lock shot'}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
