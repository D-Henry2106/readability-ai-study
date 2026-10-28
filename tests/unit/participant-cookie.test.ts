import { describe, expect, it, vi } from 'vitest';
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/config/env', () => ({ getAuthEnv: () => ({ AUTH_SECRET: 'a'.repeat(64) }) }));
import { decodeParticipantSession, encodeParticipantSession } from '@/lib/auth/participant-session';
describe('signed participant session ownership', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  it('accepts a genuine unexpired token', () => expect(decodeParticipantSession(encodeParticipantSession(id))).toBe(id));
  it('rejects a modified, unsigned and expired cookie', () => {
    const signed = encodeParticipantSession(id);
    expect(decodeParticipantSession(signed.replace(/.$/,signed.endsWith('a')?'b':'a'))).toBeNull();
    expect(decodeParticipantSession(id)).toBeNull();
    expect(decodeParticipantSession(encodeParticipantSession(id, Date.now()-1000))).toBeNull();
  });
});
