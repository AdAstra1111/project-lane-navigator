/**
 * Video Render — Veo Provider Adapter (Google Veo 2)
 * Implements the VideoProvider interface for Google's Veo video generation API.
 * Used in edge function context only.
 */
import type { VideoProvider, ProviderRequest, ProviderResponse } from "./types.ts";

const VEO_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class VeoProvider implements VideoProvider {
  readonly providerId = "veo";
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("VEO_API_KEY is required");
    this.apiKey = apiKey;
  }

  async submitShot(request: ProviderRequest): Promise<ProviderResponse> {
    const submittedAt = new Date().toISOString();

    // Map resolution to Veo aspect ratio
    const aspectRatio = request.aspectRatio || this.resolveAspectRatio(request.resolution);

    const body = {
      model: `models/${request.modelId || "veo-2.0-generate-001"}`,
      generateVideoConfig: {
        outputConfig: {
          mimeType: "video/mp4",
          fps: request.fps || 24,
          durationSeconds: Math.min(request.durationSec, 8), // Veo caps at 8s
          aspectRatio,
        },
        seed: request.seed,
      },
      prompt: {
        text: request.prompt,
      },
    };

    const url = `${VEO_API_BASE}/models/veo-2.0-generate-001:predictLongRunning?key=${this.apiKey}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      const retryable = resp.status === 429 || resp.status >= 500;
      return {
        providerJobId: "",
        status: "error",
        errorMessage: `Veo API ${resp.status}: ${errText.slice(0, 500)}`,
        retryable,
        timing: { submittedAt },
      };
    }

    const result = await resp.json();
    const operationName = result.name || result.operationId || "";

    return {
      providerJobId: operationName,
      status: "queued",
      timing: { submittedAt },
    };
  }

  async pollJob(providerJobId: string): Promise<ProviderResponse> {
    if (!providerJobId) {
      return { providerJobId: "", status: "error", errorMessage: "No operation ID", retryable: false };
    }

    const url = `${VEO_API_BASE}/${providerJobId}?key=${this.apiKey}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        providerJobId,
        status: "error",
        errorMessage: `Poll failed ${resp.status}: ${errText.slice(0, 500)}`,
        retryable: resp.status >= 500,
      };
    }

    const result = await resp.json();

    if (result.done === true) {
      // Extract video URL from response
      const video = result.response?.generateVideoResponse?.generatedSamples?.[0];
      const videoUri = video?.video?.uri || null;

      if (!videoUri) {
        return {
          providerJobId,
          status: "error",
          errorMessage: "Generation completed but no video URI returned",
          retryable: false,
        };
      }

      return {
        providerJobId,
        status: "complete",
        outputVideoUrl: videoUri,
        timing: {
          submittedAt: result.metadata?.startTime || "",
          completedAt: new Date().toISOString(),
        },
      };
    }

    if (result.error) {
      return {
        providerJobId,
        status: "error",
        errorMessage: result.error.message || "Unknown Veo error",
        retryable: false,
      };
    }

    return {
      providerJobId,
      status: "running",
    };
  }

  private resolveAspectRatio(resolution: string): string {
    if (resolution.includes("1920x1080") || resolution.includes("1280x720")) return "16:9";
    if (resolution.includes("1080x1920") || resolution.includes("720x1280")) return "9:16";
    if (resolution.includes("1080x1080")) return "1:1";
    return "16:9";
  }
}
