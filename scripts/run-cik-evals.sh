#!/usr/bin/env bash
# CIK Eval Harness — One-command deterministic runner
# Usage: bash scripts/run-cik-evals.sh
#
# Runs all CIK eval regression + router tests via Vitest.
# No LLM calls. No DB writes. Purely deterministic.

set -euo pipefail

echo "=== CIK Eval Harness ==="
npx vitest run src/test/cik-eval-regression.test.ts src/test/cinematic-eval-router.test.ts src/test/cik-model-router.test.ts src/test/cik-model-router-drift.test.ts 2>&1
echo "=== CIK Evals Complete ==="
