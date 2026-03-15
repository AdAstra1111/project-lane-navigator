# LARA LANE — IFFY STAFF ENGINEER REVIEW PROTOCOL

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
