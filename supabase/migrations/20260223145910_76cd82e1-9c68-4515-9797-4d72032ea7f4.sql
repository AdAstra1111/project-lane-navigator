
-- Durable "Generate Full Shot Plan" jobs

create table if not exists public.shot_plan_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid null,
  status text not null default 'running',
  total_scenes int not null default 0,
  completed_scenes int not null default 0,
  inserted_shots int not null default 0,
  last_scene_id uuid null,
  last_message text null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null
);

create index if not exists shot_plan_jobs_project_id_idx
  on public.shot_plan_jobs(project_id);

-- One row per scene per job; used for resume + audit
create table if not exists public.shot_plan_job_scenes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.shot_plan_jobs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_id uuid not null,
  status text not null default 'pending',
  inserted_shots int not null default 0,
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique(job_id, scene_id)
);

create index if not exists shot_plan_job_scenes_job_id_idx
  on public.shot_plan_job_scenes(job_id);

create index if not exists shot_plan_job_scenes_project_id_idx
  on public.shot_plan_job_scenes(project_id);

-- Updated_at triggers
drop trigger if exists trg_shot_plan_jobs_updated_at on public.shot_plan_jobs;
create trigger trg_shot_plan_jobs_updated_at
before update on public.shot_plan_jobs
for each row execute function public.set_updated_at();

drop trigger if exists trg_shot_plan_job_scenes_updated_at on public.shot_plan_job_scenes;
create trigger trg_shot_plan_job_scenes_updated_at
before update on public.shot_plan_job_scenes
for each row execute function public.set_updated_at();

-- RLS
alter table public.shot_plan_jobs enable row level security;
alter table public.shot_plan_job_scenes enable row level security;

create policy "shot_plan_jobs_select" on public.shot_plan_jobs for select to authenticated using (true);
create policy "shot_plan_jobs_insert" on public.shot_plan_jobs for insert to authenticated with check (true);
create policy "shot_plan_jobs_update" on public.shot_plan_jobs for update to authenticated using (true);

create policy "shot_plan_job_scenes_select" on public.shot_plan_job_scenes for select to authenticated using (true);
create policy "shot_plan_job_scenes_insert" on public.shot_plan_job_scenes for insert to authenticated with check (true);
create policy "shot_plan_job_scenes_update" on public.shot_plan_job_scenes for update to authenticated using (true);
