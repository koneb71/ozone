import { assert, describe, it } from "@effect/vitest";

import * as ServerGuard from "./migrationGuard.ts";

/** What an app's own copy of the rules exports, in `src/db/migration-guard.ts`. */
interface AppGuard {
  readonly DESTRUCTIVE_RULES: typeof ServerGuard.DESTRUCTIVE_RULES;
  readonly findDestructiveStatements: typeof ServerGuard.findDestructiveStatements;
  readonly acceptToken: typeof ServerGuard.acceptToken;
  readonly heldBack: (input: {
    readonly journal: ReadonlyArray<{ readonly when: number; readonly tag: string }>;
    readonly lastApplied: number | null;
    readonly sqlOf: (tag: string) => string;
    readonly accepted: ReadonlySet<string>;
  }) => {
    readonly statements: ReadonlyArray<unknown>;
    readonly accept: ReadonlyArray<string>;
  } | null;
  readonly formatHeldBack: (held: NonNullable<ReturnType<AppGuard["heldBack"]>>) => string;
}

// Loaded by URL: the copies are each app's own code, typechecked by its tools, not the server's.
const appGuard = (templateId: string): Promise<AppGuard> =>
  import(
    /* @vite-ignore */ new URL(
      `../../../../../packages/ozone-templates/templates/${templateId}/src/db/migration-guard.ts`,
      import.meta.url,
    ).href
  );
const APP_GUARDS = Object.entries({
  "web-app": await appGuard("web-app"),
  "api-service": await appGuard("api-service"),
});

/** The server decides in a build; each app's migrate command decides everywhere else. */
const IMPLEMENTATIONS: ReadonlyArray<
  readonly [string, Pick<AppGuard, "findDestructiveStatements">]
> = [["server", ServerGuard], ...APP_GUARDS];

describe.each(IMPLEMENTATIONS)("findDestructiveStatements in the %s copy", (_name, guard) => {
  const effectsOf = (sql: string) =>
    guard.findDestructiveStatements("drizzle/0002_change.sql", sql).map((found) => found.effect);

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
    assert.deepStrictEqual(guard.findDestructiveStatements("drizzle/0003_streaks.sql", sql), [
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

describe.each(APP_GUARDS)("the migrate command of the %s template", (_name, guard) => {
  it("keeps the server's rules", () => {
    const shape = (rules: typeof ServerGuard.DESTRUCTIVE_RULES) =>
      rules.map((rule) => [rule.effect, rule.pattern.source, rule.pattern.flags]);
    assert.deepStrictEqual(shape(guard.DESTRUCTIVE_RULES), shape(ServerGuard.DESTRUCTIVE_RULES));
  });

  it("holds back only pending migrations that can lose data and were not accepted", () => {
    const sql: Record<string, string> = {
      "0000_init": 'CREATE TABLE "notes" ("id" text);',
      "0001_drop": 'DROP TABLE "notes";',
      "0002_add": 'ALTER TABLE "users" ADD COLUMN "bio" text;',
    };
    const journal = [
      { when: 100, tag: "0000_init" },
      { when: 200, tag: "0001_drop" },
      { when: 300, tag: "0002_add" },
    ];
    const run = (lastApplied: number | null, accepted: ReadonlyArray<string> = []) =>
      guard.heldBack({
        journal,
        lastApplied,
        sqlOf: (tag) => sql[tag] ?? "",
        accepted: new Set(accepted),
      });

    const token = ServerGuard.acceptToken("0001_drop.sql", sql["0001_drop"] ?? "");
    const held = run(100);
    assert.deepStrictEqual(held?.accept, [token]);
    // What the command prints is what the server reads back.
    assert.deepStrictEqual(
      ServerGuard.parseHeldBack(guard.formatHeldBack(held ?? { statements: [], accept: [] })),
      {
        statements: ['0001_drop.sql:1 drops a table: DROP TABLE "notes"'],
        accept: [token],
      },
    );
    // Accepted by the token for exactly this SQL; a migration already applied is not pending.
    assert.isNull(run(100, [token]));
    assert.isNull(run(200));
    assert.isNotNull(run(100, [ServerGuard.acceptToken("0001_drop.sql", "DROP TABLE other;")]));
  });
});
