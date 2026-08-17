import "./load-env";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { buildPoolConfig } from "../src/db/pool-config";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set.\n" +
        "Create a file named .env.local in the project folder (copy .env.example) and put your\n" +
        "database connection string in it, for example:\n" +
        '  DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"',
    );
  }

  const pool = new Pool(buildPoolConfig(connectionString, { max: 1 }));
  const db = drizzle(pool);

  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  await pool.end();
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
