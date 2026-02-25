/**
 * Video Render — Provider Abstraction Types
 * Provider-agnostic request/response for video generation.
 */

export interface ProviderRequest {
  /** Provider identifier (e.g. "veo", "runway") */
  providerId: string;
  /** Model identifier within the provider */
  modelId: string;
  /** Output resolution e.g. "1280x720" */
  resolution: string;
  /** Frames per second */
  fps: number;
  /** Duration in seconds */
  durationSec: number;
  /** Deterministic seed derived from stable hash */
  seed: number;
  /** Main generation prompt */
  prompt: string;
  /** Negative prompt (things to avoid) */
  negativePrompt: string;
  /** Optional init image URL for img2vid */
  initImageUrl?: string;
  /** Serialized continuity constraints */
  continuityConstraints: string[];
  /** Aspect ratio hint */
  aspectRatio?: string;
}

export interface ProviderResponse {
  /** Provider-specific job/operation ID */
  providerJobId: string;
  /** Current status */
  status: "queued" | "running" | "complete" | "error";
  /** URL to output video (when complete) */
  outputVideoUrl?: string;
  /** Raw video bytes (alternative to URL) */
  outputBytes?: Uint8Array;
  /** Error message if status=error */
  errorMessage?: string;
  /** Whether the error is retryable */
  retryable?: boolean;
  /** Cost metadata */
  cost?: { amount: number; currency: string; unit: string };
  /** Timing metadata */
  timing?: { submittedAt: string; completedAt?: string; durationMs?: number };
}

export interface ProviderError {
  code: string;
  message: string;
  retryable: boolean;
  provider: string;
}

/**
 * Provider interface — each provider adapter implements this.
 */
export interface VideoProvider {
  readonly providerId: string;
  /** Submit a render request. Returns immediately with providerJobId. */
  submitShot(request: ProviderRequest): Promise<ProviderResponse>;
  /** Poll for completion of a previously submitted job. */
  pollJob(providerJobId: string): Promise<ProviderResponse>;
}
