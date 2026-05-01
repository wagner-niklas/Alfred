import { NextResponse } from "next/server";
import { getSession } from "@/lib/tools/tool_search_database_schema";

export async function DELETE(request: Request) {
  const session = getSession();

  try {
    const body = await request.json();
    const tableName = typeof body.tableName === "string" ? body.tableName.trim() : "";

    if (!tableName) {
      return NextResponse.json(
        { error: "Table name is required" },
        { status: 400 }
      );
    }

    // Delete the table and all its columns (including relationships)
    const result = await session.executeWrite((tx) =>
      tx.run(
        `
        MATCH (t:Table {name: $tableName})
        OPTIONAL MATCH (t)-[:HAS_COLUMN]->(c:Column)
        DETACH DELETE t, c
        RETURN count(t) AS deleted
        `,
        { tableName }
      )
    );

    const deleted = result.records[0]?.get("deleted")?.toNumber?.() ?? 0;

    if (deleted === 0) {
      return NextResponse.json(
        { error: "Table not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Table delete error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete table",
      },
      { status: 500 }
    );
  } finally {
    await session.close();
  }
}