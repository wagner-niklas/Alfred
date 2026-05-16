import { NextResponse } from "next/server";
import neo4j from "neo4j-driver";

const NEO4J_BOLT_URL = process.env.NEO4J_BOLT_URL!;
const NEO4J_USERNAME = process.env.NEO4J_USERNAME!;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD!;

const driver = neo4j.driver(
  NEO4J_BOLT_URL,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD),
);

const getSession = (database = "neo4j") => driver.session({ database });

export async function GET() {
  const session = getSession();

  try {
    // Fetch all nodes and relationships from the knowledge graph
    const cypher = `
      MATCH (t:Table)
      OPTIONAL MATCH (t)-[:HAS_COLUMN]->(c:Column)
      OPTIONAL MATCH (c)-[:MAPS_TO_CONCEPT]->(concept:Concept)
      OPTIONAL MATCH (c)-[:FOREIGN_KEY]->(fk:Column)
      OPTIONAL MATCH (fk)<-[:HAS_COLUMN]-(ft:Table)
      
      WITH 
        collect(DISTINCT {
          id: t.name,
          label: t.name,
          type: 'Table',
          description: t.description,
          synonyms: t.synonyms
        }) AS tables,
        collect(DISTINCT {
          id: c.name + '_' + t.name,
          label: c.name,
          type: 'Column',
          parentTable: t.name,
          dataType: c.data_type,
          description: c.description,
          isForeignKey: EXISTS((c)-[:FOREIGN_KEY]->())
        }) AS columns,
        collect(DISTINCT {
          id: concept.name,
          label: concept.name,
          type: 'Concept',
          sqlExpression: concept.sql_expression,
          conceptType: concept.type
        }) AS concepts,
        collect(DISTINCT {
          source: t.name,
          target: c.name + '_' + t.name,
          type: 'HAS_COLUMN'
        }) AS tableColumnRels,
        collect(DISTINCT CASE 
          WHEN concept.name IS NOT NULL AND c.name IS NOT NULL 
          THEN { source: c.name + '_' + t.name, target: concept.name, type: 'MAPS_TO_CONCEPT' }
        END) AS conceptRels,
        collect(DISTINCT CASE
          WHEN fk IS NOT NULL AND ft IS NOT NULL AND ft <> t
          THEN { source: c.name + '_' + t.name, target: fk.name + '_' + ft.name, type: 'FOREIGN_KEY' }
        END) AS fkRels
      RETURN {
        tables: tables,
        columns: columns,
        concepts: concepts,
        relationships: tableColumnRels + 
                       [r IN conceptRels WHERE r.source IS NOT NULL] + 
                       [r IN fkRels WHERE r.source IS NOT NULL]
      } AS graph
    `;

    const result = await session.run(cypher);
    const record = result.records[0];
    
    if (!record) {
      return NextResponse.json({ nodes: [], links: [] });
    }

    const graph = record.get("graph") as any;
    
    // Build nodes array - filter out nulls and undefined
    const nodes = [
      ...(graph.tables || []).filter((n: any) => n && n.id),
      ...(graph.columns || []).filter((n: any) => n && n.id),
      ...(graph.concepts || []).filter((n: any) => n && n.id),
    ];

    // Build links array - filter out nulls and undefined
    const links = (graph.relationships || [])
      .filter((r: any) => r && r.source && r.target);

    return NextResponse.json({ nodes, links });
  } catch (error) {
    console.error("Error fetching graph:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    await session.close();
  }
}