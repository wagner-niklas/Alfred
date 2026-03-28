import { DBSQLClient } from '@databricks/sql';
import type { DatabricksSettings } from "@/lib/db";

// Execute a read-only SQL query against Databricks using either per-user
// settings or, as a fallback, environment variables.
//
// The caller is responsible for passing in a DatabricksSettings object. This
// keeps the function agnostic of how settings are stored (DB, env, etc.).

export async function executeDatabricksSQL(sql: string, settings: DatabricksSettings) {
  const token = settings.token;
  const server_hostname = settings.host;
  const http_path = settings.httpPath;

  const client = new DBSQLClient();

  try {
    await client.connect({
      token,
      host: server_hostname,
      path: http_path,
    });

    const session = await client.openSession();

    const queryOperation = await session.executeStatement(sql, { runAsync: true });

    const data = await queryOperation.fetchAll();

    await queryOperation.close();
    await session.close();
    await client.close();

    return { data };

  } catch (err) {
    console.error("Databricks SQL Error:", err);
    try { await client.close(); } catch {}
    throw err;
  }
}