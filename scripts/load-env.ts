import { config } from "dotenv";

/**
 * Load environment variables for the standalone scripts (migrate / seed / reset)
 * and for drizzle-kit.
 *
 * Next.js reads `.env.local` automatically, but plain Node scripts do not — so
 * without this the app would connect happily while `npm run db:migrate` failed
 * with "DATABASE_URL is not set". We read the same files, in the same order of
 * precedence Next.js uses. `dotenv` never overwrites a variable that is already
 * set, so the first file to define a value wins, and real environment variables
 * (CI, Vercel, `DATABASE_URL=… npm run db:migrate`) always win over both.
 */
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
