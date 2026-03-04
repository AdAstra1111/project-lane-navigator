#!/usr/bin/env bash
# Regression tripwires — grep-based checks for known anti-patterns.
# Run in CI or locally: bash scripts/regression-tripwires.sh

set -euo pipefail
FAIL=0

echo "=== Regression Tripwire: parseJsonSafe usage outside _shared/llm.ts ==="
HITS=$(grep -rn "parseJsonSafe(" supabase/functions/ --include="*.ts" | grep -v "_shared/llm.ts" | grep -v "node_modules" || true)
if [ -n "$HITS" ]; then
  echo "FAIL: parseJsonSafe() used outside _shared/llm.ts (deprecated):"
  echo "$HITS"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: setSearchParams({ used without merge helper ==="
HITS2=$(grep -RIn --include='*.ts' --include='*.tsx' -E 'setSearchParams[[:space:]]*\([[:space:]]*\{' src/ | grep -vE '^[^:]*:[[:space:]]*//' || true)
if [ -n "$HITS2" ]; then
  echo "FAIL: setSearchParams({ found (must use updateSearchParams merge helper):"
  echo "$HITS2"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: Stale CHUNKED_DOC_TYPES in edge functions ==="
HITS3=$(grep -RIn --include='*.ts' -E '\bCHUNKED_DOC_TYPES\b' supabase/functions/ | grep -v "node_modules" || true)
if [ -n "$HITS3" ]; then
  echo "FAIL: CHUNKED_DOC_TYPES referenced in edge (must use isLargeRiskDocType):"
  echo "$HITS3"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: Stale convertDocument reference in auto-run ==="
HITS5=$(grep -RIn --include='*.ts' -E '\bconvertDocument\b' supabase/functions/auto-run/ | grep -v "node_modules" || true)
if [ -n "$HITS5" ]; then
  echo "FAIL: convertDocument referenced in auto-run (must use explicit convert/generate path):"
  echo "$HITS5"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: Edge functions importing from src/ ==="
HITS4=$(grep -RIn --include='*.ts' -E "from ['\"].*src/" supabase/functions/ | grep -v "node_modules" || true)
if [ -n "$HITS4" ]; then
  echo "FAIL: Edge function imports from src/ (cross-boundary import):"
  echo "$HITS4"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: isDurationEligibleDocType must be imported from _shared ==="
HITS6=$(grep -rn "isDurationEligibleDocType" supabase/functions/auto-run/index.ts | grep -v "import" | grep -v "from.*eligibilityRegistry" || true)
HITS7=$(grep -rn "DURATION_ELIGIBLE_DOC_TYPES" supabase/functions/auto-run/index.ts || true)
if [ -n "$HITS7" ]; then
  echo "FAIL: Local DURATION_ELIGIBLE_DOC_TYPES found in auto-run (must use _shared/eligibilityRegistry):"
  echo "$HITS7"
  FAIL=1
else
  echo "PASS (no local duration set)"
fi

echo ""
echo "=== Regression Tripwire: eligibilityRegistry is canonical source ==="
HITS8=$(grep -rn "isDurationEligibleDocType" supabase/functions/ --include="*.ts" | grep -v "_shared/eligibilityRegistry" | grep -v "import.*eligibilityRegistry" | grep -v "node_modules" || true)
if [ -n "$HITS8" ]; then
  echo "WARN: isDurationEligibleDocType used outside import from eligibilityRegistry:"
  echo "$HITS8"
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: Hardcoded MAX_VERSIONS_PER_DOC_PER_JOB = 8 ==="
HITS9=$(grep -rn "MAX_VERSIONS_PER_DOC_PER_JOB\s*=\s*8" supabase/functions/ --include="*.ts" | grep -v "node_modules" || true)
if [ -n "$HITS9" ]; then
  echo "FAIL: Hardcoded cap of 8 found (must use per-job configurable cap with default 60):"
  echo "$HITS9"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: Version cap must be job-scoped (gte created_at) ==="
HITS10=$(grep -rn "rewrite_cap_reached" supabase/functions/auto-run/index.ts | grep -v "gte.*created_at" | grep -v "job-scoped" | head -1 || true)
# Just verify the .gte filter exists near version cap logic
HITS11=$(grep -c "\.gte.*created_at.*job\.created_at" supabase/functions/auto-run/index.ts || echo "0")
if [ "$HITS11" = "0" ]; then
  echo "FAIL: Version cap counting must be job-scoped (.gte created_at) but no gte filter found"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: UI start payload must include max_versions_per_doc_per_job ==="
HITS12=$(grep -c "max_versions_per_doc_per_job" src/hooks/useAutoRunMissionControl.ts || echo "0")
if [ "$HITS12" = "0" ]; then
  echo "FAIL: useAutoRunMissionControl must pass max_versions_per_doc_per_job in start payload"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: No hardcoded FORMAT_LADDERS outside _shared ==="
HITS13=$(grep -rn "const FORMAT_LADDERS" supabase/functions/ --include="*.ts" | grep -v "_shared/" | grep -v "STAGE_LADDERS.FORMAT_LADDERS" | grep -v "node_modules" || true)
if [ -n "$HITS13" ]; then
  echo "FAIL: Hardcoded FORMAT_LADDERS found outside _shared/ (must import from _shared/stage-ladders.ts):"
  echo "$HITS13"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: No banned legacy keys in canonical ladder source ==="
HITS14=$(grep -En "topline_narrative|\"blueprint\"|\"architecture\"" supabase/functions/_shared/stage-ladders.ts || true)
if [ -n "$HITS14" ]; then
  echo "FAIL: Banned legacy keys found in canonical stage-ladders.ts:"
  echo "$HITS14"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: CANON_MISMATCH must not set status=failed ==="
HITS15=$(grep -rn 'CANON_MISMATCH' supabase/functions/auto-run/index.ts | grep 'status.*failed\|failed.*CANON' | grep -v "canon_mismatch_stuck" || true)
if [ -n "$HITS15" ]; then
  echo "FAIL: CANON_MISMATCH sets status=failed (must use retryable canon_lock_retry or canon_mismatch_stuck pause):"
  echo "$HITS15"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: nextUnsatisfiedStage must not have per-stage auto_run_steps queries ==="
HITS16=$(grep -A2 'for.*let i.*currentIdx' supabase/functions/auto-run/index.ts | grep -c 'auto_run_steps' || echo "0")
if [ "$HITS16" != "0" ]; then
  echo "FAIL: nextUnsatisfiedStage contains per-stage auto_run_steps queries (must batch-fetch before loop):"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: versionByDocId must include label column ==="
HITS17=$(grep -A3 'versionByDocId' supabase/functions/auto-run/index.ts | grep -c 'label' || echo "0")
if [ "$HITS17" = "0" ]; then
  echo "FAIL: versionByDocId construction does not include label column"
  FAIL=1
else
  echo "PASS"
fi
echo ""
echo "=== Regression Tripwire: Canon-lock must not force exhaustive entity inclusion ==="
HITS18=$(grep -n "Every named character.*must appear" supabase/functions/auto-run/index.ts || true)
if [ -n "$HITS18" ]; then
  echo "FAIL: Canon-lock directive forces exhaustive inclusion (must use core/secondary language):"
  echo "$HITS18"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: normalizeCanonEntities helper must exist ==="
HITS19=$(grep -c "function normalizeCanonEntities" supabase/functions/auto-run/index.ts || echo "0")
if [ "$HITS19" = "0" ]; then
  echo "FAIL: normalizeCanonEntities helper missing from auto-run/index.ts"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: canon_lock_attempt_id must be logged ==="
HITS20=$(grep -c "canon_lock_attempt_id" supabase/functions/auto-run/index.ts || echo "0")
if [ "$HITS20" = "0" ]; then
  echo "FAIL: canon_lock_attempt_id not present in auto-run (must track retry attempts)"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: canonicalDocType must output underscored doc_type keys ==="
HITS_CDT=$(grep -n 'function canonicalDocType' supabase/functions/auto-run/index.ts | head -1 || true)
if [ -z "$HITS_CDT" ]; then
  echo "FAIL: canonicalDocType function not found in auto-run/index.ts"
  FAIL=1
else
  # Ensure the function converts hyphens to underscores in output
  HITS_UNDERSCORE=$(grep -A5 'function canonicalDocType' supabase/functions/auto-run/index.ts | grep 'replace(/-/g, "_")' || true)
  if [ -z "$HITS_UNDERSCORE" ]; then
    echo "FAIL: canonicalDocType does not convert hyphens to underscores in output"
    FAIL=1
  else
    echo "PASS"
  fi
fi

echo ""
echo "=== Regression Tripwire: Pause writes must use CAS protection ==="
HITS_CAS=$(grep -n 'pause_reason: "CANDIDATE_ID_MISSING"' supabase/functions/auto-run/index.ts | grep -v "eq.*step_count" | grep -v "CAS" | head -5 || true)
# We expect the pause_reason line to be near a CAS .eq("step_count",...) guard
HITS_CAS_GUARD=$(grep -c 'eq("step_count", casStepCount)' supabase/functions/auto-run/index.ts || echo "0")
if [ "$HITS_CAS_GUARD" = "0" ]; then
  echo "FAIL: CANDIDATE_ID_MISSING pause must use CAS (.eq step_count) to prevent stale writes"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: Running jobs must clear stale pause_reason ==="
HITS_STALE_CLEAR=$(grep -c 'Clearing stale pause state on running job' supabase/functions/auto-run/index.ts || echo "0")
if [ "$HITS_STALE_CLEAR" = "0" ]; then
  echo "FAIL: run-next must defensively clear stale pause_reason on running jobs"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: narrativeContextResolver must exist in _shared ==="
HITS_NCR=$(grep -c "resolveNarrativeContext" supabase/functions/_shared/narrativeContextResolver.ts || echo "0")
if [ "$HITS_NCR" = "0" ]; then
  echo "FAIL: narrativeContextResolver.ts missing or does not export resolveNarrativeContext"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: dev-engine-v2 rewrite must use narrativeContextResolver ==="
HITS_RW_NCR=$(grep -c "resolveNarrativeContext" supabase/functions/dev-engine-v2/index.ts || echo "0")
if [ "$HITS_RW_NCR" = "0" ]; then
  echo "FAIL: dev-engine-v2 does not import/use resolveNarrativeContext"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: generate-document must use narrativeContextResolver ==="
HITS_GD_NCR=$(grep -c "resolveNarrativeContext" supabase/functions/generate-document/index.ts || echo "0")
if [ "$HITS_GD_NCR" = "0" ]; then
  echo "FAIL: generate-document does not import/use resolveNarrativeContext"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: narrativeContextResolver signals cap must be 6 ==="
HITS_SIG_CAP=$(grep -c "SIGNALS_CAP = 6" supabase/functions/_shared/narrativeContextResolver.ts || echo "0")
if [ "$HITS_SIG_CAP" = "0" ]; then
  echo "FAIL: SIGNALS_CAP not set to 6 in narrativeContextResolver"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: rewrite-plan must store narrative_block in output_json ==="
HITS_RP_NB=$(grep -c "narrative_block" supabase/functions/dev-engine-v2/index.ts | head -1 || echo "0")
if [ "$HITS_RP_NB" = "0" ]; then
  echo "FAIL: rewrite-plan does not store narrative_block in output_json"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: rewrite-chunk must inject narrative context from plan ==="
HITS_RC_INJ=$(grep -c "injected_context_pack" supabase/functions/dev-engine-v2/index.ts || echo "0")
if [ "$HITS_RC_INJ" = "0" ]; then
  echo "FAIL: rewrite-chunk does not log injected_context_pack (context parity missing)"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: rewrite-chunk must use augmentedChunkSystem not bare REWRITE_CHUNK_SYSTEM ==="
HITS_BARE=$(grep -n "REWRITE_CHUNK_SYSTEM," supabase/functions/dev-engine-v2/index.ts | grep "callAI" | grep -v "augmented" || true)
if [ -n "$HITS_BARE" ]; then
  echo "FAIL: rewrite-chunk still passes bare REWRITE_CHUNK_SYSTEM to callAI (must use augmentedChunkSystem):"
  echo "$HITS_BARE"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: rewrite-chunk fallback resolve must log explicitly ==="
HITS_FB=$(grep -c "fallback_resolve_in_chunk=true" supabase/functions/dev-engine-v2/index.ts || echo "0")
if [ "$HITS_FB" = "0" ]; then
  echo "FAIL: rewrite-chunk fallback resolve path missing explicit log marker"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: Edge function brace/paren/bracket/backtick balance ==="
check_balance() {
  local FILE="$1"
  local LABEL="$2"
  if [ ! -f "$FILE" ]; then
    echo "FAIL: $LABEL — file not found: $FILE"
    FAIL=1
    return
  fi
  local OPEN_BRACE=$(grep -o '{' "$FILE" | wc -l | tr -d ' ')
  local CLOSE_BRACE=$(grep -o '}' "$FILE" | wc -l | tr -d ' ')
  local OPEN_PAREN=$(grep -o '(' "$FILE" | wc -l | tr -d ' ')
  local CLOSE_PAREN=$(grep -o ')' "$FILE" | wc -l | tr -d ' ')
  local OPEN_BRACKET=$(grep -o '\[' "$FILE" | wc -l | tr -d ' ')
  local CLOSE_BRACKET=$(grep -o '\]' "$FILE" | wc -l | tr -d ' ')
  local BACKTICKS=$(grep -o '`' "$FILE" | wc -l | tr -d ' ')
  local BT_MOD=$((BACKTICKS % 2))
  local OK=1
  if [ "$OPEN_BRACE" != "$CLOSE_BRACE" ]; then
    echo "FAIL: $LABEL — brace mismatch: { $OPEN_BRACE vs } $CLOSE_BRACE"
    OK=0
  fi
  if [ "$OPEN_PAREN" != "$CLOSE_PAREN" ]; then
    echo "FAIL: $LABEL — paren mismatch: ( $OPEN_PAREN vs ) $CLOSE_PAREN"
    OK=0
  fi
  if [ "$OPEN_BRACKET" != "$CLOSE_BRACKET" ]; then
    echo "FAIL: $LABEL — bracket mismatch: [ $OPEN_BRACKET vs ] $CLOSE_BRACKET"
    OK=0
  fi
  if [ "$BT_MOD" != "0" ]; then
    echo "FAIL: $LABEL — odd backtick count: $BACKTICKS"
    OK=0
  fi
  if [ "$OK" = "0" ]; then
    FAIL=1
  else
    echo "PASS ($LABEL: {$OPEN_BRACE ($OPEN_PAREN [$OPEN_BRACKET \`$BACKTICKS)"
  fi
}
check_balance "supabase/functions/generate-document/index.ts" "generate-document"
check_balance "supabase/functions/dev-engine-v2/index.ts" "dev-engine-v2"

echo ""
echo "=== Regression Tripwire: Deferrable hint must override BLOCKING_NOW in pendingDecisionGate ==="
HITS_DEF_OVERRIDE=$(grep -c 'hint === "deferrable"' supabase/functions/_shared/pendingDecisionGate.ts || echo "0")
if [ "$HITS_DEF_OVERRIDE" = "0" ]; then
  echo "FAIL: pendingDecisionGate does not check deferrable hint to override BLOCKING_NOW"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: shouldPause must only depend on blockingIds (not deferrableIds) ==="
HITS_PAUSE_LOGIC=$(grep -n "shouldPause.*=.*blockingIds" supabase/functions/_shared/pendingDecisionGate.ts || true)
HITS_PAUSE_DEFER=$(grep -n "shouldPause.*deferrableIds" supabase/functions/_shared/pendingDecisionGate.ts || true)
if [ -z "$HITS_PAUSE_LOGIC" ]; then
  echo "FAIL: shouldPause does not reference blockingIds"
  FAIL=1
elif [ -n "$HITS_PAUSE_DEFER" ]; then
  echo "FAIL: shouldPause incorrectly references deferrableIds"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: narrativeContextResolver must filter status=active only ==="
HITS_NCR_ACTIVE=$(grep -c "\.eq(\"status\", \"active\")" supabase/functions/_shared/narrativeContextResolver.ts || echo "0")
if [ "$HITS_NCR_ACTIVE" = "0" ]; then
  echo "FAIL: narrativeContextResolver does not filter decision_ledger by status=active"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: apply-decisions auto-default must check decision_ledger ==="
HITS_LEDGER_FALLBACK=$(grep -c "decision_ledger_workflow_pending" supabase/functions/auto-run/index.ts || echo "0")
if [ "$HITS_LEDGER_FALLBACK" = "0" ]; then
  echo "FAIL: apply-decisions-and-continue does not fall back to decision_ledger workflow_pending rows"
  FAIL=1
else
  echo "PASS"
fi

echo ""
echo "=== Regression Tripwire: apply-decisions auto-default logs IEL provenance ==="
HITS_IEL_LOG=$(grep -c "\[auto-run\]\[IEL\] apply-decisions auto-default" supabase/functions/auto-run/index.ts || echo "0")
if [ "$HITS_IEL_LOG" = "0" ]; then
  echo "FAIL: apply-decisions auto-default path missing IEL structured log"
  FAIL=1
else
  echo "PASS"
fi

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "Regression tripwires FAILED."
  exit 1
fi

echo ""
echo "All regression tripwires passed."
