import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { teardown } from './helpers.js';
import { COMPANIES, INTERACTIONS, PEOPLE, measure, openWorld, timedCalls, type TimedCall, type World } from './perf-world.js';

/**
 * People's latency budget: at release volume, every list, search and detail
 * call in perf-world.ts stays under 300 ms at p95, excluding startup, provider
 * calls and AI. `pnpm test:perf`, not `pnpm test`: wall-clock time depends on
 * what else the machine is doing, and `pnpm test` is the gate every change and
 * install must pass. `pnpm test` checks the part that doesn't depend on the
 * machine, that these calls read the large tables through indexes.
 *
 * Run it on a quiet machine before tagging a release, and put its numbers in
 * docs/parity.md. It prints the load average. When the load average is above
 * PERF_MAX_LOAD per core (1 unless set) as a group starts or ends, the group
 * isn't measured: it's skipped with "not measured", not passed or failed.
 * Results go to artifacts/performance.json.
 */
const BUDGET_MS = 300;
const MAX_LOAD = Number(process.env.PERF_MAX_LOAD ?? 1);
const CORES = os.availableParallelism();
const load = () => Math.round(os.loadavg()[0] * 10) / 10;
const say = (line: string) => process.stdout.write(`[perf] ${line}\n`);

let world: World;
let calls: TimedCall[];
const report: { measuredAt: string; volume: object; seedSeconds: number; node: string; platform: string; cores: number; maxLoadPerCore: number; groups: Record<string, unknown> } = {
  measuredAt: new Date().toISOString(), volume: { people: PEOPLE, companies: COMPANIES, interactions: INTERACTIONS }, seedSeconds: 0,
  node: process.version, platform: `${process.platform} ${process.arch}`, cores: CORES, maxLoadPerCore: MAX_LOAD, groups: {},
};
beforeAll(async () => {
  say(`load average ${load()} on ${CORES} cores; measured only while it stays at or under ${MAX_LOAD * CORES}`);
  world = await openWorld();
  calls = await timedCalls(world);
  report.seedSeconds = Math.round(world.seedMs / 100) / 10;
}, 600_000);
afterAll(() => {
  const dir = path.resolve(import.meta.dirname, '..', 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'performance.json'), JSON.stringify(report, null, 2));
  teardown(world?.ctx ?? null);
});

/** Time one group of calls, or say why it wasn't measured. */
async function timeGroup(group: TimedCall['group'], skip: (note: string) => never) {
  const before = load();
  if (before > MAX_LOAD * CORES) {
    report.groups[group] = { measured: false, loadBefore: before };
    say(`${group}: not measured, load average ${before} on ${CORES} cores`);
    skip(`not measured: load average ${before}`);
  }
  const results = [];
  for (const timed of calls.filter((item) => item.group === group)) results.push(await measure(timed.label, timed.runs, timed.work));
  const after = load();
  report.groups[group] = { measured: after <= MAX_LOAD * CORES, loadBefore: before, loadAfter: after, results };
  if (after > MAX_LOAD * CORES) {
    say(`${group}: not measured, load average rose to ${after} on ${CORES} cores`);
    skip(`not measured: load average rose to ${after}`);
  }
  for (const result of results) say(`${group}: ${result.label}: p50 ${result.p50} ms, p95 ${result.p95} ms, max ${result.max} ms`);
  say(`${group}: load average ${before} → ${after}`);
  return results;
}

describe(`At release volume, list, search and detail calls stay under ${BUDGET_MS} ms at p95`, () => {
  it(`the person's calls stay under ${BUDGET_MS} ms at p95`, async ({ skip }) => {
    const results = await timeGroup('owner', skip as (note: string) => never);
    expect(results.filter((result) => result.p95 >= BUDGET_MS).map((result) => `${result.label}: p95 ${result.p95} ms`)).toEqual([]);
  }, 300_000);

  it(`a narrower chat's calls stay under ${BUDGET_MS} ms at p95`, async ({ skip }) => {
    const results = await timeGroup('chat', skip as (note: string) => never);
    expect(results.filter((result) => result.p95 >= BUDGET_MS).map((result) => `${result.label}: p95 ${result.p95} ms`)).toEqual([]);
  }, 300_000);
});
