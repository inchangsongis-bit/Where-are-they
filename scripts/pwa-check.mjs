#!/usr/bin/env node
/**
 * Checks the things a browser checks before it will offer to install a site,
 * plus the caching rules this app cannot afford to get wrong.
 *
 *   BASE=http://127.0.0.1:3000 node scripts/pwa-check.mjs
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE;
if (!BASE) {
  console.error('BASE is required.');
  process.exit(1);
}

const failures = [];
const checks = [];
const check = (name, passed, detail = '') => {
  checks.push({ name, passed, detail });
  if (!passed) failures.push(name);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ??
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 900 } });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

// --- manifest ---------------------------------------------------------------
const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
check('manifest is linked from the page', manifestHref !== null, manifestHref ?? '');

const manifest = await page.evaluate(async (href) => {
  const response = await fetch(href);
  return response.ok ? await response.json() : null;
}, manifestHref ?? '/manifest.webmanifest');

check('manifest is served and parses', manifest !== null);
if (manifest !== null) {
  check('has a name', typeof manifest.name === 'string' && manifest.name.length > 0);
  check('display is standalone', manifest.display === 'standalone', manifest.display);
  check('has a start_url', typeof manifest.start_url === 'string');
  check('has a theme_color', typeof manifest.theme_color === 'string');

  const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
  check('has a 192px icon', sizes.includes('192x192'));
  check('has a 512px icon', sizes.includes('512x512'));
  check(
    'has a maskable icon',
    (manifest.icons ?? []).some((icon) => String(icon.purpose).includes('maskable')),
  );

  // Every icon must actually exist: a 404 here silently blocks installation.
  for (const icon of manifest.icons ?? []) {
    const status = await page.evaluate(
      async (src) => (await fetch(src)).status, icon.src,
    );
    check(`icon ${icon.src} is served`, status === 200, `HTTP ${status}`);
  }
}

// --- apple ------------------------------------------------------------------
check(
  'apple touch icon present (iOS has no manifest icons)',
  (await page.locator('link[rel="apple-touch-icon"]').count()) > 0,
);

// --- service worker ---------------------------------------------------------
const swReady = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  return registration !== null;
});
check('service worker registers and becomes ready', swReady);

const hasFetchHandler = await page.evaluate(async () => {
  const response = await fetch('/sw.js');
  const source = await response.text();
  return source.includes("addEventListener('fetch'");
});
check('service worker has a fetch handler (required to install)', hasFetchHandler);

// --- the caching rule that matters ------------------------------------------
const cachesApi = await page.evaluate(async () => {
  const response = await fetch('/sw.js');
  const source = await response.text();
  return {
    // A cached roster showing a friend's ETA from twenty minutes ago is worse
    // than no roster at all.
    skipsApi: source.includes("url.pathname.startsWith('/api/')"),
    offlineFallback: source.includes('/offline'),
  };
});
check('API responses are never cached', cachesApi.skipsApi);
check('navigations fall back to an offline page', cachesApi.offlineFallback);

const offlineStatus = await page.evaluate(
  async () => (await fetch('/offline')).status,
);
check('offline page is served', offlineStatus === 200, `HTTP ${offlineStatus}`);

await browser.close();

for (const { name, passed, detail } of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
console.log(
  failures.length === 0
    ? '\nInstallable.'
    : `\n${failures.length} check(s) failed.`,
);
process.exit(failures.length === 0 ? 0 : 1);
