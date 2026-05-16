import { NextResponse } from "next/server";
import { isUnauthorizedError, requireAuthenticatedUserId } from "@/lib/user";
import { UserSettings, getUserSettings, upsertUserSettings } from "@/lib/db";
import type { SettingsPayload, SettingsResponse } from "@/lib/settings/types";

export async function GET() {
  let userId: string;

  try {
    userId = await requireAuthenticatedUserId();
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  const settings = (getUserSettings(userId) ?? { userId }) as UserSettings;

  const response = NextResponse.json<SettingsResponse>({
    userId: settings.userId,
    additionalInstructions: settings.additionalInstructions ?? null,
  });
  return response;
}

export async function PUT(req: Request) {
  let userId: string;

  try {
    userId = await requireAuthenticatedUserId();
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  let body: SettingsPayload;
  try {
    body = (await req.json()) as SettingsPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Basic structural validation; deeper validation can be added later.
  const partial: SettingsPayload = {};

  if ("additionalInstructions" in body) {
    partial.additionalInstructions = body.additionalInstructions ?? null;
  }

  const updated = upsertUserSettings(userId, partial);

  const response = NextResponse.json<SettingsResponse>({
    userId: updated.userId,
    additionalInstructions: updated.additionalInstructions ?? null,
  });

  return response;
}
