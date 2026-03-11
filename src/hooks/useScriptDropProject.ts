/**
 * useScriptDropProject
 *
 * Orchestrates the full pipeline when a screenplay is dropped on the
 * Script Drop Zone on the New Project page:
 *
 *   1. Upload script to storage (scripts bucket)
 *   2. Create project_documents + project_document_versions records
 *   3. Ingest PDF → extract text + title guess (script-intake: ingest_pdf)
 *   4. Create IFFY project (title from title_guess or filename)
 *   5. Create project_scripts record
 *   6. Run extract-scenes → populate scene_graph_scenes + scene_graph_versions
 *   7. nit-sync → sync_scene_entity_links   (NIT name scan)
 *   8. nit-sync → sync_dialogue_characters  (dialogue heading detection + write-back)
 *   9. dev-engine-v2 → scene_graph_classify_roles_heuristic
 *  10. dev-engine-v2 → scene_graph_sync_spine_links
 *  11. dev-engine-v2 → scene_derive_blueprint_bindings
 *  12. Navigate to /projects/:id
 *
 * All stages are fail-tolerant after stage 4 (project created):
 * enrichment failures are logged but do not block navigation.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export type DropStageStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface DropStage {
  key: string;
  label: string;
  status: DropStageStatus;
  detail?: string;
}

const INITIAL_STAGES: DropStage[] = [
  { key: 'upload',       label: 'Uploading script…',                   status: 'pending' },
  { key: 'ingest',       label: 'Extracting text & detecting title…',  status: 'pending' },
  { key: 'create',       label: 'Creating project…',                   status: 'pending' },
  { key: 'scenes',       label: 'Extracting scene graph…',             status: 'pending' },
  { key: 'nit_scan',     label: 'Linking NIT entities (name scan)…',   status: 'pending' },
  { key: 'nit_dialogue', label: 'Linking NIT entities (dialogue)…',    status: 'pending' },
  { key: 'classify',     label: 'Classifying scene roles…',            status: 'pending' },
  { key: 'spine',        label: 'Syncing spine links…',                status: 'pending' },
  { key: 'bindings',     label: 'Deriving blueprint bindings…',        status: 'pending' },
];

const FUNC_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function callFunction(
  name: string,
  body: Record<string, unknown>,
  token: string,
): Promise<any> {
  const resp = await fetch(`${FUNC_BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || `${name} failed: ${resp.status}`);
  if (json?.error) throw new Error(json.error);
  return json;
}

export function useScriptDropProject() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stages, setStages] = useState<DropStage[]>(INITIAL_STAGES);
  const [isRunning, setIsRunning] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);

  const setStage = useCallback((key: string, status: DropStageStatus, detail?: string) => {
    setStages(prev => prev.map(s => s.key === key ? { ...s, status, detail } : s));
  }, []);

  const run = useCallback(async (file: File) => {
    if (!user) { toast.error('Sign in required'); return; }
    if (isRunning) return;

    setIsRunning(true);
    setStages(INITIAL_STAGES.map(s => ({ ...s, status: 'pending' })));
    setProjectId(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';

      // ── Stage 1: Upload ─────────────────────────────────────────────────
      setStage('upload', 'running');
      const ts = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `tmp/${user.id}/${ts}_${safeName}`;

      const { error: upErr } = await supabase.storage
        .from('scripts')
        .upload(storagePath, file, { upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      setStage('upload', 'done');

      // ── Stage 2: Ingest PDF ─────────────────────────────────────────────
      setStage('ingest', 'running');

      // Create a temporary project_documents record so ingest_pdf can write back
      // extraction_status + extracted_text. We need a project_id for the FK,
      // but we don't have one yet — use a pre-flight insert under a temp doc
      // that we'll re-attach once the project is created.
      //
      // Workaround: create a placeholder doc with project_id=null (if schema allows),
      // otherwise create the project first with a placeholder title then update.
      // IFFY projects table requires a title — use filename as temporary title.
      const placeholderTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';

      // Create project first with placeholder title so we have an FK for docs
      const { data: placeholderProject, error: ppErr } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          title: placeholderTitle,
          format: 'film',
          genres: [],
          budget_range: '',
          target_audience: '',
          tone: '',
          comparable_titles: '',
        })
        .select('id')
        .single();
      if (ppErr) throw new Error(`Project create failed: ${ppErr.message}`);
      const pid = placeholderProject.id;

      // Create project_documents record
      const { data: doc, error: docErr } = await (supabase as any)
        .from('project_documents')
        .insert({
          project_id: pid,
          user_id: user.id,
          doc_type: 'script_pdf',
          title: placeholderTitle,
          file_name: file.name,
          file_path: storagePath,
          storage_path: storagePath,
          extraction_status: 'pending',
          source: 'drop',
        })
        .select('id')
        .single();
      if (docErr) throw new Error(`Doc create: ${docErr.message}`);

      // Create initial version
      const { data: ver, error: verErr } = await (supabase as any)
        .from('project_document_versions')
        .insert({
          document_id: doc.id,
          created_by: user.id,
          version_number: 1,
          plaintext: '',
          label: 'Script drop upload',
          deliverable_type: 'script_pdf',
        })
        .select('id')
        .single();
      if (verErr) throw new Error(`Version create: ${verErr.message}`);

      await (supabase as any)
        .from('project_documents')
        .update({ latest_version_id: ver.id })
        .eq('id', doc.id);

      // Ingest: extract text + detect title
      let titleGuess = placeholderTitle;
      try {
        const ingestResult = await callFunction('script-intake', {
          action: 'ingest_pdf',
          projectId: pid,
          storagePath,
          documentId: doc.id,
          versionId: ver.id,
        }, token);
        if (ingestResult?.titleGuess) titleGuess = ingestResult.titleGuess;
      } catch (ingestErr: any) {
        // Non-fatal: extraction failure just means scenes will be extracted from raw text
        console.warn('[drop] ingest_pdf failed (non-fatal):', ingestErr.message);
        setStage('ingest', 'skipped', ingestErr.message);
      }
      if (stages.find(s => s.key === 'ingest')?.status !== 'skipped') {
        setStage('ingest', 'done');
      }

      // ── Stage 3: Finalise project ────────────────────────────────────────
      setStage('create', 'running');

      // Update project title with AI-detected title (if better than filename)
      if (titleGuess !== placeholderTitle) {
        await supabase
          .from('projects')
          .update({ title: titleGuess })
          .eq('id', pid);
      }

      // Create project_scripts record
      await (supabase as any)
        .from('project_scripts')
        .upsert({
          project_id: pid,
          user_id: user.id,
          version_label: titleGuess,
          status: 'current',
          file_path: storagePath,
          notes: 'Created via Script Drop Zone',
        }, { onConflict: 'project_id' });

      setProjectId(pid);
      setStage('create', 'done', titleGuess);

      // ── Stage 4–11: Enrichment pipeline (fail-tolerant) ─────────────────
      // Project exists — failures below log but do not block navigation.

      // Stage 4: extract-scenes
      setStage('scenes', 'running');
      try {
        await callFunction('extract-scenes', { projectId: pid }, token);
        setStage('scenes', 'done');
      } catch (e: any) {
        console.warn('[drop] extract-scenes:', e.message);
        setStage('scenes', 'error', e.message);
      }

      // Stage 5: NIT name scan
      setStage('nit_scan', 'running');
      try {
        await callFunction('nit-sync', { projectId: pid, action: 'sync_scene_entity_links' }, token);
        setStage('nit_scan', 'done');
      } catch (e: any) {
        console.warn('[drop] nit-sync/scan:', e.message);
        setStage('nit_scan', 'error', e.message);
      }

      // Stage 6: NIT dialogue + characters_present write-back
      setStage('nit_dialogue', 'running');
      try {
        await callFunction('nit-sync', { projectId: pid, action: 'sync_dialogue_characters' }, token);
        setStage('nit_dialogue', 'done');
      } catch (e: any) {
        console.warn('[drop] nit-sync/dialogue:', e.message);
        setStage('nit_dialogue', 'error', e.message);
      }

      // Stage 7: classify roles
      setStage('classify', 'running');
      try {
        await callFunction('dev-engine-v2', { action: 'scene_graph_classify_roles_heuristic', projectId: pid, force: true }, token);
        setStage('classify', 'done');
      } catch (e: any) {
        console.warn('[drop] classify_roles:', e.message);
        setStage('classify', 'error', e.message);
      }

      // Stage 8: spine links
      setStage('spine', 'running');
      try {
        await callFunction('dev-engine-v2', { action: 'scene_graph_sync_spine_links', projectId: pid }, token);
        setStage('spine', 'done');
      } catch (e: any) {
        console.warn('[drop] spine_links:', e.message);
        setStage('spine', 'error', e.message);
      }

      // Stage 9: blueprint bindings
      setStage('bindings', 'running');
      try {
        await callFunction('dev-engine-v2', { action: 'scene_derive_blueprint_bindings', projectId: pid }, token);
        setStage('bindings', 'done');
      } catch (e: any) {
        console.warn('[drop] blueprint_bindings:', e.message);
        setStage('bindings', 'error', e.message);
      }

      toast.success(`"${titleGuess}" created — scene graph ready`);
      navigate(`/projects/${pid}`);

    } catch (err: any) {
      toast.error('Script drop failed', { description: err.message });
      console.error('[useScriptDropProject]', err);
    } finally {
      setIsRunning(false);
    }
  }, [user, isRunning, navigate, setStage]);

  return { run, stages, isRunning, projectId };
}
