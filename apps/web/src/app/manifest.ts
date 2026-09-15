import type { MetadataRoute } from 'next';

/**
 * What makes this installable rather than just a page.
 *
 * `display: standalone` is the point: once installed there is no browser
 * chrome, which matters more here than it sounds. A phone showing a URL bar
 * and tab strip has less room for the roster, and a tab is much easier to
 * close by accident while someone is relying on your location.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Where Are They',
    short_name: 'Where Are They',
    description: "Who's coming, who's close, and when everyone gets here.",
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#EFF1EE',
    theme_color: '#0B6E63',
    categories: ['social', 'travel', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops icons to whatever shape the launcher uses, so the
      // maskable copy is the same art with its content inside the safe zone.
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
