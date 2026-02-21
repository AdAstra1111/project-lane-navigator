/**
 * useScriptIntake — hook for Script Intake module: upload, ingest, coverage, backfill.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ScriptIntakeState {
  documentId: string | null;
  versionId: string | null;
  storagePath: string | null;
  pageCount: number;
  titleGuess: string;
  scenes: any[];
}

export interface CoverageResult {
  loglines: string[];
  one_page_synopsis: string;
  full_synopsis: string;
  comments: string;
  strengths: string[];
  weaknesses: string[];
  market_positioning: {
    comps: string[];
    audience: string;
    platform_fit: string;
    budget_band: string;
    risks: string[];
  };
  craft_structure: {
    act_breakdown: string;
    turning_points: string[];
    pacing_notes: string;
    character_arcs: { character: string; arc: string; page_refs?: number[] }[];
  };
  scene_notes: { scene_heading: string; page: number; note: string; strength_or_issue?: string }[];
  scorecard: {
    premise: number;
    structure: number;
    characters: number;
    dialogue: number;
    originality: number;
    commercial_viability: number;
    overall: number;
    recommendation: string;
  };
  evidence_map: Record<string, { quote: string; page: number; confidence: string; assumption: boolean }>;
  confidence_summary: { overall: string; sections?: Record<string, string> };
}

export interface BackfillDoc {
  docType: string;
  title: string;
  content_markdown: string;
  evidence_map: Record<string, any>;
  confidence_summary: { overall: string; note?: string };
  error?: string;
}

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/script-intake`;

async function callIntake(action: string, body: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    if (resp.status === 429) toast.error('Rate limit exceeded. Please wait and try again.');
    else if (resp.status === 402) toast.error('Credits required. Please add funds to your workspace.');
    throw new Error(err.error || 'Request failed');
  }
  return resp.json();
}

export function useScriptIntake(projectId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [intake, setIntake] = useState<ScriptIntakeState | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [backfillDocs, setBackfillDocs] = useState<BackfillDoc[]>([]);

  // Upload PDF + create doc/version + ingest
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!projectId || !user) throw new Error('Missing context');

      // 1. Upload to storage
      const ts = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${projectId}/${ts}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('scripts')
        .upload(path, file, { upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      // 2. Create project_document
      const { data: doc, error: docErr } = await (supabase as any)
        .from('project_documents')
        .insert({
          project_id: projectId,
          user_id: user.id,
          doc_type: 'script_pdf',
          title: file.name.replace('.pdf', ''),
          file_name: file.name,
          file_path: path,
          storage_path: path,
          extraction_status: 'pending',
          source: 'upload',
        })
        .select('id')
        .single();
      if (docErr) throw new Error(`Doc create: ${docErr.message}`);

      // 3. Create version
      const { data: ver, error: verErr } = await (supabase as any)
        .from('project_document_versions')
        .insert({
          document_id: doc.id,
          created_by: user.id,
          version_number: 1,
          plaintext: '',
          label: 'Initial upload',
          deliverable_type: 'script_pdf',
        })
        .select('id')
        .single();
      if (verErr) throw new Error(`Version create: ${verErr.message}`);

      // Update latest_version_id
      await (supabase as any)
        .from('project_documents')
        .update({ latest_version_id: ver.id })
        .eq('id', doc.id);

      // 4. Ingest (extract pages via edge function)
      const result = await callIntake('ingest_pdf', {
        projectId,
        storagePath: path,
        documentId: doc.id,
        versionId: ver.id,
      });

      const state: ScriptIntakeState = {
        documentId: doc.id,
        versionId: ver.id,
        storagePath: path,
        pageCount: result.pageCount || 0,
        titleGuess: result.titleGuess || file.name.replace('.pdf', ''),
        scenes: result.scenes || [],
      };
      setIntake(state);
      return state;
    },
    onSuccess: () => {
      toast.success('Script uploaded and parsed');
      qc.invalidateQueries({ queryKey: ['project-documents'] });
    },
    onError: (err: any) => toast.error(`Upload failed: ${err.message}`),
  });

  // Generate coverage
  const generateCoverage = useMutation({
    mutationFn: async () => {
      if (!projectId || !intake?.versionId) throw new Error('No script ingested');
      const result = await callIntake('generate_coverage', {
        projectId,
        scriptVersionId: intake.versionId,
      });
      setCoverage(result);
      return result;
    },
    onError: (err: any) => toast.error(`Coverage failed: ${err.message}`),
  });

  // Save coverage as document version
  const saveCoverage = useMutation({
    mutationFn: async () => {
      if (!projectId || !user || !coverage || !intake) throw new Error('Missing data');
      const result = await callIntake('save_backfilled_doc', {
        projectId,
        docType: 'script_coverage',
        title: `Coverage — ${intake.titleGuess}`,
        content_markdown: formatCoverageAsMarkdown(coverage),
        sourceScriptVersionId: intake.versionId,
        evidence_map: coverage.evidence_map,
        confidence_summary: coverage.confidence_summary,
        approve: true,
      });
      toast.success('Coverage saved to project');
      qc.invalidateQueries({ queryKey: ['project-documents'] });
      return result;
    },
    onError: (err: any) => toast.error(`Save failed: ${err.message}`),
  });

  // Backfill documents
  const generateBackfill = useMutation({
    mutationFn: async (docTypes: string[]) => {
      if (!projectId || !intake?.versionId) throw new Error('No script ingested');
      const result = await callIntake('backfill_docs', {
        projectId,
        scriptVersionId: intake.versionId,
        docTypes,
      });
      setBackfillDocs(result);
      return result;
    },
    onError: (err: any) => toast.error(`Backfill failed: ${err.message}`),
  });

  // Approve/save a backfilled doc
  const approveBackfillDoc = useMutation({
    mutationFn: async ({ doc, approve }: { doc: BackfillDoc; approve: boolean }) => {
      if (!projectId || !intake?.versionId) throw new Error('Missing data');
      const result = await callIntake('save_backfilled_doc', {
        projectId,
        docType: doc.docType,
        title: doc.title,
        content_markdown: doc.content_markdown,
        sourceScriptVersionId: intake.versionId,
        evidence_map: doc.evidence_map,
        confidence_summary: doc.confidence_summary,
        approve,
      });
      toast.success(`${doc.title} saved${approve ? ' and approved' : ''}`);
      qc.invalidateQueries({ queryKey: ['project-documents'] });
      return result;
    },
    onError: (err: any) => toast.error(`Save failed: ${err.message}`),
  });

  return {
    intake,
    coverage,
    backfillDocs,
    upload,
    generateCoverage,
    saveCoverage,
    generateBackfill,
    approveBackfillDoc,
  };
}

function formatCoverageAsMarkdown(c: CoverageResult): string {
  const lines: string[] = [];
  lines.push('# Script Coverage\n');

  lines.push('## Loglines\n');
  c.loglines.forEach((l, i) => lines.push(`${i + 1}. ${l}\n`));

  lines.push('\n## One-Page Synopsis\n');
  lines.push(c.one_page_synopsis + '\n');

  lines.push('\n## Full Synopsis\n');
  lines.push(c.full_synopsis + '\n');

  lines.push('\n## Comments\n');
  lines.push(c.comments + '\n');

  lines.push('\n## Strengths\n');
  c.strengths.forEach(s => lines.push(`- ${s}`));

  lines.push('\n\n## Weaknesses\n');
  c.weaknesses.forEach(w => lines.push(`- ${w}`));

  lines.push('\n\n## Market Positioning\n');
  lines.push(`**Comps:** ${c.market_positioning.comps.join(', ')}\n`);
  lines.push(`**Audience:** ${c.market_positioning.audience}\n`);
  lines.push(`**Platform Fit:** ${c.market_positioning.platform_fit}\n`);
  lines.push(`**Budget Band:** ${c.market_positioning.budget_band}\n`);
  lines.push(`**Risks:** ${c.market_positioning.risks.join('; ')}\n`);

  lines.push('\n## Craft & Structure\n');
  lines.push(`**Act Breakdown:** ${c.craft_structure.act_breakdown}\n`);
  lines.push(`**Turning Points:** ${c.craft_structure.turning_points.join('; ')}\n`);
  lines.push(`**Pacing:** ${c.craft_structure.pacing_notes}\n`);

  lines.push('\n### Character Arcs\n');
  c.craft_structure.character_arcs.forEach(ca => {
    lines.push(`- **${ca.character}**: ${ca.arc}${ca.page_refs?.length ? ` (pp. ${ca.page_refs.join(', ')})` : ''}`);
  });

  lines.push('\n\n## Scene Notes\n');
  c.scene_notes.forEach(sn => {
    lines.push(`- **${sn.scene_heading}** (p.${sn.page}): ${sn.note}${sn.strength_or_issue ? ` [${sn.strength_or_issue}]` : ''}`);
  });

  lines.push('\n\n## Scorecard\n');
  const sc = c.scorecard;
  lines.push(`| Category | Score |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Premise | ${sc.premise}/10 |`);
  lines.push(`| Structure | ${sc.structure}/10 |`);
  lines.push(`| Characters | ${sc.characters}/10 |`);
  lines.push(`| Dialogue | ${sc.dialogue}/10 |`);
  lines.push(`| Originality | ${sc.originality}/10 |`);
  lines.push(`| Commercial Viability | ${sc.commercial_viability}/10 |`);
  lines.push(`| **Overall** | **${sc.overall}/10** |`);
  lines.push(`\n**Recommendation:** ${sc.recommendation}`);

  return lines.join('\n');
}
