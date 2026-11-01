'use strict';
/* Clipps demo simulation.
   Example markets, demo agents and paper fills — all generated in the browser.
   Nothing here connects to a real market or sends an order anywhere. */
window.Clipps = window.Clipps || {};

(function (C) {
  const TICK_MS = 500;
  const BASE_MS = 5000;            // base candle interval: 5s
  const HISTORY = 720;             // one hour of 5s candles
  const MAX_CANDLES = 1440;
  const VOL = 0.45;                // scales each market's per-tick volatility
  const SLIPPAGE = 0.0003;         // market orders fill 3 bps through the mark
  const BOOK_STEP = 0.00022;       // distance between book levels, as a fraction of price
  const BOOK_LEVELS = 11;
  const MAX_NOTIONAL = 5000000;    // paper order cap, in USD
  const AGENT_RATE = 0.3;          // chance per tick that some agent trades

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sign = () => (Math.random() < 0.5 ? -1 : 1);
  function gauss() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const MARKETS = [
    { s: 'CLIP-PERP', unit: 'CLIP', p: 3.142, v: 0.0022, dp: 4, group: 'Perpetuals' },
    { s: 'BTC-PERP', unit: 'BTC', p: 118420, v: 0.0011, dp: 1, group: 'Perpetuals' },
    { s: 'ETH-PERP', unit: 'ETH', p: 4630, v: 0.0015, dp: 2, group: 'Perpetuals' },
    { s: 'SOL-PERP', unit: 'SOL', p: 242.5, v: 0.002, dp: 3, group: 'Perpetuals' },
    { s: 'NVDA', unit: 'shares', p: 212.4, v: 0.0012, dp: 2, group: 'Equities' },
    { s: 'TSLA', unit: 'shares', p: 438.9, v: 0.0018, dp: 2, group: 'Equities' },
  ];

  const AGENTS = [
    { id: 'ORION-7', strat: 'Momentum breakout', universe: 'Perpetuals',
      why: () => `Breakout ${rand(1.2, 3.4).toFixed(1)} std devs above the 30s range` },
    { id: 'VEGA-3', strat: 'Stat-arb pairs', universe: 'Perpetuals',
      why: () => `Spread z-score ${(rand(1.9, 3.2) * sign()).toFixed(2)} vs basket` },
    { id: 'LYRA-12', strat: 'Funding basis', universe: 'Perpetuals',
      why: () => `Funding ${rand(-0.04, 0.06).toFixed(3)}% — basis capture` },
    { id: 'ATLAS-1', strat: 'Macro regime', universe: 'All example markets',
      why: () => `Regime-shift probability ${rand(0.62, 0.94).toFixed(2)}` },
    { id: 'NOVA-9', strat: 'Liquidity provision', universe: 'CLIP-PERP',
      why: () => `Quote refresh, inventory skew ${rand(-0.4, 0.4).toFixed(2)}` },
    { id: 'KEPLER-4', strat: 'Volatility carry', universe: 'Equities',
      why: () => `Implied/realised volatility ${rand(1.05, 1.6).toFixed(2)}` },
    { id: 'HELIX-2', strat: 'Event embeddings', universe: 'Equities',
      why: () => `News-vector shift ${rand(0.2, 0.9).toFixed(2)} (${pick(['earnings', 'filing', 'policy'])})` },
    { id: 'RIGEL-5', strat: 'Mean reversion', universe: 'All example markets',
      why: () => `${rand(0.3, 1.4).toFixed(2)}% from VWAP — fading the move` },
  ];

  function createSim({ warmup = 40, narrate = false } = {}) {
    const listeners = {};
    const emit = (type, payload) => (listeners[type] || []).forEach((fn) => fn(payload));

    let simNow = Date.now() - warmup * TICK_MS;   // simulation clock; stops while paused
    let timer = null;
    let seq = 0, orderSeq = 0;

    const markets = MARKETS.map((def) => seedMarket(def, simNow));
    const bySym = new Map(markets.map((m) => [m.s, m]));
    const agents = AGENTS.map((a) => ({ ...a, status: 'Scanning', paused: false, busyUntil: 0, fills: 0, conf: rand(0.45, 0.9) }));
    const byId = new Map(agents.map((a) => [a.id, a]));
    const positions = new Map();   // `${owner}|${sym}` → { owner, m, qty, avg, realized, openedAt }
    const orders = [];             // newest first
    const events = [];             // oldest first
    const fillTimes = [];

    function seedMarket(def, now) {
      const m = { ...def, price: def.p, candles: [], prints: [], bookA: [], bookB: [] };
      const t0 = Math.floor(now / BASE_MS) * BASE_MS - HISTORY * BASE_MS;
      let p = def.p * rand(0.97, 1.0);
      for (let i = 0; i < HISTORY; i++) {
        const o = p;
        let h = p, l = p;
        for (let k = 0; k < BASE_MS / TICK_MS; k++) {
          p *= Math.exp(def.v * VOL * gauss());
          h = Math.max(h, p); l = Math.min(l, p);
        }
        m.candles.push({ t: t0 + i * BASE_MS, o, h, l, c: p, v: rand(20, 100) });
      }
      m.price = p;
      m.candles.push({ t: t0 + HISTORY * BASE_MS, o: p, h: p, l: p, c: p, v: 0 });
      updateBook(m);
      return m;
    }

    function updateBook(m) {
      const base = 40000 / m.price;
      for (let i = 0; i < BOOK_LEVELS; i++) {
        const a = m.bookA[i] ?? base * rand(0.4, 1.6) * (1 + i * 0.18);
        const b = m.bookB[i] ?? base * rand(0.4, 1.6) * (1 + i * 0.18);
        m.bookA[i] = clamp(a * (1 + 0.15 * gauss()), base * 0.15, base * 4);
        m.bookB[i] = clamp(b * (1 + 0.15 * gauss()), base * 0.15, base * 4);
      }
    }

    function pushPrint(m, side, qty, px, owner) {
      m.prints.unshift({ t: simNow, side, qty, px, owner });
      if (m.prints.length > 40) m.prints.length = 40;
    }

    function addEvent(e) {
      e.id = ++seq;
      e.t = simNow;
      events.push(e);
      if (events.length > 500) events.shift();
      emit('event', e);
      return e;
    }

    function applyPosition(owner, m, side, qty, px) {
      const s = side === 'BUY' ? 1 : -1;
      const key = `${owner}|${m.s}`;
      const p = positions.get(key) || { owner, m, qty: 0, avg: 0, realized: 0, openedAt: simNow };
      if (p.qty === 0) p.openedAt = simNow;
      if (p.qty === 0 || Math.sign(p.qty) === s) {
        p.avg = (p.avg * Math.abs(p.qty) + px * qty) / (Math.abs(p.qty) + qty);
        p.qty += s * qty;
      } else {
        const closing = Math.min(Math.abs(p.qty), qty);
        p.realized += (px - p.avg) * closing * Math.sign(p.qty);
        p.qty += s * qty;
        if (Math.abs(p.qty) * px < 1) p.qty = 0;
        else if (Math.sign(p.qty) === s) { p.avg = px; p.openedAt = simNow; }
      }
      positions.set(key, p);
    }

    function fill(owner, m, side, qty, px, why) {
      applyPosition(owner, m, side, qty, px);
      pushPrint(m, side, qty, px, owner);
      fillTimes.push(simNow);
      const a = byId.get(owner);
      if (a) a.fills++;
      const ev = addEvent({ who: owner, action: side === 'BUY' ? 'Paper buy' : 'Paper sell', side, market: m.s, qty, px, dp: m.dp, state: 'Simulated fill', why });
      emit('fill', ev);
      return ev;
    }

    const expectedFill = (m, side) => m.price * (1 + (side === 'BUY' ? 1 : -1) * SLIPPAGE);

    function marketsFor(a) {
      if (a.universe === 'All example markets') return markets;
      if (bySym.has(a.universe)) return [bySym.get(a.universe)];
      return markets.filter((m) => m.group === a.universe);
    }

    function agentsAct() {
      let changed = false;
      for (const a of agents) {
        a.conf = clamp(a.conf + gauss() * 0.03, 0.2, 0.98);
        if (!a.paused && a.status !== 'Scanning' && simNow >= a.busyUntil) { a.status = 'Scanning'; changed = true; }
      }
      const live = agents.filter((a) => !a.paused);
      if (live.length && Math.random() < AGENT_RATE) {
        const reviewing = live.filter((x) => x.status === 'Reviewing');
        const a = reviewing.length && Math.random() < 0.6 ? pick(reviewing) : pick(live);
        const pool = marketsFor(a);
        const m = pool.includes(bySym.get('CLIP-PERP')) && Math.random() < 0.4 ? bySym.get('CLIP-PERP') : pick(pool);
        const pos = positions.get(`${a.id}|${m.s}`);
        let side, qty;
        if (pos && pos.qty !== 0 && Math.random() < 0.4) {
          side = pos.qty > 0 ? 'SELL' : 'BUY';
          qty = Math.abs(pos.qty) * rand(0.3, 1);
          a.status = 'Hedging';
        } else {
          side = Math.random() < 0.5 + (a.conf - 0.5) * 0.3 ? 'BUY' : 'SELL';
          qty = rand(4000, 45000) / m.price;
          a.status = 'Executing';
        }
        a.busyUntil = simNow + rand(1500, 4000);
        fill(a.id, m, side, qty, expectedFill(m, side), a.why());
        changed = true;
      }
      if (changed) emit('agents');
    }

    function checkResting() {
      let changed = false;
      for (const o of orders) {
        if (o.state !== 'Resting') continue;
        const hit = o.side === 'BUY' ? o.m.price <= o.px : o.m.price >= o.px;
        if (!hit) continue;
        o.state = 'Filled';
        o.closedAt = simNow;
        fill(o.owner, o.m, o.side, o.qty, o.px, 'Resting limit reached');
        emit('limitFilled', o);
        changed = true;
      }
      if (changed) emit('orders');
    }

    // Optional narration (used by the homepage preview): agents also log scans,
    // flagged signals and watchlist changes, and review a signal before trading on it.
    function startReview(a) {
      a.status = 'Reviewing';
      a.busyUntil = simNow + rand(2500, 5000);
      addEvent({ who: a.id, kind: 'note', note: 'review', text: `flagged a signal on ${pick(marketsFor(a)).s}`, state: '—' });
    }
    function narrateAct() {
      if (Math.random() > 0.22) return;
      const idle = agents.filter((a) => !a.paused && a.status === 'Scanning');
      if (!idle.length) return;
      const a = pick(idle);
      const r = Math.random();
      if (r < 0.4) addEvent({ who: a.id, kind: 'note', note: 'scan', text: `scanned ${2 + Math.floor(Math.random() * 5)} opportunities`, state: '—' });
      else if (r < 0.75) startReview(a);
      else addEvent({ who: a.id, kind: 'note', note: 'watch', text: `added ${pick(marketsFor(a)).s} to watchlist`, state: '—' });
      emit('agents');
    }

    function tick() {
      simNow += TICK_MS;
      for (const m of markets) {
        let c = m.candles[m.candles.length - 1];
        if (simNow >= c.t + BASE_MS) {
          c = { t: c.t + BASE_MS, o: m.price, h: m.price, l: m.price, c: m.price, v: 0 };
          m.candles.push(c);
          if (m.candles.length > MAX_CANDLES) m.candles.shift();
        }
        m.price *= Math.exp(m.v * VOL * gauss());
        c.c = m.price;
        c.h = Math.max(c.h, m.price);
        c.l = Math.min(c.l, m.price);
        c.v += rand(1, 10);
        updateBook(m);
        const n = Math.random() < 0.6 ? 1 : 2;
        for (let i = 0; i < n; i++) {
          pushPrint(m, Math.random() < 0.5 ? 'BUY' : 'SELL', rand(500, 15000) / m.price, m.price * (1 + gauss() * 0.0002), null);
        }
      }
      while (fillTimes.length && simNow - fillTimes[0] > 60000) fillTimes.shift();
      agentsAct();
      if (narrate) narrateAct();
      checkResting();
      emit('tick');
    }

    function validateOrder({ owner, sym, side, type, qty, px }) {
      const m = bySym.get(sym);
      const errors = {};
      if (!m) errors.market = 'Choose a market.';
      if (side !== 'BUY' && side !== 'SELL') errors.side = 'Choose buy or sell.';
      if (!(Number.isFinite(qty) && qty > 0)) errors.qty = 'Enter a size greater than 0.';
      if (type === 'LIMIT' && !(Number.isFinite(px) && px > 0)) errors.px = 'Enter a limit price greater than 0.';
      if (m && !errors.qty) {
        const ref = type === 'LIMIT' && px > 0 ? px : m.price;
        if (qty * ref > MAX_NOTIONAL) errors.qty = 'Paper orders are capped at $5,000,000 notional in this demo.';
      }
      const a = byId.get(owner);
      if (owner !== 'OPERATOR' && !a) errors.owner = 'Choose who the order is for.';
      if (a && a.paused) errors.owner = `${a.id} is paused. Resume it, or place the order yourself.`;
      return Object.keys(errors).length ? errors : null;
    }

    function placeOrder(o) {
      const errors = validateOrder(o);
      if (errors) return { ok: false, errors };
      const m = bySym.get(o.sym);
      const how = o.owner === 'OPERATOR' ? 'manual' : 'delegated by operator';
      if (o.type === 'MARKET') {
        const px = expectedFill(m, o.side);
        const ev = fill(o.owner, m, o.side, o.qty, px, `Market order · ${how}`);
        return { ok: true, kind: 'filled', px, ev };
      }
      const order = { id: ++orderSeq, owner: o.owner, m, sym: m.s, side: o.side, qty: o.qty, px: o.px, placedAt: simNow, state: 'Resting' };
      orders.unshift(order);
      if (orders.length > 60) orders.length = 60;
      addEvent({ who: o.owner, action: o.side === 'BUY' ? 'Limit buy' : 'Limit sell', side: o.side, market: m.s, qty: o.qty, px: o.px, dp: m.dp, state: 'Resting', why: `Limit order · ${how}` });
      emit('orders');
      return { ok: true, kind: 'resting', order };
    }

    function cancelOrder(id) {
      const o = orders.find((x) => x.id === id);
      if (!o || o.state !== 'Resting') return false;
      o.state = 'Cancelled';
      o.closedAt = simNow;
      addEvent({ who: 'OPERATOR', action: 'Cancelled order', side: o.side, market: o.sym, qty: o.qty, px: o.px, dp: o.m.dp, state: 'Cancelled', why: `${o.side === 'BUY' ? 'Limit buy' : 'Limit sell'} #${o.id}` });
      emit('orders');
      return true;
    }

    function setAgentPaused(id, paused) {
      const a = byId.get(id);
      if (!a || a.paused === paused) return;
      a.paused = paused;
      a.status = paused ? 'Paused' : 'Scanning';
      addEvent({ who: 'OPERATOR', action: paused ? 'Paused agent' : 'Resumed agent', target: id, state: '—', why: a.strat });
      emit('agents');
    }

    function candles(m, tfMs) {
      if (tfMs <= BASE_MS) return m.candles;
      const out = [];
      let cur = null;
      for (const c of m.candles) {
        const b = Math.floor(c.t / tfMs) * tfMs;
        if (!cur || cur.t !== b) { cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }; out.push(cur); }
        else { cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; cur.v += c.v; }
      }
      return out;
    }

    function book(m, levels = BOOK_LEVELS) {
      const step = m.price * BOOK_STEP;
      const asks = [], bids = [];
      for (let i = 0; i < levels; i++) {
        asks.push({ p: m.price + step * (i + 0.5), s: m.bookA[i] });
        bids.push({ p: m.price - step * (i + 0.5), s: m.bookB[i] });
      }
      return { asks, bids, step };
    }

    function change1h(m) {
      const ref = m.candles[Math.max(0, m.candles.length - 1 - HISTORY)];
      return m.price / ref.o - 1;
    }

    function ownerPnl(owner) {
      let t = 0;
      for (const p of positions.values()) if (p.owner === owner) t += p.realized + p.qty * (p.m.price - p.avg);
      return t;
    }

    function openPositions() {
      return [...positions.values()].filter((p) => p.qty !== 0).sort((a, b) => b.openedAt - a.openedAt);
    }

    for (let i = 0; i < warmup; i++) tick();

    return {
      markets, agents, orders, events,
      market: (sym) => bySym.get(sym),
      agent: (id) => byId.get(id),
      on(type, fn) { (listeners[type] ||= []).push(fn); },
      start() { if (!timer) { timer = setInterval(tick, TICK_MS); emit('state'); } },
      pause() { if (timer) { clearInterval(timer); timer = null; emit('state'); } },
      isRunning: () => timer !== null,
      now: () => simNow,
      fillsPerMinute: () => fillTimes.length,
      review(id) {
        const a = byId.get(id);
        if (a && !a.paused) { startReview(a); emit('agents'); }
      },
      validateOrder, placeOrder, cancelOrder, setAgentPaused, expectedFill,
      candles, book, change1h, ownerPnl, openPositions,
    };
  }

  C.createSim = createSim;
  C.SIM = { TICK_MS, BASE_MS, SLIPPAGE, MAX_NOTIONAL };
})(window.Clipps);
