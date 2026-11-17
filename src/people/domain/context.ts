import { randomUUID } from 'node:crypto';
import { transaction, type Platform, type Transaction } from '@app-builder/core';
import type { AppInvocation } from '../../lib/contract.js';
import {
  createBlobStore, createJobQueue, createSettings,
  type AccessScope, type BlobStore, type JobQueue, type Operation, type SqlDatabase,
} from '../../lib/data.js';
import { createAccountStore, createMailIndex, type AccountStore, type MailIndex } from '../../lib/sources.js';

export type Param = string | number | bigint | null | Uint8Array;
export type Row = Record<string, unknown>;

type Statement = ReturnType<Transaction['prepare']>;
/**
 * People's synchronous SQL, on the kit's own connection to its data.sqlite
 * through the core's `transaction()`. In Ri this was node:sqlite; on App
 * Builder People first opened a second better-sqlite3 connection of its own,
 * which the core's transactions replace.
 *
 * Every statement runs inside a transaction: `tx(work)` opens one (BEGIN
 * IMMEDIATE, then COMMIT, or ROLLBACK when `work` throws) or joins the one
 * already open, without a savepoint. A statement outside any `tx` is its own
 * transaction, as it was its own implicit one before. Statements are
 * prepared once per transaction. Booleans become 0/1 and Uint8Arrays become
 * Buffers before binding.
 */
export class Db {
  /** The transaction open on the connection, and the statements prepared in it. */
  private open: { tx: Transaction; statements: Map<string, Statement> } | null = null;
  /** When set, read statements are recorded so tests can check their query plans. */
  trace: { sql: string; params: Param[] }[] | null = null;
  constructor(private readonly platform: Platform) {}
  private statement(sql: string): Statement {
    const open = this.open!;
    let statement = open.statements.get(sql);
    if (!statement) {
      statement = open.tx.prepare(sql);
      open.statements.set(sql, statement);
    }
    return statement;
  }
  all<T = Row>(sql: string, ...params: Param[]): T[] {
    this.trace?.push({ sql, params });
    return this.tx(() => this.statement(sql).all(...bind(params)) as T[]);
  }
  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    this.trace?.push({ sql, params });
    return this.tx(() => this.statement(sql).get(...bind(params)) as T | undefined);
  }
  run(sql: string, ...params: Param[]) {
    return this.tx(() => this.statement(sql).run(...bind(params)));
  }
  /** The statement interface the stores in src/lib expect (node:sqlite's shape in Ri). */
  asSql(): SqlDatabase {
    const db = this;
    return {
      prepare: (sql) => ({
        run: (...params) => db.run(sql, ...params),
        get: (...params) => db.tx(() => db.statement(sql).get(...bind(params))),
        all: (...params) => db.tx(() => db.statement(sql).all(...bind(params))),
      }),
      transaction: (work) => db.tx(work),
    };
  }
  get isTransaction() {
    return this.open !== null;
  }
  /** Join an open transaction or run one. The work is synchronous: nothing awaits while it holds the write lock. */
  tx<T>(work: () => T): T {
    if (this.open) return work();
    return transaction({ platform: this.platform }, (tx) => {
      this.open = { tx, statements: new Map() };
      try { return work(); } finally { this.open = null; }
    });
  }
}

const bind = (params: Param[]) => params.map((value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value));

/**
 * Who may see what. In Ri, chats carried a scope the owner created in People's
 * access view. On App Builder each assistant connection carries the sources the
 * person chose on the kit's consent screen; src/people/runtime.ts resolves them.
 */
export interface ScopeResolver {
  resolve(invocation: Pick<AppInvocation, 'principal' | 'access'>, operation: Operation): AccessScope;
  /** Assistant connections, for the Sources summary. */
  list(): { id: string; revokedAt: string | null }[];
  /** One connection's current choice, to recheck work queued under it (a chat's briefing request). Null once disconnected. */
  get(ref: string): { id: string; actorId: string; sources: string[]; operations: Operation[]; revokedAt: string | null } | null;
  /** Ri removed a deleted source from every scope. The kit keeps each connection's choice itself, so this does nothing (docs/parity.md). */
  forgetSource(source: string): void;
}

export interface Ctx {
  db: Db;
  instanceId: string;
  settings: ReturnType<typeof createSettings>;
  scopes: ScopeResolver;
  jobs: JobQueue;
  accounts: AccountStore;
  mailIndex: MailIndex;
  blobs: BlobStore;
  mutate<T>(invocation: AppInvocation, action: string, input: unknown, operation: () => T): T;
  now(): Date;
  close(): void;
}

export function createContext(options: {
  platform: Platform;
  mutate: Ctx['mutate'];
  scopes: (db: Db) => ScopeResolver;
  close: () => void;
  instanceId: string;
  now?: () => Date;
}): Ctx {
  const db = new Db(options.platform);
  const now = options.now ?? (() => new Date());
  const kitDb = db.asSql();
  return {
    db,
    instanceId: options.instanceId,
    settings: createSettings(kitDb),
    scopes: options.scopes(db),
    jobs: createJobQueue(kitDb, { now }),
    accounts: createAccountStore(kitDb),
    mailIndex: createMailIndex(kitDb),
    blobs: createBlobStore(kitDb),
    mutate: options.mutate,
    now,
    close: options.close,
  };
}

export const iso = (ctx: Ctx) => ctx.now().toISOString();
export const newId = () => randomUUID();
export type Scope = AccessScope;
