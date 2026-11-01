'use strict';

/* ═════════════════════════════════════════════
   Helpers
   ═════════════════════════════════════════════ */
const $ = (s, r = document) => r.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const fmt = (n, dp) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtUsd = (n) => (n < 0 ? '−$' : '+$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
function fmtQty(q) {
  const a = Math.abs(q);
  if (a >= 1000) return fmt(q, 0);
  if (a >= 10) return fmt(q, 2);
  return fmt(q, 4);
}
const hhmmss = (d = new Date()) => d.toTimeString().slice(0, 8);
const cls = (n) => (n >= 0 ? 'up' : 'down');

function fitCanvas(c) {
  const r = c.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w: r.width, h: r.height, dpr };
}

/* ═════════════════════════════════════════════
   Market simulation
   ═════════════════════════════════════════════ */
const TICK_MS = 500;
const CANDLE_TICKS = 10; // 5s candles
const MAX_CANDLES = 160;

const SYMBOLS = [
  { s: 'CLIP-PERP', p: 3.142, v: 0.0035, dp: 4 },
  { s: 'BTC-PERP', p: 118420, v: 0.0011, dp: 1 },
  { s: 'ETH-PERP', p: 4630, v: 0.0015, dp: 2 },
  { s: 'SOL-PERP', p: 242.5, v: 0.002, dp: 3 },
  { s: 'NVDA', p: 212.4, v: 0.0012, dp: 2 },
  { s: 'TSLA', p: 438.9, v: 0.0018, dp: 2 },
];

const market = SYMBOLS.map((m) => {
  const st = { ...m, price: m.p, ticks: 0, candles: [], book: null };
  let p = m.p * rand(0.97, 1.0);
  for (let i = 0; i < 120; i++) {
    const o = p; let h = p, l = p;
    for (let k = 0; k < CANDLE_TICKS; k++) {
      p *= Math.exp(m.v * 0.6 * gauss());
      h = Math.max(h, p); l = Math.min(l, p);
    }
    st.candles.push({ o, h, l, c: p, v: rand(20, 100) });
  }
  st.price = p;
  st.open = st.candles[0].o;
  st.candles.push({ o: p, h: p, l: p, c: p, v: 0 });
  return st;
});
let active = market[0];

function tickMarket() {
  for (const m of market) {
    m.price *= Math.exp(m.v * 0.6 * gauss());
    const c = m.candles[m.candles.length - 1];
    c.c = m.price; c.h = Math.max(c.h, m.price); c.l = Math.min(c.l, m.price);
    c.v += rand(1, 10);
    if (++m.ticks % CANDLE_TICKS === 0) {
      m.candles.push({ o: m.price, h: m.price, l: m.price, c: m.price, v: 0 });
      if (m.candles.length > MAX_CANDLES) m.candles.shift();
    }
  }
}

function buildBook(m) {
  const levels = 11;
  const step = m.price * 0.00022;
  if (!m.book) m.book = { a: [], b: [] };
  const base = 40000 / m.price;
  const asks = [], bids = [];
  for (let i = 0; i < levels; i++) {
    const prevA = m.book.a[i] ?? base * rand(0.4, 1.6) * (1 + i * 0.18);
    const prevB = m.book.b[i] ?? base * rand(0.4, 1.6) * (1 + i * 0.18);
    const sa = clamp(prevA * (1 + 0.18 * gauss()), base * 0.15, base * 4);
    const sb = clamp(prevB * (1 + 0.18 * gauss()), base * 0.15, base * 4);
    m.book.a[i] = sa; m.book.b[i] = sb;
    asks.push({ p: m.price + step * (i + 0.5), s: sa });
    bids.push({ p: m.price - step * (i + 0.5), s: sb });
  }
  return { asks, bids, step };
}

/* ═════════════════════════════════════════════
   Agents, positions, fills
   ═════════════════════════════════════════════ */
const AGENTS = [
  ['ORION-7', 'Momentum breakout', () => `breakout +${rand(1.2, 3.4).toFixed(1)}σ on 30s range`],
  ['VEGA-3', 'Stat-arb pairs', () => `spread z=${(rand(1.9, 3.2) * (Math.random() < 0.5 ? -1 : 1)).toFixed(2)} vs basket`],
  ['LYRA-12', 'Funding basis', () => `funding ${rand(-0.04, 0.06).toFixed(3)}% · basis capture`],
  ['ATLAS-1', 'Macro regime', () => `regime shift p=${rand(0.62, 0.94).toFixed(2)} · risk-on`],
  ['NOVA-9', 'Liquidity provision', () => `quote refresh · inventory skew ${rand(-0.4, 0.4).toFixed(2)}`],
  ['KEPLER-4', 'Volatility carry', () => `IV/RV ${rand(1.05, 1.6).toFixed(2)} · harvesting carry`],
  ['HELIX-2', 'Event embeddings', () => `news vector Δ ${rand(0.2, 0.9).toFixed(2)} · ${pick(['earnings', 'filing', 'policy', 'on-chain'])}`],
  ['RIGEL-5', 'Mean reversion', () => `VWAP dev ${rand(0.3, 1.4).toFixed(2)}% · fade`],
].map(([id, strat, why]) => ({ id, strat, why, status: 'SCANNING', conf: rand(0.45, 0.9), paused: false }));

const positions = new Map(); // `${owner}|${sym}` → position
const fills = [];             // timestamps for rate
const prints = [];            // tape for the active symbol
const pending = [];           // resting operator limit orders
let coreActivity = 0.4;

function applyFill(owner, m, side, qty, px) {
  const sgn = side === 'BUY' ? 1 : -1;
  const key = `${owner}|${m.s}`;
  const p = positions.get(key) || { owner, m, qty: 0, avg: 0, realized: 0 };
  if (p.qty === 0 || Math.sign(p.qty) === sgn) {
    p.avg = (p.avg * Math.abs(p.qty) + px * qty) / (Math.abs(p.qty) + qty);
    p.qty += sgn * qty;
  } else {
    const closing = Math.min(Math.abs(p.qty), qty);
    p.realized += (px - p.avg) * closing * Math.sign(p.qty);
    p.qty += sgn * qty;
    if (Math.abs(p.qty) * px < 1) p.qty = 0;
    else if (Math.sign(p.qty) === sgn) p.avg = px;
  }
  positions.set(key, p);
  fills.push(Date.now());
  if (m === active) pushPrint(side, qty, px, true);
  coreActivity = Math.min(1, coreActivity + 0.35);
  burstPulses(10);
}

function ownerPnl(owner) {
  let t = 0;
  for (const p of positions.values()) {
    if (p.owner === owner) t += p.realized + p.qty * (p.m.price - p.avg);
  }
  return t;
}

function agentAct() {
  const live = AGENTS.filter((a) => !a.paused);
  for (const a of AGENTS) {
    if (a.status !== 'SCANNING' && Math.random() < 0.35) a.status = 'SCANNING';
    a.conf = clamp(a.conf + gauss() * 0.04, 0.2, 0.98);
  }
  if (!live.length || Math.random() < 0.25) return;
  const a = pick(live);
  const m = Math.random() < 0.45 ? active : pick(market);
  const existing = positions.get(`${a.id}|${m.s}`);
  let side, qty;
  if (existing && existing.qty !== 0 && Math.random() < 0.4) {
    side = existing.qty > 0 ? 'SELL' : 'BUY';
    qty = Math.abs(existing.qty) * rand(0.3, 1);
    a.status = 'HEDGING';
  } else {
    side = Math.random() < 0.5 + (a.conf - 0.5) * 0.3 ? 'BUY' : 'SELL';
    qty = rand(4000, 45000) / m.price;
    a.status = 'EXECUTING';
  }
  const px = m.price * (1 + (side === 'BUY' ? 1 : -1) * 0.00018);
  applyFill(a.id, m, side, qty, px);
  log(side.toLowerCase(), a.id, `${side} ${fmtQty(qty)} ${m.s} @ ${fmt(px, m.dp)}`, `${a.why()} · conf ${a.conf.toFixed(2)}`);
}

function checkPending() {
  for (let i = pending.length - 1; i >= 0; i--) {
    const o = pending[i];
    const hit = o.side === 'BUY' ? o.m.price <= o.px : o.m.price >= o.px;
    if (hit) {
      pending.splice(i, 1);
      applyFill(o.owner, o.m, o.side, o.qty, o.px);
      log(o.side.toLowerCase(), o.owner, `LIMIT FILLED ${o.side} ${fmtQty(o.qty)} ${o.m.s} @ ${fmt(o.px, o.m.dp)}`, 'resting order crossed');
    }
  }
  $('#pendingInfo').textContent = pending.length
    ? `${pending.length} resting limit order${pending.length > 1 ? 's' : ''} · simulated`
    : 'Paper trading · simulated fills';
}

/* ═════════════════════════════════════════════
   Rendering: panels
   ═════════════════════════════════════════════ */
const tapeEl = $('#tape');
function renderTape() {
  if (!tapeEl.children.length) {
    for (const m of market) {
      const b = document.createElement('button');
      b.type = 'button';
      b.addEventListener('click', () => setActive(m));
      m.tapeEl = b;
      tapeEl.appendChild(b);
    }
  }
  for (const m of market) {
    const chg = (m.price / m.open - 1) * 100;
    m.tapeEl.className = m === active ? 'active' : '';
    m.tapeEl.innerHTML = `<b>${m.s}</b><span>${fmt(m.price, m.dp)}</span><em class="${cls(chg)}">${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}%</em>`;
  }
}

function renderFleet() {
  const el = $('#fleet');
  if (!el.children.length) {
    el.innerHTML = AGENTS.map((a) => `<li class="agent" data-id="${a.id}">
      <span class="name">${a.id}</span><span class="pnl"></span>
      <span class="strat">${a.strat}</span><span class="state"></span>
      <span class="bar"><i></i></span>
    </li>`).join('');
    AGENTS.forEach((a, i) => { a.el = el.children[i]; });
  }
  let total = 0;
  for (const a of AGENTS) {
    const pnl = ownerPnl(a.id);
    total += pnl;
    a.el.className = 'agent' + (a.paused ? ' paused' : '');
    a.el.title = `Click to ${a.paused ? 'resume' : 'pause'} ${a.id}`;
    const p = a.el.querySelector('.pnl'); p.textContent = fmtUsd(pnl); p.className = 'pnl ' + cls(pnl);
    const s = a.el.querySelector('.state'); s.textContent = a.paused ? 'PAUSED' : a.status; s.className = 'state ' + (a.paused ? '' : a.status);
    a.el.querySelector('.bar i').style.width = (a.conf * 100).toFixed(0) + '%';
  }
  total += ownerPnl('OPERATOR');
  const tag = $('#fleetPnl');
  tag.textContent = fmtUsd(total);
  tag.className = 'tag ' + cls(total);
  const online = AGENTS.filter((a) => !a.paused).length;
  $('#agentsOnline').innerHTML = `<i class="led ${online ? 'green' : ''}"></i>${online}/${AGENTS.length} AGENTS`;
  return total;
}
$('#fleet').addEventListener('click', (e) => {
  const li = e.target.closest('.agent');
  if (!li) return;
  const a = AGENTS.find((x) => x.id === li.dataset.id);
  a.paused = !a.paused;
  log('sys', 'BRIDGE', `${a.id} ${a.paused ? 'paused' : 'resumed'} by operator`, a.strat);
  renderFleet();
});

function renderBook() {
  const { asks, bids, step } = buildBook(active);
  let ta = 0, tb = 0;
  const cumA = asks.map((r) => (ta += r.s));
  const cumB = bids.map((r) => (tb += r.s));
  const max = Math.max(ta, tb);
  const row = (r, cum) => `<div class="book-row"><i style="width:${(cum / max) * 100}%"></i><span>${fmt(r.p, active.dp)}</span><span>${fmtQty(r.s)}</span><span>${fmtQty(cum)}</span></div>`;
  $('#asks').innerHTML = asks.map((r, i) => row(r, cumA[i])).join('');
  $('#bids').innerHTML = bids.map((r, i) => row(r, cumB[i])).join('');
  $('#spread').innerHTML = `<span>${fmt(active.price, active.dp)}</span><small>spread ${fmt(step, active.dp)} · ${(step / active.price * 1e4).toFixed(1)} bps</small>`;
}

function pushPrint(side, qty, px, agent = false) {
  prints.unshift({ side, qty, px, t: hhmmss(), agent });
  if (prints.length > 30) prints.pop();
}
function renderPrints() {
  $('#prints').innerHTML = prints.slice(0, 16).map((p, i) =>
    `<li class="${i === 0 && p.agent ? 'flash' : ''}"><span class="${p.side === 'BUY' ? 'up' : 'down'}">${fmt(p.px, active.dp)}</span><span>${fmtQty(p.qty)}</span><span>${p.t}</span></li>`
  ).join('');
}

function renderPositions() {
  const rows = [...positions.values()].filter((p) => p.qty !== 0)
    .sort((a, b) => Math.abs(b.qty * b.m.price) - Math.abs(a.qty * a.m.price));
  $('#posCount').textContent = `${rows.length} open`;
  const tb = $('#positions');
  if (!rows.length) { tb.innerHTML = '<tr><td class="empty" colspan="6">No open positions — the fleet is scanning.</td></tr>'; return; }
  tb.innerHTML = rows.slice(0, 24).map((p) => {
    const u = p.qty * (p.m.price - p.avg);
    return `<tr><td>${p.owner}</td><td>${p.m.s}</td><td class="${cls(p.qty)}">${fmtQty(p.qty)}</td><td>${fmt(p.avg, p.m.dp)}</td><td>${fmt(p.m.price, p.m.dp)}</td><td class="${cls(u)}">${fmtUsd(u)}</td></tr>`;
  }).join('');
}

function log(kind, who, text, why = '') {
  const ol = $('#log');
  const li = document.createElement('li');
  li.className = kind;
  li.innerHTML = `<time>${hhmmss()}</time><span><span class="who">${who}</span> ▸ ${text}</span>${why ? `<span class="why">${why}</span>` : ''}`;
  ol.prepend(li);
  while (ol.children.length > 80) ol.lastChild.remove();
}

function renderCoreStats(fleetTotal) {
  const chg = (active.price / active.open - 1) * 100;
  $('#coreSym').textContent = active.s;
  $('#corePrice').textContent = fmt(active.price, active.dp);
  const c = $('#coreChg');
  c.textContent = `${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}%  ·  session`;
  c.className = 'core-chg ' + cls(chg);

  let exposure = 0;
  for (const p of positions.values()) exposure += p.qty * p.m.price;
  const now = Date.now();
  while (fills.length && now - fills[0] > 60000) fills.shift();
  const s = $('#stPnl'); s.textContent = fmtUsd(fleetTotal); s.className = cls(fleetTotal);
  $('#stExp').textContent = fmtUsd(exposure).replace('+', '');
  $('#stRate').textContent = fills.length;
  $('#stSigma').textContent = consensus().toFixed(2);
}
const consensus = () => {
  const live = AGENTS.filter((a) => !a.paused);
  return live.length ? 0.5 + 2.5 * (live.reduce((t, a) => t + a.conf, 0) / live.length) : 0.5;
};

/* ── Candle chart ── */
const chartEl = $('#chart');
let hover = null;
chartEl.addEventListener('mousemove', (e) => { const r = chartEl.getBoundingClientRect(); hover = { x: e.clientX - r.left, y: e.clientY - r.top }; drawChart(); });
chartEl.addEventListener('mouseleave', () => { hover = null; drawChart(); });

function drawChart() {
  const { w, h, dpr } = fitCanvas(chartEl);
  const ctx = chartEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const padR = 72, padT = 12, padB = 8;
  const plotW = w - padR - 10;
  const n = clamp(Math.floor(plotW / 8), 20, active.candles.length);
  const cs = active.candles.slice(-n);
  let hi = -Infinity, lo = Infinity, vmax = 0;
  for (const c of cs) { hi = Math.max(hi, c.h); lo = Math.min(lo, c.l); vmax = Math.max(vmax, c.v); }
  const pad = (hi - lo) * 0.08 || hi * 0.001;
  hi += pad; lo -= pad;
  const volH = h * 0.16;
  const plotH = h - padT - padB - volH;
  const y = (p) => padT + ((hi - p) / (hi - lo)) * plotH;
  const cw = plotW / cs.length;
  const x0 = 10;

  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const p = lo + ((hi - lo) * i) / 4;
    const yy = Math.round(y(p)) + 0.5;
    ctx.strokeStyle = 'rgba(150,170,255,0.08)';
    ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + plotW, yy); ctx.stroke();
    ctx.fillStyle = 'rgba(138,148,184,0.8)';
    ctx.fillText(fmt(p, active.dp), x0 + plotW + 8, yy);
  }

  cs.forEach((c, i) => {
    const cx = x0 + i * cw + cw / 2;
    const up = c.c >= c.o;
    const col = up ? '#3fe0a4' : '#ff5f7e';
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(Math.round(cx) + 0.5, y(c.h)); ctx.lineTo(Math.round(cx) + 0.5, y(c.l)); ctx.stroke();
    const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
    ctx.fillRect(cx - cw * 0.32, top, cw * 0.64, Math.max(1, bot - top));
    ctx.globalAlpha = 0.25;
    const vh = (c.v / vmax) * volH * 0.9;
    ctx.fillRect(cx - cw * 0.32, h - padB - vh, cw * 0.64, vh);
    ctx.globalAlpha = 1;
  });

  // last price — gold
  const ly = Math.round(y(active.price)) + 0.5;
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(255,176,59,0.8)';
  ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x0 + plotW, ly); ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowColor = '#ffb03b'; ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffb03b';
  roundRect(ctx, x0 + plotW + 2, ly - 9, padR - 6, 18, 5); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#1b1204';
  ctx.fillText(fmt(active.price, active.dp), x0 + plotW + 8, ly);

  // crosshair
  let shown = cs[cs.length - 1];
  if (hover && hover.x < x0 + plotW) {
    const i = clamp(Math.floor((hover.x - x0) / cw), 0, cs.length - 1);
    shown = cs[i];
    ctx.strokeStyle = 'rgba(220,230,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(x0 + i * cw + cw / 2, padT); ctx.lineTo(x0 + i * cw + cw / 2, h - padB);
    ctx.moveTo(x0, hover.y); ctx.lineTo(x0 + plotW, hover.y);
    ctx.stroke();
  }
  $('#ohlc').innerHTML = `O ${fmt(shown.o, active.dp)} H ${fmt(shown.h, active.dp)} L ${fmt(shown.l, active.dp)} C <span class="${cls(shown.c - shown.o)}">${fmt(shown.c, active.dp)}</span>`;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ═════════════════════════════════════════════
   Core viewport: monolith with golden circuitry
   ═════════════════════════════════════════════ */
const coreEl = $('#core');
const SIDE_W = 1024, SIDE_H = 256, BAND = [96, 172];

function genTraces(w, y0, y1, count, maxSeg = 7) {
  const out = [];
  for (let i = 0; i < count; i++) {
    let x = rand(0, w), y = rand(y0, y1);
    const pts = [[x, y]];
    let horiz = Math.random() < 0.7;
    const segs = 2 + Math.floor(Math.random() * maxSeg);
    for (let s = 0; s < segs; s++) {
      if (horiz) x = clamp(x + (Math.random() < 0.5 ? -1 : 1) * rand(18, 110), 0, w);
      else if (Math.random() < 0.5) {
        const d = (Math.random() < 0.5 ? -1 : 1) * rand(6, 28);
        const ny = clamp(y + d, y0, y1); x += Math.abs(ny - y) * (Math.random() < 0.5 ? -1 : 1); y = ny;
      } else y = clamp(y + (Math.random() < 0.5 ? -1 : 1) * rand(6, 30), y0, y1);
      pts.push([x, y]);
      horiz = !horiz;
    }
    let len = 0;
    const cum = [0];
    for (let k = 1; k < pts.length; k++) { len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); cum.push(len); }
    if (len > 20) out.push({ pts, cum, len });
  }
  return out;
}
function strokeTrace(g, t) {
  g.beginPath();
  g.moveTo(t.pts[0][0], t.pts[0][1]);
  for (let k = 1; k < t.pts.length; k++) g.lineTo(t.pts[k][0], t.pts[k][1]);
  g.stroke();
}
function pointOn(t, d) {
  for (let k = 1; k < t.cum.length; k++) {
    if (d <= t.cum[k]) {
      const f = (d - t.cum[k - 1]) / (t.cum[k] - t.cum[k - 1] || 1);
      return [t.pts[k - 1][0] + (t.pts[k][0] - t.pts[k - 1][0]) * f, t.pts[k - 1][1] + (t.pts[k][1] - t.pts[k - 1][1]) * f];
    }
  }
  return t.pts[t.pts.length - 1];
}

const goldTraces = genTraces(SIDE_W, BAND[0] + 6, BAND[1] - 6, 90);
const faintTraces = genTraces(SIDE_W, 8, SIDE_H - 8, 70, 5);

const sideBase = (() => {
  const c = document.createElement('canvas'); c.width = SIDE_W; c.height = SIDE_H;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, SIDE_H);
  grd.addColorStop(0, '#24357e'); grd.addColorStop(0.5, '#142057'); grd.addColorStop(1, '#0a1033');
  g.fillStyle = grd; g.fillRect(0, 0, SIDE_W, SIDE_H);
  g.strokeStyle = 'rgba(140,165,255,0.10)'; g.lineWidth = 1;
  for (let x = 0; x < SIDE_W; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, SIDE_H); g.stroke(); }
  g.strokeStyle = 'rgba(150,180,255,0.28)'; g.lineWidth = 1.4;
  faintTraces.forEach((t) => strokeTrace(g, t));
  g.fillStyle = 'rgba(170,195,255,0.35)';
  faintTraces.forEach((t) => { const p = t.pts[t.pts.length - 1]; g.fillRect(p[0] - 2, p[1] - 2, 4, 4); });

  // the glowing slot
  g.fillStyle = '#030410'; g.fillRect(0, BAND[0], SIDE_W, BAND[1] - BAND[0]);
  g.fillStyle = 'rgba(225,232,255,0.9)'; g.fillRect(0, BAND[0] - 3, SIDE_W, 3);
  g.fillStyle = 'rgba(255,190,90,0.55)'; g.fillRect(0, BAND[1], SIDE_W, 2);
  g.shadowColor = '#ffa52e'; g.shadowBlur = 8;
  g.strokeStyle = 'rgba(255,170,55,0.9)'; g.lineWidth = 2.2;
  goldTraces.forEach((t) => strokeTrace(g, t));
  g.fillStyle = '#ffd27a';
  goldTraces.forEach((t) => {
    const a = t.pts[0], b = t.pts[t.pts.length - 1];
    g.beginPath(); g.arc(a[0], a[1], 2.6, 0, 7); g.fill();
    g.beginPath(); g.arc(b[0], b[1], 2.6, 0, 7); g.fill();
  });
  for (let i = 0; i < 26; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#ffe2a3' : '#ffb03b';
    g.fillRect(rand(0, SIDE_W), rand(BAND[0] + 8, BAND[1] - 14), rand(8, 26), rand(4, 9));
  }
  g.shadowBlur = 0;
  return c;
})();

const topTex = (() => {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 512, 512);
  grd.addColorStop(0, '#f4f5ff'); grd.addColorStop(0.45, '#bfc8f6'); grd.addColorStop(1, '#5a68c4');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
  for (let i = 64; i < 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  g.strokeStyle = 'rgba(70,85,170,0.25)';
  genTraces(512, 20, 492, 30, 4).forEach((t) => strokeTrace(g, t));
  return c;
})();

const sideWork = document.createElement('canvas');
sideWork.width = SIDE_W; sideWork.height = SIDE_H;
const sideCtx = sideWork.getContext('2d');

const pulses = [];
function spawnPulse() {
  const t = pick(goldTraces);
  pulses.push({ t, d: 0, v: rand(160, 420), dir: Math.random() < 0.5 ? 1 : -1 });
}
function burstPulses(n) { for (let i = 0; i < n; i++) spawnPulse(); }
burstPulses(30);

function updateSideTexture(dt) {
  sideCtx.globalCompositeOperation = 'source-over';
  sideCtx.drawImage(sideBase, 0, 0);
  sideCtx.globalCompositeOperation = 'lighter';
  if (Math.random() < 0.5 + coreActivity * 1.5) spawnPulse();
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    p.d += p.v * dt;
    if (p.d > p.t.len) { pulses.splice(i, 1); continue; }
    const dd = p.dir > 0 ? p.d : p.t.len - p.d;
    for (let k = 0; k < 4; k++) {
      const [x, y] = pointOn(p.t, clamp(dd - p.dir * k * 7, 0, p.t.len));
      const r = 9 - k * 1.8;
      const gr = sideCtx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,236,190,${0.95 - k * 0.2})`);
      gr.addColorStop(1, 'rgba(255,160,40,0)');
      sideCtx.fillStyle = gr;
      sideCtx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  if (pulses.length > 220) pulses.splice(0, pulses.length - 220);
}

const stars = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() ** 3 * 1.8 + 0.3, ph: rand(0, 6.28), sp: rand(0.002, 0.012) }));

function drawCore(t, dt) {
  const { w, h, dpr } = fitCanvas(coreEl);
  const ctx = coreEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // pixel stars on logo black — a few brightest ones are plus-shaped, like the X banner
  ctx.fillStyle = '#fff';
  for (const s of stars) {
    s.x -= s.sp * dt * 0.15; if (s.x < 0) s.x += 1;
    const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.8 + s.ph));
    const px = Math.round(s.x * w), py = Math.round(s.y * h), z = s.s > 1.2 ? 3 : 2;
    ctx.globalAlpha = tw;
    ctx.fillRect(px, py, z, z);
    if (s.s > 1.95) {
      ctx.globalAlpha = tw * 0.6;
      ctx.fillRect(px - z, py, z, z); ctx.fillRect(px + z, py, z, z);
      ctx.fillRect(px, py - z, z, z); ctx.fillRect(px, py + z, z, z);
    }
  }
  ctx.globalAlpha = 1;

  // lens flare (stage light)
  const fx = w * 0.93, fy = h * 0.2;
  const fl = ctx.createRadialGradient(fx, fy, 0, fx, fy, 70);
  fl.addColorStop(0, 'rgba(255,255,255,0.95)'); fl.addColorStop(0.08, 'rgba(255,255,255,0.45)'); fl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fl; ctx.fillRect(fx - 70, fy - 70, 140, 140);

  const R = Math.min(w * 0.36, h * 0.4);
  const cx = w * 0.5, cy = h * 0.5;

  drawMonolith(ctx, t, cx - R * 0.12, cy - R * 0.18 + Math.sin(t * 0.6) * 4, R * 1.35);
  drawHud(ctx, t, cx, cy, R, h);
}

function drawMonolith(ctx, t, ox, oy, S) {
  const W = S * 0.5, H = S * 0.14, D = S * 0.3; // half-dimensions
  const yaw = -0.62 + 0.22 * Math.sin(t * 0.13);
  const pitch = 0.46 + 0.05 * Math.sin(t * 0.21);
  const roll = -0.16;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = ([x, y, z]) => {
    let x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
    let y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2];
  };
  const P = (sx, sy, sz) => { const [x, y] = rot([sx * W, sy * H, sz * D]); return [ox + x, oy - y]; };
  const L = (() => { const v = [-0.35, 0.75, 0.55]; const m = Math.hypot(...v); return v.map((c) => c / m); })();

  const faces = [
    { n: [0, 1, 0], c: [[-1, 1, -1], [1, 1, -1], [-1, 1, 1]], tex: topTex, top: true },
    { n: [0, -1, 0], c: [[-1, -1, 1], [1, -1, 1], [-1, -1, -1]], tex: sideWork },
    { n: [0, 0, 1], c: [[-1, 1, 1], [1, 1, 1], [-1, -1, 1]], tex: sideWork },
    { n: [0, 0, -1], c: [[1, 1, -1], [-1, 1, -1], [1, -1, -1]], tex: sideWork },
    { n: [1, 0, 0], c: [[1, 1, 1], [1, 1, -1], [1, -1, 1]], tex: sideWork },
    { n: [-1, 0, 0], c: [[-1, 1, -1], [-1, 1, 1], [-1, -1, -1]], tex: sideWork },
  ];

  // emission glow behind the slab
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gl = ctx.createRadialGradient(ox, oy + H, 0, ox, oy + H, S * 0.75);
  gl.addColorStop(0, `rgba(255,170,60,${0.10 + coreActivity * 0.12})`);
  gl.addColorStop(1, 'rgba(255,170,60,0)');
  ctx.fillStyle = gl; ctx.fillRect(ox - S, oy - S, S * 2, S * 2);
  ctx.restore();

  for (const f of faces) {
    const n = rot(f.n);
    if (n[2] <= 0.001) continue;
    const p0 = P(...f.c[0]), p1 = P(...f.c[1]), p3 = P(...f.c[2]);
    const p2 = [p1[0] + p3[0] - p0[0], p1[1] + p3[1] - p0[1]];
    const tw = f.tex.width, th = f.tex.height;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.lineTo(...p2); ctx.lineTo(...p3); ctx.closePath();
    ctx.clip();
    ctx.transform((p1[0] - p0[0]) / tw, (p1[1] - p0[1]) / tw, (p3[0] - p0[0]) / th, (p3[1] - p0[1]) / th, p0[0], p0[1]);
    ctx.drawImage(f.tex, 0, 0);
    ctx.restore();

    const lam = clamp(n[0] * L[0] + n[1] * L[1] + n[2] * L[2], 0, 1);
    ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.lineTo(...p2); ctx.lineTo(...p3); ctx.closePath();
    ctx.fillStyle = `rgba(4,6,22,${(1 - lam) * (f.top ? 0.35 : 0.42)})`;
    ctx.fill();
    ctx.strokeStyle = f.top ? 'rgba(255,255,255,0.85)' : 'rgba(190,205,255,0.35)';
    ctx.lineWidth = f.top ? 1.4 : 1;
    ctx.stroke();
  }
}

function drawHud(ctx, t, cx, cy, R, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(225,232,255,0.6)';
  ctx.lineWidth = 1.4;
  // outer broken ring
  const a0 = t * 0.05;
  [[0.1, 1.35], [1.55, 2.6], [2.8, 4.1], [4.3, 5.9]].forEach(([s, e]) => {
    ctx.beginPath(); ctx.arc(cx, cy, R, a0 + s, a0 + e); ctx.stroke();
  });
  // inner thick arcs
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(235,240,255,0.75)';
  const a1 = -t * 0.08;
  [[0.3, 0.9], [2.0, 2.35], [3.4, 4.6], [5.2, 5.5]].forEach(([s, e]) => {
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.88, a1 + s, a1 + e); ctx.stroke();
  });
  // tick ring
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(200,215,255,0.3)';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2 + a0 * 0.5;
    const r1 = R * 1.04, r2 = R * (i % 6 === 0 ? 1.09 : 1.06);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
  }

  // reticle locked on target
  const rx = cx + R * 0.02 + Math.sin(t * 0.7) * R * 0.03, ry = cy + R * 0.12 + Math.cos(t * 0.5) * R * 0.02;
  ctx.strokeStyle = 'rgba(235,240,255,0.85)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(rx, ry, R * 0.1, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowColor = '#ffd27a'; ctx.shadowBlur = 18;
  ctx.fillStyle = '#fff3cf';
  ctx.beginPath(); ctx.arc(rx, ry, R * 0.035, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  // vertical consensus scale (0.5 … 3.0)
  const sx = cx - R * 1.22, top = Math.max(cy - R * 0.92, 150), bot = cy + R * 0.8;
  if (sx > 30 && bot - top > 120) {
    ctx.strokeStyle = 'rgba(225,232,255,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx, bot); ctx.stroke();
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(225,232,255,0.7)';
    ctx.textBaseline = 'middle';
    const yv = (v) => bot - ((v - 0.5) / 2.5) * (bot - top);
    for (let v = 0.5; v <= 3.001; v += 0.25) {
      const yy = yv(v);
      const major = Math.abs(v * 2 - Math.round(v * 2)) < 1e-6;
      ctx.beginPath(); ctx.moveTo(sx, yy); ctx.lineTo(sx + (major ? 12 : 6), yy); ctx.stroke();
      if (major) ctx.fillText(v.toFixed(1), sx + 16, yy);
    }
    const my = yv(consensus());
    ctx.fillStyle = '#ffd27a';
    ctx.shadowColor = '#ffb03b'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(sx - 2, my); ctx.lineTo(sx - 12, my - 6); ctx.lineTo(sx - 12, my + 6); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save();
    ctx.translate(sx - 24, (top + bot) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(138,148,184,0.8)';
    ctx.fillText('CONSENSUS σ', 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  coreActivity = Math.max(0.15, coreActivity - dt * 0.25);
  updateSideTexture(dt);
  drawCore(now / 1000, dt);
  requestAnimationFrame(frame);
}

/* ═════════════════════════════════════════════
   Order ticket
   ═════════════════════════════════════════════ */
const ticket = { side: 'BUY', type: 'MARKET' };
const ownerSel = $('#tkOwner');
ownerSel.innerHTML = '<option value="OPERATOR">Operator (manual)</option>' + AGENTS.map((a) => `<option value="${a.id}">Delegate → ${a.id}</option>`).join('');

document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => {
  ticket.side = b.dataset.side;
  document.querySelectorAll('[data-side]').forEach((x) => x.classList.toggle('active', x === b));
  updateTicket();
}));
document.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
  ticket.type = b.dataset.type;
  document.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('active', x === b));
  $('#limitField').hidden = ticket.type !== 'LIMIT';
  if (ticket.type === 'LIMIT') $('#tkPx').value = active.price.toFixed(active.dp);
  updateTicket();
}));
$('#tkQty').addEventListener('input', updateTicket);
$('#tkPx').addEventListener('input', updateTicket);

function updateTicket() {
  $('#tkSym').textContent = active.s;
  const qty = parseFloat($('#tkQty').value) || 0;
  const px = ticket.type === 'LIMIT' ? parseFloat($('#tkPx').value) || active.price : active.price;
  $('#tkNotional').textContent = '$' + fmt(qty * px, 2);
  const e = $('#engage');
  e.textContent = `Engage · ${ticket.side === 'BUY' ? 'Buy' : 'Sell'}`;
  e.classList.toggle('sell', ticket.side === 'SELL');
}

$('#ticket').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const qty = parseFloat($('#tkQty').value);
  if (!(qty > 0)) { log('sys', 'BRIDGE', 'order rejected: size must be positive'); return; }
  const owner = ownerSel.value;
  const tag = owner === 'OPERATOR' ? 'manual' : 'delegated by operator';
  if (ticket.type === 'MARKET') {
    const px = active.price * (1 + (ticket.side === 'BUY' ? 1 : -1) * 0.0003);
    applyFill(owner, active, ticket.side, qty, px);
    log(ticket.side.toLowerCase(), owner, `${ticket.side} ${fmtQty(qty)} ${active.s} @ ${fmt(px, active.dp)}`, `market order · ${tag}`);
  } else {
    const px = parseFloat($('#tkPx').value);
    if (!(px > 0)) { log('sys', 'BRIDGE', 'order rejected: invalid limit price'); return; }
    pending.push({ owner, m: active, side: ticket.side, qty, px });
    log('sys', owner, `LIMIT ${ticket.side} ${fmtQty(qty)} ${active.s} @ ${fmt(px, active.dp)} resting`, tag);
  }
  checkPending();
  renderAll();
});

/* ═════════════════════════════════════════════
   Wiring
   ═════════════════════════════════════════════ */
function setActive(m) {
  active = m;
  prints.length = 0;
  $('#bookSym').textContent = m.s;
  $('#chartSym').textContent = m.s;
  if (ticket.type === 'LIMIT') $('#tkPx').value = m.price.toFixed(m.dp);
  $('#tkQty').value = Math.max(1, Math.round(5000 / m.price * 1000) / 1000);
  burstPulses(40);
  renderAll();
  updateTicket();
}

function renderAll() {
  renderTape();
  const total = renderFleet();
  renderBook();
  renderPrints();
  renderPositions();
  renderCoreStats(total);
  drawChart();
}

function tick() {
  tickMarket();
  // ambient tape prints
  const n = Math.random() < 0.6 ? 1 : 2;
  for (let i = 0; i < n; i++) pushPrint(Math.random() < 0.5 ? 'BUY' : 'SELL', rand(500, 15000) / active.price, active.price * (1 + gauss() * 0.0002));
  agentAct();
  checkPending();
  renderAll();
  updateTicket();
}

setInterval(() => { $('#clock').textContent = hhmmss() + ' L'; }, 1000);
$('#clock').textContent = hhmmss() + ' L';
log('sys', 'BRIDGE', 'Clipps core online · 8 agents attached', 'simulated market data feed');
setActive(active);
setInterval(tick, TICK_MS);
window.addEventListener('resize', drawChart);
requestAnimationFrame(frame);
