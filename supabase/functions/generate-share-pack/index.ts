/**
 * generate-share-pack — Resolves approved docs for a share pack and returns download data.
 * Supports action: "resolve" (returns doc list + content for client-side bundling).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { share_pack_id, action = 'resolve' } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Fetch the pack
    const { data: pack, error: packErr } = await sb
      .from('project_share_packs')
      .select('*')
      .eq('id', share_pack_id)
      .single();

    if (packErr || !pack) {
      return new Response(JSON.stringify({ error: 'Pack not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const selection = (pack.selection || []) as Array<{ doc_type: string; version_id?: string }>;
    const projectId = pack.project_id;

    // Resolve each doc type to its approved version content
    const resolvedDocs: Array<{
      doc_type: string;
      label: string;
      content: string;
      version_id: string;
    }> = [];

    for (const sel of selection) {
      // Find the document
      const { data: docs } = await sb
        .from('project_documents')
        .select('id, title')
        .eq('project_id', projectId)
        .eq('doc_type', sel.doc_type)
        .limit(1);

      if (!docs?.length) continue;
      const doc = docs[0];

      // If version pinned, use that; otherwise use latest approved
      let version: any = null;
      if (sel.version_id) {
        const { data: v } = await sb
          .from('project_document_versions')
          .select('id, plaintext')
          .eq('id', sel.version_id)
          .single();
        version = v;
      } else {
        const { data: versions } = await sb
          .from('project_document_versions')
          .select('id, plaintext')
          .eq('document_id', doc.id)
          .eq('status', 'final')
          .order('version_number', { ascending: false })
          .limit(1);
        version = versions?.[0];
      }

      if (!version?.plaintext) continue;

      // Apply watermark if enabled
      let content = version.plaintext;
      if (pack.watermark_enabled && pack.watermark_text) {
        content = `[${pack.watermark_text}]\n\n${content}`;
      }

      resolvedDocs.push({
        doc_type: sel.doc_type,
        label: doc.title || sel.doc_type,
        content,
        version_id: version.id,
      });
    }

    // Build cover sheet if enabled
    let coverSheet = '';
    if (pack.include_cover) {
      const { data: project } = await sb
        .from('projects')
        .select('title, format')
        .eq('id', projectId)
        .single();

      coverSheet = [
        `# ${project?.title || 'Project'}`,
        `**${pack.name}**`,
        `Generated: ${new Date().toISOString().slice(0, 10)}`,
        pack.watermark_enabled ? `\n_${pack.watermark_text || 'CONFIDENTIAL'}_` : '',
        '',
      ].join('\n');
    }

    // Build TOC if enabled
    let toc = '';
    if (pack.include_contents && resolvedDocs.length > 0) {
      toc = '## Table of Contents\n\n' +
        resolvedDocs.map((d, i) => `${i + 1}. ${d.label}`).join('\n') +
        '\n\n---\n';
    }

    return new Response(JSON.stringify({
      pack_id: pack.id,
      pack_name: pack.name,
      cover_sheet: coverSheet,
      toc,
      documents: resolvedDocs,
      doc_count: resolvedDocs.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
