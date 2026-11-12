import { createHash } from "node:crypto";

// Ozone checks every migration before it runs. One that can lose data waits until the person who
// owns this app accepts it in Ozone, which takes a snapshot of the data first. These rules are a
// copy of Ozone's own. Never edit this file or migrate.ts to get a migration past them.

export interface DestructiveStatement {
  readonly file: string;
  readonly line: number;
  /** What the statement does to data, in words for the person who decides. */
  readonly effect: string;
  readonly statement: string;
}

export const DESTRUCTIVE_RULES: ReadonlyArray<{
  readonly effect: string;
  readonly pattern: RegExp;
}> = [
  { effect: "drops a table", pattern: /^DROP\s+TABLE\b/i },
  { effect: "drops a schema", pattern: /^DROP\s+SCHEMA\b/i },
  { effect: "drops a database", pattern: /^DROP\s+DATABASE\b/i },
  {
    effect: "drops a column",
    pattern:
      /^ALTER\s+TABLE\b[\s\S]*\bDROP\s+(?:COLUMN\b|(?!CONSTRAINT\b|DEFAULT\b|NOT\b|IDENTITY\b|EXPRESSION\b)"?\w)/i,
  },
  { effect: "empties a table", pattern: /^TRUNCATE\b/i },
  { effect: "deletes every row of a table", pattern: /^DELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/i },
  {
    effect: "changes a column's type, which can cut values short",
    pattern: /^ALTER\s+TABLE\b[\s\S]*\bALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
  },
];

/** Where the migrate command tells Ozone what it held back. */
export const REPORT_FILE = ".ozone/migrations.json";
/** Names the migrations a person accepted, for one run of the migrate command. */
export const ACCEPT_ENV = "OZONE_ACCEPT_MIGRATIONS";
export const HELD_BACK_EXIT_CODE = 3;

const withoutComments = (sql: string) =>
  // Replaced by spaces of the same length, so every statement keeps its line number.
  sql
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/--(?!>)[^\n]*/g, (comment) => " ".repeat(comment.length));

/** The statements in a migration that can lose data. */
export const findDestructiveStatements = (
  file: string,
  sql: string,
): ReadonlyArray<DestructiveStatement> => {
  const found: Array<DestructiveStatement> = [];
  const text = withoutComments(sql);
  // Drizzle separates statements with a marker; hand-written SQL uses semicolons.
  const separator = /;|-->\s*statement-breakpoint/g;
  let start = 0;
  for (;;) {
    const match = separator.exec(text);
    const end = match === null ? text.length : match.index;
    const raw = text.slice(start, end);
    const statement = raw.trim();
    if (statement.length > 0) {
      const rule = DESTRUCTIVE_RULES.find((entry) => entry.pattern.test(statement));
      if (rule !== undefined) {
        const offset = start + raw.indexOf(statement);
        found.push({
          file,
          line: text.slice(0, offset).split("\n").length,
          effect: rule.effect,
          statement: statement.replace(/\s+/g, " ").slice(0, 200),
        });
      }
    }
    if (match === null) return found;
    start = match.index + match[0].length;
  }
};

/** An entry of drizzle-kit's journal: when the migration was made, and its file's name. */
export interface JournalEntry {
  readonly when: number;
  readonly tag: string;
}

export interface HeldBack {
  readonly statements: ReadonlyArray<DestructiveStatement>;
  /** What accepting them means: one `<file>@<sha256 of its SQL>` per migration held back. */
  readonly accept: ReadonlyArray<string>;
}

/** Names exactly the SQL a person saw, so a migration changed afterwards is held back again. */
export const acceptToken = (file: string, sql: string) =>
  `${file}@${createHash("sha256").update(sql).digest("hex")}`;

/**
 * The migrations drizzle would apply next that can lose data and were not accepted. Drizzle applies
 * every journal entry newer than the newest migration the database has, in one transaction.
 */
export const heldBack = (input: {
  readonly journal: ReadonlyArray<JournalEntry>;
  readonly lastApplied: number | null;
  readonly sqlOf: (tag: string) => string;
  readonly accepted: ReadonlySet<string>;
}): HeldBack | null => {
  const statements: Array<DestructiveStatement> = [];
  const accept: Array<string> = [];
  for (const entry of input.journal) {
    if (input.lastApplied !== null && entry.when <= input.lastApplied) continue;
    const file = `${entry.tag}.sql`;
    const sql = input.sqlOf(entry.tag);
    const token = acceptToken(file, sql);
    const found = findDestructiveStatements(file, sql);
    if (found.length === 0 || input.accepted.has(token)) continue;
    statements.push(...found);
    accept.push(token);
  }
  return statements.length === 0 ? null : { statements, accept };
};

export const describeStatement = (found: DestructiveStatement) =>
  `${found.file}:${found.line} ${found.effect}: ${found.statement}`;

/** What the migrate command prints when it holds a migration back. Ozone reads the last lines. */
export const formatHeldBack = (held: HeldBack): string =>
  [
    "Ozone held back a migration that can lose data. Nothing in it was applied: the person who owns this app decides in Ozone whether it runs. Say what it does and that it waits for them.",
    ...held.statements.map(describeStatement),
    ...held.accept.map((token) => `ozone-accept ${token}`),
  ].join("\n");
