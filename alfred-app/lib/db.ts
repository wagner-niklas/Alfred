import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

/**
 * Server-side SQLite database setup for thread & message persistence.
 * 
 * This file must only be imported from server-side code (e.g. route handlers).
 * Uses WAL journal mode for better concurrency and foreign keys for referential integrity.
 */

// Database configuration
const DATABASE_DIRECTORY = "data";
const DATABASE_FILENAME = "alfred.sqlite";

// Table names
const TABLE_THREADS = "threads";
const TABLE_MESSAGES = "messages";
const TABLE_USER_SETTINGS = "user_settings";

// Column defaults
const DEFAULT_THREAD_TITLE = "Chat";

/**
 * Builds the absolute path to the SQLite database file.
 */
function getDatabaseFilePath(): string {
  return path.join(process.cwd(), DATABASE_DIRECTORY, DATABASE_FILENAME);
}

/**
 * Ensures the database directory exists.
 */
function ensureDatabaseDirectory(): void {
  const dbPath = getDatabaseFilePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

/**
 * Initializes the database schema if tables don't exist.
 */
function initializeSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_THREADS} (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '${DEFAULT_THREAD_TITLE}',
      archived INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${TABLE_MESSAGES} (
      id TEXT PRIMARY KEY,
      threadId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (threadId) REFERENCES ${TABLE_THREADS}(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ${TABLE_USER_SETTINGS} (
      userId TEXT PRIMARY KEY,
      additional_instructions TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
}

/**
 * Runs schema migrations for backward compatibility.
 */
function runMigrations(database: Database.Database): void {
  // Add additional_instructions column to user_settings table if missing
  const settingsColumns = database.prepare("PRAGMA table_info(user_settings)").all() as { name: string }[];
  const hasAdditionalInstructionsColumn = settingsColumns.some(
    (col) => col.name === "additional_instructions",
  );

  if (!hasAdditionalInstructionsColumn) {
    database.exec(
      `ALTER TABLE ${TABLE_USER_SETTINGS} ADD COLUMN additional_instructions TEXT`,
    );
  }
}

// Initialize database connection
ensureDatabaseDirectory();
const dbFilePath = getDatabaseFilePath();

/**
 * Singleton better-sqlite3 connection used by the server to persist
 * threads, messages, and per-user settings.
 */
export const db = new Database(dbFilePath);

// Configure database pragmas for better concurrency & safety
db.pragma("journal_mode = WAL");
initializeSchema(db);
runMigrations(db);
db.pragma("foreign_keys = ON");

// Type definitions
export type ThreadRecord = {
  id: string;
  userId: string;
  title: string;
  archived: boolean;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
};

export type MessageRecord = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: unknown; // Parsed JSON content
  createdAt: string; // ISO date string
};

export type UserSettings = {
  userId: string;
  additionalInstructions?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

// Internal row types matching database schema
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

function tableExists(tableName: string): boolean {
  return Boolean(
    db
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(tableName),
  );
}

/**
 * Fetches user settings for the given user ID.
 * 
 * @param userId - The user ID to fetch settings for
 * @returns User settings object or null if no settings exist
 */
export function getUserSettings(userId: string): UserSettings | null {
  const row = db
    .prepare<[string], UserSettingsRow>(
      `SELECT userId, additional_instructions, createdAt, updatedAt FROM ${TABLE_USER_SETTINGS} WHERE userId = ?`,
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
 * Inserts or updates user settings.
 * 
 * Merges partial updates with any existing row.
 * 
 * @param userId - The user ID to upsert settings for
 * @param settings - Partial settings to update
 * @returns The merged user settings
 */
export function upsertUserSettings(
  userId: string,
  settings: Partial<Pick<UserSettings, "additionalInstructions">>,
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
    `INSERT INTO ${TABLE_USER_SETTINGS} (userId, additional_instructions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET
       additional_instructions = excluded.additional_instructions,
       updatedAt = excluded.updatedAt`,
  ).run(
    merged.userId,
    merged.additionalInstructions ?? null,
    existing?.createdAt ?? now,
    now,
  );

  return merged;
}

/**
 * Retrieves all threads for the given user, ordered by most recently updated.
 * 
 * @param userId - The user ID to fetch threads for
 * @returns Array of thread records
 */
export function getThreads(userId: string): ThreadRecord[] {
  const rows = db
    .prepare<[string], ThreadRow>(
      `SELECT id, userId, title, archived, createdAt, updatedAt FROM ${TABLE_THREADS} WHERE userId = ? ORDER BY updatedAt DESC`,
    )
    .all(userId);

  return rows.map(convertThreadRowToRecord);
}

/**
 * Converts a raw database thread row to a ThreadRecord.
 */
function convertThreadRowToRecord(row: ThreadRow): ThreadRecord {
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
 * Creates a new thread for the given user.
 *
 * @param userId - The user ID to create the thread for
 * @param id - Optional thread ID (auto-generated if not provided)
 * @param title - Optional thread title (defaults to "Chat")
 * @returns The created thread record
 */
export function createThread(
  userId: string,
  id?: string,
  title?: string,
): ThreadRecord {
  const now = new Date().toISOString();
  const threadId = id ?? crypto.randomUUID();
  const threadTitle = title?.trim() || DEFAULT_THREAD_TITLE;

  // Try to insert or ignore
  db.prepare(
    `INSERT OR IGNORE INTO ${TABLE_THREADS} (id, userId, title, archived, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`,
  ).run(threadId, userId, threadTitle, now, now);

  // Try to get the thread
  let row = getThreadRowById(db, threadId, userId);

  // Final fallback: create fresh row
  if (!row) {
    db.prepare(
      `INSERT OR REPLACE INTO ${TABLE_THREADS} (id, userId, title, archived, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`,
    ).run(threadId, userId, threadTitle, now, now);

    row = getThreadRowById(db, threadId, userId);
  }

  if (!row) {
    throw new Error("Failed to create or load thread row");
  }

  return convertThreadRowToRecord(row);
}

/**
 * Helper to get a thread row by ID and user ID.
 */
function getThreadRowById(
  database: Database.Database,
  threadId: string,
  userId: string,
): ThreadRow | undefined {
  return db
    .prepare<[string, string], ThreadRow>(
      `SELECT id, userId, title, archived, createdAt, updatedAt FROM ${TABLE_THREADS} WHERE id = ? AND userId = ?`,
    )
    .get(threadId, userId);
}

/**
 * Updates a thread's title and/or archived flag for the given user.
 * 
 * A missing row is treated as a no-op.
 * 
 * @param userId - The user ID who owns the thread
 * @param id - The thread ID to update
 * @param updates - Partial updates to apply
 */
export function updateThread(
  userId: string,
  id: string,
  updates: Partial<Pick<ThreadRecord, "title" | "archived">>,
): void {
  const now = new Date().toISOString();
  const existing = db
    .prepare<[string, string], ThreadUpdateRow>(
      `SELECT id, title, archived FROM ${TABLE_THREADS} WHERE id = ? AND userId = ?`,
    )
    .get(id, userId);

  if (!existing) return;

  const title =
    updates.title !== undefined
      ? updates.title.trim() || DEFAULT_THREAD_TITLE
      : existing.title;
  const archived =
    updates.archived !== undefined
      ? updates.archived
      : Boolean(existing.archived);

  db.prepare(
    `UPDATE ${TABLE_THREADS} SET title = ?, archived = ?, updatedAt = ? WHERE id = ? AND userId = ?`,
  ).run(title, archived ? 1 : 0, now, id, userId);
}

/**
 * Deletes a thread and its messages (via ON DELETE CASCADE).
 * 
 * @param userId - The user ID who owns the thread
 * @param id - The thread ID to delete
 */
export function deleteThread(userId: string, id: string): void {
  db.prepare(`DELETE FROM ${TABLE_THREADS} WHERE id = ? AND userId = ?`).run(id, userId);
}

/**
 * Retrieves all messages for a thread owned by the given user.
 * 
 * @param userId - The user ID who owns the thread
 * @param threadId - The thread ID to fetch messages for
 * @returns Array of message records ordered by creation time
 */
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
       FROM ${TABLE_MESSAGES} m
       JOIN ${TABLE_THREADS} t ON t.id = m.threadId
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
 * Appends (or upserts) a message to a thread owned by the given user.
 * 
 * Throws an error if the thread does not exist or does not belong to the user.
 * 
 * @param userId - The user ID who owns the thread
 * @param message - The message record to append
 */
export function appendMessage(
  userId: string,
  message: MessageRecord,
): void {
  // Verify thread ownership before appending
  const thread = db
    .prepare(`SELECT id FROM ${TABLE_THREADS} WHERE id = ? AND userId = ?`)
    .get(message.threadId, userId);

  if (!thread) {
    throw new Error(
      `Thread '${message.threadId}' not found for user '${userId}'`
    );
  }

  db.prepare(
    `INSERT OR REPLACE INTO ${TABLE_MESSAGES} (id, threadId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.threadId,
    message.role,
    JSON.stringify(message.content ?? null),
    message.createdAt,
  );

  // Update thread's updatedAt timestamp
  const now = new Date().toISOString();
  db
    .prepare(`UPDATE ${TABLE_THREADS} SET updatedAt = ? WHERE id = ?`)
    .run(now, message.threadId);
}

/**
 * Deletes all messages for a thread owned by the given user.
 * 
 * @param userId - The user ID who owns the thread
 * @param threadId - The thread ID to delete messages for
 */
export function deleteMessagesByThreadId(
  userId: string,
  threadId: string,
): void {
  // Verify thread ownership before deleting
  const thread = db
    .prepare(`SELECT id FROM ${TABLE_THREADS} WHERE id = ? AND userId = ?`)
    .get(threadId, userId);

  if (!thread) return;

  db.prepare(`DELETE FROM ${TABLE_MESSAGES} WHERE threadId = ?`).run(threadId);
}

/**
 * Deletes all data for a given user ID.
 * 
 * This is a dangerous operation intended only for privacy/"delete my data" endpoints.
 * Deletes:
 * - All threads owned by the user (and their messages via ON DELETE CASCADE)
 * - The user's settings row
 * 
 * @param userId - The user ID to delete all data for
 */
export function deleteAllUserData(userId: string): void {
  const tx = db.transaction((uid: string) => {
    db.prepare(`DELETE FROM ${TABLE_THREADS} WHERE userId = ?`).run(uid);
    db.prepare(`DELETE FROM ${TABLE_USER_SETTINGS} WHERE userId = ?`).run(uid);
  });

  tx(userId);
}

/**
 * Deletes all app data plus the Better Auth account for a user.
 *
 * Deleting the auth user removes provider accounts and sessions through
 * Better Auth's SQLite foreign-key cascades; the explicit deletes below keep
 * the operation correct even if a future schema changes those constraints.
 */
export function deleteUserAccountAndData(userId: string): void {
  const tx = db.transaction((uid: string) => {
    db.prepare(`DELETE FROM ${TABLE_THREADS} WHERE userId = ?`).run(uid);
    db.prepare(`DELETE FROM ${TABLE_USER_SETTINGS} WHERE userId = ?`).run(uid);

    if (tableExists("account")) {
      db.prepare(`DELETE FROM account WHERE userId = ?`).run(uid);
    }

    if (tableExists("session")) {
      db.prepare(`DELETE FROM session WHERE userId = ?`).run(uid);
    }

    if (tableExists("user")) {
      db.prepare(`DELETE FROM user WHERE id = ?`).run(uid);
    }
  });

  tx(userId);
}
