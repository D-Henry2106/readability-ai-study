import type { NextConfig } from 'next';

// CSP (per-request nonce) and HSTS (HTTPS production only) are set in src/proxy.ts.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }
    ];
    return [
      // Every path except the invitation entry page keeps the existing policy (the two rules never overlap, so no header conflict).
      { source: '/:path((?!i$).*)', headers: [...common, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
      // /i (Study Run invitation entry): never send a Referer, never cache.
      { source: '/i', headers: [...common, { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] }
    ];
  }
};

export default nextConfig;
