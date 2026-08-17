import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { buildPoolConfig } from "./pool-config";
import * as schema from "./schema";

/**
 * A single pooled connection is reused across hot reloads in development and
 * across lambda invocations in production. `max` is deliberately small because
 * serverless platforms open one pool per instance.
 */
const globalForDb = globalThis as unknown as { __genzPool?: Pool };

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  /**
   * Serverless tuning.
   *
   * Every function instance gets its own pool, so a large `max` multiplies
   * across instances and exhausts the database's connection limit. One
   * connection per instance is the right default on Vercel; a long-lived
   * server (VPS, docker) can raise it with DB_POOL_MAX.
   *
   * `keepAlive` stops a pooler (Supabase/PgBouncer) from silently dropping an
   * idle connection, and `allowExitOnIdle` lets an idle function shut down
   * cleanly instead of holding the connection open.
   */
  const isServerless = Boolean(process.env.VERCEL);
  const pool = new Pool(
    buildPoolConfig(connectionString, {
      max: Number(process.env.DB_POOL_MAX ?? (isServerless ? 1 : 5)),
      idleTimeoutMillis: isServerless ? 10_000 : 30_000,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      allowExitOnIdle: isServerless,
    }),
  );

  /**
   * Without this listener, a connection dropped while idle (which poolers do
   * routinely) raises an unhandled 'error' event and takes down the whole
   * process — which is what turns a momentary blip into "This screen could not
   * load". The pool discards the dead client and opens a fresh one on the next
   * query.
   */
  pool.on("error", (error) => {
    console.error("[genz] Idle database client error (recovering):", error.message);
  });

  return pool;
}

export const pool = globalForDb.__genzPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__genzPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });

export type Database = typeof db;
/** The type accepted by service functions that may run inside a transaction. */
export type DbClient = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export { schema };
