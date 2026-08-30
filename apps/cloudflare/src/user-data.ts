const encoder = new TextEncoder();
const SETTINGS_VERSION = 1;
const SETTINGS_KEY_PREFIX = "provider-settings:";

export interface UserProviderSettings {
  ncbiApiKey?: string;
}

interface StoredSettingsEnvelope {
  version: 1;
  iv: string;
  ciphertext: string;
}

interface StoredSettingsPayload extends UserProviderSettings {
  version: 1;
  updatedAt: string;
}

export async function accountPseudonym(userId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`account-pseudonym-v1\0${userId}`)
  );
  return toBase64Url(new Uint8Array(signature));
}

export async function readUserProviderSettings(
  storage: KVNamespace,
  userId: string,
  secret: string
): Promise<UserProviderSettings | null> {
  const key = await settingsKey(userId, secret);
  const stored = await storage.get(key);
  if (stored === null) return null;

  try {
    const envelope = parseEnvelope(JSON.parse(stored));
    const cryptoKey = await encryptionKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asArrayBuffer(fromBase64Url(envelope.iv)),
        additionalData: encoder.encode(key)
      },
      cryptoKey,
      asArrayBuffer(fromBase64Url(envelope.ciphertext))
    );
    const payload = parsePayload(JSON.parse(new TextDecoder().decode(plaintext)));
    return payload.ncbiApiKey ? { ncbiApiKey: payload.ncbiApiKey } : {};
  } catch {
    throw new Error("Stored provider settings could not be decrypted.");
  }
}

export async function saveUserProviderSettings(
  storage: KVNamespace,
  userId: string,
  secret: string,
  settings: UserProviderSettings,
  now = new Date()
): Promise<void> {
  const key = await settingsKey(userId, secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const payload: StoredSettingsPayload = {
    version: SETTINGS_VERSION,
    updatedAt: now.toISOString(),
    ...(settings.ncbiApiKey ? { ncbiApiKey: settings.ncbiApiKey } : {})
  };
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(key) },
    await encryptionKey(secret),
    encoder.encode(JSON.stringify(payload))
  );
  const envelope: StoredSettingsEnvelope = {
    version: SETTINGS_VERSION,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext))
  };
  await storage.put(key, JSON.stringify(envelope));
}

export async function deleteUserProviderSettings(
  storage: KVNamespace,
  userId: string,
  secret: string
): Promise<void> {
  await storage.delete(await settingsKey(userId, secret));
}

export function normalizeNcbiApiKey(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 128) return null;
  return /^[A-Za-z0-9_-]+$/u.test(normalized) ? normalized : null;
}

async function settingsKey(userId: string, secret: string): Promise<string> {
  return `${SETTINGS_KEY_PREFIX}${await accountPseudonym(userId, secret)}`;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`provider-settings-encryption-v1\0${secret}`)
  );
  return crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
}

function parseEnvelope(value: unknown): StoredSettingsEnvelope {
  if (
    !isRecord(value) ||
    value.version !== SETTINGS_VERSION ||
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    throw new Error("Invalid provider settings envelope.");
  }
  return { version: SETTINGS_VERSION, iv: value.iv, ciphertext: value.ciphertext };
}

function parsePayload(value: unknown): StoredSettingsPayload {
  if (
    !isRecord(value) ||
    value.version !== SETTINGS_VERSION ||
    typeof value.updatedAt !== "string" ||
    (value.ncbiApiKey !== undefined && typeof value.ncbiApiKey !== "string")
  ) {
    throw new Error("Invalid provider settings payload.");
  }
  return {
    version: SETTINGS_VERSION,
    updatedAt: value.updatedAt,
    ...(value.ncbiApiKey ? { ncbiApiKey: value.ncbiApiKey } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
