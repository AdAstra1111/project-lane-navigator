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
HITS2=$(grep -rn "setSearchParams({" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "// ⚠" | grep -v "// WHY:" | grep -v "searchParams.ts" || true)
if [ -n "$HITS2" ]; then
  echo "FAIL: setSearchParams({ found (must use updateSearchParams merge helper):"
  echo "$HITS2"
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
