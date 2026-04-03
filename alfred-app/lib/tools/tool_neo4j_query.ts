import { tool, embed } from "ai";
import { z } from "zod";
import neo4j from "neo4j-driver";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";

// --- Neo4j setup ---
const NEO4J_BOLT_URL = process.env.NEO4J_BOLT_URL!;
const NEO4J_USERNAME = process.env.NEO4J_USERNAME!;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD!;
const TOP_K = 3;

export const driver = neo4j.driver(
  NEO4J_BOLT_URL,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
);

export const getSession = (database = "neo4j") =>
  driver.session({ database });

// --- Embedding model setup (fully independent) ---
function getEmbeddingModel() {
  const provider = process.env.EMBEDDING_PROVIDER || "azure";

  if (provider === "azure") {
    const azure = createAzure({
      apiKey: process.env.AZURE_OPENAI_EMBEDDING_API_KEY!,
      apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION!,
      baseURL: process.env.AZURE_OPENAI_EMBEDDING_BASE_URL!,
      useDeploymentBasedUrls: true,
    });

    return azure.embedding(
      process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT!
    );
  }

  // fallback to OpenAI-compatible embeddings
  const openai = createOpenAI({
    apiKey:
      process.env.OPENAI_EMBEDDING_API_KEY ||
      process.env.OPENAI_API_KEY!,
    baseURL:
      process.env.OPENAI_EMBEDDING_BASE_URL ||
      process.env.OPENAI_BASE_URL,
  });

  return openai.embedding(
    process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large"
  );
}

const embeddingModel = getEmbeddingModel();

// Cypher retrieval query body (without the initial MATCH/WHERE) mirroring
// the notebook's retrieval_query for Table context. The main query will
// prepend an appropriate MATCH/WHERE clause.

export const tool_neo4j_query = () =>
  tool({
    name: "tool_neo4j_query",
    description:
      "Queries a knowledge graph containing structured metadata about the database (tables, columns, relationships).",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Natural language question to retrieve relevant metadata or relationships from the knowledge graph."
        ),
    }),
    execute: async ({ query }) => {
      const session = getSession();

      try {
        // --- 1) Create embedding for the natural language query ---
        const { embedding } = await embed({
          model: embeddingModel,
          value: query,
        });

        // --- 2) Vector search over Table nodes ---
        const vectorSearchCypher = `
CALL db.index.vector.queryNodes("table_vector_index", $topK, $embedding) YIELD node, score
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
              "No tables found from vector index for the provided query. Ensure embeddings and vector index are created.",
          };
        }

        // --- 3) Run retrieval query restricted to matched tables ---
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

        const retrievalCypher = `
MATCH (node:Table)
WHERE node.name IN $tableNames
${TABLE_RETRIEVAL_CYPHER}
`;

        const retrievalResult = await session.run(retrievalCypher, {
          tableNames: tableNames.map((t) => t.table_name),
        });

        const retrievalData = retrievalResult.records.map((r) =>
          r.toObject()
        );

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
      }
    },
  });