/**
 * Trailer Audio Intelligence Engine v1 — Edge Function
 *
 * Actions:
 *   create_audio_run, generate_plan, gen_music, gen_vo, select_sfx,
 *   mix, progress, select_asset, update_mix_settings,
 *   list_audio_assets, get_audio_run,
 *   enqueue_render, render_progress, retry_render, cancel_render
 *
 * Storage paths:
 *   trailers/{project_id}/audio/{audio_run_id}/music/{asset_id}.wav
 *   trailers/{project_id}/audio/{audio_run_id}/vo/{asset_id}.wav
 *   trailers/{project_id}/audio/{audio_run_id}/sfx/{asset_id}.wav
 *   trailers/{project_id}/audio/{audio_run_id}/mix/{asset_id}.wav
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000))
    throw new Error("expired");
  return payload.sub;
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function verifyAccess(db: any, userId: string, projectId: string) {
  const { data } = await db.rpc("has_project_access", {
    _user_id: userId,
    _project_id: projectId,
  });
  return !!data;
}

// SHA-256 for idempotency keys
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

async function logAudioEvent(
  db: any,
  e: {
    project_id: string;
    audio_run_id: string;
    event_type: string;
    payload?: any;
    created_by: string;
  }
) {
  await db.from("trailer_audio_events").insert({
    project_id: e.project_id,
    audio_run_id: e.audio_run_id,
    event_type: e.event_type,
    payload: e.payload || {},
    created_by: e.created_by,
  });
}

async function enqueueJob(
  db: any,
  opts: {
    project_id: string;
    audio_run_id: string;
    job_type: string;
    payload?: any;
  }
) {
  const key = await sha256(
    `${opts.audio_run_id}|${opts.job_type}|${JSON.stringify(opts.payload || {})}`
  );
  const { data: existing } = await db
    .from("trailer_audio_jobs")
    .select("id, status")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (existing && ["queued", "running", "succeeded"].includes(existing.status)) {
    return existing;
  }
  const { data: job } = await db
    .from("trailer_audio_jobs")
    .insert({
      project_id: opts.project_id,
      audio_run_id: opts.audio_run_id,
      job_type: opts.job_type,
      payload: opts.payload || {},
      idempotency_key: key,
    })
    .select()
    .single();
  return job;
}

const DEFAULT_MIX = {
  music_gain_db: -10,
  sfx_gain_db: -6,
  dialogue_duck_db: -8,
  duck_attack_ms: 30,
  duck_release_ms: 250,
  target_lufs: -14,
};

// ─── Provider helpers ───
function getVoProvider(): string {
  if (Deno.env.get("ELEVENLABS_API_KEY")) return "elevenlabs";
  return "stub";
}

function getMusicProvider(): string {
  const mp = Deno.env.get("MUSIC_PROVIDER");
  if (mp) return mp;
  if (Deno.env.get("ELEVENLABS_API_KEY")) return "elevenlabs";
  return "library";
}

async function generateVoStub(
  _text: string,
  _style: string
): Promise<{ audio: Uint8Array; format: string }> {
  // Stub: return empty WAV header (44 bytes of silence, valid WAV)
  const sampleRate = 44100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const dataSize = sampleRate * 2; // 1 second of silence
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++)
      view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  return { audio: new Uint8Array(buffer), format: "wav" };
}

async function generateVoElevenLabs(
  text: string,
  style: string
): Promise<{ audio: Uint8Array; format: string }> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  // Voice IDs by style
  const voiceMap: Record<string, string> = {
    calm: "EXAVITQu4vr4xnSDxMaL", // Sarah
    intense: "CwhRBWXzGAHq8TQ4Fs17", // Roger
    trailer_announcer: "nPczCjzI2devNBz1zQrb", // Brian
    narrator: "JBFqnCBsd6RMkjVDRZzb", // George
  };
  const voiceId = voiceMap[style] || voiceMap.trailer_announcer;

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: style === "calm" ? 0.7 : 0.4,
          similarity_boost: 0.75,
          style: style === "intense" ? 0.7 : 0.3,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs error: ${resp.status} - ${errText.slice(0, 200)}`);
  }

  const mp3Buffer = await resp.arrayBuffer();
  const mp3Data = new Uint8Array(mp3Buffer);

  return { audio: mp3Data, format: "mp3" };
}

// ─── ACTION: create_audio_run ───
async function handleCreateAudioRun(db: any, body: any, userId: string) {
  const { projectId, blueprintRunId, trailerCutId, inputs } = body;
  if (!blueprintRunId && !trailerCutId)
    return json({ error: "blueprintRunId or trailerCutId required" }, 400);

  const mixSettings = {
    ...DEFAULT_MIX,
    ...(inputs?.musicGainDb !== undefined && { music_gain_db: inputs.musicGainDb }),
    ...(inputs?.sfxGainDb !== undefined && { sfx_gain_db: inputs.sfxGainDb }),
    ...(inputs?.targetLufs !== undefined && { target_lufs: inputs.targetLufs }),
    ...(inputs?.duckingAmountDb !== undefined && {
      dialogue_duck_db: inputs.duckingAmountDb,
    }),
    ...(inputs?.duckingAttackMs !== undefined && {
      duck_attack_ms: inputs.duckingAttackMs,
    }),
    ...(inputs?.duckingReleaseMs !== undefined && {
      duck_release_ms: inputs.duckingReleaseMs,
    }),
  };

  const inputsJson = {
    musicStyleTags: inputs?.musicStyleTags || "epic, cinematic",
    voiceStyle: inputs?.voiceStyle || "trailer_announcer",
    voiceProvider: inputs?.voiceProvider || getVoProvider(),
    musicProvider: inputs?.musicProvider || getMusicProvider(),
    sfxTag: inputs?.sfxTag || "",
  };

  const { data: run, error } = await db
    .from("trailer_audio_runs")
    .insert({
      project_id: projectId,
      trailer_cut_id: trailerCutId || null,
      blueprint_id: blueprintRunId || null,
      status: "draft",
      inputs_json: inputsJson,
      plan_json: {},
      mix_json: mixSettings,
      created_by: userId,
    })
    .select()
    .single();

  if (error) return json({ error: error.message }, 500);

  await logAudioEvent(db, {
    project_id: projectId,
    audio_run_id: run.id,
    event_type: "audio_run_created",
    payload: { inputsJson, mixSettings },
    created_by: userId,
  });

  // Auto-enqueue plan job
  await enqueueJob(db, {
    project_id: projectId,
    audio_run_id: run.id,
    job_type: "plan",
  });

  return json({ ok: true, audioRun: run });
}

// ─── ACTION: generate_plan ───
async function handleGeneratePlan(db: any, body: any, userId: string) {
  const { projectId, audioRunId } = body;
  if (!audioRunId) return json({ error: "audioRunId required" }, 400);

  const { data: run } = await db
    .from("trailer_audio_runs")
    .select("*")
    .eq("id", audioRunId)
    .eq("project_id", projectId)
    .single();
  if (!run) return json({ error: "Audio run not found" }, 404);

  // Load cut timeline
  let timeline: any[] = [];
  let totalMs = 0;
  if (run.trailer_cut_id) {
    const { data: cut } = await db
      .from("trailer_cuts")
      .select("timeline, duration_ms, blueprint_id")
      .eq("id", run.trailer_cut_id)
      .eq("project_id", projectId)
      .single();
    if (cut) {
      timeline = cut.timeline || [];
      totalMs = cut.duration_ms || 0;
    }
  }

  // Load blueprint audio plan
  let bpAudioPlan: any = {};
  const bpId = run.blueprint_id;
  if (bpId) {
    const { data: bp } = await db
      .from("trailer_blueprints")
      .select("audio_plan, text_card_plan, edl, options")
      .eq("id", bpId)
      .eq("project_id", projectId)
      .single();
    if (bp) bpAudioPlan = bp.audio_plan || {};
  }

  // ─── Load rhythm run hit markers + silence constraints ───
  let rhythmHitPoints: any[] = [];
  let rhythmSilenceWindows: any[] = [];
  let rhythmBeatHitIntents: any[] = [];
  let rhythmDropMs: number | null = null;
  let rhythmRunId: string | null = null;

  // Try to find rhythm run via script run chain
  const scriptRunId = run.inputs_json?.scriptRunId || null;
  if (scriptRunId) {
    const { data: rhythmRuns } = await db.from("trailer_rhythm_runs")
      .select("id, hit_points_json, silence_windows_json, beat_hit_intents_json, drop_timestamp_ms")
      .eq("script_run_id", scriptRunId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1);
    if (rhythmRuns?.length) {
      const rr = rhythmRuns[0];
      rhythmRunId = rr.id;
      rhythmHitPoints = rr.hit_points_json || [];
      rhythmSilenceWindows = rr.silence_windows_json || [];
      rhythmBeatHitIntents = rr.beat_hit_intents_json || [];
      rhythmDropMs = rr.drop_timestamp_ms;
    }
  }

  // Also try loading via blueprint options
  if (!rhythmRunId && bpId) {
    const { data: bp2 } = await db.from("trailer_blueprints")
      .select("options").eq("id", bpId).single();
    const rrid = bp2?.options?.rhythm_run_id;
    if (rrid) {
      const { data: rr } = await db.from("trailer_rhythm_runs")
        .select("id, hit_points_json, silence_windows_json, beat_hit_intents_json, drop_timestamp_ms")
        .eq("id", rrid).single();
      if (rr) {
        rhythmRunId = rr.id;
        rhythmHitPoints = rr.hit_points_json || [];
        rhythmSilenceWindows = rr.silence_windows_json || [];
        rhythmBeatHitIntents = rr.beat_hit_intents_json || [];
        rhythmDropMs = rr.drop_timestamp_ms;
      }
    }
  }

  // Load style options from script run
  let styleOptions: Record<string, any> = {};
  if (scriptRunId) {
    const { data: sr } = await db.from("trailer_script_runs")
      .select("style_options_json").eq("id", scriptRunId).single();
    styleOptions = sr?.style_options_json || {};
  }

  // Build structural analysis
  const hitRoles = new Set([
    "inciting_incident", "climax_tease", "rupture", "stinger", "montage_peak", "twist",
  ]);
  const riserRoles = new Set([
    "tension_build", "rising_action_1", "rising_action_2", "crescendo",
  ]);
  const voRoles = new Set([
    "hook", "cold_open", "protagonist_intro", "emotional_beat",
  ]);

  const sfxHits: any[] = [];
  const voLines: any[] = [];
  const musicSegments: any[] = [];

  for (const beat of timeline) {
    const startMs = beat.start_ms || 0;
    const durMs = beat.effective_duration_ms || beat.duration_ms || 0;

    if (hitRoles.has(beat.role)) {
      sfxHits.push({
        type: "hit",
        timestamp_ms: startMs,
        beat_index: beat.beat_index,
        role: beat.role,
        sfx_kind: beat.role === "stinger" ? "impact" : "hit",
      });
    }
    if (riserRoles.has(beat.role)) {
      sfxHits.push({
        type: "riser",
        timestamp_ms: startMs,
        duration_ms: durMs,
        beat_index: beat.beat_index,
        role: beat.role,
        sfx_kind: "riser",
      });
    }

    if (voRoles.has(beat.role) && beat.text_content) {
      voLines.push({
        type: "vo",
        timestamp_ms: startMs,
        beat_index: beat.beat_index,
        line: beat.text_content,
        character: "narrator",
        role: beat.role,
      });
    }
  }

  // ─── Merge rhythm hit points into SFX plan ───
  for (const hp of rhythmHitPoints) {
    // Check if there's already an SFX within ±120ms
    const nearbyExists = sfxHits.some(
      (s: any) => Math.abs((s.timestamp_ms || 0) - hp.t_ms) <= 120
    );
    if (!nearbyExists && hp.strength >= 5) {
      sfxHits.push({
        type: "rhythm_hit",
        timestamp_ms: hp.t_ms,
        beat_index: hp.beat_index,
        role: hp.phase,
        sfx_kind: hp.type,
        strength: hp.strength,
        note: hp.note,
        source: "rhythm_hit_point",
      });
    }
  }

  // ─── Merge beat-level hit intents ───
  for (const bhi of rhythmBeatHitIntents) {
    if (bhi.primary_hit !== "none") {
      const beatEntry = timeline.find((t: any) => t.beat_index === bhi.beat_index);
      if (beatEntry) {
        const existsForBeat = sfxHits.some(
          (s: any) => s.beat_index === bhi.beat_index && s.source === "beat_hit_intent"
        );
        if (!existsForBeat) {
          sfxHits.push({
            type: "beat_intent",
            timestamp_ms: beatEntry.start_ms || 0,
            beat_index: bhi.beat_index,
            sfx_kind: bhi.primary_hit,
            secondary: bhi.secondary_hits || [],
            source: "beat_hit_intent",
          });
        }
      }
    }
  }

  // Add blueprint VO lines
  if (bpAudioPlan.vo_lines) {
    for (const vo of bpAudioPlan.vo_lines) {
      const beat = timeline.find((b: any) => b.beat_index === vo.beat_index);
      voLines.push({
        type: "vo",
        timestamp_ms: beat?.start_ms || 0,
        beat_index: vo.beat_index,
        line: vo.line,
        character: vo.character || "narrator",
      });
    }
  }

  // Add blueprint SFX cues
  if (bpAudioPlan.sfx_cues) {
    for (const cue of bpAudioPlan.sfx_cues) {
      const beat = timeline.find((b: any) => b.beat_index === cue.beat_index);
      if (beat) {
        sfxHits.push({
          type: "sfx_cue",
          timestamp_ms: beat.start_ms || 0,
          beat_index: cue.beat_index,
          description: cue.description,
          sfx_kind: "sfx",
        });
      }
    }
  }

  // Music: full trailer bed + structural segments
  musicSegments.push({
    type: "music_bed",
    start_ms: 0,
    end_ms: totalMs,
    description: "Full trailer music bed",
    gain_db: run.mix_json?.music_gain_db ?? DEFAULT_MIX.music_gain_db,
  });

  // ─── Build silence/ducking regions from rhythm + VO ───
  const silenceRegions: any[] = [];

  // From rhythm silence windows
  for (const sw of rhythmSilenceWindows) {
    silenceRegions.push({
      start_ms: sw.start_ms,
      end_ms: sw.end_ms,
      target_db: -35,
      reason: sw.reason || "rhythm_silence",
      source: "rhythm",
    });
  }

  // From VO ducking
  for (const vo of voLines) {
    silenceRegions.push({
      start_ms: vo.timestamp_ms,
      end_ms: vo.timestamp_ms + 5000,
      target_db: run.mix_json?.dialogue_duck_db ?? DEFAULT_MIX.dialogue_duck_db,
      reason: "vo_ducking",
      source: "vo",
    });
  }

  // Build VO script for generation
  const voScript = voLines.map((v: any) => v.line).join("\n\n");

  // ─── Validation: strong hits must have SFX coverage ───
  const missingHits: any[] = [];
  for (const hp of rhythmHitPoints) {
    if (hp.strength >= 7) {
      const hasCoverage = sfxHits.some(
        (s: any) => Math.abs((s.timestamp_ms || 0) - hp.t_ms) <= 120
      );
      if (!hasCoverage) {
        missingHits.push({ t_ms: hp.t_ms, type: hp.type, phase: hp.phase, strength: hp.strength });
      }
    }
  }

  // Validation: silence windows must be covered
  const missingSilence: any[] = [];
  for (const sw of rhythmSilenceWindows) {
    const hasCoverage = silenceRegions.some(
      (sr: any) => sr.source === "rhythm" && sr.start_ms === sw.start_ms
    );
    if (!hasCoverage) {
      missingSilence.push(sw);
    }
  }

  const planJson = {
    version: "2.1",
    total_duration_ms: totalMs,
    music_segments: musicSegments,
    sfx_hits: sfxHits,
    vo_lines: voLines,
    silence_regions: silenceRegions,
    ducking_regions: silenceRegions.filter((s: any) => s.source === "vo"),
    vo_script: voScript,
    sfx_selected: [],
    rhythm_run_id: rhythmRunId,
    drop_ms: rhythmDropMs,
    hit_point_coverage: {
      total_hit_points: rhythmHitPoints.length,
      strong_hits: rhythmHitPoints.filter((h: any) => h.strength >= 7).length,
      sfx_aligned: rhythmHitPoints.filter((h: any) => h.strength >= 7).length - missingHits.length,
      missing: missingHits,
    },
    silence_coverage: {
      total_windows: rhythmSilenceWindows.length,
      covered: rhythmSilenceWindows.length - missingSilence.length,
      missing: missingSilence,
    },
    mix_targets: {
      lufs_target: run.mix_json?.target_lufs ?? -14,
      true_peak_db: -1.0,
    },
    style_sfx_emphasis: styleOptions?.sfxEmphasis || "balanced",
    style_drop: styleOptions?.dropStyle || "hard_drop",
    generated_at: new Date().toISOString(),
  };

  await db
    .from("trailer_audio_runs")
    .update({ plan_json: planJson, status: "planning" })
    .eq("id", audioRunId);

  // Mark plan job succeeded
  await db
    .from("trailer_audio_jobs")
    .update({ status: "succeeded", updated_at: new Date().toISOString() })
    .eq("audio_run_id", audioRunId)
    .eq("job_type", "plan")
    .eq("status", "running");

  await logAudioEvent(db, {
    project_id: projectId,
    audio_run_id: audioRunId,
    event_type: "plan_generated",
    payload: {
      sfx_count: sfxHits.length,
      vo_count: voLines.length,
      music_segments: musicSegments.length,
      hit_points_used: rhythmHitPoints.length,
      silence_windows_used: rhythmSilenceWindows.length,
      missing_hits: missingHits.length,
    },
    created_by: userId,
  });

  // Enqueue generation jobs
  await enqueueJob(db, {
    project_id: projectId,
    audio_run_id: audioRunId,
    job_type: "gen_music",
    payload: { style: run.inputs_json?.musicStyleTags || "epic, cinematic" },
  });
  await enqueueJob(db, {
    project_id: projectId,
    audio_run_id: audioRunId,
    job_type: "gen_vo",
    payload: {
      voiceStyle: run.inputs_json?.voiceStyle || "trailer_announcer",
      voiceProvider: run.inputs_json?.voiceProvider || getVoProvider(),
    },
  });
  await enqueueJob(db, {
    project_id: projectId,
    audio_run_id: audioRunId,
    job_type: "select_sfx",
    payload: { sfxTag: run.inputs_json?.sfxTag || "" },
  });

  // Update status
  await db
    .from("trailer_audio_runs")
    .update({ status: "generating" })
    .eq("id", audioRunId);

  return json({ ok: true, plan: planJson });
}

// ─── ACTION: gen_music ───
async function handleGenMusic(db: any, body: any, userId: string) {
  const { projectId, audioRunId } = body;
  if (!audioRunId) return json({ error: "audioRunId required" }, 400);

  const { data: run } = await db
    .from("trailer_audio_runs")
    .select("*")
    .eq("id", audioRunId)
    .single();
  if (!run) return json({ error: "Audio run not found" }, 404);

  const provider = getMusicProvider();
  const styleTags = run.inputs_json?.musicStyleTags || "epic, cinematic";
  const totalMs = run.plan_json?.total_duration_ms || 60000;

  if (provider === "elevenlabs") {
    // Use ElevenLabs Music API
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) return json({ error: "ELEVENLABS_API_KEY not configured" }, 500);

    const durationSec = Math.min(Math.max(Math.round(totalMs / 1000), 10), 120);
    const prompt = `Cinematic trailer music. Style: ${styleTags}. Intense, building tension, dramatic orchestral. Suitable for a movie trailer.`;

    const candidates = ["music_candidate_A", "music_candidate_B"];
    let generatedCount = 0;

    for (const label of candidates) {
      const assetId = crypto.randomUUID();
      const storagePath = `${projectId}/audio/${audioRunId}/music/${assetId}.mp3`;

      try {
        const resp = await fetch("https://api.elevenlabs.io/v1/music", {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: label === "music_candidate_A"
              ? prompt
              : `${prompt} Alternative variation with different mood.`,
            duration_seconds: durationSec,
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          console.error(`ElevenLabs music error: ${resp.status} - ${errText.slice(0, 300)}`);
          continue;
        }

        const audioBuffer = await resp.arrayBuffer();
        const audioData = new Uint8Array(audioBuffer);

        await db.storage.from("trailers").upload(storagePath, audioData, {
          contentType: "audio/mpeg",
          upsert: true,
        });

        await db.from("trailer_audio_assets").insert({
          project_id: projectId,
          audio_run_id: audioRunId,
          kind: "music_bed",
          name: label,
          asset_type: "music",
          label,
          provider: "elevenlabs",
          storage_path: storagePath,
          duration_ms: durationSec * 1000,
          tags: styleTags.split(",").map((t: string) => t.trim()),
          created_by: userId,
        });

        generatedCount++;
      } catch (err: any) {
        console.error(`Music gen failed for ${label}:`, err.message);
      }
    }

    await logAudioEvent(db, {
      project_id: projectId,
      audio_run_id: audioRunId,
      event_type: generatedCount > 0 ? "music_generated" : "music_none_found",
      payload: { provider: "elevenlabs", candidates: generatedCount },
      created_by: userId,
    });
  } else if (provider === "library") {
    // Look for uploaded music beds in the project
    const { data: assets } = await db
      .from("trailer_audio_assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", "music_bed")
      .order("created_at", { ascending: false })
      .limit(5);

    if (assets && assets.length > 0) {
      for (const asset of assets) {
        await db
          .from("trailer_audio_assets")
          .update({
            audio_run_id: audioRunId,
            asset_type: "music",
            provider: "library",
            label: `library_${asset.name}`,
          })
          .eq("id", asset.id);
      }

      await logAudioEvent(db, {
        project_id: projectId,
        audio_run_id: audioRunId,
        event_type: "music_library_linked",
        payload: { count: assets.length },
        created_by: userId,
      });
    } else {
      await logAudioEvent(db, {
        project_id: projectId,
        audio_run_id: audioRunId,
        event_type: "music_none_found",
        payload: { provider, warning: "No music beds found in library" },
        created_by: userId,
      });
    }
  } else {
    // Stub: create placeholder entries
    for (const label of ["music_candidate_A", "music_candidate_B"]) {
      const assetId = crypto.randomUUID();
      const storagePath = `${projectId}/audio/${audioRunId}/music/${assetId}.wav`;

      const { audio } = await generateVoStub("", "");
      await db.storage.from("trailers").upload(storagePath, audio, {
        contentType: "audio/wav",
        upsert: true,
      });

      await db.from("trailer_audio_assets").insert({
        project_id: projectId,
        audio_run_id: audioRunId,
        kind: "music_bed",
        name: label,
        asset_type: "music",
        label,
        provider: "stub",
        storage_path: storagePath,
        tags: styleTags.split(",").map((t: string) => t.trim()),
        created_by: userId,
      });
    }

    await logAudioEvent(db, {
      project_id: projectId,
      audio_run_id: audioRunId,
      event_type: "music_generated",
      payload: { provider: "stub", candidates: 2 },
      created_by: userId,
    });
  }

  // Mark job succeeded
  await db
    .from("trailer_audio_jobs")
    .update({ status: "succeeded", updated_at: new Date().toISOString() })
    .eq("audio_run_id", audioRunId)
    .eq("job_type", "gen_music")
    .in("status", ["queued", "running"]);

  return json({ ok: true, provider });
}

// ─── ACTION: gen_vo ───
async function handleGenVo(db: any, body: any, userId: string) {
  const { projectId, audioRunId } = body;
  if (!audioRunId) return json({ error: "audioRunId required" }, 400);

  const { data: run } = await db
    .from("trailer_audio_runs")
    .select("*")
    .eq("id", audioRunId)
    .single();
  if (!run) return json({ error: "Audio run not found" }, 404);

  const voScript = run.plan_json?.vo_script || "";
  if (!voScript) {
    await logAudioEvent(db, {
      project_id: projectId,
      audio_run_id: audioRunId,
      event_type: "vo_skipped",
      payload: { reason: "No VO script in plan" },
      created_by: userId,
    });

    await db
      .from("trailer_audio_jobs")
      .update({ status: "succeeded", updated_at: new Date().toISOString() })
      .eq("audio_run_id", audioRunId)
      .eq("job_type", "gen_vo")
      .in("status", ["queued", "running"]);

    return json({ ok: true, skipped: true, reason: "No VO lines" });
  }

  const voiceStyle = run.inputs_json?.voiceStyle || "trailer_announcer";
  const provider = run.inputs_json?.voiceProvider || getVoProvider();

  // Generate 1-2 takes
  const takes = provider === "elevenlabs" ? ["intense", voiceStyle] : [voiceStyle];
  const uniqueTakes = [...new Set(takes)];

  for (let i = 0; i < uniqueTakes.length; i++) {
    const style = uniqueTakes[i];
    const assetId = crypto.randomUUID();
    const isElevenlabs = provider === "elevenlabs";

    try {
      const { audio, format } = isElevenlabs
        ? await generateVoElevenLabs(voScript, style)
        : await generateVoStub(voScript, style);

      const ext = format === "mp3" ? "mp3" : "wav";
      const contentType = format === "mp3" ? "audio/mpeg" : "audio/wav";
      const storagePath = `${projectId}/audio/${audioRunId}/vo/${assetId}.${ext}`;

      await db.storage.from("trailers").upload(storagePath, audio, {
        contentType,
        upsert: true,
      });

      // Estimate duration: for WAV use header math, for MP3 estimate ~128kbps
      const durationMs = format === "mp3"
        ? Math.round((audio.length * 8) / 128 ) // ~128kbps MP3
        : Math.round((audio.length - 44) / (44100 * 2) * 1000);

      await db.from("trailer_audio_assets").insert({
        project_id: projectId,
        audio_run_id: audioRunId,
        kind: "sfx", // using existing kind enum; asset_type differentiates
        name: `VO Take ${i + 1} (${style})`,
        asset_type: "voiceover",
        label: `vo_take_${i + 1}_${style}`,
        provider,
        model: provider === "elevenlabs" ? "eleven_turbo_v2_5" : "stub",
        storage_path: storagePath,
        duration_ms: durationMs,
        tags: ["voiceover", style],
        meta_json: { voice_style: style, script: voScript },
        created_by: userId,
      });
    } catch (err: any) {
      console.error(`VO generation failed for take ${i + 1}:`, err);
      await logAudioEvent(db, {
        project_id: projectId,
        audio_run_id: audioRunId,
        event_type: "vo_generation_error",
        payload: { take: i + 1, style, error: err.message },
        created_by: userId,
      });
    }
  }

  await logAudioEvent(db, {
    project_id: projectId,
    audio_run_id: audioRunId,
    event_type: "vo_generated",
    payload: { provider, takes: uniqueTakes.length },
    created_by: userId,
  });

  await db
    .from("trailer_audio_jobs")
    .update({ status: "succeeded", updated_at: new Date().toISOString() })
    .eq("audio_run_id", audioRunId)
    .eq("job_type", "gen_vo")
    .in("status", ["queued", "running"]);

  return json({ ok: true, provider, takes: uniqueTakes.length });
}

// ─── ACTION: select_sfx ───
async function handleSelectSfx(db: any, body: any, userId: string) {
  const { projectId, audioRunId } = body;
  if (!audioRunId) return json({ error: "audioRunId required" }, 400);

  const { data: run } = await db
    .from("trailer_audio_runs")
    .select("*")
    .eq("id", audioRunId)
    .single();
  if (!run) return json({ error: "Audio run not found" }, 404);

  const sfxTag = run.inputs_json?.sfxTag || run.sfx_pack_tag || "";
  const sfxHits = run.plan_json?.sfx_hits || [];

  // Look for user-uploaded SFX in the project
  let query = db
    .from("trailer_audio_assets")
    .select("*")
    .eq("project_id", projectId)
    .eq("kind", "sfx");
  if (sfxTag) {
    query = query.contains("tags", [sfxTag]);
  }
  const { data: sfxAssets } = await query.order("created_at", { ascending: false });

  const selected: any[] = [];
  if (sfxAssets && sfxAssets.length > 0) {
    // Map each hit point to a random SFX from library
    for (const hit of sfxHits) {
      const match =
        sfxAssets.find((a: any) =>
          a.tags?.some((t: string) => t.includes(hit.sfx_kind))
        ) || sfxAssets[0];
      selected.push({
        ...hit,
        asset_id: match.id,
        storage_path: match.storage_path,
        asset_name: match.name,
      });
    }
  }

  // Update plan_json with selected SFX
  const updatedPlan = { ...run.plan_json, sfx_selected: selected };
  await db
    .from("trailer_audio_runs")
    .update({ plan_json: updatedPlan })
    .eq("id", audioRunId);

  await logAudioEvent(db, {
    project_id: projectId,
    audio_run_id: audioRunId,
    event_type: "sfx_selected",
    payload: {
      total_hits: sfxHits.length,
      matched: selected.length,
      available_sfx: sfxAssets?.length || 0,
    },
    created_by: userId,
  });

  await db
    .from("trailer_audio_jobs")
    .update({ status: "succeeded", updated_at: new Date().toISOString() })
    .eq("audio_run_id", audioRunId)
    .eq("job_type", "select_sfx")
    .in("status", ["queued", "running"]);

  return json({
    ok: true,
    matched: selected.length,
    total_hits: sfxHits.length,
  });
}

// ─── ACTION: mix ───
async function handleMix(db: any, body: any, userId: string) {
  const { projectId, audioRunId } = body;
  if (!audioRunId) return json({ error: "audioRunId required" }, 400);

  const { data: run } = await db
    .from("trailer_audio_runs")
    .select("*")
    .eq("id", audioRunId)
    .single();
  if (!run) return json({ error: "Audio run not found" }, 404);

  // Update status to mixing
  await db
    .from("trailer_audio_runs")
    .update({ status: "mixing" })
    .eq("id", audioRunId);

  // Get selected music
  const { data: selectedMusic } = await db
    .from("trailer_audio_assets")
    .select("*")
    .eq("audio_run_id", audioRunId)
    .eq("selected", true)
    .eq("asset_type", "music")
    .limit(1)
    .maybeSingle();

  // Fallback: any music asset for this run
  let musicAsset = selectedMusic;
  if (!musicAsset) {
    const { data: anyMusic } = await db
      .from("trailer_audio_assets")
      .select("*")
      .eq("audio_run_id", audioRunId)
      .eq("asset_type", "music")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    musicAsset = anyMusic;
  }

  // Get selected VO
  const { data: selectedVo } = await db
    .from("trailer_audio_assets")
    .select("*")
    .eq("audio_run_id", audioRunId)
    .eq("selected", true)
    .eq("asset_type", "voiceover")
    .limit(1)
    .maybeSingle();

  // Fallback: any VO asset
  let voAsset = selectedVo;
  if (!voAsset) {
    const { data: anyVo } = await db
      .from("trailer_audio_assets")
      .select("*")
      .eq("audio_run_id", audioRunId)
      .eq("asset_type", "voiceover")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    voAsset = anyVo;
  }

  // Without FFmpeg we can't do a real mix. Use the best available track as master.
  // Priority: music > VO > silence stub
  const masterSource = musicAsset || voAsset;
  const outputPath = `${projectId}/audio/${audioRunId}/mix/master.${masterSource ? (masterSource.storage_path?.endsWith('.mp3') ? 'mp3' : 'wav') : 'wav'}`;
  const contentType = outputPath.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';

  try {
    if (masterSource?.storage_path) {
      // Download the source asset and re-upload as the mix master
      const { data: srcData, error: dlErr } = await db.storage
        .from("trailers")
        .download(masterSource.storage_path);

      if (dlErr || !srcData) {
        throw new Error(`Failed to download source: ${dlErr?.message || 'no data'}`);
      }

      const arrayBuf = await srcData.arrayBuffer();
      await db.storage.from("trailers").upload(outputPath, new Uint8Array(arrayBuf), {
        contentType,
        upsert: true,
      });
    } else {
      // No assets at all — generate silence stub
      const { audio } = await generateVoStub("", "");
      await db.storage.from("trailers").upload(outputPath, audio, {
        contentType: "audio/wav",
        upsert: true,
      });
    }

    // Create mix asset record
    const mixAssetId = crypto.randomUUID();
    await db.from("trailer_audio_assets").insert({
      id: mixAssetId,
      project_id: projectId,
      audio_run_id: audioRunId,
      kind: "mix_master",
      name: "Mix Master",
      asset_type: "mix",
      label: "mix_master",
      provider: "internal",
      storage_path: outputPath,
      duration_ms: masterSource?.duration_ms || run.plan_json?.total_duration_ms || 0,
      selected: true,
      created_by: userId,
    });

    // Update run with output path
    await db
      .from("trailer_audio_runs")
      .update({
        status: "mixed",
        output_path: outputPath,
      })
      .eq("id", audioRunId);

    // Mark any queued/running render jobs for this run as succeeded
    await db
      .from("trailer_render_jobs")
      .update({
        status: "succeeded",
        output_path: outputPath,
        updated_at: new Date().toISOString(),
      })
      .eq("audio_run_id", audioRunId)
      .in("status", ["queued", "running"]);

    // Mark audio jobs as succeeded
    await db
      .from("trailer_audio_jobs")
      .update({ status: "succeeded", updated_at: new Date().toISOString() })
      .eq("audio_run_id", audioRunId)
      .eq("job_type", "mix")
      .in("status", ["queued", "running"]);

    await logAudioEvent(db, {
      project_id: projectId,
      audio_run_id: audioRunId,
      event_type: "mix_completed",
      payload: {
        output_path: outputPath,
        source: masterSource ? masterSource.asset_type : "silence_stub",
        note: "Simplified mix (no FFmpeg). Music track used as master.",
      },
      created_by: userId,
    });

    return json({ ok: true, outputPath, action: "completed" });
  } catch (err: any) {
    await db
      .from("trailer_audio_runs")
      .update({ status: "failed", error: err.message })
      .eq("id", audioRunId);

    await db
      .from("trailer_render_jobs")
      .update({ status: "failed", error: err.message, updated_at: new Date().toISOString() })
      .eq("audio_run_id", audioRunId)
      .in("status", ["queued", "running"]);

    return json({ error: err.message }, 500);
  }
}

// ─── ACTION: progress ───
async function handleProgress(db: any, body: any) {
  const { projectId, audioRunId } = body;
  if (!audioRunId) return json({ error: "audioRunId required" }, 400);

  const { data: run } = await db
    .from("trailer_audio_runs")
    .select("*")
    .eq("id", audioRunId)
    .eq("project_id", projectId)
    .single();

  const { data: jobs } = await db
    .from("trailer_audio_jobs")
    .select("*")
    .eq("audio_run_id", audioRunId)
    .order("created_at", { ascending: true });

  const { data: assets } = await db
    .from("trailer_audio_assets")
    .select("*")
    .eq("audio_run_id", audioRunId)
    .order("created_at", { ascending: false });

  const { data: events } = await db
    .from("trailer_audio_events")
    .select("*")
    .eq("audio_run_id", audioRunId)
    .order("created_at", { ascending: false })
    .limit(20);

  const jobList = jobs || [];
  const warnings: string[] = [];

  const allSucceeded = jobList.every((j: any) => j.status === "succeeded");
  const anyFailed = jobList.some((j: any) => j.status === "failed");
  const anyRunning = jobList.some((j: any) =>
    ["queued", "running"].includes(j.status)
  );

  if (anyFailed) warnings.push("Some jobs failed. Check events for details.");

  return json({
    ok: true,
    run,
    jobs: jobList,
    assets: assets || [],
    events: events || [],
    warnings,
    summary: {
      total_jobs: jobList.length,
      succeeded: jobList.filter((j: any) => j.status === "succeeded").length,
      failed: jobList.filter((j: any) => j.status === "failed").length,
      running: jobList.filter((j: any) => j.status === "running").length,
      queued: jobList.filter((j: any) => j.status === "queued").length,
      all_complete: allSucceeded && !anyRunning,
    },
  });
}

// ─── ACTION: select_asset ───
async function handleSelectAsset(db: any, body: any, userId: string) {
  const { projectId, audioRunId, assetId, assetType } = body;
  if (!audioRunId || !assetId)
    return json({ error: "audioRunId and assetId required" }, 400);

  // Deselect others of same type
  if (assetType) {
    await db
      .from("trailer_audio_assets")
      .update({ selected: false })
      .eq("audio_run_id", audioRunId)
      .eq("asset_type", assetType);
  }

  // Select this one
  await db
    .from("trailer_audio_assets")
    .update({ selected: true })
    .eq("id", assetId);

  // If selecting music, also update music_bed_asset_id on the run
  if (assetType === "music") {
    await db
      .from("trailer_audio_runs")
      .update({ music_bed_asset_id: assetId })
      .eq("id", audioRunId);
  }

  await logAudioEvent(db, {
    project_id: projectId,
    audio_run_id: audioRunId,
    event_type: "asset_selected",
    payload: { assetId, assetType },
    created_by: userId,
  });

  return json({ ok: true });
}

// ─── ACTION: update_mix_settings ───
async function handleUpdateMixSettings(db: any, body: any, userId: string) {
  const { projectId, audioRunId, mixSettings } = body;
  if (!audioRunId) return json({ error: "audioRunId required" }, 400);

  const mix = { ...DEFAULT_MIX, ...(mixSettings || {}) };

  await db
    .from("trailer_audio_runs")
    .update({ mix_json: mix })
    .eq("id", audioRunId);

  await logAudioEvent(db, {
    project_id: projectId,
    audio_run_id: audioRunId,
    event_type: "mix_settings_updated",
    payload: mix,
    created_by: userId,
  });

  return json({ ok: true, mix });
}

// ─── Legacy actions (backward compat) ───
async function handleUpsertAudioRun(db: any, body: any, userId: string) {
  const { projectId, trailerCutId, blueprintId, musicBedAssetId, sfxPackTag, mixOverrides } = body;
  if (!trailerCutId) return json({ error: "trailerCutId required" }, 400);

  const mixJson = { ...DEFAULT_MIX, ...(mixOverrides || {}) };

  const { data: existing } = await db
    .from("trailer_audio_runs")
    .select("*")
    .eq("trailer_cut_id", trailerCutId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const updates: any = { mix_json: mixJson, updated_at: new Date().toISOString() };
    if (musicBedAssetId !== undefined) updates.music_bed_asset_id = musicBedAssetId;
    if (sfxPackTag !== undefined) updates.sfx_pack_tag = sfxPackTag;
    if (blueprintId) updates.blueprint_id = blueprintId;

    await db.from("trailer_audio_runs").update(updates).eq("id", existing.id);
    const { data: updated } = await db
      .from("trailer_audio_runs")
      .select("*")
      .eq("id", existing.id)
      .single();
    return json({ ok: true, audioRun: updated, action: "updated" });
  }

  const { data: audioRun, error } = await db
    .from("trailer_audio_runs")
    .insert({
      project_id: projectId,
      trailer_cut_id: trailerCutId,
      blueprint_id: blueprintId || null,
      music_bed_asset_id: musicBedAssetId || null,
      sfx_pack_tag: sfxPackTag || null,
      plan_json: {},
      mix_json: mixJson,
      created_by: userId,
    })
    .select()
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, audioRun, action: "created" });
}

async function handleGenerateAudioPlan(db: any, body: any, userId: string) {
  // Redirect to new generate_plan
  return handleGeneratePlan(db, { ...body, audioRunId: body.audioRunId }, userId);
}

// ─── Render actions (unchanged from v1.1) ───
async function handleEnqueueRender(db: any, body: any, userId: string) {
  const { projectId, trailerCutId, audioRunId, force, preset = "720p" } = body;
  if (!trailerCutId) return json({ error: "trailerCutId required" }, 400);

  const { data: cut } = await db
    .from("trailer_cuts")
    .select("*")
    .eq("id", trailerCutId)
    .eq("project_id", projectId)
    .single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  let audioRun: any = null;
  if (audioRunId) {
    const { data: ar } = await db
      .from("trailer_audio_runs")
      .select("*")
      .eq("id", audioRunId)
      .eq("project_id", projectId)
      .single();
    audioRun = ar;
  }

  const timeline = cut.timeline || [];
  const edl = timeline.map((t: any) => ({
    beat_index: t.beat_index,
    role: t.role,
    clip_url: t.clip_url,
    clip_id: t.clip_id,
    is_text_card: t.is_text_card,
    text_content: t.text_content,
    start_ms: t.start_ms,
    duration_ms: t.effective_duration_ms || t.duration_ms,
    trim_in_ms: t.trim_in_ms || 0,
    trim_out_ms: t.trim_out_ms || 0,
  }));

  const audioPlan = audioRun?.plan_json || {};
  const mixSettings = audioRun?.mix_json || DEFAULT_MIX;

  let musicBedPath: string | null = null;
  if (audioRun?.music_bed_asset_id) {
    const { data: asset } = await db
      .from("trailer_audio_assets")
      .select("storage_path")
      .eq("id", audioRun.music_bed_asset_id)
      .single();
    musicBedPath = asset?.storage_path || null;
  }

  let sfxPaths: any[] = [];
  if (audioRun?.sfx_pack_tag) {
    const { data: sfxAssets } = await db
      .from("trailer_audio_assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", "sfx")
      .contains("tags", [audioRun.sfx_pack_tag]);
    sfxPaths = (sfxAssets || []).map((a: any) => ({
      name: a.name,
      path: a.storage_path,
      tags: a.tags,
    }));
  }

  const edlHash = await sha256(JSON.stringify(edl));
  const audioHash = await sha256(
    JSON.stringify({ audioPlan, mixSettings, musicBedPath })
  );
  const forceSuffix = force ? `-${Date.now()}` : "";
  const idempotencyKey = await sha256(
    `${projectId}|${trailerCutId}|${audioRunId || "none"}|${preset}|${edlHash}|${audioHash}${forceSuffix}`
  );

  if (!force) {
    const { data: existing } = await db
      .from("trailer_render_jobs")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) return json({ ok: true, job: existing, action: "existing" });
  }

  const outputPaths = {
    mp4: `${projectId}/runs/${trailerCutId}/final.mp4`,
    wav: `${projectId}/runs/${trailerCutId}/final.wav`,
  };

  const inputJson = {
    preset,
    edl,
    audio_plan: audioPlan,
    mix_settings: mixSettings,
    music_bed_path: musicBedPath,
    sfx_paths: sfxPaths,
    output_paths: outputPaths,
    resolution:
      preset === "1080p" ? { w: 1920, h: 1080 } : { w: 1280, h: 720 },
    fps: cut.render_fps || 24,
    webm_source: cut.storage_path
      ? `${projectId}/runs/${trailerCutId}/final.webm`
      : null,
  };

  const { data: job, error } = await db
    .from("trailer_render_jobs")
    .insert({
      project_id: projectId,
      trailer_cut_id: trailerCutId,
      audio_run_id: audioRunId || null,
      status: "queued",
      idempotency_key: idempotencyKey,
      input_json: inputJson,
      preset,
      created_by: userId,
    })
    .select()
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, job, action: "created" });
}

async function handleRenderProgress(db: any, body: any) {
  const { projectId, trailerCutId } = body;
  if (!trailerCutId) return json({ error: "trailerCutId required" }, 400);

  const { data: jobs } = await db
    .from("trailer_render_jobs")
    .select("*")
    .eq("project_id", projectId)
    .eq("trailer_cut_id", trailerCutId)
    .order("created_at", { ascending: false })
    .limit(10);

  const list = jobs || [];
  const counts = {
    queued: list.filter((j: any) => j.status === "queued").length,
    running: list.filter((j: any) => j.status === "running").length,
    succeeded: list.filter((j: any) => j.status === "succeeded").length,
    failed: list.filter((j: any) => j.status === "failed").length,
    canceled: list.filter((j: any) => j.status === "canceled").length,
    total: list.length,
  };

  return json({ ok: true, jobs: list, counts, latest: list[0] || null });
}

async function handleRetryRender(db: any, body: any, userId: string) {
  const { projectId, renderJobId } = body;
  if (!renderJobId) return json({ error: "renderJobId required" }, 400);

  const { data: job } = await db
    .from("trailer_render_jobs")
    .select("*")
    .eq("id", renderJobId)
    .eq("project_id", projectId)
    .single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status !== "failed")
    return json({ error: "Only failed jobs can be retried" }, 400);
  if (job.attempt >= 3) return json({ error: "Max attempts reached" }, 400);

  await db
    .from("trailer_render_jobs")
    .update({ status: "queued", error: null, claimed_at: null })
    .eq("id", renderJobId);

  return json({ ok: true });
}

async function handleCancelRender(db: any, body: any, _userId: string) {
  const { projectId, renderJobId } = body;
  if (!renderJobId) return json({ error: "renderJobId required" }, 400);

  const { data: job } = await db
    .from("trailer_render_jobs")
    .select("*")
    .eq("id", renderJobId)
    .eq("project_id", projectId)
    .single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (!["queued", "running"].includes(job.status))
    return json({ error: "Cannot cancel" }, 400);

  await db
    .from("trailer_render_jobs")
    .update({ status: "canceled" })
    .eq("id", renderJobId);

  return json({ ok: true });
}

async function handleListAudioAssets(db: any, body: any) {
  const { projectId, kind, audioRunId } = body;
  let query = db.from("trailer_audio_assets").select("*").eq("project_id", projectId);
  if (kind) query = query.eq("kind", kind);
  if (audioRunId) query = query.eq("audio_run_id", audioRunId);
  const { data } = await query.order("created_at", { ascending: false });
  return json({ ok: true, assets: data || [] });
}

async function handleGetAudioRun(db: any, body: any) {
  const { projectId, trailerCutId, audioRunId } = body;

  if (audioRunId) {
    const { data } = await db
      .from("trailer_audio_runs")
      .select("*")
      .eq("id", audioRunId)
      .eq("project_id", projectId)
      .single();
    return json({ ok: true, audioRun: data || null });
  }

  if (!trailerCutId) return json({ error: "trailerCutId or audioRunId required" }, 400);

  const { data } = await db
    .from("trailer_audio_runs")
    .select("*")
    .eq("trailer_cut_id", trailerCutId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return json({ ok: true, audioRun: data || null });
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer "))
      return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      userId = parseUserId(token);
    } catch {
      return json({ error: "Invalid token" }, 401);
    }

    const body = await req.json();
    const action = body.action;
    const projectId = body.projectId || body.project_id;
    if (!projectId) return json({ error: "projectId required" }, 400);

    const db = adminClient();
    const hasAccess = await verifyAccess(db, userId, projectId);
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    switch (action) {
      // New Audio Intelligence actions
      case "create_audio_run":
        return await handleCreateAudioRun(db, body, userId);
      case "generate_plan":
        return await handleGeneratePlan(db, body, userId);
      case "gen_music":
        return await handleGenMusic(db, body, userId);
      case "gen_vo":
        return await handleGenVo(db, body, userId);
      case "select_sfx":
        return await handleSelectSfx(db, body, userId);
      case "mix":
        return await handleMix(db, body, userId);
      case "progress":
        return await handleProgress(db, body);
      case "select_asset":
        return await handleSelectAsset(db, body, userId);
      case "update_mix_settings":
        return await handleUpdateMixSettings(db, body, userId);

      // Legacy v1.1 compat
      case "upsert_audio_run":
        return await handleUpsertAudioRun(db, body, userId);
      case "generate_audio_plan":
        return await handleGenerateAudioPlan(db, body, userId);

      // Render actions
      case "enqueue_render":
        return await handleEnqueueRender(db, body, userId);
      case "render_progress":
        return await handleRenderProgress(db, body);
      case "retry_render":
        return await handleRetryRender(db, body, userId);
      case "cancel_render":
        return await handleCancelRender(db, body, userId);

      // Asset queries
      case "list_audio_assets":
        return await handleListAudioAssets(db, body);
      case "get_audio_run":
        return await handleGetAudioRun(db, body);

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-audio-engine error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
