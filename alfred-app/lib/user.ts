// User identity helper
// --------------------
// We derive a stable, anonymous user id per browser using an HTTP-only
// cookie. This keeps each browser's threads separate without requiring
// authentication. The cookie is set and read in API routes via the Request
// and Response objects, so we don't rely on next/headers here.

const COOKIE_NAME = "alfred_user_id";
const ONE_YEAR = 60 * 60 * 24 * 365; // seconds

function generateId() {
  return crypto.randomUUID();
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [name, ...rest] = part.split("=");
    if (!name) return acc;
    const key = name.trim();
    const value = rest.join("=").trim();
    if (!key) return acc;
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

export function getOrCreateUserId(
  req: Request,
): { userId: string; setCookieHeader?: string } {
  const cookieHeader = req.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const existing = cookies[COOKIE_NAME];

  if (existing) {
    return { userId: existing };
  }

  const userId = generateId();

  // Standard Set-Cookie header; Response.json callers can attach this to
  // ensure the browser stores the id for subsequent requests.
  const setCookieHeader = `${COOKIE_NAME}=${encodeURIComponent(
    userId,
  )}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax`;

  return { userId, setCookieHeader };
}
