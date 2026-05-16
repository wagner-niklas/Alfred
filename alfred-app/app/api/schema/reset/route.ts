import { NextResponse } from "next/server";
import { getSession } from "@/lib/tools/tool_search_database_schema";

// Environment configuration
const DATABRICKS_HOST = process.env.DATABRICKS_HOST;
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN;
const DATABRICKS_WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID;
const DATABRICKS_CATALOG = process.env.DATABRICKS_CATALOG;
const DATABRICKS_SCHEMA = process.env.DATABRICKS_SCHEMA;

// API endpoints
const DATABRICKS_STATEMENTS_API = "/api/2.0/sql/statements";

// Statement states
const STATEMENT_STATE = {
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELED: "CANCELED",
} as const;

// Configuration constants
const STATEMENT_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 60000;

// Error messages
const ERROR_FETCH_STATEMENT = "Failed fetching statement result:";
const ERROR_STATEMENT_FAILED = "Databricks statement";
const ERROR_STATEMENT_TIMEOUT = "Databricks statement timeout exceeded";
const ERROR_MISSING_STATEMENT_ID = "Missing statement_id in Databricks response";
const ERROR_UNEXPECTED_RESULT_FORMAT = "Unexpected Databricks result format:";
const ERROR_MISSING_ENV_VARS = "Missing required Databricks environment variables";

/**
 * Fetches the result of a Databricks statement execution.
 */
async function fetchStatementResult(statementId: string): Promise<unknown> {
  const response = await fetch(
    `https://${DATABRICKS_HOST}${DATABRICKS_STATEMENTS_API}/${statementId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${DATABRICKS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${ERROR_FETCH_STATEMENT} ${errorText}`);
  }

  return response.json();
}

/**
 * Polls until a Databricks statement completes or times out.
 */
async function waitForStatement(
  statementId: string, 
  timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS
): Promise<unknown> {
  const startTime = Date.now();

  while (true) {
    const result = await fetchStatementResult(statementId);
    const status = (result as { status?: { state?: string } })?.status;
    const state = status?.state;

    if (state === STATEMENT_STATE.SUCCEEDED) {
      return result;
    }

    if (state === STATEMENT_STATE.FAILED || state === STATEMENT_STATE.CANCELED) {
      throw new Error(
        `${ERROR_STATEMENT_FAILED} ${state}: ${JSON.stringify(status)}`
      );
    }

    if (Date.now() - startTime > timeoutMs) {
      throw new Error(ERROR_STATEMENT_TIMEOUT);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Validates that all required Databricks environment variables are configured.
 */
function validateDatabricksConfig(): boolean {
  return !!(
    DATABRICKS_HOST &&
    DATABRICKS_TOKEN &&
    DATABRICKS_WAREHOUSE_ID &&
    DATABRICKS_CATALOG &&
    DATABRICKS_SCHEMA
  );
}

/**
 * Parses selected tables from the request body.
 */
function parseSelectedTables(requestBody: unknown): string[] {
  const body = requestBody as Record<string, unknown>;
  if (!Array.isArray(body?.tables)) {
    return [];
  }
  return body.tables.filter((item: unknown): item is string => typeof item === "string");
}

/**
 * Builds the SQL query for fetching schema information from Databricks.
 */
function buildSchemaQuery(catalog: string, selectedTables: string[], defaultSchema: string): string {
  let tableFilterClause = "";
  let schemaFilterClause = "";
  
  if (selectedTables.length > 0) {
    const schemas = new Set(selectedTables.map((table) => table.split('.')[0]));
    schemaFilterClause = `AND t.table_schema IN (${Array.from(schemas).map((s) => `'${s}'`).join(", ")})`;
    tableFilterClause = `AND CONCAT(t.table_schema, '.', t.table_name) IN (${selectedTables.map((t) => `'${t}'`).join(", ")})`;
  } else {
    schemaFilterClause = `AND t.table_schema = '${defaultSchema}'`;
  }

  return `
    SELECT
      t.table_schema,
      t.table_name,
      t.comment AS table_description,
      c.column_name,
      c.comment AS column_description,
      c.data_type,
      c.ordinal_position
    FROM system.information_schema.tables t
    JOIN system.information_schema.columns c
      ON t.table_catalog = c.table_catalog
      AND t.table_schema = c.table_schema
      AND t.table_name = c.table_name
    WHERE t.table_catalog = '${catalog}'
      ${schemaFilterClause}
      ${tableFilterClause}
      AND t.table_type = 'MANAGED'
    ORDER BY t.table_name, c.ordinal_position
  `;
}

/**
 * Transforms raw schema data rows into structured objects.
 */
function transformSchemaData(dataArray: unknown[], columns: Array<{ name: string }>): Record<string, unknown>[] {
  return (dataArray as unknown[][]).map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, index) => {
      obj[col.name] = row[index];
    });
    return obj;
  });
}

/**
 * Groups schema rows by table name.
 */
function groupSchemaByTable(
  schemaData: Record<string, unknown>[]
): Map<string, { 
  schema: string; 
  description: string | null; 
  columns: Array<{ name: string; description: string | null; data_type: string | null }> 
}> {
  const tablesMap = new Map<string, { 
    schema: string; 
    description: string | null; 
    columns: Array<{ name: string; description: string | null; data_type: string | null }> 
  }>();

  for (const row of schemaData) {
    const key = `${row.table_schema}.${row.table_name}` as string;

    if (!tablesMap.has(key)) {
      tablesMap.set(key, {
        schema: row.table_schema as string,
        description: row.table_description as string | null,
        columns: [],
      });
    }

    tablesMap.get(key)!.columns.push({
      name: row.column_name as string,
      description: row.column_description as string | null,
      data_type: row.data_type as string | null,
    });
  }

  return tablesMap;
}

/**
 * Creates or updates table and column nodes in the Neo4j graph database.
 */
async function persistSchemaToGraph(
  session: any,
  tablesMap: Map<string, { 
    schema: string; 
    description: string | null; 
    columns: Array<{ name: string; description: string | null; data_type: string | null }> 
  }>
): Promise<{ tablesCreated: number; columnsCreated: number }> {
  let tablesCreated = 0;
  let columnsCreated = 0;

  for (const [tableName, tableData] of tablesMap) {
    await session.run(
      `
      MERGE (t:Table {name: $tableName, schema: $schema})
      SET t.description = $description
      `,
      {
        tableName,
        schema: tableData.schema,
        description: tableData.description ?? null,
      }
    );

    tablesCreated++;

    for (const column of tableData.columns) {
      const columnId = `${tableName}.${column.name}`;

      await session.run(
        `
        MERGE (c:Column {name: $columnId})
        SET c.description = $description,
            c.data_type = $dataType
        `,
        {
          columnId,
          description: column.description ?? null,
          dataType: column.data_type,
        }
      );

      columnsCreated++;

      await session.run(
        `
        MATCH (t:Table {name: $tableName})
        MATCH (c:Column {name: $columnId})
        MERGE (t)-[:HAS_COLUMN]->(c)
        `,
        { tableName, columnId }
      );
    }
  }

  return { tablesCreated, columnsCreated };
}

/**
 * POST handler for resetting the knowledge graph database.
 * 
 * Deletes all existing Table, Column, and Concept nodes, then recreates
 * them from the Databricks schema based on user-selected tables.
 */
export async function POST(request: Request) {
  if (!validateDatabricksConfig()) {
    return NextResponse.json(
      { error: ERROR_MISSING_ENV_VARS },
      { status: 500 }
    );
  }

  // Parse selected tables from request body
  const selectedTables = parseSelectedTables(await request.json().catch(() => ({})));

  const session = getSession();

  try {
    // Delete all existing graph nodes
    await session.run(`
      MATCH (n)
      WHERE n:Table OR n:Column OR n:Concept
      DETACH DELETE n
    `);

    console.log("Resetting with tables:", selectedTables);

    // Execute Databricks query to fetch schema information
    const schemaQuery = buildSchemaQuery(DATABRICKS_CATALOG!, selectedTables, DATABRICKS_SCHEMA!);
    
    const databricksResponse = await fetch(
      `https://${DATABRICKS_HOST}${DATABRICKS_STATEMENTS_API}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DATABRICKS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          statement: schemaQuery,
          warehouse_id: DATABRICKS_WAREHOUSE_ID,
          wait_timeout_ms: STATEMENT_TIMEOUT_MS,
        }),
      }
    );

    if (!databricksResponse.ok) {
      throw new Error(await databricksResponse.text());
    }

    const initialResponse = await databricksResponse.json();
    const statementId = initialResponse.statement_id;
    
    if (!statementId) {
      throw new Error(ERROR_MISSING_STATEMENT_ID);
    }

    // Wait for statement to complete
    const resultResponse = await waitForStatement(statementId);

    // Extract result data from response
    let manifest = (resultResponse as { manifest?: unknown; result?: { manifest?: unknown } }).manifest ?? 
                   (resultResponse as { result?: { manifest?: unknown } }).result?.manifest;
    let dataArray = (resultResponse as { result?: { data_array?: unknown[] } }).result?.data_array ?? 
                    (resultResponse as { result?: { data?: { data_array?: unknown[] } } }).result?.data?.data_array ??
                    (resultResponse as { data_array?: unknown[] }).data_array;

    // Try fetching from result endpoint if data not in initial response
    if (!dataArray) {
      const fetchResponse = await fetch(
        `https://${DATABRICKS_HOST}${DATABRICKS_STATEMENTS_API}/${statementId}/result`,
        {
          headers: {
            Authorization: `Bearer ${DATABRICKS_TOKEN}`,
          },
        }
      );
      if (fetchResponse.ok) {
        const fetchData = await fetchResponse.json();
        manifest = fetchData.manifest ?? fetchData.result?.manifest;
        dataArray = fetchData.data_array ?? fetchData.result?.data_array ?? fetchData.result?.data?.data_array;
      }
    }

    if (!dataArray) {
      throw new Error(`${ERROR_UNEXPECTED_RESULT_FORMAT} ${JSON.stringify(resultResponse)}`);
    }

    // Transform and group schema data
    const columns = (manifest as { schema?: { columns?: Array<{ name: string }> } })?.schema?.columns ?? [];
    const schemaData = transformSchemaData(dataArray, columns);
    const tablesMap = groupSchemaByTable(schemaData);

    // Persist to graph database
    const { tablesCreated, columnsCreated } = await persistSchemaToGraph(session, tablesMap);

    return NextResponse.json({
      message: "Knowledge graph database reset successfully",
      catalog: DATABRICKS_CATALOG,
      schema: DATABRICKS_SCHEMA,
      tablesCreated,
      columnsCreated,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    await session.close();
  }
}