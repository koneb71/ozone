// @effect-diagnostics nodeBuiltinImport:off - Apps hash with node:crypto too; tokens must match.
import * as NodeCrypto from "node:crypto";

import * as Schema from "effect/Schema";

export interface DestructiveStatement {
  readonly file: string;
  readonly line: number;
  /** What the statement does to data, in words for the person who must decide. */
  readonly effect: string;
  readonly statement: string;
}

/** Each app's `src/db/migration-guard.ts` holds a copy; a test keeps the two the same. */
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

const withoutComments = (sql: string) =>
  // Replaced by spaces of the same length, so every statement keeps its line number.
  sql
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/--(?!>)[^\n]*/g, (comment) => " ".repeat(comment.length));

/**
 * The statements in a migration that can lose data. Ozone never applies one of these silently:
 * the build stops and a person decides.
 */
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

export const describeStatement = (found: DestructiveStatement) =>
  `${found.file}:${found.line} ${found.effect}: ${found.statement}`;

/** Where an app's migrate command says what it held back, from the app's root. */
export const MIGRATION_REPORT_FILE = ".ozone/migrations.json";
/** Names the migrations a person accepted, for one run of an app's migrate command. */
export const ACCEPT_MIGRATIONS_ENV = "OZONE_ACCEPT_MIGRATIONS";

/** What a held-back migration needs: the statements to show, and the tokens that accept them. */
export const MigrationReport = Schema.Struct({
  statements: Schema.Array(Schema.String),
  accept: Schema.Array(Schema.String),
});
export type MigrationReport = typeof MigrationReport.Type;
const MigrationReportJson = Schema.fromJsonString(MigrationReport);
export const decodeMigrationReport = Schema.decodeUnknownEffect(MigrationReportJson);
export const encodeMigrationReport = Schema.encodeEffect(MigrationReportJson);

/** Names exactly the SQL a person saw. An app's migrate command computes the same token. */
export const acceptToken = (file: string, sql: string) =>
  `${file}@${NodeCrypto.createHash("sha256").update(sql).digest("hex")}`;

const ACCEPT_LINE = "ozone-accept ";

/** The report a migrate command printed when it held migrations back, or null if it did not. */
export const parseHeldBack = (output: string): MigrationReport | null => {
  const lines = output.split("\n").map((line) => line.trim());
  const accept = lines.flatMap((line) =>
    line.startsWith(ACCEPT_LINE) ? [line.slice(ACCEPT_LINE.length).trim()] : [],
  );
  if (accept.length === 0) return null;
  return { statements: lines.filter((line) => /^\S+\.sql:\d+ /.test(line)), accept };
};

/** The evidence a held-back migration leaves, which a person's acceptance reads back. */
export const formatHeldBack = (report: MigrationReport) =>
  [...report.statements, ...report.accept.map((token) => `${ACCEPT_LINE}${token}`)].join("\n");
