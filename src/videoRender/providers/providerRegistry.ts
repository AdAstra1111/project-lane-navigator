/**
 * Video Render — Provider Registry
 * Returns the correct provider adapter by ID.
 */
import type { VideoProvider } from "./types.ts";

/**
 * Registry of available providers. Edge functions import this
 * and call getProvider() to get the adapter for a given provider_id.
 *
 * NOTE: This file is imported by BOTH frontend (for types) and edge functions.
 * Actual provider implementations are only used in edge functions.
 */

const PROVIDER_MAP: Record<string, () => VideoProvider> = {};

/** Register a provider adapter at runtime (edge function context). */
export function registerProvider(id: string, factory: () => VideoProvider): void {
  PROVIDER_MAP[id] = factory;
}

/** Get provider by ID. Throws if not registered. */
export function getProvider(providerId: string): VideoProvider {
  const factory = PROVIDER_MAP[providerId];
  if (!factory) {
    throw new Error(`Unknown video provider: ${providerId}. Available: ${Object.keys(PROVIDER_MAP).join(", ") || "none"}`);
  }
  return factory();
}

/** List registered provider IDs. */
export function listProviders(): string[] {
  return Object.keys(PROVIDER_MAP);
}
