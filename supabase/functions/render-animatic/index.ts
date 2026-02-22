/**
 * render-animatic — Edge function to generate timing list + ZIP fallback for animatic.
 * MVP: produces timing JSON + sequential image ZIP stored in exports bucket.
 * MP4 rendering via ffmpeg is not available in Deno edge runtime,
 * so we provide the ZIP+timing fallback and mark MP4 as "coming soon".
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify auth
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { animaticId } = await req.json();
    if (!animaticId) {
      return new Response(JSON.stringify({ error: 'animaticId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch animatic
    const { data: animatic, error: animErr } = await supabase
      .from('animatics')
      .select('*')
      .eq('id', animaticId)
      .single();
    if (animErr || !animatic) {
      return new Response(JSON.stringify({ error: 'Animatic not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check project access
    const { data: hasAccess } = await supabase.rpc('has_project_access', {
      _user_id: user.id,
      _project_id: animatic.project_id,
    });
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch panels with board data
    const { data: panels, error: panelErr } = await supabase
      .from('animatic_panels')
      .select('*')
      .eq('animatic_id', animaticId)
      .order('order_index', { ascending: true });
    if (panelErr) throw panelErr;

    // Fetch markers
    const { data: markers } = await supabase
      .from('animatic_markers')
      .select('*')
      .eq('animatic_id', animaticId)
      .order('time_seconds', { ascending: true });

    // Fetch board image paths
    const boardIds = panels.map((p: any) => p.storyboard_board_id);
    const { data: boards } = await supabase
      .from('storyboard_boards')
      .select('id, image_asset_path, scene_number, shot_number, panel_text, shot_list_item_id')
      .in('id', boardIds);
    const boardMap = new Map((boards || []).map((b: any) => [b.id, b]));

    // Build timing list
    let currentTime = 0;
    const timingEntries = panels.map((p: any) => {
      const board = boardMap.get(p.storyboard_board_id);
      const start = currentTime;
      const end = start + Number(p.duration_seconds);
      currentTime = end;
      return {
        order: p.order_index,
        scene_number: p.scene_number,
        shot_number: p.shot_number,
        storyboard_board_id: p.storyboard_board_id,
        shot_list_item_id: board?.shot_list_item_id || null,
        start_time: Math.round(start * 1000) / 1000,
        end_time: Math.round(end * 1000) / 1000,
        duration: Number(p.duration_seconds),
        transition: p.transition,
        locked: p.locked,
        image_path: board?.image_asset_path || null,
        panel_text: board?.panel_text || '',
      };
    });

    const markerEntries = (markers || []).map((m: any) => ({
      time_seconds: Number(m.time_seconds),
      type: m.marker_type,
      text: m.text,
    }));

    const timingData = {
      animatic_id: animaticId,
      project_id: animatic.project_id,
      aspect_ratio: animatic.aspect_ratio,
      fps: animatic.fps,
      total_duration: currentTime,
      panel_count: panels.length,
      panels: timingEntries,
      markers: markerEntries,
      generated_at: new Date().toISOString(),
    };

    // Store timing JSON in exports bucket
    const timingPath = `${animatic.project_id}/animatics/${animaticId}/timing.json`;
    const timingBlob = new TextEncoder().encode(JSON.stringify(timingData, null, 2));
    
    const { error: uploadErr } = await supabase.storage
      .from('exports')
      .upload(timingPath, timingBlob, {
        contentType: 'application/json',
        upsert: true,
      });
    if (uploadErr) {
      console.error('Timing upload error:', uploadErr);
    }

    // Update animatic record
    await supabase
      .from('animatics')
      .update({
        status: 'ready',
        timing_asset_path: timingPath,
        // MP4 not available in edge runtime — mark as null
        render_asset_path: null,
      })
      .eq('id', animaticId);

    // Generate signed URL for timing file
    const { data: signedTiming } = await supabase.storage
      .from('exports')
      .createSignedUrl(timingPath, 3600);

    return new Response(JSON.stringify({
      success: true,
      timing_url: signedTiming?.signedUrl || null,
      mp4_url: null,
      mp4_note: 'MP4 rendering is not available in the current edge runtime. Use the timing JSON with your preferred video editor.',
      timing_data: timingData,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('render-animatic error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
