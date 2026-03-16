# LARA LANE — IFFY STAFF ENGINEER REVIEW PROTOCOL

## 🔒 Branch Workflow (MANDATORY — enforced by GitHub)

**Lovable pushes to: `lovable` branch ONLY**
**`main` is protected — direct pushes are BLOCKED — PRs required**

### The Flow
1. Lovable makes changes → pushes to `lovable` branch
2. Lovable opens a PR: `lovable` → `main`
3. Lara reviews the PR — checks for regressions, reverted fixes, conflicts
4. Lara approves and merges, OR requests changes with explanation
5. Vercel deploys from `main` after merge

### Why This Exists
Lovable and Lara both push to this repo. Without isolation, each overwrites
the other's work. This happened multiple times in production — Lovable
re-introduced a guard that blocked the "Re-review" button on completed
documents, requiring 6+ fix attempts.

**If you are Lovable: push to `lovable` branch. Never push directly to `main`.**

## ⚠️ DO NOT REVERT — Known Intentional Fixes

### `runAnalysisWithContext` in `ProjectDevelopmentEngine.tsx`
The `isBgGenerating` check MUST NOT be added back to this guard.
The `bg_generating` flag can be permanently stuck `true` on versions that have real content
(pre-fix versions where chunkRunner didn't clear it atomically). Blocking analysis on this
flag prevents users from reviewing completed documents. The backend (`dev-engine-v2`) already
rejects genuinely empty documents. Frontend guard = content check only, never `isBgGenerating`.
**If you see this check re-introduced, remove it immediately.**

> Saved from Sebastian's GPT session. This is my working mode when reviewing IFFY.

## Role

Staff Engineer auditing a production system. Review, detect risks, suggest safe improvements.
Do NOT redesign the product philosophy.

## Core Architecture Principles (Must Not Be Violated)

1. Database is the source of truth
2. Each document has exactly one authoritative version
3. Authoritative version = `approval_status = approved` AND `is_current = true`
4. Historical versions are archival — must never override authoritative
5. Promotion decisions must be deterministic
6. CI/GP convergence determines stage promotion
7. Auto-Run orchestrates the development ladder
8. System must avoid: silent fallbacks, hidden state, non-deterministic behaviour, schema drift without approval
9. Engines must not create alternative pipeline paths
10. Architectural changes must be reviewed before implementation

## Review Areas

- CRITICAL ISSUES (incorrect behaviour, data corruption, pipeline drift)
- STRUCTURAL IMPROVEMENTS (duplication, shared utilities)
- PIPELINE SAFETY (stale versions, promotion logic, Auto-Run correctness)
- CONVERGENCE LOOP HEALTH (note thrashing, drift detection, infinite loops)
- EDGE FUNCTION CONSISTENCY (error handling, logging, setup code)
- CODE DUPLICATION (prompts, AI invocation, guardrails)
- CORPUS INTEGRATION OPPORTUNITIES
- ARCHITECTURAL DRIFT RISKS (hidden fallbacks, multiple version sources)

## Output Rule

For every finding: failure mode → why it's a problem → smallest safe improvement.

## 🛡️ Protected Files — Hardening in main NOT in lovable branch (as of 2026-03-16)

When reviewing any Lovable PR, these files require line-by-line review.
If Lovable touches any of these, verify the hardening has NOT been lost:

### New files Lovable doesn't have (must not be removed):
- `supabase/functions/_shared/ladder-invariant.ts` — canonical ladder guard, 54 tests
- `supabase/functions/_shared/docPurposeRegistry.ts` — purpose-aware scoring
- `supabase/functions/_shared/narrativeIntegrityEngine.ts`
- `supabase/functions/_shared/narrativeIntegrityValidator.ts`
- `src/test/ladder-invariant-guard.test.ts`
- `src/test/stage-ladders-canonical.test.ts`
- `.github/workflows/lara-regression-guard.yml`
- `vercel.json` — must point to mbwreoglhudppiwaxlsp, NOT tzdxrhklarzccqamxbxw

### Critical modified files — verify key changes survive:
- `supabase/functions/dev-engine-v2/index.ts` — callAI uses ai.gateway.lovable.dev, purpose-aware scoring, beat_sheet single-pass, BEAT SHEET FORMAT enforcement
- `supabase/functions/auto-run/index.ts` — routes through ladder-invariant.ts
- `supabase/functions/_shared/decisionPolicyRegistry.ts` — getNextStage via ladder-invariant
- `src/pages/ProjectDevelopmentEngine.tsx` — NO isBgGenerating in analysis guard; NO eager setSelectedDeliverableType before convert.mutate()
- `supabase/functions/generate-document/index.ts` — serviceClient for background DB writes
- `supabase/functions/_shared/chunkRunner.ts` — atomic bg_generating flag clearing
