import { tool, embed } from "ai";
import { z } from "zod";
import neo4j from "neo4j-driver";
import { createAzureClient, getDefaultEmbeddingModel } from "@/lib/azure";
import type { EmbeddingSettings, GraphSettings } from "@/lib/db";

const TOP_K = 3;

// Cypher retrieval query body (without the initial MATCH/WHERE) mirroring
// the notebook's retrieval_query for Table context. The main query will
// prepend an appropriate MATCH/WHERE clause.
const TABLE_RETRIEVAL_CYPHER = `
OPTIONAL MATCH (node)-[:HAS_COLUMN]->(col:Column)
OPTIONAL MATCH (col)-[:MAPS_TO_CONCEPT]->(concept:Concept)
OPTIONAL MATCH (concept)<-[:MAPS_TO_CONCEPT]-(relatedCol:Column)

RETURN 
  node.name AS table_name,
  node.description AS table_description,
  collect(DISTINCT CASE 
    WHEN col.name IS NOT NULL THEN {
      column_name: col.name, 
      description: COALESCE(col.description, "No description available"), 
      data_type: COALESCE(col.data_type, "Unknown"), 
      column_sample_value: COALESCE(col.column_sample_value, "No sample value")
    } 
  END) AS columns,
  collect(DISTINCT concept.name) AS concepts,
  collect(DISTINCT CASE 
    WHEN relatedCol.name IS NOT NULL THEN {
      column_name: relatedCol.name, 
      description: COALESCE(relatedCol.description, "No description available"), 
      data_type: COALESCE(relatedCol.data_type, "Unknown"), 
      column_sample_value: COALESCE(relatedCol.column_sample_value, "No sample value")
    } 
  END) AS related_columns
`;

type ResolvedNeo4jConfig = {
  boltUrl: string;
  username: string;
  password: string;
  database: string;
};

// Resolve the embedding model to use for graph queries. Prefer a per-user
// embedding configuration (stored in SQLite via the /settings page). If that
// configuration is missing or incomplete, fall back to the environment-based
// default so the tool continues to work out of the box.
function resolveEmbeddingModel(
  embeddingSettingsFromConfig?: EmbeddingSettings | null,
) {
  if (
    embeddingSettingsFromConfig &&
    embeddingSettingsFromConfig.apiKey &&
    embeddingSettingsFromConfig.apiVersion &&
    embeddingSettingsFromConfig.baseURL &&
    embeddingSettingsFromConfig.deployment
  ) {
    const client = createAzureClient({
      apiKey: embeddingSettingsFromConfig.apiKey,
      apiVersion: embeddingSettingsFromConfig.apiVersion,
      baseURL: embeddingSettingsFromConfig.baseURL,
      deployment: embeddingSettingsFromConfig.deployment,
    });

    // Use the explicitly configured deployment name. This keeps the
    // embedding model fully independent from the chat model config.
    return client.embedding(embeddingSettingsFromConfig.deployment);
  }

  // Backwards-compatible fallback; uses AZURE_OPENAI_* env variables.
  return getDefaultEmbeddingModel();
}

// Resolve Neo4j connection settings from an optional per-user graph config,
// falling back to environment variables for backwards compatibility.
function resolveNeo4jConfig(
  graphSettingsFromConfig?: GraphSettings | null,
): ResolvedNeo4jConfig {
  let boltUrl: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  let database: string | undefined;

  if (graphSettingsFromConfig) {
    boltUrl = graphSettingsFromConfig.boltUrl;
    username = graphSettingsFromConfig.username;
    password = graphSettingsFromConfig.password;
    database = graphSettingsFromConfig.database ?? undefined;
  }

  boltUrl ??= process.env.NEO4J_BOLT_URL;
  username ??= process.env.NEO4J_USERNAME;
  password ??= process.env.NEO4J_PASSWORD;
  database ??= "neo4j";

  if (!boltUrl || !username || !password) {
    throw new Error(
      "Neo4j settings are missing. Configure them either in /settings or via environment variables.",
    );
  }

  return {
    boltUrl,
    username,
    password,
    database,
  };
}

// Resolve the Neo4j vector index used for table embeddings. This prefers the
// per-user setting from SQLite but falls back to an environment variable and
// finally a hard-coded default so that the system works out of the box.
function resolveTableVectorIndex(
  graphSettingsFromConfig?: GraphSettings | null,
): string {
  return (
    graphSettingsFromConfig?.tableVectorIndex ??
    process.env.NEO4J_TABLE_VECTOR_INDEX ??
    "table_vector_index"
  );
}

// Helper used by the graph API route to obtain a driver + session pair based
// on either per-user settings or environment variables.
export function createNeo4jSession(
  graphSettingsFromConfig?: GraphSettings | null,
) {
  const { boltUrl, username, password, database } = resolveNeo4jConfig(
    graphSettingsFromConfig,
  );

  const driver = neo4j.driver(boltUrl, neo4j.auth.basic(username, password));
  const session = driver.session({ database });

  return { driver, session };
}

// Factory that binds a specific Neo4j configuration (typically loaded
// from the SQLite user_settings table) into the tool. This avoids relying on
// a Request object inside the tool execution context.
export const tool_neo4j_query = (
  graphSettingsFromConfig?: GraphSettings | null,
  embeddingSettingsFromConfig?: EmbeddingSettings | null,
) =>
  tool({
    name: "tool_neo4j_query",
    description:
      "Queries a knowledge graph that contains structured metadata and relationships about the database, such as tables, columns, and their connections.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Natural language question used to retrieve relevant subinformation about database structures, entities, or relationships from the knowledge graph."
        ),
    }),
    execute: async ({ query }) => {
      const { driver, session } = createNeo4jSession(graphSettingsFromConfig);
      const tableVectorIndex = resolveTableVectorIndex(graphSettingsFromConfig);

      try {
        // --- Table-centric retrieval using embedding + Cypher ---

        // 1) Create embedding for the natural language table query.
        //    We prefer the per-user embedding model from the database, but
        //    fall back to the environment-based default when needed.
        const embeddingModel = resolveEmbeddingModel(
          embeddingSettingsFromConfig,
        );

        const { embedding } = await embed({
          model: embeddingModel,
          value: query,
        });

        // 2) Vector search over Table nodes.
        //    This uses a configurable vector index on (t.table_embedding).
        const vectorSearchCypher = `
CALL db.index.vector.queryNodes("${tableVectorIndex}", $topK, $embedding) YIELD node, score
RETURN elementId(node) AS node_id, node.name AS table_name, score
ORDER BY score DESC
`;

        const vectorResult = await session.run(vectorSearchCypher, {
          topK: TOP_K,
          embedding,
        });

        const tableNames = vectorResult.records.map((r) => ({
          table_name: r.get("table_name"),
          score: r.get("score"),
        }));

        if (tableNames.length === 0) {
          return {
            query,
            vector_matches: [],
            retrieval: [],
            warning:
              "No tables found from vector index for the provided natural language query. Ensure embeddings and vector index are created.",
          };
        }

        // 3) Run the standardized retrieval query, restricted to the matched tables.
        const retrievalCypher = `
MATCH (node:Table)
WHERE node.name IN $tableNames
${TABLE_RETRIEVAL_CYPHER}
`;

        const retrievalResult = await session.run(retrievalCypher, {
          tableNames: tableNames.map((t) => t.table_name),
        });

        const retrievalData = retrievalResult.records.map((r) => r.toObject());

        return {
          query,
          vector_matches: tableNames,
          retrieval: retrievalData,
        };
      } catch (err: unknown) {
        console.error("Neo4j query error:", err);

        return {
          error: err instanceof Error ? err.message : "Unknown Neo4j error",
        };
      } finally {
        await session.close();
        await driver.close();
      }
    },
  });