import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

const encoder = new TextEncoder();
const SESSION_COOKIE = "__Host-MEDICAL_RESEARCH_SESSION";
const OAUTH_STATE_COOKIE = "__Host-MEDICAL_RESEARCH_OAUTH_STATE";
const CONSENT_COOKIE = "__Host-MEDICAL_RESEARCH_CONSENT";
const CSRF_COOKIE = "__Host-MEDICAL_RESEARCH_CSRF";
const TEN_MINUTES = 600;
const EIGHT_HOURS = 28_800;

export interface AuthenticatedUser {
  userId: string;
  login: string;
  displayName: string;
  avatarUrl?: string;
  scopes?: string[];
}

export function parseAuthenticatedUser(value: unknown): AuthenticatedUser | null {
  if (
    !isRecord(value) ||
    typeof value.userId !== "string" ||
    typeof value.login !== "string" ||
    typeof value.displayName !== "string" ||
    (value.avatarUrl !== undefined && typeof value.avatarUrl !== "string") ||
    (value.scopes !== undefined &&
      (!Array.isArray(value.scopes) || value.scopes.some((scope) => typeof scope !== "string")))
  ) {
    return null;
  }
  return {
    userId: value.userId,
    login: value.login,
    displayName: value.displayName,
    ...(value.avatarUrl ? { avatarUrl: value.avatarUrl } : {}),
    ...(value.scopes ? { scopes: value.scopes } : {})
  };
}

interface SessionPayload extends AuthenticatedUser {
  expiresAt: number;
}

interface ConsentPayload {
  state: string;
  request: AuthRequest;
  expiresAt: number;
}

interface OAuthFlowPayload {
  state: string;
  flow: PendingOAuthFlow;
  expiresAt: number;
}

export type PendingOAuthFlow =
  | { kind: "mcp"; request: AuthRequest }
  | { kind: "account"; returnTo: "/account" };

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function createCsrfCookie(token: string): string {
  return serializeCookie(CSRF_COOKIE, token, TEN_MINUTES);
}

export function clearCsrfCookie(): string {
  return clearCookie(CSRF_COOKIE);
}

export async function createConsentCookie(
  state: string,
  request: AuthRequest,
  secret: string,
  now = Date.now()
): Promise<string> {
  return serializeSignedCookie(
    CONSENT_COOKIE,
    { state, request, expiresAt: Math.floor(now / 1000) + TEN_MINUTES },
    secret,
    TEN_MINUTES
  );
}

export function clearConsentCookie(): string {
  return clearCookie(CONSENT_COOKIE);
}

export async function readConsentCookie(
  request: Request,
  expectedState: string,
  secret: string,
  now = Date.now()
): Promise<AuthRequest | null> {
  const parsed = await readSignedCookie(request, CONSENT_COOKIE, secret);
  if (
    !isRecord(parsed) ||
    parsed.state !== expectedState ||
    typeof parsed.expiresAt !== "number" ||
    parsed.expiresAt <= Math.floor(now / 1000) ||
    !isAuthRequest(parsed.request)
  ) {
    return null;
  }
  return parsed.request;
}

export async function validateCsrf(request: Request, suppliedToken: string): Promise<boolean> {
  const cookieToken = readCookie(request, CSRF_COOKIE);
  if (!cookieToken) return false;
  return timingSafeStringEqual(suppliedToken, cookieToken);
}

export async function createOAuthStateCookie(
  state: string,
  flow: PendingOAuthFlow,
  secret: string,
  now = Date.now()
): Promise<string> {
  return serializeSignedCookie(
    OAUTH_STATE_COOKIE,
    { state, flow, expiresAt: Math.floor(now / 1000) + TEN_MINUTES },
    secret,
    TEN_MINUTES
  );
}

export function clearOAuthStateCookie(): string {
  return clearCookie(OAUTH_STATE_COOKIE);
}

export async function validateOAuthStateCookie(
  request: Request,
  state: string,
  secret: string,
  now = Date.now()
): Promise<PendingOAuthFlow | null> {
  const parsed = await readSignedCookie(request, OAUTH_STATE_COOKIE, secret);
  if (
    !isRecord(parsed) ||
    parsed.state !== state ||
    typeof parsed.expiresAt !== "number" ||
    parsed.expiresAt <= Math.floor(now / 1000)
  ) {
    return null;
  }
  return parsePendingOAuthFlow(JSON.stringify(parsed.flow));
}

export async function createSessionCookie(
  user: AuthenticatedUser,
  secret: string,
  now = Date.now()
): Promise<string> {
  const payload: SessionPayload = {
    ...user,
    expiresAt: Math.floor(now / 1000) + EIGHT_HOURS
  };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(encoded, secret);
  return serializeCookie(SESSION_COOKIE, `${encoded}.${signature}`, EIGHT_HOURS);
}

export function clearSessionCookie(): string {
  return clearCookie(SESSION_COOKIE);
}

export async function readSession(
  request: Request,
  secret: string,
  now = Date.now()
): Promise<AuthenticatedUser | null> {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = value.slice(0, separator);
  const suppliedSignature = value.slice(separator + 1);
  if (!(await timingSafeStringEqual(suppliedSignature, await sign(encoded, secret)))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
  } catch {
    return null;
  }
  if (!isSessionPayload(parsed) || parsed.expiresAt <= Math.floor(now / 1000)) return null;
  return {
    userId: parsed.userId,
    login: parsed.login,
    displayName: parsed.displayName,
    ...(parsed.avatarUrl ? { avatarUrl: parsed.avatarUrl } : {})
  };
}

export function parsePendingOAuthFlow(value: string): PendingOAuthFlow | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.kind === "account" && parsed.returnTo === "/account") {
    return { kind: "account", returnTo: "/account" };
  }
  if (parsed.kind === "mcp" && isAuthRequest(parsed.request)) {
    return { kind: "mcp", request: parsed.request };
  }
  return null;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export async function timingSafeStringEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (first: ArrayBufferView, second: ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(leftHash, rightHash);
  }
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index]! ^ rightHash[index]!;
  }
  return difference === 0;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  return (
    parseAuthenticatedUser(value) !== null &&
    isRecord(value) &&
    typeof value.expiresAt === "number"
  );
}

function isAuthRequest(value: unknown): value is AuthRequest {
  return (
    isRecord(value) &&
    typeof value.responseType === "string" &&
    typeof value.clientId === "string" &&
    typeof value.redirectUri === "string" &&
    Array.isArray(value.scope) &&
    value.scope.every((scope) => typeof scope === "string") &&
    typeof value.state === "string" &&
    (value.codeChallenge === undefined || typeof value.codeChallenge === "string") &&
    (value.codeChallengeMethod === undefined || typeof value.codeChallengeMethod === "string") &&
    (value.resource === undefined ||
      typeof value.resource === "string" ||
      (Array.isArray(value.resource) && value.resource.every((item) => typeof item === "string"))) &&
    (value.issuer === undefined || typeof value.issuer === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

async function serializeSignedCookie(
  name: string,
  payload: ConsentPayload | OAuthFlowPayload,
  secret: string,
  maxAge: number
): Promise<string> {
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const value = `${encoded}.${await sign(encoded, secret)}`;
  const cookie = serializeCookie(name, value, maxAge);
  if (cookie.length > 4_096) throw new Error("Signed browser state exceeds the cookie size limit.");
  return cookie;
}

async function readSignedCookie(request: Request, name: string, secret: string): Promise<unknown> {
  const value = readCookie(request, name);
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = value.slice(0, separator);
  const suppliedSignature = value.slice(separator + 1);
  if (!(await timingSafeStringEqual(suppliedSignature, await sign(encoded, secret)))) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
  } catch {
    return null;
  }
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
