import type { FetchLike } from "./types.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 250;

interface FetchOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  maxResponseBytes?: number;
}

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
  options: FetchOptions = {}
): Promise<T> {
  const response = await fetchWithTimeout(fetcher, url, options);
  if (!response.ok) {
    throw new UpstreamError(provider, `${provider} returned HTTP ${response.status}.`, response.status);
  }
  if (options.maxResponseBytes !== undefined) {
    const text = await responseTextBounded(response, provider, options.maxResponseBytes);
    return JSON.parse(text) as T;
  }
  return (await response.json()) as T;
}

export async function fetchText(
  fetcher: FetchLike,
  provider: string,
  url: URL,
  options: FetchOptions = {}
): Promise<string> {
  const response = await fetchWithTimeout(fetcher, url, options);
  if (!response.ok) {
    throw new UpstreamError(provider, `${provider} returned HTTP ${response.status}.`, response.status);
  }
  return response.text();
}

async function fetchWithTimeout(
  fetcher: FetchLike,
  url: URL,
  options: FetchOptions
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchOnce(fetcher, url, timeoutMs);
      if (!isRetryableStatus(response.status) || attempt === maxAttempts) return response;
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }
    await delay(RETRY_DELAY_MS * attempt);
  }
  throw lastError;
}

async function fetchOnce(fetcher: FetchLike, url: URL, timeoutMs: number): Promise<Response> {
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

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function responseTextBounded(
  response: Response,
  provider: string,
  maxBytes: number
): Promise<string> {
  const declaredLength = Number(response.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new UpstreamError(provider, `${provider} returned an unexpectedly large response.`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new UpstreamError(provider, `${provider} returned an unexpectedly large response.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
