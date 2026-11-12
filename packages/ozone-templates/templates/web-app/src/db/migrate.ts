import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  ACCEPT_ENV,
  describeStatement,
  formatHeldBack,
  HELD_BACK_EXIT_CODE,
  heldBack,
  type JournalEntry,
  REPORT_FILE,
} from "./migration-guard.ts";

// Applies the SQL migrations in ./drizzle that the database has not seen yet.
// Run with `npm run db:migrate`; safe to run repeatedly and from several
// processes at once. A migration that can lose data is held back until the
// person who owns this app accepts it in Ozone (see migration-guard.ts).

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

/** When the newest migration the database has was made, as drizzle records it. */
async function lastApplied(): Promise<number | null> {
  const [table] = await client`select to_regclass('drizzle.__drizzle_migrations') as name`;
  if (!table?.name) return null;
  const [row] = await client`select max(created_at) as at from drizzle.__drizzle_migrations`;
  return row?.at == null ? null : Number(row.at);
}

try {
  await waitForDatabase();
  await client`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
  const journal: { entries: ReadonlyArray<JournalEntry> } = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  );
  const held = heldBack({
    journal: journal.entries,
    lastApplied: await lastApplied(),
    sqlOf: (tag) => readFileSync(`drizzle/${tag}.sql`, "utf8"),
    accepted: new Set((process.env[ACCEPT_ENV] ?? "").split(/\s+/).filter(Boolean)),
  });
  if (held === null) {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    rmSync(REPORT_FILE, { force: true });
    console.log("Database migrations are up to date.");
  } else {
    mkdirSync(dirname(REPORT_FILE), { recursive: true });
    const report = { statements: held.statements.map(describeStatement), accept: held.accept };
    writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
    console.error(formatHeldBack(held));
    process.exitCode = HELD_BACK_EXIT_CODE;
  }
} finally {
  await client.end();
}
