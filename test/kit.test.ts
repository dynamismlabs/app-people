/**
 * People through App Builder's own surfaces: MCP with connection tokens, the
 * show_* views, the job runner, and the hub as Ri answers it (Ri's tool names,
 * the account argument, the choose-account answer, its errors). Also what the
 * kit's own fixture source can and can't drive.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp, fixtureSource, runDueJobs, runJobNow, jobStatus, type ConnectorFixtures } from '@app-builder/core';
import { createTestConnection } from '@app-builder/core/node';
import { application } from '../src/app.js';
import type { Ctx } from '../src/people/domain/context.js';
import { hubAccounts, refreshHubAccounts } from '../src/people/runtime.js';
import { call, hubSource, owner, setup, state, teardown, type Grant } from './helpers.js';
import { fakeHost, mail, OWNER, OWNER_WORK } from './fakes.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup({ now: new Date().toISOString(), realTime: true }); });
afterEach(() => { teardown(ctx); ctx = null; });
const recent = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

const BOTH: Grant[] = [{ account: 'personal', binding: 'mail' }, { account: 'work', binding: 'mail' }, { account: 'personal', binding: 'calendar' }];
function world() {
  return fakeHost({
    personal: {
      email: OWNER,
      mail: [
        mail('p1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Portfolio', body: 'I will send the deck on Friday.', sent: true, date: recent(5), messageId: '<p1@personal.example>' }),
        mail('p2', { from: 'Maya Chen <maya@northstar.example>', to: [OWNER], subject: 'Re: Portfolio', body: 'Thank you!', date: recent(4), inReplyTo: '<p1@personal.example>' }),
        mail('p3', { from: 'Design Weekly <news@designweekly.example>', to: [OWNER], subject: 'This week', body: 'Read more', date: recent(3), headers: { 'List-Unsubscribe': '<https://designweekly.example/u>', 'List-Id': 'weekly.designweekly.example' } }),
      ],
      events: [
        { id: 'e1', summary: 'Portfolio discussion', start: new Date(Date.now() + 864e5).toISOString(), end: new Date(Date.now() + 864e5 + 36e5).toISOString(), attendees: [{ email: OWNER, self: true, organizer: true }, { email: 'maya@northstar.example', displayName: 'Maya Chen' }] },
      ],
    },
    work: {
      email: OWNER_WORK,
      mail: [mail('w1', { from: OWNER_WORK, to: ['Jordan Bell <jordan@fieldwork.example>'], subject: 'Scope', body: 'Proposal attached.', sent: true, date: recent(6) })],
    },
  });
}

async function mcp(token: string, method: string, params: Record<string, unknown>) {
  const app = createApp({ ...application, viewHTML: '<!doctype html><html><body></body></html>' }, () => state.platform!);
  const response = await app.request('http://127.0.0.1:4364/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: response.status, body: response.status === 200 ? await response.json() as { result?: any; error?: any } : null };
}
const tool = async (token: string, name: string, args: Record<string, unknown> = {}) => (await mcp(token, 'tools/call', { name, arguments: args })).body!.result;

/** Run the job the way the kit's runner does, against the given hub. */
async function runJob(hub = world(), accounts = BOTH) {
  state.platform!.connectors = hubSource(hub.capability, accounts);
  const started = await runJobNow(application, state.platform!, 'update_people');
  await started.done;
  return hub;
}

describe('the job in place of Ri\'s schedule', () => {
  it('asks the hub which accounts it lends, then reads them on its own', async () => {
    const hub = await runJob();
    const lent = hubAccounts(ctx!.db);
    expect(lent.mail).toEqual({ accounts: ['personal', 'work'], multi: true });
    // One calendar account answers without a name: People takes its primary calendar's address.
    expect(lent.calendar).toEqual({ accounts: [OWNER], multi: false });
    // Several mail accounts: People names the account. One calendar account: it doesn't.
    expect(hub.calls.filter((item) => item.name === 'gmail.read_message').every((item) => item.account)).toBe(true);
    const status = await jobStatus(application, state.platform!);
    expect(status.jobs[0].lastRun?.status).toBe('succeeded');
    const names = (await call('list_people', { limit: 50 }, owner(['personal', 'work']))).items.map((item: { name: string }) => item.name).sort();
    expect(names).toEqual(['Jordan Bell', 'Maya Chen']);
  });

  it('a single account is found by its address, and no account argument is sent', async () => {
    const hub = await runJob(world(), [{ account: 'personal', binding: 'mail' }]);
    // The hub's answer for one account is its address, from get_profile.
    expect(hubAccounts(ctx!.db).mail).toEqual({ accounts: [OWNER], multi: false });
    expect(hub.calls.some((item) => item.name === 'gmail.read_message')).toBe(true);
  });

  it('a duplicate wake-up for the same five minutes does nothing', async () => {
    state.platform!.connectors = hubSource(world().capability, BOTH);
    const at = Date.now();
    await runDueJobs(application, state.platform!, { now: () => at });
    const first = await runDueJobs(application, state.platform!, { now: () => at + 5 * 60_000 });
    const again = await runDueJobs(application, state.platform!, { now: () => at + 5 * 60_000 + 1000 });
    expect(first.length).toBe(1);
    expect(again).toEqual([]);
  });

  it('a hub that is down retries later and keeps every account\'s checkpoint', async () => {
    await runJob();
    const before = ctx!.db.all('SELECT account, kind, checkpoint FROM app_source_accounts ORDER BY account, kind');
    state.platform!.connectors = { kind: 'hub', async listTools() { throw new (await import('@app-builder/core')).SourceUnavailable("Ri isn't reachable at 127.0.0.1:3000. Trying again later."); }, async callTool() { throw new Error('unreachable'); } };
    const started = await runJobNow(application, state.platform!, 'update_people');
    await started.done;
    const status = await jobStatus(application, state.platform!);
    expect(status.jobs[0].lastRun?.status).toBe('retrying');
    expect(ctx!.db.all('SELECT account, kind, checkpoint FROM app_source_accounts ORDER BY account, kind')).toEqual(before);
  });

  it('a revoked hub fails the run with what to do, and keeps the records', async () => {
    await runJob();
    state.platform!.connectors = fixtureSource({ revoked: true });
    const started = await runJobNow(application, state.platform!, 'update_people');
    await started.done;
    const status = await jobStatus(application, state.platform!);
    expect(status.jobs[0].lastRun?.status).toBe('failed');
    expect(status.jobs[0].lastRun?.error).toMatch(/connect this app again/i);
    expect((await call('list_people', { limit: 50 }, owner())).items.length).toBe(2);
  });
});

describe('assistants over MCP', () => {
  it('needs a token, and each connection sees only the sources chosen for it', async () => {
    await runJob();
    expect((await mcp('not-a-token', 'tools/list', {})).status).toBe(401);
    const all = await createTestConnection(state.platform!, { name: 'Ri' });
    const work = await createTestConnection(state.platform!, { name: 'Ri · Work', sources: ['account:work'], write: false });
    const tools = (await mcp(all.accessToken, 'tools/list', {})).body!.result.tools as { name: string; _meta?: { ui?: { visibility?: string[] } } }[];
    const listed = tools.map((item) => item.name);
    expect(listed).toContain('search_people');
    // The person's own decisions are tools the view may call and the host keeps from the model.
    expect(tools.find((item) => item.name === 'merge_people')?._meta?.ui?.visibility).toEqual(['app']);
    expect(tools.find((item) => item.name === 'search_people')?._meta?.ui?.visibility).toBeUndefined();
    const everyone = await tool(all.accessToken, 'list_people', { limit: 50 });
    expect(everyone.structuredContent.result.items.map((item: { name: string }) => item.name).sort()).toEqual(['Jordan Bell', 'Maya Chen']);
    const workOnly = await tool(work.accessToken, 'list_people', { limit: 50 });
    expect(workOnly.structuredContent.result.items.map((item: { name: string }) => item.name)).toEqual(['Jordan Bell']);
    // Searching for someone outside the connection's sources finds nothing, not even a count.
    const hidden = await tool(work.accessToken, 'search_people', { text: 'Maya', limit: 10 });
    expect(hidden.structuredContent.result.total).toBe(0);
    // A read-only connection can't write.
    const jordan = workOnly.structuredContent.result.items[0];
    const refused = await tool(work.accessToken, 'save_note', { subjectKind: 'person', subjectId: jordan.id, body: 'Prefers mornings.' });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/can read but not make changes/);
  });

  it('draws People\'s cards, within the connection\'s sources', async () => {
    await runJob();
    const all = await createTestConnection(state.platform!, { name: 'Ri' });
    const personal = await createTestConnection(state.platform!, { name: 'Ri · Personal', sources: ['account:personal'] });
    const people = await tool(all.accessToken, 'show_people', { text: 'Maya' });
    expect(people.structuredContent.view).toBe('show_people');
    expect(people.structuredContent.data.people[0].name).toBe('Maya Chen');
    expect(people._meta?.ui?.resourceUri ?? people._meta?.['openai/outputTemplate']).toBeUndefined();
    const maya = people.structuredContent.data.people[0].id;
    const jordan = (await tool(all.accessToken, 'search_people', { text: 'Jordan', limit: 5 })).structuredContent.result.items[0].id;
    const card = await tool(all.accessToken, 'show_person', { id: maya });
    expect(card.structuredContent.data.name).toBe('Maya Chen');
    expect(card.structuredContent.data.nextMeeting?.title).toBe('Portfolio discussion');
    // A card for someone outside the connection's sources is refused; a list by ids leaves them out.
    expect((await tool(personal.accessToken, 'show_person', { id: jordan })).isError).toBe(true);
    const byIds = await tool(personal.accessToken, 'show_people', { ids: [jordan, maya] });
    expect(byIds.structuredContent.data.people.map((item: { name: string }) => item.name)).toEqual(['Maya Chen']);
    const today = await tool(all.accessToken, 'show_today', {});
    expect(today.structuredContent.data.meetings[0].people.map((item: { name: string }) => item.name)).toEqual(['Maya Chen']);
    // The selection's title is only given for records the connection may see.
    expect((await tool(personal.accessToken, 'get_record_title', { kind: 'person', id: jordan })).structuredContent.result.title).toBeNull();
    expect((await tool(personal.accessToken, 'get_record_title', { kind: 'person', id: maya })).structuredContent.result.title).toBe('Maya Chen');
  });

  it('a deleted import leaves the connections that chose it, and an emptied choice sees nothing', async () => {
    const me = owner();
    await call('save_person', { name: 'Robin Vale' }, me);
    const preview = await call('preview_import', { fileName: 'contacts.csv', mimeType: 'text/csv', base64: Buffer.from('Name,Email\nKai Moreno,kai@imported.example\n').toString('base64') }, me);
    await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, me);
    const imported = (await call('list_sources', {}, me)).imports[0].source as string;
    const only = await createTestConnection(state.platform!, { name: 'Ri · Import', sources: [imported] });
    const mixed = await createTestConnection(state.platform!, { name: 'Ri · Mixed', sources: ['manual', imported] });
    const names = async (token: string) => (await tool(token, 'list_people', { limit: 50 })).structuredContent.result.items.map((item: { name: string }) => item.name).sort();
    expect(await names(only.accessToken)).toEqual(['Kai Moreno']);
    await call('delete_source_data', { source: imported, confirm: true }, me);
    // The kit drops the deleted import from both choices and saves them. Emptied, a choice never widens to everything.
    expect(await names(only.accessToken)).toEqual([]);
    expect(await names(mixed.accessToken)).toEqual(['Robin Vale']);
    const saved = (await state.platform!.driver.query({ sql: 'SELECT client_id, sources FROM connection_access', params: [], method: 'all' })).rows as [string, string | null][];
    expect(Object.fromEntries(saved.map(([id, sources]) => [id, sources && JSON.parse(sources)]))).toMatchObject({ [only.clientId]: [], [mixed.clientId]: ['manual'] });
  });

  it('opens the whole app with open_people, and its view reaches nothing on the network', async () => {
    const all = await createTestConnection(state.platform!, { name: 'Ri' });
    const tools = (await mcp(all.accessToken, 'tools/list', {})).body!.result.tools as { name: string; _meta?: Record<string, any> }[];
    const open = tools.find((item) => item.name === 'open_people')!;
    expect(open._meta?.ui?.resourceUri).toBe('ui://people/main');
    const resources = (await mcp(all.accessToken, 'resources/read', { uri: 'ui://people/main' })).body!.result;
    expect(resources.contents[0]._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [] });
  });
});

describe('the person\'s own work inside a host', () => {
  it('a view with every source acts as the owner for view-only actions; a limited connection stays limited', async () => {
    await runJob();
    const everything = await createTestConnection(state.platform!, { name: 'Ri' });
    const reader = await createTestConnection(state.platform!, { name: 'Ri · Reader', write: false });
    const work = await createTestConnection(state.platform!, { name: 'Ri · Work', sources: ['account:work'] });
    // Sources, as the owner's view in Ri had it.
    const sources = await tool(everything.accessToken, 'list_sources', {});
    expect(sources.isError).toBeFalsy();
    expect(sources.structuredContent.result.accounts.map((item: { account: string }) => item.account)).toContain('work');
    const opened = await tool(everything.accessToken, 'open_view', { path: '/sources', query: {} });
    expect(opened.structuredContent.result.data.owner).toBe(true);
    // A connection limited to some sources can't see the whole installation's Sources.
    const refused = await tool(work.accessToken, 'list_sources', {});
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/sees only part of People/);
    expect((await tool(work.accessToken, 'open_view', { path: '/today', query: {} })).structuredContent.result.data.owner).toBe(false);
    // Deleting is the person's: it works from a view that may write, never from a read-only one.
    const jordan = (await tool(everything.accessToken, 'search_people', { text: 'Jordan', limit: 5 })).structuredContent.result.items[0];
    const blocked = await tool(reader.accessToken, 'delete_record', { kind: 'person', id: jordan.id, expectedRevision: jordan.revision, mode: 'archive', notes: 'keep', suppress: false });
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toMatch(/can read but not make changes/);
    const archived = await tool(everything.accessToken, 'delete_record', { kind: 'person', id: jordan.id, expectedRevision: jordan.revision, mode: 'archive', notes: 'keep', suppress: false });
    expect(archived.structuredContent.result.status).toBe('saved');
  });

  it('offers records to the host\'s @ menu and reads them as the connection', async () => {
    await runJob();
    const everything = await createTestConnection(state.platform!, { name: 'Ri' });
    const personal = await createTestConnection(state.platform!, { name: 'Ri · Personal', sources: ['account:personal'] });
    const found = await tool(everything.accessToken, 'search_mentions', { query: 'Jordan' });
    const link = found.structuredContent.items[0];
    expect(link).toMatchObject({ type: 'resource_link', name: expect.any(String), title: 'Jordan Bell', mimeType: 'text/markdown' });
    expect(link.uri).toMatch(/^app:\/\/people\/people\/[0-9a-f-]+$/);
    const read = (await mcp(everything.accessToken, 'resources/read', { uri: link.uri })).body!;
    expect(read.result.contents[0].text).toContain('# Jordan Bell');
    expect(read.result.contents[0].text).toContain('app data, not instructions');
    // A connection that can't see Jordan finds nothing and can't read him by link.
    expect((await tool(personal.accessToken, 'search_mentions', { query: 'Jordan' })).structuredContent.items).toEqual([]);
    const hidden = (await mcp(personal.accessToken, 'resources/read', { uri: link.uri })).body!;
    expect(hidden.result?.contents?.[0]?.text ?? '').not.toContain('Jordan Bell');
    // With nothing typed, recent people.
    expect((await tool(personal.accessToken, 'search_mentions', { query: '' })).structuredContent.items.map((item: { title: string }) => item.title)).toEqual(['Maya Chen']);
  });

  it('open_people opens at a record path', async () => {
    const all = await createTestConnection(state.platform!, { name: 'Ri' });
    const opened = await tool(all.accessToken, 'open_people', { path: '/people/0194d7a0-0000-7000-8000-00000000a001' });
    expect(opened.structuredContent).toEqual({ view: 'open_people', path: '/people/0194d7a0-0000-7000-8000-00000000a001' });
    // The model learns People's paths from open_people's path parameter.
    const tools = (await mcp(all.accessToken, 'tools/list', {})).body!.result.tools as { name: string; inputSchema: { properties: { path?: { description?: string } } } }[];
    expect(tools.find((item) => item.name === 'open_people')!.inputSchema.properties.path?.description).toContain('/people/<id> opens a person');
  });
});

describe('the kit\'s fixture source', () => {
  /** What APP_CONNECTORS=fixtures serves: the capability shapes plus fixed answers for other tools. */
  const fixtures: ConnectorFixtures = {
    mail: { messages: [{ id: 'm1', from: { name: 'Maya Chen', email: 'maya@northstar.example' }, to: [{ email: OWNER }], cc: [], subject: 'Hello', date: recent(2), snippet: 'Hello', text: 'Hello', labels: ['INBOX'] }] },
    calendar: { events: [] },
    tools: {
      gmail__get_profile: { result: { emailAddress: OWNER, historyId: '100' } },
      ri__ai_text: { result: { text: '{"commitments":[],"resolutions":[],"facts":[],"stages":[]}' } },
      ri__create_task: { result: { id: 'task-fixture-1', title: 'Send the deck', status: 'open' } },
      ri__get_task: { result: { id: 'task-fixture-1', title: 'Send the deck', status: 'done', completedAt: '2026-11-12T00:00:00Z' } },
    },
  };

  it('drives Ri\'s services: a follow-up becomes one Ri task and its status comes back', async () => {
    const person = (await call('save_person', { name: 'Maya Chen' }, owner())).record;
    // call() points the hub at the fake. From here the kit's own fixture source answers.
    state.platform!.connectors = fixtureSource(fixtures);
    const created = await runAs('create_follow_up', { subject: { kind: 'person', id: person.id }, title: 'Send the deck', dueAt: '2026-11-20' });
    expect(created.link, JSON.stringify(created.link)).toMatchObject({ taskId: 'task-fixture-1' });
    expect(created.created).toBe(true);
    const checked = await runAs('check_follow_ups', { ids: [created.link.id] });
    expect(checked.items[0].taskStatus).toMatch(/done|completed/i);
    // Ri's own services need no approval: the fixture's approval answer is for writes that reach outside.
  });

  it('can\'t drive People\'s mail sync: it has no Gmail history or full messages, so the account waits with a clear reason', async () => {
    state.platform!.connectors = fixtureSource(fixtures);
    const c = ctx!;
    const kit = { platform: state.platform!, viewer: { id: 'local-owner', name: 'You', email: 'owner@localhost' }, request: new Request('http://127.0.0.1:4364/') };
    const lent = await refreshHubAccounts(kit, c);
    expect(lent.mail).toEqual({ accounts: [OWNER], multi: false });
    const started = await runJobNow(application, state.platform!, 'update_people');
    await started.done;
    const sources = await runAs('list_sources', {});
    const account = sources.accounts.find((item: { kind: string }) => item.kind === 'mail');
    expect(account.lastError ?? '').toMatch(/gmail__list_history|gmail__read_message|allowed/);
    expect((await runAs('list_people', { limit: 10 })).items).toEqual([]);
  });
});

/** Call an action as the owner's browser, with whatever hub the platform has now. */
async function runAs(name: string, input: Record<string, unknown>) {
  const action = application.actions.find((item) => item.name === name)!;
  return JSON.parse(JSON.stringify(await action.execute({ platform: state.platform!, viewer: { id: 'local-owner', name: 'You', email: 'owner@localhost' }, request: new Request('http://127.0.0.1:4364/') }, input)));
}
