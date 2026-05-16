/**
 * Message API Routes
 * 
 * Handles message history for individual threads in the Alfred chat interface.
 * 
 * - GET  /api/threads/[id]/messages - Returns all messages for a thread
 * - POST /api/threads/[id]/messages - Appends a message to a thread's history
 * 
 * User identity is derived from an anonymous HTTP-only cookie.
 */

import { NextResponse } from "next/server";
import { appendMessage, getMessages } from "@/lib/db";
import { getOrCreateUserId } from "@/lib/user";

// Type definitions
type RouteContext = {
  params: Promise<{ id: string }>;
};

type MessageRole = "user" | "assistant" | "system";

type MessageRequest = {
  id: string;
  role: MessageRole;
  content: unknown;
  createdAt: string;
};

// Error messages
const ERROR_MESSAGE_SAVE_FAILED = "Failed to save message";
const ERROR_THREAD_NOT_FOUND = "Thread not found";

/**
 * Validates and parses the message request body.
 */
function parseMessageBody(rawBody: unknown): MessageRequest {
  const body = rawBody as Record<string, unknown>;
  
  if (typeof body.id !== "string") {
    throw new Error("Invalid or missing 'id' field");
  }
  if (!isValidMessageRole(body.role)) {
    throw new Error("Invalid or missing 'role' field");
  }
  if (typeof body.createdAt !== "string") {
    throw new Error("Invalid or missing 'createdAt' field");
  }

  return {
    id: body.id,
    role: body.role as MessageRole,
    content: body.content ?? null,
    createdAt: body.createdAt,
  };
}

/**
 * Validates that a value is a valid message role.
 */
function isValidMessageRole(role: unknown): role is MessageRole {
  return role === "user" || role === "assistant" || role === "system";
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
 * Creates an empty response with the user ID cookie attached if needed.
 */
function createEmptyResponse(setCookieHeader?: string): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  
  if (setCookieHeader) {
    response.headers.set("Set-Cookie", setCookieHeader);
  }
  
  return response;
}

/**
 * GET handler - Returns all messages for a thread.
 * 
 * Verifies that the thread belongs to the current user.
 */
export async function GET(
  req: Request,
  context: RouteContext
): Promise<NextResponse> {
  const { userId, setCookieHeader } = getOrCreateUserId(req);
  const { id: threadId } = await context.params;
  const messages = getMessages(userId, threadId);

  return createResponseWithData(messages, setCookieHeader);
}

/**
 * POST handler - Appends a message to a thread's history.
 * 
 * The request body contains a message entry from the AI SDK history adapter.
 */
export async function POST(
  req: Request,
  context: RouteContext
): Promise<NextResponse> {
  const { userId, setCookieHeader } = getOrCreateUserId(req);
  const { id: threadId } = await context.params;
  
  let message: MessageRequest;
  
  try {
    const rawBody = await req.json();
    message = parseMessageBody(rawBody);
  } catch (error) {
    console.error(ERROR_MESSAGE_SAVE_FAILED, error);
    return NextResponse.json(
      { error: ERROR_MESSAGE_SAVE_FAILED },
      { status: 400 }
    );
  }

  try {
    appendMessage(userId, {
      id: message.id,
      threadId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    });
    
    return createEmptyResponse(setCookieHeader);
  } catch (error) {
    console.error(ERROR_MESSAGE_SAVE_FAILED, error);
    
    const errorMessage = error instanceof Error && error.message.includes(ERROR_THREAD_NOT_FOUND)
      ? ERROR_THREAD_NOT_FOUND
      : ERROR_MESSAGE_SAVE_FAILED;
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
