import type { ClientOptions } from '../src/sync/client';

export const sync: ClientOptions = {
  baseUrl: 'https://sync.staging.tidepool.example',
  token: process.env.SYNC_TOKEN ?? '',
  timeoutMs: 30_000,
  retry: {
    maxAttempts: 5,
    baseDelayMs: 250,
    maxDelayMs: 8_000,
  },
};
