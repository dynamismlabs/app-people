import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../src/people/domain/context.js';
import { refreshPerson } from '../src/people/domain/people.js';
import { refreshOrganization } from '../src/people/domain/organizations.js';
import { sortKey } from '../src/people/domain/text.js';
import { setSearchRow } from '../src/people/domain/search.js';
import { call, chat, owner, setup, createScope, type Caller } from './helpers.js';

/**
 * People's release volume: 10,000 people, 1,000 companies and 100,000
 * interactions, written straight into a temporary database with the same
 * derived rows the app maintains. Two files use it:
 * - `performance.test.ts`, in `pnpm test` and so in the kit's safe-change
 *   gate: every timed call below uses indexed lookups on the large tables.
 *   That doesn't depend on the machine.
 * - `performance.perf.ts`, `pnpm test:perf`: the same calls stay under 300 ms
 *   at p95. That does, so it runs on a quiet machine before a release.
 */
export const PEOPLE = 10_000, COMPANIES = 1_000, INTERACTIONS = 100_000;
const FIRST = ['Maya', 'Jordan', 'Priya', 'Alex', 'Sam', 'Elena', 'Noah', 'Ava', 'Liam', 'Mia', 'Ethan', 'Zoe', 'Lucas', 'Isla', 'Mateo', 'Nora', 'Kai', 'Lena', 'Omar', 'Ines', 'Hugo', 'Amara', 'Leo', 'Yara', 'Felix', 'Sofia', 'Arjun', 'Hana', 'Theo', 'Mila', 'Ravi', 'Chloe', 'Ezra', 'Freya', 'Jonas', 'Lucia', 'Milo', 'Rosa', 'Tariq', 'Uma', 'Victor', 'Wren', 'Xavier', 'Yusuf', 'Zara', 'Bruno', 'Clara', 'Dario', 'Esme', 'Farah'];
const LAST = ['Chen', 'Bell', 'Shah', 'Rivera', 'Okafor', 'Park', 'Moreno', 'Ito', 'Nguyen', 'Silva', 'Haddad', 'Kowalski', 'Mensah', 'Novak', 'Rossi', 'Sato', 'Tanaka', 'Weber', 'Young', 'Zhang', 'Abara', 'Brandt', 'Costa', 'Dubois', 'Eklund', 'Fischer', 'Garcia', 'Huang', 'Ivanova', 'Jensen', 'Khan', 'Lopez', 'Murphy', 'Nakamura', 'Olsen', 'Petrov', 'Quinn', 'Reyes', 'Schmidt', 'Torres', 'Usman', 'Vargas', 'Walsh', 'Xu', 'Yilmaz', 'Zimmer', 'Adler', 'Baptiste', 'Cruz', 'Dahl', 'Evans', 'Ferreira', 'Gomez', 'Hart', 'Ibrahim', 'Jovanovic', 'Kim', 'Lund', 'Meyer', 'Nilsen', 'Ortiz', 'Patel', 'Quispe', 'Rahman', 'Santos', 'Thomsen', 'Ueda', 'Vidal', 'Wong', 'Yamada', 'Zeller', 'Arnaud', 'Bianchi', 'Castro', 'Dimitrov', 'Engel', 'Fontaine', 'Gupta', 'Horvat', 'Iyer', 'Jansen', 'Keller', 'Larsen', 'Moreau', 'Nowak', 'Oliveira', 'Pereira', 'Ramos', 'Svensson', 'Takahashi', 'Ulrich', 'Varga', 'Wagner', 'Yoon', 'Ziegler', 'Alvarez', 'Bauer', 'Carvalho', 'Duarte', 'Ellis', 'Fujita'];
const WORDS = ['North', 'Field', 'Atlas', 'Harbor', 'Cedar', 'Summit', 'Lumen', 'Quarry', 'Beacon', 'Orbit', 'Meadow', 'Signal', 'Copper', 'Willow', 'Granite', 'Delta', 'Prairie', 'Vector', 'Ember', 'Tidal'];
const SUFFIX = ['works', 'studio', 'labs', 'partners', 'collective', 'systems', 'group', 'trust', 'foundry', 'house'];

function seed(c: Ctx) {
  const started = performance.now();
  const time = c.now().toISOString();
  const db = c.db;
  let rng = 42;
  const random = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];
  const orgIds: string[] = [];
  const personIds: string[] = [], keyIds: string[] = [], sourceOf: string[] = [];
  db.tx(() => {
    for (const [account, label] of [['perf-a', 'Personal Gmail'], ['perf-b', 'Work Gmail']]) c.accounts.setup({ account, kind: 'mail', historyDays: 365, label });
    for (let index = 0; index < COMPANIES; index++) {
      const id = randomUUID(), name = `${WORDS[index % 20]} ${SUFFIX[Math.floor(index / 20) % 10]} ${Math.floor(index / 200) + 1}`;
      db.run("INSERT INTO organizations (id, created_at, updated_at, revision, collection, origin, name_override, display_name, sort_name, name_source, kind, website, state, archived_at, last_activity_at, merged_into, merged_at) VALUES (?, ?, ?, 1, 'manual', 'manual', ?, ?, ?, 'manual', 'company', ?, 'confirmed', NULL, NULL, NULL, NULL)",
        id, time, time, name, name, sortKey(name), `company${index}.example`);
      db.run("INSERT INTO organization_domains (id, created_at, updated_at, organization_id, domain, source_key, confirmation, evidence_id) VALUES (?, ?, ?, ?, ?, 'manual', 'confirmed', NULL)", randomUUID(), time, time, id, `company${index}.example`);
      orgIds.push(id);
    }
    for (let index = 0; index < PEOPLE; index++) {
      const id = randomUUID(), key = randomUUID();
      const first = FIRST[index % FIRST.length], last = LAST[Math.floor(index / FIRST.length) % LAST.length];
      const name = `${first} ${last}${index >= FIRST.length * LAST.length ? ` ${Math.floor(index / (FIRST.length * LAST.length))}` : ''}`;
      const personal = index % 5 === 0;
      const email = `${first.toLowerCase()}.${last.toLowerCase()}${index}@${personal ? 'fastmail.com' : `company${index % COMPANIES}.example`}`;
      const source = index % 2 ? 'account:perf-b' : 'account:perf-a';
      db.run("INSERT INTO persons (id, created_at, updated_at, revision, collection, origin, name_override, display_name, sort_name, name_source, headline, pinned, archived_at, keep_in_touch_days, last_exchange_at, merged_into, merged_at) VALUES (?, ?, ?, 1, 'manual', 'sent_mail', NULL, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL)",
        id, time, time, name, sortKey(name), index % 50 === 0 ? 1 : 0);
      db.run("INSERT INTO identity_keys (id, created_at, updated_at, revision, kind, normalized, owner_kind, owner_id, shared, decision) VALUES (?, ?, ?, 1, 'email', ?, 'person', ?, 0, 'auto')", key, time, time, email, id);
      db.run("INSERT INTO identity_observations (id, created_at, updated_at, key_id, source_key, value, observed_name, observed_at, last_seen_at, evidence_id, confirmation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'observed')", randomUUID(), time, time, key, source, email, name, time, time);
      if (!personal && index % 10 < 7)
        db.run("INSERT INTO affiliations (id, created_at, updated_at, revision, person_id, organization_id, role, valid_from, valid_to, observed_at, status, confidence, source_key, origin, evidence_id, decision, decision_key) VALUES (?, ?, ?, 1, ?, ?, ?, NULL, NULL, ?, 'current', 'confirmed', 'manual', 'manual', NULL, NULL, ?)",
          randomUUID(), time, time, id, orgIds[index % COMPANIES], pick(['Founder', 'Design lead', 'Operations', 'Engineer', 'Partner', 'Researcher']), time, randomUUID());
      personIds.push(id); keyIds.push(key); sourceOf.push(source);
    }
    const now = Date.now();
    for (let index = 0; index < INTERACTIONS; index++) {
      const id = randomUUID(), evidence = randomUUID();
      const meeting = index % 10 === 0;
      const at = new Date(now - Math.floor(random() * 365 * 864e5) + (meeting && index % 30 === 0 ? 20 * 864e5 : 0)).toISOString();
      const lead = Math.floor(random() * PEOPLE);
      const source = sourceOf[lead];
      const sent = random() < 0.5;
      db.run("INSERT INTO interactions (id, created_at, updated_at, revision, source_key, provider, external_id, kind, occurred_at, ends_at, subject, direction, thread_key, message_id_header, status, excluded_reason, included, participant_count, evidence_id, digest, attendance, owner_response, time_zone, recurring_key, link) VALUES (?, ?, ?, 1, ?, 'gmail', ?, ?, ?, NULL, ?, ?, ?, NULL, 'active', NULL, 0, 2, ?, NULL, 'unknown', NULL, NULL, NULL, NULL)",
        id, time, time, source, `x${index}`, meeting ? 'meeting' : 'email', at, `${pick(['Project', 'Proposal', 'Catch-up', 'Intro', 'Planning', 'Review'])} ${index}`, meeting ? 'meeting' : sent ? 'sent' : 'received', `t${Math.floor(index / 3)}`, evidence);
      db.run("INSERT INTO evidence (id, created_at, updated_at, source_key, interaction_id, kind, blob_digest, excerpt, source_date, title, participants, link, source_revision, status) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '[]', NULL, NULL, 'available')",
        evidence, time, time, source, id, meeting ? 'event' : 'email', 'A short fictional excerpt of the conversation for the timeline.', at, `Subject ${index}`);
      const participants = new Set([lead, Math.floor(random() * PEOPLE)]);
      for (const person of participants)
        db.run("INSERT INTO interaction_participants (id, created_at, updated_at, interaction_id, key_id, person_id, role, source_key, occurred_at, kind, direct, active) VALUES (?, ?, ?, ?, ?, ?, 'to', ?, ?, ?, ?, 1) ON CONFLICT(interaction_id, key_id) DO NOTHING",
          `${id}:${keyIds[person]}`, time, time, id, keyIds[person], personIds[person], source, at, meeting ? 'meeting' : 'email', meeting ? 0 : 1);
    }
    for (let index = 0; index < 20; index++) {
      const list = randomUUID();
      db.run("INSERT INTO lists (id, created_at, updated_at, revision, name, record_kind, collection, archived_at) VALUES (?, ?, ?, 1, ?, 'person', 'manual', NULL)", list, time, time, `List ${index}`);
      for (let member = 0; member < 100; member++) db.run("INSERT INTO list_members (id, created_at, updated_at, list_id, member_id, position, added_by) VALUES (?, ?, ?, ?, ?, ?, 'owner') ON CONFLICT(list_id, member_id) DO NOTHING", `${list}:${member}`, time, time, list, personIds[(index * 397 + member * 13) % PEOPLE], member);
    }
    for (let index = 0; index < 3000; index++) {
      const subject = personIds[(index * 7) % PEOPLE], note = randomUUID();
      db.run("INSERT INTO notes (id, created_at, updated_at, revision, subject_kind, subject_id, title, body, collection, archived_at) VALUES (?, ?, ?, 1, 'person', ?, NULL, ?, 'manual', NULL)", note, time, time, subject, `Fictional note ${index} about project planning.`);
      setSearchRow(c, `note:${note}`, 'person', subject, 'manual', `Fictional note ${index} about project planning.`);
    }
    for (let index = 0; index < 2000; index++)
      db.run("INSERT INTO commitments (id, created_at, updated_at, revision, person_id, organization_id, opportunity_id, direction, actor_label, recipient_label, action, due_date, extracted_action, extracted_due_date, evidence_id, interaction_id, source_key, passage, state, origin, snoozed_until, decision_key, extraction_version, completion_evidence_id, resolution, task_link_id, previous_decision, anchor) VALUES (?, ?, ?, 1, ?, NULL, NULL, ?, 'You', 'Them', ?, ?, NULL, NULL, NULL, NULL, 'manual', NULL, ?, 'manual', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
        randomUUID(), time, time, personIds[(index * 11) % PEOPLE], index % 3 ? 'i_owe' : 'waiting_on', `Follow up on item ${index}`, new Date(now + (index % 60 - 20) * 864e5).toISOString().slice(0, 10), index % 4 ? 'accepted' : 'suggested');
    for (const id of personIds) refreshPerson(c, id);
    for (const id of orgIds) refreshOrganization(c, id);
  });
  return { orgIds, elapsed: performance.now() - started };
}

export interface World {
  ctx: Ctx;
  /** People in name order, and companies in the order they were made. */
  personIds: string[];
  orgIds: string[];
  seedMs: number;
  /** The person's browser, with both accounts. */
  me: Caller;
  /** A connection that chose only the work account and manual records, read-only. */
  narrow: Caller;
}

export async function openWorld(): Promise<World> {
  const ctx = await setup({ now: new Date().toISOString(), realTime: true });
  const seeded = seed(ctx);
  const me = owner(['perf-a', 'perf-b']);
  const scope = await createScope({ actorId: 'chat:perf', sources: ['account:perf-b', 'manual'], operations: ['read'] }, me);
  return {
    ctx, me, narrow: chat('perf', scope.scopeRef),
    personIds: ctx.db.all<{ id: string }>('SELECT id FROM persons ORDER BY sort_name LIMIT 10000').map((row) => row.id),
    orgIds: seeded.orgIds, seedMs: seeded.elapsed,
  };
}

/**
 * The calls the latency budget covers. `runs` is how many are timed after one
 * warm-up. `variants` is how many consecutive indexes reach every shape the
 * call takes (each sort and direction, each search term, the first and a later
 * page), which is how many the plan check runs.
 */
export interface TimedCall { label: string; group: 'owner' | 'chat'; runs: number; variants: number; work: (index: number) => Promise<unknown> }

export async function timedCalls(world: World): Promise<TimedCall[]> {
  const { me, narrow, personIds, orgIds } = world;
  const sorts = ['name', 'last_exchange', 'next_action', 'added', 'next_meeting'] as const;
  const orgSorts = ['name', 'added', 'next_action', 'last_exchange'] as const;
  const terms = ['maya', 'chen', 'priya shah', 'north', 'company12', 'planning', 'rivera', 'zz'];
  const chatTerms = ['maya', 'bell', 'north'];
  let cursor: string | null = null;
  const visible = (await call('list_people', { limit: 50 }, narrow)).items.map((item: { id: string }) => item.id);
  return [
    { label: 'list_people first page by name', group: 'owner', runs: 30, variants: 1, work: () => call('list_people', { limit: 50 }, me) },
    { label: 'list_people with each sort', group: 'owner', runs: 40, variants: 10, work: (index) => call('list_people', { limit: 50, sort: { key: sorts[index % 5], direction: index % 2 ? 'asc' : 'desc' } }, me) },
    { label: 'list_people paging 100 per page', group: 'owner', runs: 30, variants: 2, work: async () => { const page: { nextCursor: string | null } = await call('list_people', { limit: 100, ...(cursor ? { cursor } : {}) }, me); cursor = page.nextCursor; } },
    { label: 'list_people filtered by company, list and last exchange', group: 'owner', runs: 30, variants: 1, work: (index) => call('list_people', { limit: 50, filters: { organizationIds: [orgIds[index % 50]], lastExchange: { olderThanDays: 30, includeNone: true } } }, me) },
    { label: 'list_people with next meeting filter', group: 'owner', runs: 20, variants: 1, work: () => call('list_people', { limit: 50, filters: { nextMeeting: { withinDays: 30 } } }, me) },
    { label: 'list_people with follow-up filter', group: 'owner', runs: 20, variants: 1, work: () => call('list_people', { limit: 50, filters: { hasFollowUp: true } }, me) },
    { label: 'search_people', group: 'owner', runs: 40, variants: terms.length, work: (index) => call('search_people', { text: terms[index % terms.length], limit: 20 }, me) },
    { label: 'get_person', group: 'owner', runs: 40, variants: 1, work: (index) => call('get_person', { id: personIds[(index * 97) % personIds.length] }, me) },
    { label: 'list_interactions person timeline', group: 'owner', runs: 40, variants: 1, work: (index) => call('list_interactions', { subjectKind: 'person', subjectId: personIds[(index * 131) % personIds.length], limit: 50 }, me) },
    { label: 'list_organizations', group: 'owner', runs: 30, variants: orgSorts.length, work: (index) => call('list_organizations', { limit: 50, sort: { key: orgSorts[index % 4], direction: 'asc' } }, me) },
    { label: 'get_organization', group: 'owner', runs: 30, variants: 1, work: (index) => call('get_organization', { id: orgIds[(index * 37) % orgIds.length] }, me) },
    { label: 'get_today', group: 'owner', runs: 20, variants: 1, work: () => call('get_today', {}, me) },
    { label: 'chat list_people by name', group: 'chat', runs: 30, variants: 1, work: () => call('list_people', { limit: 50 }, narrow) },
    { label: 'chat list_people by last exchange', group: 'chat', runs: 30, variants: 1, work: () => call('list_people', { limit: 50, sort: { key: 'last_exchange', direction: 'desc' } }, narrow) },
    { label: 'chat search_people', group: 'chat', runs: 30, variants: chatTerms.length, work: (index) => call('search_people', { text: chatTerms[index % chatTerms.length], limit: 20 }, narrow) },
    { label: 'chat get_person', group: 'chat', runs: 30, variants: 1, work: (index) => call('get_person', { id: visible[index % visible.length] }, narrow) },
  ];
}

/** The tables that grow with mail, meetings and people. */
const LARGE = new Set(['persons', 'interactions', 'interaction_participants', 'identity_observations', 'identity_keys', 'evidence', 'affiliations', 'person_sources', 'notes', 'commitments', 'search_rows']);
const NOT_ALIASES = new Set(['WHERE', 'ON', 'JOIN', 'LEFT', 'INNER', 'CROSS', 'OUTER', 'NATURAL', 'ORDER', 'GROUP', 'LIMIT', 'USING', 'HAVING', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW', 'INDEXED', 'NOT', 'SET', 'AS']);
export type Traced = { sql: string; params: unknown[] }[];

/** The statements a piece of work runs on People's connection. */
export async function trace(world: World, work: () => Promise<unknown>): Promise<Traced> {
  world.ctx.db.trace = [];
  try { await work(); return world.ctx.db.trace as Traced; }
  finally { world.ctx.db.trace = null; }
}

/** Query plans name a table by its alias (`SCAN p`), so read which table each alias stands for. */
function tablesOf(sql: string) {
  const tables = new Map<string, string>();
  for (const [, table, alias] of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/gi)) {
    tables.set(table, table);
    if (alias && !NOT_ALIASES.has(alias.toUpperCase())) tables.set(alias, table);
  }
  return tables;
}

/** How a statement reads the large tables: one line per step, with its table's real name, and whether it then sorts. */
function readsOf(world: World, statement: Traced[number]) {
  const plan = world.ctx.db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${statement.sql}`, ...statement.params as never[]).map((step) => step.detail);
  const tables = tablesOf(statement.sql);
  const sorts = plan.some((step) => /^USE TEMP B-TREE FOR (ORDER|GROUP) BY/.test(step));
  const steps = plan.flatMap((step) => {
    const [, kind, name, rest = ''] = /^(SCAN|SEARCH) (\S+)(?: (.*))?$/.exec(step) ?? [];
    const table = name ? tables.get(name) : undefined;
    return table && LARGE.has(table) ? [{ kind, table, rest }] : [];
  });
  return { steps, sorts, limited: /\bLIMIT\b/i.test(statement.sql) };
}

/**
 * Every step of these statements that reads a whole large table: a scan
 * without an index, an automatic index (built by reading the table), or a walk
 * of a whole index that doesn't stop at a LIMIT in index order.
 */
export function fullScans(world: World, statements: Traced): string[] {
  const found = new Set<string>();
  for (const statement of statements) {
    const { steps, sorts, limited } = readsOf(world, statement);
    for (const step of steps) {
      const whole = (step.kind === 'SCAN' && !step.rest.startsWith('USING')) || step.rest.includes('AUTOMATIC') || (step.kind === 'SCAN' && (sorts || !limited));
      if (whole) found.add(`${step.kind} ${step.table} ${step.rest}${sorts ? ', then sorts' : ''} :: ${statement.sql.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  return [...found];
}

/** How these statements read the large tables, for a snapshot: the steps and the indexes they use. */
export function largeTableReads(world: World, statements: Traced): string[] {
  const lines = new Set<string>();
  for (const statement of statements) {
    const { steps, sorts } = readsOf(world, statement);
    if (steps.length) lines.add(steps.map((step) => `${step.kind} ${step.table} ${step.rest}`.trim()).join(' > ') + (sorts ? ' > sorts' : ''));
  }
  return [...lines].sort();
}

/** Plan statements as if these indexes were gone. The schema change is rolled back: the transaction ends by throwing. */
export function withoutIndexes<T>(world: World, indexes: string[], work: () => T): T {
  const undo = new Error('Roll back the dropped indexes');
  let result: T;
  try {
    world.ctx.db.tx(() => {
      for (const index of indexes) world.ctx.db.run(`DROP INDEX ${index}`);
      result = work();
      throw undo;
    });
  } catch (error) { if (error !== undo) throw error; }
  return result!;
}

/** Time a call: one warm-up, then `runs` timed calls. */
export async function measure(label: string, runs: number, work: (index: number) => Promise<unknown>) {
  await work(0);
  const times: number[] = [];
  for (let index = 1; index <= runs; index++) {
    const started = performance.now();
    await work(index);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => Math.round(times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)] * 10) / 10;
  return { label, p50: at(0.5), p95: at(0.95), max: Math.round(times.at(-1)! * 10) / 10, runs };
}
