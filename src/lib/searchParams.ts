/**
 * Merge-update helper for React Router's setSearchParams.
 * Preserves all existing params; only applies the patch.
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
