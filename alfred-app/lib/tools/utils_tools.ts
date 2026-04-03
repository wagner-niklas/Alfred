import { DBSQLClient } from '@databricks/sql';

export async function executeDatabricksSQL(sql: string) {
  const token = process.env.DATABRICKS_TOKEN!;
  const server_hostname = process.env.DATABRICKS_HOST!;
  const http_path = `/sql/1.0/warehouses/${process.env.DATABRICKS_WAREHOUSE_ID!}`;

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