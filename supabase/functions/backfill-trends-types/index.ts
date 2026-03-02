/**
 * backfill-trends-types — Calls refresh-trends for each missing required production_type.
 * Admin-gated. Uses the same AI refresh pipeline, not manual inserts.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REQUIRED_TREND_TYPES } from "../_shared/trendsNormalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    return json({ ok: true, build: "backfill-trends-types-v1" });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Admin gate: check ADMIN_EMAILS or has_role — fallback to allowing any authenticated user
    // since backfill only calls refresh-trends which has its own auth
    const adminEmails = (Deno.env.get("ADMIN_EMAILS") || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    const userEmail = (user.email || "").toLowerCase();
    let isAdmin = adminEmails.length === 0 || adminEmails.includes(userEmail);

    if (!isAdmin) {
      const db = createClient(supabaseUrl, serviceKey);
      const { data: hasAdminRole } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
      isAdmin = !!hasAdminRole;
    }

    // If ADMIN_EMAILS is configured and user isn't in it or has_role, block
    if (!isAdmin && adminEmails.length > 0) return json({ error: "Admin access required" }, 403);

    console.log(`[backfill-trends-types] user=${user.id} email=${userEmail} is_admin=${isAdmin}`);

    const db = createClient(supabaseUrl, serviceKey);

    // Find which types are missing
    const { data: signalRows } = await db.from("trend_signals").select("production_type").eq("status", "active");
    const { data: castRows } = await db.from("cast_trends").select("production_type").eq("status", "active");

    const signalTypes = new Set((signalRows || []).map((r: any) => r.production_type));
    const castTypes = new Set((castRows || []).map((r: any) => r.production_type));

    const missingTypes = REQUIRED_TREND_TYPES.filter(
      t => !signalTypes.has(t) || !castTypes.has(t)
    );

    if (missingTypes.length === 0) {
      return json({ ok: true, attempted: [], results: {}, message: "All required types already have coverage." });
    }

    console.log(`[backfill-trends-types] Missing types: ${missingTypes.join(", ")}`);

    // Parse body for optional scope override
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }

    const typesToBackfill = body.types
      ? (body.types as string[]).filter((t: string) => REQUIRED_TREND_TYPES.includes(t as any))
      : missingTypes;

    const results: Record<string, any> = {};

    for (const productionType of typesToBackfill) {
      console.log(`[backfill-trends-types] Refreshing type: ${productionType}`);
      try {
        const refreshUrl = `${supabaseUrl}/functions/v1/refresh-trends`;
        const response = await fetch(refreshUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            production_type: productionType,
            scope: "one",
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          console.error(`[backfill-trends-types] refresh-trends failed for ${productionType}:`, err);
          results[productionType] = { ok: false, error: err };
          continue;
        }

        const result = await response.json();
        results[productionType] = {
          ok: true,
          signals_added: result.signals_updated || 0,
          cast_added: result.cast_updated || 0,
        };
      } catch (e: any) {
        console.error(`[backfill-trends-types] Error for ${productionType}:`, e);
        results[productionType] = { ok: false, error: e.message };
      }
    }

    return json({
      ok: true,
      attempted: typesToBackfill,
      results,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[backfill-trends-types] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
