import { describe, expect, it, vi } from "vitest";
import { fetchJson, fetchText } from "../packages/core/src/http.js";
import type { FetchLike } from "../packages/core/src/types.js";

describe("provider HTTP requests", () => {
  it("retries a temporary upstream response once", async () => {
    const fetcher = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: "ready" }));

    await expect(fetchJson<{ status: string }>(fetcher, "test-provider", new URL("https://example.test")))
      .resolves.toEqual({ status: "ready" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a temporary network failure once", async () => {
    const fetcher = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"))
      .mockResolvedValueOnce(new Response("available"));

    await expect(fetchText(fetcher, "test-provider", new URL("https://example.test"))).resolves.toBe(
      "available"
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a provider error embedded in a successful JSON response", async () => {
    const fetcher = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(Response.json({ error: "API rate limit exceeded" }))
      .mockResolvedValueOnce(Response.json({ esearchresult: { idlist: ["123"] } }));

    await expect(
      fetchJson<{ error?: string; esearchresult?: { idlist: string[] } }>(
        fetcher,
        "pubmed",
        new URL("https://example.test"),
        {
          maxAttempts: 3,
          retryBaseDelayMs: 0,
          retryOnResult: (value) => (value.error ? "rate-limited" : undefined)
        }
      )
    ).resolves.toEqual({ esearchresult: { idlist: ["123"] } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns a safe classified error after retry exhaustion", async () => {
    const fetcher = vi
      .fn<FetchLike>()
      .mockResolvedValue(new Response("slow down", { status: 429 }));

    await expect(
      fetchText(fetcher, "pubmed", new URL("https://example.test"), {
        maxAttempts: 2,
        retryBaseDelayMs: 0
      })
    ).rejects.toMatchObject({
      provider: "pubmed",
      status: 429,
      reason: "rate-limited"
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent client response", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(fetchText(fetcher, "test-provider", new URL("https://example.test"))).rejects.toMatchObject({
      provider: "test-provider",
      status: 404
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an upstream JSON response above the configured byte limit", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify({ value: "too large" }), {
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      fetchJson(fetcher, "bounded-provider", new URL("https://example.test"), {
        maxResponseBytes: 5
      })
    ).rejects.toThrow("unexpectedly large response");
  });
});
