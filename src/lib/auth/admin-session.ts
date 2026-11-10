import { cookies } from 'next/headers';
import { getSecurityEnv } from '@/config/env';
import {
  AdminSessionService, MongoAdminDirectory, MongoAdminSessionStore,
  type AdminSessionPayload
} from './admin-session-service';
import type { AdminRole } from '@/types/research';

export type { AdminSessionPayload } from './admin-session-service';

const LEGACY_HMAC_COOKIE = 'research_admin';
const isProduction = () => process.env.NODE_ENV === 'production';
/** The __Host- prefix makes browsers require Secure + Path=/ + no Domain in production. */
export const adminCookieName = () => (isProduction() ? '__Host-research_admin_sid' : 'research_admin_sid');

export function adminSessionService(): AdminSessionService {
  return new AdminSessionService(new MongoAdminSessionStore(), new MongoAdminDirectory(), () => {
    const env = getSecurityEnv();
    return { idleMs: env.ADMIN_SESSION_IDLE_MINUTES * 60_000, absoluteMs: env.ADMIN_SESSION_ABSOLUTE_HOURS * 3_600_000 };
  });
}

/**
 * Log in = rotate: the presented session (if any) is revoked server-side and a fresh random token is issued.
 * Any pre-migration HMAC cookie is deleted and is never honoured again.
 */
export async function startAdminSession(username: string): Promise<void> {
  const store = await cookies();
  const service = adminSessionService();
  await service.revoke(store.get(adminCookieName())?.value, 'ROTATED_ON_LOGIN');
  const { token, maxAgeSeconds } = await service.issue(username);
  store.set(adminCookieName(), token, { httpOnly: true, secure: isProduction(), sameSite: 'strict', path: '/', maxAge: maxAgeSeconds });
  store.delete(LEGACY_HMAC_COOKIE);
}

/** @deprecated Kept for source compatibility; the role is read from the admins collection on every request. */
export async function setAdminSession(username: string, _role?: AdminRole): Promise<void> {
  void _role;
  await startAdminSession(username);
}

/** Logout: revoke on the server first, so a copied cookie cannot be replayed, then expire the cookie. */
export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  await adminSessionService().revoke(store.get(adminCookieName())?.value, 'LOGOUT');
  store.delete(adminCookieName());
  store.delete(LEGACY_HMAC_COOKIE);
}

export async function getAdminSession(): Promise<AdminSessionPayload | null> {
  const token = (await cookies()).get(adminCookieName())?.value;
  return adminSessionService().validate(token);
}

export async function requireAdmin(roles?: AdminRole[]): Promise<AdminSessionPayload> {
  const session = await getAdminSession();
  if (!session) throw new Error('UNAUTHORIZED');
  if (roles && !roles.includes(session.role)) throw new Error('FORBIDDEN');
  return session;
}
