export interface DestructiveStatement {
  readonly file: string;
  readonly line: number;
  /** What the statement does to data, in words for the person who must decide. */
  readonly effect: string;
  readonly statement: string;
}

const RULES: ReadonlyArray<{ readonly effect: string; readonly pattern: RegExp }> = [
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
      const rule = RULES.find((entry) => entry.pattern.test(statement));
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
