import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// FNV-1a
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function escapeCSV(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { demo_run_id, project_id, mode } = body;

    if (!project_id) throw new Error("project_id required");

    // Resolve demo run
    let demoRun: any;
    if (demo_run_id) {
      const { data, error } = await supabase.from("demo_runs").select("*").eq("id", demo_run_id).single();
      if (error) throw error;
      demoRun = data;
    } else {
      const { data, error } = await supabase.from("demo_runs").select("*").eq("project_id", project_id).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      if (!data?.length) throw new Error("No demo runs found");
      demoRun = data[0];
    }

    const links = demoRun.links_json || {};
    const settings = demoRun.settings_json || {};
    const bundleId = fnv1a(JSON.stringify({ demoRunId: demoRun.id, settingsJson: settings, linksJson: links }));

    // Check existing bundle
    const { data: existingBundle } = await supabase.from("demo_bundles").select("*").eq("bundle_id", bundleId).limit(1);
    if (existingBundle?.length) {
      // Return existing
      const { data: urlData } = await supabase.storage.from("exports").createSignedUrl(existingBundle[0].storage_path, 3600);
      return new Response(JSON.stringify({ bundle_id: bundleId, url: urlData?.signedUrl, reused: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get project slug
    const { data: proj } = await supabase.from("projects").select("title").eq("id", project_id).single();
    const projectSlug = (proj?.title || "project").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

    // Fetch artifacts
    const zip = new JSZip();
    const manifestEntries: any[] = [];
    const now = new Date().toISOString();

    // 1) Quality run
    let qualityRunData: any = null;
    if (links.quality_run_id) {
      const { data: qr } = await supabase.from("cinematic_quality_runs").select("*").eq("id", links.quality_run_id).single();
      if (qr) {
        // Get attempt
        const { data: attempts } = await supabase.from("cinematic_quality_attempts").select("*").eq("run_id", qr.id).order("attempt_index", { ascending: false }).limit(1);
        qualityRunData = { run: qr, attempt: attempts?.[0] || null };
      }
    }
    const qrBytes = new TextEncoder().encode(JSON.stringify(qualityRunData || {}, null, 2));
    zip.file("quality_run.json", qrBytes);
    manifestEntries.push({ filename: "quality_run.json", type: "quality_gate", source_ids: { run_id: links.quality_run_id }, checksum: await sha256Hex(qrBytes), created_at: now });

    // 2) Video plan
    let planData: any = null;
    if (links.plan_id) {
      const { data: plan } = await supabase.from("video_generation_plans").select("plan_json, settings_json, lane, status").eq("id", links.plan_id).single();
      planData = plan;
    }
    const planBytes = new TextEncoder().encode(JSON.stringify(planData || {}, null, 2));
    zip.file("video_plan.json", planBytes);
    manifestEntries.push({ filename: "video_plan.json", type: "video_plan", source_ids: { plan_id: links.plan_id }, checksum: await sha256Hex(planBytes), created_at: now });

    // 3) Timeline (rough cut)
    let timelineData: any = null;
    if (links.rough_cut_id) {
      const { data: rc } = await supabase.from("rough_cuts").select("timeline_json, status, storage_path").eq("id", links.rough_cut_id).single();
      timelineData = rc;
    }
    const tlBytes = new TextEncoder().encode(JSON.stringify(timelineData?.timeline_json || {}, null, 2));
    zip.file("timeline.json", tlBytes);
    manifestEntries.push({ filename: "timeline.json", type: "timeline", source_ids: { rough_cut_id: links.rough_cut_id }, checksum: await sha256Hex(tlBytes), created_at: now });

    // 4) Rough cut mp4 or playlist
    if (timelineData?.storage_path) {
      const { data: fileData } = await supabase.storage.from("exports").download(timelineData.storage_path);
      if (fileData) {
        const mp4Bytes = new Uint8Array(await fileData.arrayBuffer());
        zip.file("rough_cut.mp4", mp4Bytes);
        manifestEntries.push({ filename: "rough_cut.mp4", type: "rough_cut_video", source_ids: { rough_cut_id: links.rough_cut_id }, checksum: await sha256Hex(mp4Bytes), created_at: now });
      }
    } else if (timelineData?.timeline_json) {
      const plBytes = new TextEncoder().encode(JSON.stringify(timelineData.timeline_json, null, 2));
      zip.file("rough_cut_playlist.json", plBytes);
      manifestEntries.push({ filename: "rough_cut_playlist.json", type: "rough_cut_playlist", source_ids: { rough_cut_id: links.rough_cut_id }, checksum: await sha256Hex(plBytes), created_at: now });
    }

    // 5) Quality history CSV (last 50)
    const { data: qHistory } = await supabase.from("cinematic_quality_runs").select("created_at, run_source, lane, final_pass, final_score, hard_failures, diagnostic_flags, adapter_mode, strictness_mode").eq("project_id", project_id).order("created_at", { ascending: false }).limit(50);

    const csvHeaders = ["created_at", "run_source", "lane", "pass", "final_score", "hard_failures_count", "diagnostics_count", "adapter_mode", "strictness_mode"];
    const csvRows = (qHistory || []).map((r: any) => [
      r.created_at, r.run_source, r.lane || "", r.final_pass ? "true" : "false",
      String(r.final_score), String((r.hard_failures || []).length), String((r.diagnostic_flags || []).length),
      r.adapter_mode || "", r.strictness_mode,
    ].map(escapeCSV).join(","));
    const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");
    const csvBytes = new TextEncoder().encode(csvContent);
    zip.file("quality_history.csv", csvBytes);
    manifestEntries.push({ filename: "quality_history.csv", type: "quality_history", source_ids: {}, checksum: await sha256Hex(csvBytes), created_at: now });

    // 6) Manifest
    const FIXED_ORDER = ["quality_run.json", "video_plan.json", "timeline.json", "rough_cut.mp4", "rough_cut_playlist.json", "quality_history.csv", "manifest.json", "README.txt"];
    const sortedEntries = [...manifestEntries].sort((a, b) => FIXED_ORDER.indexOf(a.filename) - FIXED_ORDER.indexOf(b.filename));

    // Add manifest entry for itself (checksum placeholder updated after)
    sortedEntries.push({ filename: "manifest.json", type: "manifest", source_ids: {}, checksum: "self", created_at: now });
    sortedEntries.push({ filename: "README.txt", type: "readme", source_ids: {}, checksum: "see_manifest", created_at: now });

    const manifest = { bundle_id: bundleId, created_at: now, files: sortedEntries };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    zip.file("manifest.json", manifestBytes);

    // 7) README
    const readmeLines = [
      "IFFY Demo Bundle", "=================", "",
      `Bundle ID: ${bundleId}`, `Created:   ${now}`, "", "Contents:", "",
    ];
    for (const f of sortedEntries) {
      readmeLines.push(`  ${f.filename}`);
      readmeLines.push(`    Type: ${f.type}`);
    }
    readmeLines.push("", "This bundle was generated deterministically.");
    const readmeBytes = new TextEncoder().encode(readmeLines.join("\n"));
    zip.file("README.txt", readmeBytes);

    // Generate ZIP
    const zipBlob = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });

    // Upload
    const shortId = demoRun.id.slice(0, 8);
    const storagePath = `demo_bundles/${project_id}/${bundleId}.zip`;

    const { error: uploadErr } = await supabase.storage.from("exports").upload(storagePath, zipBlob, {
      contentType: "application/zip", upsert: true,
    });
    if (uploadErr) throw uploadErr;

    // Record in demo_bundles
    await supabase.from("demo_bundles").insert({
      project_id, demo_run_id: demoRun.id, bundle_id: bundleId, storage_path: storagePath, manifest_json: manifest,
    });

    // Get signed URL
    const { data: urlData } = await supabase.storage.from("exports").createSignedUrl(storagePath, 3600);

    return new Response(JSON.stringify({
      bundle_id: bundleId,
      url: urlData?.signedUrl,
      storage_path: storagePath,
      reused: false,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
