
-- Fix security definer view by making it security invoker
DROP VIEW IF EXISTS public.project_script_scene_state;
CREATE VIEW public.project_script_scene_state WITH (security_invoker = true) AS
SELECT
  p.id AS project_id,
  EXISTS (SELECT 1 FROM public.scene_graph_scenes ss WHERE ss.project_id = p.id) AS has_scenes,
  COALESCE((SELECT count(*)::int FROM public.scene_graph_order so WHERE so.project_id = p.id AND so.is_active = true), 0) AS active_scene_count,
  (SELECT sn.id FROM public.scene_graph_snapshots sn WHERE sn.project_id = p.id ORDER BY sn.created_at DESC LIMIT 1) AS latest_snapshot_id,
  (SELECT sn.status FROM public.scene_graph_snapshots sn WHERE sn.project_id = p.id ORDER BY sn.created_at DESC LIMIT 1) AS latest_snapshot_status
FROM public.projects p;
