/**
 * Browser QA: visits routes in headless Chrome/Edge, records console errors,
 * page errors and failed requests, and saves screenshots.
 *
 *   node scripts/qa-screens.mjs [baseUrl] [outDir] [route ...]
 *
 * Requires a running dev/preview server. Uses the locally installed browser
 * (CHROME_PATH env var overrides the default paths).
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// The app now requires a session; QA runs as a local-workspace user.
const QA_SESSION = JSON.stringify({ state: { session: { user: { name: 'QA Engineer', email: 'local workspace', role: 'local' }, mode: 'local', signedInAt: new Date().toISOString() } }, version: 0 });
const withSession = (p) => p.evaluateOnNewDocument((v) => { if (!localStorage.getItem('aerohydro.auth.v1')) localStorage.setItem('aerohydro.auth.v1', v); }, QA_SESSION);


const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'qa-output';
const routes = process.argv.slice(4).length
  ? process.argv.slice(4)
  : ['/', '/twin/onshore', '/twin/offshore', '/planner', '/siting', '/wind', '/hydro', '/hydrogen', '/forecasting', '/scenarios', '/anomalies', '/models', '/copilot', '/reports', '/settings', '/does-not-exist'];

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => fs.existsSync(p));
if (!executablePath) throw new Error('No Chrome/Edge executable found; set CHROME_PATH.');

fs.mkdirSync(out, { recursive: true });
const width = Number(process.env.QA_WIDTH ?? 1440);
const height = Number(process.env.QA_HEIGHT ?? 900);
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${width},${height}`],
  defaultViewport: { width, height },
});

let failures = 0;
for (const route of routes) {
  const page = await browser.newPage();
  await withSession(page);
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => {
    if (!r.url().includes('fonts.g')) problems.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`);
  });
  await page.goto(base + route, { waitUntil: 'networkidle0', timeout: 60000 }).catch((e) => problems.push(`[goto] ${e.message}`));
  await new Promise((r) => setTimeout(r, Number(process.env.QA_WAIT ?? 2500)));
  const name = route === '/' ? 'overview' : route.replace(/^\//, '').replace(/[/?=&]/g, '_');
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: process.env.QA_FULL === '1' });
  const errs = problems.filter((p) => !p.includes('React Router Future Flag') && !p.includes('GPU stall') && !p.includes('GL Driver Message'));
  if (errs.length) failures++;
  console.log(`${errs.length ? 'WARN' : ' OK '} ${route}${errs.length ? '\n   ' + errs.slice(0, 8).join('\n   ') : ''}`);
  await page.close();
}
await browser.close();
console.log(failures ? `${failures} route(s) reported problems` : 'All routes clean');
