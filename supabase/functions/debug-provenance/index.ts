import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createVersion } from "../_shared/doc-os.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── Auth: service_role OR authenticated user ──
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  let isAuthed = false;
  let callerUserId: string | null = null;

  if (token === serviceKey) {
    isAuthed = true;
  } else if (token.split(".").length === 3) {
    try {
      const seg = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = seg + "=".repeat((4 - (seg.length % 4)) % 4);
      const jwt = JSON.parse(atob(padded));
      if (jwt.role === "service_role") {
        isAuthed = true;
      } else if (jwt.sub) {
        isAuthed = true;
        callerUserId = jwt.sub;
      }
    } catch {}
  }
  if (!isAuthed) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const body = await req.json();
  const { project_id, doc_type, mode } = body;

  if (!project_id || !doc_type || !mode) {
    return new Response(JSON.stringify({ error: "project_id, doc_type, mode required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (mode !== "fail" && mode !== "pass") {
    return new Response(JSON.stringify({ error: "mode must be 'fail' or 'pass'" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify project access for non-service callers
  if (callerUserId) {
    const { data: hasAccess } = await supabase.rpc("has_project_access", { _user_id: callerUserId, _project_id: project_id });
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden: no project access" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Find latest doc
  const { data: doc } = await supabase
    .from("project_documents")
    .select("id, user_id")
    .eq("project_id", project_id)
    .eq("doc_type", doc_type)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!doc) {
    return new Response(JSON.stringify({ error: `No document found for ${doc_type}` }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get current version
  const { data: curVer } = await supabase
    .from("project_document_versions")
    .select("id, plaintext, version_number")
    .eq("document_id", doc.id)
    .eq("is_current", true)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const basePlaintext = curVer?.plaintext || "(empty)";
  const marker = `\n\n[DEBUG_PROVENANCE_WRITE ${new Date().toISOString()}]`;
  const newPlaintext = basePlaintext + marker;

  // Get project format for prefs snapshot
  const { data: proj } = await supabase.from("projects").select("format, assigned_lane").eq("id", project_id).single();
  const fmt = (proj?.format || "film").toLowerCase().replace(/_/g, "-");

  if (mode === "fail") {
    // Call createVersion WITHOUT inputsUsed — should throw PROVENANCE_MISSING
    try {
      await createVersion(supabase, {
        documentId: doc.id,
        docType: doc_type,
        plaintext: newPlaintext,
        label: "debug-provenance-fail",
        createdBy: doc.user_id || "debug",
        generatorId: "generate-document", // in SYSTEM_GENERATOR_IDS
        // NO inputsUsed → must throw
      });
      // If we get here, provenance gate did NOT fire
      return new Response(JSON.stringify({ error: "BUG: createVersion succeeded without inputsUsed — provenance gate not enforced" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      if (err.message?.includes("PROVENANCE_MISSING")) {
        return new Response(JSON.stringify({
          ok: true,
          mode: "fail",
          result: "PROVENANCE_MISSING correctly thrown",
          error_message: err.message,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: `Unexpected error: ${err.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // mode === "pass"
  try {
    const newVer = await createVersion(supabase, {
      documentId: doc.id,
      docType: doc_type,
      plaintext: newPlaintext,
      label: "debug-provenance-pass",
      createdBy: doc.user_id || "debug",
      generatorId: "generate-document",
      inputsUsed: {
        project_id,
        doc_type,
        generator_id: "generate-document",
        selected_template_key: "debug",
        resolved_prefs_snapshot: { format: fmt, lane: proj?.assigned_lane || "unknown", writing_voice: "default" },
        derived_from_doc_id: doc.id,
        derived_from_version_id: curVer?.id || null,
        source_document_ids: [doc.id],
      },
    });
    return new Response(JSON.stringify({
      ok: true,
      mode: "pass",
      new_version_id: newVer?.id || null,
      new_version_number: newVer?.version_number || null,
      document_id: doc.id,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `createVersion failed: ${err.message}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
