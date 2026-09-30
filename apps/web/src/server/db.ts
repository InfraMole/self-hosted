// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import type {
  SqlDriverAdapter,
  SqlDriverAdapterFactory,
  SqlQuery,
  Transaction,
} from "@prisma/driver-adapter-utils";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "./env";

export type Db = PrismaClient;

/**
 * Database access with Postgres Row Level Security as a second tenant
 * barrier (M8c, ADR-020). Every tenant query runs under one of three scopes:
 *
 * - `tenantDb(ctx)`   — rows of one workspace (+ the user's account-level rows)
 * - `userDb(userId)`  — the user's own memberships, workspaces and account events
 * - `systemDb(why)`   — cross-tenant jobs (agent auth by secret hash, cron,
 *                       invitation lookup by token…). Grep-able on purpose.
 *
 * `getDb()` has no scope: fine for auth tables (user, session…), but tenant
 * tables return no rows / refuse writes under RLS (fails closed).
 *
 * How the scope reaches Postgres: every operation of a scoped client runs in
 * its **own interactive transaction**; the adapter applies the scope with
 * `set_config(…, true)` (transaction-local) right after BEGIN. One transaction
 * per scope matters: Prisma batches concurrent `findUnique` calls into one
 * query *within the same transaction only*, so queries of different tenants
 * can never share a statement (tested in rls.test.ts).
 *
 * RLS is enforced when the app connects as the `depmap_app` role (production,
 * integration tests, local dev with the default .env).
 */
export interface DbScope {
  workspaceId?: string;
  userId?: string;
  bypass?: boolean;
}

// Shared through globalThis like the client itself: Next.js may load this
// module more than once (route handlers, server components…), and the
// adapter must read the same store the scoped client writes to.
const globalForScope = globalThis as unknown as { __depmapDbScope?: AsyncLocalStorage<DbScope> };
const scopeStore = (globalForScope.__depmapDbScope ??= new AsyncLocalStorage<DbScope>());
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const NO_ARGS = { args: [], argTypes: [] };

function scopeSql(scope: DbScope): string {
  for (const v of [scope.workspaceId, scope.userId])
    if (v !== undefined && !SAFE_ID.test(v)) throw new Error("Invalid database scope id");
  // Values are validated above (no quotes possible), so literals are safe.
  return (
    `SELECT set_config('app.workspace_id', '${scope.workspaceId ?? ""}', true), ` +
    `set_config('app.user_id', '${scope.userId ?? ""}', true), ` +
    `set_config('app.bypass_rls', '${scope.bypass ? "on" : "off"}', true)`
  );
}

/**
 * A transaction owns one pg connection, but Prisma may load relations of one
 * query in parallel (e.g. `from`, `to` and `evidence` of a relationship).
 * pg only queues concurrent queries on a client as deprecated behaviour (an
 * error from pg@9), so run them one after another explicitly.
 */
function serialized(tx: Transaction): Transaction {
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  return Object.assign(Object.create(tx), {
    queryRaw: (q: SqlQuery) => run(() => tx.queryRaw(q)),
    executeRaw: (q: SqlQuery) => run(() => tx.executeRaw(q)),
    commit: () => run(() => tx.commit()),
    rollback: () => run(() => tx.rollback()),
  }) as Transaction;
}

/** Applies the scope active when the transaction starts, right after BEGIN. */
function scopedAdapter(inner: SqlDriverAdapter): SqlDriverAdapter {
  return Object.assign(Object.create(inner), {
    startTransaction: async (
      isolationLevel?: Parameters<SqlDriverAdapter["startTransaction"]>[0],
    ) => {
      const scope = scopeStore.getStore();
      const tx: Transaction = serialized(await inner.startTransaction(isolationLevel));
      if (scope) {
        try {
          await tx.executeRaw({ sql: scopeSql(scope), ...NO_ARGS } satisfies SqlQuery);
        } catch (error) {
          await tx.executeRaw({ sql: "ROLLBACK", ...NO_ARGS }).catch(() => {});
          await tx.rollback();
          throw error;
        }
      }
      return tx;
    },
  }) as SqlDriverAdapter;
}

function scopedFactory(inner: SqlDriverAdapterFactory): SqlDriverAdapterFactory {
  return Object.assign(Object.create(inner), {
    connect: async () => scopedAdapter(await inner.connect()),
  }) as SqlDriverAdapterFactory;
}

const globalForDb = globalThis as unknown as { __depmapDb?: PrismaClient };

/** Unscoped client (auth tables, health check). Tenant tables are denied under RLS. */
export function getDb(): PrismaClient {
  if (!globalForDb.__depmapDb) {
    const adapter = scopedFactory(new PrismaPg({ connectionString: getEnv().DATABASE_URL }));
    globalForDb.__depmapDb = new PrismaClient({ adapter });
  }
  return globalForDb.__depmapDb;
}

type AnyFn = (...args: unknown[]) => unknown;
const RAW = new Set(["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"]);

/**
 * A client whose every operation runs in its own transaction under `scope`.
 * `$transaction(fn)` runs `fn` in one scoped transaction; batch (array)
 * transactions are refused because their items would be built unscoped.
 */
function scoped(scope: DbScope): PrismaClient {
  scopeSql(scope); // validate ids eagerly
  const base = getDb();
  const inTx = <T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> =>
    scopeStore.run(scope, () => base.$transaction((tx) => fn(tx as unknown as PrismaClient)));

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "$transaction")
        return (arg: unknown, options?: Parameters<PrismaClient["$transaction"]>[1]) => {
          if (typeof arg !== "function")
            throw new Error("Batch $transaction([...]) is not supported on scoped clients");
          return scopeStore.run(scope, () =>
            base.$transaction(arg as Parameters<PrismaClient["$transaction"]>[0], options),
          );
        };
      if (typeof prop === "string" && RAW.has(prop))
        return (...args: unknown[]) =>
          inTx(
            (tx) => (tx as unknown as Record<string, AnyFn>)[prop]!(...args) as Promise<unknown>,
          );
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || prop.startsWith("$") || prop.startsWith("_")) return value;
      if (!value || typeof value !== "object") return value;
      // A model delegate: run each call in a scoped transaction.
      return new Proxy(value as object, {
        get(delegate, method) {
          const fn = Reflect.get(delegate, method);
          if (typeof fn !== "function" || typeof method !== "string") return fn;
          return (...args: unknown[]) =>
            inTx(
              (tx) =>
                (tx as unknown as Record<string, Record<string, AnyFn>>)[prop]![method]!(
                  ...args,
                ) as Promise<unknown>,
            );
        },
      });
    },
  }) as PrismaClient;
}

/** Tenant scope: the workspace's rows (+ the acting user's account-level rows). */
export function tenantDb(ctx: { workspaceId: string; userId?: string | null }): PrismaClient {
  return scoped({ workspaceId: ctx.workspaceId, userId: ctx.userId ?? undefined });
}

/** User scope: own memberships, the workspaces they belong to, own account events. */
export function userDb(userId: string): PrismaClient {
  return scoped({ userId });
}

/**
 * Bypasses RLS. Only for cross-tenant operations that cannot know the
 * workspace beforehand; `reason` documents each call site.
 */
export function systemDb(reason: string): PrismaClient {
  void reason;
  return scoped({ bypass: true });
}
