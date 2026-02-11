import { useState, useEffect } from 'react';

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
      // Wikipedia returns the page title which is the canonical name
      canonicalName: data?.title || null,
    };
  } catch {
    return { thumbnail: null, canonicalName: null };
  }
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
    fetchWikipediaData(name).then(result => {
      if (!cancelled) {
        imageCache.set(name, result.thumbnail);
        canonicalNameCache.set(name, result.canonicalName);
        setUrl(result.thumbnail);
      }
    });
    return () => { cancelled = true; };
  }, [name]);

  return url;
}

/**
 * Returns { imageUrl, canonicalName } for a person.
 * canonicalName is the Wikipedia page title (properly capitalized).
 * Use canonicalName to auto-correct stored names.
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
    fetchWikipediaData(name).then(result => {
      if (!cancelled) {
        imageCache.set(name, result.thumbnail);
        canonicalNameCache.set(name, result.canonicalName);
        setImageUrl(result.thumbnail);
        setCanonicalName(result.canonicalName);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [name]);

  return { imageUrl, canonicalName, loading };
}
