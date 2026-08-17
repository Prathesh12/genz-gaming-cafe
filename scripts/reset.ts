/**
 * Drops every table and re-applies the migrations. Development only — it
 * refuses to run when NODE_ENV is production, and asks for an explicit
 * --force flag so it can never be triggered by accident.
 *
 *   npm run db:reset -- --force
 */
import "./load-env";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

import { buildPoolConfig } from "../src/db/pool-config";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to reset a production database.");
  }
  if (!process.argv.includes("--force")) {
    console.error("This drops ALL data. Re-run with --force if you are sure:\n  npm run db:reset -- --force");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const pool = new Pool(buildPoolConfig(connectionString, { max: 1 }));
  const db = drizzle(pool);

  console.log("Dropping schema…");
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  /**
   * The migration ledger lives in its own `drizzle` schema, so dropping
   * `public` alone would leave it claiming every migration had already run —
   * and the rebuild below would silently do nothing, leaving an empty database.
   */
  await db.execute(sql`drop schema if exists drizzle cascade`);

  console.log("Re-applying migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });

  await pool.end();
  console.log("Database reset. Run `npm run db:seed` next.");
}

main().catch((error) => {
  console.error("Reset failed:", error);
  process.exit(1);
});
