import { NextResponse } from "next/server";
import type { Node, Relationship } from "neo4j-driver";
import { getSession } from "@/lib/tools/tool_neo4j_query";

/**
 * API surface for the `/api/graph` endpoint that backs the graph view.
 *
 * The goal of this route is to expose a storage-agnostic graph shape that
 * the frontend can render: `GraphNode[]` and `GraphLink[]` roughly match the
 * `GraphResponse` type in `components/graph/graph-core.ts`.
 *
 * - `GET /api/graph`  → runs a fixed Cypher query to return a default
 *   subgraph (used when you first open the graph page).
 * - `POST /api/graph` → executes an arbitrary, user-supplied Cypher query and
 *   performs a best-effort extraction of nodes + relationships from the
 *   result so that many different query shapes can still be visualised.
 */

type GraphNode = {
  id: string;
  label?: string;
  properties?: Record<string, unknown>;
};

type GraphLink = {
  id: string;
  source: string;
  target: string;
  type?: string;
  properties?: Record<string, unknown>;
};

/**
 * Default graph sample: fetches a small slice of the Neo4j database using a
 * fixed Cypher query. This is what the graph view loads on first render.
 */
export async function GET() {
  const session = getSession();

  try {
    // Fetch a larger slice of the graph so the visualization shows more
    // context. Increase/decrease this LIMIT if needed for performance.
    const result = await session.run(
      "MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 200",
    );

    const nodeMap = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    for (const record of result.records) {
      const n = record.get("n") as Node;
      const m = record.get("m") as Node;
      const r = record.get("r") as Relationship;

      const addNode = (node: Node) => {
        const id = node.identity.toString();
        if (!nodeMap.has(id)) {
          nodeMap.set(id, {
            id,
            label: node.labels?.[0],
            properties: node.properties as Record<string, unknown>,
          });
        }
      };

      addNode(n);
      addNode(m);

      links.push({
        id: r.identity.toString(),
        source: n.identity.toString(),
        target: m.identity.toString(),
        type: r.type,
        properties: r.properties as Record<string, unknown>,
      });
    }

    return NextResponse.json({
      nodes: Array.from(nodeMap.values()),
      links,
    });
  } catch (error) {
    console.error("Error loading Neo4j graph:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown Neo4j error",
      },
      { status: 500 },
    );
  } finally {
    await session.close();
  }
}

/**
 * Executes an arbitrary Cypher query supplied by the client.
 *
 * The handler walks through each record and treats any value that *looks* like
 * a Neo4j `Node` or `Relationship` as part of the visualisable graph. When a
 * relationship is found before its corresponding node is seen, a placeholder
 * node `{ id }` is inserted and later "upgraded" once the full node appears.
 */
export async function POST(request: Request) {
  const session = getSession();

  try {
    const body = await request.json().catch(() => null);
    const query = body?.query;
    const params = (body?.params ?? {}) as Record<string, unknown>;

    if (typeof query !== "string" || !query.trim()) {
      return NextResponse.json(
        { error: "Missing or invalid 'query' in request body." },
        { status: 400 },
      );
    }

    const result = await session.run(query, params);

    const nodeMap = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    const addNode = (node: Node) => {
      const id = node.identity.toString();

      // Always (re)write the node entry so that if we previously created a
      // placeholder node from a relationship (id only), we "upgrade" it with
      // the full label + properties once the real node value appears.
      nodeMap.set(id, {
        id,
        label: node.labels?.[0],
        properties: node.properties as Record<string, unknown>,
      });
    };

    const addRelationship = (rel: Relationship) => {
      const startId = rel.start.toString();
      const endId = rel.end.toString();

      // Ensure nodes exist for the relationship endpoints, even if the
      // Cypher query didn't explicitly return those nodes.
      if (!nodeMap.has(startId)) {
        nodeMap.set(startId, { id: startId });
      }
      if (!nodeMap.has(endId)) {
        nodeMap.set(endId, { id: endId });
      }

      links.push({
        id: rel.identity.toString(),
        source: startId,
        target: endId,
        type: rel.type,
        properties: rel.properties as Record<string, unknown>,
      });
    };

    for (const record of result.records) {
      // Iterate over the record using the official driver API instead of
      // relying on a non-standard `record.values` field.
      for (const key of record.keys) {
        const v = record.get(key) as unknown;

        // Best-effort detection of nodes and relationships so that many
        // different Cypher result shapes can still be visualized.
        if (
          v &&
          typeof v === "object" &&
          Array.isArray((v as Node).labels) &&
          (v as Node).properties
        ) {
          addNode(v as Node);
        } else if (
          v &&
          typeof v === "object" &&
          typeof (v as Relationship).type === "string" &&
          (v as Relationship).properties &&
          "start" in (v as Relationship) &&
          "end" in (v as Relationship)
        ) {
          addRelationship(v as Relationship);
        }
      }
    }

    return NextResponse.json({
      nodes: Array.from(nodeMap.values()),
      links,
    });
  } catch (error) {
    console.error("Error executing Neo4j graph query:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown Neo4j error",
      },
      { status: 500 },
    );
  } finally {
    await session.close();
  }
}

