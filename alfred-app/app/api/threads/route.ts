/**
 * Thread API Routes
 * 
 * Handles thread listing and creation for the Alfred chat interface.
 * 
 * - GET  /api/threads - Returns all threads for the current user
 * - POST /api/threads - Creates a new thread with optional ID and title
 * 
 * User identity is derived from an anonymous HTTP-only cookie.
 */

import { NextResponse } from "next/server";
import { createThread, getThreads } from "@/lib/db";
import { getOrCreateUserId } from "@/lib/user";

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
 * Creates a response with the user ID cookie attached if needed.
 */
function createResponseWithData<T>(data: T, setCookieHeader?: string): NextResponse<T> {
  const response = NextResponse.json(data);
  
  if (setCookieHeader) {
    response.headers.set("Set-Cookie", setCookieHeader);
  }
  
  return response;
}

/**
 * GET handler - Returns all threads for the current user.
 * 
 * Threads are ordered by most recently updated.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const { userId, setCookieHeader } = getOrCreateUserId(req);
  const threads = getThreads(userId);

  return createResponseWithData(threads, setCookieHeader);
}

/**
 * POST handler - Creates a new thread.
 * 
 * Optionally accepts an ID and title in the request body.
 * If no ID is provided, a UUID will be generated automatically.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const { userId, setCookieHeader } = getOrCreateUserId(req);
  const rawBody = await req.json().catch(() => ({}));
  const { id, title } = parseThreadCreateBody(rawBody);

  const thread = createThread(userId, id, title);
  
  return createResponseWithData(thread, setCookieHeader);
}
