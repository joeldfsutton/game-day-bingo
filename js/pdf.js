// PDF builder: draws the cards and the host checklist with jsPDF.
(function () {
  'use strict';

  function clean(s) {
    return String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/·/g, '|');
  }

  function fitLines(doc, text, w, h, maxPt, minPt) {
    for (var pt = maxPt; pt >= minPt; pt -= 0.5) {
      doc.setFontSize(pt);
      var lines = doc.splitTextToSize(text, w);
      var wordsFit = text.split(/\s+/).every(function (wd) { return doc.getTextWidth(wd) <= w + 0.5; });
      var ok = wordsFit && lines.length * pt * 1.18 <= h && lines.every(function (l) { return doc.getTextWidth(l) <= w + 0.5; });
      if (ok) return { lines: lines, pt: pt };
    }
    doc.setFontSize(minPt);
    return { lines: doc.splitTextToSize(text, w), pt: minPt };
  }

  function fitSingle(doc, text, w, maxPt, minPt) {
    var pt = maxPt; doc.setFontSize(pt);
    while (pt > minPt && doc.getTextWidth(text) > w) { pt -= 0.5; doc.setFontSize(pt); }
    return pt;
  }

  function drawCard(doc, o, card, i, x, y, w, h, s) {
    var t = o.titles;
    var ink = o.ink ? [0, 0, 0] : [19, 41, 75];
    var eyebrowC = o.ink ? [70, 70, 70] : [138, 90, 0];
    var freeFill = o.ink ? [225, 225, 225] : [242, 181, 68];

    var rightW = 150 * s;
    doc.setTextColor.apply(doc, eyebrowC);
    doc.setFont('helvetica', 'bold');
    fitSingle(doc, clean(t.eyebrow), w, 8.5 * s, 5.5);
    doc.text(clean(t.eyebrow), x, y + 9 * s);

    doc.setTextColor.apply(doc, ink);
    var titleText = clean(t.title.toUpperCase());
    var tp = fitSingle(doc, titleText, w - rightW - 10 * s, 30 * s, 12);
    doc.text(titleText, x, y + 14 * s + tp * 0.85);
    var subY = y + 14 * s + tp * 0.85 + 18 * s;
    doc.setFont('helvetica', 'normal');
    fitSingle(doc, clean(t.sub.toUpperCase()), w - rightW - 10 * s, 12 * s, 7);
    doc.text(clean(t.sub.toUpperCase()), x, subY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12 * s);
    var noText = 'CARD ' + (i + 1);
    var noW = doc.getTextWidth(noText) + 16 * s, noH = 20 * s;
    doc.setFillColor.apply(doc, freeFill);
    doc.rect(x + w - noW, y + 16 * s, noW, noH, 'F');
    doc.text(noText, x + w - noW / 2, y + 16 * s + noH / 2 + 4.2 * s, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5 * s);
    doc.text('Name: ______________________', x + w, subY, { align: 'right' });

    var ruleY = subY + 8 * s;
    doc.setDrawColor.apply(doc, ink);
    doc.setLineWidth(2.2 * s);
    doc.line(x, ruleY, x + w, ruleY);

    var gap = 4 * s, cw = (w - 4 * gap) / 5;
    var ly = ruleY + 10 * s, lh = 26 * s;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20 * s);
    'BINGO'.split('').forEach(function (L, c) {
      var cx = x + c * (cw + gap);
      if (o.ink) { doc.setLineWidth(1.4 * s); doc.rect(cx, ly, cw, lh, 'S'); doc.setTextColor(0, 0, 0); }
      else { doc.setFillColor.apply(doc, ink); doc.rect(cx, ly, cw, lh, 'F'); doc.setTextColor(255, 255, 255); }
      doc.text(L, cx + cw / 2, ly + lh / 2 + 7 * s, { align: 'center' });
    });

    var footH = 20 * s;
    var gy = ly + lh + gap;
    var ch = (y + h - footH - gy - 4 * gap) / 5;
    doc.setLineWidth(1.5 * s);
    doc.setDrawColor.apply(doc, ink);
    card.cells.forEach(function (c, idx) {
      var r = Math.floor(idx / 5), col = idx % 5;
      var cx = x + col * (cw + gap), cy = gy + r * (ch + gap);
      if (c.free) {
        doc.setFillColor.apply(doc, freeFill);
        doc.rect(cx, cy, cw, ch, 'FD');
        doc.setTextColor.apply(doc, ink);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(Math.min(22 * s, ch * 0.3));
        doc.text('FREE', cx + cw / 2, cy + ch / 2 + 2 * s, { align: 'center' });
        doc.setFontSize(Math.max(5.5, 7 * s));
        doc.text(clean(o.freeLabel.toUpperCase()), cx + cw / 2, cy + ch / 2 + 14 * s, { align: 'center' });
        return;
      }
      doc.rect(cx, cy, cw, ch, 'S');
      doc.setTextColor.apply(doc, ink);
      doc.setFont('helvetica', 'bold');
      var pad = 6 * s;
      var f = fitLines(doc, clean(c.text), cw - 2 * pad, ch - 2 * pad, 11.5 * s, 5.5);
      doc.setFontSize(f.pt);
      var lhT = f.pt * 1.18, total = f.lines.length * lhT;
      var by = cy + (ch - total) / 2 + f.pt * 0.88;
      f.lines.forEach(function (ln, k) { doc.text(ln, cx + cw / 2, by + k * lhT, { align: 'center' }); });
    });

    doc.setFont('helvetica', 'normal');
    doc.setTextColor.apply(doc, ink);
    var foot = 'How to play: Mark a square when it happens. Five in a row across, down or diagonal wins.' + (o.free ? ' The center is free.' : '');
    fitSingle(doc, foot, w - 70 * s, 8.5 * s, 5.5);
    doc.text(foot, x, y + h - 4 * s);
    doc.setFontSize(Math.max(5.5, 7 * s));
    doc.setTextColor(110, 110, 110);
    doc.text('Set ' + o.seed + ' | card ' + (i + 1), x + w, y + h - 4 * s, { align: 'right' });
  }

  function drawChecklist(doc, o) {
    var CATS = window.Bingo.engine.CATS;
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), m = 48;
    var counts = {}, sq = {};
    o.cards.forEach(function (c) { c.cells.forEach(function (x) { if (!x.free) { counts[x.id] = (counts[x.id] || 0) + 1; sq[x.id] = x; } }); });
    var order = ['team', 'venue', 'story', 'generic'];
    var items = Object.keys(sq).map(function (k) { return sq[k]; }).sort(function (p, q) {
      return order.indexOf(p.cat) - order.indexOf(q.cat) || p.text.localeCompare(q.text);
    });
    var ink = o.ink ? [0, 0, 0] : [19, 41, 75];
    var header = function (cont) {
      doc.setTextColor.apply(doc, ink);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
      doc.text('HOST CHECKLIST' + (cont ? ' (CONTINUED)' : ''), m, m + 10);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.text(clean(o.gameLine + ' | ' + o.cards.length + ' cards, set ' + o.seed), m, m + 28);
      doc.setFontSize(9); doc.setTextColor(90, 90, 90);
      doc.text('Tick each square as it happens. The number shows how many cards have that square.', m, m + 42);
      doc.setDrawColor.apply(doc, ink); doc.setLineWidth(1.5); doc.line(m, m + 50, W - m, m + 50);
    };
    header(false);
    var colW = (W - 2 * m - 24) / 2, rowH = 15.5, top = m + 70, col = 0, yy = top, lastCat = null;
    var advance = function (need) {
      if (yy + need > H - m) {
        if (col === 0) { col = 1; yy = top; }
        else { doc.addPage(o.paper, 'portrait'); header(true); col = 0; yy = top; }
      }
    };
    items.forEach(function (it) {
      var x0;
      if (it.cat !== lastCat) {
        advance(rowH * 2.2);
        x0 = m + col * (colW + 24);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor.apply(doc, ink);
        doc.text(clean(CATS[it.cat]).toUpperCase(), x0, yy + 6);
        yy += rowH * 1.2; lastCat = it.cat;
      }
      advance(rowH);
      x0 = m + col * (colW + 24);
      doc.setDrawColor.apply(doc, ink); doc.setLineWidth(0.8);
      doc.rect(x0, yy - 1, 9, 9, 'S');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(20, 20, 20);
      var label = clean(it.text);
      fitSingle(doc, label, colW - 46, 9.5, 6.5);
      doc.text(label, x0 + 15, yy + 7);
      doc.setFontSize(8.5); doc.setTextColor(100, 100, 100);
      doc.text(String(counts[it.id]), x0 + colW, yy + 7, { align: 'right' });
      yy += rowH;
    });
    if (o.sources && o.sources.length) {
      advance(rowH * (o.sources.length + 2));
      var x1 = m + col * (colW + 24);
      yy += rowH * 0.6;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor.apply(doc, ink);
      doc.text('RESEARCHED FROM', x1, yy + 6); yy += rowH * 1.2;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60, 60, 60);
      o.sources.slice(0, 8).forEach(function (src) {
        advance(rowH);
        var x2 = m + col * (colW + 24);
        var label = clean(src.title);
        fitSingle(doc, label, colW, 8, 6);
        doc.textWithLink(label, x2, yy + 7, { url: src.url });
        yy += rowH;
      });
    }
  }

  /**
   * o: { cards, titles:{eyebrow,title,sub}, gameLine, free, freeLabel, paper, perPage, ink, checklist, seed, sources }
   * Returns an ArrayBuffer.
   */
  function build(o) {
    var jsPDF = window.jspdf.jsPDF;
    var two = o.perPage === 2;
    var doc = new jsPDF({ unit: 'pt', format: o.paper, orientation: two ? 'landscape' : 'portrait' });
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var m = two ? 30 : 40;
    o.cards.forEach(function (card, i) {
      if (!two) {
        if (i > 0) doc.addPage(o.paper, 'portrait');
        var bw = W - 2 * m;
        drawCard(doc, o, card, i, m, m, bw, H - 2 * m, bw / 532);
      } else {
        var slot = i % 2, gap = 36, bw2 = (W - 2 * m - gap) / 2;
        if (i > 0 && slot === 0) doc.addPage(o.paper, 'landscape');
        if (slot === 0) {
          doc.setDrawColor(170, 170, 170); doc.setLineWidth(0.6);
          doc.setLineDashPattern([4, 4], 0); doc.line(W / 2, 14, W / 2, H - 14); doc.setLineDashPattern([], 0);
        }
        drawCard(doc, o, card, i, m + slot * (bw2 + gap), m, bw2, H - 2 * m, bw2 / 532);
      }
    });
    if (o.checklist) { doc.addPage(o.paper, 'portrait'); drawChecklist(doc, o); }
    return doc.output('arraybuffer');
  }

  window.Bingo = window.Bingo || {};
  window.Bingo.pdf = { build: build };
})();
