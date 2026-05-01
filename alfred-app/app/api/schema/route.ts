import { NextResponse } from "next/server";
import { getSession } from "@/lib/tools/tool_search_database_schema";

const CONCEPT_TYPES = new Set(["Filter", "Measure", "Dimension"]);

type ConceptColumnInput = {
  table?: unknown;
  column?: unknown;
};

const normalizeSynonyms = (value: unknown) => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  if (typeof value !== "string") return [];

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

const normalizeConceptColumns = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item: ConceptColumnInput) => ({
      table: typeof item.table === "string" ? item.table.trim() : "",
      column: typeof item.column === "string" ? item.column.trim() : "",
    }))
    .filter((item) => item.table && item.column);
};

export async function GET() {
  const session = getSession();

  try {
    // Get all tables
    const tablesQuery = `
      MATCH (t:Table)
      RETURN t.name AS table_name, t.description AS table_description
      ORDER BY t.name
    `;

    const tablesResult = await session.run(tablesQuery);
    const tables = tablesResult.records.map((r) => ({
      name: r.get("table_name"),
      description: r.get("table_description"),
    }));

    // Get all columns grouped by table
    const columnsQuery = `
      MATCH (t:Table)-[:HAS_COLUMN]->(c:Column)
      RETURN
        t.name AS table_name,
        c.name AS column_name,
        c.description AS column_description,
        c.data_type AS data_type,
        c.hidden AS hidden,
        c.synonyms AS column_synonyms
      ORDER BY t.name, c.name
    `;

    const columnsResult = await session.run(columnsQuery);
    const columnsByTable: Record<string, Array<{
      name: string;
      description: string | null;
      data_type: string | null;
      hidden: boolean;
      synonyms: string[];
      table_name: string;
    }>> = {};

    for (const record of columnsResult.records) {
      const tableName = record.get("table_name");
      if (!columnsByTable[tableName]) {
        columnsByTable[tableName] = [];
      }
      columnsByTable[tableName].push({
        name: record.get("column_name"),
        description: record.get("column_description"),
        data_type: record.get("data_type"),
        hidden: record.get("hidden") ?? false,
        synonyms: Array.isArray(record.get("column_synonyms"))
          ? record.get("column_synonyms")
          : [],
        table_name: tableName,
      });
    }

    // Combine tables with their columns
    const tablesWithColumns = tables.map((table) => ({
      ...table,
      columns: columnsByTable[table.name] || [],
    }));

    const conceptsQuery = `
      MATCH (concept:Concept)
      OPTIONAL MATCH (col:Column)-[:MAPS_TO_CONCEPT]->(concept)
      OPTIONAL MATCH (table:Table)-[:HAS_COLUMN]->(col)
      RETURN
        concept.name AS name,
        concept.type AS type,
        concept.sql_expression AS sql_expression,
        concept.synonyms AS synonyms,
        collect(DISTINCT CASE
          WHEN col.name IS NOT NULL THEN {
            table: table.name,
            column: col.name
          }
        END) AS columns
      ORDER BY concept.name
    `;

    const conceptsResult = await session.run(conceptsQuery);
    const concepts = conceptsResult.records.map((r) => ({
      name: r.get("name"),
      type: r.get("type") || "Dimension",
      sql_expression: r.get("sql_expression") ?? null,
      synonyms: Array.isArray(r.get("synonyms")) ? r.get("synonyms") : [],
      columns: (r.get("columns") ?? []).filter(
        (column: { table?: string | null; column?: string | null } | null) =>
          column?.table && column?.column,
      ),
    }));

    return NextResponse.json({ tables: tablesWithColumns, concepts });
  } catch (error) {
    console.error("Schema API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch schema" },
      { status: 500 }
    );
  } finally {
    await session.close();
  }
}

export async function POST(request: Request) {
  const session = getSession();

  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type = typeof body.type === "string" ? body.type.trim() : "";
    const sqlExpression =
      typeof body.sql_expression === "string"
        ? body.sql_expression.trim()
        : "";
    const synonyms = normalizeSynonyms(body.synonyms);
    const columns = normalizeConceptColumns(body.columns);

    if (!name) {
      return NextResponse.json(
        { error: "Concept name is required" },
        { status: 400 },
      );
    }

    if (!CONCEPT_TYPES.has(type)) {
      return NextResponse.json(
        { error: "Concept type must be Filter, Measure, or Dimension" },
        { status: 400 },
      );
    }

    if (!sqlExpression) {
      return NextResponse.json(
        { error: "SQL expression is required" },
        { status: 400 },
      );
    }

    if (columns.length === 0) {
      return NextResponse.json(
        { error: "At least one column must be selected" },
        { status: 400 },
      );
    }

    const result = await session.executeWrite((tx) =>
      tx.run(
        `
        MERGE (concept:Concept {name: $name})
        SET
          concept.type = $type,
          concept.sql_expression = $sqlExpression,
          concept.synonyms = $synonyms
        WITH concept
        OPTIONAL MATCH (:Column)-[existing:MAPS_TO_CONCEPT]->(concept)
        DELETE existing
        WITH concept
        UNWIND $columns AS selectedColumn
        MATCH (table:Table {name: selectedColumn.table})-[:HAS_COLUMN]->(column:Column {name: selectedColumn.column})
        MERGE (column)-[:MAPS_TO_CONCEPT]->(concept)
        WITH concept
        OPTIONAL MATCH (linkedColumn:Column)-[:MAPS_TO_CONCEPT]->(concept)
        OPTIONAL MATCH (linkedTable:Table)-[:HAS_COLUMN]->(linkedColumn)
        RETURN
          concept.name AS name,
          concept.type AS type,
          concept.sql_expression AS sql_expression,
          concept.synonyms AS synonyms,
          collect(DISTINCT {
            table: linkedTable.name,
            column: linkedColumn.name
          }) AS columns
        `,
        {
          name,
          type,
          sqlExpression: sqlExpression || null,
          synonyms,
          columns,
        },
      ),
    );

    const record = result.records[0];

    return NextResponse.json({
      name: record.get("name"),
      type: record.get("type"),
      sql_expression: record.get("sql_expression") ?? null,
      synonyms: record.get("synonyms") ?? [],
      columns: (record.get("columns") ?? []).filter(
        (column: { table?: string | null; column?: string | null } | null) =>
          column?.table && column?.column,
      ),
    });
  } catch (error) {
    console.error("Concept create error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save concept",
      },
      { status: 500 },
    );
  } finally {
    await session.close();
  }
}

export async function PUT(request: Request) {
  const session = getSession();

  try {
    const body = await request.json();
    const originalName =
      typeof body.originalName === "string" ? body.originalName.trim() : "";

    if (originalName) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const type = typeof body.type === "string" ? body.type.trim() : "";
      const sqlExpression =
        typeof body.sql_expression === "string"
          ? body.sql_expression.trim()
          : "";
      const synonyms = normalizeSynonyms(body.synonyms);
      const columns = normalizeConceptColumns(body.columns);

      if (!name) {
        return NextResponse.json(
          { error: "Concept name is required" },
          { status: 400 },
        );
      }

      if (!CONCEPT_TYPES.has(type)) {
        return NextResponse.json(
          { error: "Concept type must be Filter, Measure, or Dimension" },
          { status: 400 },
        );
      }

      if (!sqlExpression) {
        return NextResponse.json(
          { error: "SQL expression is required" },
          { status: 400 },
        );
      }

      if (columns.length === 0) {
        return NextResponse.json(
          { error: "At least one column must be selected" },
          { status: 400 },
        );
      }

      const result = await session.executeWrite((tx) =>
        tx.run(
          `
          MATCH (concept:Concept {name: $originalName})
          SET
            concept.name = $name,
            concept.type = $type,
            concept.sql_expression = $sqlExpression,
            concept.synonyms = $synonyms
          WITH concept
          OPTIONAL MATCH (:Column)-[existing:MAPS_TO_CONCEPT]->(concept)
          DELETE existing
          WITH concept
          UNWIND $columns AS selectedColumn
          MATCH (table:Table {name: selectedColumn.table})-[:HAS_COLUMN]->(column:Column {name: selectedColumn.column})
          MERGE (column)-[:MAPS_TO_CONCEPT]->(concept)
          WITH concept
          OPTIONAL MATCH (linkedColumn:Column)-[:MAPS_TO_CONCEPT]->(concept)
          OPTIONAL MATCH (linkedTable:Table)-[:HAS_COLUMN]->(linkedColumn)
          RETURN
            concept.name AS name,
            concept.type AS type,
            concept.sql_expression AS sql_expression,
            concept.synonyms AS synonyms,
            collect(DISTINCT {
              table: linkedTable.name,
              column: linkedColumn.name
            }) AS columns
          `,
          {
            originalName,
            name,
            type,
            sqlExpression,
            synonyms,
            columns,
          },
        ),
      );

      if (result.records.length === 0) {
        return NextResponse.json(
          { error: "Concept not found" },
          { status: 404 },
        );
      }

      const record = result.records[0];
      return NextResponse.json({
        name: record.get("name"),
        type: record.get("type"),
        sql_expression: record.get("sql_expression") ?? null,
        synonyms: record.get("synonyms") ?? [],
        columns: (record.get("columns") ?? []).filter(
          (column: { table?: string | null; column?: string | null } | null) =>
            column?.table && column?.column,
        ),
      });
    }

    const { tableName, description, columnName, hidden, synonyms } = body;

    if (!tableName) {
      return NextResponse.json(
        { error: "tableName is required" },
        { status: 400 }
      );
    }

    // Update column properties
    if (columnName !== undefined) {
      const updateParts: string[] = [];
      const params: Record<string, unknown> = { tableName, columnName };

      if (description !== undefined) {
        updateParts.push("c.description = $description");
        params.description = description || null;
      }

      if (hidden !== undefined) {
        updateParts.push("c.hidden = $hidden");
        params.hidden = hidden;
      }

      if (synonyms !== undefined) {
        updateParts.push("c.synonyms = $synonyms");
        params.synonyms = normalizeSynonyms(synonyms);
      }

      if (updateParts.length === 0) {
        return NextResponse.json(
          { error: "No properties to update" },
          { status: 400 }
        );
      }

      const updateQuery = `
        MATCH (t:Table {name: $tableName})-[:HAS_COLUMN]->(c:Column {name: $columnName})
        SET ${updateParts.join(", ")}
        RETURN c.name AS column_name, c.description AS column_description, c.data_type AS data_type, c.hidden AS hidden, c.synonyms AS column_synonyms
      `;

      const result = await session.run(updateQuery, params);

      if (result.records.length === 0) {
        return NextResponse.json(
          { error: "Column not found" },
          { status: 404 }
        );
      }

      const record = result.records[0];
      return NextResponse.json({
        name: record.get("column_name"),
        description: record.get("column_description"),
        data_type: record.get("data_type"),
        hidden: record.get("hidden") ?? false,
        synonyms: Array.isArray(record.get("column_synonyms"))
          ? record.get("column_synonyms")
          : [],
      });
    }

    // Update table description
    const updateQuery = `
      MATCH (t:Table {name: $tableName})
      SET t.description = $description
      RETURN t.name AS table_name, t.description AS table_description
    `;

    const result = await session.run(updateQuery, {
      tableName,
      description: description || null,
    });

    if (result.records.length === 0) {
      return NextResponse.json(
        { error: "Table not found" },
        { status: 404 }
      );
    }

    const record = result.records[0];
    return NextResponse.json({
      name: record.get("table_name"),
      description: record.get("table_description"),
    });
  } catch (error) {
    console.error("Schema update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update schema" },
      { status: 500 }
    );
  } finally {
    await session.close();
  }
}

export async function DELETE(request: Request) {
  const session = getSession();

  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      return NextResponse.json(
        { error: "Concept name is required" },
        { status: 400 },
      );
    }

    const result = await session.executeWrite((tx) =>
      tx.run(
        `
        MATCH (concept:Concept {name: $name})
        OPTIONAL MATCH (:Column)-[relationship:MAPS_TO_CONCEPT]->(concept)
        DELETE relationship
        WITH concept
        DELETE concept
        RETURN count(concept) AS deleted
        `,
        { name },
      ),
    );

    const deleted = result.records[0]?.get("deleted")?.toNumber?.() ?? 0;

    if (deleted === 0) {
      return NextResponse.json(
        { error: "Concept not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Concept delete error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete concept",
      },
      { status: 500 },
    );
  } finally {
    await session.close();
  }
}
