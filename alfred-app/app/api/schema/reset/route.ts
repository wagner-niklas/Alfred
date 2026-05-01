import { NextResponse } from "next/server";
import { getSession } from "@/lib/tools/tool_search_database_schema";

const DATABRICKS_HOST = process.env.DATABRICKS_HOST;
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN;
const DATABRICKS_WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID;
const DATABRICKS_CATALOG = process.env.DATABRICKS_CATALOG;
const DATABRICKS_SCHEMA = process.env.DATABRICKS_SCHEMA;

async function fetchStatementResult(statementId: string) {
  const res = await fetch(
    `https://${DATABRICKS_HOST}/api/2.0/sql/statements/${statementId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${DATABRICKS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed fetching statement result: ${text}`);
  }

  return res.json();
}

export async function POST() {
  if (
    !DATABRICKS_HOST ||
    !DATABRICKS_TOKEN ||
    !DATABRICKS_WAREHOUSE_ID ||
    !DATABRICKS_CATALOG ||
    !DATABRICKS_SCHEMA
  ) {
    return NextResponse.json(
      {
        error:
          "Missing required Databricks environment variables",
      },
      { status: 500 }
    );
  }

  const session = getSession();

  try {
    // Step 1: clear Neo4j
    await session.run(`
      MATCH (t:Table)
      OPTIONAL MATCH (t)-[:HAS_COLUMN]->(c:Column)
      DETACH DELETE t, c
    `);

    // Step 2: run query
    const databricksResponse = await fetch(
      `https://${DATABRICKS_HOST}/api/2.0/sql/statements`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DATABRICKS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          statement: `
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
            WHERE t.table_catalog = '${DATABRICKS_CATALOG}'
              AND t.table_schema = '${DATABRICKS_SCHEMA}'
            ORDER BY t.table_name, c.ordinal_position
          `,
          warehouse_id: DATABRICKS_WAREHOUSE_ID,
          wait_timeout_ms: 60000,
        }),
      }
    );

    if (!databricksResponse.ok) {
      throw new Error(await databricksResponse.text());
    }

    const initial = await databricksResponse.json();

    const statementId = initial.statement_id;

    if (!statementId) {
      throw new Error("Missing statement_id in Databricks response");
    }

    // Step 3: fetch full result
    const resultResponse = await fetchStatementResult(statementId);

    const manifest = resultResponse.manifest;
    const result = resultResponse.result;

    if (!result?.data_array) {
      throw new Error(
        `Unexpected Databricks result format: ${JSON.stringify(
          Object.keys(resultResponse)
        )}`
      );
    }

    const columns = manifest?.schema?.columns || [];

    const schemaData = result.data_array.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col: any, idx: number) => {
        obj[col.name] = row[idx];
      });
      return obj;
    });

    // Step 4: group by table
    const tablesMap = new Map<string, any>();

    for (const row of schemaData) {
      const key = row.table_name;

      if (!tablesMap.has(key)) {
        tablesMap.set(key, {
          schema: row.table_schema,
          description: row.table_description,
          columns: [],
        });
      }

      tablesMap.get(key).columns.push({
        name: row.column_name,
        description: row.column_description,
        data_type: row.data_type,
      });
    }

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
          description: tableData.description || null,
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
            description: column.description || null,
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

    return NextResponse.json({
      message: "Knowledge graph database reset successfully",
      catalog: DATABRICKS_CATALOG,
      schema: DATABRICKS_SCHEMA,
      tablesCreated,
      columnsCreated,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    await session.close();
  }
}