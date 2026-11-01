'use strict';
/* Clipps paper-trading engine.
   Market data is live (feed.js, from Hyperliquid). The agents are demo agents: they react to
   live prices with randomised paper trades. Paper fills use live prices; no order ever leaves
   the browser. */
window.Clipps = window.Clipps || {};

(function (C) {
  const TICK_MS = 500;
  const SLIPPAGE = 0.0003;          // paper market orders fill 3 bps through the live mark
  const MAX_NOTIONAL = 5000000;     // paper order cap, in USD
  const AGENT_RATE = 0.3;           // chance per tick that some agent trades

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sign = () => (Math.random() < 0.5 ? -1 : 1);
  const dpFor = (p) => (p >= 1000 ? 1 : p >= 100 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : 5);
  function gauss() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const MARKETS = [
    { s: 'BTC-PERP', coin: 'BTC', name: 'Bitcoin' },
    { s: 'ETH-PERP', coin: 'ETH', name: 'Ether' },
    { s: 'SOL-PERP', coin: 'SOL', name: 'Solana' },
    { s: 'HYPE-PERP', coin: 'HYPE', name: 'Hyperliquid' },
    { s: 'XRP-PERP', coin: 'XRP', name: 'XRP' },
    { s: 'DOGE-PERP', coin: 'DOGE', name: 'Dogecoin' },
  ];

  const AGENTS = [
    { id: 'ORION-7', strat: 'Momentum breakout', coins: ['BTC', 'ETH', 'SOL'],
      why: () => `Breakout ${rand(1.2, 3.4).toFixed(1)} std devs above the recent range` },
    { id: 'VEGA-3', strat: 'Stat-arb pairs', coins: ['BTC', 'ETH'],
      why: () => `Spread z-score ${(rand(1.9, 3.2) * sign()).toFixed(2)} vs pair` },
    { id: 'LYRA-12', strat: 'Funding basis', coins: ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE'],
      why: (m, f) => `Live funding ${f && f.funding != null ? (f.funding * 100).toFixed(4) : '—'}%/h — basis capture` },
    { id: 'ATLAS-1', strat: 'Macro regime', coins: ['BTC', 'ETH'],
      why: () => `Regime-shift probability ${rand(0.62, 0.94).toFixed(2)}` },
    { id: 'NOVA-9', strat: 'Liquidity provision', coins: ['HYPE'],
      why: () => `Quote refresh, inventory skew ${rand(-0.4, 0.4).toFixed(2)}` },
    { id: 'KEPLER-4', strat: 'Volatility carry', coins: ['SOL', 'HYPE'],
      why: () => `Implied/realised volatility ${rand(1.05, 1.6).toFixed(2)}` },
    { id: 'HELIX-2', strat: 'Event embeddings', coins: ['XRP', 'DOGE', 'SOL'],
      why: () => `News-vector shift ${rand(0.2, 0.9).toFixed(2)} (${pick(['listing', 'governance', 'macro'])})` },
    { id: 'RIGEL-5', strat: 'Mean reversion', coins: ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE'],
      why: (m, f) => (f && f.prevDay ? `${((m.price / f.prevDay - 1) * 100).toFixed(2)}% on the day — fading the move` : 'Fading the move') },
  ];
  const universeLabel = (coins) => (coins.length === MARKETS.length ? 'All listed perps' : coins.map((c) => `${c}-PERP`).join(', '));

  function createSim({ feed, narrate = false } = {}) {
    feed = feed || C.createFeed(MARKETS.map((m) => m.coin));
    const listeners = {};
    const emit = (type, payload) => (listeners[type] || []).forEach((fn) => fn(payload));
    const now = () => Date.now();
    let timer = null;
    let seq = 0, orderSeq = 0;

    const markets = MARKETS.map((def) => ({
      ...def,
      unit: def.coin,
      get price() { return feed.info(def.coin).price; },
      get dp() { const p = feed.info(def.coin).price; return p ? dpFor(p) : 2; },
      get prints() { return feed.trades(def.coin); },
    }));
    const bySym = new Map(markets.map((m) => [m.s, m]));
    const byCoin = new Map(markets.map((m) => [m.coin, m]));
    const agents = AGENTS.map((a) => ({ ...a, universe: universeLabel(a.coins), status: 'Scanning', paused: false, busyUntil: 0, fills: 0, conf: rand(0.45, 0.9) }));
    const byId = new Map(agents.map((a) => [a.id, a]));
    const positions = new Map();   // `${owner}|${sym}` → { owner, m, qty, avg, realized, openedAt }
    const orders = [];             // newest first
    const events = [];             // oldest first
    const fillTimes = [];

    const priced = (m) => Number.isFinite(m.price) && m.price > 0;

    function addEvent(e) {
      e.id = ++seq;
      e.t = now();
      events.push(e);
      if (events.length > 500) events.shift();
      emit('event', e);
      return e;
    }

    function applyPosition(owner, m, side, qty, px) {
      const s = side === 'BUY' ? 1 : -1;
      const key = `${owner}|${m.s}`;
      const p = positions.get(key) || { owner, m, qty: 0, avg: 0, realized: 0, openedAt: now() };
      if (p.qty === 0) p.openedAt = now();
      if (p.qty === 0 || Math.sign(p.qty) === s) {
        p.avg = (p.avg * Math.abs(p.qty) + px * qty) / (Math.abs(p.qty) + qty);
        p.qty += s * qty;
      } else {
        const closing = Math.min(Math.abs(p.qty), qty);
        p.realized += (px - p.avg) * closing * Math.sign(p.qty);
        p.qty += s * qty;
        if (Math.abs(p.qty) * px < 1) p.qty = 0;
        else if (Math.sign(p.qty) === s) { p.avg = px; p.openedAt = now(); }
      }
      positions.set(key, p);
    }

    function fill(owner, m, side, qty, px, why) {
      applyPosition(owner, m, side, qty, px);
      fillTimes.push(now());
      const a = byId.get(owner);
      if (a) a.fills++;
      const ev = addEvent({ who: owner, action: side === 'BUY' ? 'Paper buy' : 'Paper sell', side, market: m.s, qty, px, dp: m.dp, state: 'Paper fill', why });
      emit('fill', ev);
      return ev;
    }

    const expectedFill = (m, side) => m.price * (1 + (side === 'BUY' ? 1 : -1) * SLIPPAGE);
    const marketsFor = (a) => a.coins.map((c) => byCoin.get(c)).filter(priced);

    function agentsAct() {
      let changed = false;
      for (const a of agents) {
        a.conf = clamp(a.conf + gauss() * 0.03, 0.2, 0.98);
        if (!a.paused && a.status !== 'Scanning' && now() >= a.busyUntil) { a.status = 'Scanning'; changed = true; }
      }
      const live = agents.filter((a) => !a.paused && marketsFor(a).length);
      if (live.length && Math.random() < AGENT_RATE) {
        const reviewing = live.filter((x) => x.status === 'Reviewing');
        const a = reviewing.length && Math.random() < 0.6 ? pick(reviewing) : pick(live);
        const m = pick(marketsFor(a));
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
        a.busyUntil = now() + rand(1500, 4000);
        fill(a.id, m, side, qty, expectedFill(m, side), a.why(m, feed.info(m.coin)));
        changed = true;
      }
      if (changed) emit('agents');
    }

    // Optional narration (used by the homepage preview): agents also log scans,
    // flagged signals and watchlist changes, and review a signal before trading on it.
    function startReview(a) {
      const pool = marketsFor(a);
      if (!pool.length) return;
      a.status = 'Reviewing';
      a.busyUntil = now() + rand(2500, 5000);
      addEvent({ who: a.id, kind: 'note', note: 'review', text: `flagged a signal on ${pick(pool).s}`, state: '—' });
    }
    function narrateAct() {
      if (Math.random() > 0.22) return;
      const idle = agents.filter((a) => !a.paused && a.status === 'Scanning' && marketsFor(a).length);
      if (!idle.length) return;
      const a = pick(idle);
      const r = Math.random();
      if (r < 0.4) addEvent({ who: a.id, kind: 'note', note: 'scan', text: `scanned ${2 + Math.floor(Math.random() * 5)} opportunities`, state: '—' });
      else if (r < 0.75) startReview(a);
      else addEvent({ who: a.id, kind: 'note', note: 'watch', text: `added ${pick(marketsFor(a)).s} to watchlist`, state: '—' });
      emit('agents');
    }

    function checkResting() {
      let changed = false;
      for (const o of orders) {
        if (o.state !== 'Resting' || !priced(o.m)) continue;
        const hit = o.side === 'BUY' ? o.m.price <= o.px : o.m.price >= o.px;
        if (!hit) continue;
        o.state = 'Filled';
        o.closedAt = now();
        fill(o.owner, o.m, o.side, o.qty, o.px, 'Resting limit reached at the live price');
        emit('limitFilled', o);
        changed = true;
      }
      if (changed) emit('orders');
    }

    function tick() {
      while (fillTimes.length && now() - fillTimes[0] > 60000) fillTimes.shift();
      if (timer) {
        agentsAct();
        if (narrate) narrateAct();
      }
      checkResting();
      emit('tick');
    }
    setInterval(tick, TICK_MS);   // drives rendering and resting orders; agents act only while running

    function validateOrder({ owner, sym, side, type, qty, px }) {
      const m = bySym.get(sym);
      const errors = {};
      if (!m) errors.market = 'Choose a market.';
      else if (!priced(m)) errors.market = 'Waiting for the live price…';
      if (side !== 'BUY' && side !== 'SELL') errors.side = 'Choose buy or sell.';
      if (!(Number.isFinite(qty) && qty > 0)) errors.qty = 'Enter a size greater than 0.';
      if (type === 'LIMIT' && !(Number.isFinite(px) && px > 0)) errors.px = 'Enter a limit price greater than 0.';
      if (m && priced(m) && !errors.qty) {
        const ref = type === 'LIMIT' && px > 0 ? px : m.price;
        if (qty * ref > MAX_NOTIONAL) errors.qty = 'Paper orders are capped at $5,000,000 notional.';
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
      const order = { id: ++orderSeq, owner: o.owner, m, sym: m.s, side: o.side, qty: o.qty, px: o.px, placedAt: now(), state: 'Resting' };
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
      o.closedAt = now();
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

    function book(m, levels = 11) {
      const b = feed.book(m.coin);
      if (!b || !b.asks.length || !b.bids.length) return null;
      return { asks: b.asks.slice(0, levels), bids: b.bids.slice(0, levels), step: b.asks[0].p - b.bids[0].p };
    }

    function change24h(m) {
      const f = feed.info(m.coin);
      return priced(m) && f.prevDay ? m.price / f.prevDay - 1 : null;
    }

    function ownerPnl(owner) {
      let t = 0;
      for (const p of positions.values()) if (p.owner === owner) t += p.realized + p.qty * (p.m.price - p.avg);
      return t;
    }

    function openPositions() {
      return [...positions.values()].filter((p) => p.qty !== 0).sort((a, b) => b.openedAt - a.openedAt);
    }

    return {
      feed, markets, agents, orders, events,
      market: (sym) => bySym.get(sym),
      agent: (id) => byId.get(id),
      on(type, fn) { (listeners[type] ||= []).push(fn); },
      start() { if (!timer) { timer = true; emit('state'); } },
      pause() { if (timer) { timer = null; emit('state'); } },
      isRunning: () => timer !== null,
      fillsPerMinute: () => fillTimes.length,
      review(id) {
        const a = byId.get(id);
        if (a && !a.paused) { startReview(a); emit('agents'); }
      },
      validateOrder, placeOrder, cancelOrder, setAgentPaused, expectedFill,
      candles: (m, tf) => feed.candles(m.coin, tf),
      stats: (m) => feed.info(m.coin),
      book, change24h, ownerPnl, openPositions, priced,
    };
  }

  C.createSim = createSim;
  C.SIM = { TICK_MS, SLIPPAGE, MAX_NOTIONAL };
})(window.Clipps);
