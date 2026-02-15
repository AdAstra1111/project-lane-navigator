import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { projectId, format, genres, budgetRange, startDate, shootWeeks } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch scenes for the project
    const { data: scenes, error: scenesErr } = await supabase
      .from("project_scenes")
      .select("*")
      .eq("project_id", projectId)
      .order("scene_number", { ascending: true });

    if (scenesErr) throw scenesErr;
    if (!scenes || scenes.length === 0) {
      return new Response(JSON.stringify({ error: "No scenes found. Extract scenes from script first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build scene summary for AI
    const sceneSummary = scenes.map((s: any) => ({
      id: s.id,
      number: s.scene_number,
      heading: s.heading,
      location: s.location,
      int_ext: s.int_ext,
      time_of_day: s.time_of_day,
      page_count: s.page_count,
      cast: s.cast_members,
    }));

    const totalPages = scenes.reduce((sum: number, s: any) => sum + (s.page_count || 0), 0);

    const guardrails = buildGuardrailBlock({ productionType: format, engineName: "auto-schedule" });
    console.log(`[auto-schedule] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const systemPrompt = `You are an expert 1st Assistant Director creating an optimised production schedule. Given a list of scenes with locations, cast, page counts, and time of day, create an efficient shooting schedule.

${guardrails.textBlock}

Scheduling principles:
1. Group scenes by LOCATION first — minimise company moves
2. Within a location, group by INT/EXT and time of day (shoot all DAY scenes together, NIGHT scenes together)
3. Target 4-6 script pages per shoot day for standard production, adjust for budget range
4. Keep cast availability in mind — try to cluster scenes with the same cast
5. Place complex/VFX-heavy scenes early in the schedule when crew is fresh
6. Consider weather-dependent EXT scenes and schedule flexibility
7. A typical shoot day is 12 hours

Return a JSON object with:
- "shoot_days": array of objects, each with:
  - "day_number": integer starting at 1
  - "unit": "Main Unit" (or "2nd Unit" if needed)
  - "notes": brief 1-line note about the day's focus
  - "scene_ids": array of scene IDs in shooting order for that day
- "total_days": number
- "reasoning": 1-2 sentences explaining your scheduling strategy
- "warnings": array of strings for any scheduling concerns (e.g., "Night shoots on consecutive days", "Heavy page count on Day 3")

Return ONLY valid JSON, no markdown.`;

    const userContent = `Project metadata:
- Format: ${format || "film"}
- Genres: ${(genres || []).join(", ") || "unknown"}
- Budget range: ${budgetRange || "unknown"}
- Total pages: ${totalPages}
- Total scenes: ${scenes.length}
- Requested start date: ${startDate || "TBD"}
- Target shoot weeks: ${shootWeeks || "estimate needed"}

Scenes:
${JSON.stringify(sceneSummary, null, 2)}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices?.[0]?.message?.content || "{}";
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    let result: any;
    try {
      result = JSON.parse(content);
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse AI response", raw: content }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate scene IDs exist
    const validSceneIds = new Set(scenes.map((s: any) => s.id));
    const shootDays = (result.shoot_days || []).map((day: any, i: number) => ({
      day_number: day.day_number || i + 1,
      unit: day.unit || "Main Unit",
      notes: String(day.notes || "").slice(0, 500),
      scene_ids: (day.scene_ids || []).filter((id: string) => validSceneIds.has(id)),
    }));

    // Calculate start date
    const start = startDate ? new Date(startDate) : new Date(Date.now() + 30 * 86400000);

    // Delete existing shoot days and schedule for this project
    await supabase.from("scene_schedule").delete().eq("project_id", projectId);
    await supabase.from("shoot_days").delete().eq("project_id", projectId);

    // Insert shoot days — advance a running date, skipping weekends
    let totalScheduled = 0;
    const currentDate = new Date(start);
    // Skip to first weekday
    while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
    }

    for (const day of shootDays) {
      const dateStr = currentDate.toISOString().split("T")[0];

      const { data: newDay, error: dayErr } = await supabase.from("shoot_days").insert({
        project_id: projectId,
        user_id: user.id,
        shoot_date: dateStr,
        day_number: day.day_number,
        unit: day.unit,
        notes: day.notes,
      }).select().single();

      // Advance to next weekday
      currentDate.setDate(currentDate.getDate() + 1);
      while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
      }

      if (dayErr) {
        console.error("Error inserting shoot day:", dayErr);
        continue;
      }

      // Assign scenes to this day
      const assignments = day.scene_ids.map((sceneId: string, sortOrder: number) => ({
        project_id: projectId,
        user_id: user.id,
        scene_id: sceneId,
        shoot_day_id: newDay.id,
        sort_order: sortOrder,
        status: "planned",
      }));

      if (assignments.length > 0) {
        const { error: schedErr } = await supabase.from("scene_schedule").insert(assignments);
        if (schedErr) console.error("Error inserting schedule:", schedErr);
        else totalScheduled += assignments.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_days: shootDays.length,
        total_scheduled: totalScheduled,
        total_scenes: scenes.length,
        reasoning: String(result.reasoning || "").slice(0, 500),
        warnings: (result.warnings || []).map((w: any) => String(w).slice(0, 200)),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("auto-schedule error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
