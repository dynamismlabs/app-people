import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AppInvocation } from '../../lib/contract.js';
import {
  createBlobStore, createJobQueue, createSettings,
  type AccessScope, type BlobStore, type JobQueue, type Operation, type SqlDatabase,
} from '../../lib/data.js';
import { createAccountStore, createMailIndex, type AccountStore, type MailIndex } from '../../lib/sources.js';

export type Param = string | number | bigint | null | Uint8Array;
export type Row = Record<string, unknown>;

type Statement = BetterSqlite3.Statement;
/**
 * A thin statement cache over the app's SQLite file. In Ri this was node:sqlite;
 * on App Builder it is better-sqlite3, the same SQLite library the kit uses,
 * on People's own connection to the kit's data.sqlite (see src/people/runtime.ts).
 * Booleans become 0/1 and Uint8Arrays become Buffers before binding.
 */
export class Db {
  private readonly cache = new Map<string, Statement>();
  /** When set, read statements are recorded so tests can check their query plans. */
  trace: { sql: string; params: Param[] }[] | null = null;
  constructor(readonly raw: BetterSqlite3.Database) {}
  statement(sql: string): Statement {
    let statement = this.cache.get(sql);
    if (!statement) {
      if (this.cache.size > 1500) this.cache.clear();
      statement = this.raw.prepare(sql);
      this.cache.set(sql, statement);
    }
    return statement;
  }
  all<T = Row>(sql: string, ...params: Param[]): T[] {
    this.trace?.push({ sql, params });
    return this.statement(sql).all(...bind(params)) as T[];
  }
  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    this.trace?.push({ sql, params });
    return this.statement(sql).get(...bind(params)) as T | undefined;
  }
  run(sql: string, ...params: Param[]) {
    return this.statement(sql).run(...bind(params));
  }
  exec(sql: string) {
    this.raw.exec(sql);
  }
  /** The statement interface the stores in src/lib expect (node:sqlite's shape in Ri). */
  asSql(): SqlDatabase {
    const db = this;
    return {
      exec: (sql) => db.raw.exec(sql),
      prepare: (sql) => {
        const statement = db.statement(sql);
        return {
          run: (...params) => statement.run(...bind(params as Param[])),
          get: (...params) => statement.get(...bind(params as Param[])) as Record<string, unknown> | undefined,
          all: (...params) => statement.all(...bind(params as Param[])) as Record<string, unknown>[],
        };
      },
      get isTransaction() { return db.raw.inTransaction; },
    };
  }
  get isTransaction() {
    return this.raw.inTransaction;
  }
  /** Join an open transaction or run one. The work is synchronous: nothing awaits while it holds the write lock. */
  tx<T>(work: () => T): T {
    if (this.raw.inTransaction) return work();
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.raw.inTransaction) this.raw.exec('ROLLBACK');
      throw error;
    }
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
  raw: BetterSqlite3.Database;
  mutate: Ctx['mutate'];
  scopes: (db: Db) => ScopeResolver;
  close: () => void;
  instanceId: string;
  now?: () => Date;
}): Ctx {
  const db = new Db(options.raw);
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
