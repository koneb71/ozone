import { setTimeout as sleep } from "node:timers/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Applies the SQL migrations in ./drizzle that the database has not seen yet.
// Run with `npm run db:migrate`; safe to run repeatedly and from several
// processes at once.

const WAIT_FOR_DATABASE_MS = 30_000;
// Any constant works: it only has to be the same for every migration run.
const MIGRATION_LOCK_ID = 7_203_911;

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set.");
}

// One connection, so the advisory lock and the migrations share a session.
const client = postgres(url, { max: 1, onnotice: () => {} });

async function waitForDatabase() {
  const deadline = Date.now() + WAIT_FOR_DATABASE_MS;
  for (;;) {
    try {
      await client`select 1`;
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      console.log("Waiting for the database...");
      await sleep(1_000);
    }
  }
}

try {
  await waitForDatabase();
  await client`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  console.log("Database migrations are up to date.");
} finally {
  await client.end();
}
