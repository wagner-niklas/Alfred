import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { decryptJson, encryptJson } from "@/lib/crypto";

// Server-side SQLite database setup for thread & message persistence.
// This file must only be imported from server-side code (e.g. route handlers).
//
// Multi-user note:
// -----------------
// The current schema is intentionally user-agnostic and treats all threads as
// belonging to a single logical user. For production or shared deployments,
// you will typically want to associate each thread (and optionally message)
// with a concrete userId derived from your auth system.
//
// A minimal evolution path is:
//   1. Add a userId column to the threads table, and optionally messages:
//      ALTER TABLE threads ADD COLUMN userId TEXT NOT NULL DEFAULT 'local-dev';
//   2. Backfill existing rows with a stable local user id (e.g. "local-dev").
//   3. Change the functions below to accept a userId argument and scope all
//      queries by that userId.
//
// Example future signatures (not used by the current code):
//   getThreads(userId: string): ThreadRecord[];
//   createThread(userId: string, id?: string, title?: string): ThreadRecord;
//   updateThread(userId: string, id: string, updates: Partial<Pick<ThreadRecord, "title" | "archived" >>): void;
//   deleteThread(userId: string, id: string): void;
//   getMessages(userId: string, threadId: string): MessageRecord[];
//   appendMessage(userId: string, message: MessageRecord): void;
//
// In local development you can hard-code a constant userId ("local-dev"); in
// production you would derive it from the authenticated user/session in your
// API routes and pass it into these helpers.

const dbFilePath = path.join(process.cwd(), "data", "alfred.sqlite");

// Ensure the data directory exists
fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

export const db = new Database(dbFilePath);

// Basic pragmas for better concurrency & safety
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Initialize schema if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL DEFAULT 'local-dev',
    title TEXT NOT NULL DEFAULT 'Chat',
    archived INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    threadId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (threadId) REFERENCES threads(id) ON DELETE CASCADE
  );

  -- Per-user configuration for models and external connections.
  --
  -- The goal is to keep this flexible enough to later support multiple
  -- models or data sources per user while currently storing a single
  -- config blob for each category.
  CREATE TABLE IF NOT EXISTS user_settings (
    userId TEXT PRIMARY KEY,
    model_config TEXT,
    models_config TEXT,
    embedding_config TEXT,
    graph_config TEXT,
    databricks_config TEXT,
    additional_instructions TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

// Lightweight migration for older databases that were created before userId
// existed on the threads table. This is safe to run on every startup.
const threadColumns = db.prepare("PRAGMA table_info(threads)").all() as {
  name: string;
}[];
const hasUserIdColumn = threadColumns.some((col) => col.name === "userId");

if (!hasUserIdColumn) {
  db.exec(
    "ALTER TABLE threads ADD COLUMN userId TEXT NOT NULL DEFAULT 'local-dev'",
  );
}

// Lightweight migration for older databases created before the
// embedding_config / models_config columns existed on user_settings.
const settingsColumns = db.prepare("PRAGMA table_info(user_settings)").all() as {
  name: string;
}[];
const hasEmbeddingConfigColumn = settingsColumns.some(
  (col) => col.name === "embedding_config",
);
const hasModelsConfigColumn = settingsColumns.some(
  (col) => col.name === "models_config",
);
const hasAdditionalInstructionsColumn = settingsColumns.some(
  (col) => col.name === "additional_instructions",
);

if (!hasEmbeddingConfigColumn) {
  db.exec("ALTER TABLE user_settings ADD COLUMN embedding_config TEXT");
}

if (!hasModelsConfigColumn) {
  db.exec("ALTER TABLE user_settings ADD COLUMN models_config TEXT");
}

if (!hasAdditionalInstructionsColumn) {
  db.exec(
    "ALTER TABLE user_settings ADD COLUMN additional_instructions TEXT",
  );
}

export type ThreadRecord = {
  id: string;
  userId: string;
  title: string;
  archived: boolean;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
};

export type MessageRecord = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: unknown; // parsed JSON
  createdAt: string; // ISO string
};

// Per-user configuration ----------------------------------------------------

export type ModelProvider = "azure-openai" | "anthropic";

export type ModelSettings = {
  // Model provider. Initially we supported only Azure OpenAI, but this union
  // now also allows Anthropic while keeping the stored schema stable.
  provider: ModelProvider;
  // Common fields across providers. For Azure OpenAI these map directly to
  // the Azure configuration. For Anthropic, "deployment" is used to store
  // the model name (e.g. "claude-3.7-sonnet") and apiVersion is currently
  // unused but kept for forward compatibility.
  apiKey: string;
  apiVersion: string;
  baseURL: string;
  deployment: string;
};

// Extended chat model configuration allowing multiple named models per user.
//
// "id" is a stable identifier used by the frontend model selector and
// passed through as the modelName in the Assistant UI model context. The
// remaining fields mirror ModelSettings so existing callers can derive a
// concrete Azure configuration from either type.
export type ChatModelSettings = ModelSettings & {
  id: string;
  name: string;
  isDefault?: boolean;
};

export type EmbeddingSettings = {
  provider: "azure-openai";
  apiKey: string;
  apiVersion: string;
  baseURL: string;
  deployment: string;
};

export type GraphSettings = {
  boltUrl: string;
  username: string;
  password: string;
  /** Optional Neo4j database name; defaults to "neo4j" when omitted. */
  database?: string | null;
  /**
   * Name of the Neo4j vector index used for table embeddings.
   *
   * When unset, the application falls back to the environment variable
   * NEO4J_TABLE_VECTOR_INDEX or the hard-coded default "table_vector_index".
   */
  tableVectorIndex?: string | null;
};

export type DatabricksSettings = {
  host: string;
  httpPath: string;
  token: string;
  catalog?: string | null;
  schema?: string | null;
};

export type UserSettings = {
  userId: string;
  // Legacy single-model configuration kept for backward compatibility.
  model?: ModelSettings | null;
  // Optional list of named chat models. When present, the default chat
  // model should be derived from the entry with isDefault === true, or
  // the first entry if none is flagged as default.
  models?: ChatModelSettings[] | null;
  embedding?: EmbeddingSettings | null;
  graph?: GraphSettings | null;
  databricks?: DatabricksSettings | null;
  additionalInstructions?: string | null;
  // Timestamps are stored in the database but optional in the in-memory
  // representation to keep the type lightweight for most callers.
  createdAt?: string;
  updatedAt?: string;
};

export function getUserSettings(userId: string): UserSettings | null {
  const row = db
    .prepare<[], any>(
      "SELECT userId, model_config, models_config, embedding_config, graph_config, databricks_config, additional_instructions, createdAt, updatedAt FROM user_settings WHERE userId = ?",
    )
    .get(userId);

  if (!row) return null;

  return {
    userId: row.userId as string,
    model: row.model_config
      ? decryptJson<ModelSettings>(row.model_config as string)
      : null,
    models: row.models_config
      ? decryptJson<ChatModelSettings[]>(row.models_config as string)
      : null,
    embedding: row.embedding_config
      ? decryptJson<EmbeddingSettings>(row.embedding_config as string)
      : null,
    graph: row.graph_config
      ? decryptJson<GraphSettings>(row.graph_config as string)
      : null,
    databricks: row.databricks_config
      ? decryptJson<DatabricksSettings>(row.databricks_config as string)
      : null,
    additionalInstructions:
      (row.additional_instructions as string | null) ?? null,
    createdAt: row.createdAt as string | undefined,
    updatedAt: row.updatedAt as string | undefined,
  };
}

export function upsertUserSettings(
  userId: string,
  settings: Partial<
    Pick<
      UserSettings,
      "model" | "models" | "embedding" | "graph" | "databricks" | "additionalInstructions"
    >
  >,
): UserSettings {
  const existing = getUserSettings(userId);

  const nextModels: ChatModelSettings[] | null =
    settings.models !== undefined
      ? settings.models ?? null
      : existing?.models ?? null;

  // Derive the legacy single-model configuration from either the explicit
  // "model" field or, when available, from the default entry in "models".
  const modelsSource = nextModels && nextModels.length > 0 ? nextModels : null;
  const defaultFromModels = modelsSource
    ? modelsSource.find((m) => m.isDefault) ?? modelsSource[0]
    : null;

  // When possible, derive a legacy single-model configuration from the
  // default chat model entry. This keeps older callers (that only know
  // about `model`) working even as the UI moves to `models[]`.
  const derivedFromDefault: ModelSettings | null = defaultFromModels
    ? {
        provider: defaultFromModels.provider,
        apiKey: defaultFromModels.apiKey,
        apiVersion: defaultFromModels.apiVersion,
        baseURL: defaultFromModels.baseURL,
        deployment: defaultFromModels.deployment,
      }
    : null;

  const mergedModel: ModelSettings | null =
    settings.model !== undefined
      // If callers explicitly send `model: null` but also provide a
      // default in `models`, we still derive a concrete model config
      // from that default instead of dropping model settings entirely.
      ? settings.model ?? derivedFromDefault
      : derivedFromDefault ?? existing?.model ?? null;

  const merged: UserSettings = {
    userId,
    model: mergedModel,
    models: nextModels,
    embedding:
      settings.embedding !== undefined
        ? settings.embedding
        : existing?.embedding ?? null,
    graph:
      settings.graph !== undefined ? settings.graph : existing?.graph ?? null,
    databricks:
      settings.databricks !== undefined
        ? settings.databricks
        : existing?.databricks ?? null,
    additionalInstructions:
      settings.additionalInstructions !== undefined
        ? settings.additionalInstructions ?? null
        : existing?.additionalInstructions ?? null,
  };

  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO user_settings (userId, model_config, models_config, embedding_config, graph_config, databricks_config, additional_instructions, createdAt, updatedAt)
     VALUES (@userId, @model_config, @models_config, @embedding_config, @graph_config, @databricks_config, @additional_instructions, @createdAt, @updatedAt)
     ON CONFLICT(userId) DO UPDATE SET
       model_config = excluded.model_config,
       models_config = excluded.models_config,
       embedding_config = excluded.embedding_config,
       graph_config = excluded.graph_config,
       databricks_config = excluded.databricks_config,
       additional_instructions = excluded.additional_instructions,
       updatedAt = excluded.updatedAt`,
  ).run({
    userId: merged.userId,
    model_config: merged.model ? encryptJson(merged.model) : null,
    models_config: merged.models ? encryptJson(merged.models) : null,
    embedding_config: merged.embedding ? encryptJson(merged.embedding) : null,
    graph_config: merged.graph ? encryptJson(merged.graph) : null,
    databricks_config: merged.databricks
      ? encryptJson(merged.databricks)
      : null,
    additional_instructions: merged.additionalInstructions ?? null,
    createdAt: existing ? existing.createdAt ?? now : now,
    updatedAt: now,
  } as any);

  return merged;
}

export function getThreads(userId: string): ThreadRecord[] {
  const rows = db
    .prepare<[], any>(
      "SELECT id, userId, title, archived, createdAt, updatedAt FROM threads WHERE userId = ? ORDER BY updatedAt DESC",
    )
    .all(userId);

  return rows.map((row) => ({
    id: row.id as string,
    userId: row.userId as string,
    title: row.title as string,
    archived: Boolean(row.archived),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  }));
}

export function createThread(
  userId: string,
  id?: string,
  title?: string,
): ThreadRecord {
  const now = new Date().toISOString();
  const threadId = id ?? crypto.randomUUID();
  const threadTitle = title?.trim() || "Chat";

  db.prepare(
    "INSERT OR IGNORE INTO threads (id, userId, title, archived, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  ).run(threadId, userId, threadTitle, now, now);

  let row = db
    .prepare<[], any>(
      "SELECT id, userId, title, archived, createdAt, updatedAt FROM threads WHERE id = ? AND userId = ?",
    )
    .get(threadId, userId);

  // Backward-compatibility: if a thread with this id exists but is associated
  // with the legacy 'local-dev' user, migrate it to the current userId.
  if (!row) {
    const legacyRow = db
      .prepare<[], any>(
        "SELECT id, userId, title, archived, createdAt, updatedAt FROM threads WHERE id = ?",
      )
      .get(threadId);

    if (legacyRow && legacyRow.userId === "local-dev") {
      db.prepare(
        "UPDATE threads SET userId = ? WHERE id = ? AND userId = 'local-dev'",
      ).run(userId, threadId);

      row = db
        .prepare<[], any>(
          "SELECT id, userId, title, archived, createdAt, updatedAt FROM threads WHERE id = ? AND userId = ?",
        )
        .get(threadId, userId);
    }
  }

  if (!row) {
    // As a final fallback, create a fresh row for this id and user.
    db.prepare(
      "INSERT OR REPLACE INTO threads (id, userId, title, archived, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
    ).run(threadId, userId, threadTitle, now, now);

    row = db
      .prepare<[], any>(
        "SELECT id, userId, title, archived, createdAt, updatedAt FROM threads WHERE id = ? AND userId = ?",
      )
      .get(threadId, userId);
  }

  return {
    id: row.id as string,
    userId: row.userId as string,
    title: row.title as string,
    archived: Boolean(row.archived),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export function updateThread(
  userId: string,
  id: string,
  updates: Partial<Pick<ThreadRecord, "title" | "archived">>,
): void {
  const now = new Date().toISOString();
  const existing = db
    .prepare<[], any>(
      "SELECT id, title, archived FROM threads WHERE id = ? AND userId = ?",
    )
    .get(id, userId);

  if (!existing) return;

  const title =
    updates.title !== undefined
      ? updates.title.trim() || "Chat"
      : (existing.title as string);
  const archived =
    updates.archived !== undefined
      ? updates.archived
      : Boolean(existing.archived);

  db.prepare(
    "UPDATE threads SET title = ?, archived = ?, updatedAt = ? WHERE id = ? AND userId = ?",
  ).run(title, archived ? 1 : 0, now, id, userId);
}

export function deleteThread(userId: string, id: string): void {
  db
    .prepare("DELETE FROM threads WHERE id = ? AND userId = ?")
    .run(id, userId);
}

export function getMessages(userId: string, threadId: string): MessageRecord[] {
  const rows = db
    .prepare<[], any>(
      `SELECT m.id, m.threadId, m.role, m.content, m.createdAt
       FROM messages m
       JOIN threads t ON t.id = m.threadId
       WHERE m.threadId = ? AND t.userId = ?
       ORDER BY m.createdAt ASC`,
    )
    .all(threadId, userId);

  return rows.map((row) => ({
    id: row.id as string,
    threadId: row.threadId as string,
    role: row.role as MessageRecord["role"],
    content: JSON.parse(row.content as string),
    createdAt: row.createdAt as string,
  }));
}

export function appendMessage(
  userId: string,
  message: MessageRecord,
): void {
  // Ensure the thread belongs to the given user before appending
  const thread = db
    .prepare<[], any>(
      "SELECT id FROM threads WHERE id = ? AND userId = ?",
    )
    .get(message.threadId, userId);

  if (!thread) return;

  db.prepare(
    "INSERT OR REPLACE INTO messages (id, threadId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)",
  ).run(
    message.id,
    message.threadId,
    message.role,
    JSON.stringify(message.content ?? null),
    message.createdAt,
  );

  // Touch thread updatedAt when a new message is added
  const now = new Date().toISOString();
  db
    .prepare("UPDATE threads SET updatedAt = ? WHERE id = ?")
    .run(now, message.threadId);
}

export function deleteMessagesByThreadId(
  userId: string,
  threadId: string,
): void {
  // Only delete messages for threads owned by this user
  const thread = db
    .prepare<[], any>(
      "SELECT id FROM threads WHERE id = ? AND userId = ?",
    )
    .get(threadId, userId);

  if (!thread) return;

  db.prepare("DELETE FROM messages WHERE threadId = ?").run(threadId);
}

// Danger-zone helper -------------------------------------------------------

// Delete all persisted data for a given user id, including:
// - all threads owned by the user (and their messages via ON DELETE CASCADE)
// - the user's settings row.
//
// This is intended to be called from a privacy/"delete my data" endpoint and
// must be used with care.
export function deleteAllUserData(userId: string): void {
  const tx = db.transaction((uid: string) => {
    db.prepare("DELETE FROM threads WHERE userId = ?").run(uid);
    db.prepare("DELETE FROM user_settings WHERE userId = ?").run(uid);
  });

  tx(userId);
}
