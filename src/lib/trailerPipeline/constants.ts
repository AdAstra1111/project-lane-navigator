/**
 * Shared trailer pipeline constants.
 * Single source of truth for values used across UI surfaces.
 */

/** Blueprint statuses that are clip-enqueue-ready.
 *  Must match backend BLUEPRINT_READY_STATUSES in trailer-clip-generator. */
export const READY_STATUSES = ['ready', 'complete', 'v2_shim'] as const;

export type ReadyStatus = typeof READY_STATUSES[number];

/** Check if a blueprint status is clip-ready */
export function isReadyStatus(status: string): boolean {
  return (READY_STATUSES as readonly string[]).includes(status);
}
