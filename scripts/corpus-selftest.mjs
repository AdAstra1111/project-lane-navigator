#!/usr/bin/env node
/**
 * Corpus Integrity Self-Test
 * Usage: node scripts/corpus-selftest.mjs
 *
 * Environment variables (set in CI or .env):
 *   VITE_SUPABASE_URL          – Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  – Service role key (for CI)
 *   VITE_SUPABASE_PUBLISHABLE_KEY – Anon key (fallback)
 *
 * Exits with code 1 if any check fails.
 */

import { readFileSync } from 'fs';

// Try loading .env if present
try {
  const envContent = readFileSync('.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
} catch { /* no .env, fine */ }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const url = `${SUPABASE_URL}/functions/v1/analyze-corpus`;

async function run() {
  console.log('🧪 Running Corpus Integrity Self-Test...\n');

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
    },
    body: JSON.stringify({ action: 'self_test' }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`❌ HTTP ${resp.status}: ${text}`);
    process.exit(1);
  }

  const result = await resp.json();

  // Print checks
  for (const [check, ok] of Object.entries(result.checks)) {
    console.log(`  ${ok ? '✅' : '❌'} ${check}`);
  }

  // Print evidence summary
  if (result.evidence?.latest_calibration) {
    const cal = result.evidence.latest_calibration;
    console.log(`\n  Strategy: ${cal.normalization_strategy}`);
    console.log(`  Pages: raw=${cal.median_raw_pages} → norm=${cal.median_normalized_pages} → clamped=${cal.median_page_count_clamped}`);
    console.log(`  Sample: ${cal.sample_size} (used: ${cal.sample_size_used})`);
  }

  if (result.evidence?.counts) {
    const c = result.evidence.counts;
    console.log(`\n  Counts: complete=${c.total_complete} eligible=${c.eligible} truncated=${c.truncated} transcripts=${c.transcripts} manual=${c.manual_excluded}`);
  }

  if (result.evidence?.idempotency_hashes) {
    const h = result.evidence.idempotency_hashes;
    const match = h.run1 === h.run2;
    console.log(`\n  Idempotency: ${match ? '✅ match' : '❌ MISMATCH'} (${h.run1.slice(0, 16)}…)`);
  }

  // Print failures
  if (result.failures?.length) {
    console.log('\n  Failures:');
    for (const f of result.failures) {
      console.log(`    ⚠️  ${f}`);
    }
  }

  // Final verdict
  console.log(`\n${result.pass ? '✅ ALL CHECKS PASSED' : '❌ SELF-TEST FAILED'}\n`);

  if (!result.pass) process.exit(1);
}

run().catch(e => {
  console.error('❌ Self-test error:', e.message);
  process.exit(1);
});
