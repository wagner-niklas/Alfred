/**
 * Core graph types and layout utilities shared by graph visualizations.
 *
 * The API is storage-agnostic: callers provide a `GraphResponse` (nodes + links)
 * and use the exported helpers to drive their own rendering.
 */

// Types ---------------------------------------------------------------------

export type GraphNode = {
  id: string | number;
  label?: string;
  properties?: Record<string, unknown>;
};

export type GraphLink = {
  id: string | number;
  source: string | number;
  target: string | number;
  type?: string;
  properties?: Record<string, unknown>;
};

export type GraphResponse = {
  nodes: GraphNode[];
  links: GraphLink[];
};

export type SimNode = GraphNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type ResolvedLink = {
  link: GraphLink;
  source: SimNode;
  target: SimNode;
};

export type SelectedEntity =
  | { type: "node"; node: SimNode }
  | { type: "link"; link: GraphLink; source: SimNode; target: SimNode };

// Layout & simulation constants --------------------------------------------

export const WIDTH = 960;
export const HEIGHT = 540;
export const REPEL_STRENGTH = 1500;
export const LINK_DISTANCE = 220;
export const SPRING_STRENGTH = 0.02;
export const CENTER_STRENGTH = 0.005;
export const DAMPING = 0.92;
export const DT = 0.016;
export const MAX_VELOCITY = 35;
export const BOUNDS_MARGIN = 4;

// Styling -------------------------------------------------------------------

/**
 * Base color palette for node labels. If there are more labels than colors,
 * values are reused cyclically.
 */
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// Helpers -------------------------------------------------------------------

export function createInitialNodes(data: GraphResponse): SimNode[] {
  if (!data.nodes.length) return [];

  const marginX = 16;
  const marginY = 16;
  const usableWidth = WIDTH - marginX * 2;
  const usableHeight = HEIGHT - marginY * 2;

  const count = data.nodes.length;
  const aspect = usableWidth / usableHeight;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
  const rows = Math.max(1, Math.ceil(count / cols));

  const cellWidth = cols > 1 ? usableWidth / (cols - 1) : 0;
  const cellHeight = rows > 1 ? usableHeight / (rows - 1) : 0;

  return data.nodes.map((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);

    const baseX = marginX + col * cellWidth;
    const baseY = marginY + row * cellHeight;

    const jitterX = cellWidth * 0.2 * (Math.random() - 0.5);
    const jitterY = cellHeight * 0.2 * (Math.random() - 0.5);

    const x = baseX + jitterX;
    const y = baseY + jitterY;

    return { ...node, x, y, vx: 0, vy: 0 };
  });
}

export function buildLabelColorMap(
  data: GraphResponse | null,
): Map<string, string> {
  if (!data) return new Map<string, string>();

  const labels = Array.from(
    new Set(
      data.nodes
        .map((node) => node.label)
        .filter((label): label is string => Boolean(label)),
    ),
  ).sort();

  const map = new Map<string, string>();
  labels.forEach((label, index) => {
    map.set(label, CHART_COLORS[index % CHART_COLORS.length]);
  });

  return map;
}

export function createNodeMap(nodes: SimNode[]): Map<string, SimNode> {
  return new Map(nodes.map((n) => [String(n.id), n] as const));
}

export function resolveLinks(
  data: GraphResponse | null,
  nodeMap: Map<string, SimNode>,
): ResolvedLink[] {
  if (!data) return [];

  return data.links
    .map((link) => {
      const source = nodeMap.get(String(link.source));
      const target = nodeMap.get(String(link.target));
      if (!source || !target) return null;
      return { link, source, target } as ResolvedLink;
    })
    .filter((value): value is ResolvedLink => Boolean(value));
}

export function nodeMatchesSearchTerm(node: GraphNode, normalizedSearch: string): boolean {
  if (!normalizedSearch) return false;

  if (String(node.id).toLowerCase().includes(normalizedSearch)) {
    return true;
  }

  if (node.label && node.label.toLowerCase().includes(normalizedSearch)) {
    return true;
  }

  if (node.properties) {
    for (const [key, value] of Object.entries(node.properties)) {
      const combined = `${key} ${String(value)}`.toLowerCase();
      if (combined.includes(normalizedSearch)) {
        return true;
      }
    }
  }

  return false;
}
