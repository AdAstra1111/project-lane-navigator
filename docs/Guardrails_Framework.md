# IFFY Production Guardrail Framework

## Overview

The Guardrail Framework provides unified production-type governance across all 25+ LLM-calling edge functions. It prevents cross-type contamination (e.g., suggesting pre-sales for documentaries) and enforces format-specific rules without duplicating logic.

## Architecture

```
supabase/functions/_shared/
├── productionTypeRules.ts   — Server-side production type definitions
└── guardrails.ts            — Guardrail builder, validator, regeneration
```

Every edge function imports `buildGuardrailBlock()` and injects the returned `textBlock` into its system prompt.

## Profiles

Each production type has a default profile with:
- **AI Conditioning Context** — Format-specific instructions
- **Allowed Concepts** — Financing/distribution terms valid for this type
- **Disallowed Concepts** — Terms that should never appear in output
- **Engine Mode** — `hard-lock`, `soft-bias`, or `advisory`

### Supported Production Types
`film`, `tv-series`, `documentary`, `documentary-series`, `hybrid-documentary`, `commercial`, `branded-content`, `short-film`, `music-video`, `proof-of-concept`, `digital-series`, `vertical-drama`, `limited-series`, `hybrid`, `anim-feature`, `anim-series`, `reality`, `podcast-ip`

## Engine Modes

| Mode | Behavior | Default For |
|------|----------|-------------|
| `hard-lock` | Violations trigger output rejection + regeneration | Documentary types |
| `soft-bias` | Violations logged as warnings, output accepted | Most narrative types |
| `advisory` | Concepts flagged but not enforced | Hybrid projects |

## Usage in Edge Functions

```typescript
import { buildGuardrailBlock, validateOutput } from "../_shared/guardrails.ts";

// Build guardrail block
const guardrails = buildGuardrailBlock({
  productionType: "documentary",
  project: { format: "documentary", assigned_lane: "prestige-awards" },
  corpusEnabled: true,
  corpusCalibration: calibrationData,
});

// Inject into system prompt
const systemPrompt = `${basePrompt}\n${guardrails.textBlock}`;

// Log for tracing
console.log(`guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

// Validate output (for hard-lock engines)
const validation = validateOutput(aiOutput, guardrails.policy);
if (!validation.ok) {
  // Regenerate with violation feedback
  const regenPrompt = buildRegenerationPrompt(validation.violations);
  // ... retry AI call with regenPrompt appended
}
```

## Project-Level Overrides

Projects can override guardrails via a `guardrails` field in project settings:

```json
{
  "guardrails": {
    "enabled": true,
    "profile": "Custom Documentary",
    "overrides": {
      "engineMode": "hard-lock",
      "additionalDisallowed": ["reconstruction", "dramatization"],
      "customText": "This project requires strict observational approach only"
    }
  }
}
```

If `guardrails` is missing or `enabled` is false, the default profile for the production type is used.

## Validation

`validateOutput(text, policy)` checks:
1. **Disallowed concept scan** — Regex search for banned terms
2. **Documentary fabrication check** — Detects INT./EXT. scene headings in documentary output
3. Returns `{ ok, violations[] }` with severity levels

For `hard-lock` engines, violations trigger up to 2 regeneration passes with explicit violation feedback.

## Corpus Integration

When `corpusEnabled: true` and `corpusCalibration` data is provided, the guardrail block includes corpus calibration targets (median pages, scenes, dialogue ratio, etc.) to guide structural output.

## Adding New Profiles

1. Add the production type to `_shared/productionTypeRules.ts` in the `RULES` record
2. Add the default engine mode in `_shared/guardrails.ts` `ENGINE_MODE_DEFAULTS`
3. The profile is automatically available to all edge functions

## Extending with Custom Rules

For project-specific rules beyond production type defaults:
- Use the `overrides.customText` field for free-text prompt injection
- Use `overrides.additionalDisallowed` to extend the disallowed concept list
- Use `overrides.engineMode` to escalate/relax enforcement

## Tracing

Every edge function logs:
- `profile` — The guardrail profile name
- `hash` — A deterministic hash of the injected text block
- `mode` — The engine mode (hard-lock/soft-bias/advisory)

This enables auditing which guardrail version was active for any given AI run.
