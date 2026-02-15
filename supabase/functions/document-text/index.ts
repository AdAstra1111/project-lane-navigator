import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { documentId, versionId } = await req.json();
    if (!documentId && !versionId) {
      return new Response(JSON.stringify({ error: "documentId or versionId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let plaintext = "";
    let extracted_text = "";
    let doc_type = "";
    let version_number = 0;

    if (versionId) {
      const { data: ver } = await supabase.from("project_document_versions")
        .select("plaintext, version_number, document_id")
        .eq("id", versionId).single();
      if (ver) {
        plaintext = ver.plaintext || "";
        version_number = ver.version_number || 0;
        // Get doc_type from parent doc
        const { data: doc } = await supabase.from("project_documents")
          .select("doc_type, extracted_text").eq("id", ver.document_id).single();
        doc_type = doc?.doc_type || "";
        extracted_text = doc?.extracted_text || "";
      }
    } else if (documentId) {
      const { data: doc } = await supabase.from("project_documents")
        .select("doc_type, extracted_text, plaintext").eq("id", documentId).single();
      if (doc) {
        doc_type = doc.doc_type || "";
        extracted_text = doc.extracted_text || "";
        plaintext = doc.plaintext || "";
      }
      // Get latest version
      const { data: vers } = await supabase.from("project_document_versions")
        .select("id, plaintext, version_number").eq("document_id", documentId)
        .order("version_number", { ascending: false }).limit(1);
      if (vers?.[0]) {
        if (vers[0].plaintext) plaintext = vers[0].plaintext;
        version_number = vers[0].version_number;
      }
    }

    const text = plaintext || extracted_text || "";
    return new Response(JSON.stringify({ plaintext: text, extracted_text, doc_type, version_number, char_count: text.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
