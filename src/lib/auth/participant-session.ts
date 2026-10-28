import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getAuthEnv } from '@/config/env';

export const PARTICIPANT_COOKIE = 'exp_session';
const MAX_AGE = 60 * 60 * 24 * 30;

export function encodeParticipantSession(id: string, expiresAt = Date.now() + MAX_AGE * 1000): string {
  const payload = Buffer.from(JSON.stringify({ id, exp: expiresAt })).toString('base64url');
  const mac = createHmac('sha256', getAuthEnv().AUTH_SECRET).update(`participant:v1:${payload}`).digest('base64url');
  return `${payload}.${mac}`;
}
export function decodeParticipantSession(token: string): string | null {
  const pieces = token.split('.');
  if (pieces.length !== 2 || !pieces.every(Boolean)) return null;
  const [body, signature] = pieces;
  const expected = Buffer.from(createHmac('sha256', getAuthEnv().AUTH_SECRET).update(`participant:v1:${body}`).digest('base64url'));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data !== 'object' || !('id' in data) || !('exp' in data)) return null;
    const { id, exp } = data as { id: unknown; exp: unknown };
    return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) && typeof exp === 'number' && exp > Date.now() ? id : null;
  } catch { return null; }
}
export async function getParticipantSessionId(): Promise<string | null> {
  const value = (await cookies()).get(PARTICIPANT_COOKIE)?.value;
  return value ? decodeParticipantSession(value) : null;
}
export async function setParticipantSessionId(sessionId: string): Promise<void> {
  (await cookies()).set(PARTICIPANT_COOKIE, encodeParticipantSession(sessionId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE
  });
}
