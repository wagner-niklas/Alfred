import { NextResponse } from "next/server";
import { attachSetCookieHeader, getOrCreateUserId } from "@/lib/user";
import { UserSettings, getUserSettings, upsertUserSettings } from "@/lib/db";
import type { SettingsPayload, SettingsResponse } from "@/lib/settings/types";

export async function GET(req: Request) {
  const { userId, setCookieHeader } = getOrCreateUserId(req);

  const settings = (getUserSettings(userId) ?? { userId }) as UserSettings;

  const response = NextResponse.json<SettingsResponse>({
    userId: settings.userId,
    additionalInstructions: settings.additionalInstructions ?? null,
  });
  return attachSetCookieHeader(response, setCookieHeader);
}

export async function PUT(req: Request) {
  const { userId, setCookieHeader } = getOrCreateUserId(req);

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

  return attachSetCookieHeader(response, setCookieHeader);
}
