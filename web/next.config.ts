import type { NextConfig } from 'next';

const config: NextConfig = {
  // The finance engine is consumed as TypeScript source so the scenario calculator runs the exact
  // same code in the browser as the research worker runs through the CLI.
  transpilePackages: ['@planb/finance', '@planb/matching'],
  serverExternalPackages: ['postgres'],
  experimental: { serverActions: { bodySizeLimit: '45mb' } },
  poweredByHeader: false,
  async headers() {
    // Restricts where scripts, styles, frames and form posts may go. Inline scripts are still allowed because the
    // framework emits them; moving to per-request nonces is the next step. Not applied in development, where the
    // dev runtime needs eval.
    const csp = [
      "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
      "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          ...(process.env.NODE_ENV === 'production' ? [{ key: 'Content-Security-Policy', value: csp }] : []),
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default config;
