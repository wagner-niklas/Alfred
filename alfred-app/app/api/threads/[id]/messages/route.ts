// /api/threads/[id]/messages
// --------------------------
//
// Per-thread message history endpoint used by the Alfred runtime-provider
// to persist and restore chat history for each thread.
//
// - GET  /api/threads/[id]/messages
//     * Return all messages for the thread that belongs to the current
//       (cookie-scoped) user.
// - POST /api/threads/[id]/messages
//     * Append a single message to the thread's history. The request body
//       is a storage entry produced by the AI SDK history adapter, stored
//       as JSON in SQLite via lib/db.

import { appendMessage, getMessages } from "@/lib/db";
import { getOrCreateUserId } from "@/lib/user";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const { userId } = getOrCreateUserId(req);
  const { id } = await context.params;
  const messages = getMessages(userId, id);
  return Response.json(messages);
}

export async function POST(req: Request, context: RouteContext) {
  const { userId } = getOrCreateUserId(req);
  const { id: threadId } = await context.params;
  const body = await req.json();

  const { id, role, content, createdAt } = body as {
    id: string;
    role: "user" | "assistant" | "system";
    content: unknown;
    createdAt: string;
  };

  appendMessage(userId, { id, threadId, role, content, createdAt });

  return new Response(null, { status: 204 });
}
