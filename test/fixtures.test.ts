/**
 * People's sync on the kit's own fixture source: fixtures/connectors.json, which is what
 * APP_CONNECTORS=fixtures serves (and what `change` checks with). Its pass-through tools answer by
 * their arguments: one Gmail message per id, a history page per start position, a page of the
 * backfill per page token, and Calendar's full scan and then each sync token. The job runs as the
 * kit runs it, on a fixed clock so the fixture dates stay inside People's windows.
 */
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fixtureSource, jobStatus, runJobNow, type ConnectorFixtures, type FixtureAnswer } from '@app-builder/core';
import { application } from '../src/app.js';
import type { Ctx } from '../src/people/domain/context.js';
import { hubAccounts } from '../src/people/runtime.js';
import { advance, setup, state, teardown } from './helpers.js';

const ME = 'you@personal.example';
const load = (): ConnectorFixtures => JSON.parse(fs.readFileSync(new URL('../fixtures/connectors.json', import.meta.url), 'utf8'));

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup({ now: '2026-11-15T15:00:00.000Z' }); });
afterEach(() => { teardown(ctx); ctx = null; });

/** One run of the job, as the kit's runner starts it, five minutes after the last. */
async function runJob() {
  advance(5 * 60_000);
  const started = await runJobNow(application, state.platform!, 'update_people');
  await started.done;
  return (await jobStatus(application, state.platform!)).jobs[0].lastRun;
}
const emails = () => ctx!.db.all<{ external_id: string; direction: string }>("SELECT external_id, direction FROM interactions WHERE provider = 'gmail' ORDER BY external_id");
const meetings = () => ctx!.db.all<{ external_id: string }>("SELECT external_id FROM interactions WHERE kind = 'meeting' ORDER BY external_id").map((row) => row.external_id);
const indexed = (id: string) => ctx!.mailIndex.outcome(ME, id);
const checkpoint = (kind: 'mail' | 'calendar') => JSON.parse(ctx!.db.get<{ checkpoint: string }>('SELECT checkpoint FROM app_source_accounts WHERE account = ? AND kind = ?', ME, kind)!.checkpoint);
/** An action as the person's own browser runs it, with the fixture source left in place (helpers' call() swaps in its fake hub). */
async function asOwner(name: string, input: Record<string, unknown>) {
  const action = application.actions.find((item) => item.name === name)!;
  return JSON.parse(JSON.stringify(await action.execute({ platform: state.platform!, viewer: { id: 'local-owner', name: 'You', email: 'owner@localhost' }, request: new Request('http://127.0.0.1:4364/') }, input)));
}
const names = async () => (await asOwner('list_people', { limit: 50 })).items.map((item: { name: string }) => item.name).sort();

describe("People's sync on fixtures/connectors.json", () => {
  it('reads the mailbox and the calendar end to end: backfill pages, history, metadata first, and sync tokens', async () => {
    state.platform!.connectors = fixtureSource(load());
    expect((await runJob())?.status).toBe('succeeded');

    // One account answers get_profile and list_calendars with its address, so no account argument is sent.
    expect(hubAccounts(ctx!.db).mail).toEqual({ accounts: [ME], multi: false });
    expect(hubAccounts(ctx!.db).calendar).toEqual({ accounts: [ME], multi: false });
    // Both backfill pages and the history page were read. The newsletter in history was left out
    // from its headers alone: its body has no answer in the fixtures, so reading it would have
    // recorded it as gone.
    expect(emails()).toEqual([
      { external_id: 'fixture-m1', direction: 'sent' }, { external_id: 'fixture-m2', direction: 'received' },
      { external_id: 'fixture-m3', direction: 'sent' }, { external_id: 'fixture-m4', direction: 'sent' },
    ]);
    expect(indexed('fixture-m5')).toBe('skipped');
    const mail = checkpoint('mail');
    expect(mail.backfill).toMatchObject({ complete: true, pages: 2, pageToken: null });
    expect(mail.history).toMatchObject({ historyId: '120', pageToken: null });
    // Calendar's full scan, then its first sync token.
    expect(meetings()).toEqual(['primary:fixture-e1']);
    expect(checkpoint('calendar').primary).toMatchObject({ phase: 'incremental', syncToken: 'fixture-sync-1' });
    expect(await names()).toEqual(['Jordan Bell', 'Maya Chen']);
    const sources = await asOwner('list_sources', {});
    expect(sources.accounts.map((item: { kind: string; status: string }) => `${item.kind}:${item.status}`).sort()).toEqual(['calendar:ready', 'mail:ready']);

    // The next run asks Calendar for changes since its token, and Gmail for history since 120.
    expect((await runJob())?.status).toBe('succeeded');
    expect(meetings()).toEqual(['primary:fixture-e1', 'primary:fixture-e2']);
    expect(checkpoint('calendar').primary.syncToken).toBe('fixture-sync-2');
    expect(emails().length).toBe(4);
    // Nothing new after that: the same token answers with no changes.
    expect((await runJob())?.status).toBe('succeeded');
    expect(meetings()).toEqual(['primary:fixture-e1', 'primary:fixture-e2']);
    expect(checkpoint('calendar').primary.syncToken).toBe('fixture-sync-2');
  });

  it('an expired Gmail history (404) rescans the window and an expired sync token (410) restarts the scan, with no duplicates', async () => {
    const fixtures = load();
    const once = new Set<string>();
    /** The file's own answers, except each tool's first call at the given arguments, which has expired. */
    const expiring = (tool: string, key: string, value: string, status: 404 | 410) => {
      const own = fixtures.tools![tool];
      own.answer = (args) => {
        if (args[key] === value && !once.has(tool)) { once.add(tool); return { error: { code: 'not_found', message: 'Expired', httpStatus: status } }; }
        const found = own.cases?.find((entry) => Object.entries(entry.args).every(([name, wanted]) => args[name] === wanted));
        const { args: _args, ...answer } = found ?? { args: {}, result: own.result };
        return answer as FixtureAnswer;
      };
    };
    expiring('gmail__list_history', 'startHistoryId', '120', 404);
    expiring('google_calendar__sync_events', 'syncToken', 'fixture-sync-1', 410);
    state.platform!.connectors = fixtureSource(fixtures);
    await runJob();
    const before = { emails: emails(), people: await names() };
    expect(before.emails.length).toBe(4);

    expect((await runJob())?.status).toBe('succeeded');
    expect(once).toEqual(new Set(['gmail__list_history', 'google_calendar__sync_events']));
    expect(checkpoint('mail')).toMatchObject({ rescans: 1, backfill: { complete: true }, history: { historyId: '120' } });
    expect(checkpoint('calendar').primary).toMatchObject({ resets: 1, syncToken: 'fixture-sync-1' });
    expect(emails()).toEqual(before.emails);
    expect(meetings()).toEqual(['primary:fixture-e1']);
    expect(await names()).toEqual(before.people);
    // The fresh token then reads the changes it had missed.
    await runJob();
    expect(meetings()).toEqual(['primary:fixture-e1', 'primary:fixture-e2']);
  });
});
