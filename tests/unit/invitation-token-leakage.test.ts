import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import nextConfig from '../../next.config';
import { handleRedeem } from '@/lib/study-run/redeem-handler';
import { StudyRunError } from '@/lib/study-run/errors';
import { generateInvitationToken } from '@/lib/study-run/invitation-token';
import type { RedeemResult } from '@/lib/services/invitation-redemption.service';

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8');
const TOKEN = generateInvitationToken();
const body = (over: Record<string, unknown> = {}) => ({ json: async () => ({ token: TOKEN, deviceType: 'desktop', ...over }) });

function deps(result: RedeemResult | Error) {
  const cookies: string[] = [];
  const seen: Array<{ token: string; cookieSessionId: string | null }> = [];
  return {
    cookies, seen,
    value: {
      service: { redeem: async (input: { token: string; cookieSessionId: string | null }) => { seen.push({ token: input.token, cookieSessionId: input.cookieSessionId }); if (result instanceof Error) throw result; return result; } },
      getCookieSessionId: async () => 'cookie-session',
      setCookieSessionId: async (id: string) => { cookies.push(id); }
    }
  };
}
const created: RedeemResult = { outcome: 'CREATED', sessionId: 's1', nextRoute: '/information', grantCookie: true };

describe('redeem endpoint: no token in responses, no-store, cookie only when granted (AC-25, AC-30)', () => {
  it('every response is no-store and never contains the token (success, domain errors, bad body, unexpected error)', async () => {
    const scenarios: Array<RedeemResult | Error> = [
      created,
      { outcome: 'RESUMED', sessionId: 's1', nextRoute: '/consent', grantCookie: false },
      new StudyRunError('INVITATION_UNAVAILABLE', 404), new StudyRunError('INVITATION_ALREADY_USED', 409),
      new StudyRunError('ACTIVE_SESSION_IN_BROWSER', 409), new StudyRunError('INVITATION_REDEEM_IN_PROGRESS', 409),
      new Error(`boom ${TOKEN}`)
    ];
    const originalError = console.error;
    const logged: unknown[] = [];
    console.error = (...a: unknown[]) => { logged.push(a); };
    try {
      for (const s of scenarios) {
        const res = await handleRedeem(body(), deps(s).value);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const text = await res.text();
        expect(text.includes(TOKEN)).toBe(false);
      }
      const bad = await handleRedeem({ json: async () => ({ token: TOKEN, deviceType: 'toaster' }) }, deps(created).value);
      expect(bad.status).toBe(400);
      expect(bad.headers.get('Cache-Control')).toBe('no-store');
      expect((await bad.text()).includes(TOKEN)).toBe(false);
      const unparsable = await handleRedeem({ json: async () => { throw new Error('bad json'); } }, deps(created).value);
      expect(unparsable.status).toBe(400);
    } finally { console.error = originalError; }
    expect(JSON.stringify(logged).includes(TOKEN)).toBe(false);
  });
  it('sets the participant cookie only when the service grants it, and passes the existing cookie session id on', async () => {
    const granted = deps(created);
    const r1 = await handleRedeem(body(), granted.value);
    expect(r1.status).toBe(200);
    expect(granted.cookies).toEqual(['s1']);
    expect(granted.seen[0].cookieSessionId).toBe('cookie-session');
    const resumed = deps({ outcome: 'RESUMED', sessionId: 's1', nextRoute: '/consent', grantCookie: false });
    const r2 = await handleRedeem(body(), resumed.value);
    expect(resumed.cookies).toEqual([]);
    expect(JSON.stringify(await r2.json())).toBe(JSON.stringify({ ok: true, resumed: true, nextRoute: '/consent' }));
    for (const s of [new StudyRunError('INVITATION_ALREADY_USED', 409), new StudyRunError('INVITATION_UNAVAILABLE', 404)]) {
      const d = deps(s);
      await handleRedeem(body(), d.value);
      expect(d.cookies).toEqual([]);
    }
  });
  it('status codes: unavailable 404, used/busy/in-progress 409 (Retry-After on in-progress)', async () => {
    const r = async (code: string, status: 404 | 409) => handleRedeem(body(), deps(new StudyRunError(code, status)).value);
    expect((await r('INVITATION_UNAVAILABLE', 404)).status).toBe(404);
    expect((await r('INVITATION_ALREADY_USED', 409)).status).toBe(409);
    expect((await r('ACTIVE_SESSION_IN_BROWSER', 409)).status).toBe(409);
    const busy = await r('INVITATION_REDEEM_IN_PROGRESS', 409);
    expect(busy.status).toBe(409);
    expect(busy.headers.get('Retry-After')).toBe('15');
  });
});

describe('token transport and storage (AC-30)', () => {
  it('/i client keeps the token only in memory, strips the fragment first, and posts it in the body', () => {
    const client = read('src/components/participant/InvitationEntry.tsx').replace(/\/\/.*$/gm, '');
    expect(/localStorage|sessionStorage|document\.cookie|indexedDB/.test(client)).toBe(false);
    expect(client.includes('window.history.replaceState')).toBe(true);
    expect(client.indexOf('window.history.replaceState')).toBeLessThan(client.indexOf('fetch('));
    expect(client.includes("method: 'POST'")).toBe(true);
    expect(client.includes('JSON.stringify({ token')).toBe(true);
    expect(client.includes('window.location.replace')).toBe(true);
    expect(/fetch\([^)]*token/.test(client.replace(/body: JSON\.stringify[^\n]*/, ''))).toBe(false);   // never in the URL
    expect(client.includes("referrerPolicy: 'no-referrer'")).toBe(true);
  });
  it('/i page is static: no data access, no-referrer metadata, not indexable', () => {
    const page = read('src/app/i/page.tsx');
    expect(/@\/lib\/(repositories|db|services)/.test(page)).toBe(false);
    expect(page.includes("referrer: 'no-referrer'")).toBe(true);
    expect(page.includes('index: false')).toBe(true);
    expect(/export (async )?function|cookies\(|headers\(/.test(page.replace('export default function InvitationPage', ''))).toBe(false);
  });
  it('no redeem-path file logs, and no GET handler exists for redeem (preview scanners cannot trigger it)', () => {
    for (const file of ['src/app/api/invitations/redeem/route.ts', 'src/lib/study-run/redeem-handler.ts', 'src/lib/services/invitation-redemption.service.ts',
      'src/lib/services/run-session.service.ts', 'src/lib/services/invitation.service.ts', 'src/components/participant/InvitationEntry.tsx']) {
      const src = read(file).replace(/\/\/.*$/gm, '');
      expect(/console\.(log|info|debug|warn)\b/.test(src)).toBe(false);
      expect(/console\.error\([^)]*(token|body|request)/i.test(src)).toBe(false);
    }
    const route = read('src/app/api/invitations/redeem/route.ts');
    expect(/export (async )?function (GET|HEAD|PUT|PATCH|DELETE)/.test(route)).toBe(false);
    expect(route.includes('export async function POST')).toBe(true);
  });
  it('the service stores and returns no raw token: only the hash is persisted', () => {
    for (const file of ['src/lib/repositories/invitation.repository.ts', 'src/types/invitation.ts']) {
      expect(/\btoken\b\s*[:?]/.test(read(file).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))).toBe(false);
    }
  });
});

describe('Referrer-Policy and caching for /i (AC-30)', () => {
  it('next.config: /i gets no-referrer + no-store, and the global Referrer-Policy rule excludes /i (no conflicting headers)', async () => {
    const rules = await nextConfig.headers!();
    const entry = rules.find((r) => r.source === '/i')!;
    const get = (r: { headers: Array<{ key: string; value: string }> }, k: string) => r.headers.filter((h) => h.key === k).map((h) => h.value);
    expect(get(entry, 'Referrer-Policy')).toEqual(['no-referrer']);
    expect(get(entry, 'Cache-Control')).toEqual(['no-store']);
    const global = rules.find((r) => r.source !== '/i')!;
    expect(get(global, 'Referrer-Policy')).toEqual(['strict-origin-when-cross-origin']);
    const inner = /^\/:path\((.*)\)$/.exec(global.source)![1];
    const matches = (p: string) => new RegExp(`^${inner}$`).test(p.replace(/^\//, ''));
    expect(matches('i')).toBe(false);
    for (const p of ['/', '/information', '/info', '/api/session', '/admin/login', '/i/x', '/index']) expect(matches(p)).toBe(true);
    // the other security headers are still present on both
    for (const r of [entry, global]) { expect(get(r, 'X-Frame-Options')).toEqual(['DENY']); expect(get(r, 'X-Content-Type-Options')).toEqual(['nosniff']); }
  });
});
