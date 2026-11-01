'use strict';
/* Shared helpers for the Clipps pages: formatting, canvas sizing and the candle chart. */
window.Clipps = window.Clipps || {};

(function (C) {
  const pad = (n) => String(n).padStart(2, '0');

  C.fmt = (n, dp) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

  C.fmtQty = (q) => {
    const a = Math.abs(q);
    if (a >= 1000) return C.fmt(q, 0);
    if (a >= 10) return C.fmt(q, 2);
    return C.fmt(q, 4);
  };

  // Signed USD for P&L: +$1,204 / −$36.20 / $0.00
  C.fmtUsd = (n) => {
    const a = Math.abs(n);
    const dp = a < 100 ? 2 : 0;
    const body = '$' + a.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    if (a < 0.005) return '$0.00';
    return (n > 0 ? '+' : '−') + body;
  };

  C.fmtTime = (t, seconds = true) => {
    const d = new Date(t);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + (seconds ? ':' + pad(d.getSeconds()) : '');
  };

  C.dirClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

  C.esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  C.reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  C.fitCanvas = (c) => {
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { w: r.width, h: r.height, dpr };
  };

  /* Agent avatars: 7×7 two-tone pixel glyphs in the Clipps mark's language.
     The shape identifies the agent; the colours come from CSS and follow its state. */
  const GLYPHS = {
    'ORION-7': ['..XXX..', '..XoX..', 'XXXoXXX', 'XoooooX', 'XXXoXXX', '..XoX..', '..XXX..'],
    'VEGA-3': ['.X.X.X.', 'X.XoX.X', '.XoXoX.', 'XoX.XoX', '.XoXoX.', 'X.XoX.X', '.X.X.X.'],
    'LYRA-12': ['.XX....', '.XoX.XX', '..XXXoX', '.XXoXX.', 'XoXXX..', 'XX.XoX.', '....XX.'],
    'ATLAS-1': ['..XXX..', '.XoooX.', 'XoXXXoX', 'XoX.XoX', 'XoXXXoX', '.XoooX.', '..XXX..'],
    'NOVA-9': ['...X...', '.X.X.X.', '..XoX..', 'XXoooXX', '..XoX..', '.X.X.X.', '...X...'],
    'KEPLER-4': ['.XXXXX.', 'Xo...oX', 'X.XXX.X', 'X.XoX.X', 'X.XXX.X', 'Xo...oX', '.XXXXX.'],
    'HELIX-2': ['XX...XX', '.Xo.oX.', '..XXX..', '..XoX..', '..XXX..', '.Xo.oX.', 'XX...XX'],
    'RIGEL-5': ['...X...', '..XoX..', '.XoXoX.', 'XoX.XoX', '..XoX..', '..XoX..', '..XXX..'],
  };
  C.avatar = (id) => {
    const g = GLYPHS[id] || GLYPHS['ORION-7'];
    let base = '', hi = '';
    g.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'X') base += `M${x} ${y}h1v1h-1z`;
      else if (ch === 'o') hi += `M${x} ${y}h1v1h-1z`;
    }));
    return `<svg class="avatar" viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true"><path class="av-base" d="${base}"/><path class="av-hi" d="${hi}"/></svg>`;
  };

  const CH = {
    grid: 'rgba(245, 247, 250, 0.06)',
    label: '#8d97a8',
    up: '#2ec4a6',
    down: '#f2646f',
    cross: 'rgba(245, 247, 250, 0.4)',
    band: 'rgba(245, 247, 250, 0.05)',
    ink: '#07090d',
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* Draws candles (+ volume) into a canvas sized by CSS.
     With axes: price scale on the right, time scale along the bottom, last-price tag.
     Returns the geometry needed to map pointer positions back to candles. */
  C.drawChart = function (canvas, { candles, dp, tfMs = 5000, axes = true, grid = axes, lastLine = true, inspectT = null, barSpace = 8 }) {
    const { w, h, dpr } = C.fitCanvas(canvas);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!candles.length || w < 60 || h < 40) return null;

    const padL = axes ? 8 : 2, padR = axes ? 80 : 2, padT = 10, padB = axes ? 26 : 4;
    const plotW = w - padL - padR;
    const n = Math.max(2, Math.min(candles.length, Math.floor(plotW / barSpace)));
    const start = candles.length - n;
    const cs = candles.slice(start);

    let hi = -Infinity, lo = Infinity, vmax = 0;
    for (const c of cs) { if (c.h > hi) hi = c.h; if (c.l < lo) lo = c.l; if (c.v > vmax) vmax = c.v; }
    const padP = (hi - lo) * 0.08 || hi * 0.001;
    hi += padP; lo -= padP;

    const innerH = h - padT - padB;
    const volH = innerH * (axes ? 0.16 : 0.14);
    const priceH = innerH - volH - 4;
    const y = (p) => padT + ((hi - p) / (hi - lo)) * priceH;
    const cw = plotW / n;
    const xc = (i) => padL + i * cw + cw / 2;

    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    ctx.lineWidth = 1;

    if (!axes && grid) {
      ctx.strokeStyle = CH.grid;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) {
        const yy = Math.round(padT + (innerH * i) / 4) + 0.5;
        ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy);
      }
      const gx = Math.max(32, plotW / 6);
      for (let x = padL + gx; x < padL + plotW - 4; x += gx) {
        const xx = Math.round(x) + 0.5;
        ctx.moveTo(xx, padT); ctx.lineTo(xx, h - padB);
      }
      ctx.stroke();
    }

    if (axes) {
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (let i = 0; i <= 4; i++) {
        const p = lo + ((hi - lo) * i) / 4;
        const yy = Math.round(y(p)) + 0.5;
        ctx.strokeStyle = CH.grid;
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.fillStyle = CH.label;
        ctx.fillText(C.fmt(p, dp), padL + plotW + 10, yy);
      }
      // time labels on round multiples of the interval, at least ~80px apart
      const k = Math.max(1, Math.ceil(80 / cw));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (let i = 0; i < n; i++) {
        if (Math.round(cs[i].t / tfMs) % k !== 0) continue;
        const x = xc(i);
        if (x < padL + 28 || x > padL + plotW - 28) continue;
        ctx.strokeStyle = CH.grid;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, padT); ctx.lineTo(Math.round(x) + 0.5, h - padB); ctx.stroke();
        ctx.fillStyle = CH.label;
        ctx.fillText(C.fmtTime(cs[i].t, tfMs < 60000), x, h - 8);
      }
    }

    let inspIdx = -1;
    if (inspectT != null) inspIdx = cs.findIndex((c) => c.t === inspectT);
    if (inspIdx >= 0) {
      ctx.fillStyle = CH.band;
      ctx.fillRect(xc(inspIdx) - cw / 2, padT, cw, h - padT - padB);
    }

    const bw = Math.max(1, Math.min(cw * 0.64, 12));
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      const x = xc(i);
      ctx.fillStyle = c.c >= c.o ? CH.up : CH.down;
      if (vmax > 0) {
        const vh = (c.v / vmax) * volH;
        ctx.globalAlpha = 0.28;
        ctx.fillRect(x - bw / 2, h - padB - vh, bw, vh);
        ctx.globalAlpha = 1;
      }
      ctx.fillRect(Math.round(x) - 0.5, y(c.h), 1, Math.max(1, y(c.l) - y(c.h)));
      const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
      ctx.fillRect(x - bw / 2, top, bw, Math.max(1, bot - top));
    }

    // last price
    const last = cs[n - 1];
    const col = last.c >= last.o ? CH.up : CH.down;
    const ly = Math.round(y(last.c)) + 0.5;
    if (lastLine) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(padL + plotW, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (axes) {
      const label = C.fmt(last.c, dp);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = col;
      roundRect(ctx, padL + plotW + 4, ly - 10, padR - 8, 20, 4);
      ctx.fill();
      ctx.fillStyle = CH.ink;
      ctx.fillText(label, padL + plotW + 10, ly);
    }

    if (inspIdx >= 0) {
      const x = Math.round(xc(inspIdx)) + 0.5;
      ctx.strokeStyle = CH.cross;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
    }

    return { start, n, padL, cw, plotW, cs, inspIdx };
  };
})(window.Clipps);
