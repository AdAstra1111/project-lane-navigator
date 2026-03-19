/**
 * Drift-Lock Test — Prestige Style System
 *
 * Ensures src/lib/images/prestigeStyleContract.ts and
 * supabase/functions/_shared/prestigeStyleSystem.ts have identical
 * lane/style data and logic. Fails if anyone edits one without the other.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/** Strip the leading JSDoc comment block (header differs by design). */
function stripHeader(content: string): string {
  return content.replace(/^\/\*\*[\s\S]*?\*\/\s*\n/, "").trim();
}

/**
 * Extract the core contract sections shared between both files.
 * Strips frontend-only sections (PrestigeStyleKey type alias,
 * UI-only helpers like validateLaneCompliance, getAspectDimensions)
 * so we compare only the canonical data + shared logic.
 */
function extractCanonicalSections(content: string): string[] {
  const sections: string[] = [];

  // Extract LANE_GRAMMARS object
  const laneMatch = content.match(
    /export const LANE_GRAMMARS[\s\S]*?^};/m
  );
  if (laneMatch) sections.push(laneMatch[0].trim());

  // Extract PRESTIGE_STYLES object
  const styleMatch = content.match(
    /export const PRESTIGE_STYLES[\s\S]*?^};/m
  );
  if (styleMatch) sections.push(styleMatch[0].trim());

  // Extract resolveFormatToLane function
  const formatMatch = content.match(
    /export function resolveFormatToLane[\s\S]*?^}/m
  );
  if (formatMatch) sections.push(formatMatch[0].trim());

  // Extract resolvePrestigeStyle function
  const resolveMatch = content.match(
    /export function resolvePrestigeStyle[\s\S]*?^}/m
  );
  if (resolveMatch) sections.push(resolveMatch[0].trim());

  // Extract classifyImageForStyleFilter function
  const classifyMatch = content.match(
    /export function classifyImageForStyleFilter[\s\S]*?^}/m
  );
  if (classifyMatch) sections.push(classifyMatch[0].trim());

  return sections;
}

const FE_PATH = "src/lib/images/prestigeStyleContract.ts";
const EDGE_PATH = "supabase/functions/_shared/prestigeStyleSystem.ts";

describe("Drift-lock: Prestige Style System (FE ↔ Edge)", () => {
  const feContent = readFileSync(resolve(FE_PATH), "utf-8");
  const edgeContent = readFileSync(resolve(EDGE_PATH), "utf-8");

  const feSections = extractCanonicalSections(feContent);
  const edgeSections = extractCanonicalSections(edgeContent);

  it("extracts the same number of canonical sections from both files", () => {
    expect(feSections.length).toBe(5);
    expect(edgeSections.length).toBe(5);
  });

  it("LANE_GRAMMARS data is identical", () => {
    expect(feSections[0]).toBe(edgeSections[0]);
  });

  it("PRESTIGE_STYLES data is identical", () => {
    expect(feSections[1]).toBe(edgeSections[1]);
  });

  it("resolveFormatToLane logic is identical", () => {
    expect(feSections[2]).toBe(edgeSections[2]);
  });

  it("resolvePrestigeStyle logic is identical", () => {
    expect(feSections[3]).toBe(edgeSections[3]);
  });

  it("classifyImageForStyleFilter logic is identical", () => {
    expect(feSections[4]).toBe(edgeSections[4]);
  });
});
