import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { Ctx } from '../src/people/domain/context.js';
import { call, expectCode, job, owner, setup, teardown } from './helpers.js';
import { fakeHost, mail, OWNER, type FakeAccount } from './fakes.js';

/**
 * People's multi-step writes each run as one transaction of the core's
 * (`transaction(ctx, work)` on the kit's own connection, through
 * src/people/domain/context.ts). A statement that fails part-way through
 * rolls back everything the step had already written.
 *
 * Each test makes one statement late in the step fail, with a temporary
 * trigger on the connection. The trigger fires only once the step's earlier
 * writes are visible inside the transaction, so it proves they were made, and
 * the test then finds none of them: People's tables are exactly as before.
 * With the trigger gone, the same step succeeds.
 */
let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup({ now: new Date().toISOString(), realTime: true }); });
afterEach(() => { teardown(ctx); ctx = null; });
const me = owner();

/**
 * People's own tables (src/people/domain/migrations.ts), minus `except` and app_settings, where
 * the test harness records the accounts the hub lends before each call.
 */
function peopleTables(except: string[] = []) {
  const present = new Set(ctx!.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name));
  const tables = [...PEOPLE_TABLES].filter((name) => present.has(name) && name !== 'app_settings' && !except.includes(name)).sort();
  expect(tables.length).toBeGreaterThan(40);
  return tables;
}
const PEOPLE_TABLES = new Set(['app_revisions', 'collections', 'persons', 'person_sources', 'organizations', 'organization_sources', 'organization_domains', 'identity_keys', 'identity_observations', 'affiliations', 'evidence', 'interactions', 'interaction_participants', 'interaction_links', 'attribution_rules', 'previews', 'imports', 'import_rows', 'notes', 'facts', 'decisions', 'commitments', 'commitment_history', 'task_links', 'lists', 'list_members', 'saved_views', 'pipelines', 'pipeline_stages', 'opportunities', 'opportunity_people', 'stage_changes', 'identity_reviews', 'merges', 'id_mappings', 'exclusions', 'briefings', 'work_items', 'search_rows', 'search_fts', 'person_relations', 'profiles', 'app_settings', 'app_jobs', 'app_source_accounts', 'app_mail_messages', 'app_invocations', 'evidence_blobs']);
/** A digest of every row in these tables. */
function contents(tables: string[]) {
  const hash = createHash('sha256');
  for (const table of tables) hash.update(table).update(JSON.stringify(ctx!.db.all(`SELECT * FROM ${table} ORDER BY rowid`)));
  return hash.digest('hex');
}

/** Fail every `event` on `table` while `when` holds, until the returned function is called. */
function failWhen(table: string, event: string, when: string) {
  const name = `fail_${table}`;
  ctx!.db.run(`CREATE TEMP TRIGGER ${name} BEFORE ${event} ON main.${table} WHEN ${when} BEGIN SELECT RAISE(ABORT, 'Injected failure'); END`);
  return () => { ctx!.db.run(`DROP TRIGGER temp.${name}`); };
}
const count = (sql: string, ...params: string[]) => ctx!.db.get<{ count: number }>(sql, ...params)!.count;

function mailbox(): Record<string, FakeAccount> {
  const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString();
  return {
    personal: {
      email: OWNER,
      mail: [
        mail('p1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Portfolio', body: 'I would be happy to introduce you to the research lead.', sent: true, date: recent(5), messageId: '<p1@personal.example>' }),
        mail('p2', { from: 'Maya Chen <maya@northstar.example>', to: [OWNER], subject: 'Re: Portfolio', body: 'Thank you!\n\nBest,\nMaya Chen\nDesign lead, Northstar', date: recent(4), inReplyTo: '<p1@personal.example>' }),
        mail('p3', { from: OWNER, to: ['Jordan Bell <jordan@fieldwork.example>'], subject: 'Scope', body: 'I will send the revised proposal by Friday.', sent: true, date: recent(3) }),
      ],
    },
  };
}
const names = async () => (await call('list_people', { limit: 100 }, me)).items.map((item: { name: string }) => item.name).sort();

describe('A thrown error rolls back the whole of a multi-step write', () => {
  it('ingestion: a mail page whose checkpoint fails to save stores none of its conversations, people or index entries', async () => {
    const host = fakeHost(mailbox());
    // Only the mail is lent, so each step is a mail step.
    const step = () => call('continue_import', { source: 'account:personal' }, { ...owner([], host.capability), accounts: [{ account: 'personal', binding: 'mail' as const }] });
    // The page's own bookkeeping (the job, the account's error and the revision counters) is written after the rollback, by the step's failure handling.
    const tables = peopleTables(['app_jobs', 'app_source_accounts', 'app_revisions']);
    // Saving the checkpoint fails, but only once a page's conversations are in: the steps that find
    // the mailbox's position and list its messages save theirs, and the first that reads messages fails.
    const restore = failWhen('app_source_accounts', 'UPDATE OF checkpoint', "(SELECT COUNT(*) FROM interactions WHERE source_key = 'account:personal') > 0");
    let before = '', checkpoint: unknown, failed = false;
    for (let index = 0; index < 6 && !failed; index++) {
      before = contents(tables);
      checkpoint = ctx!.accounts.get('personal', 'mail')?.checkpoint;
      failed = (await step()).summary === 'The step failed and will retry later';
    }
    expect(failed).toBe(true);
    restore();
    expect(contents(tables)).toBe(before);
    expect(count("SELECT COUNT(*) AS count FROM interactions WHERE source_key = 'account:personal'")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM app_mail_messages WHERE account = 'personal'")).toBe(0);
    expect(ctx!.accounts.get('personal', 'mail')!.checkpoint).toEqual(checkpoint);
    expect(await names()).toEqual([]);

    // Run again, the page goes in once.
    for (let index = 0; index < 6 && (await step()).more; index++);
    expect(count("SELECT COUNT(*) AS count FROM interactions WHERE source_key = 'account:personal' AND external_id = 'p1'")).toBe(1);
    expect(await names()).toEqual(['Jordan Bell', 'Maya Chen']);
  });

  it('merge: a merge that fails after moving the merged record\'s references moves nothing, and saves no receipt', async () => {
    const a = (await call('save_person', { name: 'Maya Chen', identifiers: [{ kind: 'email', value: 'maya@northstar.example' }] }, me)).record;
    const b = (await call('save_person', { name: 'Maya Chen', identifiers: [{ kind: 'email', value: 'maya.chen@personal.example' }] }, me)).record;
    await call('save_note', { subjectKind: 'person', subjectId: b.id, body: 'Prefers morning calls.' }, me);
    await call('save_commitment', { direction: 'i_owe', personId: b.id, action: 'Send the portfolio checklist' }, me);
    const revision = async (id: string) => (await call('get_person', { id }, me)).person.revision as number;
    const input = { survivorId: a.id, mergedId: b.id, survivorRevision: await revision(a.id), mergedRevision: await revision(b.id) };
    const tables = peopleTables();
    const before = contents(tables);

    // The mapping from the old ID goes in after the note moved, the merged person was marked and the merge was logged.
    const restore = failWhen('id_mappings', 'INSERT',
      "EXISTS (SELECT 1 FROM merges WHERE id = NEW.merge_id) AND EXISTS (SELECT 1 FROM persons WHERE id = NEW.from_id AND merged_into = NEW.to_id) AND NOT EXISTS (SELECT 1 FROM notes WHERE subject_id = NEW.from_id)");
    const request = randomUUID();
    await expect(call('merge_people', input, me, request)).rejects.toThrow();
    restore();
    expect(contents(tables)).toBe(before);
    expect(count('SELECT COUNT(*) AS count FROM notes WHERE subject_id = ?', b.id)).toBe(1);
    expect(count('SELECT COUNT(*) AS count FROM app_invocations WHERE id = ?', request)).toBe(0);
    expect((await call('list_people', { limit: 10 }, me)).total).toBe(2);

    // The same request, tried again, merges.
    expect((await call('merge_people', input, me, request)).status).toBe('saved');
    const survivor = await call('get_person', { id: a.id }, me);
    expect(survivor.notes.map((note: { body: string }) => note.body)).toEqual(['Prefers morning calls.']);
    expect(survivor.commitments.length).toBe(1);
  });

  it('undo: an undo that fails after restoring the merged record restores nothing, and the merge still stands', async () => {
    const a = (await call('save_person', { name: 'Maya Chen', identifiers: [{ kind: 'email', value: 'maya@northstar.example' }] }, me)).record;
    const b = (await call('save_person', { name: 'Maya Chen', identifiers: [{ kind: 'email', value: 'maya.chen@personal.example' }] }, me)).record;
    await call('save_note', { subjectKind: 'person', subjectId: b.id, body: 'Prefers morning calls.' }, me);
    const revision = async (id: string) => (await call('get_person', { id }, me)).person.revision as number;
    const { mergeId } = await call('merge_people', { survivorId: a.id, mergedId: b.id, survivorRevision: await revision(a.id), mergedRevision: await revision(b.id) }, me);
    const preview = await call('undo_merge', { mergeId, preview: true }, me);
    const input = { mergeId, expectedRevision: preview.revision, digest: preview.digest, attributions: [] };
    const tables = peopleTables();
    const before = contents(tables);

    // The old ID's mapping is retired after the note moved back, the merged person was restored and the merge marked undone.
    const restore = failWhen('id_mappings', 'UPDATE OF active',
      "NEW.active = 0 AND EXISTS (SELECT 1 FROM merges WHERE id = NEW.merge_id AND state = 'undone') AND EXISTS (SELECT 1 FROM persons WHERE id = NEW.from_id AND merged_into IS NULL) AND EXISTS (SELECT 1 FROM notes WHERE subject_id = NEW.from_id)");
    const request = randomUUID();
    await expect(call('undo_merge', input, me, request)).rejects.toThrow();
    restore();
    expect(contents(tables)).toBe(before);
    expect(ctx!.db.get<{ state: string }>('SELECT state FROM merges WHERE id = ?', mergeId)!.state).toBe('applied');
    expect((await call('get_person', { id: b.id }, me)).person.id).toBe(a.id);
    expect((await call('get_person', { id: a.id }, me)).notes.map((note: { body: string }) => note.body)).toEqual(['Prefers morning calls.']);

    // Tried again, it undoes.
    expect((await call('undo_merge', input, me, request)).restored).toBe(b.id);
    expect((await call('get_person', { id: b.id }, me)).notes.map((note: { body: string }) => note.body)).toEqual(['Prefers morning calls.']);
    await expectCode(call('undo_merge', { mergeId, preview: true }, me), 'conflict');
  });

  it('source deletion: deleting what an account brought in, failing at the last person, deletes nothing', async () => {
    const host = fakeHost(mailbox());
    for (let index = 0; index < 10; index++) if (!(await call('run_background_step', {}, job([{ account: 'personal' }], host.capability))).ran) break;
    expect(await names()).toEqual(['Jordan Bell', 'Maya Chen']);
    const conversations = count("SELECT COUNT(*) AS count FROM interactions WHERE source_key = 'account:personal'");
    expect(conversations).toBeGreaterThan(0);
    const tables = peopleTables();
    const before = contents(tables);

    // People who came only from this account go last, once its conversations, identities, account and mail index are gone.
    const restore = failWhen('persons', 'DELETE',
      "NOT EXISTS (SELECT 1 FROM interactions WHERE source_key = 'account:personal') AND NOT EXISTS (SELECT 1 FROM app_source_accounts WHERE account = 'personal') AND NOT EXISTS (SELECT 1 FROM app_mail_messages WHERE account = 'personal')");
    await expect(call('delete_source_data', { source: 'account:personal', confirm: true }, me)).rejects.toThrow();
    restore();
    expect(contents(tables)).toBe(before);
    expect(count("SELECT COUNT(*) AS count FROM interactions WHERE source_key = 'account:personal'")).toBe(conversations);
    expect(ctx!.accounts.get('personal', 'mail')).toBeTruthy();
    expect(await names()).toEqual(['Jordan Bell', 'Maya Chen']);

    // Tried again, it deletes.
    const deleted = await call('delete_source_data', { source: 'account:personal', confirm: true }, me);
    expect(deleted).toMatchObject({ status: 'saved', interactions: conversations, removedPeople: 2 });
    expect(await names()).toEqual([]);
  });
});
