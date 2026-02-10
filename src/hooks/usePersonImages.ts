import { useState, useEffect } from 'react';

const imagesCache = new Map<string, string[]>();

async function fetchWikipediaImages(name: string): Promise<string[]> {
  const images: string[] = [];
  try {
    // Get the main thumbnail from summary
    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`
    );
    if (summaryRes.ok) {
      const data = await summaryRes.json();
      // Use originalimage for higher res
      if (data?.originalimage?.source) images.push(data.originalimage.source);
      else if (data?.thumbnail?.source) images.push(data.thumbnail.source);
    }

    // Get additional images from the page media endpoint
    const mediaRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(name)}`
    );
    if (mediaRes.ok) {
      const mediaData = await mediaRes.json();
      const items = mediaData?.items || [];
      for (const item of items) {
        if (images.length >= 6) break;
        const src = item?.srcset?.[0]?.src || item?.original?.source;
        if (src && !images.includes(src) && !src.includes('svg') && !src.includes('logo') && !src.includes('icon') && !src.includes('Flag')) {
          const fullSrc = src.startsWith('//') ? `https:${src}` : src;
          if (!images.includes(fullSrc)) images.push(fullSrc);
        }
      }
    }
  } catch {
    // ignore
  }
  return images;
}

export function usePersonImages(name: string | undefined): { images: string[]; loading: boolean } {
  const [images, setImages] = useState<string[]>(name ? imagesCache.get(name) || [] : []);
  const [loading, setLoading] = useState(!name ? false : !imagesCache.has(name));

  useEffect(() => {
    if (!name) return;
    if (imagesCache.has(name)) {
      setImages(imagesCache.get(name)!);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    fetchWikipediaImages(name).then(result => {
      if (!cancelled) {
        imagesCache.set(name, result);
        setImages(result);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [name]);

  return { images, loading };
}
