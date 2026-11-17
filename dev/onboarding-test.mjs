// Browser test for first launch: Welcome post, tour, and the Help (?) menu.
//   node dev/onboarding-test.mjs [screenshotDir]      (needs Playwright and Chrome)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const posts = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-first-'));
const shots = process.argv[2] || null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const PORT = 47996;
process.on('exit', () => { try { server.kill(); } catch (e) {} });
const server = spawn(process.execPath, [path.join(HERE, 'mock-server.mjs'), posts, String(PORT)], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 600));

let failures = 0;
const check = (ok, what, extra = '') => { console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok || !extra ? '' : '\n         ' + extra)); if (!ok) failures++; };

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

console.log('First launch');
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#tour .tour-card', { timeout: 15000 });
const dirs = fs.readdirSync(posts).filter(n => fs.existsSync(path.join(posts, n, 'post.json')));
check(dirs.length === 1 && dirs[0].endsWith('welcome-to-crowdersphere'), 'Welcome post created', dirs.join(','));
const dir = path.join(posts, dirs[0] || '');
const html = fs.existsSync(path.join(dir, 'post.html')) ? fs.readFileSync(path.join(dir, 'post.html'), 'utf8') : '';
check(/<figure[^>]*><img src="images\/welcome-sunset\.jpg"/.test(html), 'it has its sample picture', html.slice(0, 200));
check(fs.existsSync(path.join(dir, 'images', 'welcome-sunset.jpg')) && fs.statSync(path.join(dir, 'images', 'welcome-sunset.jpg')).size > 5000, 'the picture file is saved');
check(await page.evaluate(() => $('#title').value) === 'Welcome to CrowderSphere', 'and it is open in the editor');
check(await page.evaluate(() => !!document.querySelector('#editor figure img') && document.querySelector('#editor figure img').naturalWidth > 0 || new Promise(r => { const i = document.querySelector('#editor figure img'); i.onload = () => r(i.naturalWidth > 0); setTimeout(() => r(false), 3000); })), 'its picture shows in the editor');
check(!(await page.evaluate(() => state.dirty)), 'opening it does not mark it changed');

console.log('Tour');
const n = await page.evaluate(() => CSOnboarding.STEPS.length);
for (let i = 0; i < n; i++) {
  await page.waitForTimeout(350);   // let the card finish sliding into place
  const info = await page.evaluate(() => {
    const c = document.querySelector('#tour .tour-card').getBoundingClientRect();
    const h = document.querySelector('#tour .tour-hole'), hs = h.style.display !== 'none' ? h.getBoundingClientRect() : null;
    return { title: document.querySelector('#tour h3').textContent, count: document.querySelector('.tour-count').textContent,
      inView: c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight,
      overlap: hs && !(c.right <= hs.left || c.left >= hs.right || c.bottom <= hs.top || c.top >= hs.bottom) && !(hs.width > innerWidth * .5 && hs.height > innerHeight * .5) };
  });
  check(info.inView && !info.overlap && info.count === `${i + 1} of ${n}`, `step ${i + 1}: "${info.title}" is on screen and not covering what it points at`, JSON.stringify(info));
  if (shots) await page.screenshot({ path: path.join(shots, `tour-${i + 1}.png`) });
  if (i === 2) { await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); }   // keys work too
  await page.click('#tour [data-t="next"]');
}
check(!(await page.$('#tour')), 'Done closes the tour');
await page.waitForTimeout(300);
check(JSON.parse(await (await fetch(`http://localhost:${PORT}/api/settings`)).text()).prefs.tourDone === true, 'and remembers it was seen');

console.log('Next launch');
await page.reload();
await page.waitForSelector('#editor .cs-doc');
await page.waitForTimeout(1500);
check(!(await page.$('#tour')), 'no tour the second time');
check(fs.readdirSync(posts).filter(n => fs.existsSync(path.join(posts, n, 'post.json'))).length === 1, 'and no second Welcome post');

console.log('Help menu');
await page.click('#helpBtn');
await page.waitForSelector('#modalBack:not([hidden]) .help-list');
if (shots) await page.screenshot({ path: path.join(shots, 'help.png') });
await page.click('.help-list [data-h="tour"]');
await page.waitForSelector('#tour .tour-card');
check(true, 'Take the tour starts it again');
await page.keyboard.press('Escape');
check(!(await page.$('#tour')), 'Escape closes it');
await page.click('#helpBtn');
await page.click('.help-list [data-h="sample"]');
await page.waitForFunction(() => state.posts.length === 2, null, { timeout: 10000 });
check(true, 'Add the Welcome post adds another copy');

check(errors.length === 0, 'no errors in the page', errors.join('\n         '));
await browser.close();
server.kill();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
