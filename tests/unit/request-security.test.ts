import { describe, it, expect } from 'vitest';
import { clientIp, evaluateOrigin, isStateChanging } from '@/lib/security/request-guard';
import { buildCsp } from '@/lib/security/csp';
import { consumeAll, loginRules, type RateLimitStore } from '@/lib/security/rate-limit';
import { validateAdminPassword } from '@/lib/security/password-policy';

const base = { method: 'POST', origin: null, referer: null, secFetchSite: null, allowedOrigins: ['https://study.example', undefined], hasCookies: true };

describe('Origin / CSRF check', () => {
  it('ignores safe methods', () => expect(evaluateOrigin({ ...base, method: 'GET', origin: 'https://evil.example' }).allowed).toBe(true));
  it('allows same-origin and APP_URL origins', () => {
    expect(evaluateOrigin({ ...base, origin: 'https://study.example' }).allowed).toBe(true);
    expect(evaluateOrigin({ ...base, allowedOrigins: ['http://127.0.0.1:3000', 'https://study.example'], origin: 'https://study.example' }).allowed).toBe(true);
  });
  it.each(['https://evil.example', 'https://study.example.evil.example', 'http://study.example', 'null', 'not a url'])('blocks a state-changing request from %s', (origin) => {
    expect(evaluateOrigin({ ...base, origin }).allowed).toBe(false);
  });
  it('falls back to Sec-Fetch-Site then Referer when Origin is absent', () => {
    expect(evaluateOrigin({ ...base, secFetchSite: 'cross-site' }).allowed).toBe(false);
    expect(evaluateOrigin({ ...base, secFetchSite: 'same-origin' }).allowed).toBe(true);
    expect(evaluateOrigin({ ...base, referer: 'https://evil.example/x' }).allowed).toBe(false);
    expect(evaluateOrigin({ ...base, referer: 'https://study.example/admin' }).allowed).toBe(true);
  });
  it('refuses cookie-bearing requests with no origin signal, but lets cookie-less API clients through', () => {
    expect(evaluateOrigin(base).allowed).toBe(false);
    expect(evaluateOrigin({ ...base, hasCookies: false }).allowed).toBe(true);
  });
  it('classifies methods', () => { expect(isStateChanging('post')).toBe(true); expect(isStateChanging('DELETE')).toBe(true); expect(isStateChanging('GET')).toBe(false); });
});

describe('client IP', () => {
  const h = (v: Record<string, string>) => new Headers(v);
  it('is unknown unless the proxy is explicitly trusted (spoofable headers never decide throttling)', () => {
    expect(clientIp(h({ 'x-forwarded-for': '1.2.3.4' }), false)).toBeNull();
    expect(clientIp(h({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), true)).toBe('1.2.3.4');
    expect(clientIp(h({ 'x-forwarded-for': 'garbage' }), true)).toBeNull();
  });
});

describe('CSP', () => {
  it('has a nonce, no unsafe-inline for scripts, no unsafe-eval in production, and blocks framing', () => {
    const csp = buildCsp({ nonce: 'abc', isDev: false, secure: true });
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).toContain(`'nonce-abc'`); expect(script).not.toContain('unsafe-inline'); expect(script).not.toContain('unsafe-eval');
    expect(csp.split('; ').find((d) => d.startsWith('style-src '))).not.toContain('unsafe-inline');
    expect(csp).toContain(`frame-ancestors 'none'`); expect(csp).toContain(`object-src 'none'`); expect(csp).toContain('upgrade-insecure-requests');
  });
  it('allows eval only in development and never upgrades requests on plain HTTP', () => {
    const dev = buildCsp({ nonce: 'abc', isDev: true, secure: false });
    expect(dev).toContain(`'unsafe-eval'`); expect(dev).not.toContain('upgrade-insecure-requests');
  });
});

class MemoryLimitStore implements RateLimitStore {
  counts = new Map<string, number>();
  async hit(key: string, windowMs: number, now: Date) { const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs); const k = `${key}@${windowStart.getTime()}`; const c = (this.counts.get(k) ?? 0) + 1; this.counts.set(k, c); return { count: c, windowStart }; }
  async clear(key: string) { for (const k of [...this.counts.keys()]) if (k.startsWith(`${key}@`)) this.counts.delete(k); }
}

describe('rate limiting', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  it('allows up to the limit, then blocks with a positive Retry-After that ends at the window boundary', async () => {
    const store = new MemoryLimitStore(); const rule = { key: 'k', limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) expect((await consumeAll(store, [rule], new Date(t0.getTime() + i * 1000))).allowed).toBe(true);
    const blocked = await consumeAll(store, [rule], new Date(t0.getTime() + 10_000));
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 50 });
    expect((await consumeAll(store, [rule], new Date(t0.getTime() + 61_000))).allowed).toBe(true);
  });
  it('login: 5 wrong guesses for one account from one IP are allowed, the 6th is a 429; success clears account counters', async () => {
    const store = new MemoryLimitStore(); const { rules, successClears } = loginRules('1.2.3.4', 'Admin');
    for (let i = 0; i < 5; i++) expect((await consumeAll(store, rules, t0)).allowed).toBe(true);
    expect((await consumeAll(store, rules, t0)).allowed).toBe(false);
    await Promise.all(successClears.map((k) => store.clear(k)));
    expect((await consumeAll(store, rules, t0)).allowed).toBe(true);
  });
  it('login: distributed guessing of one username from many IPs is stopped by the per-username rule', async () => {
    const store = new MemoryLimitStore(); let blockedAt = 0;
    for (let i = 1; i <= 20; i++) { if (!(await consumeAll(store, loginRules(`9.9.9.${i}`, 'admin').rules, t0)).allowed) { blockedAt = i; break; } }
    expect(blockedAt).toBe(11);
  });
  it('keys never contain the raw IP or username', () => {
    const keys = loginRules('203.0.113.7', 'SecretUser').rules.map((r) => r.key).join(' ');
    expect(keys).not.toContain('203.0.113.7'); expect(keys.toLowerCase()).not.toContain('secretuser');
  });
});

describe('admin password policy (server-side)', () => {
  it('accepts a long unique passphrase', () => expect(validateAdminPassword('violet-lantern-orbit-2026', { username: 'qa' }).ok).toBe(true));
  it.each([['short1!', 'TOO_SHORT'], ['password123', 'TOO_SHORT'], ['passwordpassword', 'COMMON'], ['matkhau-matkhau', 'COMMON'], ['aaaaaaaaaaaaaaaa', 'LOW_VARIETY'], [' leading-space-password', 'EDGE_WHITESPACE'], ['x'.repeat(201), 'TOO_LONG']])('rejects %s (%s)', (pw, code) => {
    const r = validateAdminPassword(pw); expect(r.ok).toBe(false); if (!r.ok) expect(r.errors.map((e) => e.code)).toContain(code);
  });
  it('rejects blocklisted and username-containing passwords', () => {
    expect(validateAdminPassword('nghiencuu').ok).toBe(false);
    expect(validateAdminPassword('NghienCuu-NghienCuu').ok).toBe(false);
    const r = validateAdminPassword('my-qa_researcher-secret-1', { username: 'qa_researcher' }); expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain('CONTAINS_USERNAME');
  });
});
