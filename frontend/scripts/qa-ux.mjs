/**
 * QA for sign-in, digital-twin wind-on-click and installation recommendations.
 *
 *   QA_EMAIL=... QA_PASSWORD=... node scripts/qa-ux.mjs [baseUrl] [outDir]
 *
 * Without QA_EMAIL/QA_PASSWORD the sign-in step uses the local-workspace option.
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'qa-output';
fs.mkdirSync(out, { recursive: true });
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, defaultViewport: { width: 1440, height: 950 }, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && errors.push(m.text()));
const results = [];
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => page.evaluate(() => document.body.innerText);
const click = (t, sel = 'button') => page.evaluate((t, s) => { const el = [...document.querySelectorAll(s)].find((b) => b.textContent?.trim().includes(t)); el?.click(); return !!el; }, t, sel);

// 1. Protected route redirects to sign-in
await page.goto(base + '/planner', { waitUntil: 'networkidle0' });
check('Unauthenticated visit redirects to /login', page.url().includes('/login?next=%2Fplanner'));
await sleep(800);
await page.screenshot({ path: path.join(out, 'login.png') });

// 2. Sign in
if (process.env.QA_EMAIL && process.env.QA_PASSWORD) {
  const fill = async (label, value) => {
    const id = await page.evaluate((l) => [...document.querySelectorAll('label')].find((x) => x.textContent?.trim() === l)?.htmlFor, label);
    await page.$eval(`[id="${id}"]`, (el) => (el.value = ''));
    await page.type(`[id="${id}"]`, value);
  };
  const submit = async () => {
    await page.waitForFunction(() => !document.querySelector('form button[type=submit]')?.disabled, { timeout: 15000 });
    await page.evaluate(() => document.querySelector('form button[type=submit]').click());
  };
  await fill('Email', process.env.QA_EMAIL);
  await fill('Password', 'wrong-password-123');
  await submit();
  await page.waitForFunction(() => document.querySelector('[role=alert]'), { timeout: 15000 });
  check('Wrong password is rejected', (await text()).includes('Incorrect email or password'));
  await fill('Password', process.env.QA_PASSWORD);
  await submit();
} else {
  await click('Open local workspace');
}
await page.waitForFunction(() => location.pathname === '/planner', { timeout: 15000 });
check('Sign-in returns to the requested page', page.url().endsWith('/planner'));

// 3. Digital twin: no wind until a turbine is clicked
await page.goto(base + '/twin/onshore', { waitUntil: 'networkidle0' });
await sleep(2500);
check('Twin shows "click a turbine" hint with no selection', (await text()).includes('Click a turbine to see its airflow and wake'));
await page.screenshot({ path: path.join(out, 'twin_no_selection.png') });
await click('P06', 'button');
await sleep(2500);
check('Selecting a turbine removes the hint (wind shown)', !(await text()).includes('Click a turbine to see its airflow and wake'));
await page.screenshot({ path: path.join(out, 'twin_selected_wind.png') });

// 4. Installation recommendations
await page.goto(base + '/siting', { waitUntil: 'networkidle0' });
await sleep(800);
const t0 = Date.now();
await click('Find best installation sites');
await page.waitForFunction(() => document.body.innerText.includes('Recommended installation sites'), { timeout: 180000 });
const recText = await text();
check('Recommendations computed', /Net energy added/.test(recText), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
const before = await page.evaluate(() => window.__AEROHYDRO__.sites().sites.onshore.turbines.length);
await click('Add to layout');
await sleep(300);
const after = await page.evaluate(() => window.__AEROHYDRO__.sites().sites.onshore.turbines.length);
check('"Add to layout" adds the recommended turbine', after === before + 1, `${before} → ${after}`);
await page.screenshot({ path: path.join(out, 'siting.png'), fullPage: false });

// 5. Sign out
await page.evaluate(() => document.querySelector('button[aria-label="Account menu"]')?.click());
await sleep(200);
await click('Sign out');
await sleep(500);
check('Sign out returns to /login', page.url().includes('/login'));

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
console.log(errors.length ? `Browser errors:\n  ${errors.slice(0, 8).join('\n  ')}` : 'No browser errors');
await browser.close();
process.exit(results.every(Boolean) && !errors.length ? 0 : 1);
