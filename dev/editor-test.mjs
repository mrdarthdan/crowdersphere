// Browser test for the editor: opens a post written by the old editor, edits it, and checks the saved HTML.
//   node dev/editor-test.mjs            (needs Playwright and Chrome)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const posts = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
const PORT = 47998;
const ID = '2026-11-01-old-post';
// a tiny valid JPEG (1x1)
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

const OLD_HTML = [
  '<p>The Salt River is <strong>popular</strong> and <em>pretty</em> <u>under</u> <s>strike</s>.</p>',
  '<h2>A heading</h2>',
  '<p style="text-align: center;">Centered text with a <a href="https://example.com" target="_blank" rel="noopener">link</a>.</p>',
  '<figure class="wp-block-image alignright" style="width: 45%;"><img src="images/a.jpg" alt="Horse" style="width:100%;height:auto"><figcaption>Wild horses</figcaption></figure>',
  '<p>Some <span style="font-family: Georgia, serif;">Georgia text</span> here.</p>',
  '<blockquote>A quote from the old editor</blockquote>',
  '<ul><li>one</li><li>two</li></ul>',
  '<ol><li>first</li></ol>',
  '<pre>code block</pre>',
  '<hr>',
  '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
  '<div class="wp-block-embed"><iframe src="https://www.youtube.com/embed/x"></iframe></div>',
  '<p>Inline <img src="https://example.com/remote.png" alt="r"> image.</p>'
].join('\n');

fs.mkdirSync(path.join(posts, ID, 'images'), { recursive: true });
fs.writeFileSync(path.join(posts, ID, 'images', 'a.jpg'), JPG);
fs.writeFileSync(path.join(posts, ID, 'post.html'), OLD_HTML);
fs.writeFileSync(path.join(posts, ID, 'post.json'), JSON.stringify({ title: 'Old post', excerpt: '', categories: [], tags: '', featured: 'images/a.jpg', modified: '2026-11-01T10:00:00', created: '2026-11-01T10:00:00', media: {} }));
fs.writeFileSync(path.join(posts, 'pic.jpg'), JPG);

const server = spawn(process.execPath, [path.join(HERE, 'mock-server.mjs'), posts, String(PORT)], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 600));

let failures = 0;
const check = (ok, what, extra = '') => { console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok || !extra ? '' : '\n         ' + extra)); if (!ok) failures++; };
const saved = () => fs.readFileSync(path.join(posts, ID, 'post.html'), 'utf8');
const savedMeta = () => JSON.parse(fs.readFileSync(path.join(posts, ID, 'post.json'), 'utf8'));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// (pictures hosted on other sites can't be fetched for the Word export; the export skips them)
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|blocked by CORS/.test(m.text())) errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#editor .cs-doc');
await page.waitForFunction(() => document.querySelector('#title').value === 'Old post');

const html = () => page.evaluate(() => currentHtml());
// Space clicks out like a person would; two quick clicks on one spot count as a double-click.
// The editor reads the browser's selection a moment after a click, so wait before typing.
const click = async sel => { await page.waitForTimeout(600); await page.click(sel); await page.waitForTimeout(150); };
const flush = () => page.evaluate(() => flushSave());

console.log('Opening a post from the old editor');
{
  const h = await html();
  for (const [what, re] of [
    ['bold/italic/underline/strike', /<strong>popular<\/strong>.*<em>pretty<\/em>.*<u>under<\/u>.*<s>strike<\/s>/],
    ['heading', /<h2>A heading<\/h2>/],
    ['centered paragraph', /<p style="text-align: center;?">Centered/],
    ['link keeps new-tab', /<a (?=[^>]*href="https:\/\/example.com")(?=[^>]*target="_blank")[^>]*>link<\/a>/],
    ['figure: class, width, relative src, alt, caption', /<figure class="wp-block-image alignright" style="width: ?45%;?"><img src="images\/a.jpg" alt="Horse" style="width: ?100%; ?height: ?auto;?"><figcaption>Wild horses<\/figcaption><\/figure>/],
    ['font span', /<span style="font-family: Georgia, serif;?">Georgia text<\/span>/],
    ['blockquote', /<blockquote><p>A quote from the old editor<\/p><\/blockquote>/],
    ['lists', /<ul><li><p>one<\/p><\/li><li><p>two<\/p><\/li><\/ul>/],
    ['code block', /<pre><code>code block<\/code><\/pre>/],
    ['divider', /<hr>/],
    ['table cells', /<td[^>]*><p>a<\/p><\/td><td[^>]*><p>b<\/p><\/td>/],
    ['embed kept verbatim', /<div class="wp-block-embed"><iframe src="https:\/\/www.youtube.com\/embed\/x"><\/iframe><\/div>/],
    ['inline remote picture', /Inline <img src="https:\/\/example.com\/remote.png" alt="r"[^>]*> image/]
  ]) check(re.test(h), what, h);
  check(!h.includes('/files/') && !h.includes('csfiles'), 'no screen-only picture addresses in the HTML');
  const shown = await page.evaluate(() => document.querySelector('#editor figure img').src);
  check(/\/files\/2026-11-01-old-post\/images\/a.jpg$/.test(shown), 'picture is displayed from the post folder', shown);
  check(await page.evaluate(() => document.querySelector('#editor figure').classList.contains('is-featured')), 'featured picture is marked');
  const st = await page.evaluate(() => document.querySelector('#wordCount').textContent);
  check(/words/.test(st) && !/^0 words/.test(st), 'word count', st);
  check(!(await page.evaluate(() => state.dirty)), 'opening a post does not mark it changed');
}

console.log('Typing and formatting');
{
  await click('#editor h2');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('New paragraph typed here');
  await page.keyboard.down('Shift'); for (let i = 0; i < 3; i++) await page.keyboard.press('Control+ArrowLeft'); await page.keyboard.up('Shift'); await page.waitForTimeout(150);
  check((await page.evaluate(() => $('#selCount').textContent)).includes('Selected: 3 words'), 'selection count', await page.evaluate(() => $('#selCount').textContent));
  await page.click('[data-cmd="bold"]');
  check(await page.evaluate(() => $('[data-cmd="bold"]').classList.contains('on')), 'bold button lights up');
  await page.click('[data-cmd="justifyCenter"]');
  await page.selectOption('#fontPick', { index: 2 });
  await page.selectOption('#blockType', 'h3');
  const h = await html();
  check(/<h3 style="text-align: center;?">New (<strong><span style="font-family:[^"]+">|<span style="font-family:[^"]+"><strong>)paragraph typed here<\/(span|strong)><\/(strong|span)><\/h3>/.test(h), 'bold + font + centered heading', h.split('\n').find(l => l.includes('typed')));
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  check(/<p>New (<strong>)?paragraph typed here(<\/strong>)?<\/p>/.test(await html()), 'undo', (await html()).split('\n').find(l => l.includes('typed')));
  await flush();
  check(saved().includes('paragraph typed here'), 'autosave wrote post.html');
}

console.log('Links');
{
  await click('#editor h2');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.click('[data-act="link"]');
  await page.waitForSelector('#modalBack:not([hidden]) input');
  const inputs = await page.$$('#modalBack input[type=text], #modalBack input:not([type])');
  await inputs[0].fill('crowderlife.com');
  await inputs[1].fill('my site');
  await page.click('#modalBack button.primary');
  check(/<a href="https:\/\/crowderlife.com">my site<\/a>/.test(await html()), 'insert link (no forced new tab)', (await html()).split('\n').find(l => l.includes('my site')));
}

console.log('Pictures');
{
  await click('#editor h2');
  await page.keyboard.press('End');
  await page.setInputFiles('#filePick', path.join(posts, 'pic.jpg'));
  await page.waitForFunction(() => document.querySelectorAll('#editor figure').length === 2);
  check(fs.existsSync(path.join(posts, ID, 'images', 'pic.jpg')), 'picture saved into the post folder');
  check(await page.evaluate(() => !$('#imgbar').hidden), 'new picture is selected with its toolbar showing');
  const order = await page.evaluate(() => Array.from(document.querySelector('#editor .cs-doc').children).map(n => n.nodeName).slice(0, 4).join(','));
  check(order.startsWith('P,H2,FIGURE'), 'picture placed after the heading', order);
  await page.click('#imgbar [data-img="alignleft"]');
  await page.click('#imgbar [data-w="25"]');
  await page.click('#imgbar [data-img="details"]');
  await page.waitForSelector('#modalBack:not([hidden]) input');
  await page.fill('#modalBack input', 'A desert sunset');
  await page.fill('#modalBack textarea', 'Sunset at Water Users');
  await page.click('#modalBack button.primary');
  check(await page.evaluate(() => document.querySelector('#editor figure.is-selected') !== null), 'picture stays outlined while you change it');
  let h = await html();
  check(/<figure class="wp-block-image alignleft" style="width: ?25%;?"><img src="images\/pic.jpg" alt="A desert sunset" style="[^"]*"><figcaption>Sunset at Water Users<\/figcaption><\/figure>/.test(h), 'align, size, alt and caption', h.split('\n').find(l => l.includes('pic.jpg')));
  await page.screenshot({ path: path.join(os.tmpdir(), 'cs-figure.png') });
  await page.click('#imgbar [data-img="up"]');
  const order2 = await page.evaluate(() => Array.from(document.querySelector('#editor .cs-doc').children).map(n => n.nodeName).slice(0, 3).join(','));
  check(order2 === 'P,FIGURE,H2', 'move picture up', order2);
  await page.click('#imgbar [data-img="featured"]');
  check((await page.evaluate(() => state.current.meta.featured)) === 'images/pic.jpg', 'set as featured');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => $('#imgbar').hidden), 'Escape deselects the picture');
  await click('#editor figure >> nth=0');
  check(await page.evaluate(() => !$('#imgbar').hidden), 'clicking a picture selects it');
  await page.keyboard.press('Delete');
  check(!(await html()).includes('pic.jpg'), 'Delete key removes the selected picture');
  await page.keyboard.press('Control+z');
  check((await html()).includes('pic.jpg'), 'undo brings the picture back', (await html()).slice(0, 300) + ' / focus: ' + await page.evaluate(() => document.activeElement.className));
  await flush();
  check(savedMeta().featured === 'images/pic.jpg', 'featured saved to post.json');
}

console.log('Pasting from Word / web');
{
  await click('#editor h2');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.evaluate(() => ed.tiptap.view.pasteHTML('<meta charset="utf-8"><div style="margin:0"><span style="font-weight:700;color:red">Pasted bold</span> and <script>alert(1)</script><span class="MsoNormal" style="font-style:italic">italic</span></div><h1>Big title</h1><img src="file:///C:/x.png"><a href="javascript:alert(1)">bad link</a>'));
  const h = await html();
  check(/<strong>Pasted bold<\/strong> and <em>italic<\/em>/.test(h), 'keeps bold/italic from styled spans', h.split('\n').find(l => l.includes('Pasted')));
  check(!/script|alert|file:|MsoNormal|color:red/.test(h), 'drops scripts, local files, junk styling and bad links');
  check(/<h2>Big title<\/h2>/.test(h), 'Heading 1 becomes Heading 2');
  // copy/paste inside the editor keeps a picture
  await click('#editor figure >> nth=0');
  const before = ((await html()).match(/<figure/g) || []).length;
  // (pasting while the picture is selected would replace it, so paste after it)
  await page.evaluate(() => { const v = ed.tiptap.view; const { dom } = v.serializeForClipboard(v.state.selection.content()); ed.deselect(); v.pasteHTML(dom.innerHTML); });
  check(((await html()).match(/<figure/g) || []).length === before + 1, 'copying a picture inside the editor keeps it', await page.evaluate(() => { const v = ed.tiptap.view; return v.state.selection.toJSON().type + ' | ' + v.serializeForClipboard(v.state.selection.content()).dom.innerHTML; }));
  await page.keyboard.press('Control+z');
}

console.log('HTML view');
{
  await page.click('#btnSource');
  const src = await page.evaluate(() => $('#source').value);
  check(src.split('\n').length > 10 && src.includes('<figure'), 'shows one block per line', src.slice(0, 120));
  await page.evaluate(() => { const s = $('#source'); s.value = s.value.replace('A heading', 'An edited heading'); s.dispatchEvent(new Event('input')); });
  await page.click('#btnSource');
  check((await html()).includes('<h2>An edited heading</h2>'), 'edits in HTML view come back to the editor');
  await flush();
  check(saved().includes('An edited heading'), 'and are saved');
}

console.log('Word export');
{
  const r = await page.evaluate(async () => {
    const blob = await window.buildDocx({ title: 'T', excerpt: '', html: currentHtml(), font: 'Georgia', resolveSrc: s => /^images\//.test(s) ? fileUrl(s) : s });
    return { size: blob.size, type: blob.type };
  });
  check(r.size > 2000, 'builds a .docx from the new editor\'s HTML', JSON.stringify(r));
  // a picture hosted on another site (different origin, no CORS headers) must still end up in the document
  const remote = await page.evaluate(async (src) => {
    const blob = await window.buildDocx({ title: 'T', html: `<p>Web picture <img src="${src}" alt="w"></p>`, resolveSrc: s => s, fetchRemote: url => CS.remoteImage(url) });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    return { media: (text.match(/word\/media\/image\d+\.png/g) || []).length };
  }, `http://127.0.0.1:${PORT}/remote.png`);
  check(remote.media > 0, 'includes a picture hosted on another website (#6)', JSON.stringify(remote));
}

console.log('Update prompt');
{
  await page.evaluate(() => offerUpdate({ available: true, version: '9.9.9', current: '2.0.1', notes: 'Fixes <b>things</b>' }));
  await page.waitForSelector('#modalBack:not([hidden])');
  const t = await page.evaluate(() => $('#modalBack').innerText);
  check(/9\.9\.9/.test(t) && /2\.0\.1/.test(t) && /Update now/.test(t) && t.includes('Fixes <b>things</b>'), 'shows the new version, notes as plain text, and Update now', t.slice(0, 200));
  await page.click('#modalBack button:not(.primary)');
  check(await page.evaluate(() => $('#modalBack').hidden), 'Later closes it');
  await page.evaluate(() => offerUpdate({ available: true, version: '2.2.0', current: '2.1.0', notes: "## What's new in 2.2.0\n\n- **New app icon** and a [link](https://x)\n\n---\n\nDownload the installer below" }));
  const t2 = await page.evaluate(() => $('.update-notes').textContent);
  check(t2 === '- New app icon and a link', 'shows only what\'s new, without markdown or the download text', JSON.stringify(t2));
  await page.click('#modalBack button:not(.primary)');
}

console.log('New post and switching posts');
{
  await page.click('#newPost');
  check(await page.evaluate(() => ed.isEmpty()), 'new post starts empty');
  check(await page.evaluate(() => !!document.querySelector('#editor p.is-editor-empty[data-placeholder]')), 'placeholder shown');
  await page.keyboard.press('Control+z');
  check(await page.evaluate(() => ed.isEmpty()), 'undo cannot bring back the previous post');
  await page.fill('#title', 'Brand new');
  await click('#editor .cs-doc');
  await page.keyboard.type('Hello');
  await flush();
  const created = fs.readdirSync(posts).find(n => n.endsWith('brand-new'));
  check(!!created && fs.readFileSync(path.join(posts, created, 'post.html'), 'utf8') === '<p>Hello</p>', 'new post saved as its own folder', created);
}

await page.screenshot({ path: path.join(os.tmpdir(), 'cs-editor.png') });
check(errors.length === 0, 'no errors in the page', errors.join('\n         '));
await browser.close();
server.kill();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
