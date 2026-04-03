import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Server-side SQLite database setup for thread & message persistence.
// This file must only be imported from server-side code (e.g. route handlers).

const dbFilePath = path.join(process.cwd(), "data", "alfred.sqlite");

// Ensure the data directory exists
fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

/**
 * Singleton better-sqlite3 connection used by the server to persist
 * threads, messages, and per-user settings.
 */
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

  -- per user config
  CREATE TABLE IF NOT EXISTS user_settings (
    userId TEXT PRIMARY KEY,
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

const settingsColumns = db.prepare("PRAGMA table_info(user_settings)").all() as {
  name: string;
}[];
const hasAdditionalInstructionsColumn = settingsColumns.some(
  (col) => col.name === "additional_instructions",
);

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

export type UserSettings = {
  userId: string;
  additionalInstructions?: string | null;
  // Timestamps are stored in the database but optional in the in-memory
  // representation to keep the type lightweight for most callers.
  createdAt?: string;
  updatedAt?: string;
};

type ThreadRow = {
  id: string;
  userId: string;
  title: string;
  archived: number;
  createdAt: string;
  updatedAt: string;
};

type ThreadUpdateRow = {
  id: string;
  title: string;
  archived: number;
};

type UserSettingsRow = {
  userId: string;
  additional_instructions: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Fetch decrypted user settings for the given user id.
 *
 * Returns `null` when no settings row exists yet.
 */
export function getUserSettings(userId: string): UserSettings | null {
  const row = db
    .prepare<[string], UserSettingsRow>(
      "SELECT userId, additional_instructions, createdAt, updatedAt FROM user_settings WHERE userId = ?",
    )
    .get(userId);

  if (!row) return null;

  return {
    userId: row.userId,
    additionalInstructions: row.additional_instructions ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Insert or update the settings row for a given user.
 *
 * - Only persists the per-user `additionalInstructions` text alongside
 *   the `userId` and timestamps.
 * - Merges partial updates with any existing row.
 */
export function upsertUserSettings(
  userId: string,
  settings: Partial<
    Pick<
      UserSettings,
      "additionalInstructions"
    >
  >,
): UserSettings {
  const existing = getUserSettings(userId);


  const merged: UserSettings = {
    userId,
    additionalInstructions:
      settings.additionalInstructions !== undefined
        ? settings.additionalInstructions ?? null
        : existing?.additionalInstructions ?? null,
  };

  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO user_settings (userId, additional_instructions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET
       additional_instructions = excluded.additional_instructions,
       updatedAt = excluded.updatedAt`,
  ).run(
    merged.userId,
    merged.additionalInstructions ?? null,
    existing ? existing.createdAt ?? now : now,
    now,
  );

  return merged;
}

/**
 * Return all threads for the given user, ordered by most recently updated.
 */
export function getThreads(userId: string): ThreadRecord[] {
  const rows = db
    .prepare<[string], ThreadRow>(
      "SELECT id, userId, title, archived, createdAt, updatedAt FROM threads WHERE userId = ? ORDER BY updatedAt DESC",
    )
    .all(userId);

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    title: row.title,
    archived: Boolean(row.archived),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/**
 * Create a thread for the given user.
 *
 * If an id is provided and an existing legacy thread with that id belongs
 * to the special "local-dev" user, it will be migrated to the new user
 * instead of creating a duplicate row.
 */
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
    .prepare<[string, string], ThreadRow>(
      "SELECT id, userId, title, archived, createdAt, updatedAt FROM threads WHERE id = ? AND userId = ?",
    )
    .get(threadId, userId);

  // Backward-compatibility: if a thread with this id exists but is associated
  // with the legacy 'local-dev' user, migrate it to the current userId.
  if (!row) {
    const legacyRow = db
      .prepare<[string], ThreadRow>(
        "SELECT id, userId, title, archived, createdAt, updatedAt FROM threads WHERE id = ?",
      )
      .get(threadId);

    if (legacyRow && legacyRow.userId === "local-dev") {
      db.prepare(
        "UPDATE threads SET userId = ? WHERE id = ? AND userId = 'local-dev'",
      ).run(userId, threadId);

      row = db
        .prepare<[string, string], ThreadRow>(
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
      .prepare<[string, string], ThreadRow>(
        "SELECT id, userId, title, archived, createdAt, updatedAt FROM threads WHERE id = ? AND userId = ?",
      )
      .get(threadId, userId);
  }

  if (!row) {
    throw new Error("Failed to create or load thread row");
  }

  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    archived: Boolean(row.archived),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Update a thread's title and/or archived flag for a given user.
 *
 * A missing row is treated as a no-op.
 */
export function updateThread(
  userId: string,
  id: string,
  updates: Partial<Pick<ThreadRecord, "title" | "archived">>,
): void {
  const now = new Date().toISOString();
  const existing = db
    .prepare<[string, string], ThreadUpdateRow>(
      "SELECT id, title, archived FROM threads WHERE id = ? AND userId = ?",
    )
    .get(id, userId);

  if (!existing) return;

  const title =
    updates.title !== undefined
      ? updates.title.trim() || "Chat"
      : existing.title;
  const archived =
    updates.archived !== undefined
      ? updates.archived
      : Boolean(existing.archived);

  db.prepare(
    "UPDATE threads SET title = ?, archived = ?, updatedAt = ? WHERE id = ? AND userId = ?",
  ).run(title, archived ? 1 : 0, now, id, userId);
}

/**
 * Delete a single thread and its messages (via ON DELETE CASCADE).
 */
export function deleteThread(userId: string, id: string): void {
  db.prepare("DELETE FROM threads WHERE id = ? AND userId = ?").run(id, userId);
}

export function getMessages(userId: string, threadId: string): MessageRecord[] {
  type MessageRow = {
    id: string;
    threadId: string;
    role: MessageRecord["role"];
    content: string;
    createdAt: string;
  };

  const rows = db
    .prepare<[string, string], MessageRow>(
      `SELECT m.id, m.threadId, m.role, m.content, m.createdAt
       FROM messages m
       JOIN threads t ON t.id = m.threadId
       WHERE m.threadId = ? AND t.userId = ?
       ORDER BY m.createdAt ASC`,
    )
    .all(threadId, userId);

  return rows.map((row) => ({
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: JSON.parse(row.content),
    createdAt: row.createdAt,
  }));
}

/**
 * Append (or upsert) a message for a thread owned by the given user.
 *
 * If the thread does not belong to the user, the call is a no-op.
 */
export function appendMessage(
  userId: string,
  message: MessageRecord,
): void {
  // Ensure the thread belongs to the given user before appending
  const thread = db
    .prepare("SELECT id FROM threads WHERE id = ? AND userId = ?")
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
    .prepare("SELECT id FROM threads WHERE id = ? AND userId = ?")
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