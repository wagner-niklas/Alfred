import { tool } from "ai";
import { z } from "zod";
import { executeDatabricksSQL } from "@/lib/tools/utils_tools";

// Environment configuration
const DATABRICKS_CATALOG = process.env.DATABRICKS_CATALOG;

// Error messages for SQL validation
const ERROR_MULTIPLE_STATEMENTS = "Only a single SELECT statement without additional statements is allowed.";
const ERROR_NOT_SELECT_ONLY = "Only SELECT queries are allowed. Write operations (INSERT, UPDATE, DELETE, MERGE, etc.) are forbidden.";
const ERROR_WRITE_DDL_OPERATIONS = "Write or DDL operations (INSERT, UPDATE, DELETE, MERGE, CREATE, DROP, etc.) are not allowed.";

// Regex patterns for SQL validation
const FORBIDDEN_KEYWORD_PATTERNS = [
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

const SELECT_PATTERN = /^\s*select\b/i;
const CTE_PATTERN = /^\s*with\b/i;
const CTE_DEFINITION_PATTERN = /(\w+)\s+as\s*\(/gi;
const TABLE_QUALIFICATION_PATTERN = /\b(from|join)\s+([`"]?)([a-z0-9_]+)\2\b/gi;

/**
 * Validates that a SQL query is a single read-only SELECT statement.
 * 
 * @param sql - The raw SQL query to validate
 * @returns The validated SQL statement
 * @throws Error if the query contains forbidden operations
 */
const validateSelectQuery = (sql: string): string => {
  const trimmed = sql.trim();

  // Split by semicolons and filter empty statements
  const statements = trimmed.split(";").filter((statement) => statement.trim().length > 0);
  
  if (statements.length > 1) {
    throw new Error(ERROR_MULTIPLE_STATEMENTS);
  }

  const statement = statements[0];

  // Check if it's a SELECT or CTE query
  const isSelectQuery = SELECT_PATTERN.test(statement) || CTE_PATTERN.test(statement);

  if (!isSelectQuery) {
    throw new Error(ERROR_NOT_SELECT_ONLY);
  }

  // Check for forbidden write/DDL keywords
  const containsForbiddenKeyword = FORBIDDEN_KEYWORD_PATTERNS.some((pattern) => pattern.test(statement));
  
  if (containsForbiddenKeyword) {
    throw new Error(ERROR_WRITE_DDL_OPERATIONS);
  }

  return statement;
};

/**
 * Qualifies unqualified table names with the Databricks catalog prefix.
 * 
 * @param sql - The SQL query to process
 * @returns The SQL query with qualified table names
 */
const qualifyTableNames = (sql: string): string => {
  // Extract CTE names to avoid qualifying them
  const cteMatch = sql.match(CTE_PATTERN);
  let cteNames: string[] = [];
  if (cteMatch) {
    const cteBlock = cteMatch[1] ?? "";
    cteNames = Array.from(cteBlock.matchAll(CTE_DEFINITION_PATTERN)).map((match) => (match[1] ?? "").toLowerCase());
  }

  return sql.replace(
    TABLE_QUALIFICATION_PATTERN,
    (match, keyword, _quote, table) => {
      // Skip if table is already qualified or is a CTE
      if (table.includes(".") || cteNames.includes(table.toLowerCase())) {
        return match;
      }
      return `${keyword} \`${DATABRICKS_CATALOG}\`.${table}`;
    }
  );
};

/**
 * Creates a tool for executing read-only SQL queries on Databricks.
 */
export const db_query = () =>
  tool({
    description: "Run a read-only SQL query on the database and returns the results. No queries to the information schema are allowed. Do not use ` or ; only use the tables and columns as they are named in the database.",
    inputSchema: z.object({
      sql_query: z.string().describe("The SQL query statement, e.g. SELECT * FROM 01_bronce.order_details LIMIT 5."),
      description: z.string().describe(
        "Very short description steps used to construct the SQL query (e.g., filters, grouping, sorting)."
      ),
    }),
    execute: async ({ sql_query }) => {
      const validatedSql = qualifyTableNames(validateSelectQuery(sql_query));
      const result = await executeDatabricksSQL(validatedSql);
      return { result };
    },
  });
