/**
 * hydrateImageUrls — Centralized signed URL hydration for ProjectImage arrays.
 * Single source of truth — replaces duplicate hydration logic across:
 * - resolveCanonImages
 * - lookbookImageOrchestrator
 * - useLookbookSectionImages
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage } from '@/lib/images/types';

const DEFAULT_EXPIRY = 3600; // 1 hour

/**
 * Hydrate signed URLs for an array of ProjectImages in-place.
 * Groups by storage bucket for efficient batch signing.
 */
export async function hydrateSignedUrls(
  images: ProjectImage[],
  expirySeconds: number = DEFAULT_EXPIRY,
): Promise<void> {
  if (images.length === 0) return;

  const bucketGroups = new Map<string, ProjectImage[]>();
  for (const img of images) {
    const bucket = img.storage_bucket || 'project-posters';
    if (!bucketGroups.has(bucket)) bucketGroups.set(bucket, []);
    bucketGroups.get(bucket)!.push(img);
  }

  await Promise.all(
    Array.from(bucketGroups.entries()).map(async ([bucket, imgs]) => {
      await Promise.all(
        imgs.map(async (img) => {
          try {
            const { data: signed } = await supabase.storage
              .from(bucket)
              .createSignedUrl(img.storage_path, expirySeconds);
            img.signedUrl = signed?.signedUrl || undefined;
          } catch {
            img.signedUrl = undefined;
          }
        }),
      );
    }),
  );
}

/**
 * Hydrate a single image's signed URL. Returns the URL or undefined.
 */
export async function hydrateSingleSignedUrl(
  image: ProjectImage,
  expirySeconds: number = DEFAULT_EXPIRY,
): Promise<string | undefined> {
  try {
    const bucket = image.storage_bucket || 'project-posters';
    const { data: signed } = await supabase.storage
      .from(bucket)
      .createSignedUrl(image.storage_path, expirySeconds);
    image.signedUrl = signed?.signedUrl || undefined;
    return image.signedUrl;
  } catch {
    image.signedUrl = undefined;
    return undefined;
  }
}
