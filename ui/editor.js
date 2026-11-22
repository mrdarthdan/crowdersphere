/* CrowderSphere editor core, built on TipTap (ProseMirror) from vendor/tiptap.js.
 *
 * The document keeps the same HTML that post.html has always stored:
 *   - pictures:  <figure class="wp-block-image aligncenter" style="width:50%"><img src="images/x.jpg" alt=""
 *                 style="width:100%;height:auto"><figcaption>...</figcaption></figure>
 *   - paragraphs/headings with style="text-align:center", fonts as <span style="font-family:...">
 *   - anything the editor doesn't understand (embeds, hand-written <div class=...>) is kept untouched
 *     as an "HTML block" so nothing is lost when a post is opened and saved again.
 *
 * Picture paths stay relative ("images/x.jpg") inside the document; only the on-screen
 * view maps them to a loadable address via opts.fileUrl.
 */
(function () {
  "use strict";
  const { Node, Editor, mergeAttributes } = TT.core;
  const { NodeSelection, TextSelection } = TT.pmState;

  const ALIGNS = ['alignleft', 'aligncenter', 'alignright', 'alignnone'];
  const MEDIA_NODES = ['figure', 'videoEmbed', 'videoFile'];
  function isMediaFile(f) { return f.type.startsWith('image/') || isVideoFile(f); }
  function isVideoFile(f) { return /^video\//.test(f.type) || /\.(mp4|m4v|mov|webm)$/i.test(f.name || ''); }

  function displaySrc(opts, src) { return /^(images|videos)\//.test(src || '') ? opts.fileUrl(src) : src; }

  // ------------------------------------------------------------------ picture with caption
  function makeFigure(opts) {
    return Node.create({
      name: 'figure',
      group: 'block',
      atom: true,
      selectable: true,
      draggable: true,
      addAttributes() {
        return {
          src: { default: '' },
          alt: { default: '' },
          caption: { default: '' },
          align: { default: 'aligncenter' },
          width: { default: 100 },
          href: { default: null },
          // other classes the figure had (e.g. size-large from WordPress) are kept
          extraClass: { default: '' }
        };
      },
      parseHTML() {
        return [{
          tag: 'figure',
          getAttrs: el => {
            const img = el.querySelector('img');
            if (!img) return false;
            // only simple picture figures; anything richer is kept as an HTML block
            if (el.querySelector('figure figure, table, video, iframe')) return false;
            const classes = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
            const align = classes.find(c => ALIGNS.includes(c)) || 'alignnone';
            const extra = classes.filter(c => !ALIGNS.includes(c) && c !== 'wp-block-image' && !/^is-(selected|featured)$/.test(c) && c !== 'ProseMirror-selectednode');
            const w = (el.style && el.style.width) || '';
            const width = /%$/.test(w) ? Math.max(5, Math.min(100, parseInt(w, 10) || 100)) : 100;
            const cap = el.querySelector('figcaption');
            const a = img.closest('a');
            return {
              src: opts.toRel(img.getAttribute('src') || ''),
              alt: img.getAttribute('alt') || '',
              caption: cap ? cap.textContent.trim() : '',
              align, width,
              href: a && el.contains(a) ? a.getAttribute('href') : null,
              extraClass: extra.join(' ')
            };
          }
        }];
      },
      renderHTML({ node }) {
        const a = node.attrs;
        const cls = ['wp-block-image', a.align, a.extraClass].filter(Boolean).join(' ');
        const img = ['img', { src: a.src, alt: a.alt || '', style: 'width:100%;height:auto' }];
        const pic = a.href ? ['a', { href: a.href }, img] : img;
        const out = ['figure', { class: cls, style: `width:${a.width}%` }, pic];
        if (a.caption) out.push(['figcaption', {}, a.caption]);
        return out;
      },
      addNodeView() {
        return ({ node }) => {
          const dom = document.createElement('figure');
          const img = document.createElement('img');
          const cap = document.createElement('figcaption');
          dom.appendChild(img);
          let selected = false;
          const paint = n => {
            const a = n.attrs;
            dom.className = ['wp-block-image', a.align, a.extraClass].filter(Boolean).join(' ');
            dom.style.width = a.width + '%';
            dom.dataset.rel = a.src;
            dom.classList.toggle('is-featured', !!opts.isFeatured(a.src));
            dom.classList.toggle('is-selected', selected);
            if (img.getAttribute('src') !== displaySrc(opts, a.src)) img.src = displaySrc(opts, a.src);
            img.alt = a.alt || '';
            img.draggable = false;
            if (a.caption) { cap.textContent = a.caption; if (!cap.parentNode) dom.appendChild(cap); }
            else cap.remove();
          };
          paint(node);
          return {
            dom,
            update(n) { if (n.type.name !== 'figure') return false; paint(n); return true; },
            selectNode() { selected = true; dom.classList.add('is-selected'); },
            deselectNode() { selected = false; dom.classList.remove('is-selected'); },
            ignoreMutation() { return true; }
          };
        };
      }
    });
  }

  // ------------------------------------------------------------------ pictures inside a line of text
  function makeInlineImage(opts) {
    return TT.Image.extend({
      parseHTML() {
        return [{ tag: 'img[src]', getAttrs: el => ({ src: opts.toRel(el.getAttribute('src') || ''), alt: el.getAttribute('alt'), title: el.getAttribute('title') }) }];
      },
      addNodeView() {
        return ({ node }) => {
          const img = document.createElement('img');
          img.src = displaySrc(opts, node.attrs.src);
          if (node.attrs.alt) img.alt = node.attrs.alt;
          return { dom: img };
        };
      }
    }).configure({ inline: true, allowBase64: false });
  }

  // ------------------------------------------------------------------ shared by pictures and videos
  function mediaClasses(el, own) {
    const classes = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    return {
      align: classes.find(c => ALIGNS.includes(c)) || 'aligncenter',
      extra: classes.filter(c => !ALIGNS.includes(c) && !own.test(c) && !/^is-(selected|featured)$/.test(c) && c !== 'ProseMirror-selectednode').join(' ')
    };
  }
  function widthOf(el) {
    const w = (el.style && el.style.width) || '';
    return /%$/.test(w) ? Math.max(5, Math.min(100, parseInt(w, 10) || 100)) : 100;
  }
  function captionOf(el) { const c = el.querySelector('figcaption'); return c ? c.textContent.trim() : ''; }

  // ------------------------------------------------------------------ video links (YouTube, Vimeo...)
  // Stored the way WordPress's own Embed block saves them: the address alone on its own line
  // inside the figure. WordPress turns that line into the player when the post is shown.
  const VIDEO_SITES = [
    { name: 'YouTube', slug: 'youtube', re: /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)([\w-]{11})/i, vertical: /\/shorts\//i },
    { name: 'YouTube', slug: 'youtube', re: /^https?:\/\/youtu\.be\/([\w-]{11})/i },
    { name: 'Vimeo', slug: 'vimeo', re: /^https?:\/\/(?:www\.)?vimeo\.com\/(?:channels\/[\w-]+\/|groups\/[\w-]+\/videos\/)?(\d+)/i },
    { name: 'Vimeo', slug: 'vimeo', re: /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/i },
    { name: 'TikTok', slug: 'tiktok', re: /^https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d+)/i, vertical: /./ },
    { name: 'Dailymotion', slug: 'dailymotion', re: /^https?:\/\/(?:www\.)?(?:dailymotion\.com\/video\/|dai\.ly\/)([a-z0-9]+)/i }
  ];
  // -> {name, slug, id, url (the address WordPress understands), vertical} or null
  function videoSite(input) {
    let url = String(input || '').trim();
    if (!/^https?:\/\//i.test(url) && /^(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|dailymotion\.com|dai\.ly)\//i.test(url)) url = 'https://' + url;
    if (/\s/.test(url)) return null;
    for (const s of VIDEO_SITES) {
      const m = url.match(s.re);
      if (!m) continue;
      let clean = url;
      // WordPress only recognizes YouTube's watch/short links and Vimeo's page links
      if (s.slug === 'youtube' && /\/embed\//i.test(url)) clean = 'https://www.youtube.com/watch?v=' + m[1];
      if (s.slug === 'vimeo' && /player\.vimeo\.com/i.test(url)) clean = 'https://vimeo.com/' + m[1];
      return { name: s.name, slug: s.slug, id: m[1], url: clean, vertical: !!(s.vertical && s.vertical.test(url)) };
    }
    return null;
  }
  const vimeoThumbs = {};
  function thumbFor(site, cb) {
    if (!site) return;
    if (site.slug === 'youtube') { cb('https://i.ytimg.com/vi/' + site.id + '/hqdefault.jpg'); return; }
    if (site.slug !== 'vimeo') return;
    if (!vimeoThumbs[site.url]) {
      vimeoThumbs[site.url] = fetch('https://vimeo.com/api/oembed.json?width=960&url=' + encodeURIComponent(site.url))
        .then(r => r.ok ? r.json() : {}).then(j => j.thumbnail_url || '').catch(() => '');
    }
    vimeoThumbs[site.url].then(u => { if (u) cb(u); });
  }

  function makeVideoEmbed(opts) {
    return Node.create({
      name: 'videoEmbed',
      group: 'block',
      atom: true,
      selectable: true,
      draggable: true,
      addAttributes() {
        return {
          url: { default: '' },
          caption: { default: '' },
          align: { default: 'aligncenter' },
          width: { default: 100 },
          extraClass: { default: '' }
        };
      },
      parseHTML() {
        return [{
          tag: 'figure',
          priority: 60,
          getAttrs: el => {
            if (!el.classList.contains('wp-block-embed') || el.querySelector('iframe, img, video, figure figure')) return false;
            const wrap = el.querySelector('.wp-block-embed__wrapper');
            const text = (wrap ? wrap.textContent : Array.from(el.childNodes).filter(n => n.nodeName !== 'FIGCAPTION').map(n => n.textContent).join('')).trim();
            const site = videoSite(text);
            if (!site) return false;
            const { align, extra } = mediaClasses(el, /^(wp-block-embed.*|is-type-.*|is-provider-.*|wp-embed-aspect-.*|wp-has-aspect-ratio)$/);
            return { url: text, caption: captionOf(el), align, width: widthOf(el), extraClass: extra };
          }
        }];
      },
      renderHTML({ node }) {
        const a = node.attrs, site = videoSite(a.url) || { slug: 'video', vertical: false };
        const cls = ['wp-block-embed', 'is-type-video', 'is-provider-' + site.slug, 'wp-block-embed-' + site.slug, a.align,
          site.vertical ? 'wp-embed-aspect-9-16' : 'wp-embed-aspect-16-9', 'wp-has-aspect-ratio', a.extraClass].filter(Boolean).join(' ');
        const out = ['figure', { class: cls, style: `width:${a.width}%` }, ['div', { class: 'wp-block-embed__wrapper' }, '\n' + a.url + '\n']];
        if (a.caption) out.push(['figcaption', { class: 'wp-element-caption' }, a.caption]);
        return out;
      },
      addNodeView() {
        return ({ node }) => {
          const dom = document.createElement('figure');
          const card = document.createElement('div');
          const label = document.createElement('div');
          const cap = document.createElement('figcaption');
          card.className = 'cs-video-card';
          label.className = 'cs-video-label';
          card.innerHTML = '<span class="cs-play" aria-hidden="true"></span>';
          card.appendChild(label);
          dom.appendChild(card);
          let selected = false, shownUrl = null;
          const paint = n => {
            const a = n.attrs, site = videoSite(a.url);
            dom.className = ['cs-embed', a.align, a.extraClass].filter(Boolean).join(' ');
            dom.style.width = a.width + '%';
            dom.classList.toggle('is-selected', selected);
            card.classList.toggle('vertical', !!(site && site.vertical));
            if (shownUrl !== a.url) {
              shownUrl = a.url;
              card.style.backgroundImage = '';
              label.textContent = (site ? site.name + ' video' : 'Video') + ' · ' + a.url;
              thumbFor(site, u => { if (shownUrl === a.url) card.style.backgroundImage = `url("${u.replace(/"/g, '%22')}")`; });
            }
            if (a.caption) { cap.textContent = a.caption; if (!cap.parentNode) dom.appendChild(cap); }
            else cap.remove();
          };
          paint(node);
          return {
            dom,
            update(n) { if (n.type.name !== 'videoEmbed') return false; paint(n); return true; },
            selectNode() { selected = true; dom.classList.add('is-selected'); },
            deselectNode() { selected = false; dom.classList.remove('is-selected'); },
            ignoreMutation() { return true; }
          };
        };
      }
    });
  }

  // ------------------------------------------------------------------ video files from the computer
  // <figure class="wp-block-video"><video controls src="videos/x.mp4" poster="images/x-poster.jpg"></video></figure>,
  // the same HTML WordPress's own Video block saves.
  const VIDEO_ATTRS = ['src', 'poster', 'controls', 'preload', 'playsinline', 'class', 'style'];
  function makeVideoFile(opts) {
    return Node.create({
      name: 'videoFile',
      group: 'block',
      atom: true,
      selectable: true,
      draggable: true,
      addAttributes() {
        return {
          src: { default: '' },
          poster: { default: '' },
          caption: { default: '' },
          align: { default: 'aligncenter' },
          width: { default: 100 },
          extraClass: { default: '' }
        };
      },
      parseHTML() {
        return [{
          tag: 'figure',
          priority: 60,
          getAttrs: el => {
            const videos = el.querySelectorAll('video');
            if (videos.length !== 1 || el.querySelector('img, iframe, figure figure')) return false;
            const v = videos[0], source = v.querySelector('source[src]');
            const src = v.getAttribute('src') || (source && source.getAttribute('src'));
            // settings the editor has no buttons for (autoplay, loop, muted...) are kept by leaving it as HTML
            if (!src || Array.from(v.attributes).some(a => !VIDEO_ATTRS.includes(a.name))) return false;
            const { align, extra } = mediaClasses(el, /^wp-block-video$/);
            return {
              src: opts.toRel(src),
              poster: v.getAttribute('poster') ? opts.toRel(v.getAttribute('poster')) : '',
              caption: captionOf(el), align, width: widthOf(el), extraClass: extra
            };
          }
        }];
      },
      renderHTML({ node }) {
        const a = node.attrs;
        const cls = ['wp-block-video', a.align, a.extraClass].filter(Boolean).join(' ');
        const out = ['figure', { class: cls, style: `width:${a.width}%` },
          ['video', { controls: '', src: a.src, poster: a.poster || null, preload: 'metadata' }]];
        if (a.caption) out.push(['figcaption', { class: 'wp-element-caption' }, a.caption]);
        return out;
      },
      addNodeView() {
        return ({ node }) => {
          const dom = document.createElement('figure');
          const video = document.createElement('video');
          const handle = document.createElement('div');
          const cap = document.createElement('figcaption');
          video.controls = true;
          video.preload = 'metadata';
          handle.className = 'cs-video-handle';
          handle.title = 'Click to select the video';
          dom.append(handle, video);
          let selected = false;
          const paint = n => {
            const a = n.attrs;
            dom.className = ['wp-block-video', 'cs-videofile', a.align, a.extraClass].filter(Boolean).join(' ');
            dom.style.width = a.width + '%';
            dom.classList.toggle('is-selected', selected);
            if (video.getAttribute('src') !== displaySrc(opts, a.src)) video.src = displaySrc(opts, a.src);
            const poster = a.poster ? displaySrc(opts, a.poster) : '';
            if ((video.getAttribute('poster') || '') !== poster) { if (poster) video.poster = poster; else video.removeAttribute('poster'); }
            handle.textContent = 'Video · ' + String(a.src || '').split('/').pop();
            if (a.caption) { cap.textContent = a.caption; if (!cap.parentNode) dom.appendChild(cap); }
            else cap.remove();
          };
          paint(node);
          return {
            dom,
            update(n) { if (n.type.name !== 'videoFile') return false; paint(n); return true; },
            selectNode() { selected = true; dom.classList.add('is-selected'); },
            deselectNode() { selected = false; dom.classList.remove('is-selected'); },
            // the player's own buttons (play, seek, volume) work without the editor taking the click
            stopEvent(e) { return e.target === video && !/^drag/.test(e.type); },
            ignoreMutation() { return true; }
          };
        };
      }
    });
  }

  // ------------------------------------------------------------------ anything else: kept verbatim
  const RAW_TAGS = ['iframe', 'video', 'audio', 'section', 'aside', 'details', 'figure', 'object', 'embed', 'dl', 'address', 'center',
    'div[class]', 'div[style]', 'div[id]'];
  const HtmlBlock = Node.create({
    name: 'htmlBlock',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() { return { html: { default: '' } }; },
    parseHTML() {
      // low priority: real nodes (figure with a picture, tables...) win
      return RAW_TAGS.map(tag => ({ tag, priority: 20, getAttrs: el => ({ html: el.outerHTML }) }));
    },
    renderHTML({ node }) {
      const t = document.createElement('template');
      t.innerHTML = node.attrs.html;
      return t.content.firstElementChild || ['div'];
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('div');
        dom.className = 'html-block';
        dom.contentEditable = 'false';
        const label = document.createElement('div');
        label.className = 'html-block-label';
        label.textContent = 'HTML block (edit it with the </> button)';
        const code = document.createElement('pre');
        code.textContent = node.attrs.html.length > 400 ? node.attrs.html.slice(0, 400) + '…' : node.attrs.html;
        dom.append(label, code);
        return { dom, ignoreMutation: () => true };
      };
    }
  });

  // ------------------------------------------------------------------ the editor
  function create(opts) {
    const { TextStyle, FontFamily } = TT.textStyle;
    const { Table, TableRow, TableHeader, TableCell } = TT.table;
    const { Placeholder, TrailingNode } = TT.extensions;

    const ed = new Editor({
      element: opts.element,
      extensions: [
        TT.StarterKit.configure({
          heading: { levels: [2, 3, 4, 5, 6] },
          link: {
            openOnClick: false,
            autolink: true,
            defaultProtocol: 'https',
            // keep each link's own target/rel instead of forcing new-tab on every link
            HTMLAttributes: { target: null, rel: null, class: null }
          },
          trailingNode: false
        }),
        TrailingNode,
        TT.TextAlign.configure({ types: ['heading', 'paragraph'] }),
        TextStyle,
        FontFamily,
        Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
        makeFigure(opts),
        makeInlineImage(opts),
        makeVideoEmbed(opts),
        makeVideoFile(opts),
        HtmlBlock,
        Placeholder.configure({ placeholder: 'Start writing your post...' })
      ],
      content: '',
      editorProps: {
        attributes: { class: 'cs-doc' },
        transformPastedHTML: html => opts.transformPastedHTML ? opts.transformPastedHTML(html) : html,
        handlePaste: (view, event) => {
          const cd = event.clipboardData;
          // a video address pasted on an empty line becomes the video, like in WordPress
          const text = cd ? (cd.getData('text/plain') || '').trim() : '';
          const site = text && !(cd.files && cd.files.length) ? videoSite(text) : null;
          const $f = view.state.selection.$from;
          if (site && view.state.selection.empty && $f.parent.type.name === 'paragraph' && $f.parent.content.size === 0) {
            event.preventDefault();
            api.insertVideoEmbed(site.url, view.state.selection.from);
            return true;
          }
          const files = Array.from((cd && cd.files) || []).filter(isMediaFile);
          if (!files.length) return false;
          event.preventDefault();
          opts.onFiles(files, view.state.selection.from);
          return true;
        },
        handleDrop: (view, event, slice, moved) => {
          if (moved) return false;
          const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []).filter(isMediaFile);
          if (!files.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          opts.onFiles(files, at ? at.pos : null);
          return true;
        }
      },
      onUpdate: ({ transaction }) => { if (!transaction.getMeta('cs-load')) opts.onChange(); },
      onSelectionUpdate: () => opts.onSelection(),
      onTransaction: () => opts.onSelection()
    });

    // Where to put a block (a picture) for a cursor position: replace an empty paragraph,
    // go before the paragraph when the cursor is at its start, otherwise after it.
    function blockSpotFor(pos) {
      const doc = ed.state.doc;
      if (pos == null) return { from: doc.content.size, to: doc.content.size };
      pos = Math.max(0, Math.min(pos, doc.content.size));
      const $p = doc.resolve(pos);
      if ($p.depth === 0) return { from: pos, to: pos };
      const start = $p.before(1), end = $p.after(1), block = $p.node(1);
      if (block.type.name === 'paragraph' && block.content.size === 0) return { from: start, to: end };
      if ($p.depth === 1 && $p.parentOffset === 0) return { from: start, to: start };
      return { from: end, to: end };
    }

    // pictures and videos share the floating toolbar (align, size, move, delete)
    function selectedFigure() {
      const sel = ed.state.selection;
      if (sel instanceof NodeSelection && MEDIA_NODES.includes(sel.node.type.name)) {
        return { pos: sel.from, node: sel.node, dom: ed.view.nodeDOM(sel.from) };
      }
      return null;
    }

    const api = {
      tiptap: ed,
      setHTML(html) {
        ed.commands.setContent(html && html.trim() ? html : '', { emitUpdate: false });
        // Start a fresh state so Undo can't go back into the previously opened post
        const st = ed.state;
        ed.view.updateState(TT.pmState.EditorState.create({ schema: st.schema, doc: st.doc, plugins: st.plugins }));
      },
      // One top-level block per line, like post.html has always looked
      getHTML() {
        const t = document.createElement('template');
        t.innerHTML = ed.getHTML();
        const out = [];
        for (const n of Array.from(t.content.childNodes)) {
          if (n.nodeType === 1) out.push(n.outerHTML);
          else if (n.nodeType === 3 && n.textContent.trim()) out.push('<p>' + n.textContent + '</p>');
        }
        while (out.length && /^<p>(<br>|<br class="[^"]*">|\s|&nbsp;)*<\/p>$/.test(out[out.length - 1])) out.pop();
        return out.join('\n');
      },
      getText() { return ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n\n', ' '); },
      selectedText() {
        const { from, to, empty } = ed.state.selection;
        return empty ? '' : ed.state.doc.textBetween(from, to, '\n', ' ');
      },
      isEmpty() { return ed.isEmpty; },
      focus() { ed.commands.focus(); },
      chain() { return ed.chain().focus(); },
      isActive(...a) { return ed.isActive(...a); },
      attrs(name) { return ed.getAttributes(name); },
      setEditable(on) { ed.setEditable(on); },

      // ---- pictures
      insertFigure(attrs, pos, type = 'figure') {
        const spot = blockSpotFor(pos);
        const node = ed.schema.nodes[type].create(attrs);
        const tr = ed.state.tr.replaceWith(spot.from, spot.to, node);
        tr.setSelection(NodeSelection.create(tr.doc, spot.from));
        ed.view.dispatch(tr.scrollIntoView());
        return spot.from + node.nodeSize;    // where the next picture goes
      },
      insertVideoEmbed(url, pos) {
        const site = videoSite(url);
        if (!site) return null;
        return api.insertFigure({ url: site.url, align: 'aligncenter', width: 100 }, pos, 'videoEmbed');
      },
      selectedFigure,
      updateFigure(attrs) {
        const f = selectedFigure(); if (!f) return;
        const tr = ed.state.tr.setNodeMarkup(f.pos, null, Object.assign({}, f.node.attrs, attrs));
        tr.setSelection(NodeSelection.create(tr.doc, f.pos));
        ed.view.dispatch(tr);
      },
      moveFigure(dir) {
        const f = selectedFigure(); if (!f) return;
        const $p = ed.state.doc.resolve(f.pos);
        const parent = $p.parent, i = $p.index();
        const j = dir < 0 ? i - 1 : i + 1;
        if (j < 0 || j >= parent.childCount) return;
        const other = parent.child(j);
        const tr = ed.state.tr.delete(f.pos, f.pos + f.node.nodeSize);
        const to = dir < 0 ? f.pos - other.nodeSize : f.pos + other.nodeSize;
        tr.insert(to, f.node);
        tr.setSelection(NodeSelection.create(tr.doc, to));
        ed.view.dispatch(tr.scrollIntoView());
      },
      deleteFigure() {
        const f = selectedFigure(); if (!f) return;
        const tr = ed.state.tr.delete(f.pos, f.pos + f.node.nodeSize);
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(f.pos, tr.doc.content.size))));
        ed.view.dispatch(tr);
        ed.commands.focus();
      },
      deselect() {
        const f = selectedFigure(); if (!f) return;
        const tr = ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(f.pos + f.node.nodeSize)));
        ed.view.dispatch(tr);
      },
      selectFigureDom(dom) {
        const pos = ed.view.posAtDOM(dom, 0);
        if (pos == null) return;
        const $p = ed.state.doc.resolve(pos);
        const at = $p.nodeAfter && MEDIA_NODES.includes($p.nodeAfter.type.name) ? pos : pos - 1;
        try { ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, at))); } catch (e) {}
      },
      // re-check which picture is the featured one
      refreshFigures() {
        for (const fig of ed.view.dom.querySelectorAll('figure[data-rel]')) fig.classList.toggle('is-featured', !!opts.isFeatured(fig.dataset.rel));
      },
      figureRels() {
        const rels = [];
        ed.state.doc.descendants(n => { if (n.type.name === 'figure') rels.push(n.attrs.src); });
        return rels;
      }
    };
    return api;
  }

  window.CSE = { create, videoSite, isVideoFile };
})();
