import { tool } from "ai";
import { z } from "zod";

import { getSession } from "@/lib/tools/tool_search_database_schema";

// Manual retrieval tool: lets the caller provide an arbitrary Cypher query
// against the Knowledge Store (Neo4j), along with a natural language
// description of what the query is intended to do.

export const fetch_database_schema_elements = () =>
  tool({
    description:
      "Execute a Cypher query manually against the Knowledge Graph (Neo4j). Use only for full-control retrieval.",    inputSchema: z.object({
      purpose: z
        .string()
        .min(1)
        .describe(
          "A short natural-language explanation of what you want to retrieve with this Cypher query (e.g., 'Find all tables that influence the revenue calculation'). This helps the assistant decide when to use manual Cypher vs. automated tools.",
        ),
      cypher_query: z
        .string()
        .min(1)
        .describe(
          "Valid Cypher query to run directly on the Knowledge Graph Neo4j database. Must be syntactically correct and only read data (no writes unless explicitly allowed).",
        ),
    }),
    execute: async ({ cypher_query }) => {
      const session = getSession();

      try {
        const result = await session.run(cypher_query);

        const records = result.records.map((r) => r.toObject());

        return {
          cypher_query,
          records,
        };
      } catch (err: unknown) {
        console.error("Neo4j manual retrieval error:", err);
        return {
          error:
            err instanceof Error ? err.message : "Unknown Neo4j manual retrieval error",
        };
      } finally {
        await session.close();
      }
    },
  });
