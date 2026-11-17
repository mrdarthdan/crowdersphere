/* CrowderSphere onboarding: the welcome tour, the "Welcome to CrowderSphere" sample post, and the
 * Help menu (the ? button). Uses the editor page's own functions (api, openPost, savePrefs, toast...).
 *
 * First launch (no posts yet): the sample post is created and opened, then the tour starts.
 * People upgrading with posts already: a one-time tip points them at the ? button instead.
 */
(function () {
  "use strict";
  const GUIDE_URL = 'https://github.com/mrdarthdan/crowdersphere/blob/main/docs/getting-started.md';
  const ISSUES_URL = 'https://github.com/mrdarthdan/crowdersphere/issues';

  // ---------------------------------------------------------------- the tour
  // target: element to highlight (null = centered card). before(): get the screen ready for the step.
  const STEPS = [
    { target: null, title: 'Welcome to CrowderSphere',
      text: 'Write your blog posts here, keep them on your computer, and send them to WordPress when they\'re ready. This quick tour shows you around. It takes about a minute.' },
    { target: '#openSettings', title: 'Connect your blog',
      text: 'Start in <b>Settings</b>: enter your site address, your WordPress username and an application password. Settings walks you through making one. You only do this once.' },
    { target: '#postList', title: 'Your posts',
      text: 'Every post is saved automatically, as a folder on your computer. <b>+ New post</b> starts another, and the search box finds older ones.' },
    { target: '#toolbar', title: 'Write and format',
      text: 'Headings, bold, lists, links, quotes and more. The picture button adds photos, or drag them in from your computer, or paste them.' },
    { target: '#editorWrap', title: 'Arrange your pictures',
      text: 'Click a picture to get its toolbar: align it left, center or right, change its size, add a caption and alt text, or make it the featured image.' },
    { target: '#panel', title: 'Post settings', before: () => document.getElementById('panel').classList.remove('hidden'),
      text: 'Excerpt, categories, tags and the featured image live here. Hide or show this panel with the button at the top right.' },
    { target: '#publishBtn', title: 'Send it to WordPress',
      text: 'Send the post as a draft, publish it now, or schedule it. Pictures upload with it. Made changes later? Send it again to update the same post. <b>Preview</b> and <b>Export to Word</b> are right next to it.' },
    { target: '#helpBtn', title: 'You\'re all set',
      text: 'The <b>Welcome</b> post is a sandbox: try things on it, then delete it when you\'re done. Take this tour again, or open the Getting Started guide, from the <b>?</b> button.' }
  ];

  let tour = null;   // {i, root, hole, card}

  function place() {
    if (!tour) return;
    const step = STEPS[tour.i];
    const el = step.target && document.querySelector(step.target);
    const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    const { hole, card } = tour;
    if (r) {
      const pad = 6;
      Object.assign(hole.style, { display: 'block', left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
      tour.root.classList.remove('dim');
    } else {
      hole.style.display = 'none';
      tour.root.classList.add('dim');
    }
    // card: beside the target where it fits, else centered
    const cw = card.offsetWidth, ch = card.offsetHeight, m = 14, W = innerWidth, H = innerHeight;
    let x = (W - cw) / 2, y = (H - ch) / 2;
    if (r) {
      const clamp = ([sx, sy]) => [Math.min(Math.max(8, sx), W - cw - 8), Math.min(Math.max(8, sy), H - ch - 8)];
      // beside, then below/above the target; nudged into the window; first one that doesn't cover it
      const spots = [[r.right + m, r.top], [r.left - cw - m, r.top], [r.left, r.bottom + m], [r.left, r.top - ch - m]].map(clamp);
      const covers = ([sx, sy]) => !(sx + cw <= r.left - 2 || sx >= r.right + 2 || sy + ch <= r.top - 2 || sy >= r.bottom + 2);
      const big = r.width > W * 0.5 && r.height > H * 0.5;   // e.g. the writing area: sit inside it
      const spot = big ? clamp([r.left + 24, r.top + 24]) : (spots.find(p => !covers(p)) || spots[2]);
      [x, y] = spot;
    }
    card.style.left = x + 'px'; card.style.top = y + 'px';
  }

  function render() {
    const step = STEPS[tour.i], last = tour.i === STEPS.length - 1, first = tour.i === 0;
    if (step.before) try { step.before(); } catch (e) {}
    tour.card.innerHTML = `
      <div class="tour-count">${tour.i + 1} of ${STEPS.length}</div>
      <h3>${step.title}</h3>
      <p>${step.text}</p>
      <div class="tour-btns">
        ${last ? '' : '<button data-t="skip" class="ghost">Skip tour</button>'}
        <span style="flex:1"></span>
        ${first ? '' : '<button data-t="back">Back</button>'}
        <button data-t="next" class="primary">${first ? 'Start the tour' : last ? 'Done' : 'Next'}</button>
      </div>`;
    requestAnimationFrame(place);
    const nb = tour.card.querySelector('[data-t="next"]'); if (nb) nb.focus();
  }

  function startTour() {
    if (tour) return;
    const root = document.createElement('div');
    root.id = 'tour';
    root.innerHTML = '<div class="tour-hole"></div><div class="tour-card" role="dialog" aria-modal="true" aria-label="CrowderSphere tour"></div>';
    document.body.appendChild(root);
    tour = { i: 0, root, hole: root.querySelector('.tour-hole'), card: root.querySelector('.tour-card') };
    tour.card.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t === 'next') { if (tour.i === STEPS.length - 1) endTour(); else { tour.i++; render(); } }
      if (b.dataset.t === 'back' && tour.i > 0) { tour.i--; render(); }
      if (b.dataset.t === 'skip') endTour();
    });
    addEventListener('resize', place);
    document.addEventListener('keydown', onKey, true);
    render();
  }
  function onKey(e) {
    if (!tour) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); tour.card.querySelector('[data-t="next"]').click(); }
    else if (e.key === 'ArrowLeft' && tour.i > 0) { e.preventDefault(); e.stopPropagation(); tour.i--; render(); }
  }
  function endTour() {
    if (!tour) return;
    tour.root.remove(); tour = null;
    removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey, true);
    if (!prefs.tourDone) savePrefs({ tourDone: true });
  }

  // ---------------------------------------------------------------- the sample post
  // A picture for the sample post, drawn here so the app doesn't need to ship a photo:
  // a desert sunset in the style of the app icon.
  function sampleImage() {
    const W = 1600, H = 900, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2a385e'); sky.addColorStop(0.5, '#e87948'); sky.addColorStop(0.7, '#f2a058'); sky.addColorStop(1, '#f6b465');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffe6a2'; g.beginPath(); g.arc(W * 0.46, H * 0.4, H * 0.14, 0, Math.PI * 2); g.fill();
    const ridge = (color, pts) => { g.fillStyle = color; g.beginPath(); g.moveTo(0, H); for (const [x, y] of pts) g.lineTo(x * W, y * H); g.lineTo(W, H); g.closePath(); g.fill(); };
    ridge('#5c3c60', [[0, .64], [.16, .51], [.28, .59], [.44, .46], [.58, .59], [.77, .53], [1, .66]]);
    ridge('#342848', [[0, .74], [.21, .6], [.39, .71], [.58, .58], [.67, .64], [1, .66]]);
    ridge('#181a2e', [[0, .84], [.3, .75], [.55, .82], [1, .76]]);
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.88));
  }

  const SAMPLE_HTML = src => [
    '<p>This is a <strong>sample post</strong>. Nothing here goes to your blog unless you send it, so try things out on it. When you\'re done, delete it with <strong>Delete post</strong> in the panel on the right.</p>',
    '<h2>Write</h2>',
    '<p>Click anywhere and start typing. Changes are saved automatically as you go.</p>',
    '<ul><li><p>Select some text, then use the toolbar for <strong>bold</strong>, <em>italic</em>, headings, lists and quotes.</p></li><li><p>Press <strong>Ctrl+K</strong> to add a link, like this one to the <a href="' + GUIDE_URL + '">Getting Started guide</a>.</p></li><li><p>The <strong>&lt;/&gt;</strong> button shows the post\'s HTML, if you like working that way.</p></li></ul>',
    '<h2>Pictures</h2>',
    '<figure class="wp-block-image aligncenter" style="width:100%"><img src="' + src + '" alt="A desert sunset drawn in the CrowderSphere colors" style="width:100%;height:auto"><figcaption>Click this picture to see its toolbar: align it, resize it, add a caption, or make it the featured image.</figcaption></figure>',
    '<p>Add your own pictures with the picture button, by dragging them in from your computer, or by pasting. Large photos are resized for the web; your originals aren\'t changed.</p>',
    '<h2>Send it to your blog</h2>',
    '<p>Connect your site in <strong>Settings</strong> once. Then <strong>Send to WordPress</strong> sends the post as a draft, publishes it, or schedules it, with its pictures. Edited it later? Send it again and the same post on your blog is updated.</p>',
    '<h2>Your posts are files</h2>',
    '<p>Every post is a folder on your computer with the text, its settings and its pictures. The <strong>Folder</strong> button opens them, so they\'re easy to back up.</p>',
    '<blockquote><p>Tip: <strong>Export to Word</strong> turns a post into a Word document, handy for proofreading or sharing a draft.</p></blockquote>',
    '<p>Take the tour again any time with the <strong>?</strong> button at the bottom left.</p>'
  ].join('\n');

  async function createWelcomePost() {
    const r = await api('/api/post', { json: { meta: { title: 'Welcome to CrowderSphere', excerpt: 'A sample post that shows how CrowderSphere works.', tags: '' } } });
    let src = '';
    try {
      const blob = await sampleImage();
      if (blob) src = (await api(`/api/image?id=${encodeURIComponent(r.id)}&name=welcome-sunset.jpg`, { body: blob })).src;
    } catch (e) { /* the post still works without its picture */ }
    let html = SAMPLE_HTML(src);
    if (!src) html = html.replace(/<figure[\s\S]*?<\/figure>\n/, '');
    await api('/api/post', { json: { id: r.id, html } });
    await refreshList();
    await openPost(r.id);
    return r.id;
  }

  // ---------------------------------------------------------------- help menu
  function openHelp() {
    const dlg = openModal({
      title: 'Help',
      body: `<div class="help-list">
          <button data-h="tour"><b>Take the tour</b><span>A one-minute walk around the main parts of CrowderSphere.</span></button>
          <button data-h="guide"><b>Getting Started guide</b><span>Step-by-step, with pictures, on the CrowderSphere website.</span></button>
          <button data-h="sample"><b>Add the Welcome post</b><span>A sample post to experiment on. Delete it whenever you like.</span></button>
          <button data-h="issue"><b>Report a problem or suggest an idea</b><span>Opens CrowderSphere's issue list on GitHub.</span></button>
        </div>`,
      buttons: [{ label: 'Close' }],
      onOpen: el => {
        el.querySelector('.help-list').addEventListener('click', async e => {
          const b = e.target.closest('button'); if (!b) return;
          dlg.close();
          if (b.dataset.h === 'tour') startTour();
          if (b.dataset.h === 'guide') openUrl(GUIDE_URL);
          if (b.dataset.h === 'issue') openUrl(ISSUES_URL);
          if (b.dataset.h === 'sample') {
            try { await flushSave(); await createWelcomePost(); toast('Added the Welcome post.'); }
            catch (err) { toast(err.message, 'error'); }
          }
        });
      }
    });
  }

  // Called once the editor has loaded its posts
  async function onStartup() {
    if (prefs.tourDone) return;
    if (!state.posts.length) {
      try { await createWelcomePost(); } catch (e) { /* fall back to the empty new post */ }
      startTour();
    } else {
      // upgrading with posts already: don't add a sample post, just mention the tour once
      setTimeout(() => toast('New: a quick tour and a Getting Started guide. Click ? at the bottom left.'), 1500);
      savePrefs({ tourDone: true });
    }
  }

  window.CSOnboarding = { startTour, endTour, openHelp, createWelcomePost, onStartup, GUIDE_URL, STEPS };
})();
