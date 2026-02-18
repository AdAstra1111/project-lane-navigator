/**
 * upsert-issues — Receives notes from a dev run and upserts them into project_issues.
 * Computes a stable fingerprint, preserves user-set statuses, logs events.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Deterministic fingerprint: doc_type|anchor|summary_trimmed|detail_120
async function computeFingerprint(
  docType: string,
  anchor: string | null,
  summary: string,
  detail: string,
): Promise<string> {
  const raw = [
    docType.toLowerCase(),
    (anchor || "").toLowerCase(),
    summary.trim().toLowerCase(),
    detail.slice(0, 120).toLowerCase(),
  ].join("|");
  // Use Web Crypto for SHA-256
  const msgBuffer = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify JWT with anon client
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { project_id, doc_type, doc_version_id, run_id, notes } = body as {
      project_id: string;
      doc_type: string;
      doc_version_id?: string;
      run_id?: string;
      notes: Array<{
        category: string;
        severity: number;
        anchor?: string;
        summary: string;
        detail: string;
        evidence_snippet?: string;
      }>;
    };

    if (!project_id || !doc_type || !Array.isArray(notes)) {
      return json({ error: "Missing required fields: project_id, doc_type, notes" }, 400);
    }

    const db = createClient(supabaseUrl, serviceKey);

    // Verify project access
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: user.id,
      _project_id: project_id,
    });
    if (!hasAccess) return json({ error: "Access denied" }, 403);

    const upserted: string[] = [];
    const events: Array<{ issue_id: string; event_type: string; payload?: any }> = [];

    for (const note of notes) {
      const fp = await computeFingerprint(
        doc_type,
        note.anchor || null,
        note.summary,
        note.detail,
      );

      // Check if already exists
      const { data: existing } = await db
        .from("project_issues")
        .select("id, status")
        .eq("project_id", project_id)
        .eq("fingerprint", fp)
        .maybeSingle();

      if (existing) {
        // Update metadata but preserve user-set status
        const userFinalStatuses = ["resolved", "dismissed"];
        const updateData: any = {
          summary: note.summary,
          detail: note.detail,
          evidence_snippet: note.evidence_snippet || null,
          last_seen_run_id: run_id || null,
          anchor: note.anchor || null,
          severity: note.severity ?? 3,
        };
        // Only update doc_version_id if this is a newer run
        if (doc_version_id) updateData.doc_version_id = doc_version_id;

        await db.from("project_issues").update(updateData).eq("id", existing.id);

        events.push({
          issue_id: existing.id,
          event_type: "seen",
          payload: { run_id, status_preserved: existing.status },
        });
        upserted.push(existing.id);
      } else {
        // Insert new issue
        const { data: newIssue, error: insertError } = await db
          .from("project_issues")
          .insert({
            project_id,
            doc_type,
            doc_version_id: doc_version_id || null,
            anchor: note.anchor || null,
            category: note.category,
            severity: note.severity ?? 3,
            status: "open",
            summary: note.summary,
            detail: note.detail,
            evidence_snippet: note.evidence_snippet || null,
            fingerprint: fp,
            created_from_run_id: run_id || null,
            last_seen_run_id: run_id || null,
            resolution_mode: "staged",
          })
          .select("id")
          .single();

        if (insertError) {
          console.error("Insert error:", insertError);
          continue;
        }

        events.push({
          issue_id: newIssue.id,
          event_type: "created",
          payload: { run_id },
        });
        upserted.push(newIssue.id);
      }
    }

    // Batch-insert events
    if (events.length > 0) {
      await db.from("project_issue_events").insert(events);
    }

    return json({ ok: true, upserted_count: upserted.length, issue_ids: upserted });
  } catch (err: any) {
    console.error("upsert-issues error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
