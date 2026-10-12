/**
 * Account flows in a real browser: create account → sign out → forgot password
 * → open reset link from the dev outbox → set new password → sign in.
 *
 *   node scripts/qa-auth.mjs [baseUrl] [outDir]
 * Requires the backend running without SMTP (dev outbox at backend/storage/outbox.log).
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'qa-output';
const outbox = path.resolve(process.env.OUTBOX ?? '../backend/storage/outbox.log');
fs.mkdirSync(out, { recursive: true });
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, defaultViewport: { width: 1440, height: 950 }, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/40[0-9]/.test(m.text()) && errors.push(m.text()));
const results = [];
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => page.evaluate(() => document.body.innerText);
const click = (t, sel = 'button') => page.evaluate((t, s) => { const el = [...document.querySelectorAll(s)].find((b) => b.textContent?.trim() === t || b.textContent?.trim().includes(t)); el?.click(); return !!el; }, t, sel);
const fill = async (label, value) => {
  const id = await page.evaluate((l) => [...document.querySelectorAll('label')].find((x) => x.textContent?.trim() === l)?.htmlFor, label);
  await page.$eval(`[id="${id}"]`, (el) => (el.value = ''));
  await page.type(`[id="${id}"]`, value);
};
const email = `qa.${Date.now()}@example.com`;
const pw1 = 'First-Password-123';
const pw2 = 'Second-Password-456';

await page.goto(base + '/login', { waitUntil: 'networkidle0' });
await sleep(600);
await click('Create account', '[role=tab]');
await sleep(200);
await page.screenshot({ path: path.join(out, 'signup.png') });
await fill('Full name', 'QA Account');
await fill('Email', email);
await fill('Password', pw1);
await fill('Confirm password', 'mismatch-123456');
await page.evaluate(() => document.querySelector('form button[type=submit]').click());
await sleep(300);
check('Sign-up rejects mismatched passwords', (await text()).includes('Passwords do not match'));
await fill('Confirm password', pw1);
await page.evaluate(() => document.querySelector('form button[type=submit]').click());
await page.waitForFunction(() => location.pathname === '/' && document.body.innerText.includes('QA Account'), { timeout: 20000 }).catch(() => {});
check('Create account signs the user in', (await text()).includes('QA Account'));

await page.evaluate(() => document.querySelector('button[aria-label="Account menu"]')?.click());
await sleep(200);
await click('Sign out');
await page.waitForFunction(() => location.pathname === '/login', { timeout: 10000 });

await page.goto(base + '/login', { waitUntil: 'networkidle0' });
await click('Forgot password?', 'a');
await page.waitForFunction(() => location.pathname === '/forgot-password', { timeout: 10000 });
await fill('Email', email);
const before = fs.existsSync(outbox) ? fs.readFileSync(outbox, 'utf8').length : 0;
await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Send reset link')); return b && !b.disabled; }, { timeout: 15000 });
await click('Send reset link');
await page.waitForFunction(() => document.body.innerText.includes('a reset link has been sent'), { timeout: 15000 });
check('Forgot password confirms (without revealing account existence)', true);
await page.screenshot({ path: path.join(out, 'forgot.png') });
const log = fs.readFileSync(outbox, 'utf8').slice(before);
const link = log.match(/https?:\/\/\S+reset-password\?token=\S+/)?.[0];
check('Reset link delivered to dev outbox', !!link && log.includes(email));

await page.goto(link, { waitUntil: 'networkidle0' });
await sleep(400);
await fill('New password', pw2);
await fill('Confirm new password', pw2);
await click('Update password');
await page.waitForFunction(() => location.search.includes('notice=reset'), { timeout: 15000 });
await page.waitForFunction(() => document.body.innerText.includes('Your password was changed'), { timeout: 15000 }).catch(() => {});
await page.screenshot({ path: path.join(out, 'after_reset.png') });
check('Reset succeeds and returns to sign-in with notice', (await text()).includes('Your password was changed'));

await fill('Password', pw1);
await page.evaluate(() => document.querySelector('form button[type=submit]').click());
await page.waitForFunction(() => document.querySelector('[role=alert]'), { timeout: 10000 });
check('Old password no longer works', (await text()).includes('Incorrect email or password'));
await fill('Password', pw2);
await page.evaluate(() => document.querySelector('form button[type=submit]').click());
await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 });
check('New password signs in', true);

await page.goto(link, { waitUntil: 'networkidle0' });
await fill('New password', 'Third-Password-789');
await fill('Confirm new password', 'Third-Password-789');
await click('Update password');
await page.waitForFunction(() => document.querySelector('[role=alert]'), { timeout: 10000 });
check('Reset link is single-use', (await text()).includes('invalid or has expired'));

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
console.log(errors.length ? `Browser errors:\n  ${errors.slice(0, 8).join('\n  ')}` : 'No browser errors');
await browser.close();
process.exit(results.every(Boolean) && !errors.length ? 0 : 1);
