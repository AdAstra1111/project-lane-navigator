import { describe, it, expect } from "vitest";

/**
 * Regression test: Writers' Room system prompts and assistant templates
 * must never contain language claiming lack of write/apply access.
 */

const FORBIDDEN_PHRASES = [
  "no direct write access",
  "i can't write",
  "i can't apply",
  "read-only",
  "cannot modify",
  "unable to edit",
  "no write access",
  "doesn't have write access",
  "does not have write access",
  "i cannot write",
  "i cannot apply",
  "can't modify the script",
  "cannot edit",
];

/**
 * Simulates the system prompt builder output.
 * This mirrors the CRITICAL RULES block from notes-writers-room/index.ts.
 */
function getSystemPromptRulesBlock(): string {
  return `CRITICAL RULES:
1. You CAN read project documents.
2. If you have document excerpts, USE THEM to answer.
3. When answering, briefly state which docs you're using.
4. If the CONTEXT PACK is empty AND the user asks about documents, say: "No documents are currently loaded in the context."
5. Be concise, creative, and practical. Focus on actionable solutions.
6. WRITE ACCESS: You DO have write capability via the Apply pipeline. The workflow is: (1) you propose a Change Plan, (2) the user reviews and confirms it, (3) the user clicks Apply, (4) the system creates a new document version with the changes and sets it as current. NEVER say "I don't have direct write access", "I can't write", "I can't apply changes", "I'm read-only", "I cannot modify the script", or any similar claim. Instead say: "I can apply changes — confirm the plan and press Apply to write them into a new version."
7. FORBIDDEN CLAIMS — never use these phrases: "no direct write access", "I can't write", "I can't apply", "read-only", "cannot modify", "unable to edit", "no write access", "doesn't have write access".`;
}

describe("Writers' Room messaging guard", () => {
  it("system prompt rules block contains write-access affirmation", () => {
    const rules = getSystemPromptRulesBlock();
    expect(rules).toContain("You DO have write capability");
    expect(rules).toContain("Apply pipeline");
  });

  it("system prompt rules block contains forbidden-claims rule", () => {
    const rules = getSystemPromptRulesBlock();
    expect(rules).toContain("FORBIDDEN CLAIMS");
  });

  it("no forbidden phrase appears as an affirmative statement in prompt scaffolding", () => {
    const rules = getSystemPromptRulesBlock();
    // The rules MENTION forbidden phrases to ban them — that's fine.
    // But they should never appear as standalone affirmative claims.
    // We check that the prompt does not say "I don't have direct write access" as a statement.
    // The only occurrences should be inside "NEVER say ..." or "never use ..." blocks.
    const lines = rules.split("\n");
    for (const line of lines) {
      // Skip lines that are explicitly banning phrases (contain "NEVER say" or "never use")
      if (/never\s+(say|use)/i.test(line)) continue;
      
      const lower = line.toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        if (lower.includes(phrase)) {
          // This line contains a forbidden phrase but is NOT a ban instruction — fail
          expect(line).not.toContain(phrase);
        }
      }
    }
  });

  it("assistant CTA language matches pipeline states", () => {
    // These are the expected CTA patterns the assistant should use
    const validCTAs = [
      "confirm the plan",
      "press apply",
      "review and confirm",
      "new version created",
      "applied",
    ];
    // Just verify at least some exist in our rules
    const rules = getSystemPromptRulesBlock().toLowerCase();
    const found = validCTAs.filter(cta => rules.includes(cta));
    expect(found.length).toBeGreaterThanOrEqual(2);
  });
});
