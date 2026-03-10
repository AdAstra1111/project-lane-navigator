// share-pack-access/index.ts
// Secure server-side handler for share pack token validation and document delivery.
// Replaces direct client-side Supabase queries in SharePackView — prevents:
//   1. password_hash exposure (was base64, trivially reversible)
//   2. unauthenticated document content access
//   3. bypass via direct API calls skipping client-side checks
//
// Actions:
//   validate   — validate token + optional password, return pack metadata (no doc content)
//   fetch_doc  — validate token + fetch one document's plaintext securely
//   fetch_all  — validate token + fetch all documents in pack as combined text

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Constant-time string comparison to prevent timing attacks
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to prevent length-based timing
    let result = false;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      result = result || (a[i] !== b[i]);
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Verify password — supports both legacy btoa() encoding and plain text
// (for future: could upgrade to bcrypt)
function verifyPassword(input: string, stored_hash: string): boolean {
  if (!stored_hash) return true; // no password set
  // Legacy: stored as btoa(password)
  try {
    const decoded = atob(stored_hash);
    if (safeEqual(input, decoded)) return true;
  } catch { /* not valid base64 */ }
  // Plain text fallback (older records)
  return safeEqual(input, stored_hash);
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  link?: any;
  pack?: any;
}

async function validateToken(
  supabase: any,
  token: string,
  password?: string
): Promise<ValidationResult> {
  // Fetch link — use service role so RLS doesn't interfere
  const { data: link, error } = await supabase
    .from("project_share_pack_links")
    .select("id, pack_id, token, expires_at, is_revoked, max_downloads, download_count, password_hash, project_share_packs(id, project_id, name, selection, is_active)")
    .eq("token", token)
    .single();

  if (error || !link) {
    return { valid: false, error: "Share link not found or expired." };
  }

  const pack = link.project_share_packs;

  if (link.is_revoked) {
    return { valid: false, error: "This share link has been revoked." };
  }

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return { valid: false, error: "This share link has expired." };
  }

  if (link.max_downloads && link.download_count >= link.max_downloads) {
    return { valid: false, error: "This share link has reached its download limit." };
  }

  if (!pack?.is_active) {
    return { valid: false, error: "This share pack is no longer active." };
  }

  // Password check (server-side)
  if (link.password_hash) {
    if (!password) {
      return { valid: false, error: "PASSWORD_REQUIRED" };
    }
    if (!verifyPassword(password, link.password_hash)) {
      return { valid: false, error: "Incorrect password." };
    }
  }

  // Strip sensitive fields before returning
  const safePack = {
    id: pack.id,
    project_id: pack.project_id,
    name: pack.name,
    selection: pack.selection,
  };
  const safeLink = {
    id: link.id,
    expires_at: link.expires_at,
    max_downloads: link.max_downloads,
    download_count: link.download_count,
    has_password: !!link.password_hash,
    // Never expose password_hash to client
  };

  return { valid: true, link: safeLink, pack: safePack };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Always use service role for share pack access — documents are gated by token validation, not user auth
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action, token, password, doc_type } = body;

    if (!token) {
      return new Response(JSON.stringify({ error: "token required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: validate ──
    if (action === "validate") {
      const result = await validateToken(supabase, token, password);
      if (!result.valid) {
        const status = result.error === "PASSWORD_REQUIRED" ? 401 : 403;
        return new Response(JSON.stringify({ valid: false, error: result.error }), {
          status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ valid: true, link: result.link, pack: result.pack }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: fetch_doc ──
    if (action === "fetch_doc") {
      if (!doc_type) {
        return new Response(JSON.stringify({ error: "doc_type required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await validateToken(supabase, token, password);
      if (!result.valid) {
        const status = result.error === "PASSWORD_REQUIRED" ? 401 : 403;
        return new Response(JSON.stringify({ valid: false, error: result.error }), {
          status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify the requested doc_type is in the pack's selection
      const selection: Array<{ doc_type: string }> = result.pack.selection || [];
      const allowed = selection.some((s) => s.doc_type === doc_type);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Document type not included in this share pack." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch document content using service role
      const { data: docs } = await supabase
        .from("project_documents")
        .select("id, title, doc_type")
        .eq("project_id", result.pack.project_id)
        .eq("doc_type", doc_type)
        .limit(1);

      if (!docs?.length) {
        return new Response(JSON.stringify({ error: "Document not found." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: versions } = await supabase
        .from("project_document_versions")
        .select("plaintext, version_number, created_at")
        .eq("document_id", docs[0].id)
        .in("approval_status", ["approved"])
        .order("version_number", { ascending: false })
        .limit(1);

      // Fallback: latest version if none approved
      let content = versions?.[0]?.plaintext;
      if (!content) {
        const { data: anyVersions } = await supabase
          .from("project_document_versions")
          .select("plaintext")
          .eq("document_id", docs[0].id)
          .eq("is_current", true)
          .limit(1);
        content = anyVersions?.[0]?.plaintext;
      }

      if (!content) {
        return new Response(JSON.stringify({ error: "No content available for this document." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Log download event
      await supabase
        .from("project_share_pack_events")
        .insert({ link_id: result.link.id, event_type: "file_download", metadata: { doc_type } })
        .then(() => {});

      // Increment download count
      await supabase
        .from("project_share_pack_links")
        .update({ download_count: (result.link.download_count || 0) + 1 })
        .eq("id", result.link.id);

      return new Response(JSON.stringify({
        doc_type,
        title: docs[0].title || doc_type,
        content,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── ACTION: fetch_all ──
    if (action === "fetch_all") {
      const result = await validateToken(supabase, token, password);
      if (!result.valid) {
        const status = result.error === "PASSWORD_REQUIRED" ? 401 : 403;
        return new Response(JSON.stringify({ valid: false, error: result.error }), {
          status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const selection: Array<{ doc_type: string }> = result.pack.selection || [];
      const documents: Array<{ doc_type: string; title: string; content: string }> = [];

      for (const s of selection) {
        const { data: docs } = await supabase
          .from("project_documents")
          .select("id, title, doc_type")
          .eq("project_id", result.pack.project_id)
          .eq("doc_type", s.doc_type)
          .limit(1);

        if (!docs?.length) continue;

        const { data: versions } = await supabase
          .from("project_document_versions")
          .select("plaintext")
          .eq("document_id", docs[0].id)
          .in("approval_status", ["approved"])
          .order("version_number", { ascending: false })
          .limit(1);

        let content = versions?.[0]?.plaintext;
        if (!content) {
          const { data: anyVer } = await supabase
            .from("project_document_versions")
            .select("plaintext")
            .eq("document_id", docs[0].id)
            .eq("is_current", true)
            .limit(1);
          content = anyVer?.[0]?.plaintext;
        }

        if (content) {
          documents.push({ doc_type: s.doc_type, title: docs[0].title || s.doc_type, content });
        }
      }

      // Log download event
      await supabase
        .from("project_share_pack_events")
        .insert({ link_id: result.link.id, event_type: "file_download", metadata: { doc_type: "all" } })
        .then(() => {});

      await supabase
        .from("project_share_pack_links")
        .update({ download_count: (result.link.download_count || 0) + 1 })
        .eq("id", result.link.id);

      return new Response(JSON.stringify({ documents }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}. Use validate, fetch_doc, or fetch_all.` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[share-pack-access] error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
