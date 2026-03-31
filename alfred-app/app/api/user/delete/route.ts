import { NextResponse } from "next/server";

import { deleteAllUserData } from "@/lib/db";
import { getOrCreateUserId } from "@/lib/user";

// DELETE /api/user/delete
// -----------------------
// Permanently remove all persisted data associated with the current
// cookie-scoped user id:
// - All threads (and their messages via ON DELETE CASCADE)
// - The user's settings row
//
// This endpoint is intentionally narrow in scope and does not affect any
// shared or global resources.

export async function DELETE(req: Request) {
  const { userId } = getOrCreateUserId(req);

  deleteAllUserData(userId);

  // Optionally, we could also clear the cookie here to force creation of a
  // fresh anonymous user id on the next request. For now, we keep the
  // existing id to avoid surprising the caller.

  return NextResponse.json({ success: true });
}
