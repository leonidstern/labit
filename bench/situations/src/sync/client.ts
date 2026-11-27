// Talks to the sync service. Every call goes through withRetry (see ./retry).
import { withRetry, type RetryOptions } from './retry';
import { SyncError } from './errors';

export interface ClientOptions {
  baseUrl: string;
  token: string;
  /** Applies to each try, not to the whole call. */
  timeoutMs: number;
  retry?: Partial<RetryOptions>;
}

export interface Change {
  id: string;
  calendarId: string;
  updatedAt: string;
  deleted?: boolean;
}

export function createClient({ baseUrl, token, timeoutMs, retry }: ClientOptions) {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  /** Changes made elsewhere since the cursor. */
  async function pull(cursor: string | null): Promise<{ changes: Change[]; cursor: string }> {
    return withRetry(async () => {
      const res = await fetch(`${baseUrl}/v2/changes?cursor=${cursor ?? ''}`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw await SyncError.from(res);
      return res.json();
    }, retry);
  }

  /** Sends changes made on this device. */
  async function push(changes: Change[]): Promise<{ accepted: number; rejected: string[] }> {
    return withRetry(async () => {
      const res = await fetch(`${baseUrl}/v2/changes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ changes }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw await SyncError.from(res);
      return res.json();
    }, retry);
  }

  return { pull, push };
}
