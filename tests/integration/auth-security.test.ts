import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetAndSeedReady, withTestDb } from '../helpers/test-db';
import { ensureIndexes } from '@/lib/db/indexes';
import { hashPassword } from '@/lib/security/password';
import { MongoRateLimitStore } from '@/lib/security/rate-limit';

// A tiny in-memory cookie jar stands in for the browser; everything else (routes, sessions, DB) is real.
const jar = new Map<string, string>();
const cookieOptions: Record<string, Record<string, unknown>> = {};
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string, o: Record<string, unknown>) => { jar.set(n, v); cookieOptions[n] = o; },
    delete: (n: string) => { jar.delete(n); }
  })
}));

const PASSWORD = 'Fixture-Pass-2026-xyz';
const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const SID = 'research_admin_sid';

async function seedAdmins() {
  await withTestDb(async (db) => {
    const passwordHash = await hashPassword(PASSWORD);
    await db.collection('admins').insertMany([
      { username: 'researcher', passwordHash, role: 'RESEARCHER', createdAt: new Date() },
      { username: 'supervisor', passwordHash, role: 'SUPERVISOR', createdAt: new Date() }
    ]);
  });
}
async function login(username = 'researcher', password = PASSWORD) {
  const { POST } = await import('@/app/api/admin/login/route');
  return POST(post('/api/admin/login', { username, password }));
}

describe('admin authentication on a real MongoDB', () => {
  beforeEach(async () => {
    await resetAndSeedReady(); await ensureIndexes(); await seedAdmins();
    jar.clear(); for (const k of Object.keys(cookieOptions)) delete cookieOptions[k];
  });

  it('creates the additive auth/rate-limit indexes, including TTL cleanup', async () => {
    const [sess, rl] = await withTestDb(async (db) => [await db.collection('admin_sessions').indexes(), await db.collection('rate_limits').indexes()]);
    expect(sess.find((i) => i.key.tokenHash)?.unique).toBe(true);
    expect(sess.find((i) => i.key.absoluteExpiresAt)?.expireAfterSeconds).toBe(86400);
    expect(rl.find((i) => i.key.key && i.key.windowStart)?.unique).toBe(true);
    expect(rl.find((i) => i.key.expiresAt)?.expireAfterSeconds).toBe(0);
  });

  it('login issues an opaque HttpOnly SameSite=Strict cookie; MongoDB holds only the token hash', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const token = jar.get(SID)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookieOptions[SID]).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' });
    const docs = await withTestDb((db) => db.collection('admin_sessions').find().toArray());
    expect(docs).toHaveLength(1);
    expect(JSON.stringify(docs)).not.toContain(token);
    const { requireAdmin } = await import('@/lib/auth/admin-session');
    expect(await requireAdmin(['RESEARCHER'])).toMatchObject({ username: 'researcher', role: 'RESEARCHER' });
  });

  it('unknown user and wrong password are indistinguishable (same status and body)', async () => {
    const a = await login('nobody', 'whatever-whatever-1'); const b = await login('researcher', 'wrong-wrong-wrong-1');
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
  });

  it('repeated wrong passwords → 429 + Retry-After (even for the correct password during lockout); counters hold hashed keys only', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await login('researcher', 'wrong-wrong-wrong-1')).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    const locked = await login('researcher', PASSWORD);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    const keys = (await withTestDb((db) => db.collection('rate_limits').find().toArray())).map((d) => d.key).join(' ');
    expect(keys).not.toContain('researcher');
  });

  it('a successful login clears the per-account counters', async () => {
    for (let i = 0; i < 3; i++) await login('researcher', 'wrong-wrong-wrong-1');
    expect((await login()).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await login('researcher', 'wrong-wrong-wrong-1')).status).toBe(401);
  });

  it('logout revokes server-side: re-presenting the copied cookie fails', async () => {
    await login();
    const copied = jar.get(SID)!;
    const { POST } = await import('@/app/api/admin/logout/route');
    expect((await POST()).status).toBe(200);
    expect(jar.has(SID)).toBe(false);
    jar.set(SID, copied);                                       // attacker replays the stolen cookie
    const { requireAdmin } = await import('@/lib/auth/admin-session');
    await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');
  });

  it('logging in again rotates the token and revokes the previous one', async () => {
    await login(); const first = jar.get(SID)!;
    await login(); const second = jar.get(SID)!;
    expect(second).not.toBe(first);
    const { requireAdmin } = await import('@/lib/auth/admin-session');
    jar.set(SID, first); await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');
    jar.set(SID, second); await expect(requireAdmin()).resolves.toBeTruthy();
  });

  it('an old pre-migration HMAC cookie is never honoured and is cleared on login', async () => {
    jar.set('research_admin', 'eyJ1c2VybmFtZSI6InJlc2VhcmNoZXIifQ.c2ln');
    const { requireAdmin } = await import('@/lib/auth/admin-session');
    await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');
    await login();
    expect(jar.has('research_admin')).toBe(false);
  });

  it('disabling an admin kills active sessions and blocks login', async () => {
    await login(); const token = jar.get(SID)!;
    await withTestDb((db) => db.collection('admins').updateOne({ username: 'researcher' }, { $set: { disabledAt: new Date() } }));
    const { requireAdmin } = await import('@/lib/auth/admin-session');
    jar.set(SID, token); await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');
    expect((await login()).status).toBe(401);
  });

  it('SUPERVISOR session → 403 on state-changing/exports; RESEARCHER passes the role check', async () => {
    await login('supervisor');
    const config = await import('@/app/api/admin/config/route');
    const exp = await import('@/app/api/admin/export/route');
    const validity = await import('@/app/api/admin/sessions/[id]/validity/route');
    expect((await config.POST(post('/api/admin/config', {}))).status).toBe(403);
    expect((await exp.GET(new NextRequest('http://localhost/api/admin/export?format=paired&phase=MAIN'))).status).toBe(403);
    expect((await validity.POST(post('/x', { validityFlag: 'VALID', reason: null }), { params: Promise.resolve({ id: 'fixture-existing-A' }) })).status).toBe(403);
    expect((await config.GET()).status).toBe(200);              // read-only access stays allowed
    jar.clear(); await login('researcher');
    expect((await exp.GET(new NextRequest('http://localhost/api/admin/export?format=paired&phase=MAIN'))).status).toBe(200);
  });

  it('password change: policy + current password enforced; success revokes other sessions, re-issues this one, audits without secrets', async () => {
    const { POST } = await import('@/app/api/admin/password/route');
    const { requireAdmin } = await import('@/lib/auth/admin-session');
    await login(); const other = jar.get(SID)!;
    jar.clear(); await login(); const current = jar.get(SID)!;     // second login already revoked "other"; mint a third to prove revoke-all
    jar.set(SID, current);
    expect((await POST(post('/api/admin/password', { currentPassword: 'bad-bad-bad-bad', newPassword: 'violet-lantern-orbit-2026' }))).status).toBe(400);
    expect((await POST(post('/api/admin/password', { currentPassword: PASSWORD, newPassword: 'short' }))).status).toBe(400);
    expect((await POST(post('/api/admin/password', { currentPassword: PASSWORD, newPassword: 'violet-lantern-orbit-2026' }))).status).toBe(200);
    expect(jar.get(SID)).not.toBe(current);
    await expect(requireAdmin()).resolves.toMatchObject({ username: 'researcher' });
    jar.set(SID, current); await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');
    jar.set(SID, other); await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');
    expect((await login('researcher', PASSWORD)).status).toBe(401);
    expect((await login('researcher', 'violet-lantern-orbit-2026')).status).toBe(200);
    const audit = await withTestDb((db) => db.collection('admin_audit').find({ action: 'ADMIN_PASSWORD_CHANGED' }).toArray());
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/violet|Fixture-Pass/);
  });
});

describe('rate-limit store atomicity', () => {
  beforeEach(async () => { await resetAndSeedReady(); await ensureIndexes(); });
  it('25 parallel hits on a brand-new key are all counted exactly once (no lost update, no duplicate-key failure)', async () => {
    const store = new MongoRateLimitStore(); const now = new Date();
    const results = await Promise.all(Array.from({ length: 25 }, () => store.hit('burst', 60_000, now)));
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});
