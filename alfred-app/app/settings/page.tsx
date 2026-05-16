"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { SettingsResponse } from "@/lib/settings/types";
import { useSettings } from "@/lib/settings/hooks";
import { useSession } from "@/lib/auth-client";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Eye, EyeOff, Mail, Plus, Trash2, User } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSchema, Table, Column, Concept, ConceptColumn, ConceptType } from "@/hooks/use-schema";

const GraphVisualization = dynamic(
  () => import("@/components/alfred/graph-visualization").then((mod) => mod.GraphVisualization),
  { ssr: false, loading: () => <div className="text-sm text-muted-foreground">Loading graph...</div> }
);

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

// Local helper type used while editing settings client-side.
type DraftSettings = SettingsResponse | null;

// Always operate on a fully-populated SettingsResponse.
function ensureSettingsBase(
  current: DraftSettings,
  loaded: SettingsResponse | null,
): SettingsResponse {
  return {
    userId: current?.userId ?? loaded?.userId ?? "",
    additionalInstructions:
      current?.additionalInstructions ?? loaded?.additionalInstructions ?? null
  };
}

type TableInfo = {
  name: string;
  description: string | null;
};

type SchemaTables = Record<string, TableInfo[]>;

type CatalogResponse = {
  catalog: string;
  schemas: SchemaTables;
};

// Constants
const MAX_SELECTED_TABLES = 30;
const TRUNCATE_DESCRIPTION_LENGTH = 40;
const SIMILARITY_SCORE_THRESHOLD = 0.72;
const SIMILARITY_SCORE_EXACT_MATCH = 1;
const SIMILARITY_SCORE_PREFIX_MATCH = 0.96;
const SIMILARITY_SCORE_PARTIAL_MATCH = 0.9;
const COLUMN_SUGGESTIONS_MAX_COUNT = 8;
const BLUR_DELAY_MS = 120;
const TRANSITION_DURATION_MS = 250;

// Utility functions
/**
 * Truncates text to specified length with ellipsis.
 */
const truncate = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;

/**
 * Normalizes text for matching by converting to lowercase and replacing separators with spaces.
 */
const normalizeMatchText = (value: string) =>
  value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Calculates Levenshtein distance between two strings for fuzzy matching.
 */
const levenshteinDistance = (left: string, right: string) => {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  const current = new Array(right.length + 1);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j++) previous[j] = current[j];
  }
  return previous[right.length];
};

/**
 * Calculates similarity score between two strings (0-1).
 */
const similarity = (left: string, right: string) => {
  const max = Math.max(left.length, right.length);
  return max === 0 ? SIMILARITY_SCORE_EXACT_MATCH : SIMILARITY_SCORE_EXACT_MATCH - levenshteinDistance(left, right) / max;
};

/**
 * Escapes special regex characters in a string.
 */
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Checks if a SQL expression references a specific table column.
 */
const expressionReferencesColumn = (expression: string, table: string, column: string) => {
  const colPattern = escapeRegExp(column);
  const tblPattern = escapeRegExp(table);
  const quotedPattern = `["'\`]${colPattern}["'\`]`;
  const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])(?:${tblPattern}\\.)?(?:${colPattern}|${quotedPattern})(?=$|[^a-zA-Z0-9_])`, "i");
  return regex.test(expression);
};

/**
 * Creates a regex to find all references to a column in an expression.
 */
const createColumnReferenceRegex = (table: string, column: string) => {
  const colPattern = escapeRegExp(column);
  const tblPattern = escapeRegExp(table);
  const quotedPattern = `["'\`]${colPattern}["'\`]`;
  return new RegExp(`((?:${tblPattern}\\.)?(?:${colPattern}|${quotedPattern}))`, "gi");
};

/**
 * Splits an expression into highlighted and non-highlighted parts based on column matches.
 */
const splitExpressionIntoHighlightedParts = (expression: string, columns: ConceptColumn[]) => {
  const ranges = columns.flatMap((col) => {
    const matches = Array.from(expression.matchAll(createColumnReferenceRegex(col.table, col.column)));
    return matches.map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  });

  const mergedRanges = mergeOverlappingRanges(ranges);

  const parts: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  for (const range of mergedRanges) {
    if (range.start > cursor) parts.push({ text: expression.slice(cursor, range.start), highlighted: false });
    parts.push({ text: expression.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < expression.length) parts.push({ text: expression.slice(cursor), highlighted: false });
  return parts.length > 0 ? parts : [{ text: expression, highlighted: false }];
};

/**
 * Merges overlapping or adjacent ranges into a single set of ranges.
 */
const mergeOverlappingRanges = (ranges: Array<{ start: number; end: number }>) => {
  return ranges
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .reduce<Array<{ start: number; end: number }>>((acc, range) => {
      const prev = acc[acc.length - 1];
      if (!prev || range.start > prev.end) acc.push(range);
      else prev.end = Math.max(prev.end, range.end);
      return acc;
    }, []);
};

/**
 * Extracts the token at the cursor position in a string.
 */
const getTokenAtCursor = (value: string, cursor: number) => {
  let start = cursor, end = cursor;
  while (start > 0 && /[a-zA-Z0-9_]/.test(value[start - 1])) start--;
  while (end < value.length && /[a-zA-Z0-9_]/.test(value[end])) end++;
  return { start, end, token: value.slice(start, end) };
};

/**
 * Calculates the pixel position of the caret in a textarea for positioning suggestions popup.
 */
const getCaretPixelPosition = (textarea: HTMLTextAreaElement, cursor: number): { top: number; left: number } => {
  const computedStyle = window.getComputedStyle(textarea);
  const mirror = createTextareaMirror(textarea, computedStyle);
  const marker = createCaretMarker(textarea, cursor);
  
  mirror.appendChild(document.createTextNode(textarea.value.slice(0, cursor)));
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  
  const position = { 
    top: marker.offsetTop - textarea.scrollTop + 24, 
    left: marker.offsetLeft - textarea.scrollLeft 
  };
  
  document.body.removeChild(mirror);
  return position;
};

/**
 * Creates a mirror div to calculate textarea caret position.
 */
const createTextareaMirror = (textarea: HTMLTextAreaElement, computedStyle: CSSStyleDeclaration) => {
  const mirror = document.createElement("div");
  mirror.style.cssText = "position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;top:0;left:-9999px;width:" + textarea.clientWidth + "px";
  [
    "borderLeftWidth", "borderTopWidth", "boxSizing", "fontFamily", 
    "fontSize", "fontWeight", "letterSpacing", "lineHeight", 
    "paddingBottom", "paddingLeft", "paddingRight", "paddingTop"
  ].forEach((prop) => {
    mirror.style.setProperty(prop, computedStyle.getPropertyValue(prop));
  });
  return mirror;
};

/**
 * Creates a marker span for caret position calculation.
 */
const createCaretMarker = (textarea: HTMLTextAreaElement, cursor: number) => {
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(cursor, cursor + 1) || ".";
  return marker;
};

/**
 * Renders a column name with the matching token highlighted.
 */
const renderHighlightedColumnMatch = (column: string, token: string) => {
  const matchIndex = column.toLowerCase().indexOf(token.toLowerCase());
  if (matchIndex === -1) return column;
  
  return (
    <>
      {column.slice(0, matchIndex)}
      <span className="rounded bg-muted px-0.5">{column.slice(matchIndex, matchIndex + token.length)}</span>
      {column.slice(matchIndex + token.length)}
    </>
  );
};

function EntityDetailView({
  title,
  description,
  onDescriptionChange,
  onSave,
  saving,
  saved,
  children,
}: {
  title: string;
  description: string;
  onDescriptionChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Label htmlFor="entity-description">Description</Label>
        <Textarea
          id="entity-description"
          placeholder="Enter a description..."
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="min-h-[160px] resize-y"
        />
        <Button onClick={onSave} disabled={saving} size="sm">
          {saving ? "Saving..." : "Save Description"}
        </Button>
        {saved && <p className="text-sm text-green-600">Description saved!</p>}
      </div>
      {children}
    </div>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const userIdFromQuery = searchParams?.get("user_id")?.trim() || null;
  const { data, loading, saving, error, saved, update, save } = useSettings();
  const session = useSession();
  const loggedInUser = session.data?.user;
  const loggedInUserName = loggedInUser?.name?.trim() || "Signed in user";
  const loggedInUserEmail = loggedInUser?.email?.trim() || null;
  const { tables, concepts, loading: schemaLoading, error: schemaError, updateTableDescription, updateColumnDescription, toggleColumnHidden, createConcept, updateConcept, deleteConcept, deleteTable, refresh } = useSchema();
  const [deletingAll, setDeletingAll] = useState(false);
  const [resettingDb, setResettingDb] = useState(false);
  
  // Settings from settings-sheet
  const [deletingTableName, setDeletingTableName] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [view, setView] = useState<"tables" | "table" | "column">("tables");
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<Column | null>(null);
  const [tableDescription, setTableDescription] = useState("");
  const [columnDescription, setColumnDescription] = useState("");
  const [columnSynonyms, setColumnSynonyms] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);
  const [descriptionSaved, setDescriptionSaved] = useState(false);
  const [conceptDialogOpen, setConceptDialogOpen] = useState(false);
  const [editingConceptName, setEditingConceptName] = useState<string | null>(null);
  const [conceptName, setConceptName] = useState("");
  const [conceptType, setConceptType] = useState<ConceptType>("Dimension");
  const [conceptSqlExpression, setConceptSqlExpression] = useState("");
  const [conceptSynonyms, setConceptSynonyms] = useState("");
  const [savingConcept, setSavingConcept] = useState(false);
  const [deletingConceptName, setDeletingConceptName] = useState<string | null>(null);
  const [conceptError, setConceptError] = useState<string | null>(null);
  const [conceptCursor, setConceptCursor] = useState(0);
  const [conceptCaretPosition, setConceptCaretPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [conceptExpressionFocused, setConceptExpressionFocused] = useState(false);
  const [conceptSqlExpressionRef, setConceptSqlExpressionRef] = useState<HTMLTextAreaElement | null>(null);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);

  // Table selection dialog state
  const [showTableSelector, setShowTableSelector] = useState(false);
  const [catalogData, setCatalogData] = useState<CatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const withBase = (current: DraftSettings): SettingsResponse =>
    ensureSettingsBase(current, data ?? null);

  // Get the current token at cursor position for autocomplete suggestions
  const cursorToken = useMemo(() => getTokenAtCursor(conceptSqlExpression, conceptCursor).token, [conceptSqlExpression, conceptCursor]);

  // Find all columns referenced in the SQL expression
  const allColumnMatches = useMemo(() => {
    return tables.flatMap((table) =>
      table.columns.map((col) => ({
        table: table.name,
        column: col.name,
        data_type: col.data_type,
        score: expressionReferencesColumn(conceptSqlExpression, table.name, col.name) ? SIMILARITY_SCORE_EXACT_MATCH : 0,
      }))
    ).filter((match) => match.score > 0).sort((a, b) => b.score - a.score);
  }, [conceptSqlExpression, tables]);

  // Generate column autocomplete suggestions based on cursor token
  const columnSuggestions = useMemo(() => {
    const token = normalizeMatchText(cursorToken);
    if (!token) return [];
    
    return tables.flatMap((table) =>
      table.columns.map((col) => {
        const normalizedColumn = normalizeMatchText(col.name);
        const normalizedTableColumn = normalizeMatchText(`${table.name} ${col.name}`);
        
        let score: number;
        if (normalizedColumn === token) {
          score = SIMILARITY_SCORE_EXACT_MATCH;
        } else if (normalizedColumn.startsWith(token)) {
          score = SIMILARITY_SCORE_PREFIX_MATCH;
        } else if (normalizedColumn.includes(token) || normalizedTableColumn.includes(token)) {
          score = SIMILARITY_SCORE_PARTIAL_MATCH;
        } else {
          score = similarity(token, normalizedColumn);
        }
        
        return { table: table.name, column: col.name, data_type: col.data_type, score };
      })
    ).filter((match) => match.score >= SIMILARITY_SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, COLUMN_SUGGESTIONS_MAX_COUNT);
  }, [cursorToken, tables]);

  const matchedConceptColumns = useMemo(() => allColumnMatches.map((match) => ({ table: match.table, column: match.column })), [allColumnMatches]);
  const highlightedSqlExpression = useMemo(() => splitExpressionIntoHighlightedParts(conceptSqlExpression, matchedConceptColumns), [conceptSqlExpression, matchedConceptColumns]);

  // Sync selectedTable with tables when schema reloads
  useEffect(() => {
    if (selectedTable && tables.length > 0) {
      const updated = tables.find((t) => t.name === selectedTable.name);
      if (updated) setSelectedTable(updated);
    }
  }, [tables, selectedTable]);

  // Sync instructions from settings data
  useEffect(() => { 
    if (data?.additionalInstructions !== undefined) {
      setInstructions(data.additionalInstructions ?? ""); 
    }
  }, [data]);
  
  // Sync table description when table is selected
  useEffect(() => { 
    if (selectedTable) {
      setTableDescription(selectedTable.description ?? ""); 
    }
  }, [selectedTable]);
  
  // Sync column description and synonyms when column is selected
  useEffect(() => {
    if (selectedColumn) {
      setColumnDescription(selectedColumn.description ?? "");
      setColumnSynonyms(Array.isArray(selectedColumn.synonyms) ? selectedColumn.synonyms.join(", ") : "");
    }
  }, [selectedColumn]);

  /** Save custom instructions to settings */
  const handleSaveInstructions = () => { 
    void save({ additionalInstructions: instructions || null }); 
  };

  /** Save table description to the database */
  const handleSaveTableDescription = async () => {
    if (!selectedTable) return;
    setSavingDescription(true);
    setDescriptionSaved(false);
    const success = await updateTableDescription(selectedTable.name, tableDescription);
    setSavingDescription(false);
    if (success) {
      setDescriptionSaved(true);
      setSelectedTable((prev) => prev ? { ...prev, description: tableDescription || null } : null);
    }
  };

  /** Save column description and synonyms to the database */
  const handleSaveColumnDescription = async () => {
    if (!selectedTable || !selectedColumn) return;
    setSavingDescription(true);
    setDescriptionSaved(false);
    const success = await updateColumnDescription(selectedTable.name, selectedColumn.name, columnDescription, columnSynonyms);
    setSavingDescription(false);
    if (success) {
      setDescriptionSaved(true);
      const synonymsArray = columnSynonyms.split(",").map((synonym) => synonym.trim()).filter(Boolean);
      setSelectedColumn((prev) => prev ? { ...prev, description: columnDescription || null, synonyms: synonymsArray } : null);
    }
  };

  /** Toggle column visibility in the graph */
  const handleToggleColumnHidden = async (column: Column) => {
    if (!selectedTable) return;
    const success = await toggleColumnHidden(selectedTable.name, column.name, !column.hidden);
    if (success && selectedColumn?.name === column.name) {
      setSelectedColumn((prev) => prev ? { ...prev, hidden: !column.hidden } : null);
    }
  };

  /** Handle table selection from the list */
  const handleSelectTable = (table: Table) => { 
    setSelectedTable(table); 
    setView("table"); 
    setDescriptionSaved(false); 
  };
  
  /** Handle column selection from the list */
  const handleSelectColumn = (column: Column) => { 
    setSelectedColumn(column); 
    setColumnDialogOpen(true); 
  };
  
  /** Handle column dialog open/close */
  const handleColumnDialogOpenChange = (nextOpen: boolean) => {
    setColumnDialogOpen(nextOpen);
    if (!nextOpen) { 
      setSelectedColumn(null); 
    }
  };

  /** Navigate back to parent view in the hierarchy */
  const handleBack = () => {
    if (view === "column") { 
      setView("table"); 
      setSelectedColumn(null); 
    } else if (view === "table") { 
      setView("tables"); 
      setSelectedTable(null); 
    }
    setDescriptionSaved(false);
  };

  /** Reset all concept form fields to default state */
  const resetConceptForm = () => {
    setEditingConceptName(null); 
    setConceptName(""); 
    setConceptType("Dimension");
    setConceptSqlExpression(""); 
    setConceptSynonyms(""); 
    setSavingConcept(false); 
    setConceptError(null);
  };

  /** Handle concept dialog open/close */
  const handleConceptDialogOpenChange = (nextOpen: boolean) => {
    setConceptDialogOpen(nextOpen);
    if (!nextOpen) resetConceptForm();
  };

  /** Open dialog to add a new concept */
  const handleAddConcept = () => { 
    resetConceptForm(); 
    setConceptDialogOpen(true); 
  };

  /** Populate form to edit an existing concept */
  const handleEditConcept = (concept: Concept) => {
    setEditingConceptName(concept.name); 
    setConceptName(concept.name); 
    setConceptType(concept.type);
    setConceptSqlExpression(concept.sql_expression ?? ""); 
    setConceptSynonyms(concept.synonyms.join(", "));
    setSavingConcept(false); 
    setConceptError(null); 
    setConceptDialogOpen(true);
  };

  /** Update cursor position and caret coordinates for autocomplete positioning */
  const updateConceptCursor = () => {
    const textarea = conceptSqlExpressionRef;
    if (!textarea) return;
    const cursor = textarea.selectionStart ?? 0;
    setConceptCursor(cursor);
    setConceptCaretPosition(getCaretPixelPosition(textarea, cursor));
  };

  /** Insert a column reference at the cursor position in the SQL expression */
  const handleInsertConceptColumn = (column: string) => {
    const textarea = conceptSqlExpressionRef;
    const start = textarea?.selectionStart ?? conceptSqlExpression.length;
    const end = textarea?.selectionEnd ?? start;
    const tokenRange = getTokenAtCursor(conceptSqlExpression, start);
    const insertStart = start === end ? tokenRange.start : start;
    const insertEnd = start === end ? tokenRange.end : end;

    setConceptSqlExpression((current) => `${current.slice(0, insertStart)}${column}${current.slice(insertEnd)}`);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      const newPosition = insertStart + column.length;
      textarea?.setSelectionRange(newPosition, newPosition);
      updateConceptCursor();
    });
  };

  /** Validate and save concept to the database */
  const handleSaveConcept = async () => {
    const name = conceptName.trim();
    if (!name) { 
      setConceptError("Name is required."); 
      return; 
    }
    if (!conceptSqlExpression.trim()) { 
      setConceptError("SQL expression is required."); 
      return; 
    }
    if (matchedConceptColumns.length === 0) { 
      setConceptError("Use at least one matching column in the expression."); 
      return; 
    }

    setSavingConcept(true);
    setConceptError(null);

    const payload = {
      name,
      type: conceptType,
      sql_expression: conceptSqlExpression,
      synonyms: conceptSynonyms.split(",").map((synonym) => synonym.trim()).filter(Boolean),
      columns: matchedConceptColumns,
    };

    const success = editingConceptName 
      ? await updateConcept({ originalName: editingConceptName, ...payload }) 
      : await createConcept(payload);
    setSavingConcept(false);

    if (success) { 
      setConceptDialogOpen(false); 
      resetConceptForm(); 
    } else {
      setConceptError("Failed to save concept.");
    }
  };

  /** Delete a concept after user confirmation */
  const handleDeleteConcept = async (concept: Concept) => {
    if (!window.confirm(`Delete concept "${concept.name}"?`)) return;
    setDeletingConceptName(concept.name);
    const success = await deleteConcept(concept.name);
    setDeletingConceptName(null);
    if (!success) setConceptError("Failed to delete concept.");
  };

  /** Delete a table and all its columns after user confirmation */
  const handleDeleteTable = async (table: Table) => {
    if (!window.confirm(`Delete table "${table.name}" and all its columns?`)) return;
    setDeletingTableName(table.name);
    const success = await deleteTable(table.name);
    setDeletingTableName(null);
    if (!success) alert("Failed to delete table.");
  };


  /** Render the list of tables with descriptions and delete buttons */
  const renderTableList = () => (
    tables.length === 0 ? (
      <p className="text-sm text-muted-foreground">No tables available.</p>
    ) : (
      <div className="space-y-1">
        {tables.map((table) => (
          <div key={table.name} className="flex items-center px-3 py-2 text-sm rounded-md border bg-background">
            <button onClick={() => handleSelectTable(table)} className="flex flex-col items-start gap-0.5 flex-1 text-left hover:text-foreground transition-colors">
              <span className="font-medium text-sm truncate">{table.name}</span>
              {table.description && (
                <span className="text-xs text-muted-foreground truncate">
                  {truncate(table.description, TRUNCATE_DESCRIPTION_LENGTH)}
                </span>
              )}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteTable(table); }}
              disabled={deletingTableName === table.name}
              className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
              title="Delete table"
            >
              {deletingTableName === table.name ? (
                <span className="h-4 w-4 inline-block">...</span>
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          </div>
        ))}
      </div>
    )
  );

  /** Render the list of columns with visibility toggle */
  const renderColumnList = () => (
    <div className="space-y-1">
      {selectedTable?.columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No columns</p>
      ) : (
        selectedTable?.columns.map((column) => (
          <div 
            key={column.name} 
            className={`flex items-center justify-between px-3 py-2 text-sm rounded-md border ${column.hidden ? "bg-muted/50 opacity-60" : "bg-background"}`}
          >
            <button onClick={() => handleSelectColumn(column)} className="flex flex-col items-start gap-0.5 flex-1 text-left hover:text-foreground transition-colors">
              <span className="truncate">{truncate(column.name, TRUNCATE_DESCRIPTION_LENGTH)}</span>
              {(column.description || column.data_type) && (
                <span className="text-xs text-muted-foreground truncate">
                  {column.description ? truncate(column.description, TRUNCATE_DESCRIPTION_LENGTH) : column.data_type}
                </span>
              )}
            </button>
            <button 
              onClick={() => handleToggleColumnHidden(column)} 
              className={`p-1 rounded hover:bg-muted transition-colors ${column.hidden ? "text-muted-foreground" : "text-foreground"}`} 
              title={column.hidden ? "Show in graph" : "Hide from graph"}
            >
              {column.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        ))
      )}
    </div>
  );

  const handleDeleteAllData = async () => {
    const confirmed = window.confirm(
      "Delete your account, sessions, chats, and settings? This cannot be undone.",
    );

    if (!confirmed) return;

    setDeletingAll(true);

    try {
      const res = await fetch("/api/user/delete", { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`Failed to delete account: ${res.status}`);
      }
      router.replace("/login");
      router.refresh();
    } catch (err) {
      console.error(err);
      alert(
        err instanceof Error
          ? err.message
          : "Failed to delete your account.",
      );
    } finally {
      setDeletingAll(false);
    }
  };

  const openTableSelector = async () => {
    setShowTableSelector(true);
    setCatalogLoading(true);
    setCatalogError(null);
    setSelectedTables(new Set());
    setSearchQuery("");

    try {
      const res = await fetch("/api/schema/catalog");
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch tables: ${res.status}`);
      }
      const data = await res.json();
      setCatalogData(data);
    } catch (err) {
      console.error(err);
      setCatalogError(err instanceof Error ? err.message : "Failed to fetch tables");
    } finally {
      setCatalogLoading(false);
    }
  };

  const toggleTable = (tableKey: string) => {
    setSelectedTables((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(tableKey)) {
        newSet.delete(tableKey);
      } else if (newSet.size < MAX_SELECTED_TABLES) {
        newSet.add(tableKey);
      }
      return newSet;
    });
  };

  const toggleSchema = (schemaName: string) => {
    setSelectedTables((prev) => {
      const newSet = new Set(prev);
      const tablesInSchema = catalogData?.schemas[schemaName] || [];
      
      // Check if all tables in schema are selected
      const allSelected = tablesInSchema.every(
        (t) => newSet.has(`${schemaName}.${t.name}`)
      );

      if (allSelected) {
        // Deselect all tables in schema
        tablesInSchema.forEach((t) => newSet.delete(`${schemaName}.${t.name}`));
      } else {
        // Select all tables in schema (up to limit)
        tablesInSchema.forEach((t) => {
          if (newSet.size < MAX_SELECTED_TABLES) {
            newSet.add(`${schemaName}.${t.name}`);
          }
        });
      }
      return newSet;
    });
  };

  /** Reset the knowledge graph database with selected tables */
  const handleResetDatabase = async () => {
    setResettingDb(true);

    try {
      const response = await fetch("/api/schema/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tables: Array.from(selectedTables) }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to reset database: ${response.status}`);
      }
      
      const result = await response.json();
      
      // Refresh the schema data and graph after reset
      await refresh();
      setGraphRefreshKey((previousKey) => previousKey + 1);
      
      setShowTableSelector(false);
      alert(
        `Knowledge graph database has been reset successfully.\n\n` +
        `Tables created: ${result.tablesCreated}\n` +
        `Columns created: ${result.columnsCreated}`
      );
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to reset database.",
      );
    } finally {
      setResettingDb(false);
    }
  };

  // Filter schemas and tables based on search query
  const filteredSchemas = useMemo(() => {
    if (!catalogData?.schemas) return {};
    
    return Object.entries(catalogData.schemas).reduce((acc, [schemaName, tables]) => {
      const filteredTables = tables.filter(
        (table) =>
          table.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          table.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      if (filteredTables.length > 0) {
        acc[schemaName] = filteredTables;
      }
      return acc;
    }, {} as SchemaTables);
  }, [catalogData?.schemas, searchQuery]);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="container mx-auto max-w-4xl py-8 space-y-6">
          <h1 className="text-2xl font-semibold">Settings</h1>

          <Tabs defaultValue="general" className="space-y-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="data">Data</TabsTrigger>
              <TabsTrigger value="concepts">Concepts</TabsTrigger>
              <TabsTrigger value="instructions">Instructions</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4">
              <div className="flex flex-col gap-4 border-t pt-6 mt-4">
                <div className="rounded-md border bg-background px-3 py-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">Account</h3>
                      <p className="text-xs text-muted-foreground">
                        Current Better Auth session.
                      </p>
                    </div>
                    {session.isPending && (
                      <span className="text-xs text-muted-foreground">Loading...</span>
                    )}
                  </div>
                  {loggedInUser ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Name</p>
                          <p className="truncate text-sm font-medium">{loggedInUserName}</p>
                        </div>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Email</p>
                          <p className="truncate text-sm font-medium">
                            {loggedInUserEmail ?? "(not set)"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    !session.isPending && (
                      <p className="text-sm text-muted-foreground">
                        You are not signed in.
                      </p>
                    )
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-4">
                    {!saving && !loading && (
                      <p className="text-sm text-muted-foreground">
                        Settings are stored locally in the Alfred SQLite database for
                        your logged-in account.
                      </p>
                    )}
                  </div>
                  {!loading && (
                    <p className="text-xs font-mono">
                      Current user id: {data?.userId || "(not set)"}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-md border border-destructive/20 bg-destructive/5 px-3 py-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-destructive">
                      Delete all my data
                    </p>
                    <p className="text-xs text-destructive/80">
                      Permanently remove all chats and settings linked to this browser's
                      user id, then delete your login account and sign out. This action cannot be undone.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteAllData}
                    disabled={deletingAll || saving || loading}
                  >
                    {deletingAll ? "Deleting…" : "Delete everything"}
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-md border border-warning/20 bg-warning/5 px-3 py-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-warning">
                      Reset knowledge graph database
                    </p>
                    <p className="text-xs text-warning/80">
                      Delete all table and column nodes from the knowledge graph and
                      recreate them from the Databricks schema. Select which tables to
                      include (max {MAX_SELECTED_TABLES} tables).
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={openTableSelector}
                    disabled={resettingDb || saving || loading}
                  >
                    Select tables
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="data" className="space-y-4">
              {/* Graph Visualization */}
              <div>
                <h3 className="text-sm font-medium mb-2">Knowledge Graph Visualization</h3>
                <GraphVisualization refreshTrigger={graphRefreshKey} />
              </div>

              {/* Table and Column Management */}
              <div className="border-t pt-4">
                {view === "tables" && (
                  <div>
                    <h3 className="text-sm font-medium">Manage Tables & Columns</h3>
                    <p className="text-xs text-muted-foreground">Available tables and columns.</p>
                  </div>
                )}
                {schemaLoading ? (
                  <p className="text-sm text-muted-foreground">Loading schema...</p>
                ) : schemaError ? (
                  <p className="text-sm text-destructive">{schemaError}</p>
                ) : view === "table" && selectedTable ? (
                  <>
                    <button onClick={handleBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
                      <ArrowLeft className="h-4 w-4" /> Back to tables
                    </button>
                    <EntityDetailView
                      title={selectedTable.name}
                      description={tableDescription}
                      onDescriptionChange={(value) => { setTableDescription(value); setDescriptionSaved(false); }}
                      onSave={handleSaveTableDescription}
                      saving={savingDescription}
                      saved={descriptionSaved}
                    >
                      <div className="space-y-2">
                        <Label>Columns</Label>
                        {renderColumnList()}
                      </div>
                    </EntityDetailView>
                  </>
                ) : view === "tables" ? (
                  renderTableList()
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="concepts" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Concepts</h3>
                  <p className="text-xs text-muted-foreground">Define business concepts as SQL expressions.</p>
                </div>
                    <Button size="sm" onClick={handleAddConcept} className="shrink-0">
                      <Plus className="h-4 w-4" /> Add
                    </Button>
              </div>
              {schemaLoading ? (
                <p className="text-sm text-muted-foreground">Loading concepts...</p>
              ) : schemaError ? (
                <p className="text-sm text-destructive">{schemaError}</p>
              ) : concepts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No concepts found.</p>
              ) : (
                <div className="space-y-2">
                  {concepts.map((concept) => (
                    <div key={concept.name} className="rounded-md border bg-background px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => handleEditConcept(concept)} className="flex flex-col gap-1 flex-1 text-left hover:opacity-80 transition-opacity">
                          <span className="text-sm font-medium">{concept.name}</span>
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground w-fit">{concept.type}</span>
                        </button>
                        <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); handleDeleteConcept(concept); }} disabled={deletingConceptName === concept.name} className="shrink-0">
                          {deletingConceptName === concept.name ? <span className="h-4 w-4">...</span> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                      {concept.synonyms.length > 0 && <p className="mt-1 truncate text-xs text-muted-foreground">Synonyms: {concept.synonyms.join(", ")}</p>}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="instructions" className="space-y-4">
              <div>
                <h3 className="text-sm font-medium">Instructions</h3>
                <p className="text-xs text-muted-foreground">Adapt the assistant's behavior with custom instructions.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="additional-instructions">User-specific Instructions</Label>
                  <Textarea 
                    id="additional-instructions" 
                    placeholder="Enter any additional instructions for the assistant ..." 
                    value={instructions} 
                    onChange={(e) => setInstructions(e.target.value)} 
                    className="min-h-[60vh] text-xs resize-y" 
                  />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {saved && <p className="text-sm text-green-600">Settings saved successfully!</p>}
              <Button onClick={handleSaveInstructions} disabled={saving || loading}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Table Selection Dialog */}
      <Dialog open={showTableSelector} onOpenChange={setShowTableSelector}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Select Tables for Knowledge Graph</DialogTitle>
            <DialogDescription>
              Choose up to {MAX_SELECTED_TABLES} tables to include in the knowledge graph.
              Tables are grouped by schema.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
            <div className="flex items-center gap-2 shrink-0">
              <Input
                placeholder="Search tables..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <div className="text-sm text-muted-foreground whitespace-nowrap">
                {selectedTables.size} / {MAX_SELECTED_TABLES} selected
              </div>
            </div>

            {catalogLoading && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Loading tables...</p>
              </div>
            )}

            {catalogError && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-destructive">{catalogError}</p>
              </div>
            )}

            {!catalogLoading && !catalogError && filteredSchemas && (
              <div className="flex-1 min-h-0 overflow-y-auto rounded-md border">
                <div className="p-4 space-y-4">
                  {Object.entries(filteredSchemas).map(([schemaName, tables]) => {
                    const allSelected = tables.every(
                      (t) => selectedTables.has(`${schemaName}.${t.name}`)
                    );
                    const someSelected = tables.some(
                      (t) => selectedTables.has(`${schemaName}.${t.name}`)
                    );

                    return (
                      <div key={schemaName} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`schema-${schemaName}`}
                            checked={allSelected}
                            ref={(el: HTMLButtonElement | null) => {
                              if (el) {
                                (el as unknown as { indeterminate: boolean }).indeterminate = someSelected && !allSelected;
                              }
                            }}
                            onCheckedChange={() => toggleSchema(schemaName)}
                            disabled={
                              selectedTables.size >= MAX_SELECTED_TABLES && !allSelected
                            }
                          />
                          <Label
                            htmlFor={`schema-${schemaName}`}
                            className="font-semibold cursor-pointer"
                          >
                            {schemaName}
                          </Label>
                          <span className="text-xs text-muted-foreground">
                            ({tables.length} tables)
                          </span>
                        </div>
                        <div className="ml-6 space-y-1">
                          {tables.map((table) => {
                            const tableKey = `${schemaName}.${table.name}`;
                            const isSelected = selectedTables.has(tableKey);
                            const isDisabled =
                              !isSelected && selectedTables.size >= MAX_SELECTED_TABLES;

                            return (
                              <div
                                key={tableKey}
                                className="flex items-center gap-2"
                              >
                                <Checkbox
                                  id={`table-${tableKey}`}
                                  checked={isSelected}
                                  onCheckedChange={() => toggleTable(tableKey)}
                                  disabled={isDisabled}
                                />
                                <Label
                                  htmlFor={`table-${tableKey}`}
                                  className="text-sm cursor-pointer flex-1"
                                >
                                  {table.name}
                                </Label>
                                {table.description && (
                                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                                    {table.description}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0">
            <Button
              variant="outline"
              onClick={() => setShowTableSelector(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleResetDatabase}
              disabled={resettingDb || selectedTables.size === 0}
            >
              {resettingDb ? "Resetting..." : `Reset with ${selectedTables.size} tables`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Concept Dialog */}
      <Dialog open={conceptDialogOpen} onOpenChange={handleConceptDialogOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingConceptName ? "Edit concept" : "Add concept"}</DialogTitle>
            <DialogDescription>Connect a concept to one or more database columns.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="concept-name">Name</Label>
              <Input id="concept-name" value={conceptName} onChange={(e) => setConceptName(e.target.value)} placeholder="Revenue" />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={conceptType} onValueChange={(v) => setConceptType(v as ConceptType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Filter">Filter</SelectItem>
                  <SelectItem value="Measure">Measure</SelectItem>
                  <SelectItem value="Dimension">Dimension</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="concept-sql-expression">SQL expression</Label>
                  <div className="relative">
                    {/* Mirror div for syntax highlighting overlay */}
                    <div 
                      aria-hidden="true" 
                      className="pointer-events-none absolute inset-0 min-h-[110px] whitespace-pre-wrap break-words rounded-md border border-transparent px-3 py-2 font-mono text-sm text-transparent"
                    >
                      {highlightedSqlExpression.map((part, index) => (
                        <span key={index} className={part.highlighted ? "rounded bg-muted" : ""}>
                          {part.text || " "}
                        </span>
                      ))}
                    </div>
                    <Textarea
                      id="concept-sql-expression"
                      ref={setConceptSqlExpressionRef}
                      value={conceptSqlExpression}
                      onChange={(e) => { 
                        setConceptSqlExpression(e.target.value); 
                        window.requestAnimationFrame(updateConceptCursor); 
                      }}
                      onClick={updateConceptCursor}
                      onKeyUp={updateConceptCursor}
                      onFocus={() => { 
                        setConceptExpressionFocused(true); 
                        window.requestAnimationFrame(updateConceptCursor); 
                      }}
                      onBlur={() => window.setTimeout(() => setConceptExpressionFocused(false), BLUR_DELAY_MS)}
                      onScroll={updateConceptCursor}
                      placeholder="sum(net_revenue)"
                      className="relative min-h-[110px] resize-none bg-transparent font-mono text-sm"
                    />
                    {/* Column autocomplete suggestions popup */}
                    {conceptExpressionFocused && columnSuggestions.length > 0 && (
                      <div 
                        className="absolute z-50 w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md" 
                        style={{ left: Math.min(conceptCaretPosition.left, 120), top: conceptCaretPosition.top }}
                      >
                        {columnSuggestions.map((suggestion) => (
                          <button 
                            key={`${suggestion.table}.${suggestion.column}`} 
                            type="button" 
                            onMouseDown={(e) => e.preventDefault()} 
                            onClick={() => handleInsertConceptColumn(suggestion.column)} 
                            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {renderHighlightedColumnMatch(suggestion.column, cursorToken)}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">{suggestion.table}</span>
                            </span>
                            {suggestion.data_type && (
                              <span className="shrink-0 font-mono text-xs text-muted-foreground">{suggestion.data_type}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="concept-synonyms">Synonyms</Label>
              <Input id="concept-synonyms" value={conceptSynonyms} onChange={(e) => setConceptSynonyms(e.target.value)} placeholder="sales, turnover, net sales" />
              <p className="text-xs text-muted-foreground">Separate synonyms with commas.</p>
            </div>
            {conceptError && <p className="text-sm text-destructive">{conceptError}</p>}
          </div>
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">Relationships from expression</p>
            {matchedConceptColumns.length > 0 ? (
              <div className="flex flex-wrap gap-2 overflow-x-auto min-h-[80px]">
                {matchedConceptColumns.map((col) => (
                  <span key={`${col.table}.${col.column}`} className="inline-flex max-w-full rounded-md bg-background px-2 py-1 text-xs text-foreground">
                    <span className="truncate">{col.table}.{col.column}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No column nodes matched yet.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleConceptDialogOpenChange(false)} disabled={savingConcept}>Cancel</Button>
            <Button onClick={handleSaveConcept} disabled={savingConcept}>{savingConcept ? "Saving..." : editingConceptName ? "Update concept" : "Save concept"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Column Dialog */}
      <Dialog open={columnDialogOpen} onOpenChange={handleColumnDialogOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedColumn?.name}</DialogTitle>
            <DialogDescription>View and edit column details.</DialogDescription>
          </DialogHeader>
          {selectedColumn && (
            <div className="space-y-4">
              <EntityDetailView
                title={selectedColumn.name}
                description={columnDescription}
                onDescriptionChange={(value) => { setColumnDescription(value); setDescriptionSaved(false); }}
                onSave={handleSaveColumnDescription}
                saving={savingDescription}
                saved={descriptionSaved}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-2 flex-1">
                    <Label>Type</Label>
                    <div className="text-sm font-mono bg-muted px-3 py-2 rounded-md inline-block">{selectedColumn.data_type || "Unknown"}</div>
                  </div>
                  <div className="space-y-2">
                    <Label>Visibility</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleColumnHidden(selectedColumn)}
                      className="flex items-center gap-2"
                    >
                      {selectedColumn.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      {selectedColumn.hidden ? "Hidden" : "Visible"}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="column-synonyms">Synonyms</Label>
                  <Input id="column-synonyms" value={columnSynonyms} onChange={(e) => { setColumnSynonyms(e.target.value); setDescriptionSaved(false); }} placeholder="alias, alternative name, ..." />
                  <p className="text-xs text-muted-foreground">Separate synonyms with commas. They will be stored on the column node.</p>
                </div>
              </EntityDetailView>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => handleColumnDialogOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh w-full items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading settings…</p>
        </div>
      }
    >
      <SettingsPageInner />
    </Suspense>
  );
}
