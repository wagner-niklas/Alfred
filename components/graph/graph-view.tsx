"use client";

/**
 * High–level React UI for exploring the Neo4j knowledge graph.
 *
 * This component is intentionally split into three layers:
 *
 * 1) **Data layer (`useGraphData`)**
 *    - Talks to `/api/graph` (GET for default sample, POST for Cypher queries).
 *    - Normalises success / error / loading state so the view can stay simple.
 *
 * 2) **Simulation layer (`useGraphSimulation`)**
 *    - Turns raw `GraphResponse` nodes into `SimNode`s with positions & velocity.
 *    - Runs a lightweight force-directed layout (repel, spring, centering).
 *    - Handles dragging behaviour and keeps a ref-based copy of the node array
 *      so the animation loop can run without causing excessive React renders.
 *
 * 3) **Presentation layer (`GraphCanvas`, `GraphSidePanel`, `GraphView`)**
 *    - `GraphCanvas` renders nodes/links as an SVG and wires pointer events.
 *    - `GraphSidePanel` exposes search, Cypher query input, and details for the
 *      currently selected node or relationship.
 *    - `GraphView` composes everything together, pre-resolves links via
 *      `graph-core` helpers, and is what the `/graph` page renders.
 *
 * All physics constants, types, and small helpers live in `graph-core.ts` so
 * that this file stays focused on React concerns (state, effects, and layout).
 */

import * as React from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import * as m from "motion/react-m";
import {
  BOUNDS_MARGIN,
  CENTER_STRENGTH,
  DAMPING,
  DT,
  GraphResponse,
  HEIGHT,
  LINK_DISTANCE,
  MAX_VELOCITY,
  REPEL_STRENGTH,
  ResolvedLink,
  SelectedEntity,
  SimNode,
  SPRING_STRENGTH,
  WIDTH,
  buildLabelColorMap,
  createInitialNodes,
  createNodeMap,
  nodeMatchesSearchTerm,
  resolveLinks,
} from "./graph-core";

/**
 * Fetches graph data from `/api/graph` and normalises loading / error state.
 */
function useGraphData() {
  const [data, setData] = React.useState<GraphResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [cypherQuery, setCypherQuery] = React.useState("");
  const [cypherError, setCypherError] = React.useState<string | null>(null);

  const loadDefaultGraph = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setCypherError(null);

    try {
      const res = await fetch("/api/graph");
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      const json = (await res.json()) as GraphResponse;
      setData(json);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const runCypherQuery = React.useCallback(async () => {
    const trimmed = cypherQuery.trim();
    if (!trimmed) {
      setCypherError("Please enter a Cypher query to run.");
      return;
    }

    setLoading(true);
    setCypherError(null);

    try {
      const res = await fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        const message = json?.error ?? `Request failed with status ${res.status}`;
        throw new Error(message);
      }

      const json = (await res.json()) as GraphResponse;
      setData(json);
    } catch (err) {
      console.error(err);
      setCypherError(
        err instanceof Error ? err.message : "Unknown error while running query",
      );
    } finally {
      setLoading(false);
    }
  }, [cypherQuery]);

  React.useEffect(() => {
    void loadDefaultGraph();
  }, [loadDefaultGraph]);

  return {
    data,
    error,
    loading,
    cypherQuery,
    cypherError,
    setCypherQuery,
    loadDefaultGraph,
    runCypherQuery,
  };
}

/**
 * Runs a very small force-directed layout in a requestAnimationFrame loop and
 * exposes drag handlers + the current set of simulated nodes.
 */
function useGraphSimulation(
  data: GraphResponse | null,
  onNodeSelected?: (node: SimNode) => void,
) {
  const [nodes, setNodes] = React.useState<SimNode[]>([]);
  const [draggedId, setDraggedId] = React.useState<string | number | null>(null);
  const nodesRef = React.useRef<SimNode[]>([]);
  const draggedIdRef = React.useRef<string | number | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  React.useEffect(() => {
    draggedIdRef.current = draggedId;
  }, [draggedId]);

  // Recreate the initial grid/jitter layout whenever the backing data changes.
  React.useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setNodes([]);
      nodesRef.current = [];
      return;
    }

    const initialNodes = createInitialNodes(data);
    nodesRef.current = initialNodes;
    setNodes(initialNodes);
  }, [data]);

  React.useEffect(() => {
    if (!data || data.nodes.length === 0) return;

    let animationFrame: number;
    let frameCount = 0;

    // Map original node ids to indices so we can quickly build link pairs.
    const indexById = new Map<string, number>(
      data.nodes.map((node, index) => [String(node.id), index]),
    );

    // Pre-resolve links into index pairs so the tick function only deals with
    // numbers and not string lookups.
    const links = data.links
      .map((link) => {
        const sourceIndex = indexById.get(String(link.source));
        const targetIndex = indexById.get(String(link.target));
        if (
          sourceIndex === undefined ||
          targetIndex === undefined ||
          sourceIndex === targetIndex
        ) {
          return null;
        }
        return { sourceIndex, targetIndex };
      })
      .filter((link): link is { sourceIndex: number; targetIndex: number } =>
        Boolean(link),
      );

    const tick = () => {
      const current = nodesRef.current;
      if (!current.length) {
        animationFrame = requestAnimationFrame(tick);
        return;
      }

      const draggingId = draggedIdRef.current;
      const updated: SimNode[] = current.map((node) => ({ ...node }));

      // 1) Repulsive force between all node pairs (keeps nodes apart).
      for (let i = 0; i < updated.length; i++) {
        for (let j = i + 1; j < updated.length; j++) {
          const nodeA = updated[i];
          const nodeB = updated[j];

          let dx = nodeB.x - nodeA.x;
          let dy = nodeB.y - nodeA.y;
          let distSq = dx * dx + dy * dy + 0.01;
          const force = REPEL_STRENGTH / distSq;
          const dist = Math.sqrt(distSq);
          const invDist = 1 / dist;
          dx *= invDist;
          dy *= invDist;

          const fx = force * dx;
          const fy = force * dy;

          if (nodeA.id !== draggingId) {
            nodeA.vx -= fx * DT;
            nodeA.vy -= fy * DT;
          }
          if (nodeB.id !== draggingId) {
            nodeB.vx += fx * DT;
            nodeB.vy += fy * DT;
          }
        }
      }

      // 2) Spring force along edges (pulls connected nodes towards a target
      //    distance).
      for (const { sourceIndex, targetIndex } of links) {
        const source = updated[sourceIndex];
        const target = updated[targetIndex];
        let dx = target.x - source.x;
        let dy = target.y - source.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const displacement = dist - LINK_DISTANCE;
        const force = SPRING_STRENGTH * displacement;
        const invDist = 1 / dist;
        dx *= invDist;
        dy *= invDist;

        const fx = force * dx;
        const fy = force * dy;

        if (source.id !== draggingId) {
          source.vx += fx * DT;
          source.vy += fy * DT;
        }
        if (target.id !== draggingId) {
          target.vx -= fx * DT;
          target.vy -= fy * DT;
        }
      }

      const centerX = WIDTH / 2;
      const centerY = HEIGHT / 2;

      // 3) Pull everything back towards the centre, apply damping + clamping.
      for (const node of updated) {
        if (node.id === draggingId) {
          node.vx *= DAMPING;
          node.vy *= DAMPING;
          continue;
        }

        const dx = centerX - node.x;
        const dy = centerY - node.y;

        node.vx += dx * CENTER_STRENGTH * DT;
        node.vy += dy * CENTER_STRENGTH * DT;

        node.vx *= DAMPING;
        node.vy *= DAMPING;

        const speedSq = node.vx * node.vx + node.vy * node.vy;
        if (speedSq > MAX_VELOCITY * MAX_VELOCITY) {
          const speed = Math.sqrt(speedSq);
          const scale = MAX_VELOCITY / speed;
          node.vx *= scale;
          node.vy *= scale;
        }

        node.x += node.vx;
        node.y += node.vy;

        node.x = Math.max(BOUNDS_MARGIN, Math.min(WIDTH - BOUNDS_MARGIN, node.x));
        node.y = Math.max(BOUNDS_MARGIN, Math.min(HEIGHT - BOUNDS_MARGIN, node.y));
      }

      nodesRef.current = updated;

      // Only push updates into React every other frame to keep things smooth.
      frameCount += 1;
      if (frameCount % 2 === 0) {
        setNodes(updated);
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [data]);

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!draggedIdRef.current) return;
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
      const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;

      const current = nodesRef.current;
      if (!current.length) return;

      const updated = current.map((node) =>
        node.id === draggedIdRef.current ? { ...node, x, y, vx: 0, vy: 0 } : node,
      );

      nodesRef.current = updated;
      setNodes(updated);
    },
    [],
  );

  const handlePointerUp = React.useCallback(() => {
    setDraggedId(null);
  }, []);

  const handleNodePointerDown = React.useCallback(
    (event: React.PointerEvent<SVGGElement>, node: SimNode) => {
      event.preventDefault();
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      setDraggedId(node.id);
      onNodeSelected?.(node);
    },
    [onNodeSelected],
  );

  return {
    nodes,
    svgRef,
    draggedId,
    handlePointerMove,
    handlePointerUp,
    handleNodePointerDown,
  };
}

type GraphCanvasProps = {
  nodes: SimNode[];
  resolvedLinks: ResolvedLink[];
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  draggedId: string | number | null;
  selected: SelectedEntity | null;
  setSelected: React.Dispatch<React.SetStateAction<SelectedEntity | null>>;
  labelColorMap: Map<string, string>;
  normalizedSearch: string;
  onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: () => void;
  onNodePointerDown: (
    event: React.PointerEvent<SVGGElement>,
    node: SimNode,
  ) => void;
};

type GraphNodeGlyphProps = {
  node: SimNode;
  isSelected: boolean;
  isSearchMatch: boolean;
  isDimmed: boolean;
  labelColorMap: Map<string, string>;
};

function GraphNodeGlyph({
  node,
  isSelected,
  isSearchMatch,
  isDimmed,
  labelColorMap,
}: GraphNodeGlyphProps) {
  const radius = isSelected ? 20 : 16;
  const strokeWidth = isSelected ? 3 : 2;
  const baseFill =
    (node.label && labelColorMap.get(node.label)) || "hsl(var(--background))";
  const fill = baseFill;
  const stroke = isSearchMatch || isSelected ? "black" : "hsl(var(--primary))";
  const opacity = isDimmed ? 0.25 : 1;

  return (
    <>
      <circle
        cx={node.x}
        cy={node.y}
        r={radius}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
        filter={isDimmed ? "url(#node-blur)" : undefined}
      />
      <text
        x={node.x}
        y={node.y}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-foreground text-[10px]"
        opacity={opacity}
        filter={isDimmed ? "url(#node-blur)" : undefined}
      >
        {node.label ?? node.id}
      </text>
    </>
  );
}

/**
 * Pure SVG renderer for the current simulation state.
 */
function GraphCanvas({
  nodes,
  resolvedLinks,
  svgRef,
  draggedId,
  selected,
  setSelected,
  labelColorMap,
  normalizedSearch,
  onPointerMove,
  onPointerUp,
  onNodePointerDown,
}: GraphCanvasProps) {
  const handleBackgroundClick = React.useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      // Only clear selection if the user clicked directly on the SVG
      // background (not on a node/link element inside it).
      if (event.currentTarget === event.target) {
        setSelected(null);
      }
    },
    [setSelected],
  );

  return (
    <div className="flex-1 overflow-auto rounded-md border bg-muted/40">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-full w-full touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={handleBackgroundClick}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--muted-foreground))" />
          </marker>

          {/* Subtle blur for de-emphasised nodes when a search or selection is active */}
          <filter id="node-blur" x="-5" y="-5" width="200" height="200">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.25" />
          </filter>
        </defs>

        {resolvedLinks.map(({ link, source, target }) => {
          const isSelectedLink =
            selected?.type === "link" &&
            String(selected.link.id) === String(link.id);

          const hasFocus = Boolean(selected) || normalizedSearch.length > 0;

          const sourceMatchesSearch = nodeMatchesSearchTerm(
            source,
            normalizedSearch,
          );
          const targetMatchesSearch = nodeMatchesSearchTerm(
            target,
            normalizedSearch,
          );

          const touchesSelectedNode =
            selected?.type === "node" &&
            (String(source.id) === String(selected.node.id) ||
              String(target.id) === String(selected.node.id));

          const touchesSearch = sourceMatchesSearch || targetMatchesSearch;
          const isRelevantLink =
            isSelectedLink || touchesSelectedNode || touchesSearch;

          const isDimmedLink = hasFocus && !isRelevantLink;
          const linkOpacity = isDimmedLink ? 0.25 : 1;

          return (
            <g
              key={String(link.id)}
              onClick={(event) => {
                event.stopPropagation();
                setSelected({ type: "link", link, source, target });
              }}
              style={{ cursor: "pointer" }}
            >
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="black"
                strokeWidth={isSelectedLink ? 2 : 1.5}
                markerEnd="url(#arrow)"
                opacity={linkOpacity}
                filter={isDimmedLink ? "url(#node-blur)" : undefined}
              />
              {link.type && (
                <text
                  x={(source.x + target.x) / 2}
                  y={(source.y + target.y) / 2}
                  className="fill-muted-foreground text-[10px]"
                  opacity={linkOpacity}
                  filter={isDimmedLink ? "url(#node-blur)" : undefined}
                >
                  {link.type}
                </text>
              )}
            </g>
          );
        })}

        {nodes.map((node) => {
          const isSelectedNode =
            selected?.type === "node" &&
            String(selected.node.id) === String(node.id);
          const isSearchMatch = nodeMatchesSearchTerm(node, normalizedSearch);
          const hasFocus = Boolean(selected) || normalizedSearch.length > 0;
          const isDimmed = hasFocus && !isSelectedNode && !isSearchMatch;

          return (
            <g
              key={String(node.id)}
              onPointerDown={(event) => onNodePointerDown(event, node)}
              style={{ cursor: draggedId === node.id ? "grabbing" : "grab" }}
            >
              <GraphNodeGlyph
                node={node}
                isSelected={isSelectedNode}
                isSearchMatch={isSearchMatch}
                isDimmed={isDimmed}
                labelColorMap={labelColorMap}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type GraphSidePanelProps = {
  data: GraphResponse;
  nodes: SimNode[];
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  hasSearch: boolean;
  searchMatches: GraphResponse["nodes"];
  cypherQuery: string;
  cypherError: string | null;
  setCypherQuery: (value: string) => void;
  onRunQuery: () => void;
  onReset: () => void;
  resolvedLinks: ResolvedLink[];
  selected: SelectedEntity | null;
  setSelected: React.Dispatch<React.SetStateAction<SelectedEntity | null>>;
};

/**
 * Right-hand inspector for search, Cypher queries, and selected entity info.
 */
function GraphSidePanel({
  data,
  nodes,
  searchTerm,
  setSearchTerm,
  hasSearch,
  searchMatches,
  cypherQuery,
  cypherError,
  setCypherQuery,
  onRunQuery,
  onReset,
  resolvedLinks,
  selected,
  setSelected,
}: GraphSidePanelProps) {
  return (
    <div className="flex h-full w-80 shrink-0 flex-col space-y-3 overflow-y-auto rounded-md border bg-background p-3 text-xs">
      <div className="space-y-2">
        <h3 className="text-xs font-semibold">Search nodes</h3>
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search by id, label, or property..."
          className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {hasSearch && (
          <p className="text-[11px] text-muted-foreground">
            {searchMatches.length} match
            {searchMatches.length === 1 ? "" : "es"}
          </p>
        )}
        {hasSearch && searchMatches.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-auto">
            {searchMatches.map((node) => (
              <li
                key={String(node.id)}
                className="cursor-pointer truncate rounded px-1 py-0.5 hover:bg-muted"
                onClick={() => {
                  const match = nodes.find(
                    (n) => String(n.id) === String(node.id),
                  );
                  if (match) {
                    setSelected({ type: "node", node: match });
                  }
                }}
              >
                <span className="font-mono text-[11px]">{node.id}</span>
                {node.label && (
                  <span className="ml-1 text-muted-foreground">
                    ({node.label})
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t pt-2">
        <h3 className="text-xs font-semibold">Run Cypher query</h3>
        <textarea
          value={cypherQuery}
          onChange={(event) => setCypherQuery(event.target.value)}
          placeholder={
            "e.g. MATCH (n)-[r]->(m) WHERE n.name CONTAINS 'Alice' RETURN n,r,m LIMIT 100"
          }
          className="h-20 w-full resize-none rounded border bg-background px-2 py-1 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRunQuery}
            className="inline-flex flex-1 items-center justify-center rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Run query
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center justify-center rounded border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            Reset
          </button>
        </div>
        {cypherError && (
          <p className="text-[11px] text-destructive">{cypherError}</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          The query should return nodes and relationships (for example
          <code className="mx-1">RETURN n, r, m</code>) so they can be shown in the
          graph.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-medium">Summary</h2>
        <p className="text-muted-foreground">
          {data.nodes.length} nodes, {data.links.length} relationships
        </p>
        <p className="text-[11px] text-muted-foreground">
          Resolved edges in view: {resolvedLinks.length}
        </p>
      </div>

      <div className="space-y-1">
        <h3 className="text-xs font-semibold">Sample nodes</h3>
        <ul className="space-y-1">
          {data.nodes.slice(0, 5).map((node) => (
            <li key={String(node.id)} className="truncate">
              <span className="font-mono text-[11px]">{node.id}</span>
              {node.label && (
                <span className="ml-1 text-muted-foreground">
                  ({node.label})
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {selected && (
        <div className="space-y-1 border-t pt-2">
          <h3 className="text-xs font-semibold">
            {selected.type === "node" ? "Selected node" : "Selected relationship"}
          </h3>

          {selected.type === "node" ? (
            <div className="space-y-1">
              <p className="font-mono text-[11px] break-all">
                id: {String(selected.node.id)}
              </p>
              {selected.node.label && (
                <p className="text-[11px] text-muted-foreground">
                  label: {selected.node.label}
                </p>
              )}
              {selected.node.properties && (
                <div className="mt-1 max-h-40 overflow-auto rounded bg-muted/40 p-2">
                  <dl className="space-y-1 text-[11px]">
                    {Object.entries(selected.node.properties).map(
                      ([key, value]) => (
                        <div key={key} className="flex gap-1">
                          <dt className="min-w-[5rem] font-medium">{key}</dt>
                          <dd className="flex-1 break-all text-muted-foreground">
                            {String(value)}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="font-mono text-[11px] break-all">
                id: {String(selected.link.id)}
              </p>
              {selected.link.type && (
                <p className="text-[11px] text-muted-foreground">
                  type: {selected.link.type}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                from node {String(selected.source.id)} → to node
                {" "}
                {String(selected.target.id)}
              </p>
              {selected.link.properties && (
                <div className="mt-1 max-h-40 overflow-auto rounded bg-muted/40 p-2">
                  <dl className="space-y-1 text-[11px]">
                    {Object.entries(selected.link.properties).map(
                      ([key, value]) => (
                        <div key={key} className="flex gap-1">
                          <dt className="min-w-[5rem] font-medium">{key}</dt>
                          <dd className="flex-1 break-all text-muted-foreground">
                            {String(value)}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GraphView() {
  const {
    data,
    error,
    loading,
    cypherQuery,
    cypherError,
    setCypherQuery,
    loadDefaultGraph,
    runCypherQuery,
  } = useGraphData();

  const [searchTerm, setSearchTerm] = React.useState("");
  const [selected, setSelected] = React.useState<SelectedEntity | null>(null);

  const {
    nodes,
    svgRef,
    draggedId,
    handlePointerMove,
    handlePointerUp,
    handleNodePointerDown,
  } = useGraphSimulation(data, (node) => setSelected({ type: "node", node }));

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const hasSearch = normalizedSearch.length > 0;

  const handleRunCypherClick = React.useCallback(async () => {
    setSelected(null);
    await runCypherQuery();
  }, [runCypherQuery, setSelected]);

  const handleResetClick = React.useCallback(() => {
    setSelected(null);
    setCypherQuery("");
    void loadDefaultGraph();
  }, [loadDefaultGraph, setCypherQuery, setSelected]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading Neo4j knowledge graph...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm">
        <p className="font-medium text-destructive">
          Failed to load Neo4j knowledge graph
        </p>
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        No nodes found in the Neo4j knowledge graph.
      </div>
    );
  }

  if (!nodes.length) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        Initializing graph layout...
      </div>
    );
  }

  // Normalize all ids to strings when building the lookup map so that
  // `"1"` and `1` both resolve to the same node.
  const nodeMap = createNodeMap(nodes);

  // Pre-resolve links against the current node positions so we can both
  // render them efficiently and show how many are actually resolved.
  const resolvedLinks = resolveLinks(data, nodeMap);

  const labelColorMap = buildLabelColorMap(data);

  const searchMatches = data
    ? data.nodes
        .filter((node) => nodeMatchesSearchTerm(node, normalizedSearch))
        .slice(0, 20)
    : [];

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <m.div
          className="flex h-[calc(100dvh-4rem)] flex-col gap-4 px-2 py-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <m.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <h1 className="text-lg font-semibold">Knowledge Store</h1>
            <p className="text-sm text-muted-foreground">
              This view shows a subset of nodes and relationships from your
              Neo4j database.
            </p>
          </m.div>

          <m.div
            className="flex min-h-0 flex-1 gap-4"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.25, ease: "easeOut" }}
          >
            <GraphCanvas
              nodes={nodes}
              resolvedLinks={resolvedLinks}
              svgRef={svgRef}
              draggedId={draggedId}
              selected={selected}
              setSelected={setSelected}
              labelColorMap={labelColorMap}
              normalizedSearch={normalizedSearch}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onNodePointerDown={handleNodePointerDown}
            />

            <GraphSidePanel
              data={data}
              nodes={nodes}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              hasSearch={hasSearch}
              searchMatches={searchMatches}
              cypherQuery={cypherQuery}
              cypherError={cypherError}
              setCypherQuery={setCypherQuery}
              onRunQuery={handleRunCypherClick}
              onReset={handleResetClick}
              resolvedLinks={resolvedLinks}
              selected={selected}
              setSelected={setSelected}
            />
          </m.div>
        </m.div>
      </MotionConfig>
    </LazyMotion>
  );
}
