/**
 * Tiny schema-validation helpers for AI JSON responses.
 * No dependencies. Used with parseAiJson / callLLMWithJsonRetry validators.
 */

/** True if value is a non-null plain object. */
export function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True if value is an object with `key` being an array. */
export function hasArray(v: unknown, key: string): boolean {
  return isObject(v) && Array.isArray((v as any)[key]);
}

/** True if value is an object with `key` being a non-null object. */
export function hasObject(v: unknown, key: string): boolean {
  return isObject(v) && isObject((v as any)[key]);
}

/** True if value is a string with length > 0. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
