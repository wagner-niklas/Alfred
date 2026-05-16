/**
 * Thread API Routes
 * 
 * Handles thread listing and creation for the Alfred chat interface.
 * 
 * - GET  /api/threads - Returns all threads for the current user
 * - POST /api/threads - Creates a new thread with optional ID and title
 * 
 * User identity is derived from the Better Auth session.
 */

import { NextResponse } from "next/server";
import { createThread, getThreads } from "@/lib/db";
import { isUnauthorizedError, requireAuthenticatedUserId } from "@/lib/user";

/**
 * Type definition for thread creation request body.
 */
type ThreadCreateRequest = {
  id?: string;
  title?: string;
};

/**
 * Parses and validates the thread creation request body.
 */
function parseThreadCreateBody(rawBody: unknown): ThreadCreateRequest {
  const body = rawBody as Record<string, unknown>;
  
  return {
    id: typeof body.id === "string" ? body.id : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
  };
}

/**
 * GET handler - Returns all threads for the current user.
 * 
 * Threads are ordered by most recently updated.
 */
export async function GET(): Promise<NextResponse> {
  let userId: string;

  try {
    userId = await requireAuthenticatedUserId();
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  const threads = getThreads(userId);

  return NextResponse.json(threads);
}

/**
 * POST handler - Creates a new thread.
 * 
 * Optionally accepts an ID and title in the request body.
 * If no ID is provided, a UUID will be generated automatically.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let userId: string;

  try {
    userId = await requireAuthenticatedUserId();
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  const rawBody = await req.json().catch(() => ({}));
  const { id, title } = parseThreadCreateBody(rawBody);

  const thread = createThread(userId, id, title);
  
  return NextResponse.json(thread);
}
