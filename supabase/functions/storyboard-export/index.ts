/**
 * storyboard-export — PDF contact sheet + ZIP export for Storyboard Pipeline.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const STORAGE_BUCKET = "storyboards";

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

function parseUserId(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1]));
  if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000)) throw new Error("expired");
  return payload.sub;
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function verifyAccess(db: any, userId: string, projectId: string): Promise<boolean> {
  const { data: proj } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).limit(1).maybeSingle();
  if (proj) return true;
  const { data: collab } = await db.from("project_collaborators").select("id").eq("project_id", projectId).eq("user_id", userId).eq("status", "accepted").limit(1).maybeSingle();
  return !!collab;
}

// ─── Shared: fetch panels + frames, compute meta ───
async function fetchRunData(db: any, projectId: string, runId: string) {
  const { data: project } = await db.from("projects").select("title").eq("id", projectId).single();
  const projectTitle = project?.title || "Untitled Project";

  const { data: run } = await db.from("storyboard_runs")
    .select("unit_keys, style_preset, aspect_ratio, created_at")
    .eq("id", runId).single();

  const { data: panels } = await db.from("storyboard_panels")
    .select("id, unit_key, panel_index, panel_payload, status")
    .eq("run_id", runId).eq("project_id", projectId)
    .order("unit_key", { ascending: true })
    .order("panel_index", { ascending: true });

  if (!panels || panels.length === 0) throw new Error("No panels found for this run");

  const panelIds = panels.map((p: any) => p.id);
  const { data: allFrames } = await db.from("storyboard_pipeline_frames")
    .select("id, panel_id, storage_path, public_url, status, created_at")
    .in("panel_id", panelIds)
    .eq("status", "generated")
    .order("created_at", { ascending: false });

  const frameMap: Record<string, any> = {};
  for (const f of (allFrames || [])) {
    if (!frameMap[f.panel_id]) frameMap[f.panel_id] = f;
  }

  const missingPanelIds = panels.filter((p: any) => !frameMap[p.id]).map((p: any) => p.id);
  const unitKeys = [...new Set(panels.map((p: any) => p.unit_key))];

  const meta = {
    frame_count: Object.keys(frameMap).length,
    panel_count: panels.length,
    unit_count: unitKeys.length,
    missing_count: missingPanelIds.length,
    missing_panel_ids: missingPanelIds,
    aspect_ratio: run?.aspect_ratio || null,
    style_preset: run?.style_preset || null,
    created_at: new Date().toISOString(),
  };

  return { projectTitle, run, panels, frameMap, meta, unitKeys };
}

// ─── PDF Contact Sheet ───
async function generatePdfContactSheet(db: any, projectId: string, runId: string, options: any) {
  const columns = options.columns || 3;
  const padding = options.padding || 18;
  const includeCaption = options.caption !== false;
  const includeFields = options.includeFields || ["unit_key", "panel_index", "shot_type", "camera", "lens", "action"];

  const { projectTitle, run, panels, frameMap } = await fetchRunData(db, projectId, runId);

  // A4 landscape
  const pageW = 841.89;
  const pageH = 595.28;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Title page
  const titlePage = pdfDoc.addPage([pageW, pageH]);
  const titleSize = 24;
  titlePage.drawText(projectTitle, { x: padding, y: pageH - padding - titleSize, font: fontBold, size: titleSize, color: rgb(0, 0, 0) });
  titlePage.drawText(`Storyboard Contact Sheet`, { x: padding, y: pageH - padding - titleSize - 30, font, size: 14, color: rgb(0.3, 0.3, 0.3) });
  titlePage.drawText(`Run: ${runId.slice(0, 8)} · Style: ${run?.style_preset || "—"} · Aspect: ${run?.aspect_ratio || "—"}`, {
    x: padding, y: pageH - padding - titleSize - 50, font, size: 10, color: rgb(0.5, 0.5, 0.5),
  });
  titlePage.drawText(`Generated: ${new Date().toISOString().split("T")[0]} · ${panels.length} panels`, {
    x: padding, y: pageH - padding - titleSize - 68, font, size: 10, color: rgb(0.5, 0.5, 0.5),
  });

  // Grid layout
  const cellW = (pageW - padding * 2 - (columns - 1) * 8) / columns;
  const imgAspect = run?.aspect_ratio === "9:16" ? 9 / 16 : run?.aspect_ratio === "1:1" ? 1 : run?.aspect_ratio === "2.39:1" ? 2.39 : 16 / 9;
  const cellImgH = cellW / imgAspect;
  const captionH = includeCaption ? 36 : 0;
  const cellH = cellImgH + captionH + 8;
  const rows = Math.floor((pageH - padding * 2) / (cellH + 8));

  let panelIdx = 0;
  while (panelIdx < panels.length) {
    const page = pdfDoc.addPage([pageW, pageH]);
    for (let row = 0; row < rows && panelIdx < panels.length; row++) {
      for (let col = 0; col < columns && panelIdx < panels.length; col++) {
        const panel = panels[panelIdx];
        panelIdx++;
        const x = padding + col * (cellW + 8);
        const yTop = pageH - padding - row * (cellH + 8);
        const frame = frameMap[panel.id];

        if (frame?.storage_path) {
          try {
            const { data: imgBytes } = await db.storage.from(STORAGE_BUCKET).download(frame.storage_path);
            if (imgBytes) {
              const arrBuf = await imgBytes.arrayBuffer();
              const uint8 = new Uint8Array(arrBuf);
              let img;
              if (frame.storage_path.endsWith(".jpg") || frame.storage_path.endsWith(".jpeg")) {
                img = await pdfDoc.embedJpg(uint8);
              } else {
                img = await pdfDoc.embedPng(uint8);
              }
              page.drawImage(img, { x, y: yTop - cellImgH, width: cellW, height: cellImgH });
            }
          } catch (e: any) {
            console.error("Failed to embed image:", e.message);
            page.drawRectangle({ x, y: yTop - cellImgH, width: cellW, height: cellImgH, color: rgb(0.9, 0.9, 0.9) });
            page.drawText("MISSING FRAME", { x: x + 10, y: yTop - cellImgH / 2, font, size: 8, color: rgb(0.6, 0.6, 0.6) });
          }
        } else {
          page.drawRectangle({ x, y: yTop - cellImgH, width: cellW, height: cellImgH, color: rgb(0.92, 0.92, 0.92) });
          page.drawText("MISSING FRAME", { x: x + 10, y: yTop - cellImgH / 2, font, size: 8, color: rgb(0.6, 0.6, 0.6) });
        }

        page.drawRectangle({ x, y: yTop - cellImgH, width: cellW, height: cellImgH, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });

        if (includeCaption) {
          const payload = panel.panel_payload || {};
          const parts: string[] = [];
          if (includeFields.includes("unit_key")) parts.push(panel.unit_key);
          if (includeFields.includes("panel_index")) parts.push(`#${panel.panel_index}`);
          if (includeFields.includes("shot_type")) parts.push(payload.shot_type || "");
          if (includeFields.includes("camera")) parts.push(payload.camera || "");
          if (includeFields.includes("lens")) parts.push(payload.lens || "");
          const line1 = parts.filter(Boolean).join(" · ");
          const line2 = includeFields.includes("action") ? (payload.action || "").slice(0, 80) : "";

          page.drawText(line1.slice(0, 80), { x, y: yTop - cellImgH - 12, font: fontBold, size: 6, color: rgb(0.2, 0.2, 0.2) });
          if (line2) {
            page.drawText(line2, { x, y: yTop - cellImgH - 22, font, size: 5.5, color: rgb(0.4, 0.4, 0.4) });
          }
        }
      }
    }
  }

  return await pdfDoc.save();
}

// ─── ZIP of Frames ───
async function generateZipFrames(db: any, projectId: string, runId: string) {
  const { zipSync, strToU8 } = await import("https://esm.sh/fflate@0.8.2");
  const { run, panels, frameMap, unitKeys } = await fetchRunData(db, projectId, runId);

  const zipData: Record<string, Uint8Array> = {};
  const manifestPanels: any[] = [];

  for (const panel of panels) {
    const frame = frameMap[panel.id];
    const payload = panel.panel_payload || {};
    const filename = `${panel.unit_key}__p${panel.panel_index}__${panel.id}.png`.replace(/[^a-zA-Z0-9_.\-]/g, "_");

    if (frame?.storage_path) {
      try {
        const { data: blob } = await db.storage.from(STORAGE_BUCKET).download(frame.storage_path);
        if (blob) {
          const arrBuf = await blob.arrayBuffer();
          zipData[filename] = new Uint8Array(arrBuf);
        }
      } catch (e: any) {
        console.error("Failed to download frame for ZIP:", e.message);
      }
    }

    manifestPanels.push({
      unit_key: panel.unit_key,
      panel_id: panel.id,
      panel_index: panel.panel_index,
      shot_type: payload.shot_type || null,
      camera: payload.camera || null,
      lens: payload.lens || null,
      mood: payload.mood || null,
      lighting: payload.lighting || null,
      prompt: payload.prompt || null,
      negative_prompt: payload.negative_prompt || null,
      frame_public_url: frame?.public_url || null,
      frame_storage_path: frame?.storage_path || null,
      created_at: frame?.created_at || null,
    });
  }

  zipData["manifest.json"] = strToU8(JSON.stringify({
    project_id: projectId,
    run_id: runId,
    generated_at: new Date().toISOString(),
    run: {
      style_preset: run?.style_preset || null,
      aspect_ratio: run?.aspect_ratio || null,
      unit_keys: unitKeys,
    },
    panels: manifestPanels,
  }, null, 2));

  const zipped = zipSync(zipData, { level: 6 });
  return zipped;
}

// ─── CREATE EXPORT ───
async function handleCreateExport(db: any, body: any, userId: string) {
  const { projectId, runId, exportType, options = {} } = body;
  if (!runId) return json({ error: "runId required" }, 400);
  if (!["pdf_contact_sheet", "zip_frames"].includes(exportType)) return json({ error: "Invalid exportType" }, 400);

  // Pre-check: gather meta for the export row
  const { meta } = await fetchRunData(db, projectId, runId);

  const timestamp = Date.now();
  const ext = exportType === "pdf_contact_sheet" ? "pdf" : "zip";

  // Create export row with status running
  const { data: exportRow, error: insertErr } = await db.from("storyboard_exports").insert({
    project_id: projectId,
    run_id: runId,
    export_type: exportType,
    status: "running",
    options,
    meta,
    created_by: userId,
  }).select().single();
  if (insertErr) return json({ error: "Failed to create export: " + insertErr.message }, 500);

  const exportId = exportRow.id;
  const storagePath = `${projectId}/storyboard-exports/${runId}/${exportType}_${timestamp}.${ext}`;

  try {
    let fileBytes: Uint8Array;
    let contentType: string;

    if (exportType === "pdf_contact_sheet") {
      fileBytes = await generatePdfContactSheet(db, projectId, runId, options);
      contentType = "application/pdf";
    } else {
      fileBytes = await generateZipFrames(db, projectId, runId);
      contentType = "application/zip";
    }

    const blob = new Blob([fileBytes], { type: contentType });
    const { error: uploadErr } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, { contentType, upsert: false });
    if (uploadErr) throw new Error("Upload failed: " + uploadErr.message);

    // Signed URL (7 days)
    const { data: signedData, error: signedErr } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    const publicUrl = signedData?.signedUrl || "";
    if (signedErr || !publicUrl) throw new Error("Failed to create signed URL");

    await db.from("storyboard_exports").update({
      status: "complete",
      storage_path: storagePath,
      public_url: publicUrl,
    }).eq("id", exportId);

    return json({ ok: true, exportId, publicUrl, meta });
  } catch (err: any) {
    console.error("Export generation error:", err);
    await db.from("storyboard_exports").update({ status: "failed", error: err.message }).eq("id", exportId);
    return json({ error: err.message }, 500);
  }
}

// ─── LIST EXPORTS ───
async function handleListExports(db: any, body: any) {
  const { projectId, runId } = body;
  let query = db.from("storyboard_exports").select("*").eq("project_id", projectId);
  if (runId) query = query.eq("run_id", runId);
  const { data } = await query.order("created_at", { ascending: false }).limit(50);
  return json({ exports: data || [] });
}

// ─── GET EXPORT ───
async function handleGetExport(db: any, body: any) {
  const { projectId, exportId } = body;
  if (!exportId) return json({ error: "exportId required" }, 400);
  const { data: row } = await db.from("storyboard_exports").select("*").eq("id", exportId).eq("project_id", projectId).single();
  if (!row) return json({ error: "Export not found" }, 404);

  // Regenerate signed URL if expired or missing
  let downloadUrl = row.public_url;
  if (row.storage_path && row.status === "complete") {
    const { data: signedData } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(row.storage_path, 60 * 60 * 24 * 7);
    if (signedData?.signedUrl) {
      downloadUrl = signedData.signedUrl;
      // Update stored URL
      await db.from("storyboard_exports").update({ public_url: downloadUrl }).eq("id", exportId);
    }
  }

  return json({ export: { ...row, public_url: downloadUrl } });
}

// ─── DELETE EXPORT ───
async function handleDeleteExport(db: any, body: any) {
  const { projectId, exportId } = body;
  if (!exportId) return json({ error: "exportId required" }, 400);
  const { data: row } = await db.from("storyboard_exports").select("storage_path").eq("id", exportId).eq("project_id", projectId).single();
  if (row?.storage_path) {
    await db.storage.from(STORAGE_BUCKET).remove([row.storage_path]);
  }
  await db.from("storyboard_exports").delete().eq("id", exportId).eq("project_id", projectId);
  return json({ ok: true });
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try { userId = parseUserId(token); } catch { return json({ error: "Invalid token" }, 401); }

    const body = await req.json();
    const action = body.action;
    const projectId = body.projectId || body.project_id;
    if (!projectId) return json({ error: "projectId required" }, 400);

    const db = adminClient();
    const hasAccess = await verifyAccess(db, userId, projectId);
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    switch (action) {
      case "create_export": return await handleCreateExport(db, body, userId);
      case "list_exports":
      case "get_exports": return await handleListExports(db, body);
      case "get_export": return await handleGetExport(db, body);
      case "delete_export": return await handleDeleteExport(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("storyboard-export error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
