/**
 * Content-Security-Policy with a per-request nonce (Next.js applies the nonce to its own scripts/styles).
 * Scripts get no 'unsafe-inline'. Only inline style *attributes* (React style={{...}}) are allowed,
 * because the existing UI uses them; <style> elements and scripts still require the nonce.
 */
export function buildCsp(options: { nonce: string; isDev: boolean; secure: boolean }): string {
  const { nonce, isDev, secure } = options;
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`
  ];
  if (secure) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export const newNonce = (): string => Buffer.from(crypto.randomUUID()).toString('base64');
