// Takes the screenshots for docs/getting-started.md from the real editor, against the stand-in server.
//   node dev/screenshots.mjs            (needs Playwright and Chrome; writes docs/images/*.png)
// Run it again whenever the screens change.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'docs', 'images');
fs.mkdirSync(OUT, { recursive: true });
const posts = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-shots-'));
const PORT = 47995, BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, [path.join(HERE, 'mock-server.mjs'), posts, String(PORT)], { stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch (e) {} });
await new Promise(r => setTimeout(r, 600));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const shot = async (name, target, pad = 0) => {
  const file = path.join(OUT, name + '.png');
  if (!target) await page.screenshot({ path: file });
  else {
    const b = await page.locator(target).first().boundingBox();
    await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } });
  }
  console.log('  ' + path.relative(process.cwd(), file));
};
const settle = () => page.waitForTimeout(400);

// 1. First launch: the tour over the Welcome post
await page.goto(BASE);
await page.waitForSelector('#tour .tour-card');
await settle();
await shot('first-launch');
await page.evaluate(() => CSOnboarding.endTour());

// Connect the stand-in server to a made-up blog, so the WordPress parts show as they do for real
await fetch(BASE + '/api/settings', { method: 'POST', body: JSON.stringify({ siteUrl: 'https://myblog.example', username: 'dan', hasPassword: true }) });
await page.reload();
await page.waitForSelector('#editor figure img');
await page.evaluate(() => new Promise(r => { const i = document.querySelector('#editor figure img'); if (i.complete) r(); else i.onload = r; }));
// show a typical Windows posts folder instead of the test server's temporary one
const showDir = () => page.evaluate(() => { state.postsDir = 'C:\\Users\\you\\Documents\\Blog Posts'; renderPanel(); });
await showDir();
await settle();

// 2. The main window
await shot('main-window');

// 3. Settings
await page.click('#openSettings');
await page.waitForSelector('#modalBack .modal #sSite');
await settle();
await shot('settings', '#modalBack .modal', 0);
await page.keyboard.press('Escape');

// 4. A selected picture and its toolbar
await page.evaluate(() => document.querySelector('#editor figure').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(200);
await page.click('#editor figure img');
await page.waitForSelector('#imgbar:not([hidden])');
await settle();
{
  const f = await page.locator('#editor figure').boundingBox(), t = await page.locator('#imgbar').boundingBox();
  const x = Math.min(f.x, t.x) - 16, y = Math.min(f.y, t.y) - 16;
  await page.screenshot({ path: path.join(OUT, 'picture-toolbar.png'), clip: { x, y, width: Math.max(f.x + f.width, t.x + t.width) - x + 16, height: Math.min(Math.max(f.y + f.height, t.y + t.height) - y + 16, 520) } });
  console.log('  docs/images/picture-toolbar.png');
}
await page.keyboard.press('Escape');

// 5. Post settings panel with a category, tags and the featured picture
await page.click('#catList label:has-text("Desert") input');
await page.fill('#tags', 'sunset, arizona');
await page.click('#editor figure img');
await page.click('#imgbar [data-img="featured"]');
await page.keyboard.press('Escape');
await showDir();
await settle();
await shot('post-settings', '#panel');

// 6. Send to WordPress
await page.click('#publishBtn');
await page.waitForSelector('#modalBack .modal input[name=st]');
await settle();
await shot('send-to-wordpress', '#modalBack .modal');
await page.keyboard.press('Escape');

// 7. Help menu
await page.click('#helpBtn');
await page.waitForSelector('.help-list');
await settle();
await shot('help-menu', '#modalBack .modal');

await browser.close();
server.kill();
