import { tool } from "ai";
import { z } from "zod";
import neo4j from "neo4j-driver";

// --- Neo4j setup ---
const NEO4J_BOLT_URL = process.env.NEO4J_BOLT_URL!;
const NEO4J_USERNAME = process.env.NEO4J_USERNAME!;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD!;
const TOP_K = 3;
const FUZZY_THRESHOLD = 0.78;

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
  match_type: "exact" | "fuzzy";
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
      .filter(
        (synonym): synonym is string =>
          typeof synonym === "string" && synonym.trim().length > 0,
      )
      .map((synonym) => ({
        value: synonym,
        source,
        weight,
      }));
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  return [
    {
      value,
      source,
      weight,
    },
  ];
};

const levenshteinDistance = (left: string, right: string) => {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;

    for (let j = 1; j <= right.length; j++) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }

    for (let j = 0; j <= right.length; j++) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
};

const similarity = (left: string, right: string) => {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;

  return 1 - levenshteinDistance(left, right) / maxLength;
};

const bestKeywordMatch = (
  keyword: string,
  candidate: TextCandidate,
): MatchDetail | null => {
  if (
    typeof candidate.value !== "string" ||
    candidate.value.trim().length === 0
  ) {
    return null;
  }

  const normalizedKeyword = normalizeText(keyword);
  const normalizedCandidate = normalizeText(candidate.value);
  if (!normalizedKeyword || !normalizedCandidate) return null;

  if (
    normalizedCandidate === normalizedKeyword ||
    tokenize(normalizedCandidate).includes(normalizedKeyword)
  ) {
    return {
      keyword,
      matched_text: candidate.value,
      source: candidate.source,
      match_type: "exact",
      score: candidate.weight,
    };
  }

  if (normalizedCandidate.includes(normalizedKeyword)) {
    return {
      keyword,
      matched_text: candidate.value,
      source: candidate.source,
      match_type: "exact",
      score: candidate.weight * 0.85,
    };
  }

  const candidateTokens = tokenize(normalizedCandidate);
  const bestSimilarity = Math.max(
    similarity(normalizedKeyword, normalizedCandidate),
    ...candidateTokens.map((token) => similarity(normalizedKeyword, token)),
  );

  if (bestSimilarity < FUZZY_THRESHOLD) return null;

  return {
    keyword,
    matched_text: candidate.value,
    source: candidate.source,
    match_type: "fuzzy",
    score: candidate.weight * bestSimilarity,
  };
};

const scoreTable = (keywords: string[], candidates: TextCandidate[]) => {
  const matchDetails: MatchDetail[] = [];

  for (const keyword of keywords) {
    const bestMatch = candidates
      .map((candidate) => bestKeywordMatch(keyword, candidate))
      .filter((match): match is MatchDetail => Boolean(match))
      .sort((a, b) => b.score - a.score)[0];

    if (bestMatch) {
      matchDetails.push(bestMatch);
    }
  }

  const exactMatches = matchDetails.filter(
    (match) => match.match_type === "exact",
  ).length;
  const fuzzyMatches = matchDetails.filter(
    (match) => match.match_type === "fuzzy",
  ).length;
  const score =
    matchDetails.reduce((sum, match) => sum + match.score, 0) +
    matchDetails.length * 2 +
    exactMatches * 3 +
    fuzzyMatches;

  return { score, matchDetails };
};

export const search_database_schema = () =>
  tool({
    description:
      "Find the best matching database tables from concise keywords by matching across table, column, concept, and related schema nodes in the Knowledge Graph (Neo4j). " +
      "Uses exact and fuzzy keyword matching.",
    inputSchema: z.object({
      keywords: z
        .array(z.string().min(1))
        .min(1)
        .describe(
          "Concise keywords describing concrete tables, columns, concepts, or schema entities to find.",
        ),
    }),
    execute: async ({ keywords }) => {
      const session = getSession();

      try {
        const normalizedKeywords = Array.from(
          new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)),
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
      column_sample_value: COALESCE(col.column_sample_value, "No sample value")
    } 
  END) AS columns,
  collect(DISTINCT CASE
    WHEN concept.name IS NOT NULL THEN {
      name: concept.name,
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

        const allTablesResult = await session.run(allTablesCypher);
        const scoredTables = allTablesResult.records
          .map((record) => {
            const table = record.toObject() as TableRetrievalRecord;
            const columns = Array.isArray(table.columns) ? table.columns : [];
            const concepts = Array.isArray(table.concepts)
              ? table.concepts
              : [];
            const relatedColumns = Array.isArray(table.related_columns)
              ? table.related_columns
              : [];

            const candidates: TextCandidate[] = [
              { value: table.table_name, source: "table.name", weight: 12 },
              {
                value: table.table_description,
                source: "table.description",
                weight: 6,
              },
              ...synonymCandidates(
                table.table_synonyms,
                "table.synonyms",
                10,
              ),
              ...columns.flatMap((column: Record<string, unknown>) => [
                {
                  value: column.column_name,
                  source: "column.name",
                  weight: 9,
                },
                ...synonymCandidates(
                  column.synonyms,
                  "column.synonyms",
                  8,
                ),
                {
                  value: column.description,
                  source: "column.description",
                  weight: 4,
                },
                {
                  value: column.column_sample_value,
                  source: "column.sample_value",
                  weight: 3,
                },
              ]),
              ...concepts.flatMap((concept: Record<string, unknown>) => [
                {
                  value: concept.name,
                  source: "concept.name",
                  weight: 8,
                },
                ...synonymCandidates(
                  concept.synonyms,
                  "concept.synonyms",
                  7,
                ),
              ]),
              ...relatedColumns.flatMap((column: Record<string, unknown>) => [
                {
                  value: column.column_name,
                  source: "related_column.name",
                  weight: 5,
                },
                ...synonymCandidates(
                  column.synonyms,
                  "related_column.synonyms",
                  4,
                ),
                {
                  value: column.description,
                  source: "related_column.description",
                  weight: 3,
                },
              ]),
            ];

            const { score, matchDetails } = scoreTable(
              normalizedKeywords,
              candidates,
            );

            return {
              ...table,
              match_score: Number(score.toFixed(3)),
              matches: matchDetails,
            };
          })
          .filter((table) => table.match_score > 0)
          .sort((a, b) => b.match_score - a.match_score)
          .slice(0, TOP_K);

        if (scoredTables.length === 0) {
          return {
            keywords: normalizedKeywords,
            matches: [],
            retrieval: [],
            warning: "No tables matched the provided keywords.",
          };
        }

        return {
          keywords: normalizedKeywords,
          matches: scoredTables.map((table) => ({
            table_name: table.table_name,
            score: table.match_score,
            matched_keywords: table.matches,
          })),
          retrieval: scoredTables,
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
