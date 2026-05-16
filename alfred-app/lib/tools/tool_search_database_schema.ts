import { tool } from "ai";
import { z } from "zod";
import neo4j from "neo4j-driver";

// --- Neo4j setup ---
const NEO4J_BOLT_URL = process.env.NEO4J_BOLT_URL!;
const NEO4J_USERNAME = process.env.NEO4J_USERNAME!;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD!;
const TOP_K = 5;
const FUZZY_THRESHOLD = 0.78;
const ADJACENCY_BOOST = 4;

export const driver = neo4j.driver(
  NEO4J_BOLT_URL,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD),
);

export const getSession = (database = "neo4j") =>
  driver.session({ database });

type TextCandidate = {
  value: unknown;
  source: string;
  weight: number;
};

type MatchDetail = {
  keyword: string;
  matched_text: string;
  source: string;
  match_type: "exact" | "token-exact" | "substring" | "fuzzy";
  score: number;
};

type TableRetrievalRecord = {
  table_name: string;
  table_description: string | null;
  table_synonyms: unknown;
  columns: Array<Record<string, unknown>>;
  concepts: Array<Record<string, unknown>>;
  related_columns: Array<Record<string, unknown>>;
};

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

const tokenize = (value: string) =>
  normalizeText(value).split(/\W+/).filter(Boolean);

const synonymCandidates = (
  value: unknown,
  source: string,
  weight: number,
): TextCandidate[] => {
  if (Array.isArray(value)) {
    return value
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => ({ value: s, source, weight }));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [{ value, source, weight }];
  }
  return [];
};

const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j++) prev[j] = curr[j];
  }
  return prev[right.length];
};

const similarity = (left: string, right: string): number => {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;
  return 1 - levenshteinDistance(left, right) / maxLength;
};

// Match-type hierarchy: exact > token-exact > substring > fuzzy
const bestKeywordMatch = (
  keyword: string,
  candidate: TextCandidate,
): MatchDetail | null => {
  if (typeof candidate.value !== "string" || !candidate.value.trim()) return null;

  const nk = normalizeText(keyword);
  const nc = normalizeText(candidate.value);
  if (!nk || !nc) return null;

  if (nc === nk) {
    return { keyword, matched_text: candidate.value, source: candidate.source, match_type: "exact", score: candidate.weight };
  }

  if (tokenize(nc).includes(nk)) {
    return { keyword, matched_text: candidate.value, source: candidate.source, match_type: "token-exact", score: candidate.weight * 0.95 };
  }

  if (nc.includes(nk)) {
    return { keyword, matched_text: candidate.value, source: candidate.source, match_type: "substring", score: candidate.weight * 0.85 };
  }

  const candidateTokens = tokenize(nc);
  const bestSim = Math.max(
    similarity(nk, nc),
    ...candidateTokens.map((t) => similarity(nk, t)),
  );
  if (bestSim < FUZZY_THRESHOLD) return null;

  return { keyword, matched_text: candidate.value, source: candidate.source, match_type: "fuzzy", score: candidate.weight * bestSim };
};

const MATCH_TYPE_BONUS: Record<string, number> = {
  exact: 5,
  "token-exact": 4,
  substring: 3,
  fuzzy: 1,
};

const scoreTable = (keywords: string[], candidates: TextCandidate[]) => {
  const matchDetails: MatchDetail[] = [];

  for (const keyword of keywords) {
    const best = candidates
      .map((c) => bestKeywordMatch(keyword, c))
      .filter((m): m is MatchDetail => m !== null)
      .sort((a, b) => b.score - a.score)[0];

    if (best) matchDetails.push(best);
  }

  const rawSum = matchDetails.reduce((s, m) => s + m.score, 0);
  const typeBonus = matchDetails.reduce((s, m) => s + (MATCH_TYPE_BONUS[m.match_type] ?? 0), 0);
  // Coverage multiplier: reward tables that match more distinct keywords
  const coverageMultiplier = 1 + matchDetails.length * 0.5;
  const score = Number(((rawSum + typeBonus) * coverageMultiplier).toFixed(3));

  return { score, matchDetails };
};

export const search_database_schema = () =>
  tool({
    description:
      "Find the best matching database tables from concise keywords by matching across table, column, concept, and related schema nodes in the Knowledge Graph (Neo4j). " +
      "Uses exact, token, substring, and fuzzy keyword matching with bidirectional retrieval and join-adjacency boosting.",
    inputSchema: z.object({
      keywords: z
        .array(z.string().min(1))
        .min(1)
        .describe(
          "Concise keywords describing tables, columns, concepts, or value literals from the user question.",
        ),
    }),
    execute: async ({ keywords }) => {
      const session = getSession();
      const adjacencySession = getSession();

      try {
        const normalizedKeywords = Array.from(
          new Set(keywords.map((k) => k.trim()).filter(Boolean)),
        );

        const allTablesCypher = `
MATCH (node:Table)
OPTIONAL MATCH (node)-[:HAS_COLUMN]->(col:Column)
OPTIONAL MATCH (col)-[:MAPS_TO_CONCEPT]->(concept:Concept)
OPTIONAL MATCH (concept)<-[:MAPS_TO_CONCEPT]-(relatedCol:Column)
RETURN 
  node.name AS table_name,
  node.description AS table_description,
  node.synonyms AS table_synonyms,
  collect(DISTINCT CASE 
    WHEN col.name IS NOT NULL THEN {
      column_name: col.name, 
      synonyms: col.synonyms,
      description: COALESCE(col.description, "No description available"), 
      data_type: COALESCE(col.data_type, "Unknown"), 
      column_sample_value: COALESCE(col.column_sample_value, "No sample value"),
      is_foreign_key: EXISTS((col)-[:FOREIGN_KEY]->())
    } 
  END) AS columns,
  collect(DISTINCT CASE
    WHEN concept.name IS NOT NULL THEN {
      name: concept.name,
      type: concept.type,
      sql_expression: concept.sql_expression,
      synonyms: concept.synonyms
    }
  END) AS concepts,
  collect(DISTINCT CASE 
    WHEN relatedCol.name IS NOT NULL THEN {
      column_name: relatedCol.name, 
      synonyms: relatedCol.synonyms,
      description: COALESCE(relatedCol.description, "No description available"), 
      data_type: COALESCE(relatedCol.data_type, "Unknown"), 
      column_sample_value: COALESCE(relatedCol.column_sample_value, "No sample value")
    } 
  END) AS related_columns
ORDER BY node.name
`;

        // FK adjacency for join-path boost (DANKE Steiner-tree idea):
        // tables reachable via a single foreign-key hop from a high-scoring seed
        // get a small score bump so the result set stays join-connected.
        const adjacencyCypher = `
MATCH (t1:Table)-[:HAS_COLUMN]->(:Column)-[:FOREIGN_KEY]->(:Column)<-[:HAS_COLUMN]-(t2:Table)
WHERE t1 <> t2
RETURN t1.name AS from_table, t2.name AS to_table
`;

        const [allTablesResult, adjacencyResult] = await Promise.all([
          session.run(allTablesCypher),
          adjacencySession.run(adjacencyCypher),
        ]);

        // Build FK adjacency map
        const adjacency = new Map<string, string[]>();
        for (const rec of adjacencyResult.records) {
          const from = rec.get("from_table") as string;
          const to   = rec.get("to_table")   as string;
          if (!adjacency.has(from)) adjacency.set(from, []);
          if (!adjacency.has(to))   adjacency.set(to,   []);
          adjacency.get(from)!.push(to);
          adjacency.get(to)!.push(from);
        }

        const tables = allTablesResult.records.map((r) => r.toObject() as TableRetrievalRecord);

        // --- Table-first pass: score every table across all keywords ---
        const scoredTables = tables.map((table) => {
          const columns        = Array.isArray(table.columns)         ? table.columns         : [];
          const concepts       = Array.isArray(table.concepts)        ? table.concepts        : [];
          const relatedColumns = Array.isArray(table.related_columns) ? table.related_columns : [];

          const candidates: TextCandidate[] = [
            { value: table.table_name,        source: "table.name",        weight: 14 },
            { value: table.table_description, source: "table.description", weight: 6  },
            ...synonymCandidates(table.table_synonyms, "table.synonyms", 12),
            ...columns.flatMap((col) => [
              { value: col.column_name,         source: "column.name",        weight: 10 },
              { value: col.description,         source: "column.description",  weight: 5  },
              { value: col.column_sample_value, source: "column.sample_value", weight: 4  },
              ...synonymCandidates(col.synonyms, "column.synonyms", 9),
            ]),
            ...concepts.flatMap((concept) => [
              { value: concept.name,           source: "concept.name",           weight: 13 },
              { value: concept.sql_expression, source: "concept.sql_expression", weight: 6  },
              ...synonymCandidates(concept.synonyms, "concept.synonyms", 11),
            ]),
            ...relatedColumns.flatMap((col) => [
              { value: col.column_name, source: "related_column.name",        weight: 5 },
              { value: col.description, source: "related_column.description", weight: 3 },
              ...synonymCandidates(col.synonyms, "related_column.synonyms", 4),
            ]),
          ];

          const { score, matchDetails } = scoreTable(normalizedKeywords, candidates);
          return { ...table, match_score: score, matches: matchDetails };
        });

        // Accumulate scores in a mutable map for the next two passes
        const scoreMap = new Map(scoredTables.map((t) => [t.table_name, t.match_score]));

        // --- Column-first pass (bidirectional): for each keyword, find the
        //     table whose columns match best and add a partial score.
        //     This surfaces tables whose name doesn't match but columns do. ---
        for (const keyword of normalizedKeywords) {
          let bestColScore = 0;
          let bestTableName: string | null = null;

          for (const table of tables) {
            const colCandidates: TextCandidate[] = [
              ...(Array.isArray(table.columns) ? table.columns : []).flatMap((col) => [
                { value: col.column_name,         source: "column.name",         weight: 10 },
                { value: col.column_sample_value, source: "column.sample_value",  weight: 4  },
                ...synonymCandidates(col.synonyms, "column.synonyms", 9),
              ]),
              // Concepts carry business-level semantics — include them so a keyword like
              // "revenue" or "margin" can surface a table even if neither its name nor
              // its column names match.
              ...(Array.isArray(table.concepts) ? table.concepts : []).flatMap((concept) => [
                { value: concept.name,           source: "concept.name",           weight: 13 },
                { value: concept.sql_expression, source: "concept.sql_expression", weight: 6  },
                ...synonymCandidates(concept.synonyms, "concept.synonyms", 11),
              ]),
            ];

            const best = colCandidates
              .map((c) => bestKeywordMatch(keyword, c))
              .filter((m): m is MatchDetail => m !== null)
              .sort((a, b) => b.score - a.score)[0];

            if (best && best.score > bestColScore) {
              bestColScore = best.score;
              bestTableName = table.table_name;
            }
          }

          if (bestTableName && bestColScore > 0) {
            scoreMap.set(bestTableName, (scoreMap.get(bestTableName) ?? 0) + bestColScore * 0.6);
          }
        }

        // --- Adjacency pass: boost FK neighbours of top-K seeds ---
        const seedNames = [...scoreMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, TOP_K)
          .map(([name]) => name);

        for (const seed of seedNames) {
          for (const neighbour of adjacency.get(seed) ?? []) {
            const neighbourScore = scoreMap.get(neighbour) ?? 0;
            if (!seedNames.includes(neighbour) && neighbourScore > 0) {
              scoreMap.set(neighbour, neighbourScore + ADJACENCY_BOOST);
            }
          }
        }

        // --- Final sort and slice ---
        // Column pruning: soft pruning, only applied when a table has many columns
        // (> COLUMN_PRUNE_THRESHOLD). Priority tiers:
        //   1. Always keep: direct keyword match, foreign keys, primary keys
        //   2. Keep: any column-level match (synonyms, description, sample value)
        //   3. Drop: unrelated columns — but only if the table is large enough to warrant pruning
        const COLUMN_PRUNE_THRESHOLD = 12;

        const pruneColumns = (
          table: TableRetrievalRecord & { match_score: number; matches: MatchDetail[] },
        ) => {
          const columns = Array.isArray(table.columns) ? table.columns : [];

          // Skip pruning for small tables — no noise worth removing
          if (columns.length <= COLUMN_PRUNE_THRESHOLD) return table;

          // All column-level matches (any source: name, synonyms, description, sample value)
          const matchedColumnNames = new Set(
            table.matches
              .filter((m) => m.source.startsWith("column.") || m.source.startsWith("related_column."))
              .map((m) => m.matched_text),
          );

          const prunedColumns = columns.filter(
            (col) =>
              matchedColumnNames.has(col.column_name as string) ||
              col.is_foreign_key === true ||
              (col.column_name as string)?.toLowerCase().includes("id"),  // likely PK/FK by convention
          );

          // Safety net: if pruning removed too much (< 3 columns), return all
          if (prunedColumns.length < 3) return table;

          return { ...table, columns: prunedColumns };
        };

        const result = scoredTables
          .map((t) => ({ ...t, match_score: Number((scoreMap.get(t.table_name) ?? 0).toFixed(3)) }))
          .filter((t) => t.match_score > 0)
          .sort((a, b) => b.match_score - a.match_score)
          .slice(0, TOP_K)
          .map(pruneColumns);

        if (result.length === 0) {
          return {
            keywords: normalizedKeywords,
            retrieval: [],
            warning: "No tables matched the provided keywords.",
          };
        }

        return {
          matches: result.map((t) => ({ table_name: t.table_name, score: t.match_score })),
          retrieval: result,
        };
      } catch (err: unknown) {
        console.error("Neo4j query error:", err);
        return { error: err instanceof Error ? err.message : "Unknown Neo4j error" };
      } finally {
        await Promise.all([session.close(), adjacencySession.close()]);
      }
    },
  });