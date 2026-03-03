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
echo "=== Regression Tripwire: Edge functions importing from src/ ==="
HITS4=$(grep -RIn --include='*.ts' -E "from ['\"].*src/" supabase/functions/ | grep -v "node_modules" || true)
if [ -n "$HITS4" ]; then
  echo "FAIL: Edge function imports from src/ (cross-boundary import):"
  echo "$HITS4"
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
