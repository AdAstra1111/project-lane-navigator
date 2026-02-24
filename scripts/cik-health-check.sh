#!/usr/bin/env bash
# CIK Health Check — grep telemetry event counts from a log file.
# Usage: bash scripts/cik-health-check.sh <logfile>

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <logfile>"
  echo "  Counts CIK telemetry events in the given log file."
  exit 1
fi

FILE="$1"

if [ ! -f "$FILE" ]; then
  echo "Error: file not found: $FILE"
  exit 1
fi

echo "=== CIK Health Check: $FILE ==="
echo "CINEMATIC_QUALITY_SUMMARY:      $(grep -c 'CINEMATIC_QUALITY_SUMMARY' "$FILE" 2>/dev/null || echo 0)"
echo "CINEMATIC_ADAPTER_FALLBACK:     $(grep -c 'CINEMATIC_ADAPTER_FALLBACK' "$FILE" 2>/dev/null || echo 0)"
echo "CINEMATIC_QUALITY_FAIL_SNAPSHOT: $(grep -c 'CINEMATIC_QUALITY_FAIL_SNAPSHOT' "$FILE" 2>/dev/null || echo 0)"
