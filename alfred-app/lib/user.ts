/**
 * User identity helper
 * 
 * Derives a stable, anonymous user ID per browser using an HTTP-only cookie.
 * This keeps each browser's threads separate without requiring authentication.
 * The cookie is set and read in API routes via the Request and Response objects.
 */

// Cookie configuration
const USER_ID_COOKIE_NAME = "alfred_user_id";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // One year in seconds

/**
 * Generates a cryptographically secure random UUID.
 */
function generateUserId(): string {
  return crypto.randomUUID();
}

/**
 * Parses a cookie header string into a record of key-value pairs.
 */
function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};

  return header.split(";").reduce<Record<string, string>>((cookies, part) => {
    const [name, ...rest] = part.split("=");
    if (!name?.trim()) return cookies;

    const key = name.trim();
    const value = rest.join("=").trim();

    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

/**
 * Builds a properly formatted Set-Cookie header value.
 */
function buildSetCookieHeader(userId: string, isSecure: boolean): string {
  const secureAttribute = isSecure ? "; Secure" : "";
  const encodedValue = encodeURIComponent(userId);
  
  return `${USER_ID_COOKIE_NAME}=${encodedValue}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secureAttribute}`;
}

/**
 * Gets or creates a user ID from the request cookie.
 * 
 * If no cookie exists, generates a new user ID and returns it along with
 * the Set-Cookie header to be attached to the response.
 * 
 * @param req - The incoming request object
 * @returns Object containing userId and optional setCookieHeader
 */
export function getOrCreateUserId(
  req: Request,
): { userId: string; setCookieHeader?: string } {
  const cookieHeader = req.headers.get("cookie");
  const cookies = parseCookieHeader(cookieHeader);
  const existingUserId = cookies[USER_ID_COOKIE_NAME];

  if (existingUserId) {
    return { userId: existingUserId };
  }

  const userId = generateUserId();
  
  // Determine if the request is over HTTPS to set the Secure flag appropriately
  const requestUrl = new URL(req.url);
  const isSecure = requestUrl.protocol === "https:";
  const setCookieHeader = buildSetCookieHeader(userId, isSecure);

  return { userId, setCookieHeader };
}
