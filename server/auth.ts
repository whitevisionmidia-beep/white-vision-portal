import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { TLSSocket } from "tls";

const COOKIE_NAME = "wv_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;

function sessionSecret(): string | undefined {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function createSessionToken(secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ expiresAt: Date.now() + SESSION_DURATION_SECONDS * 1000 })
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function cookieValue(req: IncomingMessage): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  const prefix = `${COOKIE_NAME}=`;
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

export function hasValidSession(req: IncomingMessage): boolean {
  const secret = sessionSecret();
  const token = cookieValue(req);
  if (!secret || !token) return false;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      expiresAt?: unknown;
    };
    return typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now();
  } catch {
    return false;
  }
}

export function login(
  req: IncomingMessage,
  res: ServerResponse,
  username: string,
  password: string
): "ok" | "unconfigured" | "invalid" {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  const secret = sessionSecret();
  if (!expectedUsername || !expectedPassword || !secret) return "unconfigured";

  if (!safeEqual(username, expectedUsername) || !safeEqual(password, expectedPassword)) {
    return "invalid";
  }

  const forwardedProtocol = req.headers["x-forwarded-proto"];
  const secure = Boolean(
    req.socket instanceof TLSSocket ||
      (typeof forwardedProtocol === "string" &&
        forwardedProtocol.split(",")[0].trim() === "https")
  );
  const attributes = [
    `${COOKIE_NAME}=${createSessionToken(secret)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${SESSION_DURATION_SECONDS}`,
  ];
  if (secure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
  return "ok";
}

export function logout(res: ServerResponse): void {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
  );
}
