import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: [] as string[], deleted: [] as string[] }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined),
    set: (name: string, value: string) => { jar.set.push(name); jar.values.set(name, value); },
    delete: (name: string) => { jar.deleted.push(name); jar.values.delete(name); }
  })
}));
vi.mock('@/config/env', () => ({
  getAuthEnv: () => ({ AUTH_SECRET: 'a'.repeat(64) }),
  getSecurityEnv: () => ({ ADMIN_SESSION_IDLE_MINUTES: 30, ADMIN_SESSION_ABSOLUTE_HOURS: 8 })
}));
vi.mock('@/lib/auth/admin-session-service', () => ({
  AdminSessionService: class { async revoke() {} async issue() { return { token: 'opaque-admin-token', maxAgeSeconds: 60 }; } async validate() { return null; } },
  MongoAdminDirectory: class {}, MongoAdminSessionStore: class {}
}));
import { clearAdminSession, startAdminSession } from '@/lib/auth/admin-session';
import { PARTICIPANT_COOKIE, encodeParticipantSession, decodeParticipantSession } from '@/lib/auth/participant-session';

describe('P5-A: admin and participant cookies are independent', () => {
  const sessionId = '11111111-2222-4333-8444-555555555555';
  beforeEach(() => { jar.values.clear(); jar.set.length = 0; jar.deleted.length = 0; jar.values.set(PARTICIPANT_COOKIE, encodeParticipantSession(sessionId)); });

  it('admin login and logout touch only admin cookies; the participant cookie survives unchanged', async () => {
    const before = jar.values.get(PARTICIPANT_COOKIE);
    await startAdminSession('researcher');
    await clearAdminSession();
    expect(jar.set).not.toContain(PARTICIPANT_COOKIE);
    expect(jar.deleted).not.toContain(PARTICIPANT_COOKIE);
    expect(jar.values.get(PARTICIPANT_COOKIE)).toBe(before);
    expect(decodeParticipantSession(jar.values.get(PARTICIPANT_COOKIE)!)).toBe(sessionId);
    expect(jar.deleted.every((name) => name.includes('research_admin'))).toBe(true);
  });
});
