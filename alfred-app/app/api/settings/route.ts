import { NextResponse } from "next/server";

import { getOrCreateUserId } from "@/lib/user";
import { UserSettings, getUserSettings, upsertUserSettings } from "@/lib/db";
import type { SettingsPayload, SettingsResponse } from "@/lib/settings/types";

export async function GET(req: Request) {
  const { userId, setCookieHeader } = getOrCreateUserId(req);

  const settings = (getUserSettings(userId) ?? { userId }) as UserSettings;

  const response = NextResponse.json<SettingsResponse>({
    userId: settings.userId,
    model: settings.model ?? null,
    models: settings.models ?? null,
    embedding: settings.embedding ?? null,
    graph: settings.graph ?? null,
    databricks: settings.databricks ?? null,
    additionalInstructions: settings.additionalInstructions ?? null,
  });

  if (setCookieHeader) {
    response.headers.set("Set-Cookie", setCookieHeader);
  }

  return response;
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

  if ("model" in body) {
    partial.model = body.model ?? null;
  }

  if ("models" in body) {
    partial.models = body.models ?? null;
  }

  if ("embedding" in body) {
    partial.embedding = body.embedding ?? null;
  }

  if ("graph" in body) {
    partial.graph = body.graph ?? null;
  }

  if ("databricks" in body) {
    partial.databricks = body.databricks ?? null;
  }

  if ("additionalInstructions" in body) {
    partial.additionalInstructions = body.additionalInstructions ?? null;
  }

  const updated = upsertUserSettings(userId, partial);

  const response = NextResponse.json<SettingsResponse>({
    userId: updated.userId,
    model: updated.model ?? null,
    models: updated.models ?? null,
    embedding: updated.embedding ?? null,
    graph: updated.graph ?? null,
    databricks: updated.databricks ?? null,
    additionalInstructions: updated.additionalInstructions ?? null,
  });

  if (setCookieHeader) {
    response.headers.set("Set-Cookie", setCookieHeader);
  }

  return response;
}
