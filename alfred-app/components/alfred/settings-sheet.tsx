"use client";

import * as React from "react";
import { ArrowLeft, Eye, EyeOff, Plus, Pencil, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings } from "@/lib/settings/hooks";
import { useSchema, Table, Column, Concept, ConceptColumn, ConceptType } from "@/hooks/use-schema";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ViewState = "tables" | "table" | "column";

type ColumnSuggestion = ConceptColumn & {
  data_type: string | null;
  score: number;
};

type CaretMenuPosition = {
  top: number;
  left: number;
};

// Utility functions
const truncate = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;

const normalizeMatchText = (value: string) =>
  value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

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

const similarity = (left: string, right: string) => {
  const max = Math.max(left.length, right.length);
  return max === 0 ? 1 : 1 - levenshteinDistance(left, right) / max;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const expressionReferencesColumn = (expression: string, table: string, column: string) => {
  const colPattern = escapeRegExp(column);
  const tblPattern = escapeRegExp(table);
  const quotedPattern = `["'\`]${colPattern}["'\`]`;
  const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])(?:${tblPattern}\\.)?(?:${colPattern}|${quotedPattern})(?=$|[^a-zA-Z0-9_])`, "i");
  return regex.test(expression);
};

const columnReferenceRegex = (table: string, column: string) => {
  const colPattern = escapeRegExp(column);
  const tblPattern = escapeRegExp(table);
  const quotedPattern = `["'\`]${colPattern}["'\`]`;
  return new RegExp(`((?:${tblPattern}\\.)?(?:${colPattern}|${quotedPattern}))`, "gi");
};

const highlightedExpressionParts = (expression: string, columns: ConceptColumn[]) => {
  const ranges = columns.flatMap((col) => {
    const matches = Array.from(expression.matchAll(columnReferenceRegex(col.table, col.column)));
    return matches.map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  });

  const merged = ranges
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .reduce<Array<{ start: number; end: number }>>((acc, range) => {
      const prev = acc[acc.length - 1];
      if (!prev || range.start > prev.end) acc.push(range);
      else prev.end = Math.max(prev.end, range.end);
      return acc;
    }, []);

  const parts: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) parts.push({ text: expression.slice(cursor, range.start), highlighted: false });
    parts.push({ text: expression.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < expression.length) parts.push({ text: expression.slice(cursor), highlighted: false });
  return parts.length > 0 ? parts : [{ text: expression, highlighted: false }];
};

const getTokenAtCursor = (value: string, cursor: number) => {
  let start = cursor, end = cursor;
  while (start > 0 && /[a-zA-Z0-9_]/.test(value[start - 1])) start--;
  while (end < value.length && /[a-zA-Z0-9_]/.test(value[end])) end++;
  return { start, end, token: value.slice(start, end) };
};

const getCaretPosition = (textarea: HTMLTextAreaElement, cursor: number): CaretMenuPosition => {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  mirror.style.cssText = "position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;top:0;left:-9999px;width:" + textarea.clientWidth + "px";
  ["borderLeftWidth", "borderTopWidth", "boxSizing", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "paddingBottom", "paddingLeft", "paddingRight", "paddingTop"].forEach((prop) => {
    mirror.style.setProperty(prop, computed.getPropertyValue(prop));
  });
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(cursor, cursor + 1) || ".";
  mirror.appendChild(document.createTextNode(textarea.value.slice(0, cursor)));
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const pos = { top: marker.offsetTop - textarea.scrollTop + 24, left: marker.offsetLeft - textarea.scrollLeft };
  document.body.removeChild(mirror);
  return pos;
};

const highlightColumnMatch = (column: string, token: string) => {
  const idx = column.toLowerCase().indexOf(token.toLowerCase());
  if (idx === -1) return column;
  return (
    <>
      {column.slice(0, idx)}
      <span className="rounded bg-muted px-0.5">{column.slice(idx, idx + token.length)}</span>
      {column.slice(idx + token.length)}
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

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const { loading: settingsLoading, saving: settingsSaving, error: settingsError, saved: settingsSaved, data, save } = useSettings();
  const { tables, concepts, loading: schemaLoading, error: schemaError, updateTableDescription, updateColumnDescription, toggleColumnHidden, createConcept, updateConcept, deleteConcept, deleteTable } = useSchema();
  const [deletingTableName, setDeletingTableName] = React.useState<string | null>(null);
  
  const [instructions, setInstructions] = React.useState("");
  const [view, setView] = React.useState<ViewState>("tables");
  const [selectedTable, setSelectedTable] = React.useState<Table | null>(null);
  const [selectedColumn, setSelectedColumn] = React.useState<Column | null>(null);
  const [tableDescription, setTableDescription] = React.useState("");
  const [columnDescription, setColumnDescription] = React.useState("");
  const [columnSynonyms, setColumnSynonyms] = React.useState("");
  const [savingDescription, setSavingDescription] = React.useState(false);
  const [descriptionSaved, setDescriptionSaved] = React.useState(false);
  const [conceptDialogOpen, setConceptDialogOpen] = React.useState(false);
  const [editingConceptName, setEditingConceptName] = React.useState<string | null>(null);
  const [conceptName, setConceptName] = React.useState("");
  const [conceptType, setConceptType] = React.useState<ConceptType>("Dimension");
  const [conceptSqlExpression, setConceptSqlExpression] = React.useState("");
  const [conceptSynonyms, setConceptSynonyms] = React.useState("");
  const [savingConcept, setSavingConcept] = React.useState(false);
  const [deletingConceptName, setDeletingConceptName] = React.useState<string | null>(null);
  const [conceptError, setConceptError] = React.useState<string | null>(null);
  const [conceptCursor, setConceptCursor] = React.useState(0);
  const [conceptCaretPosition, setConceptCaretPosition] = React.useState<CaretMenuPosition>({ top: 0, left: 0 });
  const [conceptExpressionFocused, setConceptExpressionFocused] = React.useState(false);
  const conceptSqlExpressionRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [columnDialogOpen, setColumnDialogOpen] = React.useState(false);

  const cursorToken = React.useMemo(() => getTokenAtCursor(conceptSqlExpression, conceptCursor).token, [conceptCursor, conceptSqlExpression]);

  const allColumnMatches = React.useMemo<ColumnSuggestion[]>(() => {
    return tables.flatMap((table) =>
      table.columns.map((col) => ({
        table: table.name,
        column: col.name,
        data_type: col.data_type,
        score: expressionReferencesColumn(conceptSqlExpression, table.name, col.name) ? 1 : 0,
      }))
    ).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  }, [conceptSqlExpression, tables]);

  const columnSuggestions = React.useMemo<ColumnSuggestion[]>(() => {
    const token = normalizeMatchText(cursorToken);
    if (!token) return [];
    return tables.flatMap((table) =>
      table.columns.map((col) => {
        const normCol = normalizeMatchText(col.name);
        const normTblCol = normalizeMatchText(`${table.name} ${col.name}`);
        const score = normCol === token ? 1 : normCol.startsWith(token) ? 0.96 : normCol.includes(token) || normTblCol.includes(token) ? 0.9 : similarity(token, normCol);
        return { table: table.name, column: col.name, data_type: col.data_type, score };
      })
    ).filter((s) => s.score >= 0.72).sort((a, b) => b.score - a.score).slice(0, 8);
  }, [cursorToken, tables]);

  const matchedConceptColumns = React.useMemo<ConceptColumn[]>(() => allColumnMatches.map((s) => ({ table: s.table, column: s.column })), [allColumnMatches]);
  const highlightedSqlExpression = React.useMemo(() => highlightedExpressionParts(conceptSqlExpression, matchedConceptColumns), [conceptSqlExpression, matchedConceptColumns]);

  // Sync selectedTable with tables when schema reloads
  React.useEffect(() => {
    if (selectedTable && tables.length > 0) {
      const updated = tables.find((t) => t.name === selectedTable.name);
      if (updated) setSelectedTable(updated);
    }
  }, [tables, selectedTable]);

  React.useEffect(() => { if (data?.additionalInstructions !== undefined) setInstructions(data.additionalInstructions ?? ""); }, [data]);
  React.useEffect(() => { if (selectedTable) setTableDescription(selectedTable.description ?? ""); }, [selectedTable]);
  React.useEffect(() => {
    if (selectedColumn) {
      setColumnDescription(selectedColumn.description ?? "");
      setColumnSynonyms(Array.isArray(selectedColumn.synonyms) ? selectedColumn.synonyms.join(", ") : "");
    }
  }, [selectedColumn]);

  const handleSaveInstructions = () => { void save({ additionalInstructions: instructions || null }); };

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

  const handleSaveColumnDescription = async () => {
    if (!selectedTable || !selectedColumn) return;
    setSavingDescription(true);
    setDescriptionSaved(false);
    const success = await updateColumnDescription(selectedTable.name, selectedColumn.name, columnDescription, columnSynonyms);
    setSavingDescription(false);
    if (success) {
      setDescriptionSaved(true);
      const synonymsArray = columnSynonyms.split(",").map((s) => s.trim()).filter(Boolean);
      setSelectedColumn((prev) => prev ? { ...prev, description: columnDescription || null, synonyms: synonymsArray } : null);
    }
  };

  const handleToggleColumnHidden = async (column: Column) => {
    if (!selectedTable) return;
    const success = await toggleColumnHidden(selectedTable.name, column.name, !column.hidden);
    if (success && selectedColumn?.name === column.name) {
      setSelectedColumn((prev) => prev ? { ...prev, hidden: !column.hidden } : null);
    }
  };

  const handleSelectTable = (table: Table) => { setSelectedTable(table); setView("table"); setDescriptionSaved(false); };
  const handleSelectColumn = (column: Column) => { setSelectedColumn(column); setColumnDialogOpen(true); };
  const handleColumnDialogOpenChange = (nextOpen: boolean) => {
    setColumnDialogOpen(nextOpen);
    if (!nextOpen) { setSelectedColumn(null); }
  };

  const handleBack = () => {
    if (view === "column") { setView("table"); setSelectedColumn(null); }
    else if (view === "table") { setView("tables"); setSelectedTable(null); }
    setDescriptionSaved(false);
  };

  const resetConceptForm = () => {
    setEditingConceptName(null); setConceptName(""); setConceptType("Dimension");
    setConceptSqlExpression(""); setConceptSynonyms(""); setSavingConcept(false); setConceptError(null);
  };

  const handleConceptDialogOpenChange = (nextOpen: boolean) => {
    setConceptDialogOpen(nextOpen);
    if (!nextOpen) resetConceptForm();
  };

  const handleAddConcept = () => { resetConceptForm(); setConceptDialogOpen(true); };

  const handleEditConcept = (concept: Concept) => {
    setEditingConceptName(concept.name); setConceptName(concept.name); setConceptType(concept.type);
    setConceptSqlExpression(concept.sql_expression ?? ""); setConceptSynonyms(concept.synonyms.join(", "));
    setSavingConcept(false); setConceptError(null); setConceptDialogOpen(true);
  };

  const updateConceptCursor = () => {
    const textarea = conceptSqlExpressionRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart ?? 0;
    setConceptCursor(cursor);
    setConceptCaretPosition(getCaretPosition(textarea, cursor));
  };

  const handleInsertConceptColumn = (column: string) => {
    const textarea = conceptSqlExpressionRef.current;
    const start = textarea?.selectionStart ?? conceptSqlExpression.length;
    const end = textarea?.selectionEnd ?? start;
    const tokenRange = getTokenAtCursor(conceptSqlExpression, start);
    const insertStart = start === end ? tokenRange.start : start;
    const insertEnd = start === end ? tokenRange.end : end;

    setConceptSqlExpression((current) => `${current.slice(0, insertStart)}${column}${current.slice(insertEnd)}`);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      const pos = insertStart + column.length;
      textarea?.setSelectionRange(pos, pos);
      updateConceptCursor();
    });
  };

  const handleSaveConcept = async () => {
    const name = conceptName.trim();
    if (!name) { setConceptError("Name is required."); return; }
    if (!conceptSqlExpression.trim()) { setConceptError("SQL expression is required."); return; }
    if (matchedConceptColumns.length === 0) { setConceptError("Use at least one matching column in the expression."); return; }

    setSavingConcept(true);
    setConceptError(null);

    const payload = {
      name,
      type: conceptType,
      sql_expression: conceptSqlExpression,
      synonyms: conceptSynonyms.split(",").map((s) => s.trim()).filter(Boolean),
      columns: matchedConceptColumns,
    };

    const success = editingConceptName ? await updateConcept({ originalName: editingConceptName, ...payload }) : await createConcept(payload);
    setSavingConcept(false);

    if (success) { setConceptDialogOpen(false); resetConceptForm(); }
    else setConceptError("Failed to save concept.");
  };

  const handleDeleteConcept = async (concept: Concept) => {
    if (!window.confirm(`Delete concept "${concept.name}"?`)) return;
    setDeletingConceptName(concept.name);
    const success = await deleteConcept(concept.name);
    setDeletingConceptName(null);
    if (!success) setConceptError("Failed to delete concept.");
  };

  const handleDeleteTable = async (table: Table) => {
    if (!window.confirm(`Delete table "${table.name}" and all its columns?`)) return;
    setDeletingTableName(table.name);
    const success = await deleteTable(table.name);
    setDeletingTableName(null);
    if (!success) alert("Failed to delete table.");
  };

  const renderTableList = () => (
    tables.length === 0 ? (
      <p className="text-sm text-muted-foreground">No tables available.</p>
    ) : (
      <div className="space-y-1">
        {tables.map((table) => (
          <div key={table.name} className="flex items-center px-3 py-2 text-sm rounded-md border bg-background">
            <button onClick={() => handleSelectTable(table)} className="flex flex-col items-start gap-0.5 flex-1 text-left hover:text-foreground transition-colors">
              <span className="font-medium text-sm truncate">{table.name}</span>
              {table.description && <span className="text-xs text-muted-foreground truncate">{truncate(table.description, 40)}</span>}
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

  const renderColumnList = () => (
    <div className="space-y-1">
      {selectedTable?.columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No columns</p>
      ) : (
        selectedTable?.columns.map((column) => (
          <div key={column.name} className={`flex items-center justify-between px-3 py-2 text-sm rounded-md border ${column.hidden ? "bg-muted/50 opacity-60" : "bg-background"}`}>
            <button onClick={() => handleSelectColumn(column)} className="flex flex-col items-start gap-0.5 flex-1 text-left hover:text-foreground transition-colors">
              <span className="truncate">{truncate(column.name, 40)}</span>
              {(column.description || column.data_type) && (
                <span className="text-xs text-muted-foreground truncate">{column.description ? truncate(column.description, 40) : column.data_type}</span>
              )}
            </button>
            <button onClick={() => handleToggleColumnHidden(column)} className={`p-1 rounded hover:bg-muted transition-colors ${column.hidden ? "text-muted-foreground" : "text-foreground"}`} title={column.hidden ? "Show in graph" : "Hide from graph"}>
              {column.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        ))
      )}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:max-w-[400px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Configure your Alfred preferences</SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="data" className="mt-2 px-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="concepts">Concepts</TabsTrigger>
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
          </TabsList>
          <TabsContent value="data" className="space-y-4">
            {view === "tables" && (
              <div>
                <h3 className="text-sm font-medium">Data</h3>
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
          </TabsContent>
          <TabsContent value="concepts" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">Concepts</h3>
                <p className="text-xs text-muted-foreground">Define business concepts as SQL expressions.</p>
              </div>
              <Button size="sm" onClick={handleAddConcept} className="shrink-0"><Plus className="h-4 w-4" /> Add</Button>
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
              <Textarea id="additional-instructions" placeholder="Enter any additional instructions for the assistant ..." value={instructions} onChange={(e) => setInstructions(e.target.value)} className="min-h-[60vh] text-xs resize-y" />
            </div>
            {settingsError && <p className="text-sm text-destructive">{settingsError}</p>}
            {settingsSaved && <p className="text-sm text-green-600">Settings saved successfully!</p>}
            <Button onClick={handleSaveInstructions} disabled={settingsSaving || settingsLoading}>{settingsSaving ? "Saving..." : "Save"}</Button>
          </TabsContent>
        </Tabs>
      </SheetContent>
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
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 min-h-[110px] whitespace-pre-wrap break-words rounded-md border border-transparent px-3 py-2 font-mono text-sm text-transparent">
                  {highlightedSqlExpression.map((part, i) => (
                    <span key={i} className={part.highlighted ? "rounded bg-muted" : ""}>{part.text || " "}</span>
                  ))}
                </div>
                <Textarea
                  id="concept-sql-expression"
                  ref={conceptSqlExpressionRef}
                  value={conceptSqlExpression}
                  onChange={(e) => { setConceptSqlExpression(e.target.value); window.requestAnimationFrame(updateConceptCursor); }}
                  onClick={updateConceptCursor}
                  onKeyUp={updateConceptCursor}
                  onFocus={() => { setConceptExpressionFocused(true); window.requestAnimationFrame(updateConceptCursor); }}
                  onBlur={() => window.setTimeout(() => setConceptExpressionFocused(false), 120)}
                  onScroll={updateConceptCursor}
                  placeholder="sum(net_revenue)"
                  className="relative min-h-[110px] resize-none bg-transparent font-mono text-sm"
                />
                {conceptExpressionFocused && columnSuggestions.length > 0 && (
                  <div className="absolute z-50 w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md" style={{ left: Math.min(conceptCaretPosition.left, 120), top: conceptCaretPosition.top }}>
                    {columnSuggestions.map((s) => (
                      <button key={`${s.table}.${s.column}`} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleInsertConceptColumn(s.column)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{highlightColumnMatch(s.column, cursorToken)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{s.table}</span>
                        </span>
                        {s.data_type && <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.data_type}</span>}
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
    </Sheet>
  );
}