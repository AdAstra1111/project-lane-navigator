/**
 * Regression + integration tests for infer-criteria extractHeading.
 */
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
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
  const text = `# Title\n\n## Premise\n\nA detective in 1920s Berlin discovers a conspiracy.\n\n## Why Now\n\nTimely themes.`;
  assertEquals(extractHeading(text, "PREMISE"), "A detective in 1920s Berlin discovers a conspiracy.");
});

Deno.test("block heading: content stops at next heading", () => {
  const text = `## Stakes\n\nIf the hero fails, the world ends.\n\n## Comparables\n\nSomething else.`;
  assertEquals(extractHeading(text, "STAKES"), "If the hero fails, the world ends.");
});

Deno.test("block heading: content near EOF (no trailing heading)", () => {
  const text = `## Antagonist\n\nThe corrupt mayor controls everything.`;
  assertEquals(extractHeading(text, "ANTAGONIST"), "The corrupt mayor controls everything.");
});

Deno.test("repeated headings: first match wins", () => {
  const text = `## Logline\n\nFirst logline here.\n\n## Other\n\nStuff\n\n## Logline\n\nSecond logline.`;
  assertEquals(extractHeading(text, "LOGLINE"), "First logline here.");
});

Deno.test("multiline block: collapses to first paragraph", () => {
  const text = `## Premise\n\nLine one of the premise.\nLine two continues here.\n\nSecond paragraph should not be included.\n\n## Next`;
  assertEquals(extractHeading(text, "PREMISE"), "Line one of the premise. Line two continues here.");
});

Deno.test("heading variants: tries each variant in order", () => {
  const text = `## The Concept\n\nA gripping tale of survival.`;
  assertEquals(extractHeading(text, "PREMISE", "THE CONCEPT"), "A gripping tale of survival.");
});

Deno.test("returns empty string when heading not found", () => {
  assertEquals(extractHeading("Just some random text.", "PROTAGONIST"), "");
});

Deno.test("heading with em-dash separator: ## Heading – value", () => {
  const text = `## Protagonist – Maria, a young nurse`;
  assertEquals(extractHeading(text, "PROTAGONIST"), "Maria, a young nurse");
});

// ─── Full concept_brief fixture: all 8 fields populate ──────────────────────

const FIXTURE = `# Test Project — Concept Brief

## Logline

A disgraced surgeon must clear her name by infiltrating a corrupt hospital network before they silence her forever.

## Premise

Dr. Elena Vasquez was the top cardiac surgeon in Chicago until a botched operation — sabotaged by a corrupt colleague — destroyed her reputation. Now blacklisted, she discovers the colleague is part of a hospital network running illegal organ trafficking.

## Protagonist

Dr. Elena Vasquez — a brilliant, driven surgeon haunted by the patient she lost.

## Antagonist

Dr. Marcus Hale — Elena's former mentor turned kingpin of the trafficking ring.

## Stakes

If Elena fails, the trafficking ring continues operating in plain sight, and she becomes their next victim.

## Comparables

The Good Nurse, Dopesick, Anatomy of a Scandal

## Tone & Genre

Medical thriller with neo-noir undertones. Tense, claustrophobic, morally grey.

## World Rules

Set in modern-day Chicago. The hospital system operates with realistic medical procedures.
`;

Deno.test("fixture: logline", () => {
  const v = extractHeading(FIXTURE, "LOGLINE");
  assertNotEquals(v, "", "logline should not be empty");
  assertEquals(v.includes("disgraced surgeon"), true);
});

Deno.test("fixture: premise", () => {
  const v = extractHeading(FIXTURE, "PREMISE", "THE CONCEPT");
  assertNotEquals(v, "", "premise should not be empty");
  assertEquals(v.includes("Elena Vasquez"), true);
});

Deno.test("fixture: protagonist", () => {
  const v = extractHeading(FIXTURE, "PROTAGONIST", "LEAD CHARACTER", "HERO", "MAIN CHARACTER");
  assertNotEquals(v, "", "protagonist should not be empty");
  assertEquals(v.includes("Elena"), true);
});

Deno.test("fixture: antagonist", () => {
  const v = extractHeading(FIXTURE, "ANTAGONIST", "VILLAIN");
  assertNotEquals(v, "", "antagonist should not be empty");
  assertEquals(v.includes("Marcus Hale"), true);
});

Deno.test("fixture: stakes", () => {
  const v = extractHeading(FIXTURE, "STAKES", "CORE TENSION");
  assertNotEquals(v, "", "stakes should not be empty");
  assertEquals(v.includes("trafficking"), true);
});

Deno.test("fixture: comparables", () => {
  const v = extractHeading(FIXTURE, "COMPARABLES", "COMPS");
  assertNotEquals(v, "", "comparables should not be empty");
  assertEquals(v.includes("Good Nurse"), true);
});

Deno.test("fixture: tone_genre via TONE & GENRE", () => {
  const v = extractHeading(FIXTURE, "TONE & GENRE", "TONE", "GENRE(?! BLEND)");
  assertNotEquals(v, "", "tone_genre should not be empty");
  assertEquals(v.includes("thriller"), true);
});

Deno.test("fixture: world_rules", () => {
  const v = extractHeading(FIXTURE, "WORLD RULES", "WORLD BUILDING", "SETTING");
  assertNotEquals(v, "", "world_rules should not be empty");
  assertEquals(v.includes("Chicago"), true);
});

// ─── Guardrail: junk rejection ──────────────────────────────────────────────

Deno.test("junk: Risk Summary should not match STAKES", () => {
  const text = `## Risk Summary\n\nSome risk.\n\n## Stakes\n\nActual stakes.`;
  assertEquals(extractHeading(text, "STAKES", "CORE TENSION"), "Actual stakes.");
});

Deno.test("junk: World Density should not match WORLD RULES", () => {
  const text = `## World Density / Scale Constraints\n\n- Budget: low\n\n## Setting\n\nMedieval France.`;
  assertEquals(extractHeading(text, "WORLD RULES", "WORLD BUILDING", "SETTING"), "Medieval France.");
});
