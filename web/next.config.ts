import type { NextConfig } from 'next';

const config: NextConfig = {
  // The finance engine is consumed as TypeScript source so the scenario calculator runs the exact
  // same code in the browser as the research worker runs through the CLI.
  transpilePackages: ['@planb/finance'],
  serverExternalPackages: ['postgres'],
  experimental: { serverActions: { bodySizeLimit: '45mb' } },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
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
