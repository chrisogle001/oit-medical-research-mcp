import type { FetchLike } from "./types.js";

const DEFAULT_TIMEOUT_MS = 20_000;

export class UpstreamError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export async function fetchJson<T>(
  fetcher: FetchLike,
  provider: string,
  url: URL,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const response = await fetchWithTimeout(fetcher, url, timeoutMs);
  if (!response.ok) {
    throw new UpstreamError(provider, `${provider} returned HTTP ${response.status}.`, response.status);
  }
  return (await response.json()) as T;
}

export async function fetchText(
  fetcher: FetchLike,
  provider: string,
  url: URL,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const response = await fetchWithTimeout(fetcher, url, timeoutMs);
  if (!response.ok) {
    throw new UpstreamError(provider, `${provider} returned HTTP ${response.status}.`, response.status);
  }
  return response.text();
}

async function fetchWithTimeout(
  fetcher: FetchLike,
  url: URL,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, {
      headers: {
        Accept: "application/json, application/xml, text/xml;q=0.9, */*;q=0.1"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}
