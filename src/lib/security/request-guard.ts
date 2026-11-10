import { isIP } from 'node:net';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const isStateChanging = (method: string): boolean => !SAFE_METHODS.has(method.toUpperCase());

function originOf(value: string | null | undefined): string | null {
  if (!value || value === 'null') return null;
  try { return new URL(value).origin; } catch { return null; }
}

export interface OriginCheckInput {
  method: string;
  origin: string | null;
  referer: string | null;
  secFetchSite: string | null;
  /** Origins this deployment serves (request origin and APP_URL). */
  allowedOrigins: Array<string | null | undefined>;
  hasCookies: boolean;
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests: the browser-supplied Origin
 * (or, failing that, Sec-Fetch-Site / Referer) must be this site. A request that carries cookies
 * but no origin signal at all is refused; one without cookies cannot be a CSRF and passes.
 */
export function evaluateOrigin(input: OriginCheckInput): { allowed: boolean; reason: string } {
  if (!isStateChanging(input.method)) return { allowed: true, reason: 'safe-method' };
  const allowed = new Set(input.allowedOrigins.map(originOf).filter((o): o is string => !!o));
  if (input.origin !== null) {
    const origin = originOf(input.origin);
    return origin && allowed.has(origin) ? { allowed: true, reason: 'origin-match' } : { allowed: false, reason: 'origin-mismatch' };
  }
  if (input.secFetchSite) {
    return input.secFetchSite === 'same-origin' || input.secFetchSite === 'none'
      ? { allowed: true, reason: 'sec-fetch-site' } : { allowed: false, reason: 'cross-site' };
  }
  const referer = originOf(input.referer);
  if (referer) return allowed.has(referer) ? { allowed: true, reason: 'referer-match' } : { allowed: false, reason: 'referer-mismatch' };
  return input.hasCookies ? { allowed: false, reason: 'no-origin-signal' } : { allowed: true, reason: 'no-cookies' };
}

/**
 * Client IP, only when the deployment states that a trusted proxy overwrites X-Forwarded-For.
 * Otherwise null: spoofable headers must never decide who gets throttled.
 */
export function clientIp(headers: Pick<Headers, 'get'>, trustProxyHeaders: boolean): string | null {
  if (!trustProxyHeaders) return null;
  const candidate = (headers.get('x-forwarded-for')?.split(',')[0] ?? headers.get('x-real-ip') ?? '').trim();
  return isIP(candidate) ? candidate : null;
}
