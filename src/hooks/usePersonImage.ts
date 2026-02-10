import { useState, useEffect } from 'react';

const imageCache = new Map<string, string | null>();

async function fetchWikipediaThumb(name: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.thumbnail?.source || null;
  } catch {
    return null;
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
    fetchWikipediaThumb(name).then(result => {
      if (!cancelled) {
        imageCache.set(name, result);
        setUrl(result);
      }
    });
    return () => { cancelled = true; };
  }, [name]);

  return url;
}
