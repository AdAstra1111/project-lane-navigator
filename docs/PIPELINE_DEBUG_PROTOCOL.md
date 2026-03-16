# Pipeline Debug Protocol
**Mandatory reading before touching auto-run or dev-engine-v2**

---

## THE RULE

**Before writing a single line of code, I must complete the full investigation below. No exceptions.**

If I skip steps and write code first, I will create cascading bugs like I did on 2026-03-16 (PRs #4–#9, all caused by one bad assumption about `respondWithJob`).

---

## Step 1: Identify the EXACT stall point

Check the Mission Control "Current" step label. Map it to a line in `auto-run/index.ts` before doing anything else.

| Step label | What it means | Where in code |
|---|---|---|
| `prep_setup_retry` | Canon OS extract failing, PREP_SETUP gate | ~L6862 |
| `fresh_review_required` | Active version not yet analyzed | ~L6107 |
| `CRITERIA_STALE_PROVENANCE` | Canon hash mismatch stall | ~L7801 |
| `approval_required` | Promotion gate waiting for user | ~L10439 |
| `note_exhaustion_blocked` | Actionable notes blocking promote | ~L10392 |
| `decisions_auto_applied` | Auto-apply ran, continuing | ~L6479 |

---

## Step 2: Understand the self-chain architecture FIRST

**This is the root cause of all my bugs on 2026-03-16. Read this before every code change.**

### How the pipeline actually works:

```
Frontend polls job status
  → sees status="running", can_run_next=true
  → calls POST /auto-run { action: "run-next" }
    → PREP_SETUP gate runs (sync)
      → if fails: return "run-next" HTTP response ← NOBODY FIRES THIS
        The PREP_SETUP self-chain is a DELAYED FETCH to /auto-run run-next
        That delayed fetch IS what continues the pipeline
      → if passes: bgTask spawns (async, fire-and-forget via waitUntil)
        bgTask completes → self-chain fetch to /auto-run { action: "run-next" }
        That fetch runs a NEW run-next invocation → PREP_SETUP → bgTask → repeat
```

### The critical rule about `respondWithJob(supabase, jobId, "run-next")`:

**`respondWithJob` returns an HTTP response to the CALLER. It does NOT invoke run-next.**

If I call `respondWithJob(supabase, jobId, "run-next")` inside `apply-decisions-and-continue`, that HTTP response goes back to whoever called `apply-decisions-and-continue`. If that caller is a bgTask self-chain fire-and-forget (`fetch(...).then(r => log).catch(log)`), the response is **thrown away**. Nobody fires run-next. Pipeline freezes.

### The ONLY valid self-chain targets from bgTask or PREP_SETUP:

- `{ action: "run-next", jobId }` — the original, always works
- `{ action: "apply-decisions-and-continue", jobId, selectedOptions: [...] }` — ONLY works if the response is processed by a human-triggered UI call (not a fire-and-forget)

**Never change bgTask or PREP_SETUP self-chains to use apply-decisions-and-continue.**

---

## Step 3: Before writing ANY code fix, draw the call chain

On paper or in a comment block, write out:

```
1. What fires this code?
2. What does this code return/respond with?
3. Who receives that response?
4. What does the receiver do with it?
5. Is there a path where nobody processes the response? (= pipeline freeze)
```

If step 5 is YES → do NOT write this code. Find a different approach.

---

## Step 4: Check ALL occurrences of a pattern before changing it

When I changed bgTask self-chains in PR #4, I changed 2 lines. But the SAME pattern existed in 2 more lines in PREP_SETUP recovery (L6891, L6982). I missed them.

**Rule: `grep -n "pattern" file` BEFORE and AFTER every change. Verify count matches.**

---

## Step 5: One fix at a time, verify CI deploys, check pipeline advances

- Merge → wait for CI deploy → check step count
- If step count doesn't advance within 5 minutes → the fix didn't work, investigate more before making another PR
- Do NOT stack multiple PRs on top of each other without verifying each one

---

## Step 6: The Canon OS extract non-issue

The `prep_setup_retry` for Canon OS extract is **non-blocking** when `allow_defaults=true`. After 3 attempts it logs `prep_setup_skipped` and falls through to generation. This is CORRECT behavior. Do not chase this as a blocker unless the pipeline is stuck AND step count is confirmed not advancing after 5+ minutes.

The Canon extract `parse_failed` / `no_extractable_fields` → `extractOk = false` → after 3 attempts → `setup_skipped` → generation proceeds. Normal.

---

## Step 7: How to diagnose a genuine freeze (status=running, step count not moving)

1. Check `is_processing` and `processing_started_at` — is the lock stale (>120s)?
2. If stale: reload the app page — status poll releases the lock
3. After lock release: check if "Run next" button becomes enabled
4. If "Run next" is enabled but nobody clicks it: the frontend isn't auto-polling. Check if browser tab is open.
5. If "Run next" is disabled: another invocation re-acquired the lock. Wait 30s and check step count.
6. If step count hasn't moved in 10 minutes with status=running + is_processing=true: bgTask is timing out (treatment generation >400s). In this case the fix is at the GENERATION level (chunked/streaming), NOT the self-chain.

---

## Summary of bugs I created on 2026-03-16 and why

| PR | Change | Bug introduced | Root cause |
|---|---|---|---|
| PR #4 | bgTask self-chain → apply-decisions-and-continue | Pipeline froze at step 13 | respondWithJob returns to caller; fire-and-forget caller throws it away |
| PR #5 | apply-decisions-and-continue empty fallback | Dead code; nobody calls it with auto_apply=true | Fixing my own bug wrong |
| PR #8 | Reverted bgTask chains only | PREP_SETUP chains still broken | Didn't grep for all occurrences |
| PR #9 | Fixed PREP_SETUP chains | Fixed | Correct |

PRs #4, #5, #8 were all my fault from one bad assumption. PR #6 (requires_human bypass) and PR #3 (LOVABLE_API_KEY fix) were genuinely correct fixes.

**If I'm making more than one PR to fix the same issue, I've misunderstood the root cause. Stop and re-read.**
