import type { NextConfig } from 'next';

const config: NextConfig = {
  // PS-4: invite tokens are bearer credentials. Keep them out of search
  // indexes and out of referrer headers sent to third parties.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        source: '/e/:token*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
      },
    ];
  },
  // packages/core ships TypeScript source rather than a build artifact, so
  // Next compiles it as part of the app. One less build step between an edit
  // to a shared rule and seeing it on screen.
  transpilePackages: ['@wat/core'],
  serverExternalPackages: ['pg'],
};

export default config;
