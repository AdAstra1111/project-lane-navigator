/**
 * generate-shot-list — Parses a script into scenes and generates shot breakdowns.
 * Supports actions: "generate", "regenerate"
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SHOT_TYPES = ['WS', 'MS', 'CU', 'ECU', 'OTS', 'POV', 'INSERT', '2SHOT', 'AERIAL', 'TRACKING'];

interface ParsedScene {
  scene_number: string;
  heading: string;
  location: string;
  time_of_day: string;
  body: string;
}

function parseScriptIntoScenes(text: string): ParsedScene[] {
  const lines = text.split('\n');
  const scenes: ParsedScene[] = [];
  let current: ParsedScene | null = null;
  let bodyLines: string[] = [];
  let sceneIdx = 0;

  const headingRe = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*(.+?)(?:\s*[-–—]\s*(DAY|NIGHT|DAWN|DUSK|MORNING|EVENING|CONTINUOUS|LATER|SAME))?$/i;
  const separatorRe = /^={3,}\s*EPISODE\s/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (separatorRe.test(trimmed)) continue;

    const match = trimmed.match(headingRe);
    if (match) {
      if (current) {
        current.body = bodyLines.join('\n').trim();
        scenes.push(current);
      }
      sceneIdx++;
      const location = match[2]?.trim() || '';
      const tod = match[3]?.trim() || '';
      current = {
        scene_number: String(sceneIdx),
        heading: trimmed,
        location,
        time_of_day: tod,
        body: '',
      };
      bodyLines = [];
    } else if (current) {
      bodyLines.push(line);
    }
  }

  if (current) {
    current.body = bodyLines.join('\n').trim();
    scenes.push(current);
  }

  // Fallback: if no scenes parsed, treat whole script as one scene
  if (scenes.length === 0 && text.trim().length > 0) {
    scenes.push({
      scene_number: '1',
      heading: 'SCENE 1',
      location: '',
      time_of_day: '',
      body: text.trim(),
    });
  }

  return scenes;
}

function extractCharacters(body: string): string[] {
  const chars = new Set<string>();
  const charLineRe = /^([A-Z][A-Z\s.'-]{1,30})(?:\s*\(.*\))?\s*$/gm;
  let m;
  while ((m = charLineRe.exec(body)) !== null) {
    const name = m[1].trim();
    if (name.length > 1 && name.length < 30 && !['INT', 'EXT', 'CUT TO', 'FADE', 'DISSOLVE', 'CONTINUED', 'CONT'].includes(name)) {
      chars.add(name);
    }
  }
  return Array.from(chars);
}

interface GeneratedShot {
  shot_number: number;
  shot_type: string;
  framing: string;
  action: string;
  camera_movement: string;
  duration_est_seconds: number;
  characters_present: string[];
  props_or_set_notes: string;
  audio_notes: string;
}

function generateShotsForScene(scene: ParsedScene, isVerticalDrama: boolean): GeneratedShot[] {
  const shots: GeneratedShot[] = [];
  const characters = extractCharacters(scene.body);
  const sentences = scene.body.split(/[.!?]+/).filter(s => s.trim().length > 10);
  let shotNum = 0;

  // Establishing shot
  shotNum++;
  shots.push({
    shot_number: shotNum,
    shot_type: isVerticalDrama ? 'MS' : 'WS',
    framing: isVerticalDrama ? '9:16 vertical frame' : 'Wide establishing',
    action: `Establish ${scene.location || scene.heading}`,
    camera_movement: 'STATIC',
    duration_est_seconds: isVerticalDrama ? 2 : 4,
    characters_present: [],
    props_or_set_notes: '',
    audio_notes: 'Ambient / location sound',
  });

  // Generate shots from action/dialogue blocks
  const blocks = scene.body.split(/\n\n+/).filter(b => b.trim().length > 5);
  for (const block of blocks) {
    const trimBlock = block.trim();
    if (trimBlock.length < 10) continue;

    // Check if it's dialogue
    const isDialogue = /^[A-Z][A-Z\s.'-]+\s*(\(.*\))?\s*\n/.test(trimBlock);
    
    if (isDialogue) {
      const charMatch = trimBlock.match(/^([A-Z][A-Z\s.'-]+)/);
      const charName = charMatch ? charMatch[1].trim() : '';
      shotNum++;
      shots.push({
        shot_number: shotNum,
        shot_type: isVerticalDrama ? 'CU' : 'MS',
        framing: isVerticalDrama ? 'Tight CU, 9:16' : 'Medium on speaker',
        action: `${charName} delivers dialogue`,
        camera_movement: 'STATIC',
        duration_est_seconds: isVerticalDrama ? 3 : 5,
        characters_present: charName ? [charName] : characters.slice(0, 2),
        props_or_set_notes: '',
        audio_notes: 'Dialogue',
      });

      // Reaction shot if multiple characters
      if (characters.length > 1) {
        shotNum++;
        const reactor = characters.find(c => c !== charName) || characters[0];
        shots.push({
          shot_number: shotNum,
          shot_type: isVerticalDrama ? 'CU' : 'OTS',
          framing: isVerticalDrama ? 'Reaction CU, 9:16' : 'Over-the-shoulder reaction',
          action: `${reactor} reacts`,
          camera_movement: 'STATIC',
          duration_est_seconds: isVerticalDrama ? 2 : 3,
          characters_present: [reactor],
          props_or_set_notes: '',
          audio_notes: '',
        });
      }
    } else {
      // Action block
      shotNum++;
      const hasMovement = /walk|run|move|enter|exit|chase|drive|follow/i.test(trimBlock);
      shots.push({
        shot_number: shotNum,
        shot_type: hasMovement ? 'TRACKING' : (isVerticalDrama ? 'MS' : 'WS'),
        framing: hasMovement ? 'Following action' : (isVerticalDrama ? 'Medium 9:16' : 'Wide coverage'),
        action: trimBlock.slice(0, 100),
        camera_movement: hasMovement ? 'TRACKING' : 'STATIC',
        duration_est_seconds: isVerticalDrama ? 3 : 5,
        characters_present: characters.slice(0, 3),
        props_or_set_notes: '',
        audio_notes: hasMovement ? 'Movement SFX' : '',
      });
    }

    // Cap shots per scene for vertical drama
    if (isVerticalDrama && shots.length >= 8) break;
    if (!isVerticalDrama && shots.length >= 15) break;
  }

  // Ensure at least 2 shots per scene
  if (shots.length < 2) {
    shotNum++;
    shots.push({
      shot_number: shotNum,
      shot_type: 'CU',
      framing: isVerticalDrama ? 'Close-up 9:16' : 'Close-up detail',
      action: 'Key moment / detail shot',
      camera_movement: 'STATIC',
      duration_est_seconds: 3,
      characters_present: characters.slice(0, 1),
      props_or_set_notes: '',
      audio_notes: '',
    });
  }

  return shots;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action = 'generate' } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    if (action === 'generate') {
      const { projectId, sourceDocumentId, sourceVersionId, episodeNumber, scope, name, userId, isVerticalDrama = false } = body;

      // Fetch script content
      const { data: version, error: verErr } = await sb
        .from('project_document_versions')
        .select('plaintext')
        .eq('id', sourceVersionId)
        .single();

      if (verErr || !version?.plaintext) {
        return new Response(JSON.stringify({ error: 'Script version not found or empty' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Parse scenes
      const scenes = parseScriptIntoScenes(version.plaintext);

      // Apply scene range filter if scope specifies it
      let filteredScenes = scenes;
      const scopeObj = scope || { mode: 'full' };
      if (scopeObj.mode === 'scene_range' && scopeObj.from_scene && scopeObj.to_scene) {
        const from = Number(scopeObj.from_scene);
        const to = Number(scopeObj.to_scene);
        filteredScenes = scenes.filter(s => {
          const n = parseInt(s.scene_number);
          return !isNaN(n) && n >= from && n <= to;
        });
      }

      // Create shot_list record
      const { data: shotList, error: slErr } = await sb
        .from('shot_lists')
        .insert({
          project_id: projectId,
          name: name || `Shot List${episodeNumber ? ` — EP ${episodeNumber}` : ''}`,
          source_document_id: sourceDocumentId,
          source_version_id: sourceVersionId,
          episode_number: episodeNumber || null,
          scope: scopeObj,
          status: 'generated',
          created_by: userId,
        })
        .select()
        .single();

      if (slErr) {
        return new Response(JSON.stringify({ error: 'Failed to create shot list: ' + slErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate shots for each scene
      const allItems: any[] = [];
      let orderIdx = 0;

      for (const scene of filteredScenes) {
        const shots = generateShotsForScene(scene, isVerticalDrama);
        for (const shot of shots) {
          allItems.push({
            shot_list_id: shotList.id,
            project_id: projectId,
            scene_number: scene.scene_number,
            scene_heading: scene.heading,
            shot_number: shot.shot_number,
            shot_type: shot.shot_type,
            framing: shot.framing,
            action: shot.action,
            camera_movement: shot.camera_movement,
            duration_est_seconds: shot.duration_est_seconds,
            location: scene.location || null,
            time_of_day: scene.time_of_day || null,
            characters_present: shot.characters_present,
            props_or_set_notes: shot.props_or_set_notes || null,
            audio_notes: shot.audio_notes || null,
            locked: false,
            order_index: orderIdx++,
            anchor_ref: { scene_number: scene.scene_number },
          });
        }
      }

      // Batch insert items
      if (allItems.length > 0) {
        const { error: itemErr } = await sb
          .from('shot_list_items')
          .insert(allItems);
        if (itemErr) {
          console.error('Item insert error:', itemErr);
        }
      }

      return new Response(JSON.stringify({
        shot_list_id: shotList.id,
        count: allItems.length,
        scenes_parsed: filteredScenes.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'regenerate') {
      const { shotListId, scope: regenScope, userId, isVerticalDrama = false } = body;

      // Fetch shot list
      const { data: shotList } = await sb
        .from('shot_lists')
        .select('*')
        .eq('id', shotListId)
        .single();

      if (!shotList) {
        return new Response(JSON.stringify({ error: 'Shot list not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch current script
      const { data: version } = await sb
        .from('project_document_versions')
        .select('plaintext')
        .eq('id', shotList.source_version_id)
        .single();

      if (!version?.plaintext) {
        return new Response(JSON.stringify({ error: 'Script not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const scenes = parseScriptIntoScenes(version.plaintext);
      const rScope = regenScope || {};
      const targetScenes = rScope.scene_numbers || scenes.map((s: ParsedScene) => s.scene_number);

      // Get existing locked items for target scenes
      const { data: existingItems } = await sb
        .from('shot_list_items')
        .select('*')
        .eq('shot_list_id', shotListId)
        .in('scene_number', targetScenes);

      const lockedItems = (existingItems || []).filter((i: any) => i.locked);
      const lockedSceneShots = new Map<string, any[]>();
      for (const li of lockedItems) {
        const arr = lockedSceneShots.get(li.scene_number) || [];
        arr.push(li);
        lockedSceneShots.set(li.scene_number, arr);
      }

      // Delete unlocked items for target scenes
      if (rScope.shot_ids?.length) {
        await sb.from('shot_list_items')
          .delete()
          .eq('shot_list_id', shotListId)
          .in('id', rScope.shot_ids)
          .eq('locked', false);
      } else {
        await sb.from('shot_list_items')
          .delete()
          .eq('shot_list_id', shotListId)
          .in('scene_number', targetScenes)
          .eq('locked', false);
      }

      // Get max order_index
      const { data: maxOrder } = await sb
        .from('shot_list_items')
        .select('order_index')
        .eq('shot_list_id', shotListId)
        .order('order_index', { ascending: false })
        .limit(1);

      let orderIdx = (maxOrder?.[0]?.order_index || 0) + 1;

      // Regenerate for target scenes
      const newItems: any[] = [];
      for (const sceneNum of targetScenes) {
        const scene = scenes.find((s: ParsedScene) => s.scene_number === sceneNum);
        if (!scene) continue;

        const locked = lockedSceneShots.get(sceneNum) || [];
        const lockedNums = new Set(locked.map((l: any) => l.shot_number));

        const shots = generateShotsForScene(scene, isVerticalDrama);
        for (const shot of shots) {
          if (lockedNums.has(shot.shot_number)) continue;
          newItems.push({
            shot_list_id: shotListId,
            project_id: shotList.project_id,
            scene_number: scene.scene_number,
            scene_heading: scene.heading,
            shot_number: shot.shot_number,
            shot_type: shot.shot_type,
            framing: shot.framing,
            action: shot.action,
            camera_movement: shot.camera_movement,
            duration_est_seconds: shot.duration_est_seconds,
            location: scene.location || null,
            time_of_day: scene.time_of_day || null,
            characters_present: shot.characters_present,
            locked: false,
            order_index: orderIdx++,
            anchor_ref: { scene_number: scene.scene_number },
          });
        }
      }

      if (newItems.length > 0) {
        await sb.from('shot_list_items').insert(newItems);
      }

      // Log regen
      await sb.from('shot_list_regens').insert({
        shot_list_id: shotListId,
        source_version_id: shotList.source_version_id,
        regen_scope: regenScope || {},
        created_by: userId,
        summary: `Regenerated ${newItems.length} shots across ${targetScenes.length} scenes (${lockedItems.length} locked preserved)`,
      });

      // Update status
      await sb.from('shot_lists').update({ status: 'generated' }).eq('id', shotListId);

      return new Response(JSON.stringify({
        regenerated: newItems.length,
        locked_preserved: lockedItems.length,
        scenes_affected: targetScenes.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
