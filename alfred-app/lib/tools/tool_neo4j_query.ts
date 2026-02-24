import { tool, embed } from "ai";
import { z } from "zod";
import neo4j from "neo4j-driver";
import { createAzure } from "@ai-sdk/azure";

// --- Neo4j setup ---
const NEO4J_BOLT_URL = process.env.NEO4J_BOLT_URL!;
const NEO4J_USERNAME = process.env.NEO4J_USERNAME!;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD!;

export const driver = neo4j.driver(
  NEO4J_BOLT_URL,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
);

export const getSession = (database = "neo4j") => driver.session({ database });

// --- Azure OpenAI embeddings setup ---
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY!;
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION!;
const AZURE_OPENAI_BASE_URL = process.env.AZURE_OPENAI_BASE_URL!;
const AZURE_OPENAI_EMBEDDING_MODEL =
  process.env.AZURE_OPENAI_EMBEDDING_MODEL ||
  process.env.AZURE_OPENAI_EMBEDDING ||
  "deployments/text-embedding-3-large";

const azure = createAzure({
  apiKey: AZURE_OPENAI_API_KEY,
  apiVersion: AZURE_OPENAI_API_VERSION,
  baseURL: AZURE_OPENAI_BASE_URL,
  useDeploymentBasedUrls: true,
});

const embeddingModel = azure.embedding(AZURE_OPENAI_EMBEDDING_MODEL);

// Cypher retrieval query body (without the initial MATCH/WHERE) mirroring
// the notebook's retrieval_query for Table context. The main query will
// prepend an appropriate MATCH/WHERE clause.
const TABLE_RETRIEVAL_CYPHER = `
OPTIONAL MATCH (node)-[:CONTAINS]->(col:Column)
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

export const tool_neo4j_query = () =>
  tool({
    name: "tool_neo4j_query",
    description:
      "Given a natural language query about the SQL database schema, retrieve the most relevant tables from the Neo4j knowledge graph using embeddings + Cypher and return rich table/column/concept context.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Natural language query about the SQL tables/schema. The tool will compute an embedding, run a vector search over Table nodes in Neo4j, and then execute a standardized Cypher retrieval query to return table, column, concept, and related column metadata. This assumes that table embeddings, a vector index, and fulltext index have been created in Neo4j as in the scripts/graph_build_and_query_20250521.ipynb notebook.",
        ),
      top_k: z
        .number()
        .int()
        .positive()
        .default(3)
        .describe("Number of top similar tables to retrieve in table_query mode."),
    }),
    execute: async ({ query, top_k = 3 }) => {
      const session = getSession();

      try {
        // --- Table-centric retrieval using embedding + Cypher ---

        // 1) Create embedding for the natural language table query
        const { embedding } = await embed({
          model: embeddingModel,
          value: query,
        });

        // 2) Vector search over Table nodes.
        //    This assumes a vector index on (t.table_embedding) named 'table_vector_index',
        //    as created in the notebook.
        const vectorSearchCypher = `
CALL db.index.vector.queryNodes("table_vector_index", $topK, $embedding) YIELD node, score
RETURN elementId(node) AS node_id, node.name AS table_name, score
ORDER BY score DESC
`;

        const vectorResult = await session.run(vectorSearchCypher, {
          topK: top_k,
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
      }
    },
  });