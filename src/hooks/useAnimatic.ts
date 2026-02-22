/**
 * useAnimatic — Hook for animatic CRUD, auto-build from storyboards, sync, markers, and export.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { StoryboardBoard } from '@/hooks/useStoryboards';

export interface Animatic {
  id: string;
  project_id: string;
  shot_list_id: string;
  episode_number: number | null;
  scope: { mode: 'scene' | 'episode' | 'custom'; scene_numbers?: string[] };
  fps: number;
  aspect_ratio: string;
  status: string;
  render_asset_path: string | null;
  timing_asset_path: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface AnimaticPanel {
  id: string;
  animatic_id: string;
  storyboard_board_id: string;
  scene_number: string;
  shot_number: number;
  order_index: number;
  duration_seconds: number;
  transition: string;
  locked: boolean;
  created_at: string;
  updated_at: string;
  // Joined from storyboard_boards
  board?: StoryboardBoard;
}

export interface AnimaticMarker {
  id: string;
  animatic_id: string;
  time_seconds: number;
  marker_type: 'vo' | 'sfx' | 'music' | 'note';
  text: string;
  created_at: string;
  created_by: string;
}

export function useAnimatic(projectId: string | undefined, shotListId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Fetch animatic for this shot list
  const { data: animatic, isLoading: animaticLoading } = useQuery({
    queryKey: ['animatic', shotListId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('animatics')
        .select('*')
        .eq('shot_list_id', shotListId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Animatic | null;
    },
    enabled: !!shotListId,
  });

  // Fetch panels for animatic
  const { data: panels = [], isLoading: panelsLoading } = useQuery({
    queryKey: ['animatic-panels', animatic?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('animatic_panels')
        .select('*')
        .eq('animatic_id', animatic!.id)
        .order('order_index', { ascending: true });
      if (error) throw error;
      return (data || []) as AnimaticPanel[];
    },
    enabled: !!animatic?.id,
  });

  // Fetch markers
  const { data: markers = [], isLoading: markersLoading } = useQuery({
    queryKey: ['animatic-markers', animatic?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('animatic_markers')
        .select('*')
        .eq('animatic_id', animatic!.id)
        .order('time_seconds', { ascending: true });
      if (error) throw error;
      return (data || []) as AnimaticMarker[];
    },
    enabled: !!animatic?.id,
  });

  // Create animatic from storyboard boards
  const createAnimatic = useMutation({
    mutationFn: async ({ boards, isVertical }: { boards: StoryboardBoard[]; isVertical: boolean }) => {
      if (!projectId || !shotListId || !user) throw new Error('Missing context');

      const aspectRatio = isVertical ? '9:16' : '16:9';
      const defaultDuration = isVertical ? 1.0 : 2.0;

      // Create animatic record
      const { data: anim, error: animErr } = await (supabase as any)
        .from('animatics')
        .insert({
          project_id: projectId,
          shot_list_id: shotListId,
          aspect_ratio: aspectRatio,
          created_by: user.id,
          status: 'draft',
        })
        .select('id')
        .single();
      if (animErr) throw animErr;

      // Create panels from boards
      const sorted = [...boards].sort((a, b) => {
        const sa = parseInt(a.scene_number), sb = parseInt(b.scene_number);
        if (sa !== sb) return (isNaN(sa) ? 0 : sa) - (isNaN(sb) ? 0 : sb);
        return a.shot_number - b.shot_number;
      });

      const rows = sorted.map((board, i) => ({
        animatic_id: anim.id,
        storyboard_board_id: board.id,
        scene_number: board.scene_number,
        shot_number: board.shot_number,
        order_index: i,
        duration_seconds: defaultDuration,
        transition: 'cut',
      }));

      const { error: panelErr } = await (supabase as any)
        .from('animatic_panels')
        .insert(rows);
      if (panelErr) throw panelErr;

      return anim.id;
    },
    onSuccess: () => {
      toast.success('Animatic created from storyboard panels');
      qc.invalidateQueries({ queryKey: ['animatic', shotListId] });
    },
    onError: (err: any) => toast.error('Create failed: ' + err.message),
  });

  // Update panel
  const updatePanel = useMutation({
    mutationFn: async ({ panelId, updates }: { panelId: string; updates: Partial<AnimaticPanel> }) => {
      const { error } = await (supabase as any)
        .from('animatic_panels')
        .update(updates)
        .eq('id', panelId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['animatic-panels', animatic?.id] }),
  });

  // Reorder panels
  const reorderPanels = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const updates = orderedIds.map((id, i) => (supabase as any)
        .from('animatic_panels')
        .update({ order_index: i })
        .eq('id', id)
      );
      await Promise.all(updates);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['animatic-panels', animatic?.id] }),
  });

  // Add marker
  const addMarker = useMutation({
    mutationFn: async (marker: { time_seconds: number; marker_type: string; text: string }) => {
      if (!animatic?.id || !user) throw new Error('Missing context');
      const { error } = await (supabase as any)
        .from('animatic_markers')
        .insert({
          animatic_id: animatic.id,
          ...marker,
          created_by: user.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['animatic-markers', animatic?.id] });
      toast.success('Marker added');
    },
    onError: (err: any) => toast.error('Marker failed: ' + err.message),
  });

  // Delete marker
  const deleteMarker = useMutation({
    mutationFn: async (markerId: string) => {
      const { error } = await (supabase as any)
        .from('animatic_markers')
        .delete()
        .eq('id', markerId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['animatic-markers', animatic?.id] }),
  });

  // Sync from latest boards (add new, keep locked)
  const syncFromBoards = useMutation({
    mutationFn: async (boards: StoryboardBoard[]) => {
      if (!animatic?.id) throw new Error('No animatic');

      const existingBoardIds = new Set(panels.map(p => p.storyboard_board_id));
      const newBoards = boards.filter(b => !existingBoardIds.has(b.id));

      if (newBoards.length === 0) {
        toast.info('Animatic is already in sync');
        return;
      }

      const maxOrder = panels.length > 0 ? Math.max(...panels.map(p => p.order_index)) + 1 : 0;
      const defaultDuration = animatic.aspect_ratio === '9:16' ? 1.0 : 2.0;

      const rows = newBoards.map((board, i) => ({
        animatic_id: animatic.id,
        storyboard_board_id: board.id,
        scene_number: board.scene_number,
        shot_number: board.shot_number,
        order_index: maxOrder + i,
        duration_seconds: defaultDuration,
        transition: 'cut',
      }));

      const { error } = await (supabase as any)
        .from('animatic_panels')
        .insert(rows);
      if (error) throw error;

      // Reset status to draft
      await (supabase as any)
        .from('animatics')
        .update({ status: 'draft' })
        .eq('id', animatic.id);

      return newBoards.length;
    },
    onSuccess: (count) => {
      if (count && count > 0) toast.success(`Synced ${count} new panels`);
      qc.invalidateQueries({ queryKey: ['animatic', shotListId] });
      qc.invalidateQueries({ queryKey: ['animatic-panels', animatic?.id] });
    },
    onError: (err: any) => toast.error('Sync failed: ' + err.message),
  });

  // Generate timing list (client-side)
  const generateTimingList = () => {
    if (panels.length === 0) return null;
    let currentTime = 0;
    const entries = panels.map(p => {
      const start = currentTime;
      const end = start + Number(p.duration_seconds);
      currentTime = end;
      return {
        order: p.order_index,
        scene_number: p.scene_number,
        shot_number: p.shot_number,
        storyboard_board_id: p.storyboard_board_id,
        start_time: Math.round(start * 1000) / 1000,
        end_time: Math.round(end * 1000) / 1000,
        duration: Number(p.duration_seconds),
        transition: p.transition,
        locked: p.locked,
      };
    });

    const markerEntries = markers.map(m => ({
      time_seconds: Number(m.time_seconds),
      type: m.marker_type,
      text: m.text,
    }));

    return { panels: entries, markers: markerEntries, total_duration: currentTime };
  };

  const exportTimingCSV = () => {
    const timing = generateTimingList();
    if (!timing) return;

    const header = 'Order,Scene,Shot,Start,End,Duration,Transition,Locked,Board ID';
    const rows = timing.panels.map(p =>
      `${p.order},${p.scene_number},${p.shot_number},${p.start_time},${p.end_time},${p.duration},${p.transition},${p.locked},${p.storyboard_board_id}`
    );
    const markerHeader = '\n\nMarkers\nTime,Type,Text';
    const markerRows = timing.markers.map(m => `${m.time_seconds},${m.type},\"${m.text}\"`);

    const csv = [header, ...rows, markerHeader, ...markerRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'animatic-timing.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Timing CSV downloaded');
  };

  const exportTimingJSON = () => {
    const timing = generateTimingList();
    if (!timing) return;

    const blob = new Blob([JSON.stringify(timing, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'animatic-timing.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Timing JSON downloaded');
  };

  // Render MP4 via edge function
  const renderAnimatic = useMutation({
    mutationFn: async () => {
      if (!animatic?.id) throw new Error('No animatic');
      
      await (supabase as any)
        .from('animatics')
        .update({ status: 'rendering' })
        .eq('id', animatic.id);

      const { data, error } = await supabase.functions.invoke('render-animatic', {
        body: { animaticId: animatic.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(data?.mp4_url ? 'MP4 rendered successfully' : 'Timing package exported (MP4 coming soon)');
      qc.invalidateQueries({ queryKey: ['animatic', shotListId] });
    },
    onError: (err: any) => {
      toast.error('Render failed: ' + err.message);
      if (animatic?.id) {
        (supabase as any).from('animatics').update({ status: 'failed' }).eq('id', animatic.id);
        qc.invalidateQueries({ queryKey: ['animatic', shotListId] });
      }
    },
  });

  // Check if animatic is out of date (boards have changed)
  const isOutOfDate = (boards: StoryboardBoard[]) => {
    if (!animatic || panels.length === 0) return false;
    const panelBoardIds = new Set(panels.map(p => p.storyboard_board_id));
    const currentBoardIds = new Set(boards.map(b => b.id));
    // New boards not in animatic
    for (const id of currentBoardIds) {
      if (!panelBoardIds.has(id)) return true;
    }
    return false;
  };

  const totalDuration = panels.reduce((sum, p) => sum + Number(p.duration_seconds), 0);

  return {
    animatic,
    panels,
    markers,
    totalDuration,
    isLoading: animaticLoading || panelsLoading || markersLoading,
    createAnimatic,
    updatePanel,
    reorderPanels,
    addMarker,
    deleteMarker,
    syncFromBoards,
    renderAnimatic,
    isOutOfDate,
    exportTimingCSV,
    exportTimingJSON,
  };
}
