/**
 * evaluate-visual-similarity — Compare candidate images against identity anchors
 * using AI vision to score face, hair, age, body, and overall identity continuity.
 *
 * Input: { candidateUrl, anchorUrls: { headshot?, profile?, fullBody? }, characterName }
 * Output: { dimensions: { face, hair, age, body, overall }, summary, anchorContext }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface SimilarityDimension {
  score: number;       // 0-100
  confidence: string;  // high | medium | low | unavailable
  reason: string;
}

interface SimilarityResult {
  dimensions: {
    face: SimilarityDimension;
    hair: SimilarityDimension;
    age: SimilarityDimension;
    body: SimilarityDimension;
    overall: SimilarityDimension;
  };
  anchorContext: string; // full_lock | partial_lock | single_anchor
  summary: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const { candidateUrl, anchorUrls, characterName } = await req.json();

    if (!candidateUrl) {
      return new Response(JSON.stringify({ error: "candidateUrl required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine anchor context
    const anchors: { slot: string; url: string }[] = [];
    if (anchorUrls?.headshot) anchors.push({ slot: 'headshot', url: anchorUrls.headshot });
    if (anchorUrls?.profile) anchors.push({ slot: 'profile', url: anchorUrls.profile });
    if (anchorUrls?.fullBody) anchors.push({ slot: 'full_body', url: anchorUrls.fullBody });

    if (anchors.length === 0) {
      // No anchors — return neutral unavailable result
      const unavailable: SimilarityDimension = { score: 50, confidence: 'unavailable', reason: 'No anchor images available' };
      return new Response(JSON.stringify({
        dimensions: { face: unavailable, hair: unavailable, age: unavailable, body: unavailable, overall: unavailable },
        anchorContext: 'no_anchors',
        summary: 'No identity anchors available for visual similarity comparison',
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const anchorContext = anchors.length >= 3 ? 'full_lock' : anchors.length >= 2 ? 'partial_lock' : 'single_anchor';

    // Build vision messages
    const imageContent: any[] = [];

    // Add anchor images first
    for (const anchor of anchors) {
      imageContent.push({
        type: "text",
        text: `[ANCHOR — ${anchor.slot} reference for ${characterName || 'character'}]`,
      });
      imageContent.push({
        type: "image_url",
        image_url: { url: anchor.url },
      });
    }

    // Add candidate image
    imageContent.push({
      type: "text",
      text: `[CANDIDATE — evaluate this image against the anchors above]`,
    });
    imageContent.push({
      type: "image_url",
      image_url: { url: candidateUrl },
    });

    const systemPrompt = `You are a visual identity consistency evaluator for film/TV character design.

Compare the CANDIDATE image against the ANCHOR reference images for the same character.

Score each dimension 0-100:
- face: facial structure, jaw, cheekbones, nose, eye shape/spacing, brow. Ignore expression.
- hair: color, texture, length, style, hairline shape.
- age: apparent age read consistency across images.
- body: build, proportions, posture, shoulder width (if visible).
- overall: holistic identity impression — would a viewer recognize this as the same person?

For each dimension:
- score: 0-100 integer
- confidence: "high" if clearly assessable, "medium" if partially obscured, "low" if mostly hidden, "unavailable" if the feature is not visible
- reason: one sentence explaining the score

Also provide a one-sentence summary of the overall identity match.

Respond ONLY with valid JSON matching this schema:
{
  "dimensions": {
    "face": { "score": N, "confidence": "...", "reason": "..." },
    "hair": { "score": N, "confidence": "...", "reason": "..." },
    "age": { "score": N, "confidence": "...", "reason": "..." },
    "body": { "score": N, "confidence": "...", "reason": "..." },
    "overall": { "score": N, "confidence": "...", "reason": "..." }
  },
  "summary": "..."
}

Be honest. If a dimension cannot be assessed, score 50 with confidence "unavailable".
Do not inflate scores. A score of 70+ means genuinely strong resemblance.`;

    const resp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: imageContent },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`AI gateway error ${resp.status}: ${errText}`);
    }

    const aiResult = await resp.json();
    const content = aiResult.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse similarity response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize
    const dims = ['face', 'hair', 'age', 'body', 'overall'] as const;
    const result: SimilarityResult = {
      dimensions: {} as any,
      anchorContext,
      summary: parsed.summary || 'Visual similarity evaluated',
    };

    for (const dim of dims) {
      const d = parsed.dimensions?.[dim];
      result.dimensions[dim] = {
        score: typeof d?.score === 'number' ? Math.max(0, Math.min(100, Math.round(d.score))) : 50,
        confidence: ['high', 'medium', 'low', 'unavailable'].includes(d?.confidence) ? d.confidence : 'low',
        reason: typeof d?.reason === 'string' ? d.reason : 'Unable to assess',
      };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("evaluate-visual-similarity error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
