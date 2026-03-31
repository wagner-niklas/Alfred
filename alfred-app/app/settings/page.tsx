"use client";

import { Suspense, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ChatModelSettings,
  DatabricksSettings,
  EmbeddingSettings,
  GraphSettings,
  ModelSettings,
} from "@/lib/db";
import type { SettingsResponse } from "@/lib/settings/types";
import { useSettings } from "@/lib/settings/hooks";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Local helper type
type DraftSettings = SettingsResponse | null;

// Strongly-typed helper for updating a single chat model row.
type UpsertModelRowFn = <K extends keyof ChatModelSettings>(
  index: number,
  field: K,
  value: ChatModelSettings[K],
) => void;

// Generate a stable, unique id for a chat model row. This id is persisted in
// user settings and also used as part of the React key when rendering the
// list of models.
function generateChatModelId(): string {
  return (
    "model-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

// Derive defaults for new chat models from existing settings.
function deriveModelDefaults(settings: SettingsResponse): ModelSettings {
  const models = settings.models ?? [];
  const defaultChatModel: ChatModelSettings | null =
    models.find((model) => model.isDefault) ?? models[0] ?? null;

  const source: ModelSettings | ChatModelSettings | null = defaultChatModel;

  if (!source) {
    return {
      provider: "azure-openai",
      apiKey: "",
      apiVersion: "",
      baseURL: "",
      deployment: "",
    };
  }

  return {
    provider: source.provider ?? "azure-openai",
    apiKey: source.apiKey ?? "",
    apiVersion: source.apiVersion ?? "",
    baseURL: source.baseURL ?? "",
    deployment: source.deployment ?? "",
  };
}

// Always operate on a fully-populated SettingsResponse.
function ensureSettingsBase(
  current: DraftSettings,
  loaded: SettingsResponse | null,
): SettingsResponse {
  return {
    userId: current?.userId ?? loaded?.userId ?? "",
    model: current?.model ?? loaded?.model ?? null,
    models: current?.models ?? loaded?.models ?? null,
    embedding: current?.embedding ?? loaded?.embedding ?? null,
    graph: current?.graph ?? loaded?.graph ?? null,
    databricks: current?.databricks ?? loaded?.databricks ?? null,
    additionalInstructions:
      current?.additionalInstructions ?? loaded?.additionalInstructions ?? null,
  };
}

type ChatModelRowProps = {
  model: ChatModelSettings;
  index: number;
  onChange: UpsertModelRowFn;
  onRemove: (index: number) => void;
};

function ChatModelRow({ model, index, onChange, onRemove }: ChatModelRowProps) {
  const idPrefix = `model-${index}`;

  return (
    <div
      key={model.id ?? `${idPrefix}-row`}
      className="flex flex-col gap-3 rounded-md border p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Chat model {index + 1}</p>
        <div className="flex items-center gap-2">
          <input
            id={`${idPrefix}-default`}
            type="radio"
            className="h-4 w-4"
            name="defaultChatModel"
            checked={!!model.isDefault}
            onChange={() => onChange(index, "isDefault", true)}
          />
          <Label htmlFor={`${idPrefix}-default`} className="text-xs">
            Default
          </Label>
        </div>
      </div>

      {/* Provider selector and base URL share the same row. */}
      <div className="grid gap-3 md:grid-cols-2 md:items-center">
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}-provider`}>Provider</Label>
          <select
            id={`${idPrefix}-provider`}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={model.provider}
            onChange={(event) =>
              onChange(index, "provider", event.target.value as any)
            }
          >
            <option value="azure-openai">Azure OpenAI</option>
            <option value="openai-compatible">
              OpenAI-compatible (base URL + model)
            </option>
          </select>
        </div>

        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}-baseURL`}>Base URL</Label>
          <Input
            id={`${idPrefix}-baseURL`}
            type="text"
            className="h-9"
            placeholder="https://...azure.com/openai or https://api.openai.com/v1"
            value={model.baseURL}
            onChange={(event) =>
              onChange(index, "baseURL", event.target.value.trim())
            }
          />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Supports Azure OpenAI as well as OpenAI-compatible HTTP endpoints
        (including proxies) configured via base URL.
      </p>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}-apiVersion`}>API version</Label>
          <Input
            id={`${idPrefix}-apiVersion`}
            type="text"
            value={model.apiVersion}
            onChange={(event) =>
              onChange(index, "apiVersion", event.target.value)
            }
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}-deployment`}>Deployment name</Label>
          <Input
            id={`${idPrefix}-deployment`}
            type="text"
            value={model.deployment}
            onChange={(event) =>
              onChange(index, "deployment", event.target.value)
            }
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}-apiKey`}>API key</Label>
          <Input
            id={`${idPrefix}-apiKey`}
            type="password"
            value={model.apiKey}
            onChange={(event) =>
              onChange(index, "apiKey", event.target.value)
            }
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRemove(index)}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

type ChatModelsCardProps = {
  models: ChatModelSettings[];
  onUpsertRow: UpsertModelRowFn;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
};

function ChatModelsCard({
  models,
  onUpsertRow,
  onAddRow,
  onRemoveRow,
}: ChatModelsCardProps) {
  const hasModels = models.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat models</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Configure one or more chat models. Each model defines provider, base
          URL, API version, deployment, and API key. One model must be marked as
          the default.
        </p>
        <div className="space-y-3">
          {!hasModels && (
            <p className="text-sm text-muted-foreground">
              No chat models configured yet. Click{" "}
              <span className="font-medium">Add model</span> to create one.
            </p>
          )}

          {models.map((model, index) => (
            <ChatModelRow
              // Use both id and index to ensure React keys remain unique even
              // if older settings data happens to contain duplicate ids.
              key={`${model.id}-${index}`}
              model={model}
              index={index}
              onChange={onUpsertRow}
              onRemove={onRemoveRow}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddRow}
        >
          Add model
        </Button>
      </CardContent>
    </Card>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const userIdFromQuery = searchParams?.get("user_id")?.trim() || null;
  const { data, loading, saving, error, saved, update, save } = useSettings();
  const [deletingAll, setDeletingAll] = useState(false);

  const models = data?.models ?? [];
  const embedding = data?.embedding ?? null;
  const graph = data?.graph ?? null;
  const databricks = data?.databricks ?? null;

  const withBase = (current: DraftSettings): SettingsResponse =>
    ensureSettingsBase(current, data ?? null);

  const upsertModelRow: UpsertModelRowFn = (index, field, value) => {
    update((current) => {
      const base = withBase(current);
      const prev = base.models ?? [];
      const next = [...prev];
      const modelDefaults = deriveModelDefaults(base);
      const existing =
        next[index] ?? {
          id: generateChatModelId(),
          name: "Chat model " + (index + 1),
          provider: modelDefaults.provider,
          apiKey: modelDefaults.apiKey,
          apiVersion: modelDefaults.apiVersion,
          baseURL: modelDefaults.baseURL,
          deployment: modelDefaults.deployment,
          isDefault: prev.length === 0,
        };

      const updated: ChatModelSettings = {
        ...existing,
        [field]: value,
      };

      // Ensure only one model is marked as default.
      if (field === "isDefault" && value) {
        const ensured = next.map((model, modelIndex) => ({
          ...(modelIndex === index ? updated : model ?? existing),
          isDefault: modelIndex === index,
        }));

        return {
          ...base,
          models: ensured,
        };
      }

      next[index] = updated;
      return {
        ...base,
        models: next,
      };
    });
  };

  const addModelRow = () => {
    update((current) => {
      const base = withBase(current);
      const prev = base.models ?? [];
      const index = prev.length;
      const modelDefaults = deriveModelDefaults(base);
      const next: ChatModelSettings = {
        id: generateChatModelId(),
        name: "Chat model " + (index + 1),
        provider: modelDefaults.provider,
        apiKey: modelDefaults.apiKey,
        apiVersion: modelDefaults.apiVersion,
        baseURL: modelDefaults.baseURL,
        deployment: modelDefaults.deployment,
        // First model becomes default unless another is already marked.
        isDefault: prev.length === 0,
      };

      return {
        ...base,
        models: [...prev, next],
      };
    });
  };

  const removeModelRow = (index: number) => {
    update((current) => {
      const base = withBase(current);
      const prev = base.models ?? [];
      const next = prev.filter((_, i) => i !== index);
      if (!next.length) {
        return {
          ...base,
          models: [],
        };
      }

      // Ensure at least one model remains default.
      if (!next.some((m) => m.isDefault)) {
        next[0] = { ...next[0], isDefault: true };
      }

      return {
        ...base,
        models: next,
      };
    });
  };

  const updateEmbeddingField = (
    field: keyof EmbeddingSettings,
    value: string,
  ) => {
    update((current) => {
      const base = withBase(current);
      const prev = base.embedding ?? null;
      return {
        ...base,
        embedding: {
          provider: prev?.provider ?? "azure-openai",
          apiKey: prev?.apiKey ?? "",
          apiVersion: prev?.apiVersion ?? "",
          baseURL: prev?.baseURL ?? "",
          deployment: prev?.deployment ?? "",
          ...prev,
          [field]: value,
        },
      };
    });
  };

  const updateGraphField = (field: keyof GraphSettings, value: string) => {
    update((current) => {
      const base = withBase(current);
      const prev = base.graph ?? null;
      return {
        ...base,
        graph: {
          boltUrl: prev?.boltUrl ?? "",
          username: prev?.username ?? "",
          password: prev?.password ?? "",
          database: prev?.database ?? "",
          tableVectorIndex: prev?.tableVectorIndex ?? "",
          ...prev,
          [field]: value,
        },
      };
    });
  };

  const updateDatabricksField = (
    field: keyof DatabricksSettings,
    value: string,
  ) => {
    update((current) => {
      const base = withBase(current);
      const prev = base.databricks ?? null;
      return {
        ...base,
        databricks: {
          host: prev?.host ?? "",
          httpPath: prev?.httpPath ?? "",
          token: prev?.token ?? "",
          catalog: prev?.catalog ?? "",
          schema: prev?.schema ?? "",
          ...prev,
          [field]: value,
        },
      };
    });
  };

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

      // After deletion, clear local settings state so the UI reflects a
      // clean slate. The next reload will re-create a minimal settings row
      // as needed via /api/settings.
      update(() => ({
        userId: "",
        model: null,
        models: null,
        embedding: null,
        graph: null,
        databricks: null,
        additionalInstructions: null,
      }));
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

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink asChild>
                <Link
                  href={userIdFromQuery ? `/alfred?user_id=${encodeURIComponent(userIdFromQuery)}` : "/alfred"}
                >
                  Home
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Settings</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 overflow-auto">
          <div className="container mx-auto max-w-4xl py-8 space-y-6">
            <h1 className="text-2xl font-semibold">Settings</h1>

            {loading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {saved && !error && (
              <p className="text-sm text-green-600">
                Settings saved successfully.
              </p>
            )}

            <div className="grid gap-6 md:grid-cols-1">
              <ChatModelsCard
                models={models}
                onUpsertRow={upsertModelRow}
                onAddRow={addModelRow}
                onRemoveRow={removeModelRow}
              />

              <Card>
                <CardHeader>
                  <CardTitle>Embedding model</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="embedding-provider">Provider</Label>
                    <select
                      id="embedding-provider"
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={embedding?.provider ?? "azure-openai"}
                      onChange={(e) =>
                        updateEmbeddingField(
                          "provider",
                          e.target.value as EmbeddingSettings["provider"],
                        )
                      }
                    >
                      <option value="azure-openai">Azure OpenAI</option>
                      <option value="openai-compatible">
                        OpenAI-compatible (base URL + model)
                      </option>
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="embedding-baseURL">Base URL</Label>
                    <Input
                      id="embedding-baseURL"
                      type="text"
                      placeholder="https://...azure.com/openai or https://api.openai.com/v1"
                      value={embedding?.baseURL ?? ""}
                      onChange={(e) =>
                        updateEmbeddingField("baseURL", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="embedding-apiKey">API key</Label>
                    <Input
                      id="embedding-apiKey"
                      type="password"
                      value={embedding?.apiKey ?? ""}
                      onChange={(e) =>
                        updateEmbeddingField("apiKey", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="embedding-apiVersion">API version</Label>
                    <Input
                      id="embedding-apiVersion"
                      type="text"
                      value={embedding?.apiVersion ?? ""}
                      onChange={(e) =>
                        updateEmbeddingField("apiVersion", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="embedding-deployment">
                      Deployment name
                    </Label>
                    <Input
                      id="embedding-deployment"
                      type="text"
                      value={embedding?.deployment ?? ""}
                      onChange={(e) =>
                        updateEmbeddingField("deployment", e.target.value)
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Knowledge graph (Neo4j)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="graph-boltUrl">Bolt URL</Label>
                    <Input
                      id="graph-boltUrl"
                      type="text"
                      placeholder="bolt://localhost:7687"
                      value={graph?.boltUrl ?? ""}
                      onChange={(e) =>
                        updateGraphField("boltUrl", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="graph-username">Username</Label>
                    <Input
                      id="graph-username"
                      type="text"
                      value={graph?.username ?? ""}
                      onChange={(e) =>
                        updateGraphField("username", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="graph-password">Password</Label>
                    <Input
                      id="graph-password"
                      type="password"
                      value={graph?.password ?? ""}
                      onChange={(e) =>
                        updateGraphField("password", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="graph-database">Database (optional)</Label>
                    <Input
                      id="graph-database"
                      type="text"
                      value={graph?.database ?? ""}
                      onChange={(e) =>
                        updateGraphField("database", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="graph-tableVectorIndex">
                      Table vector index
                    </Label>
                    <Input
                      id="graph-tableVectorIndex"
                      type="text"
                      placeholder="table_vector_index"
                      value={graph?.tableVectorIndex ?? ""}
                      onChange={(e) =>
                        updateGraphField("tableVectorIndex", e.target.value)
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Databricks</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="db-host">Host</Label>
                    <Input
                      id="db-host"
                      type="text"
                      placeholder="dbc-...databricks.com"
                      value={databricks?.host ?? ""}
                      onChange={(e) =>
                        updateDatabricksField("host", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="db-httpPath">HTTP path</Label>
                    <Input
                      id="db-httpPath"
                      type="text"
                      placeholder="/sql/1.0/warehouses/..."
                      value={databricks?.httpPath ?? ""}
                      onChange={(e) =>
                        updateDatabricksField("httpPath", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="db-token">Personal access token</Label>
                    <Input
                      id="db-token"
                      type="password"
                      value={databricks?.token ?? ""}
                      onChange={(e) =>
                        updateDatabricksField("token", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="db-catalog">Catalog</Label>
                    <Input
                      id="db-catalog"
                      type="text"
                      value={databricks?.catalog ?? ""}
                      onChange={(e) =>
                        updateDatabricksField("catalog", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="db-schema">Schema</Label>
                    <Input
                      id="db-schema"
                      type="text"
                      value={databricks?.schema ?? ""}
                      onChange={(e) =>
                        updateDatabricksField("schema", e.target.value)
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Additional instructions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Advanced. These instructions will be appended to the system
                    prompt for Alfred and apply to all future conversations for
                    this browser.
                  </p>
                  <div className="grid gap-2">
                    <Label htmlFor="additional-instructions">
                      Custom system instructions
                    </Label>
                    <textarea
                      id="additional-instructions"
                      className="min-h-[120px] w-full resize-y rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      placeholder="Answer always in German, focus on Data-Engineering-Best-Practices, avoid too much small talk ..."
                      value={data?.additionalInstructions ?? ""}
                      onChange={(event) =>
                        update((current) => {
                          const base = withBase(current);
                          return {
                            ...base,
                            additionalInstructions:
                              event.target.value.trim() === ""
                                ? null
                                : event.target.value,
                          };
                        })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-4 border-t pt-6 mt-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-4">
                  <Button onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving…" : "Save settings"}
                  </Button>
                  {!saving && !loading && (
                    <p className="text-xs text-muted-foreground">
                      Settings are stored locally in the Alfred SQLite database for
                      this browser’s anonymous user id.
                    </p>
                  )}
                </div>
                {!loading && (
                  <p className="text-[10px] text-muted-foreground/80 font-mono">
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
            </div>
          </div>
      </main>
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