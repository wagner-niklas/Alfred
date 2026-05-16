import { auth, ensureAuthSchema } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(async (request) => {
  await ensureAuthSchema();
  return auth.handler(request);
});

export const { GET, POST } = handlers;
