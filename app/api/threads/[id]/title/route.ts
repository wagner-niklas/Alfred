// /api/threads/[id]/title
// -----------------------
//
// Endpoint used by the Alfred runtime-provider to generate and persist
// a human-readable title for a thread based on its first user message.
//
// - POST /api/threads/[id]/title
//     * Request body: `{ messages }` in Assistant UI message format.
//     * Behavior: finds the first user message, extracts text content,
//       derives a short title (max ~60 chars), updates the thread record
//       in SQLite via lib/db, and returns `{ title }`.

import { updateThread } from "@/lib/db";
import { getOrCreateUserId } from "@/lib/user";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  const { userId } = getOrCreateUserId(req);
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const { messages } = body as { messages?: any[] };

  let title = "Chat";

  if (Array.isArray(messages)) {
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser && Array.isArray(firstUser.content)) {
      const textParts = firstUser.content
        .filter((p: any) => p.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text as string);
      const combined = textParts.join(" ").trim();
      if (combined) {
        title = combined.length > 60 ? combined.slice(0, 57) + "..." : combined;
      }
    }
  }

  updateThread(userId, id, { title });

  return Response.json({ title });
}
