import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * Regression tests for extractEntitiesFromText — the canonical entity
 * extractor used by canon-alignment gating (buildCanonEntitiesFromDB).
 *
 * Mirror of the private function from docPolicyRegistry.ts for test isolation.
 */

const STRUCTURAL_TERMS = new Set([
  "WORLD RULES", "ROLE", "PHYSICAL DESCRIPTION", "BACKSTORY", "MOTIVATION",
  "PERSONALITY", "TRAITS", "GOALS", "SECRETS", "RELATIONSHIPS", "APPEARANCE",
  "DESCRIPTION", "OVERVIEW", "SUMMARY", "BACKGROUND", "HISTORY", "ARC",
  "CHARACTER ARC", "INTERNAL CONFLICT", "EXTERNAL CONFLICT", "CONFLICT",
  "STAKES", "THEME", "TONE", "STYLE", "FORMAT", "GENRE", "SETTING",
  "LOCATION", "LOCATIONS", "TIMELINE", "PREMISE", "LOGLINE", "CONCEPT",
  "SYNOPSIS", "TREATMENT", "OUTLINE", "NOTES", "DIALOGUE STYLE",
  "VOICE", "MANNERISMS", "FLAWS", "STRENGTHS", "WEAKNESSES",
  "EMOTIONAL ARC", "TRANSFORMATION", "WANT", "NEED", "FEAR",
  "OCCUPATION", "AGE", "GENDER", "ETHNICITY", "NATIONALITY",
  "KEY RELATIONSHIPS", "FAMILY", "ALLIES", "ENEMIES", "MENTOR",
  "FORBIDDEN CHANGES", "LOCKED FACTS", "ONGOING THREADS",
  "FORMAT CONSTRAINTS", "TONE AND STYLE", "TONE STYLE",
  "ACT ONE", "ACT TWO", "ACT THREE", "COLD OPEN", "TEASER",
  "INCITING INCIDENT", "MIDPOINT", "CLIMAX", "RESOLUTION", "DENOUEMENT",
]);

function isStructuralTerm(name: string): boolean {
  return STRUCTURAL_TERMS.has(name.toUpperCase().trim());
}

function extractEntitiesFromText(text: string): string[] {
  if (!text) return [];
  const entities = new Set<string>();
  for (const m of text.matchAll(/\*\*([A-Z][A-Za-z \t'-]{1,30}?)\*\*/g)) {
    const name = m[1].trim();
    if (!isStructuralTerm(name)) entities.add(name);
  }
  for (const m of text.matchAll(/^#+[ \t]*([A-Z][A-Za-z \t'-]{1,30})/gm)) {
    const name = m[1].trim();
    if (!isStructuralTerm(name)) entities.add(name);
  }
  for (const m of text.matchAll(/^([A-Z][A-Z \t'-]{1,24})[ \t]*[(:]/gm)) {
    const name = m[1].trim();
    if (name.length >= 2 && !name.includes("SCENE") && !name.includes("FADE") && !name.includes("CUT") && !isStructuralTerm(name)) {
      entities.add(name);
    }
  }
  return [...entities];
}

// ── Valid entity extraction ──

Deno.test("extracts **Bold Name** entities", () => {
  const result = extractEntitiesFromText("Meet **Anya Sharma** and **Elias Vance**.");
  assertEquals(result.includes("Anya Sharma"), true);
  assertEquals(result.includes("Elias Vance"), true);
});

Deno.test("extracts ## Heading Name entities", () => {
  const result = extractEntitiesFromText("## Anya Sharma\nA brilliant scientist.\n## Elias Vance\nHer rival.");
  assertEquals(result.includes("Anya Sharma"), true);
  assertEquals(result.includes("Elias Vance"), true);
});

Deno.test("extracts UPPERCASE NAME: entities", () => {
  const result = extractEntitiesFromText("ANYA SHARMA: A brilliant scientist.\nELIAS VANCE (45):");
  assertEquals(result.includes("ANYA SHARMA"), true);
  assertEquals(result.includes("ELIAS VANCE"), true);
});

// ── Structural term exclusion ──

Deno.test("excludes structural headers like ROLE, BACKSTORY", () => {
  const result = extractEntitiesFromText("## ROLE\nProtagonist\n## BACKSTORY\nA prodigy.");
  assertEquals(result.includes("ROLE"), false);
  assertEquals(result.includes("BACKSTORY"), false);
});

Deno.test("excludes bold structural terms like **Motivation**", () => {
  const result = extractEntitiesFromText("**Motivation**: to save the world\n**Anya Sharma**: the hero");
  assertEquals(result.includes("Motivation"), false);
  assertEquals(result.includes("Anya Sharma"), true);
});

Deno.test("excludes STRUCTURAL TERM: patterns", () => {
  const result = extractEntitiesFromText("BACKSTORY: born in 1990\nANYA SHARMA: scientist");
  assertEquals(result.includes("BACKSTORY"), false);
  assertEquals(result.includes("ANYA SHARMA"), true);
});

// ── CRITICAL: header+content fragment prevention ──

Deno.test("does NOT capture cross-line ROLE\\n\\nprotagonist", () => {
  const text = "## ROLE\n\nprotagonist\n\n## PHYSICAL DESCRIPTION\n\nSharp features";
  const result = extractEntitiesFromText(text);
  for (const entity of result) {
    assertEquals(entity.includes("\n"), false, `Entity "${entity}" contains newline`);
    assertEquals(entity.includes("protagonist"), false, `Entity "${entity}" contains content fragment`);
    assertEquals(entity.includes("Sharp"), false, `Entity "${entity}" contains content fragment`);
  }
});

Deno.test("does NOT capture BACKSTORY\\n\\nA prodigy in glaciol", () => {
  const text = "## BACKSTORY\n\nA prodigy in glaciology\n\n## MOTIVATION\n\nHer 'want' is to explore";
  const result = extractEntitiesFromText(text);
  for (const entity of result) {
    assertEquals(entity.includes("\n"), false, `Entity "${entity}" contains newline`);
    assertEquals(entity.includes("prodigy"), false, `Entity "${entity}" contains content fragment`);
  }
});

Deno.test("does NOT capture ARC\\n\\nFrom an isolated academic", () => {
  const text = "## ARC\n\nFrom an isolated academic to a leader";
  const result = extractEntitiesFromText(text);
  for (const entity of result) {
    assertEquals(entity.includes("\n"), false, `Entity "${entity}" contains newline`);
    assertEquals(entity.includes("isolated"), false, `Entity "${entity}" contains content fragment`);
  }
});

Deno.test("no entity ever contains a newline character", () => {
  const text = `## Anya Sharma
Role: Protagonist

## BACKSTORY

A prodigy in glaciology who became obsessed.

## Elias Vance
Role: Antagonist

**MOTIVATION**

To prevent catastrophe.

PHYSICAL DESCRIPTION:
Sharp features, tall.`;
  const result = extractEntitiesFromText(text);
  for (const entity of result) {
    assertEquals(entity.includes("\n"), false, `Entity "${entity}" contains newline`);
  }
  assertEquals(result.includes("Anya Sharma"), true);
  assertEquals(result.includes("Elias Vance"), true);
});

// ── Empty / edge cases ──

Deno.test("returns empty for empty text", () => {
  assertEquals(extractEntitiesFromText(""), []);
  assertEquals(extractEntitiesFromText(null as unknown as string), []);
});
