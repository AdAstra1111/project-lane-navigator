/**
 * actorCreationOrigin — Phase 17: Lightweight origin context
 * for inline actor creation from ProjectCasting.
 *
 * This is workflow context only. NOT canonical cast truth.
 * Used to preserve project/character context during the
 * create-actor → return-to-casting flow.
 */

export interface ActorCreationOrigin {
  source: 'project-casting';
  project_id: string;
  character_key: string;
}

const STORAGE_KEY = 'actor_creation_origin';

export function setActorCreationOrigin(origin: ActorCreationOrigin): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(origin));
  } catch {
    // Silently fail if sessionStorage unavailable
  }
}

export function getActorCreationOrigin(): ActorCreationOrigin | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.source === 'project-casting' && parsed?.project_id && parsed?.character_key) {
      return parsed as ActorCreationOrigin;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearActorCreationOrigin(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail
  }
}
