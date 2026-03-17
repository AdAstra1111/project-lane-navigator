/**
 * Regression + integration tests for infer-criteria extractHeading.
 *
 * Run: supabase--test_edge_functions  functions: ["infer-criteria"]
 */
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Import the exported extractHeading directly
import { extractHeading } from "./index.ts";

// ─── extractHeading unit tests ──────────────────────────────────────────────

Deno.test("inline heading: ## Heading: value", () => {
  const text = `Some intro\n## Logline: A detective hunts a killer\n## Premise`;
  assertEquals(extractHeading(text, "LOGLINE"), "A detective hunts a killer");
});

Deno.test("inline heading: **Heading:** value", () => {
  const text = `**Protagonist:** Jane Doe, a retired spy`;
  assertEquals(extractHeading(text, "PROTAGONIST"), "Jane Doe, a retired spy");
});

Deno.test("block heading: ## Heading followed by blank line + content", () => {
  const text = `# Title\n\n## Premise\n\nA detective in 1920s Berlin discovers a conspiracy that reaches the highest levels of government.\n\n## Why Now\n\nTimely themes.`;
  const result = extractHeading(text, "PREMISE");
  assertEquals(result, "A detective in 1920s Berlin discovers a conspiracy that reaches the highest levels of government.");
});

Deno.test("block heading: content stops at next heading", () => {
  const text = `## Stakes\n\nIf the hero fails, the world ends.\n\n## Comparables\n\nSomething else.`;
  const result = extractHeading(text, "STAKES");
  assertEquals(result, "If the hero fails, the world ends.");
});

Deno.test("block heading: content near EOF (no trailing heading)", () => {
  const text = `## Antagonist\n\nThe corrupt mayor controls everything.`;
  const result = extractHeading(text, "ANTAGONIST");
  assertEquals(result, "The corrupt mayor controls everything.");
});

Deno.test("repeated headings: first match wins", () => {
  const text = `## Logline\n\nFirst logline here.\n\n## Other\n\nStuff\n\n## Logline\n\nSecond logline.`;
  // extractHeading should return the first match
  assertEquals(extractHeading(text, "LOGLINE"), "First logline here.");
});

Deno.test("multiline block: collapses to first paragraph", () => {
  const text = `## Premise\n\nLine one of the premise.\nLine two continues here.\n\nSecond paragraph should not be included.\n\n## Next`;
  const result = extractHeading(text, "PREMISE");
  assertEquals(result, "Line one of the premise. Line two continues here.");
});

Deno.test("heading variants: tries each variant in order", () => {
  const text = `## The Concept\n\nA gripping tale of survival.`;
  assertEquals(extractHeading(text, "PREMISE", "THE CONCEPT"), "A gripping tale of survival.");
});

Deno.test("returns empty string when heading not found", () => {
  const text = `Just some random text without headings.`;
  assertEquals(extractHeading(text, "PROTAGONIST"), "");
});

Deno.test("heading with dash separator: ## Heading - value", () => {
  const text = `## Protagonist – Maria, a young nurse`;
  assertEquals(extractHeading(text, "PROTAGONIST"), "Maria, a young nurse");
});

// ─── Full concept_brief fixture integration test ────────────────────────────

Deno.test("full concept_brief fixture: all 8 fields populate", () => {
  const fixture = `# Test Project — Concept Brief

## Logline

A disgraced surgeon must clear her name by infiltrating a corrupt hospital network before they silence her forever.

## Premise

Dr. Elena Vasquez was the top cardiac surgeon in Chicago until a botched operation — sabotaged by a corrupt colleague — destroyed her reputation. Now blacklisted, she discovers the colleague is part of a hospital network running illegal organ trafficking. Elena goes undercover to expose them, but every step deeper puts her closer to the people who want her dead.

## Protagonist

Dr. Elena Vasquez — a brilliant, driven surgeon haunted by the patient she lost. She's methodical but increasingly reckless as her investigation intensifies.

## Antagonist

Dr. Marcus Hale — Elena's former mentor turned kingpin of the trafficking ring. Charming on the surface, ruthless underneath. He believes he's saving more lives than he's taking.

## Stakes

If Elena fails, the trafficking ring continues operating in plain sight, and she becomes their next victim. If she succeeds, she reclaims her career but exposes a system that implicates people she once trusted.

## Comparables

The Good Nurse, Dopesick, Anatomy of a Scandal

## Tone & Genre

Medical thriller with neo-noir undertones. Tense, claustrophobic, morally grey.

## World Rules

Set in modern-day Chicago. The hospital system operates with realistic medical procedures but the underground network uses cutting-edge black-market tech for organ preservation.
`;

  // Test each field extraction
  const logline = extractHeading(fixture, "LOGLINE");
  assertNotEquals(logline, "", "logline should not be empty");
  assertEquals(logline.includes("disgraced surgeon"), true, "logline content");

  const premise = extractHeading(fixture, "PREMISE", "THE CONCEPT");
  assertNotEquals(premise, "", "premise should not be empty");
  assertEquals(premise.includes("Elena Vasquez"), true, "premise mentions protagonist");

  const protagonist = extractHeading(fixture, "PROTAGONIST", "LEAD CHARACTER", "HERO", "MAIN CHARACTER");
  assertNotEquals(protagonist, "", "protagonist should not be empty");
  assertEquals(protagonist.includes("Elena"), true, "protagonist name");

  const antagonist = extractHeading(fixture, "ANTAGONIST", "VILLAIN", "OPPOSITION");
  assertNotEquals(antagonist, "", "antagonist should not be empty");
  assertEquals(antagonist.includes("Marcus Hale"), true, "antagonist name");

  const stakes = extractHeading(fixture, "STAKES", "CORE TENSION");
  assertNotEquals(stakes, "", "stakes should not be empty");
  assertEquals(stakes.includes("trafficking"), true, "stakes content");

  const comparables = extractHeading(fixture, "COMPARABLES", "COMPS", "COMP TITLES");
  assertNotEquals(comparables, "", "comparables should not be empty");
  assertEquals(comparables.includes("Good Nurse"), true, "comparables content");

  const toneGenre = extractHeading(fixture, "TONE", "GENRE(?! BLEND)", "TONE.GENRE", "TONE & GENRE");
  assertNotEquals(toneGenre, "", "tone_genre should not be empty");
  assertEquals(toneGenre.includes("thriller"), true, "tone genre content");

  const worldRules = extractHeading(fixture, "WORLD RULES", "WORLD.BUILDING", "WORLD BUILDING", "SETTING");
  assertNotEquals(worldRules, "", "world_rules should not be empty");
  assertEquals(worldRules.includes("Chicago"), true, "world rules content");
});

// ─── Guardrail tests: junk rejection ────────────────────────────────────────

Deno.test("junk: '## Risk Summary' should not match STAKES via 'Summary'", () => {
  const text = `## Risk Summary\n\nSome risk content here.\n\n## Stakes\n\nActual stakes.`;
  // STAKES heading set does NOT include "RISK" or "RISK SUMMARY"
  const result = extractHeading(text, "STAKES", "CORE TENSION");
  assertEquals(result, "Actual stakes.");
});

Deno.test("junk: 'World Density' section should not match WORLD RULES", () => {
  const text = `## World Density / Scale Constraints\n\n- Budget: low\n\n## Setting\n\nMedieval France.`;
  // WORLD RULES heading set does not include bare "WORLD" or "WORLD DENSITY"
  const result = extractHeading(text, "WORLD RULES", "WORLD BUILDING", "SETTING");
  assertEquals(result, "Medieval France.");
});
