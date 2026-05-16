import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";

export const auth = betterAuth({
  database: db,
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Disable for local dev
  },
  user: {
    changeEmail: {
      enabled: false,
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  plugins: [nextCookies()],
});

let authSchemaPromise: Promise<void> | null = null;

export function ensureAuthSchema() {
  authSchemaPromise ??= auth.$context
    .then((ctx) => ctx.runMigrations())
    .catch((error) => {
      authSchemaPromise = null;
      throw error;
    });

  return authSchemaPromise;
}

export type Session = typeof auth.$Infer.Session;
