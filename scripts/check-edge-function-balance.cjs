#!/usr/bin/env node
/**
 * Cross-platform edge function syntax balance checker.
 * Enforces brace {} balance (deployment-breaking).
 * Parens/brackets/backticks are INFO-only (string content causes false positives).
 * Usage: node scripts/check-edge-function-balance.cjs
 */
const fs = require('fs');
const path = require('path');

const FILES = [
  'supabase/functions/generate-document/index.ts',
  'supabase/functions/dev-engine-v2/index.ts',
];

let fail = false;

for (const rel of FILES) {
  const full = path.resolve(__dirname, '..', rel);
  if (!fs.existsSync(full)) {
    console.log(`SKIP: ${rel} — file not found`);
    continue;
  }
  const src = fs.readFileSync(full, 'utf8');
  const counts = { '{': 0, '}': 0, '(': 0, ')': 0, '[': 0, ']': 0, '`': 0 };
  for (const ch of src) {
    if (ch in counts) counts[ch]++;
  }

  // Braces: HARD FAIL (deployment-breaking if unbalanced)
  if (counts['{'] !== counts['}']) {
    console.log(`FAIL: ${rel} — BRACE mismatch: { ${counts['{']} vs } ${counts['}']}`);
    fail = true;
  } else {
    console.log(`PASS: ${rel} — braces balanced (${counts['{']})`);
  }

  // Info-only (template literals / strings cause expected mismatches)
  if (counts['('] !== counts[')'])
    console.log(`  info: paren diff ( ${counts['(']} vs ) ${counts[')']}  [expected in large files]`);
  if (counts['['] !== counts[']'])
    console.log(`  info: bracket diff [ ${counts['[']} vs ] ${counts[']']}  [expected in large files]`);
  if (counts['`'] % 2 !== 0)
    console.log(`  info: odd backtick count ${counts['`']}`);
}

process.exit(fail ? 1 : 0);
