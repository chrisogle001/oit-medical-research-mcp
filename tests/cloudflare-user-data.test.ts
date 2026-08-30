import { describe, expect, it } from "vitest";
import {
  deleteUserProviderSettings,
  normalizeNcbiApiKey,
  readUserProviderSettings,
  saveUserProviderSettings
} from "../apps/cloudflare/src/user-data.js";

const secret = "a-separate-user-data-encryption-secret-longer-than-thirty-two-characters";

class MemoryKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe("encrypted Cloudflare user settings", () => {
  it("round-trips an NCBI key without storing the account or key in plaintext", async () => {
    const memory = new MemoryKv();
    const storage = memory as unknown as KVNamespace;
    const apiKey = "abc12345_secure_key";
    await saveUserProviderSettings(storage, "github-user-42", secret, { ncbiApiKey: apiKey });

    const [storedKey, storedValue] = [...memory.values.entries()][0]!;
    expect(storedKey).not.toContain("github-user-42");
    expect(storedValue).not.toContain(apiKey);
    await expect(readUserProviderSettings(storage, "github-user-42", secret)).resolves.toEqual({
      ncbiApiKey: apiKey
    });
  });

  it("rejects tampered encrypted settings", async () => {
    const memory = new MemoryKv();
    const storage = memory as unknown as KVNamespace;
    await saveUserProviderSettings(storage, "42", secret, { ncbiApiKey: "abc12345" });
    const [key, value] = [...memory.values.entries()][0]!;
    const parsed = JSON.parse(value) as { ciphertext: string };
    parsed.ciphertext = `${parsed.ciphertext.startsWith("a") ? "b" : "a"}${parsed.ciphertext.slice(1)}`;
    memory.values.set(key, JSON.stringify(parsed));

    await expect(readUserProviderSettings(storage, "42", secret)).rejects.toThrow(
      "could not be decrypted"
    );
  });

  it("deletes the encrypted settings record", async () => {
    const memory = new MemoryKv();
    const storage = memory as unknown as KVNamespace;
    await saveUserProviderSettings(storage, "42", secret, { ncbiApiKey: "abc12345" });
    await deleteUserProviderSettings(storage, "42", secret);
    await expect(readUserProviderSettings(storage, "42", secret)).resolves.toBeNull();
  });

  it("accepts only bounded API-key characters", () => {
    expect(normalizeNcbiApiKey("  abc12345_key  ")).toBe("abc12345_key");
    expect(normalizeNcbiApiKey("short")).toBeNull();
    expect(normalizeNcbiApiKey("abc12345 key")).toBeNull();
  });
});
