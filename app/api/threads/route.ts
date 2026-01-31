// /api/threads
// ------------
//
// Thread list and creation endpoint used by the Alfred runtime-provider
// and thread list UI.
//
// - GET  /api/threads  -> return all threads for the current (cookie-scoped)
//   user, ordered by updatedAt, using the SQLite-backed helpers in lib/db.
// - POST /api/threads  -> create a new thread (optionally with a specific id
//   or initial title) and return it.
//
// User identity is derived from an anonymous cookie in lib/user; the same
// abstraction can be wired to real auth in production.

import { createThread, getThreads } from "@/lib/db";
import { getOrCreateUserId } from "@/lib/user";

export async function GET(req: Request) {
  const { userId, setCookieHeader } = getOrCreateUserId(req);
  const threads = getThreads(userId);

  const res = Response.json(threads);
  if (setCookieHeader) {
    res.headers.set("Set-Cookie", setCookieHeader);
  }
  return res;
}

export async function POST(req: Request) {
  const { userId, setCookieHeader } = getOrCreateUserId(req);
  const body = await req.json().catch(() => ({}));
  const { id, title } = body as { id?: string; title?: string };

  const thread = createThread(userId, id, title);
  const res = Response.json(thread);
  if (setCookieHeader) {
    res.headers.set("Set-Cookie", setCookieHeader);
  }
  return res;
}
