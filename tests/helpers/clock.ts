import { vi } from 'vitest';

/**
 * Pins Date to the middle of a FUTURE fixed window (7.5 to 22.5 minutes ahead for a 15-minute window), so
 * fixed-window rate-limit tests can never straddle a window boundary, and no stored expiry is in the past
 * for MongoDB's TTL monitor. Only Date is faked; timers and the MongoDB driver keep running normally.
 */
export function pinClockMidWindow(windowMs = 15 * 60_000): Date {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const pinned = new Date(windowStart + windowMs + windowMs / 2);
  vi.useFakeTimers({ toFake: ['Date'], now: pinned, shouldAdvanceTime: true });
  return pinned;
}

export function releaseClock(): void {
  vi.useRealTimers();
}
