import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { call, owner, teardown } from './helpers.js';
import { COMPANIES, INTERACTIONS, PEOPLE, fullScans, largeTableReads, openWorld, timedCalls, trace, withoutIndexes, type TimedCall, type Traced, type World } from './perf-world.js';

/**
 * At People's release volume, the calls the latency budget covers read the
 * large tables through indexes. This is `pnpm test`, and so the kit's
 * safe-change gate before a change or an install switches, and it doesn't
 * depend on how busy the machine is. The wall-clock budget itself, p95 under
 * 300 ms, is `pnpm test:perf` (test/performance.perf.ts).
 *
 * Two checks, from each statement's query plan:
 * - No call reads a whole large table: a scan without an index, an automatic
 *   index, or a walk of a whole index that doesn't stop at a LIMIT.
 * - How each call reads the large tables, index by index, matches the
 *   snapshot. A dropped index or a changed query that makes SQLite fall back
 *   to another index and sort fails here until the new plan is looked at and
 *   the snapshot updated (`pnpm test -u`).
 */
let world: World;
let calls: TimedCall[];
const traced = new Map<string, Traced>();
beforeAll(async () => {
  world = await openWorld();
  calls = await timedCalls(world);
  for (const timed of calls) {
    const statements: Traced = [];
    for (let index = 0; index < timed.variants; index++) statements.push(...await trace(world, () => timed.work(index)));
    traced.set(timed.label, statements);
  }
}, 600_000);
afterAll(() => teardown(world?.ctx ?? null));

describe('At release volume, the calls the latency budget covers use indexes, and opening a record starts no import, full-table scan or AI call', () => {
  it('seeded 10,000 people, 1,000 companies and 100,000 interactions', () => {
    expect(world.ctx.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM persons')!.count).toBe(PEOPLE);
    expect(world.ctx.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM organizations')!.count).toBe(COMPANIES);
    expect(world.ctx.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM interactions')!.count).toBe(INTERACTIONS);
  });

  it('no timed call, for the person or a narrower chat, reads a whole large table', () => {
    const scans: Record<string, string[]> = {};
    for (const [label, statements] of traced) {
      expect(statements.length, `${label} ran nothing on People's connection`).toBeGreaterThan(0);
      const found = fullScans(world, statements);
      if (found.length) scans[label] = found;
    }
    expect(scans).toEqual({});
  });

  it('each timed call reads the large tables through the same indexes as before', () => {
    expect(Object.fromEntries([...traced].map(([label, statements]) => [label, largeTableReads(world, statements)]))).toMatchSnapshot();
  });

  // Each check has to notice a missing index, or it proves nothing.
  it('without the participant indexes, the timeline reads every participant, and the first check says so', () => {
    const statements = traced.get('list_interactions person timeline')!;
    expect(fullScans(world, statements)).toEqual([]);
    const found = withoutIndexes(world, ['participants_person', 'participants_person_source'], () => fullScans(world, statements));
    expect(found.some((line) => line.startsWith('SCAN interaction_participants'))).toBe(true);
  });

  it('without persons_name, the name list falls back to another index and sorts, and the snapshot check says so', () => {
    const statements = traced.get('list_people first page by name')!;
    const before = largeTableReads(world, statements);
    const after = withoutIndexes(world, ['persons_name'], () => largeTableReads(world, statements));
    expect(before.some((line) => line.includes('persons_name'))).toBe(true);
    expect(after.some((line) => line.includes('persons_name'))).toBe(false);
    expect(after).not.toEqual(before);
    // The fallback still uses an index, so only the snapshot catches it.
    expect(withoutIndexes(world, ['persons_name'], () => fullScans(world, statements))).toEqual([]);
  });

  it('opening a record calls no capability and reads no whole large table', async () => {
    let capabilityCalls = 0;
    const counted = owner(['perf-a', 'perf-b'], async () => { capabilityCalls++; return {}; });
    const id = world.personIds[1234];
    const statements = await trace(world, async () => {
      await call('get_person', { id }, counted);
      await call('list_interactions', { subjectKind: 'person', subjectId: id, limit: 50 }, counted);
      await call('get_briefing', { subjectKind: 'person', subjectId: id }, counted);
    });
    expect(capabilityCalls).toBe(0);
    expect(fullScans(world, statements)).toEqual([]);
  }, 120_000);
});
