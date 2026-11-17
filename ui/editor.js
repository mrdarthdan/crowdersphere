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

  function displaySrc(opts, src) { return /^images\//.test(src || '') ? opts.fileUrl(src) : src; }

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
        HtmlBlock,
        Placeholder.configure({ placeholder: 'Start writing your post...' })
      ],
      content: '',
      editorProps: {
        attributes: { class: 'cs-doc' },
        transformPastedHTML: html => opts.transformPastedHTML ? opts.transformPastedHTML(html) : html,
        handlePaste: (view, event) => {
          const files = Array.from((event.clipboardData && event.clipboardData.files) || []).filter(f => f.type.startsWith('image/'));
          if (!files.length) return false;
          event.preventDefault();
          opts.onFiles(files, view.state.selection.from);
          return true;
        },
        handleDrop: (view, event, slice, moved) => {
          if (moved) return false;
          const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []).filter(f => f.type.startsWith('image/'));
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

    function selectedFigure() {
      const sel = ed.state.selection;
      if (sel instanceof NodeSelection && sel.node.type.name === 'figure') {
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
      insertFigure(attrs, pos) {
        const spot = blockSpotFor(pos);
        const node = ed.schema.nodes.figure.create(attrs);
        const tr = ed.state.tr.replaceWith(spot.from, spot.to, node);
        tr.setSelection(NodeSelection.create(tr.doc, spot.from));
        ed.view.dispatch(tr.scrollIntoView());
        return spot.from + node.nodeSize;    // where the next picture goes
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
        const at = $p.nodeAfter && $p.nodeAfter.type.name === 'figure' ? pos : pos - 1;
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

  window.CSE = { create };
})();
