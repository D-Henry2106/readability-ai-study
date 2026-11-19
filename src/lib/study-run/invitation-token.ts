import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random token, base64url (always 43 characters). The raw value exists only in memory and in the link given to the Admin once. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export function isWellFormedInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && INVITATION_TOKEN_PATTERN.test(value);
}

/** Only this hash is stored. The token has 256 bits of entropy, so a plain SHA-256 is sufficient (no slow hash needed). */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The token travels in the URL FRAGMENT (never sent to the server in a URL): https://<host>/i#<token> (architecture §6.3). */
export function buildInvitationLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/i#${token}`;
}
