import { assert, describe, it } from "@effect/vitest";

import { findDestructiveStatements } from "./migrationGuard.ts";

const effectsOf = (sql: string) =>
  findDestructiveStatements("drizzle/0002_change.sql", sql).map((found) => found.effect);

describe("findDestructiveStatements", () => {
  it.each([
    ['DROP TABLE "habits";', ["drops a table"]],
    ["drop table if exists habits cascade", ["drops a table"]],
    ['ALTER TABLE "habits" DROP COLUMN "notes";', ["drops a column"]],
    ['ALTER TABLE "habits" DROP "notes";', ["drops a column"]],
    ["DROP SCHEMA public CASCADE;", ["drops a schema"]],
    ['TRUNCATE "habits";', ["empties a table"]],
    ['DELETE FROM "habits";', ["deletes every row of a table"]],
    [
      'ALTER TABLE "habits" ALTER COLUMN "name" SET DATA TYPE varchar(10);',
      ["changes a column's type, which can cut values short"],
    ],
    [
      'ALTER TABLE "habits" ALTER "streak" TYPE smallint;',
      ["changes a column's type, which can cut values short"],
    ],
  ])("flags %j", (sql, effects) => {
    assert.deepStrictEqual(effectsOf(sql), effects);
  });

  it.each([
    'CREATE TABLE "habits" ("id" text PRIMARY KEY NOT NULL);',
    'ALTER TABLE "habits" ADD COLUMN "notes" text;',
    'ALTER TABLE "habits" DROP CONSTRAINT "habits_user_id_user_id_fk";',
    'ALTER TABLE "habits" ALTER COLUMN "notes" DROP NOT NULL;',
    'ALTER TABLE "habits" ALTER COLUMN "notes" DROP DEFAULT;',
    'ALTER TABLE "habits" RENAME COLUMN "notes" TO "note";',
    'DROP INDEX "habits_user_idx";',
    'DELETE FROM "habits" WHERE "archived_at" < now() - interval \'1 year\';',
    '-- DROP TABLE habits;\n/* TRUNCATE habits; */\nCREATE INDEX "habits_user_idx" ON "habits" ("user_id");',
  ])("lets %j through", (sql) => {
    assert.deepStrictEqual(effectsOf(sql), []);
  });

  it("names the file and line of each statement in a Drizzle migration", () => {
    const sql = [
      'CREATE TABLE "streaks" (',
      '\t"id" text PRIMARY KEY NOT NULL',
      ");",
      "--> statement-breakpoint",
      "-- keep the old table until the copy is checked",
      'ALTER TABLE "habits"',
      '\tDROP COLUMN "streak";--> statement-breakpoint',
      'DROP TABLE "legacy_habits";',
    ].join("\n");
    assert.deepStrictEqual(findDestructiveStatements("drizzle/0003_streaks.sql", sql), [
      {
        file: "drizzle/0003_streaks.sql",
        line: 6,
        effect: "drops a column",
        statement: 'ALTER TABLE "habits" DROP COLUMN "streak"',
      },
      {
        file: "drizzle/0003_streaks.sql",
        line: 8,
        effect: "drops a table",
        statement: 'DROP TABLE "legacy_habits"',
      },
    ]);
  });
});
