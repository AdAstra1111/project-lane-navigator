/**
 * Shared image generation helpers for edge functions.
 *
 * Provides canonical gateway call, response extraction, and storage upload
 * so that no edge function reimplements these independently.
 */

// ── Extract image data URL from gateway response ────────────────────────────

export function extractImageDataUrl(genResult: any): string | null {
  try {
    const choice = genResult?.choices?.[0]?.message;
    if (!choice) return null;

    // Direct image array
    const imgUrl = choice.images?.[0]?.image_url?.url;
    if (imgUrl && imgUrl.startsWith("data:image")) return imgUrl;

    // Content array (multimodal)
    if (Array.isArray(choice.content)) {
      for (const part of choice.content) {
        if (part.type === "image_url" && part.image_url?.url?.startsWith("data:image"))
          return part.image_url.url;
        if (part.type === "image" && part.image?.url?.startsWith("data:image"))
          return part.image.url;
        if (part.inline_data?.data) {
          const mime = part.inline_data.mime_type || "image/png";
          return `data:${mime};base64,${part.inline_data.data}`;
        }
        if (typeof part === "string" && part.startsWith("data:image")) return part;
        if (typeof part.text === "string" && part.text.startsWith("data:image"))
          return part.text;
      }
    }

    // Plain string content
    if (typeof choice.content === "string" && choice.content.startsWith("data:image"))
      return choice.content;
  } catch (_) {
    /* noop */
  }
  return null;
}

// ── Convert data URL to bytes ───────────────────────────────────────────────

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64Part = dataUrl.split(",")[1];
  if (!base64Part) throw new Error("Invalid data URL");
  const binaryStr = atob(base64Part);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}

// ── Call AI gateway for image generation ────────────────────────────────────

export interface ImageGenRequest {
  gatewayUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  referenceImageUrls?: string[];
}

export interface ImageGenResult {
  imageDataUrl: string;
  rawBytes: Uint8Array;
}

export async function generateImageViaGateway(
  req: ImageGenRequest,
): Promise<ImageGenResult> {
  const content: Array<Record<string, unknown>> = [];

  // Add reference images if provided
  if (req.referenceImageUrls?.length) {
    for (const url of req.referenceImageUrls) {
      content.push({ type: "image_url", image_url: { url } });
    }
  }

  content.push({ type: "text", text: req.prompt });

  const response = await fetch(req.gatewayUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: req.model,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429) throw new Error("RATE_LIMIT: " + errText);
    if (response.status === 402) throw new Error("CREDITS_EXHAUSTED: " + errText);
    throw new Error(`AI gateway error [${response.status}]: ${errText.slice(0, 300)}`);
  }

  const genResult = await response.json();
  const imageDataUrl = extractImageDataUrl(genResult);

  if (!imageDataUrl) {
    throw new Error("No image returned from AI gateway");
  }

  return {
    imageDataUrl,
    rawBytes: dataUrlToBytes(imageDataUrl),
  };
}

// ── Upload to Supabase storage ──────────────────────────────────────────────

export async function uploadToStorage(
  db: any,
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType = "image/png",
): Promise<void> {
  const { error } = await db.storage
    .from(bucket)
    .upload(path, new Blob([bytes], { type: contentType }), {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }
}
