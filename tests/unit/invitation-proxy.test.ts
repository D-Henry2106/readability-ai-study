import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const consumeAll = vi.fn();
vi.mock('@/lib/security/rate-limit', async (orig) => ({ ...(await orig<typeof import('@/lib/security/rate-limit')>()), consumeAll: (...a: unknown[]) => consumeAll(...a), MongoRateLimitStore: class {} }));
vi.mock('@/config/env', async (orig) => {
  const actual = await orig<typeof import('@/config/env')>();
  // Simulate a deployment behind a trusted proxy (e.g. Vercel) for THIS FILE ONLY. The production default stays 'false'.
  return { ...actual, getSecurityEnv: () => ({ ...actual.getSecurityEnv(), TRUST_PROXY_HEADERS: 'true' as const }) };
});
import { proxy } from '@/proxy';

const url = 'https://study.example';
const call = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => proxy(new NextRequest(url + path, init));
beforeEach(() => { consumeAll.mockReset(); consumeAll.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }); });

describe('proxy and the invitation entry (AC-04, AC-30)', () => {
  it('redeem is rate-limited per IP (plus the cookie rule) and cross-origin POSTs are blocked before any limiter', async () => {
    const blocked = await call('/api/invitations/redeem', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(blocked.status).toBe(403);
    expect(consumeAll).not.toHaveBeenCalled();
    await call('/api/invitations/redeem', { method: 'POST', headers: { origin: url, 'x-forwarded-for': '203.0.113.9', cookie: 'exp_session=a.b' } });
    const rules = consumeAll.mock.calls[0][1] as Array<{ key: string }>;
    expect(rules.some((r) => r.key.startsWith('invitation-redeem:ip:'))).toBe(true);
  });
  it('/i answers with no-referrer and no-store; other pages are unchanged', async () => {
    const res = await call('/i');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
    const other = await call('/information');
    expect(other.headers.get('Referrer-Policy')).toBeNull();
  });
});
