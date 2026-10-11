/**
 * End-to-end QA of backend-powered features through the UI (requires the
 * frontend built/served with VITE_API_BASE_URL pointing at a running backend).
 *
 *   node scripts/qa-backend.mjs [baseUrl] [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// The app now requires a session; QA runs as a local-workspace user.
const QA_SESSION = JSON.stringify({ state: { session: { user: { name: 'QA Engineer', email: 'local workspace', role: 'local' }, mode: 'local', signedInAt: new Date().toISOString() } }, version: 0 });
const withSession = (p) => p.evaluateOnNewDocument((v) => { if (!localStorage.getItem('aerohydro.auth.v1')) localStorage.setItem('aerohydro.auth.v1', v); }, QA_SESSION);


const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'qa-output';
fs.mkdirSync(out, { recursive: true });
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, defaultViewport: { width: 1440, height: 1100 }, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await withSession(page);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const results = [];
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`));
const click = (text, sel = 'button') => page.evaluate((t, s) => { const el = [...document.querySelectorAll(s)].find((b) => b.textContent?.trim().includes(t)); el?.click(); return !!el; }, text, sel);
const text = () => page.evaluate(() => document.body.innerText);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(base + '/models', { waitUntil: 'networkidle0' });
await sleep(1000);
check('API online pill', (await text()).includes('API online'));
await click('Predict');
await page.waitForFunction(() => document.body.innerText.includes('Betz/rated bound') && document.body.innerText.includes('Air density'), { timeout: 30000 });
const pred = (await text()).match(/Predicted power\s*([\d,]+) kW/);
check('Live CNN-PINN prediction via backend', !!pred, pred?.[0]);

await page.goto(base + '/forecasting', { waitUntil: 'networkidle0' });
await click('Forecast');
await page.waitForFunction(() => document.body.innerText.includes('+24 h'), { timeout: 60000 });
check('Live forecast via backend returns 5 horizons', ((await text()).match(/\+\d+ h ·/g) ?? []).length === 5);

await page.goto(base + '/planner', { waitUntil: 'networkidle0' });
await sleep(800);
await click('Optimize', '[role=tab]');
await sleep(300);
await click('FLORIS (backend)', '[role=radio]');
await page.evaluate(() => {
  const input = [...document.querySelectorAll('input[type=number]')].find((i) => i.closest('div')?.parentElement?.textContent?.includes('Max evaluations'));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '80');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const t0 = Date.now();
await click('Run FLORIS optimization');
await page.waitForFunction(() => document.body.innerText.includes('evaluations,') && document.body.innerText.includes('FLORIS 4'), { timeout: 600000 });
const fl = (await text()).match(/FLORIS 4[^:]*: AEP [^\n]*evaluations, [\d.]+ s/);
check('FLORIS server-side optimization completes', !!fl, `${fl?.[0]} (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
await page.screenshot({ path: path.join(out, 'planner_floris.png') });

await page.goto(base + '/hydrogen', { waitUntil: 'networkidle0' });
await sleep(1500);
await click('Run on backend');
await page.waitForFunction(() => document.body.innerText.includes('Backend H₂'), { timeout: 60000 });
const h2 = (await text()).match(/difference ([\d.,]+) kg/);
check('Hydrogen backend cross-check matches browser model', !!h2 && Number(h2[1].replace(/,/g, '')) < 1, h2?.[0]);

await page.goto(base + '/copilot', { waitUntil: 'networkidle0' });
check('Copilot states LLM not configured on backend', (await text()).includes('no LLM provider is configured'));

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
console.log(errors.length ? `Browser errors:\n  ${errors.slice(0, 8).join('\n  ')}` : 'No browser errors');
await browser.close();
process.exit(results.every(Boolean) && !errors.length ? 0 : 1);
