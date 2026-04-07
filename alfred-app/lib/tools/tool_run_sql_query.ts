import { tool } from "ai";
import { z } from "zod";
import { executeDatabricksSQL } from "@/lib/tools/utils_tools";

const DATABRICKS_CATALOG = process.env.DATABRICKS_CATALOG;
const DATABRICKS_SCHEMA = process.env.DATABRICKS_SCHEMA;

const ensureSelectQuery = (sql: string) => {
  const trimmed = sql.trim();

  const statements = trimmed.split(";").filter((s) => s.trim().length > 0);
  if (statements.length > 1) {
    throw new Error("Only a single SELECT statement without additional statements is allowed.");  
  }

  const statement = statements[0];

  const isSelectLike =
    /^\s*select\b/i.test(statement) || // direct SELECT
    /^\s*with\b/i.test(statement);     // CTE: WITH ... SELECT ...

  if (!isSelectLike) {
    throw new Error(
      "Only SELECT queries are allowed. Write operations (INSERT, UPDATE, DELETE, MERGE, etc.) are forbidden."
    );
  }

  // Absicherung gegen Schreib-/DDL-Keywords
  const forbiddenKeywords = [
    /\binsert\b/i,
    /\bupdate\b/i,
    /\bdelete\b/i,
    /\bmerge\b/i,
    /\bdrop\b/i,
    /\btruncate\b/i,
    /\bcreate\b/i,
    /\balter\b/i,
    /\bgrant\b/i,
    /\brevoke\b/i,
  ];

  if (forbiddenKeywords.some((re) => re.test(statement))) {
    throw new Error(
      "Write or DDL operations (INSERT, UPDATE, DELETE, MERGE, CREATE, DROP, etc.) are not allowed."
    );
  }

  return statement;
};

const qualifyTables = (sql: string) => {
  const cteMatch = sql.match(/^\s*with\s+([\s\S]+?)\)\s*select\b/i);
  let ctes: string[] = [];
  if (cteMatch) {
    const cteBlock = cteMatch[1];
    ctes = Array.from(cteBlock.matchAll(/(\w+)\s+as\s*\(/gi)).map(m => m[1].toLowerCase());
  }

  return sql.replace(
    /\b(from|join)\s+([`"]?)([a-z0-9_]+)\2\b/gi,
    (match, keyword, quote, table) => {
      if (table.includes(".") || ctes.includes(table.toLowerCase())) return match;
      return `${keyword} \`${DATABRICKS_CATALOG}\`.\`${DATABRICKS_SCHEMA}\`.${table}`;
    }
  );
};

export const run_sql_query = () =>
  tool({
    description: "Run a read-only SQL query on the database and returns the results.",
    inputSchema: z.object({
      sql_query: z.string().describe("The SQL query statement."),
      description: z.string().describe(
          "Very short description steps used to construct the SQL query (e.g., filters, grouping, sorting)."
        ),
    }),
    execute: async ({ sql_query }) => {
      const sql = qualifyTables(ensureSelectQuery(sql_query));
      const result = await executeDatabricksSQL(sql);
      return { result };
    },
  });