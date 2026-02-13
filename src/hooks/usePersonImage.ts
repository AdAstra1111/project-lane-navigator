import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const imageCache = new Map<string, string | null>();
const canonicalNameCache = new Map<string, string | null>();

// Title-case a name so Wikipedia lookup works regardless of how it was stored
function titleCase(name: string): string {
  return name.replace(/\b\w/g, c => c.toUpperCase());
}

interface WikiResult {
  thumbnail: string | null;
  canonicalName: string | null;
}

async function fetchWikipediaData(name: string): Promise<WikiResult> {
  const normalized = titleCase(name.trim());
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(normalized)}`
    );
    if (!res.ok) return { thumbnail: null, canonicalName: null };
    const data = await res.json();
    return {
      thumbnail: data?.thumbnail?.source || null,
      canonicalName: data?.title || null,
    };
  } catch {
    return { thumbnail: null, canonicalName: null };
  }
}

/**
 * Try TMDb first for a verified headshot, fall back to Wikipedia.
 * TMDb results are cached so we don't re-call the edge function.
 */
const tmdbCache = new Map<string, string | null>();
const tmdbPending = new Map<string, Promise<string | null>>();

async function fetchTmdbProfileUrl(name: string): Promise<string | null> {
  if (tmdbCache.has(name)) return tmdbCache.get(name) ?? null;
  if (tmdbPending.has(name)) return tmdbPending.get(name)!;

  const promise = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('tmdb-lookup', {
        body: { name, mode: 'search' },
      });
      if (error || !data?.results?.length) {
        tmdbCache.set(name, null);
        return null;
      }
      const profileUrl = data.results[0].profile_url || null;
      tmdbCache.set(name, profileUrl);
      return profileUrl;
    } catch {
      tmdbCache.set(name, null);
      return null;
    } finally {
      tmdbPending.delete(name);
    }
  })();

  tmdbPending.set(name, promise);
  return promise;
}

export function usePersonImage(name: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(name ? imageCache.get(name) ?? null : null);

  useEffect(() => {
    if (!name) return;
    if (imageCache.has(name)) {
      setUrl(imageCache.get(name) ?? null);
      return;
    }
    let cancelled = false;

    // Try TMDb first, fall back to Wikipedia
    fetchTmdbProfileUrl(name).then(tmdbUrl => {
      if (cancelled) return;
      if (tmdbUrl) {
        imageCache.set(name, tmdbUrl);
        setUrl(tmdbUrl);
        // Also set canonical from TMDb search result name
        return;
      }
      // Fallback to Wikipedia
      fetchWikipediaData(name).then(result => {
        if (!cancelled) {
          imageCache.set(name, result.thumbnail);
          canonicalNameCache.set(name, result.canonicalName);
          setUrl(result.thumbnail);
        }
      });
    });

    return () => { cancelled = true; };
  }, [name]);

  return url;
}

/**
 * Returns { imageUrl, canonicalName } for a person.
 * Uses TMDb first for the photo, Wikipedia for canonical name.
 */
export function usePersonLookup(name: string | undefined): {
  imageUrl: string | null;
  canonicalName: string | null;
  loading: boolean;
} {
  const [imageUrl, setImageUrl] = useState<string | null>(name ? imageCache.get(name) ?? null : null);
  const [canonicalName, setCanonicalName] = useState<string | null>(name ? canonicalNameCache.get(name) ?? null : null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!name) return;
    if (imageCache.has(name) && canonicalNameCache.has(name)) {
      setImageUrl(imageCache.get(name) ?? null);
      setCanonicalName(canonicalNameCache.get(name) ?? null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    // Fetch TMDb + Wikipedia in parallel
    Promise.all([
      fetchTmdbProfileUrl(name),
      fetchWikipediaData(name),
    ]).then(([tmdbUrl, wikiResult]) => {
      if (cancelled) return;
      // Prefer TMDb photo, fall back to Wikipedia
      const finalImage = tmdbUrl || wikiResult.thumbnail;
      imageCache.set(name, finalImage);
      canonicalNameCache.set(name, wikiResult.canonicalName);
      setImageUrl(finalImage);
      setCanonicalName(wikiResult.canonicalName);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [name]);

  return { imageUrl, canonicalName, loading };
}
