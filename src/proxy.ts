import { NextRequest, NextResponse } from 'next/server';
import { getSecurityEnv } from '@/config/env';
import { buildCsp, newNonce } from '@/lib/security/csp';
import { clientIp, evaluateOrigin, isStateChanging } from '@/lib/security/request-guard';
import { consumeAll, keyPart, MongoRateLimitStore, type RateLimitRule } from '@/lib/security/rate-limit';
import { tooManyRequests } from '@/lib/http';
import { PARTICIPANT_COOKIE } from '@/lib/auth/participant-session';

const isHttps = (request: NextRequest) =>
  request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';

/** HSTS only for production traffic that really arrived over HTTPS, so local/HTTP testing is never pinned. */
function withHsts<T extends NextResponse>(request: NextRequest, response: T): T {
  if (process.env.NODE_ENV === 'production' && isHttps(request)) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
  return response;
}

const MIN = 60_000;
/** Generous on purpose: a classroom behind one NAT address must never be blocked by these. */
function participantRules(request: NextRequest, ip: string | null): RateLimitRule[] {
  const rules: RateLimitRule[] = [];
  if (ip) rules.push({ key: `participant:ip:${keyPart(ip)}`, limit: 1500, windowMs: MIN });
  if (request.nextUrl.pathname === '/api/session' && ip) rules.push({ key: `session-create:ip:${keyPart(ip)}`, limit: 300, windowMs: 10 * MIN });
  if (request.nextUrl.pathname === '/api/invitations/redeem' && ip) rules.push({ key: `invitation-redeem:ip:${keyPart(ip)}`, limit: 300, windowMs: 10 * MIN });
  const cookie = request.cookies.get(PARTICIPANT_COOKIE)?.value;
  if (cookie) rules.push({ key: `participant:cookie:${keyPart(cookie)}`, limit: 60, windowMs: MIN });
  return rules;
}

async function handleApi(request: NextRequest): Promise<NextResponse> {
  const origin = evaluateOrigin({
    method: request.method,
    origin: request.headers.get('origin'),
    referer: request.headers.get('referer'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    allowedOrigins: [request.nextUrl.origin, process.env.APP_URL],
    hasCookies: request.headers.has('cookie')
  });
  if (!origin.allowed) {
    return withHsts(request, NextResponse.json({ error: 'Yêu cầu bị từ chối vì nguồn gửi không hợp lệ.' }, { status: 403 }));
  }
  // Admin endpoints are protected by role checks and (for login/password) their own limiter.
  if (isStateChanging(request.method) && !request.nextUrl.pathname.startsWith('/api/admin/')) {
    try {
      const ip = clientIp(request.headers, getSecurityEnv().TRUST_PROXY_HEADERS === 'true');
      const rules = participantRules(request, ip);
      if (rules.length) {
        const decision = await consumeAll(new MongoRateLimitStore(), rules);
        if (!decision.allowed) return withHsts(request, tooManyRequests(decision.retryAfterSeconds));
      }
    } catch {
      // Fail open for participants: an unavailable limiter must not stop a running study. Error type only, no data.
      console.error('Participant throttling skipped: rate-limit store unavailable.');
    }
  }
  return withHsts(request, NextResponse.next());
}

function handlePage(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV === 'development', secure: isHttps(request) });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  if (request.nextUrl.pathname === '/i') {
    // Study Run invitation entry: defence in depth next to next.config.ts (the token is in the fragment and is never sent anyway).
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('Cache-Control', 'no-store');
  }
  return withHsts(request, response);
}

export async function proxy(request: NextRequest) {
  return request.nextUrl.pathname.startsWith('/api/') ? handleApi(request) : handlePage(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)']
};
