/**
 * isValidUUID — Validates a string is a proper UUID v4 format.
 * Use to guard edge function calls from receiving unresolved route params.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string | undefined | null): value is string {
  return !!value && UUID_RE.test(value);
}
