#!/usr/bin/env node
/**
 * WCAG 2.1 AA audit against a running app, with real data in it.
 *
 *   BASE=http://127.0.0.1:3000 TOKEN=<event token> COOKIE=<session> \
 *     node scripts/a11y.mjs
 *
 * Exits non-zero on any violation. The NFR says AA, and "we checked once"
 * is not the same as "it still passes".
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { BASE, TOKEN, COOKIE } = process.env;
if (!BASE || !TOKEN) {
  console.error('BASE and TOKEN are required.');
  process.exit(1);
}
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ??
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});

async function audit(page, label) {
  await page.addScriptTag({ content: axe });
  const results = await page.evaluate(async () =>
    await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    }),
  );
  return {
    label,
    violations: results.violations.map((v) => ({
      id: v.id, impact: v.impact, nodes: v.nodes.length,
      help: v.help, target: v.nodes[0]?.target?.join(' '),
    })),
  };
}

const report = [];

// Anonymous visitor on the invite page.
const anon = await browser.newPage({ viewport: { width: 400, height: 900 } });
await anon.goto(`${BASE}/e/${TOKEN}`, { waitUntil: 'networkidle' });
report.push(await audit(anon, 'invite page (not joined)'));

// Create page.
const create = await browser.newPage({ viewport: { width: 400, height: 900 } });
await create.goto(`${BASE}/`, { waitUntil: 'networkidle' });
report.push(await audit(create, 'create event'));

// Joined participant, each tab.
const context = await browser.newContext({
  viewport: { width: 400, height: 1000 },
  storageState: { cookies: [{
    name: `wat_p_${TOKEN}`, value: COOKIE, domain: '127.0.0.1', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
    expires: Math.floor(Date.now() / 1000) + 86400,
  }], origins: [] },
});
const page = await context.newPage();
await page.goto(`${BASE}/e/${TOKEN}`, { waitUntil: 'networkidle' });
report.push(await audit(page, 'event: list tab'));

await page.getByRole('tab', { name: 'Map' }).click();
await page.waitForTimeout(400);
report.push(await audit(page, 'event: map tab'));

await page.getByRole('tab', { name: /Feed/ }).click();
await page.waitForTimeout(600);
report.push(await audit(page, 'event: feed tab'));

await browser.close();

let total = 0;
for (const page of report) {
  const nodes = page.violations.reduce((sum, v) => sum + v.nodes, 0);
  total += nodes;
  console.log(`${nodes === 0 ? 'PASS' : 'FAIL'}  ${page.label}${nodes ? ` — ${nodes} node(s)` : ''}`);
  for (const violation of page.violations) {
    console.log(`        ${violation.impact}: ${violation.id} — ${violation.target}`);
    console.log(`        ${violation.help}`);
  }
}

console.log(total === 0 ? '\nNo WCAG 2.1 AA violations.' : `\n${total} violating node(s).`);
process.exit(total === 0 ? 0 : 1);
