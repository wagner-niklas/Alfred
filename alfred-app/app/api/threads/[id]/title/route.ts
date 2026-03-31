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

// Minimal subset of the Assistant UI message format used for deriving
// a human-readable thread title. We only care about user messages with
// text content parts.
type TextContentPart = {
  type: "text";
  text: string;
};

type TitleSourceMessage = {
  role: string;
  content?: TextContentPart[];
};

export async function POST(req: Request, context: RouteContext) {
  const { userId } = getOrCreateUserId(req);
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const { messages } = body as { messages?: TitleSourceMessage[] };

  let title = "Chat";

  if (Array.isArray(messages)) {
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser && Array.isArray(firstUser.content)) {
      const textParts = firstUser.content
        .filter(
          (part): part is TextContentPart =>
            part.type === "text" && typeof part.text === "string",
        )
        .map((part) => part.text);
      const combined = textParts.join(" ").trim();
      if (combined) {
        title = combined.length > 15 ? combined.slice(0, 15) + "..." : combined;
      }
    }
  }

  updateThread(userId, id, { title });

  return Response.json({ title });
}
