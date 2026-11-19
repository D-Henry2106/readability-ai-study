import { createHmac } from 'node:crypto';
import { collections } from '@/lib/db/collections';
import { getAuthEnv } from '@/config/env';

/** Shared (MongoDB-backed) fixed-window counters, so limits hold across serverless instances. */
export interface RateLimitStore {
  /** Atomically increments and returns the counter of the current window. */
  hit(key: string, windowMs: number, now: Date): Promise<{ count: number; windowStart: Date }>;
  clear(key: string): Promise<void>;
}

export interface RateLimitRule { key: string; limit: number; windowMs: number }
export interface RateLimitDecision { allowed: boolean; retryAfterSeconds: number }

/** Counts one attempt against every rule; the decision is the most restrictive one. */
export async function consumeAll(store: RateLimitStore, rules: RateLimitRule[], now: Date = new Date()): Promise<RateLimitDecision> {
  let allowed = true;
  let retryAfterSeconds = 0;
  for (const rule of rules) {
    const { count, windowStart } = await store.hit(rule.key, rule.windowMs, now);
    if (count > rule.limit) {
      allowed = false;
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.max(1, Math.ceil((windowStart.getTime() + rule.windowMs - now.getTime()) / 1000)));
    }
  }
  return { allowed, retryAfterSeconds };
}

/** Keys never contain raw IPs, usernames or cookies: they are keyed hashes. */
export function keyPart(value: string): string {
  return createHmac('sha256', getAuthEnv().AUTH_SECRET).update(`rate-limit:v1:${value.normalize('NFKC')}`).digest('base64url').slice(0, 24);
}

export class MongoRateLimitStore implements RateLimitStore {
  async hit(key: string, windowMs: number, now: Date) {
    const { rateLimits } = await collections();
    const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const expiresAt = new Date(windowStart.getTime() + windowMs * 2);
    // Two concurrent first hits race on the unique (key, windowStart) index: the loser simply retries the $inc.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const doc = await rateLimits.findOneAndUpdate(
          { key, windowStart },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
          { upsert: true, returnDocument: 'after' }
        );
        if (doc) return { count: doc.count, windowStart };
      } catch (error) {
        const duplicate = typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
        if (!duplicate || attempt === 2) throw error;
      }
    }
    throw new Error('RATE_LIMIT_STORE_FAILED');
  }
  async clear(key: string): Promise<void> {
    const { rateLimits } = await collections();
    await rateLimits.deleteMany({ key });
  }
}

const FIFTEEN_MIN = 15 * 60_000;
/** Login throttling: per IP, per username (blocks distributed guessing) and per IP+username. */
export function loginRules(ip: string | null, username: string): { rules: RateLimitRule[]; successClears: string[] } {
  const user = username.trim().toLowerCase();
  const ipKey = `login:ip:${keyPart(ip ?? 'unknown')}`;
  const userKey = `login:user:${keyPart(user)}`;
  const pairKey = `login:pair:${keyPart(`${ip ?? 'unknown'}|${user}`)}`;
  return {
    rules: [
      { key: ipKey, limit: 30, windowMs: FIFTEEN_MIN },
      { key: userKey, limit: 10, windowMs: FIFTEEN_MIN },
      { key: pairKey, limit: 5, windowMs: FIFTEEN_MIN }
    ],
    // A successful login clears the per-account counters but not the per-IP one.
    successClears: [userKey, pairKey]
  };
}
