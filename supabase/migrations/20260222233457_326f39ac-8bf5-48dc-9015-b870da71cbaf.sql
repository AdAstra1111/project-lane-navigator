
-- ==========================================
-- Writers' Room for Notes: DB schema + RLS
-- ==========================================

-- note_threads
create table if not exists public.note_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.project_documents(id) on delete cascade,
  version_id uuid null references public.project_document_versions(id) on delete set null,
  note_hash text not null,
  note_snapshot jsonb null,
  status text not null default 'open',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists note_threads_project_id_idx on public.note_threads(project_id);
create index if not exists note_threads_doc_id_idx on public.note_threads(document_id);
create index if not exists note_threads_note_hash_idx on public.note_threads(note_hash);
create unique index if not exists note_threads_unique_per_note on public.note_threads(document_id, note_hash);

-- note_thread_messages
create table if not exists public.note_thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.note_threads(id) on delete cascade,
  role text not null,
  content text not null,
  meta jsonb null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists note_thread_messages_thread_id_idx on public.note_thread_messages(thread_id);
create index if not exists note_thread_messages_created_at_idx on public.note_thread_messages(created_at);

-- note_option_sets
create table if not exists public.note_option_sets (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.note_threads(id) on delete cascade,
  option_set_index int not null,
  direction jsonb null,
  pinned_constraints jsonb null,
  options jsonb not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index if not exists note_option_sets_unique_index on public.note_option_sets(thread_id, option_set_index);
create index if not exists note_option_sets_thread_id_idx on public.note_option_sets(thread_id);

-- note_thread_state
create table if not exists public.note_thread_state (
  thread_id uuid primary key references public.note_threads(id) on delete cascade,
  direction jsonb not null default '{}'::jsonb,
  pinned_constraints jsonb not null default '[]'::jsonb,
  selected_option jsonb null,
  synthesis jsonb null,
  last_generated_set int null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_note_threads_touch on public.note_threads;
create trigger trg_note_threads_touch
before update on public.note_threads
for each row execute procedure public.touch_updated_at();

-- ==========================================
-- RLS — uses existing has_project_access function
-- ==========================================
alter table public.note_threads enable row level security;
alter table public.note_thread_messages enable row level security;
alter table public.note_option_sets enable row level security;
alter table public.note_thread_state enable row level security;

-- note_threads policies
create policy "note_threads_select" on public.note_threads for select
using (public.has_project_access(auth.uid(), project_id));

create policy "note_threads_insert" on public.note_threads for insert
with check (public.has_project_access(auth.uid(), project_id) and created_by = auth.uid());

create policy "note_threads_update" on public.note_threads for update
using (public.has_project_access(auth.uid(), project_id));

-- note_thread_messages policies
create policy "note_thread_messages_select" on public.note_thread_messages for select
using (exists (
  select 1 from public.note_threads nt
  where nt.id = note_thread_messages.thread_id
  and public.has_project_access(auth.uid(), nt.project_id)
));

create policy "note_thread_messages_insert" on public.note_thread_messages for insert
with check (exists (
  select 1 from public.note_threads nt
  where nt.id = note_thread_messages.thread_id
  and public.has_project_access(auth.uid(), nt.project_id)
) and created_by = auth.uid());

-- note_option_sets policies
create policy "note_option_sets_select" on public.note_option_sets for select
using (exists (
  select 1 from public.note_threads nt
  where nt.id = note_option_sets.thread_id
  and public.has_project_access(auth.uid(), nt.project_id)
));

create policy "note_option_sets_insert" on public.note_option_sets for insert
with check (exists (
  select 1 from public.note_threads nt
  where nt.id = note_option_sets.thread_id
  and public.has_project_access(auth.uid(), nt.project_id)
) and created_by = auth.uid());

-- note_thread_state policies
create policy "note_thread_state_select" on public.note_thread_state for select
using (exists (
  select 1 from public.note_threads nt
  where nt.id = note_thread_state.thread_id
  and public.has_project_access(auth.uid(), nt.project_id)
));

create policy "note_thread_state_insert" on public.note_thread_state for insert
with check (exists (
  select 1 from public.note_threads nt
  where nt.id = note_thread_state.thread_id
  and public.has_project_access(auth.uid(), nt.project_id)
) and updated_by = auth.uid());

create policy "note_thread_state_update" on public.note_thread_state for update
using (exists (
  select 1 from public.note_threads nt
  where nt.id = note_thread_state.thread_id
  and public.has_project_access(auth.uid(), nt.project_id)
));
