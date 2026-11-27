// Errors from the sync service, and which of them are worth another try.
export class SyncError extends Error {
  status?: number;
  retryAfter: string | null = null;
  attempts?: number;

  constructor(message: string, options: { cause?: unknown; status?: number; attempts?: number } = {}) {
    super(message, { cause: options.cause });
    this.name = 'SyncError';
    this.status = options.status;
    this.attempts = options.attempts;
  }

  static async from(res: Response): Promise<SyncError> {
    const error = new SyncError(`sync service answered ${res.status}`, { status: res.status });
    error.retryAfter = res.headers.get('retry-after');
    return error;
  }
}

/** Timeouts, network errors, 429 and 5xx can be tried again; everything else cannot. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof SyncError) return error.status === 429 || (error.status ?? 0) >= 500;
  if (error instanceof DOMException) return error.name === 'TimeoutError';
  return error instanceof TypeError;
}
