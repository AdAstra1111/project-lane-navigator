/**
 * Merge-update helper for React Router's setSearchParams.
 * Preserves all existing params; only applies the patch.
 *
 * WHY: setSearchParams({ key: value }) replaces ALL params, silently
 * wiping drawer/drawerTab/tab. Always use this helper inside ProjectShell
 * surfaces to guarantee merge semantics.
 */
import type { SetURLSearchParams } from 'react-router-dom';

export function updateSearchParams(
  setSearchParams: SetURLSearchParams,
  patch: (next: URLSearchParams) => void,
  opts?: { replace?: boolean },
) {
  setSearchParams(prev => {
    const next = new URLSearchParams(prev);
    patch(next);
    return next;
  }, opts);
}
