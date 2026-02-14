import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarDays, MapPin, Clock, Users, Loader2, Plus, Trash2, X, Check,
  Sun, Moon, Sunrise, Sunset, RefreshCw, FileDown, ChevronDown, ChevronRight,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  useProjectScenes,
  useShootDays,
  useSceneSchedule,
  type ProjectScene,
  type ShootDay,
} from '@/hooks/useProductionSchedule';

const TIME_ICONS: Record<string, React.ElementType> = {
  DAY: Sun,
  NIGHT: Moon,
  DAWN: Sunrise,
  DUSK: Sunset,
};

// ---- Scene List Panel ----
function SceneListPanel({ scenes, isLoading, onExtract, extracting }: {
  scenes: ProjectScene[];
  isLoading: boolean;
  onExtract: () => void;
  extracting: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const stats = useMemo(() => {
    const locations = new Set(scenes.map(s => s.location).filter(Boolean));
    const totalPages = scenes.reduce((sum, s) => sum + (s.page_count || 0), 0);
    const castSet = new Set(scenes.flatMap(s => s.cast_members));
    return { sceneCount: scenes.length, locationCount: locations.size, totalPages: Math.round(totalPages * 10) / 10, castCount: castSet.size };
  }, [scenes]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Scenes</h4>
        <Button
          variant="outline"
          size="sm"
          onClick={onExtract}
          disabled={extracting}
          className="text-xs"
        >
          {extracting ? (
            <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Extracting…</>
          ) : scenes.length > 0 ? (
            <><RefreshCw className="h-3 w-3 mr-1.5" /> Re-extract</>
          ) : (
            <><RefreshCw className="h-3 w-3 mr-1.5" /> Extract from Script</>
          )}
        </Button>
      </div>

      {scenes.length > 0 && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Scenes', value: stats.sceneCount },
            { label: 'Locations', value: stats.locationCount },
            { label: 'Pages', value: stats.totalPages },
            { label: 'Cast', value: stats.castCount },
          ].map(s => (
            <div key={s.label} className="bg-muted/30 rounded-lg px-2 py-1.5">
              <p className="text-lg font-bold text-foreground">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading scenes…
        </div>
      ) : scenes.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          No scenes extracted yet. Click "Extract from Script" to scan your screenplay.
        </p>
      ) : (
        <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
          {scenes.map(scene => {
            const TimeIcon = TIME_ICONS[scene.time_of_day?.toUpperCase()] || Clock;
            const isExpanded = expanded === scene.id;
            return (
              <div key={scene.id} className="bg-muted/20 rounded-lg">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-left"
                  onClick={() => setExpanded(isExpanded ? null : scene.id)}
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <span className="text-xs font-mono text-primary shrink-0 w-8">{scene.scene_number}</span>
                  <span className="text-xs text-foreground truncate flex-1">{scene.heading}</span>
                  <TimeIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                  {scene.page_count > 0 && (
                    <span className="text-[10px] text-muted-foreground shrink-0">{scene.page_count}pg</span>
                  )}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-2 space-y-1.5">
                    {scene.description && (
                      <p className="text-xs text-muted-foreground">{scene.description}</p>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[10px] text-foreground">{scene.location || 'Unknown'}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">{scene.int_ext}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">{scene.time_of_day}</span>
                    </div>
                    {scene.cast_members.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                        {scene.cast_members.map(c => (
                          <Badge key={c} variant="secondary" className="text-[10px] px-1.5 py-0">{c}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Shoot Day Scheduler ----
function ShootDayScheduler({ projectId, scenes, format, genres, budgetRange }: { projectId: string; scenes: ProjectScene[]; format?: string; genres?: string[]; budgetRange?: string }) {
  const { shootDays, addShootDay, deleteShootDay } = useShootDays(projectId);
  const { schedule, assignScene, unassignScene } = useSceneSchedule(projectId);
  const [addingDay, setAddingDay] = useState(false);
  const [dayForm, setDayForm] = useState({ shoot_date: '', unit: 'Main Unit' });
  const [assigningFor, setAssigningFor] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState('');
  const [autoScheduling, setAutoScheduling] = useState(false);
  const [autoProgress, setAutoProgress] = useState(0);
  const [autoLabel, setAutoLabel] = useState('');

  const scheduledSceneIds = new Set(schedule.map(s => s.scene_id));
  const unscheduledScenes = scenes.filter(s => !scheduledSceneIds.has(s.id));

  const handleAddDay = () => {
    if (!dayForm.shoot_date) return;
    addShootDay.mutate({
      shoot_date: dayForm.shoot_date,
      day_number: shootDays.length + 1,
      unit: dayForm.unit,
    });
    setDayForm({ shoot_date: '', unit: 'Main Unit' });
    setAddingDay(false);
  };

  const handleAssign = (shootDayId: string) => {
    if (!selectedScene) return;
    const existing = schedule.filter(s => s.shoot_day_id === shootDayId);
    assignScene.mutate({
      scene_id: selectedScene,
      shoot_day_id: shootDayId,
      sort_order: existing.length,
    });
    setSelectedScene('');
    setAssigningFor(null);
  };

  const handleAutoSchedule = async () => {
    if (scenes.length === 0) {
      toast.error('Extract scenes from script first');
      return;
    }
    setAutoScheduling(true);
    setAutoProgress(0);
    setAutoLabel('Analysing scenes…');

    const progressInterval = setInterval(() => {
      setAutoProgress(prev => {
        const next = prev + Math.random() * 4 + 1;
        if (next > 95) return 95;
        if (next > 70) setAutoLabel('Assigning scenes to days…');
        else if (next > 40) setAutoLabel('Optimising location groups…');
        else if (next > 15) setAutoLabel('Building shoot day structure…');
        return next;
      });
    }, 500);

    try {
      const { data, error } = await supabase.functions.invoke('auto-schedule', {
        body: { projectId, format, genres, budgetRange },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setAutoProgress(100);
      setAutoLabel('Done!');
      toast.success(`Created ${data.total_days} shoot days with ${data.total_scheduled} scene assignments`);
      if (data.warnings?.length) {
        data.warnings.forEach((w: string) => toast.warning(w, { duration: 6000 }));
      }
      // Reload to refresh all queries
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      toast.error(err.message || 'Auto-scheduling failed');
    } finally {
      clearInterval(progressInterval);
      setTimeout(() => {
        setAutoScheduling(false);
        setAutoProgress(0);
        setAutoLabel('');
      }, 1200);
    }
  };

  const getScenesForDay = (dayId: string) => {
    const entries = schedule.filter(s => s.shoot_day_id === dayId).sort((a, b) => a.sort_order - b.sort_order);
    return entries.map(entry => ({
      ...entry,
      scene: scenes.find(s => s.id === entry.scene_id),
    }));
  };

  const getDayStats = (dayId: string) => {
    const dayScenes = getScenesForDay(dayId);
    const totalPages = dayScenes.reduce((sum, ds) => sum + (ds.scene?.page_count || 0), 0);
    const castSet = new Set(dayScenes.flatMap(ds => ds.scene?.cast_members || []));
    const locations = new Set(dayScenes.map(ds => ds.scene?.location).filter(Boolean));
    return { sceneCount: dayScenes.length, totalPages: Math.round(totalPages * 10) / 10, castCount: castSet.size, locationCount: locations.size };
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Shoot Days</h4>
        <div className="flex items-center gap-2">
          {unscheduledScenes.length > 0 && (
            <span className="text-[10px] text-amber-400">{unscheduledScenes.length} unscheduled</span>
          )}
          {scenes.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAutoSchedule}
              disabled={autoScheduling}
              className="text-xs gap-1.5"
            >
              {autoScheduling ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Scheduling…</>
              ) : (
                <><Wand2 className="h-3 w-3" /> Auto-Schedule</>
              )}
            </Button>
          )}
        </div>
      </div>

      {autoScheduling && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1.5">
          <Progress value={autoProgress} className="h-2" />
          <p className="text-[11px] text-muted-foreground text-center">{autoLabel}</p>
        </motion.div>
      )}

      {shootDays.length === 0 && !addingDay && !autoScheduling && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Add shoot days manually or use Auto-Schedule to generate from your scenes.
        </p>
      )}

      <div className="space-y-3">
        {shootDays.map(day => {
          const dayScenes = getScenesForDay(day.id);
          const stats = getDayStats(day.id);
          return (
            <div key={day.id} className="bg-muted/20 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Day {day.day_number}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(day.shoot_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{day.unit}</Badge>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => deleteShootDay.mutate(day.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              {stats.sceneCount > 0 && (
                <div className="flex gap-3 text-[10px] text-muted-foreground">
                  <span>{stats.sceneCount} scenes</span>
                  <span>{stats.totalPages} pages</span>
                  <span>{stats.castCount} cast</span>
                  <span>{stats.locationCount} locations</span>
                </div>
              )}

              {dayScenes.map(ds => {
                if (!ds.scene) return null;
                const TimeIcon = TIME_ICONS[ds.scene.time_of_day?.toUpperCase()] || Clock;
                return (
                  <div key={ds.id} className="flex items-center gap-2 bg-background/50 rounded px-2 py-1.5">
                    <span className="text-[10px] font-mono text-primary w-6">{ds.scene.scene_number}</span>
                    <TimeIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs text-foreground truncate flex-1">{ds.scene.heading}</span>
                    {ds.call_time && <span className="text-[10px] text-muted-foreground">{ds.call_time}</span>}
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                      {ds.scene.page_count}pg
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => unassignScene.mutate(ds.id)}>
                      <X className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                );
              })}

              {assigningFor === day.id ? (
                <div className="flex items-center gap-2">
                  <Select value={selectedScene} onValueChange={setSelectedScene}>
                    <SelectTrigger className="flex-1 h-7 text-xs">
                      <SelectValue placeholder="Select scene…" />
                    </SelectTrigger>
                    <SelectContent>
                      {unscheduledScenes.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="font-mono mr-1">{s.scene_number}</span> {s.heading}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="icon" className="h-7 w-7" onClick={() => handleAssign(day.id)} disabled={!selectedScene}>
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAssigningFor(null)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground w-full"
                  onClick={() => { setAssigningFor(day.id); setSelectedScene(''); }}
                  disabled={unscheduledScenes.length === 0}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Scene
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {addingDay ? (
        <div className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
          <Input type="date" value={dayForm.shoot_date} onChange={e => setDayForm(f => ({ ...f, shoot_date: e.target.value }))} className="h-8 text-sm flex-1" />
          <Input placeholder="Unit" value={dayForm.unit} onChange={e => setDayForm(f => ({ ...f, unit: e.target.value }))} className="h-8 text-sm w-28" />
          <Button size="icon" className="h-7 w-7" onClick={handleAddDay} disabled={!dayForm.shoot_date}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAddingDay(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAddingDay(true)} className="w-full">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Shoot Day
        </Button>
      )}
    </div>
  );
}

// ---- Call Sheet Generator ----
function CallSheetView({ projectId, scenes }: { projectId: string; scenes: ProjectScene[] }) {
  const { shootDays } = useShootDays(projectId);
  const { schedule } = useSceneSchedule(projectId);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const dayData = useMemo(() => {
    if (!selectedDay) return null;
    const day = shootDays.find(d => d.id === selectedDay);
    if (!day) return null;

    const entries = schedule
      .filter(s => s.shoot_day_id === selectedDay)
      .sort((a, b) => a.sort_order - b.sort_order);

    const dayScenes = entries.map(entry => ({
      ...entry,
      scene: scenes.find(s => s.id === entry.scene_id),
    })).filter(ds => ds.scene);

    const allCast = new Set(dayScenes.flatMap(ds => ds.scene?.cast_members || []));
    const allLocations = new Set(dayScenes.map(ds => ds.scene?.location).filter(Boolean));
    const totalPages = dayScenes.reduce((sum, ds) => sum + (ds.scene?.page_count || 0), 0);

    return { day, scenes: dayScenes, cast: Array.from(allCast).sort(), locations: Array.from(allLocations), totalPages: Math.round(totalPages * 10) / 10 };
  }, [selectedDay, shootDays, schedule, scenes]);

  if (shootDays.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">Add shoot days first to generate call sheets.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Call Sheets</h4>
      </div>

      <Select value={selectedDay || undefined} onValueChange={setSelectedDay}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select a shoot day…" />
        </SelectTrigger>
        <SelectContent>
          {shootDays.map(d => (
            <SelectItem key={d.id} value={d.id}>
              Day {d.day_number} — {new Date(d.shoot_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {dayData && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3 bg-muted/10 rounded-lg p-3 border border-border"
        >
          <div className="text-center border-b border-border pb-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Call Sheet</p>
            <p className="text-sm font-bold text-foreground">
              Day {dayData.day.day_number} — {new Date(dayData.day.shoot_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <p className="text-xs text-muted-foreground">{dayData.day.unit}</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div><span className="text-muted-foreground">Scenes:</span> <span className="font-medium text-foreground">{dayData.scenes.length}</span></div>
            <div><span className="text-muted-foreground">Pages:</span> <span className="font-medium text-foreground">{dayData.totalPages}</span></div>
            <div><span className="text-muted-foreground">Locations:</span> <span className="font-medium text-foreground">{dayData.locations.length}</span></div>
          </div>

          {/* Scene Order */}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Scene Order</p>
            <div className="space-y-1">
              {dayData.scenes.map((ds, i) => {
                const TimeIcon = TIME_ICONS[ds.scene?.time_of_day?.toUpperCase() || ''] || Clock;
                return (
                  <div key={ds.id} className="flex items-center gap-2 bg-background/50 rounded px-2 py-1">
                    <span className="text-[10px] text-muted-foreground w-4">{i + 1}.</span>
                    <span className="text-[10px] font-mono text-primary w-6">{ds.scene?.scene_number}</span>
                    <TimeIcon className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-foreground truncate flex-1">{ds.scene?.heading}</span>
                    <span className="text-[10px] text-muted-foreground">{ds.scene?.page_count}pg</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cast Call */}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Cast Required</p>
            <div className="flex flex-wrap gap-1">
              {dayData.cast.map(c => (
                <Badge key={c} variant="secondary" className="text-[10px] px-1.5 py-0">{c}</Badge>
              ))}
            </div>
          </div>

          {/* Locations */}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Locations</p>
            <div className="flex flex-wrap gap-1">
              {dayData.locations.map(l => (
                <div key={l} className="flex items-center gap-1 text-xs text-foreground">
                  <MapPin className="h-3 w-3 text-muted-foreground" /> {l}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ---- Main Schedule Tab ----
interface Props {
  projectId: string;
  format?: string;
  genres?: string[];
  budgetRange?: string;
}

export function ScheduleTab({ projectId, format, genres, budgetRange }: Props) {
  const { scenes, isLoading, extractScenes } = useProjectScenes(projectId);
  const [view, setView] = useState<'scenes' | 'schedule' | 'callsheet'>('scenes');

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
        {[
          { key: 'scenes' as const, label: 'Scenes' },
          { key: 'schedule' as const, label: 'Schedule' },
          { key: 'callsheet' as const, label: 'Call Sheets' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              view === tab.key
                ? 'bg-background text-foreground font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {view === 'scenes' && (
        <SceneListPanel
          scenes={scenes}
          isLoading={isLoading}
          onExtract={() => extractScenes.mutate()}
          extracting={extractScenes.isPending}
        />
      )}
      {view === 'schedule' && <ShootDayScheduler projectId={projectId} scenes={scenes} format={format} genres={genres} budgetRange={budgetRange} />}
      {view === 'callsheet' && <CallSheetView projectId={projectId} scenes={scenes} />}
    </div>
  );
}
