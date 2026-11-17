/**
 * People's runtime on App Builder: its database connection, who is calling,
 * and the hub calls it makes for Gmail, Calendar and Ri's services.
 *
 * In Ri, People ran inside Ri's app engine, which opened its database, told
 * each action who was calling (the owner's view, a chat with a scope, the
 * schedule) and handed it Ri's capabilities. Here the kit runs the app, and
 * this file builds the same `AppInvocation` from the kit's request context:
 *
 * - The person's own browser (no OAuth connection) is the owner.
 * - An assistant connection (a Ri place, Claude, ChatGPT) is a chat, limited
 *   to the sources the person chose for it on the kit's consent screen.
 * - The kit's job runner is the job, limited to the accounts Ri lends People.
 *
 * People's domain code is synchronous SQL in transactions. The kit gives apps
 * only an async driver without interactive transactions (and D1 has none), so
 * People opens its own synchronous better-sqlite3 connection to the kit's
 * data.sqlite, in the same process, after the kit has migrated it. That makes
 * People a Node-only app (no Cloudflare). See docs/parity.md.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v3';
import { ApprovalPending, SetupRequired, SourceUnavailable, connectors, installationOwner, type Context as KitContext, type Platform } from '@app-builder/core';
import { AppError, type AccountGrant, type AppInvocation, type AppPrincipal } from '../lib/contract.js';
import { accountSource, actorOf, scopeFingerprint, sha256, type AccessScope, type Operation } from '../lib/data.js';
import { FIXTURE_ACCOUNTS } from './fixtures/seed.js';
import { createContext, type Ctx, type Db, type ScopeResolver } from './domain/context.js';
import { resolveScope } from './domain/scope.js';
import { ensureDefaultCollection } from './domain/sources.js';
import { ensureSearchIndex } from './domain/reindex.js';

// ─── The database ────────────────────────────────────────────────────────────

let current: Ctx | null = null;
const contexts = new WeakMap<Platform, Promise<Ctx>>();

/**
 * People's context over a synchronous connection to the kit's database. The
 * kit has already applied People's migrations (src/people/domain/migrations.ts).
 */
export function openContext(boot: { connection: Database.Database; instanceId: string; ownsConnection?: boolean }, options: { now?: () => Date } = {}): Ctx {
  const raw = boot.connection;
  raw.pragma('busy_timeout = 5000');
  raw.pragma('synchronous = NORMAL');
  let ctx: Ctx;
  const mutate = createMutate(() => ctx);
  ctx = createContext({
    raw,
    mutate,
    scopes: (db) => createScopes(db),
    close: () => { if (boot.ownsConnection) raw.close(); },
    instanceId: boot.instanceId,
    now: options.now,
  });
  ctx.db.tx(() => ensureDefaultCollection(ctx));
  // Rows written under older search rules are rebuilt once, guarded by a stored version.
  ensureSearchIndex(ctx);
  // Interrupted steps resume from their committed checkpoint on the next run.
  ctx.jobs.recover();
  return ctx;
}

/** People's context for a running installation, opened once per platform on the kit's own data.sqlite. */
export function contextFor(platform: Platform): Promise<Ctx> {
  let opened = contexts.get(platform);
  if (!opened) {
    opened = (async () => {
      const files = await platform.driver.query({ sql: 'PRAGMA database_list', params: [], method: 'all' });
      const main = (files.rows as unknown[][]).find((row) => row[1] === 'main');
      const file = main ? String(main[2]) : '';
      if (!file) throw new AppError('unsupported', 'People runs only on the Mac (Node) target. Its records need a SQLite file.');
      const instance = await platform.driver.query({ sql: 'SELECT instance_id FROM installation WHERE id = 1', params: [], method: 'get' });
      return openContext({ connection: new Database(file), instanceId: String((instance.rows as unknown[])[0] ?? 'people'), ownsConnection: true });
    })();
    opened.catch(() => contexts.delete(platform));
    contexts.set(platform, opened);
  }
  return opened.then((ctx) => (current = ctx));
}
/** Tests run People on the kit's own connection to their disposable database. */
export function bindContext(platform: Platform, ctx: Ctx) {
  contexts.set(platform, Promise.resolve(ctx));
  current = ctx;
}
export function ctx(): Ctx {
  if (!current) throw new AppError('app_failed', 'People is still starting. Try again');
  return current;
}
export function useContext(next: Ctx | null) {
  current = next;
}

// ─── Write receipts ──────────────────────────────────────────────────────────

/**
 * A write carrying a `requestId` is done once: a retry with the same id gets
 * the saved result instead of a second change. Ri gave every call an
 * invocation id for this. On App Builder the view sends one with each write
 * (useMutation keeps it across Try again), and assistants may too.
 * A saved result is returned only while the caller's access is unchanged.
 */
function createMutate(get: () => Ctx): Ctx['mutate'] {
  return (invocation, action, input, operation) => {
    const ctx = get();
    const db = ctx.db;
    const digest = sha256(JSON.stringify(input));
    return db.tx(() => {
      const actor = JSON.stringify(invocation.principal);
      const authority = scopeFingerprint(ctx.scopes.resolve(invocation, 'read'));
      const prior = db.get<{ actor: string; action: string; input_digest: string; result: string; authority: string | null }>('SELECT actor, action, input_digest, result, authority FROM app_invocations WHERE id = ?', invocation.id);
      if (prior) {
        if (prior.actor !== actor || prior.action !== action || prior.input_digest !== digest) throw new AppError('conflict', 'This request ID belongs to a different change');
        const owner = invocation.principal.kind === 'owner-ui' || invocation.principal.kind === 'fixture';
        if (!owner && prior.authority !== authority) throw new AppError('conflict', 'Your access changed after this change was saved. Reload to see what you can view now');
        return JSON.parse(prior.result);
      }
      const result = operation();
      db.run('INSERT INTO app_invocations (id, actor, action, input_digest, result, authority) VALUES (?, ?, ?, ?, ?, ?)', invocation.id, actor, action, digest, JSON.stringify(result), authority);
      return result;
    });
  };
}

// ─── Who may see what ────────────────────────────────────────────────────────

/** Every source key that exists now: accounts, collections and imports. A connection allowed "all" sees new ones too. */
export function allSources(db: Db): string[] {
  const keys = new Set<string>();
  for (const row of db.all<{ account: string }>('SELECT DISTINCT account FROM app_source_accounts')) keys.add(accountSource(row.account));
  for (const grant of hubAccounts(db).grants) keys.add(accountSource(grant.account));
  for (const row of db.all<{ source_key: string }>('SELECT source_key FROM collections WHERE archived_at IS NULL')) keys.add(row.source_key);
  for (const row of db.all<{ source_key: string }>('SELECT source_key FROM imports')) keys.add(row.source_key);
  return [...keys];
}

function createScopes(db: Db): ScopeResolver {
  return {
    resolve(invocation, operation: Operation): AccessScope {
      const principal = invocation.principal;
      const actorId = actorOf(invocation);
      if (principal.kind === 'owner-ui' || principal.kind === 'fixture') return { kind: 'owner', actorId };
      const access = invocation.access;
      if (!access) throw new AppError('forbidden', "This caller's access could not be verified");
      if (principal.kind === 'job' || principal.kind === 'background')
        return { kind: 'sources', actorId, scopeRef: null, sources: new Set(access.accounts.map((grant) => accountSource(grant.account))), operations: new Set<Operation>(['read', 'write']) };
      const chosen = access.chosen;
      if (!chosen) throw new AppError('forbidden', 'This connection has no recorded choice. Connect it again');
      if (operation === 'write' && !chosen.write) throw new AppError('forbidden', 'This connection may read but not change these records');
      // Only sources that still exist: Ri removed a deleted import or collection from every scope.
      // The kit keeps each connection's choice as it was made, so People drops the gone ones here.
      const existing = allSources(db);
      return {
        kind: 'sources', actorId, scopeRef: access.scopeRef,
        sources: new Set(chosen.sources ? chosen.sources.filter((key) => existing.includes(key)) : existing),
        operations: new Set<Operation>(chosen.write ? ['read', 'write'] : ['read']),
      };
    },
    list() {
      // How many assistant connections exist, for the Sources summary. The kit keeps them; People only counts.
      try { return db.all<{ client_id: string }>('SELECT client_id FROM connection_access').map((row) => ({ id: row.client_id, revokedAt: null })); }
      catch { return []; }
    },
    get(ref) {
      // The kit keeps each connection's choice (connection_access). People reads it to recheck queued work.
      let row: { client_id: string; sources: string | null; can_write: number } | undefined;
      try { row = db.get('SELECT client_id, sources, can_write FROM connection_access WHERE client_id = ?', ref); }
      catch { return null; }
      if (!row) return null;
      return {
        id: row.client_id, actorId: `chat:${row.client_id}`, revokedAt: null,
        sources: row.sources ? (JSON.parse(row.sources) as string[]).filter((key) => allSources(db).includes(key)) : allSources(db),
        operations: row.can_write ? ['read', 'write'] : ['read'],
      };
    },
    forgetSource() { /* The kit owns each connection's choice (docs/parity.md). */ },
  };
}

export const readScope = (invocation: AppInvocation) => resolveScope(ctx(), invocation, 'read');
export const writeScope = (invocation: AppInvocation) => resolveScope(ctx(), invocation, 'write');
export const actor = (invocation: AppInvocation) => actorOf(invocation);
/** Accounts the hub lends People now, for the owner's view, so missing ones read as disconnected. */
export function granted(invocation: AppInvocation): ReadonlySet<string> | null {
  return invocation.principal.kind === 'owner-ui' && invocation.access ? new Set(invocation.access.accounts.map((item) => item.account)) : null;
}
/** The account grants an invocation carries. The fictional preview's invented accounts read as granted there. */
export function accessOf(invocation: AppInvocation): AppInvocation['access'] {
  if (invocation.principal.kind !== 'fixture') return invocation.access;
  return {
    protocol: 'app-builder-v1', actorId: invocation.access?.actorId ?? 'fixture', scopeRef: null, chosen: null,
    accounts: [
      { account: FIXTURE_ACCOUNTS.personal, binding: 'mail', actions: MAIL_TOOLS, automatic: true },
      { account: FIXTURE_ACCOUNTS.personal, binding: 'calendar', actions: CALENDAR_TOOLS, automatic: true },
      { account: FIXTURE_ACCOUNTS.work, binding: 'mail', actions: MAIL_TOOLS, automatic: true },
    ],
  };
}
export function requireOwner(scope: AccessScope) {
  if (scope.kind !== 'owner') throw new AppError('forbidden', "This connection sees only part of People, so this isn't available here. Open People in your browser to do it");
}

// ─── The hub ─────────────────────────────────────────────────────────────────

/**
 * Ri's actions as People called them, and the hub tools they are now. Mail
 * and calendar sync use Gmail's history and Calendar's sync tokens, which the
 * kit's mail and calendar capabilities don't offer, so People passes these
 * through by name (`connectors(ctx).call`). Ri's own services are `ri__*`.
 */
export const HUB_TOOLS: Record<string, string> = {
  'gmail.get_profile': 'gmail__get_profile',
  'gmail.search_messages': 'gmail__search_messages',
  'gmail.get_message': 'gmail__get_message',
  'gmail.read_message': 'gmail__read_message',
  'gmail.list_history': 'gmail__list_history',
  'google_calendar.list_calendars': 'google_calendar__list_calendars',
  'google_calendar.sync_events': 'google_calendar__sync_events',
  ai_text: 'ri__ai_text',
  extract_text: 'ri__extract_text',
  create_task: 'ri__create_task',
  get_task: 'ri__get_task',
};
export const MAIL_TOOLS = Object.values(HUB_TOOLS).filter((name) => name.startsWith('gmail__'));
export const CALENDAR_TOOLS = Object.values(HUB_TOOLS).filter((name) => name.startsWith('google_calendar__'));
const KIND_LABEL: Record<string, string> = { gmail: 'read your mail', google_calendar: 'read your calendar', ri: "use Ri's services" };

const hubSchema = z.object({
  mail: z.object({ accounts: z.array(z.string()), multi: z.boolean() }).nullable(),
  calendar: z.object({ accounts: z.array(z.string()), multi: z.boolean() }).nullable(),
  tools: z.array(z.string()),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
});
type HubState = z.infer<typeof hubSchema>;
const EMPTY_HUB: HubState = { mail: null, calendar: null, tools: [], checkedAt: null, error: null };

/** The accounts the hub lent People when it last checked. */
export function hubAccounts(db: Db): HubState & { grants: AccountGrant[] } {
  const row = db.get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'hub.accounts'");
  const parsed = row ? hubSchema.safeParse(JSON.parse(row.value)) : null;
  const state = parsed?.success ? parsed.data : EMPTY_HUB;
  const grants: AccountGrant[] = [
    ...(state.mail?.accounts ?? []).map((account) => ({ account, binding: 'mail' as const, actions: state.tools.filter((tool) => tool.startsWith('gmail__')), automatic: true })),
    ...(state.calendar?.accounts ?? []).map((account) => ({ account, binding: 'calendar' as const, actions: state.tools.filter((tool) => tool.startsWith('google_calendar__')), automatic: true })),
  ];
  return { ...state, grants };
}

/** Ri answers a call without an account, when several are granted, with the list to choose from. The kit turns it into this message. */
const CHOOSE = /Choose which account to use \(([^)]*)\)/;
async function discover(client: ReturnType<typeof connectors>, tool: string, account: (value: unknown) => string | null) {
  try {
    const found = account(await client.call(tool, {}));
    return found ? { accounts: [found], multi: false } : null;
  } catch (error) {
    const match = error instanceof SetupRequired ? CHOOSE.exec(error.message) : null;
    if (match) return { accounts: match[1].split(',').map((item) => item.trim()).filter(Boolean), multi: true };
    throw error;
  }
}

/**
 * Ask the hub which accounts it lends People. Ri has no tool that lists them,
 * and the kit's client returns only tool names, so People reads them from a
 * call without an account: one account answers, several answer with the
 * choice (docs/parity.md). Saved for the owner's view and the job.
 */
export async function refreshHubAccounts(kit: KitContext, c: Ctx): Promise<HubState> {
  const client = connectors(kit);
  let state: HubState;
  try {
    const tools = await client.tools();
    const mail = tools.includes('gmail__get_profile')
      ? await discover(client, 'gmail__get_profile', (value) => (value as { emailAddress?: string })?.emailAddress ?? null) : null;
    const calendar = tools.includes('google_calendar__list_calendars')
      ? await discover(client, 'google_calendar__list_calendars', (value) => {
        const calendars = (value as { calendars?: { id: string; primary?: boolean }[] })?.calendars ?? [];
        const primary = calendars.find((item) => item.primary)?.id;
        return primary && primary.includes('@') ? primary : mail?.accounts.length === 1 ? mail.accounts[0] : primary ?? null;
      }) : null;
    state = { mail, calendar, tools, checkedAt: c.now().toISOString(), error: null };
  } catch (error) {
    if (!(error instanceof SetupRequired || error instanceof SourceUnavailable)) throw error;
    // Not connected or not reachable: keep what was known, say why.
    state = { ...hubAccounts(c.db), checkedAt: c.now().toISOString(), error: error.message.slice(0, 300) };
    if (error instanceof SetupRequired) state = { ...state, mail: null, calendar: null, tools: [] };
  } finally { await client.close(); }
  c.settings.set('hub.accounts', state);
  return state;
}

function toAppError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof SetupRequired) return new AppError(/allow|allowed|not allowed/i.test(error.message) ? 'forbidden' : 'revoked', error.message);
  if (error instanceof SourceUnavailable) return new AppError('busy', error.message);
  if (error instanceof ApprovalPending) return new AppError('approval_required', error.message);
  const message = error instanceof Error ? error.message : String(error);
  // The kit's client keeps only the hub's message for a failed call, not its code.
  if (/not.?found|404|410|expired|no longer (available|exists)|gone/i.test(message)) return new AppError('not_found', message.slice(0, 300));
  if (/unsupported|not supported|unavailable here/i.test(message)) return new AppError('unsupported', message.slice(0, 300));
  return new AppError('app_failed', message.slice(0, 300));
}

function hubCapability(kit: KitContext, c: Ctx) {
  let client: ReturnType<typeof connectors> | null = null;
  let tools: Promise<string[]> | null = null;
  const open = () => (client ??= connectors(kit));
  const call = async (name: string, input: unknown, target?: { account?: string }) => {
    const tool = HUB_TOOLS[name];
    if (!tool) throw new AppError('unsupported', `People doesn't use ${name}`);
    try {
      const listed = await (tools ??= open().tools());
      if (!listed.includes(tool)) throw new AppError('forbidden', `People hasn't been allowed to ${KIND_LABEL[tool.split('__')[0]] ?? 'do this'} (${tool}). Allow it on People's page in Ri`);
      const hub = hubAccounts(c.db);
      const kind = tool.startsWith('gmail__') ? hub.mail : tool.startsWith('google_calendar__') ? hub.calendar : null;
      const args: Record<string, unknown> = { ...(input as Record<string, unknown>) };
      if (kind && target?.account) {
        if (!kind.accounts.includes(target.account)) throw new AppError('forbidden', 'Ri no longer lends People this account');
        if (kind.multi) args.account = target.account;
      }
      return await open().call(tool, args);
    } catch (error) { throw toAppError(error); }
  };
  return { call, close: async () => { await client?.close(); } };
}

// ─── Invocations ─────────────────────────────────────────────────────────────

/** The fictional preview (PEOPLE_PREVIEW=1): the owner sees invented records and accounts, and nothing reaches the hub. */
export const previewMode = () => process.env.PEOPLE_PREVIEW === '1';

/**
 * Run People's handler as Ri used to: build the invocation for this request,
 * call it, then close the hub client. Only the installation's owner uses
 * People (it is one person's relationships); other signed-in accounts are refused.
 */
export async function withInvocation<T>(kit: KitContext, options: { requestId?: string; viewOnly?: boolean }, work: (invocation: AppInvocation, c: Ctx) => Promise<T> | T): Promise<T> {
  const c = await contextFor(kit.platform);
  const owner = await installationOwner(kit.platform);
  if (owner && kit.viewer.id !== owner) throw new AppError('forbidden', 'People belongs to one person. Sign in as its owner to use it');
  // In Ri the person's view of People acted as the owner. Inside a host the view and the model share
  // one connection, so People can tell them apart only by the action: a view-only action (the host
  // keeps it from the model, MCP Apps visibility ["app"]) acts as the owner when the person gave
  // this connection every source. A connection limited to some sources stays limited.
  const ownerView = !!options.viewOnly && !!kit.connection && kit.connection.sources === null;
  const principal: AppPrincipal = kit.job ? { kind: 'job', id: kit.job.name }
    : kit.connection && !ownerView ? { kind: 'chat', id: kit.connection.clientId }
    : previewMode() ? { kind: 'fixture', id: c.instanceId, fixtureAudience: 'user' }
    : { kind: 'owner-ui', id: kit.viewer.id };
  const hub = hubCapability(kit, c);
  const controller = new AbortController();
  const invocation: AppInvocation = {
    id: options.requestId ?? randomUUID(),
    principal,
    audience: kit.job ? 'schedule' : kit.connection && !ownerView ? 'agent' : 'user',
    deadline: Date.now() + (kit.job ? 240_000 : 60_000),
    signal: controller.signal,
    access: {
      protocol: 'app-builder-v1', actorId: `${principal.kind}:${principal.id}`,
      scopeRef: kit.connection?.clientId ?? null,
      chosen: kit.connection && !ownerView ? { sources: kit.connection.sources, write: kit.connection.write } : null,
      accounts: principal.kind === 'fixture' ? [] : hubAccounts(c.db).grants,
    },
    capability: (name, input, target) => {
      if (principal.kind === 'fixture') return Promise.reject(new AppError('forbidden', 'The fictional preview reads no accounts'));
      return hub.call(name, input, target);
    },
  };
  useContext(c);
  try { return await work(invocation, c); }
  finally { controller.abort(); await hub.close(); }
}
