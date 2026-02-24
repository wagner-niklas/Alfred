// /api/threads/[id]
// -----------------
//
// Per-thread metadata endpoint for updating or deleting a single thread.
//
// - PATCH /api/threads/[id]
//     * Update title and/or archived flag for the thread belonging to the
//       current (cookie-scoped) user.
// - DELETE /api/threads/[id]
//     * Delete the thread and all of its messages for the current user.
//       Messages are removed explicitly and also via the DB FK constraint.

import { deleteMessagesByThreadId, deleteThread, updateThread } from "@/lib/db";
import { getOrCreateUserId } from "@/lib/user";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: Request, context: RouteContext) {
  const { userId } = getOrCreateUserId(req);
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const { title, archived } = body as {
    title?: string;
    archived?: boolean;
  };

  updateThread(userId, id, {
    ...(title !== undefined ? { title } : {}),
    ...(archived !== undefined ? { archived } : {}),
  });

  return new Response(null, { status: 204 });
}

export async function DELETE(req: Request, context: RouteContext) {
  const { userId } = getOrCreateUserId(req);
  const { id } = await context.params;

  // Delete messages first to be explicit (even though FK has ON DELETE CASCADE)
  deleteMessagesByThreadId(userId, id);
  deleteThread(userId, id);

  return new Response(null, { status: 204 });
}
