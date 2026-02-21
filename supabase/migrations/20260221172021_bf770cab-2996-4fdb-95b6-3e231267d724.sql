
-- Phase 4.1: scenario_scores + scenario_recommendations

create table if not exists public.scenario_scores (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scenario_id uuid not null references public.project_scenarios(id) on delete cascade,
  as_of timestamptz not null default now(),
  metrics jsonb not null default '{}'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, scenario_id)
);

create index if not exists scenario_scores_project_id_idx on public.scenario_scores(project_id);
create index if not exists scenario_scores_scenario_id_idx on public.scenario_scores(scenario_id);

create table if not exists public.scenario_recommendations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  recommended_scenario_id uuid not null references public.project_scenarios(id) on delete cascade,
  confidence int not null default 50,
  reasons jsonb not null default '[]'::jsonb,
  tradeoffs jsonb not null default '{}'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists scenario_recommendations_project_created_idx
  on public.scenario_recommendations(project_id, created_at desc);

-- RLS
alter table public.scenario_scores enable row level security;
alter table public.scenario_recommendations enable row level security;

-- Use has_project_access() to match existing project membership pattern
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='scenario_scores' and policyname='scenario_scores_access_rw'
  ) then
    create policy scenario_scores_access_rw
      on public.scenario_scores
      for all
      to authenticated
      using (public.has_project_access(auth.uid(), project_id))
      with check (public.has_project_access(auth.uid(), project_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='scenario_recommendations' and policyname='scenario_recommendations_access_rw'
  ) then
    create policy scenario_recommendations_access_rw
      on public.scenario_recommendations
      for all
      to authenticated
      using (public.has_project_access(auth.uid(), project_id))
      with check (public.has_project_access(auth.uid(), project_id));
  end if;
end $$;

-- updated_at trigger for scenario_scores
drop trigger if exists scenario_scores_set_updated_at on public.scenario_scores;
create trigger scenario_scores_set_updated_at
before update on public.scenario_scores
for each row execute function public.set_updated_at();
