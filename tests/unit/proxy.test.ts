import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const consumeAll = vi.fn();
vi.mock('@/lib/security/rate-limit', async (orig) => ({ ...(await orig<typeof import('@/lib/security/rate-limit')>()), consumeAll: (...a: unknown[]) => consumeAll(...a), MongoRateLimitStore: class {} }));
import { proxy } from '@/proxy';

const url = 'https://study.example';
const call = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => proxy(new NextRequest(url + path, init));

beforeEach(() => { consumeAll.mockReset(); consumeAll.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }); });
afterEach(() => vi.unstubAllEnvs());

describe('proxy: CSRF / Origin on /api', () => {
  it('blocks a cross-origin POST with 403 before any handler or limiter runs', async () => {
    const res = await call('/api/test/submit', { method: 'POST', headers: { origin: 'https://evil.example', cookie: 'exp_session=a.b' } });
    expect(res.status).toBe(403);
    expect(consumeAll).not.toHaveBeenCalled();
  });
  it('blocks cross-origin admin POSTs too (config, validity, export-triggering, logout, password)', async () => {
    for (const path of ['/api/admin/config', '/api/admin/sessions/x/validity', '/api/admin/packages', '/api/admin/logout', '/api/admin/password', '/api/config', '/api/sessions/x/validity']) {
      expect((await call(path, { method: 'POST', headers: { origin: 'https://evil.example', cookie: 'research_admin_sid=t' } })).status, path).toBe(403);
    }
  });
  it('lets a same-origin participant POST through (participant flow unaffected)', async () => {
    const res = await call('/api/test/submit', { method: 'POST', headers: { origin: url, cookie: 'exp_session=a.b' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
  it('does not touch GET requests', async () => {
    expect((await call('/api/break/status', { headers: { origin: 'https://evil.example' } })).status).toBe(200);
    expect(consumeAll).not.toHaveBeenCalled();
  });
});

describe('proxy: participant throttling', () => {
  it('returns 429 with Retry-After when a participant limit is exceeded', async () => {
    consumeAll.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });
    const res = await call('/api/consent', { method: 'POST', headers: { origin: url, cookie: 'exp_session=a.b' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('17');
  });
  it('keys participant limits per cookie (and per IP only when the proxy is trusted); rules contain no raw cookie/IP', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    await call('/api/session', { method: 'POST', headers: { origin: url, 'x-forwarded-for': '203.0.113.9', cookie: 'exp_session=secretvalue.mac' } });
    const rules = consumeAll.mock.calls[0][1] as Array<{ key: string; limit: number }>;
    expect(rules.map((r) => r.key.split(':').slice(0, 2).join(':'))).toEqual(['participant:ip', 'session-create:ip', 'participant:cookie']);
    expect(JSON.stringify(rules)).not.toContain('secretvalue'); expect(JSON.stringify(rules)).not.toContain('203.0.113.9');
    expect(rules.find((r) => r.key.startsWith('session-create'))!.limit).toBeGreaterThanOrEqual(200);   // classroom-safe
  });
  it('without trusted proxy headers there is no IP rule (nobody is throttled by a spoofable header)', async () => {
    await call('/api/session', { method: 'POST', headers: { origin: url, 'x-forwarded-for': '203.0.113.9' } });
    expect(consumeAll).not.toHaveBeenCalled();
  });
  it('fails open if the limiter store is down, so a running study keeps working', async () => {
    consumeAll.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await call('/api/consent', { method: 'POST', headers: { origin: url, cookie: 'exp_session=a.b' } })).status).toBe(200);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('db down');
    spy.mockRestore();
  });
  it('does not apply the participant limiter to /api/admin (login has its own, role checks cover the rest)', async () => {
    await call('/api/admin/login', { method: 'POST', headers: { origin: url } });
    expect(consumeAll).not.toHaveBeenCalled();
  });
});

describe('proxy: page headers', () => {
  it('sets a fresh nonce-based CSP per request and forwards it to the app', async () => {
    const a = await call('/information'); const b = await call('/information');
    const csp = (r: Response) => r.headers.get('content-security-policy')!;
    const nonce = (r: Response) => /'nonce-([^']+)'/.exec(csp(r))![1];
    expect(nonce(a)).not.toBe(nonce(b));
    expect(csp(a)).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(a.headers.get('x-middleware-request-x-nonce')).toBe(nonce(a));
  });
  it('sends HSTS only for production traffic that arrived over HTTPS', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await call('/information')).headers.get('strict-transport-security')).toContain('max-age=31536000');
    const http = await proxy(new NextRequest('http://localhost:3000/information'));
    expect(http.headers.get('strict-transport-security')).toBeNull();
    vi.stubEnv('NODE_ENV', 'development');
    expect((await call('/information')).headers.get('strict-transport-security')).toBeNull();
  });
});
