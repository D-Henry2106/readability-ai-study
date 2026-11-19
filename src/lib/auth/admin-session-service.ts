import { createHash, randomBytes } from 'node:crypto';
import { collections } from '@/lib/db/collections';
import type { AdminRole, AdminSessionDoc } from '@/types/research';

/**
 * Server-side admin sessions. The cookie holds an opaque random token; MongoDB stores only its
 * SHA-256 hash, so a database leak cannot be replayed. Every request is checked against the store,
 * which is what makes logout, password change and account disable take effect immediately.
 */
export interface AdminSessionPayload {
  username: string;
  role: AdminRole;
  /** Absolute expiry (ms since epoch). */
  exp: number;
}

export interface SessionLimits { idleMs: number; absoluteMs: number }

export interface AdminSessionStore {
  create(doc: AdminSessionDoc): Promise<void>;
  findByHash(hash: string): Promise<AdminSessionDoc | null>;
  touch(hash: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;
  revokeByHash(hash: string, reason: string, at: Date): Promise<boolean>;
  revokeAllForUser(username: string, reason: string, at: Date, exceptHash?: string): Promise<number>;
}

export interface AdminDirectory {
  find(username: string): Promise<{ username: string; role: AdminRole; disabledAt?: Date | null } | null>;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Sliding idle timeout is refreshed at most once a minute to avoid a write per request. */
const TOUCH_INTERVAL_MS = 60_000;

export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(`admin-session:v1:${token}`).digest('hex');
export const newSessionToken = (): string => randomBytes(32).toString('base64url');

export class AdminSessionService {
  constructor(
    private readonly store: AdminSessionStore,
    private readonly directory: AdminDirectory,
    private readonly limits: () => SessionLimits,
    private readonly clock: () => Date = () => new Date(),
    private readonly makeToken: () => string = newSessionToken
  ) {}

  /** Always creates a brand-new token (callers revoke the previous one: rotation on login). */
  async issue(username: string): Promise<{ token: string; maxAgeSeconds: number }> {
    const now = this.clock();
    const { idleMs, absoluteMs } = this.limits();
    const token = this.makeToken();
    await this.store.create({
      tokenHash: hashSessionToken(token), username, createdAt: now, lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + idleMs), absoluteExpiresAt: new Date(now.getTime() + absoluteMs), revokedAt: null
    });
    return { token, maxAgeSeconds: Math.floor(absoluteMs / 1000) };
  }

  async validate(token: string | undefined | null): Promise<AdminSessionPayload | null> {
    if (!token || !TOKEN_PATTERN.test(token)) return null;
    const hash = hashSessionToken(token);
    const doc = await this.store.findByHash(hash);
    if (!doc || doc.revokedAt) return null;
    const now = this.clock();
    if (now >= doc.idleExpiresAt || now >= doc.absoluteExpiresAt) return null;
    const admin = await this.directory.find(doc.username);
    if (!admin || admin.disabledAt) {
      await this.store.revokeByHash(hash, 'ACCOUNT_UNAVAILABLE', now);
      return null;
    }
    if (now.getTime() - doc.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      const idleExpiresAt = new Date(Math.min(now.getTime() + this.limits().idleMs, doc.absoluteExpiresAt.getTime()));
      await this.store.touch(hash, now, idleExpiresAt);
    }
    return { username: admin.username, role: admin.role, exp: doc.absoluteExpiresAt.getTime() };
  }

  async revoke(token: string | undefined | null, reason: string): Promise<boolean> {
    if (!token || !TOKEN_PATTERN.test(token)) return false;
    return this.store.revokeByHash(hashSessionToken(token), reason, this.clock());
  }

  async revokeAllForUser(username: string, reason: string, exceptToken?: string): Promise<number> {
    const except = exceptToken && TOKEN_PATTERN.test(exceptToken) ? hashSessionToken(exceptToken) : undefined;
    return this.store.revokeAllForUser(username, reason, this.clock(), except);
  }
}

export class MongoAdminSessionStore implements AdminSessionStore {
  async create(doc: AdminSessionDoc): Promise<void> {
    const { adminSessions } = await collections();
    await adminSessions.insertOne(doc);
  }
  async findByHash(hash: string): Promise<AdminSessionDoc | null> {
    const { adminSessions } = await collections();
    return adminSessions.findOne({ tokenHash: hash });
  }
  async touch(hash: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    const { adminSessions } = await collections();
    await adminSessions.updateOne({ tokenHash: hash, revokedAt: null }, { $set: { lastSeenAt, idleExpiresAt } });
  }
  async revokeByHash(hash: string, reason: string, at: Date): Promise<boolean> {
    const { adminSessions } = await collections();
    const result = await adminSessions.updateOne({ tokenHash: hash, revokedAt: null }, { $set: { revokedAt: at, revokedReason: reason } });
    return result.modifiedCount === 1;
  }
  async revokeAllForUser(username: string, reason: string, at: Date, exceptHash?: string): Promise<number> {
    const { adminSessions } = await collections();
    const result = await adminSessions.updateMany(
      { username, revokedAt: null, ...(exceptHash ? { tokenHash: { $ne: exceptHash } } : {}) },
      { $set: { revokedAt: at, revokedReason: reason } }
    );
    return result.modifiedCount;
  }
}

export class MongoAdminDirectory implements AdminDirectory {
  async find(username: string) {
    const { admins } = await collections();
    const admin = await admins.findOne({ username });
    return admin ? { username: admin.username, role: admin.role, disabledAt: admin.disabledAt ?? null } : null;
  }
}
