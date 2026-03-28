import crypto from "crypto";

// Minimal encryption utilities for sensitive configuration values
// stored in SQLite (API keys, passwords, tokens, etc.).
//
// The goal is to provide authenticated encryption at rest with
// a simple, well-documented format and graceful handling of
// pre-existing unencrypted values.
//
// Format
// ------
// Encrypted values are stored as a UTF-8 string:
//   "enc-v1:" + base64(IV || TAG || CIPHERTEXT)
//
// - Algorithm: AES-256-GCM
// - IV: 12 bytes
// - TAG: 16 bytes (GCM auth tag)
// - CIPHERTEXT: encrypted JSON payload
//
// The master key is provided via the ALFRED_ENCRYPTION_KEY
// environment variable. Existing plaintext values (without the
// "enc-v1:" prefix) are still supported for backward
// compatibility and will be returned as-is after JSON.parse.

const ENCRYPTION_PREFIX = "enc-v1:";
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer | null {
  const raw = process.env.ALFRED_ENCRYPTION_KEY;

  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      // In production we want to be loud; callers may still decide
      // whether to treat this as fatal.
      console.error(
        "[crypto] ALFRED_ENCRYPTION_KEY is not set; sensitive settings will be stored in plaintext.",
      );
    }
    return null;
  }

  // Accept hex, base64, or raw 32-byte UTF-8 keys to keep local
  // development ergonomics while still enforcing 256-bit key size.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  if (/^[A-Za-z0-9+/=]+$/.test(raw)) {
    try {
      const buf = Buffer.from(raw, "base64");
      if (buf.length === 32) return buf;
    } catch {
      // Fall through to UTF-8 handling below.
    }
  }

  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) {
    return utf8;
  }

  console.error(
    "[crypto] ALFRED_ENCRYPTION_KEY must represent 32 bytes (hex, base64, or utf-8); falling back to plaintext storage.",
  );
  return null;
}

export function encryptJson(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  const key = getKey();

  // If no key is configured we intentionally store plaintext JSON.
  if (!key) return json;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return `${ENCRYPTION_PREFIX}${payload}`;
}

export function decryptJson<T>(stored: string | null): T | null {
  if (!stored) return null;

  // Backward compatibility: plain JSON without prefix.
  if (!stored.startsWith(ENCRYPTION_PREFIX)) {
    return JSON.parse(stored) as T;
  }

  const key = getKey();
  if (!key) {
    throw new Error(
      "ALFRED_ENCRYPTION_KEY is required to decrypt sensitive settings but is not configured.",
    );
  }

  const payload = Buffer.from(stored.slice(ENCRYPTION_PREFIX.length), "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const json = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(json) as T;
}
