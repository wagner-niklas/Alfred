import { NextResponse } from "next/server";

import { deleteUserAccountAndData } from "@/lib/db";
import { isUnauthorizedError, requireAuthenticatedUserId } from "@/lib/user";

const AUTH_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
  "better-auth.session_data",
  "__Secure-better-auth.session_data",
  "better-auth.account_data",
  "__Secure-better-auth.account_data",
  "better-auth.dont_remember",
  "__Secure-better-auth.dont_remember",
];

// DELETE /api/user/delete
// -----------------------
// Permanently delete the logged-in Better Auth user plus all app-owned data.
// This also expires Better Auth cookies so the browser is logged out.
export async function DELETE() {
  let userId: string;

  try {
    userId = await requireAuthenticatedUserId();
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  deleteUserAccountAndData(userId);

  const response = NextResponse.json({ success: true });

  for (const cookieName of AUTH_COOKIE_NAMES) {
    response.cookies.delete(cookieName);
  }

  return response;
}
