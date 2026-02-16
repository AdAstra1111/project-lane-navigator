import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * regenerate-stale-docs
 * 
 * Regenerates specified doc types by calling generate-document for each.
 * Used when canonical qualifications change and documents become stale.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { projectId, docTypes, mode = "draft" } = body;

    if (!projectId || !docTypes?.length) {
      return new Response(JSON.stringify({ error: "projectId and docTypes[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];
    const errors: any[] = [];

    // Process sequentially to respect upstream dependencies
    for (const docType of docTypes) {
      try {
        const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            projectId,
            docType,
            mode,
            generatorId: "regenerate-stale-docs",
          }),
        });
        const genData = await genRes.json();
        if (!genRes.ok) {
          errors.push({ docType, error: genData.error || genData.message || "Generation failed" });
        } else {
          results.push({ docType, ...genData });
        }
      } catch (e: any) {
        errors.push({ docType, error: e.message });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      regenerated: results,
      errors,
      total: docTypes.length,
      succeeded: results.length,
      failed: errors.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[regenerate-stale-docs] error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
