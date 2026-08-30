import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

const encoder = new TextEncoder();
const SESSION_COOKIE = "__Host-MEDICAL_RESEARCH_SESSION";
const OAUTH_STATE_COOKIE_PREFIX = "__Host-MEDICAL_RESEARCH_OAUTH_STATE_";
const CONSENT_COOKIE_PREFIX = "__Host-MEDICAL_RESEARCH_CONSENT_";
const CSRF_COOKIE = "__Host-MEDICAL_RESEARCH_CSRF";
const CONSENT_STATE_KEY_PREFIX = "medical-research:oauth:consent:";
const OAUTH_FLOW_KEY_PREFIX = "medical-research:oauth:github:";
const STATE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
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

interface StoredConsentPayload {
  request: AuthRequest;
  expiresAt: number;
}

interface StoredOAuthFlowPayload {
  flow: PendingOAuthFlow;
  expiresAt: number;
}

export type AuthorizationStateFailureReason =
  | "invalid_state"
  | "missing_binding"
  | "invalid_binding"
  | "missing_record"
  | "invalid_record"
  | "expired";

export type AuthorizationStateResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AuthorizationStateFailureReason };

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

export async function storeConsentRequest(
  kv: KVNamespace,
  state: string,
  request: AuthRequest,
  secret: string,
  now = Date.now()
): Promise<string> {
  assertValidStateToken(state);
  const payload: StoredConsentPayload = {
    request,
    expiresAt: Math.floor(now / 1000) + TEN_MINUTES
  };
  await kv.put(`${CONSENT_STATE_KEY_PREFIX}${state}`, JSON.stringify(payload), {
    expirationTtl: TEN_MINUTES
  });
  return createStateBindingCookie(CONSENT_COOKIE_PREFIX, state, secret);
}

export function clearConsentCookie(state: string): string {
  return clearCookie(stateCookieName(CONSENT_COOKIE_PREFIX, state));
}

export async function consumeConsentRequest(
  request: Request,
  kv: KVNamespace,
  state: string,
  secret: string,
  now = Date.now()
): Promise<AuthorizationStateResult<AuthRequest>> {
  const binding = await validateStateBindingCookie(
    request,
    CONSENT_COOKIE_PREFIX,
    state,
    secret
  );
  if (!binding.ok) return binding;

  const key = `${CONSENT_STATE_KEY_PREFIX}${state}`;
  const stored = await kv.get(key);
  if (!stored) return { ok: false, reason: "missing_record" };
  await kv.delete(key);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { ok: false, reason: "invalid_record" };
  }
  if (!isRecord(parsed) || typeof parsed.expiresAt !== "number" || !isAuthRequest(parsed.request)) {
    return { ok: false, reason: "invalid_record" };
  }
  if (parsed.expiresAt <= Math.floor(now / 1000)) return { ok: false, reason: "expired" };
  return { ok: true, value: parsed.request };
}

export async function validateCsrf(request: Request, suppliedToken: string): Promise<boolean> {
  const cookieToken = readCookie(request, CSRF_COOKIE);
  if (!cookieToken) return false;
  return timingSafeStringEqual(suppliedToken, cookieToken);
}

export async function storeOAuthFlow(
  kv: KVNamespace,
  state: string,
  flow: PendingOAuthFlow,
  secret: string,
  now = Date.now()
): Promise<string> {
  assertValidStateToken(state);
  const payload: StoredOAuthFlowPayload = {
    flow,
    expiresAt: Math.floor(now / 1000) + TEN_MINUTES
  };
  await kv.put(`${OAUTH_FLOW_KEY_PREFIX}${state}`, JSON.stringify(payload), {
    expirationTtl: TEN_MINUTES
  });
  return createStateBindingCookie(OAUTH_STATE_COOKIE_PREFIX, state, secret);
}

export function clearOAuthStateCookie(state: string): string {
  return clearCookie(stateCookieName(OAUTH_STATE_COOKIE_PREFIX, state));
}

export async function consumeOAuthFlow(
  request: Request,
  kv: KVNamespace,
  state: string,
  secret: string,
  now = Date.now()
): Promise<AuthorizationStateResult<PendingOAuthFlow>> {
  const binding = await validateStateBindingCookie(
    request,
    OAUTH_STATE_COOKIE_PREFIX,
    state,
    secret
  );
  if (!binding.ok) return binding;

  const key = `${OAUTH_FLOW_KEY_PREFIX}${state}`;
  const stored = await kv.get(key);
  if (!stored) return { ok: false, reason: "missing_record" };
  await kv.delete(key);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { ok: false, reason: "invalid_record" };
  }
  if (!isRecord(parsed) || typeof parsed.expiresAt !== "number") {
    return { ok: false, reason: "invalid_record" };
  }
  if (parsed.expiresAt <= Math.floor(now / 1000)) return { ok: false, reason: "expired" };
  const flow = parsePendingOAuthFlow(JSON.stringify(parsed.flow));
  return flow ? { ok: true, value: flow } : { ok: false, reason: "invalid_record" };
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

async function createStateBindingCookie(
  prefix: string,
  state: string,
  secret: string
): Promise<string> {
  const name = stateCookieName(prefix, state);
  const signature = await sign(`${prefix}:${state}`, secret);
  return serializeCookie(name, signature, TEN_MINUTES);
}

async function validateStateBindingCookie(
  request: Request,
  prefix: string,
  state: string,
  secret: string
): Promise<AuthorizationStateResult<never>> {
  if (!isValidStateToken(state)) return { ok: false, reason: "invalid_state" };
  const suppliedSignature = readCookie(request, stateCookieName(prefix, state));
  if (!suppliedSignature) return { ok: false, reason: "missing_binding" };
  const expectedSignature = await sign(`${prefix}:${state}`, secret);
  if (!(await timingSafeStringEqual(suppliedSignature, expectedSignature))) {
    return { ok: false, reason: "invalid_binding" };
  }
  return { ok: true, value: undefined as never };
}

function stateCookieName(prefix: string, state: string): string {
  assertValidStateToken(state);
  return `${prefix}${state}`;
}

function assertValidStateToken(state: string): void {
  if (!isValidStateToken(state)) throw new Error("Invalid OAuth state token.");
}

function isValidStateToken(state: string): boolean {
  return STATE_TOKEN_PATTERN.test(state);
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
