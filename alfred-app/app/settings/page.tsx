"use client";

import { Suspense, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { SettingsResponse } from "@/lib/settings/types";
import { useSettings } from "@/lib/settings/hooks";
import { useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

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

const MAX_SELECTED_TABLES = 30;

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const userIdFromQuery = searchParams?.get("user_id")?.trim() || null;
  const { data, loading, saving, error, saved, update, save } = useSettings();
  const [deletingAll, setDeletingAll] = useState(false);
  const [resettingDb, setResettingDb] = useState(false);

  // Table selection dialog state
  const [showTableSelector, setShowTableSelector] = useState(false);
  const [catalogData, setCatalogData] = useState<CatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const withBase = (current: DraftSettings): SettingsResponse =>
    ensureSettingsBase(current, data ?? null);

  const handleDeleteAllData = async () => {
    const confirmed = window.confirm(
      "Delete all chats and settings for this browser? This cannot be undone.",
    );

    if (!confirmed) return;

    setDeletingAll(true);

    try {
      const res = await fetch("/api/user/delete", { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`Failed to delete data: ${res.status}`);
      }
    } catch (err) {
      console.error(err);
      alert(
        err instanceof Error
          ? err.message
          : "Failed to delete data for this browser.",
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

  const handleResetDatabase = async () => {
    setResettingDb(true);

    try {
      const res = await fetch("/api/schema/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tables: Array.from(selectedTables) }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to reset database: ${res.status}`);
      }
      const result = await res.json();
      setShowTableSelector(false);
      alert(
        `Knowledge graph database has been reset successfully.\n\n` +
        `Tables created: ${result.tablesCreated}\n` +
        `Columns created: ${result.columnsCreated}`
      );
    } catch (err) {
      console.error(err);
      alert(
        err instanceof Error
          ? err.message
          : "Failed to reset database.",
      );
    } finally {
      setResettingDb(false);
    }
  };

  // Filter schemas and tables based on search query
  const filteredSchemas = catalogData?.schemas
    ? Object.entries(catalogData.schemas).reduce((acc, [schemaName, tables]) => {
        const filteredTables = tables.filter(
          (t) =>
            t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.description?.toLowerCase().includes(searchQuery.toLowerCase())
        );
        if (filteredTables.length > 0) {
          acc[schemaName] = filteredTables;
        }
        return acc;
      }, {} as SchemaTables)
    : {};

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4" />

      <main className="flex-1 overflow-auto">
          <div className="container mx-auto max-w-4xl py-8 space-y-6">
            <h1 className="text-2xl font-semibold">Settings</h1>

            <div className="flex flex-col gap-4 border-t pt-6 mt-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-4">

                  {!saving && !loading && (
                    <p className="text-sm text-muted-foreground">
                      Settings are stored locally in the Alfred SQLite database for
                      this browser's anonymous user id.
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
                    anonymous user id. This action cannot be undone.
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
          </div>
      </main>

      {/* Table Selection Dialog */}
      <Dialog open={showTableSelector} onOpenChange={setShowTableSelector}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Select Tables for Knowledge Graph</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Choose up to {MAX_SELECTED_TABLES} tables to include in the knowledge graph.
              Tables are grouped by schema.
            </p>
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