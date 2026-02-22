/**
 * Canonical naming helpers for documents and storage keys.
 * Used by both frontend and edge functions (via copy).
 */

import { DOC_TYPE_KEY_LABELS, type DocTypeKey } from '@/lib/active-folder/normalizeDocTypeKey';

/**
 * Slugify a title for safe filenames.
 * Lowercase, hyphens, max 60 chars.
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Return a human-readable label for a doc_type key.
 */
export function docTypeLabel(docType: string): string {
  const key = docType as DocTypeKey;
  return DOC_TYPE_KEY_LABELS[key] || docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Build a canonical display name for a document.
 * Examples:
 *   "Vengeance Red — Concept Brief"
 *   "Vengeance Red — Episode 03 — Script"
 */
export function buildDocumentDisplayName(
  projectTitle: string,
  docType: string,
  extra?: { episodeNumber?: number; versionLabel?: string },
): string {
  const label = docTypeLabel(docType);
  const parts = [projectTitle];

  if (extra?.episodeNumber != null) {
    parts.push(`Episode ${String(extra.episodeNumber).padStart(2, '0')}`);
  }

  parts.push(label);

  if (extra?.versionLabel) {
    parts.push(extra.versionLabel);
  }

  return parts.join(' — ');
}

/**
 * Build a stable storage key that does NOT include the project title.
 * Format: projects/{projectId}/documents/{documentId}/{versionId}.{ext}
 */
export function buildDocumentStorageKey(
  projectId: string,
  documentId: string,
  versionId: string,
  ext: string,
): string {
  return `projects/${projectId}/documents/${documentId}/${versionId}.${ext}`;
}
