import { assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { getDocPolicy, requireDocPolicy } from "./docPolicyRegistry.ts";

// ── Canonical doc types resolve correctly ──

const CANONICAL_TYPES = [
  "idea", "concept_brief", "treatment", "story_outline", "character_bible",
  "beat_sheet", "feature_script", "production_draft", "deck", "market_sheet",
  "season_arc", "format_rules", "documentary_outline", "vertical_episode_beats",
  "vertical_market_sheet", "season_script", "episode_beats", "episode_outline",
  "episode_script", "episode_grid", "season_master_script",
  "project_overview", "creative_brief", "market_positioning", "canon", "nec",
];

Deno.test("all canonical doc types are registered", () => {
  for (const dt of CANONICAL_TYPES) {
    const policy = getDocPolicy(dt);
    assertEquals(policy.registered, true, `${dt} should be registered`);
  }
});

Deno.test("requireDocPolicy succeeds for canonical types", () => {
  for (const dt of CANONICAL_TYPES) {
    const policy = requireDocPolicy(dt);
    assertEquals(typeof policy.docClass, "string");
  }
});

// ── Audit-identified alias names must NOT be registered ──
// "blueprint" → alias for "treatment", "script" → alias for format-specific script type
const AUDIT_ALIASES = ["blueprint", "script"];

Deno.test("audit-identified aliases are NOT registered in policy registry", () => {
  for (const alias of AUDIT_ALIASES) {
    const policy = getDocPolicy(alias);
    assertEquals(policy.registered, false, `"${alias}" should NOT be registered — it is an alias, not a canonical type`);
  }
});

Deno.test("requireDocPolicy throws for audit-identified aliases (fail-closed)", () => {
  for (const alias of AUDIT_ALIASES) {
    assertThrows(
      () => requireDocPolicy(alias),
      Error,
      "DOC_TYPE_UNREGISTERED",
      `"${alias}" should throw DOC_TYPE_UNREGISTERED`,
    );
  }
});

// ── Unknown types still fail closed ──

Deno.test("unknown types fail closed", () => {
  assertThrows(() => requireDocPolicy("nonexistent_type"), Error, "DOC_TYPE_UNREGISTERED");
  assertEquals(getDocPolicy("nonexistent_type").registered, false);
});
