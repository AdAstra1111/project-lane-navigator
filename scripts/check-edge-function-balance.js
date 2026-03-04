#!/usr/bin/env node
/**
 * Cross-platform edge function syntax balance checker.
 * Usage: node scripts/check-edge-function-balance.js
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
  const ok =
    counts['{'] === counts['}'] &&
    counts['('] === counts[')'] &&
    counts['['] === counts[']'] &&
    counts['`'] % 2 === 0;

  if (ok) {
    console.log(`PASS (${rel}: {${counts['{']} (${counts['(']} [${counts['[']} \`${counts['`']})`);
  } else {
    fail = true;
    if (counts['{'] !== counts['}']) console.log(`FAIL: ${rel} — brace mismatch: { ${counts['{']} vs } ${counts['}']}`);
    if (counts['('] !== counts[')']) console.log(`FAIL: ${rel} — paren mismatch: ( ${counts['(']} vs ) ${counts[')']}`);
    if (counts['['] !== counts[']']) console.log(`FAIL: ${rel} — bracket mismatch: [ ${counts['[']} vs ] ${counts[']']}`);
    if (counts['`'] % 2 !== 0) console.log(`FAIL: ${rel} — odd backtick count: ${counts['`']}`);
  }
}

process.exit(fail ? 1 : 0);
