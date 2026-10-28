import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getAuthEnv } from '@/config/env';
import type { AdminRole } from '@/types/research';

const COOKIE = 'research_admin';
const MAX_AGE_SECONDS = 8 * 60 * 60;

export interface AdminSessionPayload {
  username: string;
  role: AdminRole;
  exp: number;
}

function sign(body: string): string {
  return createHmac('sha256', getAuthEnv().AUTH_SECRET).update(body).digest('base64url');
}

export function encodeAdminSession(payload: AdminSessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function decodeAdminSession(token: string): AdminSessionPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AdminSessionPayload;
    if (!payload.username || !['RESEARCHER', 'SUPERVISOR'].includes(payload.role) || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setAdminSession(username: string, role: AdminRole): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, encodeAdminSession({ username, role, exp: Date.now() + MAX_AGE_SECONDS * 1000 }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS
  });
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getAdminSession(): Promise<AdminSessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  return token ? decodeAdminSession(token) : null;
}

export async function requireAdmin(roles?: AdminRole[]): Promise<AdminSessionPayload> {
  const session = await getAdminSession();
  if (!session) throw new Error('UNAUTHORIZED');
  if (roles && !roles.includes(session.role)) throw new Error('FORBIDDEN');
  return session;
}
