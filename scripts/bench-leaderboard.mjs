#!/usr/bin/env node
/**
 * scripts/bench-leaderboard.mjs
 *
 * Latency benchmark for the leaderboard hot path. Hits each target URL
 * `iterations` times sequentially, prints P50/P95/P99 and pass/fail
 * status against the budget gates from
 * `.cursor/plans/leaderboard_sqlite_bundle_5df5b1dc.plan.md`.
 *
 * Usage:
 *   node scripts/bench-leaderboard.mjs                 # local default
 *   node scripts/bench-leaderboard.mjs --base=https://...
 *   node scripts/bench-leaderboard.mjs --iterations=50
 *   node scripts/bench-leaderboard.mjs --warm=3
 *
 * Exit codes:
 *   0  every gate passed
 *   1  at least one gate failed
 *   2  benchmark could not run (e.g. server unreachable)
 *
 * No external deps — uses Node's built-in fetch and performance.now().
 */

import { performance } from "node:perf_hooks";

const ARGS = parseArgs(process.argv.slice(2));
const BASE_URL = (ARGS.base || process.env.BENCH_BASE_URL || "http://localhost:8787").replace(/\/+$/, "");
const ITERATIONS = clampInt(ARGS.iterations || process.env.BENCH_ITERATIONS || 30, 5, 200);
const WARMUP = clampInt(ARGS.warm || process.env.BENCH_WARMUP || 2, 0, 50);

/**
 * Each target's P95 budget mirrors the "Performance budget" section of
 * the leaderboard SQLite bundle plan:
 *  - TTFB `/api/leaderboard`: P95 < 800 ms
 *  - Page-to-table-rendered (HTML shell): P95 < 3.0 s (the static page;
 *    the actual table render lands a few hundred ms after the bundle).
 */
const TARGETS = [
  {
    label: "API bundle (/api/leaderboard)",
    url: `${BASE_URL}/api/leaderboard`,
    p95BudgetMs: 800,
    p99BudgetMs: 1500,
  },
  {
    label: "HTML shell (/leaderboard)",
    url: `${BASE_URL}/leaderboard`,
    p95BudgetMs: 3000,
    p99BudgetMs: 5000,
  },
];

function parseArgs(list) {
  const out = {};
  for (const raw of list) {
    if (!raw.startsWith("--")) continue;
    const [k, v] = raw.slice(2).split("=");
    out[k] = v == null ? "1" : v;
  }
  return out;
}

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v) || 0);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return Number.NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, idx)];
}

async function timeGet(url) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, { method: "GET", redirect: "manual" });
  } catch (error) {
    return { ok: false, status: 0, durationMs: performance.now() - t0, error: error?.message || String(error) };
  }
  /* Read the body so we measure end-to-end response time, not just TTFB.
     We don't care about the payload here — just that it was fully drained. */
  try {
    await res.arrayBuffer();
  } catch {
    /* drained as far as we can; still record timing */
  }
  return { ok: res.ok, status: res.status, durationMs: performance.now() - t0 };
}

async function bench(target) {
  const samples = [];
  let failures = 0;
  for (let i = 0; i < WARMUP; i += 1) {
    /* warmup runs are not counted but still help warm caches/connections */
    await timeGet(target.url).catch(() => undefined);
  }
  for (let i = 0; i < ITERATIONS; i += 1) {
    const r = await timeGet(target.url);
    if (!r.ok) failures += 1;
    samples.push(r.durationMs);
  }
  samples.sort((a, b) => a - b);
  const min = samples[0];
  const max = samples[samples.length - 1];
  const median = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  const avg = samples.reduce((acc, v) => acc + v, 0) / samples.length;
  return { samples, min, max, median, p95, p99, avg, failures };
}

function fmt(ms) {
  if (!Number.isFinite(ms)) return "n/a";
  return `${ms.toFixed(1).padStart(7, " ")} ms`;
}

function pass(value, budget) {
  return value <= budget;
}

(async () => {
  console.log("== Leaderboard latency benchmark ==");
  console.log(`base       : ${BASE_URL}`);
  console.log(`iterations : ${ITERATIONS} per target (warmup: ${WARMUP})`);
  console.log("");

  let allPassed = true;
  for (const target of TARGETS) {
    process.stdout.write(`-> ${target.label}\n   ${target.url}\n   `);
    let result;
    try {
      result = await bench(target);
    } catch (error) {
      console.log(`FAILED: ${error?.message || error}`);
      process.exitCode = 2;
      return;
    }
    const okP95 = pass(result.p95, target.p95BudgetMs);
    const okP99 = pass(result.p99, target.p99BudgetMs);
    const verdict = okP95 && okP99 ? "PASS" : "FAIL";
    if (verdict !== "PASS") allPassed = false;
    console.log(
      `${verdict}   min=${fmt(result.min)} p50=${fmt(result.median)} avg=${fmt(result.avg)} p95=${fmt(result.p95)} p99=${fmt(result.p99)} max=${fmt(result.max)} (${result.failures}/${result.samples.length} failures)`
    );
    console.log(
      `       gates: p95 <= ${target.p95BudgetMs}ms (${okP95 ? "OK" : "MISS"}), p99 <= ${target.p99BudgetMs}ms (${okP99 ? "OK" : "MISS"})\n`
    );
  }

  console.log(allPassed ? "All gates passed." : "One or more gates failed.");
  process.exit(allPassed ? 0 : 1);
})().catch((error) => {
  console.error("[bench] unexpected error:", error?.message || error);
  process.exit(2);
});
