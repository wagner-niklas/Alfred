import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

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
