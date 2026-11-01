'use strict';
/* Live perpetual-futures market data from Hyperliquid's public API (no key needed).
   REST for candle history and market stats; one WebSocket for prices, candles, the book and trades. */
window.Clipps = window.Clipps || {};

(function (C) {
  const REST = 'https://api.hyperliquid.xyz/info';
  const WS_URL = 'wss://api.hyperliquid.xyz/ws';
  const INTERVALS = { 60000: '1m', 300000: '5m', 900000: '15m' };
  const HISTORY = 300;          // candles loaded per market and interval
  const CTX_POLL_MS = 15000;    // 24h change, funding, open interest, volume
  const STALE_MS = 20000;       // no message for this long → reconnect

  const post = (body) => fetch(REST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

  C.INTERVALS = INTERVALS;

  C.createFeed = function (coins) {
    const listeners = {};
    const emit = (type, payload) => (listeners[type] || []).forEach((fn) => fn(payload));
    const info = new Map(coins.map((c) => [c, { coin: c, price: null, prevDay: null, funding: null, oi: null, vol: null }]));
    const candleCache = new Map();   // `${coin}|${tfMs}` → [{ t, o, h, l, c, v }]
    const books = new Map();
    const trades = new Map(coins.map((c) => [c, []]));
    const want = new Map();          // active subscriptions, keyed by JSON
    let status = 'connecting';
    let ws = null, retry = 0, pingTimer = null, lastMsg = 0;

    function setStatus(s) {
      if (status === s) return;
      status = s;
      emit('status', s);
    }

    async function pollCtx() {
      try {
        const [meta, ctxs] = await post({ type: 'metaAndAssetCtxs' });
        meta.universe.forEach((a, i) => {
          const m = info.get(a.name);
          if (!m) return;
          const c = ctxs[i];
          const mark = Number(c.markPx);
          if (m.price == null) m.price = Number(c.midPx || c.markPx);
          m.prevDay = Number(c.prevDayPx);
          m.funding = Number(c.funding);
          m.oi = Number(c.openInterest) * mark;
          m.vol = Number(c.dayNtlVlm);
        });
        emit('prices');
      } catch (e) {
        if (status !== 'live') setStatus('offline');
      }
    }

    function toCandle(r) { return { t: r.t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v }; }

    async function loadCandles(coin, tf) {
      const end = Date.now();
      const rows = await post({ type: 'candleSnapshot', req: { coin, interval: INTERVALS[tf], startTime: end - HISTORY * tf, endTime: end } });
      candleCache.set(`${coin}|${tf}`, rows.map(toCandle));
      emit('candles', { coin, tf });
    }

    function onCandle(d) {
      const tf = Number(Object.keys(INTERVALS).find((k) => INTERVALS[k] === d.i));
      const arr = candleCache.get(`${d.s}|${tf}`);
      const m = info.get(d.s);
      if (m) m.price = Number(d.c);
      if (!arr) return;
      const c = toCandle(d);
      const last = arr[arr.length - 1];
      if (last && last.t === c.t) arr[arr.length - 1] = c;
      else if (!last || c.t > last.t) {
        arr.push(c);
        if (arr.length > HISTORY * 2) arr.shift();
      }
      emit('candles', { coin: d.s, tf });
    }

    function handle(m) {
      lastMsg = Date.now();
      if (m.channel === 'allMids') {
        for (const [coin, p] of Object.entries(m.data.mids)) {
          const x = info.get(coin);
          if (x) x.price = Number(p);
        }
        setStatus('live');
        emit('prices');
      } else if (m.channel === 'l2Book') {
        const [bids, asks] = m.data.levels;
        const lv = (l) => ({ p: Number(l.px), s: Number(l.sz) });
        books.set(m.data.coin, { bids: bids.map(lv), asks: asks.map(lv), t: m.data.time });
        setStatus('live');
        emit('book', m.data.coin);
      } else if (m.channel === 'trades' && m.data.length) {
        const coin = m.data[0].coin;
        const arr = trades.get(coin);
        if (!arr) return;
        for (const t of m.data) arr.unshift({ t: t.time, side: t.side === 'B' ? 'BUY' : 'SELL', px: Number(t.px), qty: Number(t.sz) });
        if (arr.length > 40) arr.length = 40;
        setStatus('live');
        emit('trades', coin);
      } else if (m.channel === 'candle') {
        setStatus('live');
        onCandle(m.data);
      }
    }

    const send = (method, subscription) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ method, subscription })); };

    function connect() {
      setStatus(retry ? 'reconnecting' : 'connecting');
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        retry = 0;
        lastMsg = Date.now();
        for (const s of want.values()) send('subscribe', s);
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws.readyState === 1) ws.send('{"method":"ping"}');
          if (Date.now() - lastMsg > STALE_MS) ws.close();
        }, 10000);
      };
      ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { /* ignore malformed frames */ } };
      ws.onclose = () => {
        clearInterval(pingTimer);
        retry++;
        setStatus(retry > 3 ? 'offline' : 'reconnecting');
        setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(retry, 4)));
      };
      ws.onerror = () => { try { ws.close(); } catch (err) { /* already closed */ } };
    }

    // Streams for one market at one candle interval (plus every coin's mid price).
    function watch(coin, tf) {
      const next = new Map([{ type: 'allMids' }, { type: 'l2Book', coin }, { type: 'trades', coin }, { type: 'candle', coin, interval: INTERVALS[tf] }]
        .map((s) => [JSON.stringify(s), s]));
      for (const [k, s] of want) if (!next.has(k)) send('unsubscribe', s);
      for (const [k, s] of next) if (!want.has(k)) send('subscribe', s);
      want.clear();
      next.forEach((s, k) => want.set(k, s));
      if (!candleCache.has(`${coin}|${tf}`)) loadCandles(coin, tf).catch(() => setTimeout(() => watch(coin, tf), 5000));
    }

    pollCtx();
    setInterval(pollCtx, CTX_POLL_MS);
    connect();

    return {
      on(type, fn) { (listeners[type] ||= []).push(fn); },
      status: () => status,
      info: (coin) => info.get(coin),
      candles: (coin, tf) => candleCache.get(`${coin}|${tf}`) || [],
      book: (coin) => books.get(coin) || null,
      trades: (coin) => trades.get(coin) || [],
      watch,
    };
  };
})(window.Clipps);
