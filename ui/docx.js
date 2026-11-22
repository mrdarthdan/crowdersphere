/* CrowderSphere - turns a post's HTML into a real Word (.docx) file, entirely in the browser.
   Handles paragraphs, headings, bold/italic/underline/strike, links, lists (nested), quotes,
   code blocks, divider lines, tables and pictures (size, alignment, text wrap, captions). */
(function () {
  'use strict';
  const EMU_PER_INCH = 914400;
  const TEXT_WIDTH_IN = 6.5;                 // Letter page with 1" margins
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  const x = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  /* ---------------- zip (store method, no compression needed) ---------------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------------- fixed parts ---------------- */
  const STYLES = (font) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${x(font)}" w:hAnsi="${x(font)}" w:eastAsia="${x(font)}" w:cs="${x(font)}"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="180" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="320"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="24" w:space="12" w:color="2F5BD3"/></w:pBdr><w:ind w:left="480"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F3F1"/><w:spacing w:after="180" w:line="260" w:lineRule="auto"/><w:ind w:left="200" w:right="200"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2F5BD3"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="PostTable"><w:name w:val="Post Table"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

  function numberingXml(orderedCount) {
    const bullets = ['•', '◦', '▪'], fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
    const lvls = (kind) => Array.from({ length: 9 }, (_, i) => kind === 'b'
      ? `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${bullets[i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
      : `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmts[i % 3]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
    let nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    for (let i = 0; i < orderedCount; i++) nums += `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('b')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('n')}</w:abstractNum>${nums}</w:numbering>`;
  }

  /* ---------------- converter ---------------- */
  class Builder {
    constructor(resolveSrc, fetchRemote) {
      this.resolveSrc = resolveSrc; this.fetchRemote = fetchRemote; this.rels = []; this.media = []; this.orderedLists = 0;
      this.docPrId = 1; this.relHeight = 251658240; this.body = []; this.pendingAnchor = null;
    }
    rel(type, target, external) {
      const id = 'rId' + (this.rels.length + 10);
      this.rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${x(target)}"${external ? ' TargetMode="External"' : ''}/>`);
      return id;
    }
    // ---- inline runs
    runs(node, fmt = {}) {
      let out = '';
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          const t = n.textContent.replace(/[ \t\r\n]+/g, ' ');
          if (t) out += this.run(t, fmt);
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.nodeName;
        if (tag === 'BR') { out += '<w:r><w:br/></w:r>'; continue; }
        if (tag === 'IMG') { out += this.inlineImageMarker(n); continue; }
        const f = Object.assign({}, fmt);
        if (tag === 'B' || tag === 'STRONG') f.b = true;
        if (tag === 'I' || tag === 'EM') f.i = true;
        if (tag === 'U') f.u = true;
        if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.s = true;
        if (tag === 'CODE') f.code = true;
        if (tag === 'SUP') f.sup = true;
        if (tag === 'SUB') f.sub = true;
        const fam = (n.style && n.style.fontFamily) || (tag === 'FONT' ? n.getAttribute('face') : '');
        if (fam && fam !== 'inherit') f.font = fam.split(',')[0].replace(/["']/g, '').trim();
        if (tag === 'A' && n.getAttribute('href') && !fmt.link) {
          const href = n.getAttribute('href');
          const inner = this.runs(n, Object.assign(f, { link: true }));
          if (/^#/.test(href)) out += inner;
          else out += `<w:hyperlink r:id="${this.rel('hyperlink', href, true)}" w:history="1">${inner}</w:hyperlink>`;
          continue;
        }
        out += this.runs(n, f);
      }
      return out;
    }
    run(text, f) {
      let pr = '';
      if (f.link) pr += '<w:rStyle w:val="Hyperlink"/>';
      if (f.code) pr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';
      else if (f.font) pr += `<w:rFonts w:ascii="${x(f.font)}" w:hAnsi="${x(f.font)}" w:cs="${x(f.font)}"/>`;
      if (f.b) pr += '<w:b/>';
      if (f.i) pr += '<w:i/>';
      if (f.s) pr += '<w:strike/>';
      if (f.u && !f.link) pr += '<w:u w:val="single"/>';
      if (f.sup) pr += '<w:vertAlign w:val="superscript"/>';
      if (f.sub) pr += '<w:vertAlign w:val="subscript"/>';
      return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
    }
    para(content, { style, jc, numId, ilvl, extraPr = '' } = {}) {
      let pr = '';
      if (style) pr += `<w:pStyle w:val="${style}"/>`;
      if (numId) pr += `<w:numPr><w:ilvl w:val="${ilvl || 0}"/><w:numId w:val="${numId}"/></w:numPr>`;
      pr += extraPr;
      if (jc) pr += `<w:jc w:val="${jc}"/>`;
      if (this.pendingAnchor && !/<w:drawing>/.test(content)) { content = this.pendingAnchor + content; this.pendingAnchor = null; }
      return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${content}</w:p>`;
    }
    alignOf(el) {
      const a = (el.style && el.style.textAlign) || el.getAttribute('align') || '';
      return { center: 'center', right: 'right', justify: 'both' }[a.toLowerCase()] || null;
    }
    // ---- images
    async loadImage(src) {
      const url = this.resolveSrc(src);
      let blob;
      // Pictures on other websites usually can't be fetched from the page (CORS), so the
      // app downloads them for us when it can.
      if (this.fetchRemote && isRemote(url)) blob = await this.fetchRemote(url);
      else {
        const res = await fetch(url);
        if (!res.ok) throw new Error('image ' + res.status);
        blob = await res.blob();
      }
      const bmp = await createImageBitmap(blob);
      let ext = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/gif': 'gif' }[blob.type];
      if (!ext) {   // e.g. WebP: Word can't always show it, so convert to PNG
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        blob = await new Promise(r => c.toBlob(r, 'image/png')); ext = 'png';
      }
      const n = this.media.length + 1;
      const name = `image${n}.${ext}`;
      this.media.push({ name: 'word/media/' + name, data: new Uint8Array(await blob.arrayBuffer()) });
      const rid = this.rel('image', 'media/' + name);
      const out = { rid, w: bmp.width, h: bmp.height, name };
      bmp.close && bmp.close();
      return out;
    }
    graphic(img, cx, cy, alt, id) {
      return `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${img.name}" descr="${x(alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${img.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
    }
    drawing(img, widthFrac, alt, float) {
      const cx = Math.round(TEXT_WIDTH_IN * EMU_PER_INCH * Math.max(0.05, Math.min(1, widthFrac)));
      const cy = Math.round(cx * img.h / img.w);
      const id = this.docPrId++;
      const docPr = `<wp:docPr id="${id}" name="Picture ${id}" descr="${x(alt)}"/>`;
      const lock = '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>';
      if (!float) {
        return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${docPr}${lock}${this.graphic(img, cx, cy, alt, id)}</wp:inline></w:drawing></w:r>`;
      }
      const gap = 182880; // 0.2"
      return `<w:r><w:drawing><wp:anchor distT="45720" distB="${gap}" distL="${float === 'left' ? 0 : gap}" distR="${float === 'left' ? gap : 0}" simplePos="0" relativeHeight="${this.relHeight++}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>${float}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>${docPr}${lock}${this.graphic(img, cx, cy, alt, id)}</wp:anchor></w:drawing></w:r>`;
    }
    inlineImageMarker(imgEl) {
      // Pictures that sit inside a paragraph (e.g. pasted from the web) are handled after the paragraph
      this.looseImages = this.looseImages || [];
      this.looseImages.push(imgEl);
      return '';
    }
    async figure(fig) {
      const img = fig.querySelector('img');
      if (!img) { this.videoNote(fig); return; }
      const cap = fig.querySelector('figcaption');
      const caption = cap ? cap.textContent.trim() : '';
      const alt = img.getAttribute('alt') || '';
      const width = (parseFloat(fig.style.width) || 100) / 100;
      const align = fig.classList.contains('alignleft') ? 'left' : fig.classList.contains('alignright') ? 'right'
        : fig.classList.contains('alignnone') ? 'left-inline' : 'center';
      let loaded;
      try { loaded = await this.loadImage(img.getAttribute('src')); }
      catch (e) { this.body.push(this.para(this.run('[Picture could not be included: ' + (img.getAttribute('src') || '') + ']', { i: true }))); return; }
      if ((align === 'left' || align === 'right') && !caption) {
        // Floating picture: attach it to the next paragraph so the text wraps around it
        this.pendingAnchor = this.drawing(loaded, width, alt, align);
        return;
      }
      const jc = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left';
      this.body.push(this.para(this.drawing(loaded, width, alt, null), { jc, extraPr: '<w:keepNext/><w:spacing w:before="120" w:after="' + (caption ? 0 : 200) + '"/>' }));
      if (caption) this.body.push(this.para(this.run(caption, {}), { style: 'Caption', jc }));
    }
    // Word can't play videos: note where one is, with its link or file name, and the caption
    videoNote(fig) {
      const video = fig.querySelector('video'), source = fig.querySelector('video source[src]');
      const wrap = fig.querySelector('.wp-block-embed__wrapper');
      let what = '';
      if (video) what = (video.getAttribute('src') || (source && source.getAttribute('src')) || 'video').split('/').pop();
      else if (wrap && /^https?:\/\//.test(wrap.textContent.trim())) what = wrap.textContent.trim();
      else return;
      const cap = fig.querySelector('figcaption');
      this.body.push(this.para(this.run('[Video: ' + what + ']', { i: true }), { jc: 'center', extraPr: '<w:keepNext/>' }));
      if (cap && cap.textContent.trim()) this.body.push(this.para(this.run(cap.textContent.trim(), {}), { style: 'Caption', jc: 'center' }));
    }
    async flushLooseImages() {
      const list = this.looseImages || []; this.looseImages = [];
      for (const img of list) {
        try {
          const l = await this.loadImage(img.getAttribute('src'));
          const frac = Math.min(1, l.w / 96 / TEXT_WIDTH_IN);
          this.body.push(this.para(this.drawing(l, frac, img.getAttribute('alt') || '', null), { jc: 'center' }));
        } catch (e) { this.body.push(this.para(this.run('[Picture: ' + (img.getAttribute('src') || '') + ']', { i: true }))); }
      }
    }
    // ---- blocks
    async list(el, level) {
      const ordered = el.nodeName === 'OL';
      const numId = ordered ? (this.orderedLists++ , this.orderedLists + 1) : 1;
      for (const li of el.children) {
        if (li.nodeName !== 'LI') continue;
        const holder = document.createElement('div');
        const nested = [];
        for (const c of Array.from(li.childNodes)) {
          if (c.nodeType === 1 && (c.nodeName === 'UL' || c.nodeName === 'OL')) nested.push(c);
          else if (c.nodeType === 1 && /^(P|DIV)$/.test(c.nodeName)) { if (holder.childNodes.length) holder.appendChild(document.createElement('br')); holder.append(...Array.from(c.cloneNode(true).childNodes)); }
          else holder.appendChild(c.cloneNode(true));
        }
        this.body.push(this.para(this.runs(holder), { style: 'ListParagraph', numId, ilvl: Math.min(level, 8) }));
        await this.flushLooseImages();
        for (const n of nested) await this.list(n, level + 1);
      }
    }
    async table(el) {
      const rows = Array.from(el.querySelectorAll('tr'));
      if (!rows.length) return;
      const cols = Math.max(...rows.map(r => Array.from(r.children).reduce((s, c) => s + (parseInt(c.getAttribute('colspan')) || 1), 0)));
      const colW = Math.floor(9360 / cols);
      let xml = `<w:tbl><w:tblPr><w:tblStyle w:val="PostTable"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid>${('<w:gridCol w:w="' + colW + '"/>').repeat(cols)}</w:tblGrid>`;
      for (const r of rows) {
        xml += '<w:tr>';
        for (const c of r.children) {
          const span = parseInt(c.getAttribute('colspan')) || 1;
          const content = this.runs(c, c.nodeName === 'TH' ? { b: true } : {});
          xml += `<w:tc><w:tcPr><w:tcW w:w="${colW * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${content}</w:p></w:tc>`;
        }
        xml += '</w:tr>';
      }
      this.body.push(xml + '</w:tbl>');
      this.body.push(this.para(''));
    }
    async block(el) {
      if (el.nodeType === 3) { const t = el.textContent.trim(); if (t) this.body.push(this.para(this.run(t, {}))); return; }
      if (el.nodeType !== 1) return;
      const tag = el.nodeName;
      const H = { H1: 'Heading1', H2: 'Heading1', H3: 'Heading2', H4: 'Heading3', H5: 'Heading3', H6: 'Heading3' };
      if (H[tag]) { this.body.push(this.para(this.runs(el), { style: H[tag], jc: this.alignOf(el) })); }
      else if (tag === 'P' || tag === 'DIV') {
        const content = this.runs(el);
        if (content || this.pendingAnchor) this.body.push(this.para(content, { jc: this.alignOf(el) }));
      }
      else if (tag === 'FIGURE') { await this.figure(el); return; }
      else if (tag === 'IMG') { this.looseImages = [el]; }
      else if (tag === 'UL' || tag === 'OL') { await this.list(el, 0); return; }
      else if (tag === 'BLOCKQUOTE') {
        const kids = Array.from(el.children).filter(c => /^(P|DIV|H[1-6])$/.test(c.nodeName));
        if (kids.length) for (const k of kids) this.body.push(this.para(this.runs(k), { style: 'Quote' }));
        else this.body.push(this.para(this.runs(el), { style: 'Quote' }));
      }
      else if (tag === 'PRE') {
        const lines = el.textContent.replace(/\r/g, '').replace(/\n$/, '').split('\n');
        const content = lines.map((l, i) => (i ? '<w:r><w:br/></w:r>' : '') + `<w:r><w:t xml:space="preserve">${x(l)}</w:t></w:r>`).join('');
        this.body.push(this.para(content, { style: 'CodeBlock' }));
      }
      else if (tag === 'HR') {
        this.body.push(this.para('', { extraPr: '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="BFBFBF"/></w:pBdr><w:spacing w:before="240" w:after="240"/>' }));
      }
      else if (tag === 'TABLE') { await this.table(el); return; }
      else { const c = this.runs(el); if (c) this.body.push(this.para(c)); }
      await this.flushLooseImages();
    }
  }

  function isRemote(url) {
    try {
      const u = new URL(url, location.href);
      return /^https?:$/.test(u.protocol) && u.origin !== location.origin && u.hostname !== 'csfiles.localhost';
    } catch (e) { return false; }
  }

  async function buildDocx({ title, excerpt, html, resolveSrc, font, fetchRemote }) {
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    const b = new Builder(resolveSrc || (s => s), fetchRemote);
    if (title) b.body.push(b.para(b.run(title, {}), { style: 'Title' }));
    if (excerpt && excerpt.trim()) b.body.push(b.para(b.run(excerpt.trim(), {}), { style: 'Subtitle' }));
    for (const n of Array.from(doc.body.childNodes)) await b.block(n);
    if (b.pendingAnchor) { b.body.push(b.para('')); }
    const stylesRel = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    const numRel = '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>';
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${b.body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
      { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>CrowderSphere</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/styles.xml', data: STYLES(font || 'Georgia') },
      { name: 'word/numbering.xml', data: numberingXml(b.orderedLists) },
      { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${stylesRel}${numRel}${b.rels.join('')}</Relationships>` },
      ...b.media
    ];
    return zip(files);
  }

  window.buildDocx = buildDocx;
})();
