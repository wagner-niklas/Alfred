"use client";

import { useEffect, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

// Type definitions
type Node = {
  id: string;
  label: string;
  type: "Table" | "Column" | "Concept";
  description?: string | null;
  parentTable?: string;
  dataType?: string;
  sqlExpression?: string;
  conceptType?: string;
};

type Link = {
  source: string;
  target: string;
  type: "HAS_COLUMN" | "MAPS_TO_CONCEPT" | "FOREIGN_KEY";
};

type GraphData = {
  nodes: Node[];
  links: Link[];
};

// Constants for node styling
const NODE_COLORS: Record<string, string> = {
  Table: "#3b82f6",    // Blue
  Column: "#22c55e",   // Green
  Concept: "#a855f7",  // Purple
};

const NODE_SIZES: Record<string, number> = {
  Table: 12,
  Column: 6,
  Concept: 8,
};

// Constants for link styling
const LINK_COLORS: Record<string, string> = {
  HAS_COLUMN: "#94a3b8",
  MAPS_TO_CONCEPT: "#f59e0b",
  FOREIGN_KEY: "#ef4444",
};

const DEFAULT_NODE_COLOR = "#888888";
const HIGHLIGHT_COLOR = "#f59e0b";
const COOLDOWN_TICKS = 100;
const WARMUP_TICKS = 50;
const NODE_REL_SIZE = 3;
const LINK_WIDTH = 1.5;

interface GraphVisualizationProps {
  /** Array of column node IDs to highlight */
  highlightColumns?: string[];
  /** Optional trigger to refresh the graph (e.g., timestamp) */
  refreshTrigger?: number;
}

/**
 * Displays an interactive 2D force-directed graph visualization
 * of tables, columns, and concepts from the knowledge graph.
 */
export function GraphVisualization({ 
  highlightColumns = [], 
  refreshTrigger 
}: GraphVisualizationProps) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // Fetch graph data on mount or when refresh trigger changes
  useEffect(() => {
    const fetchGraphData = async () => {
      try {
        const response = await fetch("/api/graph");
        const result = await response.json();
        
        if (result.error) {
          setError(result.error);
        } else {
          setGraphData(result);
        }
        setIsLoading(false);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to fetch graph");
        setIsLoading(false);
      }
    };
    
    void fetchGraphData();
  }, [refreshTrigger]);

  /** Handle node click - show node details panel */
  const handleNodeClick = (node: Node) => {
    setSelectedNode(node);
  };

  /** Handle background click - deselect current node */
  const handleBackgroundClick = () => {
    setSelectedNode(null);
  };

  /** Get color for a node based on its type and highlight state */
  const getNodeColor = (node: Node): string => {
    if (highlightColumns.includes(node.id)) {
      return HIGHLIGHT_COLOR;
    }
    return NODE_COLORS[node.type] ?? DEFAULT_NODE_COLOR;
  };

  /** Get size for a node based on its type */
  const getNodeSize = (node: Node): number => {
    return NODE_SIZES[node.type] ?? 6;
  };

  /** Get color for a link based on its relationship type */
  const getLinkColor = (link: Link): string => {
    return LINK_COLORS[link.type] ?? "#cbd5e1";
  };


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading graph...</div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive">Error: {errorMessage}</div>
      </div>
    );
  }

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-center">
          No graph data available. The knowledge graph is empty.
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[500px] border rounded-lg overflow-hidden bg-card">
      <ForceGraph2D
        graphData={graphData}
        nodeId="id"
        nodeLabel={(node: Node) => `${node.label}\n(${node.type})`}
        nodeColor={getNodeColor}
        nodeRelSize={NODE_REL_SIZE}
        nodeVal={getNodeSize}
        linkSource="source"
        linkTarget="target"
        linkColor={getLinkColor}
        linkWidth={LINK_WIDTH}
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
        backgroundColor="transparent"
        enableNodeDrag={false}
        cooldownTicks={COOLDOWN_TICKS}
        warmupTicks={WARMUP_TICKS}
      />

      {/* Legend */}
      <div className="absolute top-2 left-2 bg-background/80 backdrop-blur-sm p-2 rounded-lg border text-xs">
        <div className="font-semibold mb-1">Legend</div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span>Table</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span>Column</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-purple-500" />
          <span>Concept</span>
        </div>
      </div>

      {/* Selected Node Info */}
      {selectedNode && (
        <div className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm p-3 rounded-lg border max-w-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">{selectedNode.label}</div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
          <div className="text-xs text-muted-foreground mb-1">
            Type: {selectedNode.type}
          </div>
          {selectedNode.description && (
            <div className="text-xs mb-1">
              <span className="text-muted-foreground">Description: </span>
              {selectedNode.description}
            </div>
          )}
          {selectedNode.dataType && (
            <div className="text-xs mb-1">
              <span className="text-muted-foreground">Data Type: </span>
              {selectedNode.dataType}
            </div>
          )}
          {selectedNode.sqlExpression && (
            <div className="text-xs mb-1">
              <span className="text-muted-foreground">SQL: </span>
              <code className="bg-muted px-1 rounded">{selectedNode.sqlExpression}</code>
            </div>
          )}
          {selectedNode.parentTable && (
            <div className="text-xs">
              <span className="text-muted-foreground">Parent Table: </span>
              {selectedNode.parentTable}
            </div>
          )}
        </div>
      )}

      {/* Stats - display counts of nodes and links */}
      <div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm p-2 rounded-lg border text-xs">
        <div>
          Nodes: {graphData.nodes.length} | Links: {graphData.links.length}
        </div>
      </div>
    </div>
  );
}
