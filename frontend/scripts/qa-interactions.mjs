/**
 * Interaction QA in a real browser: planner editing, optimizer, site
 * independence, persistence, digital-twin selection, copilot tools, search.
 *
 *   node scripts/qa-interactions.mjs [baseUrl] [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'qa-output';
fs.mkdirSync(out, { recursive: true });
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, defaultViewport: { width: 1440, height: 1000 }, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const store = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__AEROHYDRO__.sites())));
const clickText = async (text, selector = 'button') => {
  const ok = await page.evaluate(
    (t, sel) => {
      const el = [...document.querySelectorAll(sel)].find((b) => b.textContent?.trim().includes(t));
      if (el) el.click();
      return !!el;
    },
    text,
    selector,
  );
  if (!ok) throw new Error(`No ${selector} with text "${text}"`);
};

// Fresh workspace
await page.goto(base + '/planner', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.goto(base + '/planner', { waitUntil: 'networkidle0' });
await sleep(800);

// 1. Defaults: 16 onshore (4 real) and 16 offshore
let s = await store();
check('Default onshore layout has 16 positions', s.sites.onshore.turbines.length === 16);
check('Exactly the 4 SCADA turbines are real', JSON.stringify(s.sites.onshore.turbines.filter((t) => t.status === 'real').map((t) => t.id)) === JSON.stringify(['R80711', 'R80721', 'R80736', 'R80790']));
check('Default offshore layout has 16 proposed positions', s.sites.offshore.turbines.length === 16 && s.sites.offshore.turbines.every((t) => t.status === 'proposed'));

// 2. Drag a proposed turbine (P05) in the SVG editor
const handle = await page.$('g[aria-label="P05"] circle');
const box = await handle.boundingBox();
const before = s.sites.onshore.turbines.find((t) => t.id === 'ON-P05');
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 8, box.y + box.height / 2 - i * 5);
await page.mouse.up();
await sleep(300);
s = await store();
const after = s.sites.onshore.turbines.find((t) => t.id === 'ON-P05');
check('Dragging moves a proposed turbine', after.x !== before.x || after.y !== before.y, `(${before.x},${before.y}) → (${after.x},${after.y})`);

// 3. Real turbine is locked
const real = await page.$('g[aria-label="R80711 (locked real asset)"] circle');
const rb = await real.boundingBox();
await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
await page.mouse.down();
await page.mouse.move(rb.x + 60, rb.y + 40, { steps: 6 });
await page.mouse.up();
s = await store();
const r0 = s.sites.onshore.turbines.find((t) => t.id === 'R80711');
check('Locked real turbine cannot be dragged', r0.x === s.sites.onshore.baseline.find((t) => t.id === 'R80711').x);

// 4. Undo restores, redo re-applies
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await sleep(200);
s = await store();
check('Undo restores previous position', s.sites.onshore.turbines.find((t) => t.id === 'ON-P05').x === before.x);
await page.keyboard.down('Control');
await page.keyboard.press('y');
await page.keyboard.up('Control');
await sleep(200);
s = await store();
check('Redo re-applies the move', s.sites.onshore.turbines.find((t) => t.id === 'ON-P05').x === after.x);

// 5. Add turbine mode
await clickText('Add turbine');
const svg = await page.$('svg[role="application"]');
const sb = await svg.boundingBox();
await page.mouse.click(sb.x + sb.width * 0.2, sb.y + sb.height * 0.8);
await sleep(300);
s = await store();
check('Add mode places a 17th turbine', s.sites.onshore.turbines.length === 17);
await page.keyboard.press('Escape');

// 6. Delete selected (the newly added one is selected)
await page.keyboard.press('Delete');
await sleep(200);
s = await store();
check('Delete removes the selected turbine', s.sites.onshore.turbines.length === 16);

// 7. Wind direction change alters modeled farm power
const farmText = async () => page.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.textContent === 'Farm power (modeled)')?.nextElementSibling?.textContent);
const p1 = await farmText();
await page.evaluate(() => {
  const input = [...document.querySelectorAll('input[type=range]')][0];
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '0');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
const p2 = await farmText();
check('Changing wind direction changes modeled farm power', p1 !== p2, `${p1} → ${p2}`);

// 8. Optimizer run (worker) produces a candidate with AEP >= start
await clickText('Optimize', '[role=tab]');
await page.evaluate(() => {
  const input = [...document.querySelectorAll('input[type=number]')].find((i) => i.closest('div')?.parentElement?.textContent?.includes('Max evaluations'));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '250');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const t0 = Date.now();
await clickText('Run optimization');
await page.waitForFunction(() => !!window.__AEROHYDRO__.sites().sites.onshore.candidate, { timeout: 120000 });
s = await store();
const c = s.sites.onshore.candidate;
check('Optimizer produced a candidate', !!c, `${c.evaluations} evals in ${((Date.now() - t0) / 1000).toFixed(1)} s, AEP ${c.startAepMWh.toFixed(0)} → ${c.aepMWh.toFixed(0)} MWh`);
check('Candidate AEP ≥ start AEP', c.aepMWh >= c.startAepMWh - 1e-6);
check('Real turbines unchanged in candidate', ['R80711', 'R80721', 'R80736', 'R80790'].every((id) => {
  const a = c.turbines.find((t) => t.id === id);
  const b = s.sites.onshore.turbines.find((t) => t.id === id);
  return a.x === b.x && a.y === b.y;
}));
await sleep(500);
await page.screenshot({ path: path.join(out, 'planner_after_opt.png'), fullPage: false });

// 9. Save layout dialog
await clickText('Save layout');
await page.type('#layout-name', 'QA layout');
await clickText('Save', '[role=dialog] button');
await sleep(200);
s = await store();
check('Save layout persists a named layout', s.sites.onshore.saved[0]?.name === 'QA layout');

// 10. Offshore independence
const onBefore = JSON.stringify(s.sites.onshore.turbines);
await clickText('Offshore', '[role=radio]');
await sleep(500);
const oh = await page.$('g[aria-label="OF01"] circle');
const ob = await oh.boundingBox();
await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2);
await page.mouse.down();
await page.mouse.move(ob.x + 70, ob.y + 30, { steps: 6 });
await page.mouse.up();
await sleep(200);
s = await store();
check('Editing offshore leaves onshore untouched', JSON.stringify(s.sites.onshore.turbines) === onBefore);
check('Offshore turbine moved', s.sites.offshore.turbines[0].x !== -1134 || s.sites.offshore.turbines[0].y !== 1134);

// 11. Persistence across reload
await page.reload({ waitUntil: 'networkidle0' });
s = await store();
check('Layouts persist across reload', JSON.stringify(s.sites.onshore.turbines) === onBefore && !!s.sites.onshore.candidate);

// 12. Twin: candidate view + selection via inventory
await page.goto(base + '/twin/onshore', { waitUntil: 'networkidle0' });
await sleep(2500);
await clickText('R80790', 'button');
await sleep(800);
const detail = await page.evaluate(() => document.body.innerText.includes('Real SCADA asset'));
check('Selecting a turbine opens the detail panel', detail);
const obsRow = await page.evaluate(() => document.body.innerText.includes('Records in hour'));
check('Real turbine shows observed SCADA values', obsRow);
await clickText('Optimized', '[role=radio]');
await sleep(800);
s = await store();
check('Twin can display the optimized candidate', s.sites.onshore.view === 'candidate');
await page.screenshot({ path: path.join(out, 'twin_selected.png') });

// 13. Copilot local tools
await page.goto(base + '/copilot', { waitUntil: 'networkidle0' });
const ask = async (q) => {
  await page.type('textarea[aria-label="Message the copilot"]', q);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.body.innerText.includes('Running tools…'), { timeout: 60000 });
  await sleep(400);
};
await ask('Why did turbine R80711 generate less power than expected?');
let txt = await page.evaluate(() => document.body.innerText);
check('Copilot answers under-performance with data', /sustained under-performance event/.test(txt) && txt.includes('anomaly_events'));
await ask('Prepare an operator instruction for it');
txt = await page.evaluate(() => document.body.innerText);
check('Follow-up keeps turbine context and drafts NOT-executed instruction', txt.includes('Draft operator instruction · R80711') && /not executed/i.test(txt));
await ask('What does the model predict at 9 m/s?');
txt = await page.evaluate(() => document.body.innerText);
check('Copilot predicts with the trained CNN-PINN and its physics bound', /At 9\.0 m\/s the CNN-PINN predicts/.test(txt) && txt.includes('Betz/rated bound'));
await ask('Explain the trade-offs between the baseline and optimized scenario.');
txt = await page.evaluate(() => document.body.innerText);
check('Copilot compares baseline vs optimized', txt.includes('optimized candidate changes modeled AEP'));
await page.screenshot({ path: path.join(out, 'copilot.png'), fullPage: false });

// 14. Command search navigates
await page.keyboard.down('Control');
await page.keyboard.press('k');
await page.keyboard.up('Control');
await page.type('input[aria-label="Search query"]', 'Hydrogen');
await page.keyboard.press('Enter');
await sleep(800);
check('Ctrl+K search navigates to a page', page.url().endsWith('/hydrogen'));

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
console.log(errors.length ? `Browser errors:\n  ${errors.slice(0, 10).join('\n  ')}` : 'No browser errors');
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
