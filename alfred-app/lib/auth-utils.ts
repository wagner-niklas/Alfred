import { headers } from "next/headers";
import { auth, ensureAuthSchema } from "@/lib/auth";

/**
 * Gets the current session from the auth cookie.
 * Returns null if no valid session exists.
 */
export async function getCurrentSession() {
  const headerList = await headers();
  const cookie = headerList.get("cookie");

  try {
    await ensureAuthSchema();

    const session = await auth.api.getSession({
      headers: {
        cookie: cookie || "",
      },
    });

    return session as {
      session: {
        id: string;
        userId: string;
        expiresAt: Date;
      };
      user: {
        id: string;
        email: string;
        name: string;
        image?: string | null;
      };
    } | null;
  } catch (error) {
    // Log unexpected errors for debugging while returning null
    // to maintain graceful degradation for invalid sessions
    if (error instanceof Error && error.message !== "Unauthorized") {
      console.error("Session retrieval error:", error);
    }
    return null;
  }
}

/**
 * Gets the current user ID from the session.
 * Returns null if no valid session exists.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.user?.id ?? null;
}

/**
 * Requires a valid session, throws an error if not authenticated.
 */
export async function requireAuth() {
  const session = await getCurrentSession();

  if (!session) {
    throw new Error("Unauthorized");
  }

  return session;
}
