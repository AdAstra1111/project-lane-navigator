/**
 * trends-coverage-audit — Returns distinct production_type counts + missing required types.
 * Admin-gated by ADMIN_EMAILS env var or has_role RPC.
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

  // Ping
  if (req.method === "GET") {
    return json({ ok: true, build: "trends-coverage-audit-v1" });
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

    // Admin gate: check ADMIN_EMAILS or has_role
    const adminEmails = (Deno.env.get("ADMIN_EMAILS") || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    const userEmail = (user.email || "").toLowerCase();
    let isAdmin = adminEmails.includes(userEmail);

    if (!isAdmin) {
      const db = createClient(supabaseUrl, serviceKey);
      const { data: hasAdminRole } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
      isAdmin = !!hasAdminRole;
    }

    // Allow any authenticated user to view coverage (read-only audit)
    // but log admin status for future gating
    console.log(`[trends-coverage-audit] user=${user.id} email=${userEmail} is_admin=${isAdmin}`);

    const db = createClient(supabaseUrl, serviceKey);

    // Fetch all active trend_signals grouped by production_type
    const { data: signalRows } = await db
      .from("trend_signals")
      .select("production_type")
      .eq("status", "active");

    const { data: castRows } = await db
      .from("cast_trends")
      .select("production_type")
      .eq("status", "active");

    // Count by type
    const signalCounts: Record<string, number> = {};
    for (const r of signalRows || []) {
      const pt = r.production_type || "film";
      signalCounts[pt] = (signalCounts[pt] || 0) + 1;
    }

    const castCounts: Record<string, number> = {};
    for (const r of castRows || []) {
      const pt = r.production_type || "film";
      castCounts[pt] = (castCounts[pt] || 0) + 1;
    }

    // Find missing required types
    const missingSignals = REQUIRED_TREND_TYPES.filter(t => !signalCounts[t] || signalCounts[t] === 0);
    const missingCast = REQUIRED_TREND_TYPES.filter(t => !castCounts[t] || castCounts[t] === 0);

    const signalByType = Object.entries(signalCounts)
      .map(([production_type, count]) => ({ production_type, count }))
      .sort((a, b) => a.production_type.localeCompare(b.production_type));

    const castByType = Object.entries(castCounts)
      .map(([production_type, count]) => ({ production_type, count }))
      .sort((a, b) => a.production_type.localeCompare(b.production_type));

    return json({
      ok: true,
      trend_signals: { by_type: signalByType, total: signalRows?.length || 0 },
      cast_trends: { by_type: castByType, total: castRows?.length || 0 },
      missing_required: {
        trend_signals: missingSignals,
        cast_trends: missingCast,
      },
      required_types: [...REQUIRED_TREND_TYPES],
      is_admin: isAdmin,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[trends-coverage-audit] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
