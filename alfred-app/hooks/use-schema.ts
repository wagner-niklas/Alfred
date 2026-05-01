"use client";

import { useEffect, useState, useCallback } from "react";

export type Column = {
  name: string;
  description: string | null;
  data_type: string | null;
  hidden: boolean;
  // Optional synonyms stored on the Column node in Neo4j
  synonyms?: string[];
  table_name?: string;
};

export type Table = {
  name: string;
  description: string | null;
  columns: Column[];
};

export type ConceptType = "Filter" | "Measure" | "Dimension";

export type ConceptColumn = {
  table: string;
  column: string;
};

export type Concept = {
  name: string;
  type: ConceptType;
  sql_expression: string | null;
  synonyms: string[];
  columns: ConceptColumn[];
};

export type SchemaResponse = {
  tables: Table[];
  concepts: Concept[];
};

export type CreateConceptPayload = {
  name: string;
  type: ConceptType;
  sql_expression: string;
  synonyms: string[];
  columns: ConceptColumn[];
};

export type UpdateConceptPayload = CreateConceptPayload & {
  originalName: string;
};

export function useSchema() {
  const [tables, setTables] = useState<Table[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/schema");
      if (!res.ok) {
        throw new Error(`Failed to load schema: ${res.status}`);
      }

      const data = (await res.json()) as SchemaResponse;
      setTables(data.tables);
      setConcepts(data.concepts ?? []);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load schema");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateTableDescription = useCallback(async (tableName: string, description: string) => {
    try {
      const res = await fetch("/api/schema", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableName, description }),
      });

      if (!res.ok) {
        throw new Error("Failed to update table description");
      }

      // Refresh the schema after update
      await load();
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }, [load]);

  const updateColumnDescription = useCallback(
    async (
      tableName: string,
      columnName: string,
      description: string,
      synonyms?: string,
    ) => {
      try {
        const res = await fetch("/api/schema", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableName, columnName, description, synonyms }),
        });

        if (!res.ok) {
          throw new Error("Failed to update column description");
        }

        // Refresh the schema after update
        await load();
        return true;
      } catch (err) {
        console.error(err);
        return false;
      }
    },
    [load],
  );

  const toggleColumnHidden = useCallback(async (tableName: string, columnName: string, hidden: boolean) => {
    try {
      const res = await fetch("/api/schema", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableName, columnName, hidden }),
      });

      if (!res.ok) {
        throw new Error("Failed to update column visibility");
      }

      // Refresh the schema after update
      await load();
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }, [load]);

  const createConcept = useCallback(async (payload: CreateConceptPayload) => {
    try {
      const res = await fetch("/api/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to save concept");
      }

      await load();
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }, [load]);

  const updateConcept = useCallback(async (payload: UpdateConceptPayload) => {
    try {
      const res = await fetch("/api/schema", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to update concept");
      }

      await load();
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }, [load]);

  const deleteConcept = useCallback(async (name: string) => {
    try {
      const res = await fetch("/api/schema", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to delete concept");
      }

      await load();
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }, [load]);

  const deleteTable = useCallback(async (tableName: string) => {
    try {
      const res = await fetch("/api/schema/table", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableName }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to delete table");
      }

      await load();
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }, [load]);

  return {
    tables,
    concepts,
    loading,
    error,
    updateTableDescription,
    updateColumnDescription,
    toggleColumnHidden,
    createConcept,
    updateConcept,
    deleteConcept,
    deleteTable,
  };
}
