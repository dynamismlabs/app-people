import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp, fixtureSource, SetupRequired, SourceUnavailable, type Connection, type Context, type ConnectorSource, type Platform } from '@app-builder/core';
import { backupNode, createTestConnection, openNodePlatform, restoreNode } from '@app-builder/core/node';
import { AppError, type AppPrincipal } from '../src/lib/contract.js';
import { application } from '../src/app.js';
import { definition } from '../src/people/actions.js';
import { bindContext, ctx as peopleContext, HUB_TOOLS, openContext, useContext } from '../src/people/runtime.js';
import type { Ctx } from '../src/people/domain/context.js';

/**
 * People's tests, on App Builder. Each test gets a disposable data directory
 * opened by the kit (its migrations and People's), and People's context on
 * the kit's own connection. `call` runs an action the way the kit does for
 * the caller: the person's browser (owner), an assistant connection with the
 * sources chosen for it, or the job. Hub calls go to a fake hub that answers
 * with Ri's tool names (test/fakes.ts).
 */
const created: string[] = [];
/** A directory created with mkdtemp. Only these are ever removed. */
export function tempDir(prefix = 'people-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}
export function cleanup() {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export const state: { dataDir: string; platform: Platform | null; close: (() => void) | null } = { dataDir: '', platform: null, close: null };
export const INSTANCE = '0194d7a0-0000-4000-8000-0000000000ff';
export const clock = { now: new Date('2026-10-15T15:00:00.000Z') };
export function advance(ms: number) { clock.now = new Date(clock.now.getTime() + ms); }

export async function setup(options: { now?: string; realTime?: boolean } = {}): Promise<Ctx> {
  clock.now = new Date(options.now ?? '2026-10-15T15:00:00.000Z');
  return open(tempDir(), options.realTime ? () => new Date() : () => clock.now);
}
async function open(dataDir: string, now?: () => Date): Promise<Ctx> {
  const opened = await openNodePlatform(application, { dataDir, baseURL: 'http://127.0.0.1:4364', secret: 'test-secret-'.padEnd(64, 'x') });
  const ctx = openContext({ connection: opened.connection, instanceId: INSTANCE }, { now });
  bindContext(opened.platform, ctx);
  state.platform = opened.platform;
  state.close = opened.close;
  state.dataDir = dataDir;
  return ctx;
}
/** Stop and start again on the same data, as the service does after a restart. */
export async function restart(now: () => Date = () => new Date()): Promise<Ctx> {
  state.close?.();
  return open(state.dataDir, now);
}
/**
 * A consistent copy of the database file, opened as a new installation: what
 * the kit's change command snapshots before switching and puts back on a
 * rollback.
 */
export async function restoreDatabaseCopy(now: () => Date = () => new Date()): Promise<Ctx> {
  const target = tempDir('people-copy-');
  peopleContext().db.exec(`VACUUM INTO '${path.join(target, 'data.sqlite').replaceAll("'", "''")}'`);
  state.close?.();
  return open(target, now);
}
/** The kit's installation backup, restored into a new empty data directory, and People opened there. */
export async function backupAndRestore(now: () => Date = () => new Date()): Promise<Ctx> {
  const backup = path.join(tempDir('people-backup-'), 'backup');
  const target = path.join(tempDir('people-restore-'), 'data');
  await backupNode(state.platform!, application.config.id, backup);
  await restoreNode(backup, target, application.config.id);
  state.close?.();
  return open(target, now);
}

export function teardown(ctx: Ctx | null) {
  void ctx;
  useContext(null);
  state.close?.();
  state.platform = null;
  state.close = null;
  hub.beforeRi7 = false;
  delete process.env.PEOPLE_PREVIEW;
  cleanup();
}

export type Capability = (name: string, input: unknown, target?: unknown) => Promise<unknown>;
export interface Grant { account: string; binding: 'mail' | 'calendar' }
export interface Caller {
  principal: AppPrincipal;
  audience: 'user' | 'agent' | 'schedule';
  /** The accounts the hub lends People while this caller runs. */
  accounts: Grant[];
  /** For a chat: the connection made for it (createScope). */
  scopeRef?: string | null;
  capability?: Capability;
}
const noCapability: Capability = async (name) => { throw new AppError('forbidden', `No capability ${name} in this test`); };

export const owner = (accounts: string[] = [], capability?: Capability, _automatic = false): Caller => ({
  principal: { kind: 'owner-ui', id: 'owner' }, audience: 'user', capability,
  accounts: accounts.flatMap((account) => [{ account, binding: 'mail' as const }, { account, binding: 'calendar' as const }]),
});
/** The fictional preview (PEOPLE_PREVIEW=1). */
export const fixture = (audience: 'user' | 'agent' = 'user'): Caller => ({
  principal: { kind: 'fixture', id: INSTANCE, fixtureAudience: audience }, audience, accounts: [],
});
export const chat = (id: string, scopeRef: string | null, capability?: Capability): Caller => ({
  principal: { kind: 'chat', id }, audience: 'agent', capability, scopeRef, accounts: [],
});
export const job = (accounts: { account: string; binding?: 'mail' | 'calendar' }[], capability?: Capability): Caller => ({
  principal: { kind: 'job', id: 'update_people' }, audience: 'schedule', capability,
  accounts: accounts.map((item) => ({ account: item.account, binding: item.binding ?? 'mail' })),
});

/** Connections made for chats: the kit records each one's choice, as the consent screen does. */
const connections = new Map<string, { actorId: string; clientId: string; accessToken: string }>();
/** In Ri the owner made a scope for a chat. On App Builder that is an OAuth connection with the choice from the consent screen. */
export async function createScope(input: { actorId: string; sources: string[] | null; operations: ('read' | 'write')[]; label?: string }, _caller?: Caller) {
  const made = await createTestConnection(state.platform!, { name: input.label ?? input.actorId, sources: input.sources, write: input.operations.includes('write') });
  connections.set(made.clientId, { actorId: input.actorId, ...made });
  return { scopeRef: made.clientId, accessToken: made.accessToken };
}
/** Disconnecting in the app's Settings removes the connection and its choice. */
export async function revokeScope(input: { scopeRef: string }, _caller?: Caller) {
  await state.platform!.driver.query({ sql: 'DELETE FROM oauth_applications WHERE client_id = ?', params: [input.scopeRef], method: 'run' });
  return { status: 'saved' as const };
}

/** The hub as Ri answers it, over the old fake capability: Ri's tool names, the account argument and Ri's errors as the kit's client reports them. */
export function hubSource(capability: Capability, accounts: Grant[]): ConnectorSource {
  const back = Object.fromEntries(Object.entries(HUB_TOOLS).map(([name, tool]) => [tool, name]));
  return {
    kind: 'hub',
    // Ri lists a provider's tools only when an account of it is granted.
    async listTools() {
      const kinds = new Set(accounts.map((grant) => grant.binding));
      return Object.values(HUB_TOOLS).filter((tool) => tool.startsWith('ri__') || (tool.startsWith('gmail__') && kinds.has('mail')) || (tool.startsWith('google_calendar__') && kinds.has('calendar')));
    },
    async callTool(tool, args) {
      const name = back[tool];
      if (!name) throw new Error(`Tool ${tool} not found`);
      const kind = tool.startsWith('gmail__') ? 'mail' : tool.startsWith('google_calendar__') ? 'calendar' : null;
      const { account: given, ...rest } = args as Record<string, unknown> & { account?: string };
      const choices = kind ? accounts.filter((grant) => grant.binding === kind).map((grant) => grant.account) : [];
      // As the kit reports Ri's choose_account answer: the names, structured.
      if (kind && !given && choices.length > 1) throw new SetupRequired(`Choose which account to use (${choices.join(', ')}). Pass account.`, { code: 'choose_account', accounts: choices });
      const account = given ?? (kind ? choices[0] : undefined);
      try { return await capability(name, rest, account ? { account } : undefined); }
      catch (error) {
        const code = (error as AppError)?.code;
        const message = (error as Error).message;
        if (code === 'revoked' || code === 'forbidden') throw new SetupRequired(code === 'forbidden' ? `Not allowed: ${message}` : message);
        if (code === 'busy' || code === 'timeout') throw new SourceUnavailable(message);
        if (code === 'not_found') return await riNotFound(tool, args, error as AppError);
        // Ri's own services answer `unsupported` by code, as the kit's client reads it.
        if (code === 'unsupported') return await fixtureSource({ tools: { [tool]: { error: { code, message } } } }).callTool(tool, args);
        throw error;
      }
    },
  };
}

/** Which Ri the fake hub answers as. Reset after each test. */
export const hub = { beforeRi7: false };
/**
 * Ri's answer when what was asked for isn't there, read by the kit's own client. Since
 * dynamismlabs/ri#7 a provider's 404 or 410 is `not_found` with its status. A hub from before it
 * sent `provider_error`, with the status only in the message. Ri's own records were `not_found`
 * throughout, without a status.
 */
function riNotFound(tool: string, args: Record<string, unknown>, error: AppError) {
  const status = error.httpStatus;
  const answer = !status ? { code: 'not_found', message: error.message }
    : hub.beforeRi7 ? { code: 'provider_error', message: `provider error ${status} for GET ${tool}` }
    : { code: 'not_found', httpStatus: status, message: `provider error ${status} for GET ${tool}` };
  return fixtureSource({ tools: { [tool]: { error: answer } } }).callTool(tool, args);
}

/** What the hub lends People for this call, as the job's last check found it. */
function lend(ctx: Ctx, accounts: Grant[]) {
  const of = (binding: 'mail' | 'calendar') => {
    const list = [...new Set(accounts.filter((grant) => grant.binding === binding).map((grant) => grant.account))];
    return list.length ? { accounts: list, multi: list.length > 1 } : null;
  };
  ctx.settings.set('hub.accounts', { mail: of('mail'), calendar: of('calendar'), tools: Object.values(HUB_TOOLS), checkedAt: ctx.now().toISOString(), error: null });
}

export const calls: { name: string; input: unknown; principal: string }[] = [];
const kitActions = new Map(application.actions.map((action) => [action.name, action]));

function kitContext(caller: Caller): Context {
  const platform = state.platform!;
  const base = { platform, viewer: { id: 'local-owner', name: 'You', email: 'owner@localhost' }, request: new Request('http://127.0.0.1:4364/api/trpc/run') };
  if (caller.principal.kind === 'chat') {
    const made = caller.scopeRef ? connections.get(caller.scopeRef) : undefined;
    // A connection belongs to the chat it was made for: another chat can't use its token.
    const own = made && made.actorId === `chat:${caller.principal.id}` ? made : undefined;
    const connection: Connection = { clientId: own?.clientId ?? `missing-${caller.principal.id}`, name: caller.principal.id, sources: [], write: false, collections: false };
    return { ...base, connection, _choice: own?.clientId ?? null } as Context;
  }
  if (caller.principal.kind === 'job') {
    return { ...base, job: { name: 'update_people', runId: `update_people@${new Date().toISOString()}`, scheduledFor: new Date().toISOString(), attempt: 1, checkpoint: undefined, saveCheckpoint: async () => {} } };
  }
  return base;
}

let mcpApp: { platform: Platform; app: ReturnType<typeof createApp> } | null = null;
/**
 * The connection's current choice, as the kit gives it to each MCP request: a request with the
 * connection's token goes through the kit's own sign-in, which keeps only the chosen sources that
 * still exist and saves that, then the choice is read back.
 */
async function withChoice(kit: Context): Promise<Context> {
  const id = (kit as Context & { _choice?: string | null })._choice;
  if (!kit.connection) return kit;
  // The kit refuses a token without a recorded choice, or one made for another chat, before any action runs.
  if (!id) throw new AppError('forbidden', "This caller's access could not be verified");
  const token = [...connections.values()].find((item) => item.clientId === id)!.accessToken;
  if (mcpApp?.platform !== state.platform) mcpApp = { platform: state.platform!, app: createApp({ ...application, viewHTML: '<!doctype html>' }, () => state.platform!) };
  const signedIn = await mcpApp.app.request('http://127.0.0.1:4364/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
  });
  if (signedIn.status === 401) throw new AppError('revoked', 'This connection was disconnected');
  const row = await state.platform!.driver.query({ sql: 'SELECT sources, can_write FROM connection_access WHERE client_id = ?', params: [id], method: 'get' });
  const [sources, write] = row.rows as [string | null, number] | [];
  // Disconnected in Settings: the kit answers 401 and Ri shows Reconnect.
  if (sources === undefined) throw new AppError('revoked', 'This connection was disconnected');
  return { ...kit, connection: { ...kit.connection, sources: sources ? JSON.parse(sources) : null, write: !!write } };
}

/**
 * Invoke an action as the kit does for this caller: check who may call it,
 * refuse writes on a read-only connection, parse the input, run it through
 * People's adapter and parse the output.
 */
export async function call<T = any>(name: string, input: unknown, caller: Caller, invocationId: string = randomUUID()): Promise<T> {
  const action = kitActions.get(name);
  const people = definition.actions.find((item) => item.name === name);
  if (!action || !people) throw new Error(`Unknown action ${name}`);
  // Who may call it is the kit's: the browser (user), any connection (agent), the job (schedule).
  // View-only actions are agent actions the host keeps from the model; People's own owner check then applies.
  const allowed = caller.audience === 'schedule' ? people.audience.includes('schedule') : action.audience.includes(caller.audience);
  if (!allowed) throw new AppError('forbidden', 'This action is unavailable to this caller');
  lend(peopleContext(), caller.accounts);
  state.platform!.connectors = hubSource(caller.capability ?? noCapability, caller.accounts);
  const kit = await withChoice(kitContext(caller));
  if (action.effect !== 'read' && kit.connection && !kit.connection.write) throw new AppError('forbidden', `${kit.connection.name} can read but not make changes`);
  if (caller.principal.kind === 'fixture') process.env.PEOPLE_PREVIEW = '1'; else delete process.env.PEOPLE_PREVIEW;
  calls.push({ name, input, principal: `${caller.principal.kind}:${caller.principal.id}` });
  try {
    const result = await action.execute(kit, { ...(input as object), ...(invocationId ? { requestId: invocationId } : {}) });
    return JSON.parse(JSON.stringify(result)) as T;
  } catch (error) {
    // The adapter hands People's errors to the kit; tests read People's own code.
    const cause = (error as { cause?: unknown }).cause;
    throw cause instanceof AppError ? cause : error;
  } finally {
    delete process.env.PEOPLE_PREVIEW;
  }
}

export async function expectCode(promise: Promise<unknown>, code: string) {
  try { await promise; } catch (error) {
    if ((error as AppError).code !== code) throw new Error(`Expected ${code}, got ${(error as AppError).code}: ${(error as Error).message}`);
    return error as AppError;
  }
  throw new Error(`Expected ${code}, but the call succeeded`);
}

export { definition };
