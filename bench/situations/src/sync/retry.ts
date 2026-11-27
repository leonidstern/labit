// Retry with exponential backoff and jitter. Every call in ./client goes through withRetry.
import { SyncError, isRetryable } from './errors';

export interface RetryOptions {
  /** How many times a call is tried in total, the first try included. */
  maxAttempts: number;
  /** Delay before the second try, in milliseconds. It doubles on every further try. */
  baseDelayMs: number;
  /** No single delay is longer than this. */
  maxDelayMs: number;
  /** Called before each new try, for logs and metrics. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

export const defaults: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Full jitter: a random delay between zero and the exponential step. */
export function backoff(attempt: number, options: RetryOptions): number {
  const step = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
  return Math.round(Math.random() * step);
}

/** A Retry-After header (seconds, or an HTTP date) as milliseconds from now. */
export function retryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(seconds * 1000, 0);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(date - now, 0);
}

export async function withRetry<T>(
  call: (attempt: number) => Promise<T>,
  overrides: Partial<RetryOptions> = {},
): Promise<T> {
  const options = { ...defaults, ...overrides };
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await call(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw error;
      if (attempt === options.maxAttempts) break;

      // The server knows best: wait as long as it asks, but never longer than the cap.
      const asked = error instanceof SyncError ? retryAfter(error.retryAfter) : null;
      const delayMs = Math.min(asked ?? backoff(attempt, options), options.maxDelayMs);
      options.onRetry?.(attempt, error, delayMs);
      await sleep(delayMs);
    }
  }

  throw new SyncError('gave up', {
    cause: lastError,
    attempts: options.maxAttempts,
  });
}

/** Wraps a function so every call to it is retried. */
export function retrying<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
  overrides: Partial<RetryOptions> = {},
): (...args: A) => Promise<T> {
  return (...args) => withRetry(() => fn(...args), overrides);
}
