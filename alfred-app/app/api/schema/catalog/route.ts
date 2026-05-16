import { NextResponse } from "next/server";

const DATABRICKS_HOST = process.env.DATABRICKS_HOST;
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN;
const DATABRICKS_WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID;
const DATABRICKS_CATALOG = process.env.DATABRICKS_CATALOG;

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

async function waitForStatement(statementId: string, timeoutMs = 60000) {
  const start = Date.now();

  while (true) {
    const result = await fetchStatementResult(statementId);

    const state = result?.status?.state;

    if (state === "SUCCEEDED") {
      return result;
    }

    if (state === "FAILED" || state === "CANCELED") {
      throw new Error(
        `Databricks statement ${state}: ${JSON.stringify(result?.status)}`
      );
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error("Databricks statement timeout exceeded");
    }

    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function GET() {
  if (
    !DATABRICKS_HOST ||
    !DATABRICKS_TOKEN ||
    !DATABRICKS_WAREHOUSE_ID ||
    !DATABRICKS_CATALOG
  ) {
    return NextResponse.json(
      { error: "Missing required Databricks environment variables" },
      { status: 500 }
    );
  }

  try {
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
              t.table_type,
              t.comment AS table_description
            FROM system.information_schema.tables t
            WHERE t.table_catalog = '${DATABRICKS_CATALOG}'
              AND t.table_type = 'MANAGED'
            ORDER BY t.table_schema, t.table_name
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

    const resultResponse = await waitForStatement(statementId);

    const manifest = resultResponse.manifest;
    const result = resultResponse.result;

    const dataArray =
      result?.data_array || result?.data?.data_array || null;

    if (!dataArray) {
      throw new Error(
        `Unexpected Databricks result format: ${JSON.stringify(
          resultResponse?.status
        )}`
      );
    }

    const columns = manifest?.schema?.columns || [];

    const schemaData = dataArray.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col: any, idx: number) => {
        obj[col.name] = row[idx];
      });
      return obj;
    });

    // Group tables by schema
    const tablesBySchema: Record<string, Array<{
      name: string;
      description: string | null;
    }>> = {};

    for (const row of schemaData) {
      const schema = row.table_schema as string;
      if (!tablesBySchema[schema]) {
        tablesBySchema[schema] = [];
      }
      tablesBySchema[schema].push({
        name: row.table_name as string,
        description: (row.table_description as string) || null,
      });
    }

    return NextResponse.json({
      catalog: DATABRICKS_CATALOG,
      schemas: tablesBySchema,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}