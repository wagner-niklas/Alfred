import { tool } from "ai";
import { z } from "zod";
import neo4j from "neo4j-driver";

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

// --- Embedding helper (direct HTTP calls, no ai.embed indirection) ---
async function getEmbeddingVector(query: string): Promise<number[]> {
  const provider = process.env.EMBEDDING_PROVIDER || "azure";

  if (provider === "azure") {
    const apiKey = process.env.AZURE_OPENAI_EMBEDDING_API_KEY;
    const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION;
    const baseURL = process.env.AZURE_OPENAI_EMBEDDING_BASE_URL;
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;

    if (!apiKey || !apiVersion || !baseURL || !deployment) {
      throw new Error(
        "Missing Azure embedding configuration. Please set AZURE_OPENAI_EMBEDDING_API_KEY, AZURE_OPENAI_EMBEDDING_API_VERSION, AZURE_OPENAI_EMBEDDING_BASE_URL, and AZURE_OPENAI_EMBEDDING_DEPLOYMENT.",
      );
    }

    // Normalise base URL to avoid duplicated `/openai` segments. Users may
    // set either:
    //   - https://<resource>.openai.azure.com
    //   - https://<resource>.openai.azure.com/openai/
    // We always want `https://<resource>.openai.azure.com/openai/deployments/...`.
    const trimmedBase = baseURL.replace(/\/+$/, "");
    const baseWithoutOpenAi = trimmedBase.toLowerCase().endsWith("/openai")
      ? trimmedBase.slice(0, -"/openai".length)
      : trimmedBase;

    const url = `${baseWithoutOpenAi}/openai/deployments/${deployment}/embeddings?api-version=${encodeURIComponent(apiVersion)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({ input: query }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Azure embedding request failed with status ${res.status}: ${text}`,
      );
    }

    const json: any = await res.json();
    const embedding = json?.data?.[0]?.embedding;

    if (!Array.isArray(embedding)) {
      throw new Error(
        "Azure embedding API returned an unexpected response shape.",
      );
    }

    return embedding as number[];
  }

  // Fallback: OpenAI-compatible embeddings via HTTP
  const apiKey =
    process.env.OPENAI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL =
    process.env.OPENAI_EMBEDDING_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://api.openai.com/v1";
  const model =
    process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large";

  if (!apiKey) {
    throw new Error(
      "Missing OpenAI embedding configuration. Please set OPENAI_EMBEDDING_API_KEY or OPENAI_API_KEY.",
    );
  }

  const url = `${baseURL.replace(/\/+$/, "")}/embeddings`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: query, model }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenAI embedding request failed with status ${res.status}: ${text}`,
    );
  }

  const json: any = await res.json();
  const embedding = json?.data?.[0]?.embedding;

  if (!Array.isArray(embedding)) {
    throw new Error(
      "OpenAI embedding API returned an unexpected response shape.",
    );
  }

  return embedding as number[];
}

// Cypher retrieval query body (without the initial MATCH/WHERE) mirroring
// the notebook's retrieval_query for Table context. The main query will
// prepend an appropriate MATCH/WHERE clause.

export const fetch_knowledge_store = () =>
  tool({
    description:
      "Fetch tables, columns, and their relationships from the Knowledge Store based on a subset of the information schema.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "The search string."
        ),
    }),
    execute: async ({ query }) => {
      const session = getSession();

      try {
        // --- 1) Create embedding for the natural language query ---
        const embedding = await getEmbeddingVector(query);

        // --- 2) Vector search over Table nodes ---
        const vectorSearchCypher = `
CALL db.index.vector.queryNodes("table_vector_index", $topK, $embedding) YIELD node, score
RETURN elementId(node) AS node_id, node.name AS table_name, score
ORDER BY score DESC
`;

        const vectorResult = await session.run(vectorSearchCypher, {
          topK: TOP_K,
          // Ensure we always pass a plain array to Neo4j.
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