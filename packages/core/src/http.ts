import type { FetchLike, ProviderFailureReason } from "./types.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5_000;

export type UpstreamFailureReason = ProviderFailureReason;

interface FetchOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  maxResponseBytes?: number;
  retryBaseDelayMs?: number;
}

interface FetchJsonOptions<T> extends FetchOptions {
  retryOnResult?: (value: T) => UpstreamFailureReason | undefined;
}

export class UpstreamError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
    readonly reason: UpstreamFailureReason = "upstream-error",
    readonly retryable = false
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export async function fetchJson<T>(
  fetcher: FetchLike,
  provider: string,
  url: URL,
  options: FetchJsonOptions<T> = {}
): Promise<T> {
  return fetchParsed(
    fetcher,
    provider,
    url,
    async (response) => {
      if (options.maxResponseBytes !== undefined) {
        const text = await responseTextBounded(response, provider, options.maxResponseBytes);
        return JSON.parse(text) as T;
      }
      return (await response.json()) as T;
    },
    options,
    options.retryOnResult
  );
}

export async function fetchText(
  fetcher: FetchLike,
  provider: string,
  url: URL,
  options: FetchOptions = {}
): Promise<string> {
  return fetchParsed(fetcher, provider, url, (response) => response.text(), options);
}

async function fetchParsed<T>(
  fetcher: FetchLike,
  provider: string,
  url: URL,
  parse: (response: Response) => Promise<T>,
  options: FetchOptions,
  retryOnResult?: (value: T) => UpstreamFailureReason | undefined
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? RETRY_DELAY_MS;
  let lastError: UpstreamError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchOnce(fetcher, url, timeoutMs);
      if (!response.ok) {
        const error = responseError(provider, response.status);
        if (!error.retryable || attempt === maxAttempts) throw error;
        lastError = error;
        const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
        await response.body?.cancel();
        await delay(retryDelay(attempt, retryBaseDelayMs, retryAfterMs));
        continue;
      }

      const value = await parse(response);
      const resultFailure = retryOnResult?.(value);
      if (!resultFailure) return value;

      const error = new UpstreamError(
        provider,
        `${provider} returned a temporary error response.`,
        resultFailure === "rate-limited" ? 429 : undefined,
        resultFailure,
        true
      );
      if (attempt === maxAttempts) throw error;
      lastError = error;
    } catch (error) {
      const normalized = normalizeUpstreamError(provider, error);
      if (!normalized.retryable || attempt === maxAttempts) throw normalized;
      lastError = normalized;
    }
    await delay(retryDelay(attempt, retryBaseDelayMs));
  }
  throw lastError ?? new UpstreamError(provider, `${provider} request failed.`, undefined, "unknown");
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

function responseError(provider: string, status: number): UpstreamError {
  return new UpstreamError(
    provider,
    `${provider} returned HTTP ${status}.`,
    status,
    status === 429 ? "rate-limited" : "upstream-error",
    isRetryableStatus(status)
  );
}

function normalizeUpstreamError(provider: string, error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new UpstreamError(provider, `${provider} request timed out.`, undefined, "timeout", true);
  }
  if (error instanceof SyntaxError) {
    return new UpstreamError(
      provider,
      `${provider} returned invalid data.`,
      undefined,
      "invalid-response",
      true
    );
  }
  if (error instanceof TypeError) {
    return new UpstreamError(
      provider,
      `${provider} network request failed.`,
      undefined,
      "network-error",
      true
    );
  }
  return new UpstreamError(provider, `${provider} request failed.`, undefined, "unknown");
}

function retryDelay(attempt: number, baseDelayMs: number, retryAfterMs?: number): number {
  const exponentialDelay = Math.max(0, baseDelayMs) * 2 ** (attempt - 1);
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(exponentialDelay, retryAfterMs ?? 0));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
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
    throw new UpstreamError(
      provider,
      `${provider} returned an unexpectedly large response.`,
      undefined,
      "invalid-response"
    );
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
        throw new UpstreamError(
          provider,
          `${provider} returned an unexpectedly large response.`,
          undefined,
          "invalid-response"
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
