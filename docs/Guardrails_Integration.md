# Guardrails Integration Reference

## Overview

The IFFY Guardrail Framework enforces production-type-specific constraints across all LLM-calling edge functions. It centralizes format rules, supports per-project configuration, and provides hard-lock validation for documentary/non-fiction engines.

## Shared Modules

| Module | Path | Purpose |
|---|---|---|
| `guardrails.ts` | `supabase/functions/_shared/guardrails.ts` | `buildGuardrailBlock()`, `validateOutput()`, `buildRegenerationPrompt()`, `getCorpusCalibration()` |
| `productionTypeRules.ts` | `supabase/functions/_shared/productionTypeRules.ts` | Production type conditioning context, allowed/disallowed concepts |
| `llm.ts` | `supabase/functions/_shared/llm.ts` | `composeSystem()`, `callLLM()`, `parseJsonSafe()`, `extractJSON()` |

## Engine Modes

| Mode | Behavior | When Used |
|---|---|---|
| `hard-lock` | Violations trigger output rejection + 1 regeneration pass | Documentary, documentary-series, hybrid-documentary |
| `soft-bias` | Violations logged as warnings, output not rejected | Film, TV series, vertical drama, animation, etc. |
| `advisory` | Minimal guidance, no enforcement | Hybrid projects |

## Engine → Injected Blocks Map

| Engine | Guardrails | Conditioning | Corpus | Hard-Lock Validation |
|---|---|---|---|---|
| `dev-engine-v2` | ✅ | ✅ | ✅ (blueprint, architecture, drafting) | Documentary only |
| `development-engine` | ✅ | ✅ | ✅ (via guardrails corpus block) | Documentary only |
| `convergence-engine` | ✅ | ✅ | ❌ (scoring only) | No |
| `script-engine` | ✅ | ✅ | ✅ (inline calibration) | Documentary only |
| `script-coverage` | ✅ | ✅ | ✅ (deviation block) | No |
| `analyze-project` | ✅ | ✅ | ❌ | No |
| `analyze-note` | ✅ | ✅ | ❌ | No |
| `expand-concept` | ✅ | ✅ | ❌ | No |
| `stress-test-concept` | ✅ | ✅ | ❌ | No |
| `generate-pitch` | ✅ | ✅ | ❌ | No |
| `generate-pitch-deck` | ✅ | ✅ | ❌ | No |
| `packaging-intelligence` | ✅ | ✅ | ❌ | No |
| `smart-packaging` | ✅ | ✅ | ❌ | No |
| `finance-predict` | ✅ | ✅ | ❌ | No |
| `greenlight-simulate` | ✅ | ✅ | ❌ | No |
| `comp-analysis` | ✅ | ✅ | ❌ | No |
| `suggest-cast` | ✅ | ✅ | ❌ | No |
| `treatment-compare` | ✅ | ✅ | ❌ | No |
| `schedule-intelligence` | ✅ | ✅ | ❌ | No |
| `score-engines` | ✅ | ✅ | ❌ | No |
| `research-buyers` | ✅ | ✅ | ❌ | No |
| `research-person` | ✅ | ✅ | ❌ | No |
| `research-incentives` | ✅ | ✅ | ❌ | No |
| `research-copro` | ✅ | ✅ | ❌ | No |
| `project-chat` | ✅ | ✅ | ❌ | No |
| `project-incentive-insights` | ✅ | ✅ | ❌ | No |
| `script-to-budget` | ✅ | ✅ | ❌ | No |
| `auto-schedule` | ✅ | ✅ | ❌ | No |
| `refresh-trends` | ✅ | ✅ | ❌ | No |

## Project-Level Configuration

### `projects.guardrails_config` (JSONB)

```json
{
  "enabled": true,
  "profile": "vertical-drama-grounded-farce",
  "engineModes": {
    "dev-engine-v2": "soft-bias",
    "development-engine": "soft-bias",
    "script-coverage": "hard-lock"
  },
  "overrides": {
    "additionalDisallowed": ["cartoon physics"],
    "forbidden": ["supernatural elements"],
    "mustInclude": ["economic precarity"],
    "customText": "All dialogue must reflect working-class register",
    "absurdityRange": [4, 7]
  },
  "customText": "Project-wide guardian text"
}
```

- **Default**: `null` → guardrails disabled (uses production-type defaults only)
- **`enabled: false`** → explicitly disabled
- **`engineModes`** → per-engine override of hard-lock/soft-bias/advisory
- **`overrides.forbidden`** → additional disallowed concepts (merged with type defaults)
- **`overrides.mustInclude`** → concepts that MUST appear in output
- **`overrides.customText`** → injected into enforcement block

### Resolution Order

1. Explicit `engineMode` passed in function call
2. `guardrails_config.engineModes[engineName]`
3. `guardrails_config.overrides.engineMode`
4. Production type default

## Hard-Lock Validation

For engines where `engineMode === "hard-lock"` or documentary formats:

1. `validateOutput(aiOutput, guardrails.policy)` runs post-generation
2. If hard violations found → `buildRegenerationPrompt(violations)` appended to system prompt
3. One regeneration attempt (max 1 retry)
4. If still failing → return original with violation metadata

### Validated Checks

- **Disallowed concepts**: Regex match against production type's disallowed list
- **Documentary fabrication**: Detects INT./EXT. scene headings in documentary output

## Using `composeSystem()`

```typescript
import { composeSystem } from "../_shared/llm.ts";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const guardrails = buildGuardrailBlock({
  project,
  productionType: project.format,
  engineName: "dev-engine-v2",
  corpusEnabled: true,
  corpusCalibration: calibration,
});

const system = composeSystem({
  baseSystem: BASE_PROMPT,
  guardrailsBlock: guardrails.textBlock,
});

console.log(`[engine] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);
```

## Using `callLLM()`

```typescript
import { callLLM, parseJsonSafe, MODELS } from "../_shared/llm.ts";

const result = await callLLM({
  apiKey: LOVABLE_API_KEY,
  model: MODELS.PRO,
  system: composedSystem,
  user: userPrompt,
  temperature: 0.3,
  maxTokens: 6000,
});

const parsed = await parseJsonSafe(result.content, LOVABLE_API_KEY);
```

## Adding a New Profile

1. Add production type to `productionTypeRules.ts` → `RULES` object
2. Add engine mode default to `guardrails.ts` → `ENGINE_MODE_DEFAULTS`
3. If hard-lock needed, add validation logic to `validateOutput()`
4. Deploy affected edge functions

## Corpus Calibration

Corpus data is injected as a **separate block** from guardrails. It provides structural reference (median pages, scenes, dialogue ratio) but never constrains creative direction.

```typescript
import { getCorpusCalibration } from "../_shared/guardrails.ts";

const calibration = await getCorpusCalibration(db, format, genre);
const guardrails = buildGuardrailBlock({
  productionType: format,
  corpusEnabled: !!calibration,
  corpusCalibration: calibration,
});
```

## Traceability

Every function logs:
```
[engine-name] guardrails: profile=<profileName>, hash=<hash>
```

The `hash` is a deterministic fingerprint of the injected guardrail text, enabling audit trail of which rules were active during any generation.
