
ALTER TABLE public.project_activity_log
  DROP CONSTRAINT project_activity_log_project_id_fkey,
  ADD CONSTRAINT project_activity_log_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
