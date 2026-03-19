/**
 * normalizeCanonText — Safely coerce any canon field value to a string.
 * Canon JSON fields may be string, array, object, null, or undefined.
 * This ensures no .match(), .slice(), .includes() ever throws.
 */

export function normalizeCanonText(value: unknown, fieldName?: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  // Log non-string encounters for upstream debugging
  const tag = fieldName ? ` (${fieldName})` : '';

  if (Array.isArray(value)) {
    console.debug(`[LookBook] Canon field normalized${tag}: array → string`);
    return value
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          // Extract meaningful values from objects (e.g. { name: '...', description: '...' })
          const vals = Object.values(item).filter(v => typeof v === 'string' && v.length > 0);
          return vals.join(' — ');
        }
        return String(item ?? '');
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof value === 'object') {
    console.debug(`[LookBook] Canon field normalized${tag}: object → string`);
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.length > 0) {
        parts.push(`${k}: ${v}`);
      }
    }
    return parts.length > 0 ? parts.join('\n') : JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}
