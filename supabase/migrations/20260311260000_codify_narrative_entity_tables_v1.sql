-- ============================================================
-- Codify Narrative Entity Subsystem Tables
-- ============================================================
--
-- EVIDENCE BASIS (get_table_schema op, 2026-03-11):
-- All four tables captured from live production. Schema faithfully reproduced.
-- Migration is fully IDEMPOTENT via IF NOT EXISTS guards on all objects.
--
-- Creation order respects FK dependencies:
--   1. narrative_entities       (root — no deps on other new tables)
--   2. narrative_entity_mentions (FK → narrative_entities, project_documents, project_document_versions)
--   3. narrative_entity_relations (FK → narrative_entities × 2)
--   4. narrative_scene_entity_links (FK → narrative_entities, scene_graph_scenes, scene_graph_versions)
--
-- RLS policies installed in 20260311240000 are re-applied here via DO blocks
-- to ensure cold-deploy creates them even if that earlier migration was skipped.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 1. narrative_entities
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.narrative_entities (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  project_id     uuid        NOT NULL,
  entity_key     text        NOT NULL,
  canonical_name text        NOT NULL,
  entity_type    text        NOT NULL,
  source_kind    text        NOT NULL,
  source_key     text,
  status         text        NOT NULL DEFAULT 'active'::text,
  meta_json      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT narrative_entities_pkey PRIMARY KEY (id)
);

-- Columns (idempotent ADD if table existed without them)
ALTER TABLE public.narrative_entities
  ADD COLUMN IF NOT EXISTS source_key  text,
  ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT 'active'::text,
  ADD COLUMN IF NOT EXISTS meta_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- Constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entities_project_id_fkey' AND conrelid='public.narrative_entities'::regclass) THEN
    ALTER TABLE public.narrative_entities ADD CONSTRAINT narrative_entities_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entities_project_id_entity_key_key' AND conrelid='public.narrative_entities'::regclass) THEN
    ALTER TABLE public.narrative_entities ADD CONSTRAINT narrative_entities_project_id_entity_key_key
      UNIQUE (project_id, entity_key);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entities_entity_type_check' AND conrelid='public.narrative_entities'::regclass) THEN
    ALTER TABLE public.narrative_entities ADD CONSTRAINT narrative_entities_entity_type_check
      CHECK (entity_type = ANY (ARRAY['character'::text, 'arc'::text, 'conflict'::text]));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entities_source_kind_check' AND conrelid='public.narrative_entities'::regclass) THEN
    ALTER TABLE public.narrative_entities ADD CONSTRAINT narrative_entities_source_kind_check
      CHECK (source_kind = ANY (ARRAY['project_canon'::text, 'spine_axis'::text, 'manual'::text]));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entities_status_check' AND conrelid='public.narrative_entities'::regclass) THEN
    ALTER TABLE public.narrative_entities ADD CONSTRAINT narrative_entities_status_check
      CHECK (status = ANY (ARRAY['active'::text, 'stale'::text, 'retired'::text]));
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ne_project ON public.narrative_entities (project_id);
CREATE INDEX IF NOT EXISTS idx_ne_status  ON public.narrative_entities (status);
CREATE INDEX IF NOT EXISTS idx_ne_type    ON public.narrative_entities (entity_type);

-- RLS
ALTER TABLE public.narrative_entities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_entities' AND policyname='ne_select') THEN
    CREATE POLICY "ne_select" ON public.narrative_entities FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_entities' AND policyname='ne_insert') THEN
    CREATE POLICY "ne_insert" ON public.narrative_entities FOR INSERT TO authenticated WITH CHECK (has_project_access(auth.uid(), project_id));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_entities' AND policyname='ne_update') THEN
    CREATE POLICY "ne_update" ON public.narrative_entities FOR UPDATE TO authenticated USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_entities' AND policyname='ne_delete') THEN
    CREATE POLICY "ne_delete" ON public.narrative_entities FOR DELETE TO authenticated USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. narrative_entity_mentions
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.narrative_entity_mentions (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL,
  entity_id    uuid        NOT NULL,
  document_id  uuid        NOT NULL,
  version_id   uuid        NOT NULL,
  section_key  text,
  start_line   integer,
  end_line     integer,
  mention_text text,
  match_method text        NOT NULL,
  confidence   numeric     NOT NULL DEFAULT 1.0,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT narrative_entity_mentions_pkey PRIMARY KEY (id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_mentions_project_id_fkey' AND conrelid='public.narrative_entity_mentions'::regclass) THEN
    ALTER TABLE public.narrative_entity_mentions ADD CONSTRAINT narrative_entity_mentions_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_mentions_entity_id_fkey' AND conrelid='public.narrative_entity_mentions'::regclass) THEN
    ALTER TABLE public.narrative_entity_mentions ADD CONSTRAINT narrative_entity_mentions_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES public.narrative_entities(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_mentions_document_id_fkey' AND conrelid='public.narrative_entity_mentions'::regclass) THEN
    ALTER TABLE public.narrative_entity_mentions ADD CONSTRAINT narrative_entity_mentions_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES public.project_documents(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_mentions_version_id_fkey' AND conrelid='public.narrative_entity_mentions'::regclass) THEN
    ALTER TABLE public.narrative_entity_mentions ADD CONSTRAINT narrative_entity_mentions_version_id_fkey
      FOREIGN KEY (version_id) REFERENCES public.project_document_versions(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_mentions_entity_id_version_id_section_key__key' AND conrelid='public.narrative_entity_mentions'::regclass) THEN
    ALTER TABLE public.narrative_entity_mentions ADD CONSTRAINT narrative_entity_mentions_entity_id_version_id_section_key__key
      UNIQUE (entity_id, version_id, section_key, start_line, match_method);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_mentions_match_method_check' AND conrelid='public.narrative_entity_mentions'::regclass) THEN
    ALTER TABLE public.narrative_entity_mentions ADD CONSTRAINT narrative_entity_mentions_match_method_check
      CHECK (match_method = ANY (ARRAY['exact_name'::text, 'alias_exact'::text, 'manual'::text]));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_mentions_confidence_check' AND conrelid='public.narrative_entity_mentions'::regclass) THEN
    ALTER TABLE public.narrative_entity_mentions ADD CONSTRAINT narrative_entity_mentions_confidence_check
      CHECK (confidence >= 0 AND confidence <= 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nem_project ON public.narrative_entity_mentions (project_id);
CREATE INDEX IF NOT EXISTS idx_nem_entity  ON public.narrative_entity_mentions (entity_id);
CREATE INDEX IF NOT EXISTS idx_nem_doc     ON public.narrative_entity_mentions (document_id);
CREATE INDEX IF NOT EXISTS idx_nem_version ON public.narrative_entity_mentions (version_id);

ALTER TABLE public.narrative_entity_mentions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_entity_mentions' AND policyname='nem_select') THEN
    CREATE POLICY "nem_select" ON public.narrative_entity_mentions FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. narrative_entity_relations
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.narrative_entity_relations (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  project_id       uuid        NOT NULL,
  source_entity_id uuid        NOT NULL,
  target_entity_id uuid        NOT NULL,
  relation_type    text        NOT NULL,
  source_kind      text        NOT NULL DEFAULT 'canon_sync'::text,
  confidence       numeric     NOT NULL DEFAULT 1.0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT narrative_entity_relations_pkey PRIMARY KEY (id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_relations_project_id_fkey' AND conrelid='public.narrative_entity_relations'::regclass) THEN
    ALTER TABLE public.narrative_entity_relations ADD CONSTRAINT narrative_entity_relations_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_relations_source_entity_id_fkey' AND conrelid='public.narrative_entity_relations'::regclass) THEN
    ALTER TABLE public.narrative_entity_relations ADD CONSTRAINT narrative_entity_relations_source_entity_id_fkey
      FOREIGN KEY (source_entity_id) REFERENCES public.narrative_entities(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_relations_target_entity_id_fkey' AND conrelid='public.narrative_entity_relations'::regclass) THEN
    ALTER TABLE public.narrative_entity_relations ADD CONSTRAINT narrative_entity_relations_target_entity_id_fkey
      FOREIGN KEY (target_entity_id) REFERENCES public.narrative_entities(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_relations_source_entity_id_target_entity_i_key' AND conrelid='public.narrative_entity_relations'::regclass) THEN
    ALTER TABLE public.narrative_entity_relations ADD CONSTRAINT narrative_entity_relations_source_entity_id_target_entity_i_key
      UNIQUE (source_entity_id, target_entity_id, relation_type);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_relations_relation_type_check' AND conrelid='public.narrative_entity_relations'::regclass) THEN
    ALTER TABLE public.narrative_entity_relations ADD CONSTRAINT narrative_entity_relations_relation_type_check
      CHECK (relation_type = ANY (ARRAY['drives_arc'::text, 'subject_of_conflict'::text, 'opposes'::text]));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_relations_source_kind_check' AND conrelid='public.narrative_entity_relations'::regclass) THEN
    ALTER TABLE public.narrative_entity_relations ADD CONSTRAINT narrative_entity_relations_source_kind_check
      CHECK (source_kind = ANY (ARRAY['canon_sync'::text, 'spine_derivation'::text, 'manual'::text]));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_entity_relations_confidence_check' AND conrelid='public.narrative_entity_relations'::regclass) THEN
    ALTER TABLE public.narrative_entity_relations ADD CONSTRAINT narrative_entity_relations_confidence_check
      CHECK (confidence >= 0 AND confidence <= 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ner_project ON public.narrative_entity_relations (project_id);
CREATE INDEX IF NOT EXISTS idx_ner_source  ON public.narrative_entity_relations (source_entity_id);
CREATE INDEX IF NOT EXISTS idx_ner_target  ON public.narrative_entity_relations (target_entity_id);
CREATE INDEX IF NOT EXISTS idx_ner_type    ON public.narrative_entity_relations (relation_type);

ALTER TABLE public.narrative_entity_relations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_entity_relations' AND policyname='ner_select') THEN
    CREATE POLICY "ner_select" ON public.narrative_entity_relations FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. narrative_scene_entity_links
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.narrative_scene_entity_links (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  project_id        uuid        NOT NULL,
  scene_id          uuid        NOT NULL,
  entity_id         uuid        NOT NULL,
  relation_type     text        NOT NULL,
  -- confidence is text (not numeric) — matches production exactly
  -- values: 'deterministic' | 'inferred'
  confidence        text        NOT NULL DEFAULT 'deterministic'::text,
  source_version_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT narrative_scene_entity_links_pkey PRIMARY KEY (id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_scene_entity_links_project_id_fkey' AND conrelid='public.narrative_scene_entity_links'::regclass) THEN
    ALTER TABLE public.narrative_scene_entity_links ADD CONSTRAINT narrative_scene_entity_links_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_scene_entity_links_scene_id_fkey' AND conrelid='public.narrative_scene_entity_links'::regclass) THEN
    ALTER TABLE public.narrative_scene_entity_links ADD CONSTRAINT narrative_scene_entity_links_scene_id_fkey
      FOREIGN KEY (scene_id) REFERENCES public.scene_graph_scenes(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_scene_entity_links_entity_id_fkey' AND conrelid='public.narrative_scene_entity_links'::regclass) THEN
    ALTER TABLE public.narrative_scene_entity_links ADD CONSTRAINT narrative_scene_entity_links_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES public.narrative_entities(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  -- source_version_id FK: NO ACTION on delete (not CASCADE) — intentional.
  -- Deleting a version that is referenced by a link raises an error, preserving link integrity.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_scene_entity_links_source_version_id_fkey' AND conrelid='public.narrative_scene_entity_links'::regclass) THEN
    ALTER TABLE public.narrative_scene_entity_links ADD CONSTRAINT narrative_scene_entity_links_source_version_id_fkey
      FOREIGN KEY (source_version_id) REFERENCES public.scene_graph_versions(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_scene_entity_links_scene_id_entity_id_relation_ty_key' AND conrelid='public.narrative_scene_entity_links'::regclass) THEN
    ALTER TABLE public.narrative_scene_entity_links ADD CONSTRAINT narrative_scene_entity_links_scene_id_entity_id_relation_ty_key
      UNIQUE (scene_id, entity_id, relation_type);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_scene_entity_links_relation_type_check' AND conrelid='public.narrative_scene_entity_links'::regclass) THEN
    ALTER TABLE public.narrative_scene_entity_links ADD CONSTRAINT narrative_scene_entity_links_relation_type_check
      CHECK (relation_type = ANY (ARRAY['character_present'::text, 'arc_carrier'::text, 'conflict_arena'::text, 'entity_mentioned'::text]));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='narrative_scene_entity_links_confidence_check' AND conrelid='public.narrative_scene_entity_links'::regclass) THEN
    ALTER TABLE public.narrative_scene_entity_links ADD CONSTRAINT narrative_scene_entity_links_confidence_check
      CHECK (confidence = ANY (ARRAY['deterministic'::text, 'inferred'::text]));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nsel_project ON public.narrative_scene_entity_links (project_id);
CREATE INDEX IF NOT EXISTS idx_nsel_scene   ON public.narrative_scene_entity_links (scene_id);
CREATE INDEX IF NOT EXISTS idx_nsel_entity  ON public.narrative_scene_entity_links (entity_id);

ALTER TABLE public.narrative_scene_entity_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_scene_entity_links' AND policyname='nsel_select') THEN
    CREATE POLICY "nsel_select" ON public.narrative_scene_entity_links FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;
