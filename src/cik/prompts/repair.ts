/**
 * CIK Prompt Library — Repair instruction template builder
 * Lane-aware, bounded, deterministic. Mirrors cinematic-repair.ts contract.
 * This module provides the canonical repair contract shape for testing/validation.
 */

import { MAX_REPAIR_CHARS } from "./base";
import { getLaneOverlay } from "./lane_overlays";
import { PROMPT_VERSION } from "./versions";

/** Required blocks that must appear in every repair instruction. */
export const REQUIRED_REPAIR_BLOCKS = [
  "CRITICAL REPAIR CONSTRAINTS",
  "CONSTRAINTS (ATTEMPT 1)",
  "PROCEDURE (MANDATORY",
] as const;

/** Optional blocks that may be present. */
export const OPTIONAL_REPAIR_BLOCKS = [
  "NUMERIC TARGETS",
  "CONTEXT-AWARE NUMERIC TARGETS",
  "INTENT SEQUENCING",
  "TONAL RAMP LOCK",
  "LADDER LOCK",
  "STYLE LOCK",
  "BUTTON ENDING",
  "UNIT ROLE LOCK",
] as const;

/**
 * Validate that a repair instruction conforms to the contract.
 * Returns { valid, issues } for deterministic testing.
 */
export function validateRepairInstruction(instruction: string): {
  valid: boolean;
  issues: string[];
  charCount: number;
  hasRequiredBlocks: boolean;
  promptVersion: string;
} {
  const issues: string[] = [];
  const charCount = instruction.length;

  if (charCount > MAX_REPAIR_CHARS) {
    issues.push(`Exceeds MAX_REPAIR_CHARS: ${charCount} > ${MAX_REPAIR_CHARS}`);
  }

  if (charCount === 0) {
    issues.push("Empty repair instruction");
  }

  const missingBlocks = REQUIRED_REPAIR_BLOCKS.filter(
    block => !instruction.includes(block)
  );
  const hasRequiredBlocks = missingBlocks.length === 0;
  if (!hasRequiredBlocks) {
    issues.push(`Missing required blocks: ${missingBlocks.join(", ")}`);
  }

  return {
    valid: issues.length === 0,
    issues,
    charCount,
    hasRequiredBlocks,
    promptVersion: PROMPT_VERSION,
  };
}

/**
 * Validate that a system prompt with lane overlay stays within budget.
 */
export function validateSystemPromptBudget(
  basePrompt: string,
  lane?: string,
  maxChars: number = 12000,
): { valid: boolean; totalChars: number; issues: string[] } {
  const overlay = lane ? getLaneOverlay(lane) : undefined;
  const total = basePrompt + (overlay?.systemSuffix || "");
  const issues: string[] = [];

  if (total.length > maxChars) {
    issues.push(`System prompt exceeds budget: ${total.length} > ${maxChars}`);
  }

  return { valid: issues.length === 0, totalChars: total.length, issues };
}

export { MAX_REPAIR_CHARS };
