import { getCurrentSession } from "@/lib/auth-utils";

/**
 * User identity helper
 *
 * Better Auth is the single source of truth for user identity.
 * API routes should reject unauthenticated requests instead of generating
 * anonymous user IDs, otherwise data can be split across multiple owners.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}


/**
 * Gets the authenticated user ID from the session.
 * Returns null if not authenticated.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.user?.id ?? null;
}

/**
 * Gets the authenticated Better Auth user ID.
 *
 * Throws when no valid session exists. Route handlers should convert this to
 * a 401 response.
 */
export async function requireAuthenticatedUserId(): Promise<string> {
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    throw new UnauthorizedError();
  }

  return userId;
}

export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
  return error instanceof UnauthorizedError;
}
