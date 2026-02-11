const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('TMDB_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'TMDB_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { name, mode } = await req.json();
    if (!name) {
      return new Response(
        JSON.stringify({ error: 'name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Search for person(s)
    const searchRes = await fetch(
      `https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(name)}&include_adult=false&language=en-US&page=1`,
      { headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' } }
    );
    const searchData = await searchRes.json();
    
    if (!searchData.results || searchData.results.length === 0) {
      return new Response(
        JSON.stringify(mode === 'search' ? { results: [] } : { found: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If mode=search, return top 8 results with basic info (no detailed fetch)
    if (mode === 'search') {
      const results = searchData.results.slice(0, 8).map((p: any) => ({
        tmdb_id: p.id,
        name: p.name,
        known_for_department: p.known_for_department || '',
        profile_url: p.profile_path ? `https://image.tmdb.org/t/p/w185${p.profile_path}` : null,
        popularity: p.popularity || 0,
        known_for: (p.known_for || []).slice(0, 3).map((k: any) => ({
          title: k.title || k.name,
          year: (k.release_date || k.first_air_date || '').slice(0, 4),
          media_type: k.media_type,
        })),
      }));
      return new Response(
        JSON.stringify({ results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const person = searchData.results[0];
    const tmdbId = person.id;

    // Fetch detailed person info + credits
    const [detailRes, creditsRes, externalRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/person/${tmdbId}?language=en-US`, {
        headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      }),
      fetch(`https://api.themoviedb.org/3/person/${tmdbId}/combined_credits?language=en-US`, {
        headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      }),
      fetch(`https://api.themoviedb.org/3/person/${tmdbId}/external_ids`, {
        headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      }),
    ]);

    const [detail, credits, external] = await Promise.all([
      detailRes.json(),
      creditsRes.json(),
      externalRes.json(),
    ]);

    // Build notable credits (top 10 by popularity)
    const allCredits = [
      ...(credits.cast || []).map((c: any) => ({
        title: c.title || c.name,
        year: (c.release_date || c.first_air_date || '').slice(0, 4),
        role: c.character || '',
        type: c.media_type,
        popularity: c.popularity || 0,
      })),
      ...(credits.crew || [])
        .filter((c: any) => ['Director', 'Writer', 'Producer', 'Executive Producer', 'Director of Photography', 'Composer'].includes(c.job))
        .map((c: any) => ({
          title: c.title || c.name,
          year: (c.release_date || c.first_air_date || '').slice(0, 4),
          role: c.job || c.department,
          type: c.media_type,
          popularity: c.popularity || 0,
        })),
    ];

    // Sort by popularity, take top 12
    allCredits.sort((a: any, b: any) => b.popularity - a.popularity);
    const topCredits = allCredits.slice(0, 12);

    const profileUrl = detail.profile_path
      ? `https://image.tmdb.org/t/p/w500${detail.profile_path}`
      : null;

    const result = {
      found: true,
      tmdb_id: tmdbId,
      imdb_id: external.imdb_id || '',
      name: detail.name,
      biography: detail.biography || '',
      birthday: detail.birthday || '',
      place_of_birth: detail.place_of_birth || '',
      profile_url: profileUrl,
      known_for_department: detail.known_for_department || '',
      popularity: detail.popularity || 0,
      credits: topCredits,
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('TMDb lookup error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
