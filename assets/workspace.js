'use strict';
/* Clipps demo workspace: live Hyperliquid market data (feed.js) with demo agents trading on paper (sim.js). */
(function (C) {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
  const isShown = (el) => el.getClientRects().length > 0;
  const ownerName = (o) => (o === 'OPERATOR' ? 'Operator' : o);
  const phone = window.matchMedia('(max-width: 760px)');

  const sim = C.createSim();
  const params = new URLSearchParams(location.search);
  const state = {
    sym: 'BTC-PERP',
    tf: 60000,
    needsDefaults: true,
    agent: sim.agent(params.get('agent')) ? params.get('agent') : 'ORION-7',
    inspectT: null,
    side: 'BUY',
    type: 'MARKET',
    touched: { qty: false, px: false },
    view: 'overview',
    sheetOpen: false,
    lastOrderId: null,
  };
  const market = () => sim.market(state.sym);
  const grid = $('#workspace');

  /* ── Tabs (ARIA tabs pattern with arrow-key support) ── */
  function setupTabs(tablist, onChange) {
    const tabs = $$('[role="tab"]', tablist);
    function select(tab, focus = false) {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        $('#' + t.getAttribute('aria-controls')).hidden = !on;
      }
      if (focus) tab.focus();
      if (onChange) onChange(tab);
    }
    tablist.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) select(t); });
    tablist.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const j = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
      if (j === undefined) return;
      e.preventDefault();
      select(tabs[j], true);
    });
    return { select: (id) => select(tabs.find((t) => t.id === id)) };
  }

  /* ── Market bar ── */
  const mkSelect = $('#mkSelect');
  const tfSelect = $('#tfSelect');
  const tkMarket = $('#tkMarket');
  const marketOptions = `<optgroup label="Hyperliquid perpetuals">${sim.markets.map((m) => `<option value="${m.s}">${m.s}</option>`).join('')}</optgroup>`;
  mkSelect.innerHTML = marketOptions;
  tkMarket.innerHTML = marketOptions;

  function defaultQty(m) {
    if (!sim.priced(m)) return '';
    const q = 5000 / m.price;
    const mag = Math.pow(10, Math.floor(Math.log10(q)) - 1);
    return String(+(Math.round(q / mag) * mag).toPrecision(6));
  }

  function setMarket(sym) {
    if (!sim.market(sym)) return;
    const m = sim.market(sym);
    state.sym = sym;
    state.inspectT = null;
    state.touched = { qty: false, px: false };
    mkSelect.value = sym;
    tkMarket.value = sym;
    setText($('#chartSym'), sym);
    setText($('#tkUnit'), m.unit);
    state.needsDefaults = true;
    applyDefaults();
    sim.feed.watch(m.coin, state.tf);
    chart.setAttribute('aria-label', `Candlestick chart of live ${sym} prices`);
    renderQuote();
    drawChart();
    renderBook();
    renderTrades();
    validateTicket();
  }
  mkSelect.addEventListener('change', () => setMarket(mkSelect.value));
  tkMarket.addEventListener('change', () => setMarket(tkMarket.value));
  tfSelect.addEventListener('change', () => {
    state.tf = Number(tfSelect.value);
    state.inspectT = null;
    sim.feed.watch(market().coin, state.tf);
    drawChart();
  });

  // Size and limit defaults need a live price, so they fill in once it arrives.
  function applyDefaults() {
    const m = market();
    if (!state.needsDefaults || !sim.priced(m)) return;
    state.needsDefaults = false;
    if (!state.touched.qty) tk.qty.value = defaultQty(m);
    if (!state.touched.px) tk.px.value = m.price.toFixed(m.dp);
  }

  function renderQuote() {
    const m = market();
    const f = sim.stats(m);
    setText($('#mkPrice'), sim.priced(m) ? C.fmt(m.price, m.dp) : '—');
    const ch = sim.change24h(m);
    const el = $('#mkChg');
    setText(el, ch == null ? '' : `${ch >= 0 ? '+' : '−'}${Math.abs(ch * 100).toFixed(2)}% 24h`);
    el.className = 'mk-chg num ' + (ch == null ? '' : C.dirClass(ch));
    setText($('#mkFunding'), f.funding == null ? '—' : `${(f.funding * 100).toFixed(4)}%`);
    setText($('#mkOi'), f.oi == null ? '—' : C.fmtCompact(f.oi));
    setText($('#mkVol'), f.vol == null ? '—' : C.fmtCompact(f.vol));
  }

  const feedPill = $('#feedStatus');
  function renderFeedStatus() {
    const st = sim.feed.status();
    feedPill.dataset.state = st;
    setText($('#feedStatusText'), { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Market data unavailable' }[st]);
  }
  sim.feed.on('status', renderFeedStatus);

  /* ── Agent fleet: rows inspect; a separate labelled button pauses ── */
  const fleetList = $('#fleetList');
  fleetList.innerHTML = sim.agents.map((a) => `
    <li class="agent-row" data-id="${a.id}">
      <button type="button" class="agent-select">
        <svg class="agent-icon" aria-hidden="true"><use href="#mark" /></svg>
        <span class="agent-lines">
          <span class="agent-line"><span class="agent-name">${a.id}</span><span class="status-chip"></span></span>
          <span class="agent-line"><span class="agent-strat">${a.strat}</span><span class="agent-pnl num"><span class="visually-hidden">Paper P&amp;L </span><span class="v"></span></span></span>
        </span>
      </button>
      <button type="button" class="icon-btn agent-toggle"><svg aria-hidden="true"><use href="#i-pause" /></svg><span class="visually-hidden"></span></button>
    </li>`).join('');
  const rows = new Map($$('.agent-row', fleetList).map((li) => [li.dataset.id, {
    li,
    select: $('.agent-select', li),
    chip: $('.status-chip', li),
    pnlWrap: $('.agent-pnl', li),
    pnl: $('.agent-pnl .v', li),
    toggle: $('.agent-toggle', li),
  }]));

  fleetList.addEventListener('click', (e) => {
    const li = e.target.closest('.agent-row');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('.agent-toggle')) sim.setAgentPaused(id, !sim.agent(id).paused);
    else if (e.target.closest('.agent-select')) selectAgent(id);
  });

  function renderFleet() {
    let total = 0;
    for (const a of sim.agents) {
      const r = rows.get(a.id);
      const status = a.paused ? 'Paused' : a.status;
      const pnl = sim.ownerPnl(a.id);
      total += pnl;
      r.li.dataset.status = status;
      r.li.classList.toggle('is-selected', a.id === state.agent);
      if (a.id === state.agent) r.select.setAttribute('aria-current', 'true');
      else r.select.removeAttribute('aria-current');
      if (r.chip.dataset.status !== status) { r.chip.dataset.status = status; r.chip.textContent = status; }
      setText(r.pnl, C.fmtUsd(pnl));
      r.pnlWrap.className = 'agent-pnl num ' + C.dirClass(pnl);
      const label = `${a.paused ? 'Resume' : 'Pause'} ${a.id}`;
      if (r.toggle.title !== label) {
        r.toggle.title = label;
        r.toggle.lastElementChild.textContent = label;
        $('use', r.toggle).setAttribute('href', a.paused ? '#i-play' : '#i-pause');
      }
    }
    const f = $('#fleetPnl');
    setText(f, C.fmtUsd(total));
    f.className = 'num ' + C.dirClass(total);
  }

  /* ── Inspector ── */
  const insp = {
    el: $('#inspector'), name: $('#inspName'), strat: $('#inspStrat'), status: $('#inspStatus'),
    universe: $('#inspUniverse'), conf: $('#inspConf'), bar: $('#inspConfBar'), pnl: $('#inspPnl'),
    fills: $('#inspFills'), recent: $('#inspRecent'), toggle: $('#inspToggle'), delegate: $('#inspDelegate'),
    delegateId: $('#inspDelegateId'),
  };
  let recentKey = '';

  function selectAgent(id) {
    if (!sim.agent(id)) return;
    state.agent = id;
    recentKey = '';
    renderFleet();
    renderInspector();
    if (phone.matches) insp.el.scrollIntoView({ block: 'start', behavior: C.reducedMotion() ? 'auto' : 'smooth' });
  }

  function describe(e) {
    if (e.qty != null) return `${e.action} ${C.fmtQty(e.qty)} ${e.market} @ ${C.fmt(e.px, e.dp)}`;
    if (e.target) return `${ownerName(e.who)} ${e.action.toLowerCase()}`;
    return e.action;
  }

  function renderInspector() {
    const a = sim.agent(state.agent);
    const status = a.paused ? 'Paused' : a.status;
    setText(insp.name, a.id);
    setText(insp.strat, a.strat);
    setText(insp.universe, a.universe);
    setText(insp.delegateId, a.id);
    insp.el.dataset.status = status;
    if (insp.status.dataset.status !== status) { insp.status.dataset.status = status; insp.status.textContent = status; }
    setText(insp.conf, a.conf.toFixed(2));
    insp.bar.style.width = `${Math.round(a.conf * 100)}%`;
    const pnl = sim.ownerPnl(a.id);
    setText(insp.pnl, C.fmtUsd(pnl));
    insp.pnl.className = 'num ' + C.dirClass(pnl);
    setText(insp.fills, String(a.fills));
    const tl = a.paused ? 'Resume agent' : 'Pause agent';
    if (insp.toggle.lastElementChild.textContent !== tl) {
      insp.toggle.lastElementChild.textContent = tl;
      $('use', insp.toggle).setAttribute('href', a.paused ? '#i-play' : '#i-pause');
    }
    const evs = [];
    for (let i = sim.events.length - 1; i >= 0 && evs.length < 3; i--) {
      const e = sim.events[i];
      if (e.who === a.id || e.target === a.id) evs.push(e);
    }
    const key = a.id + ':' + evs.map((e) => e.id).join(',');
    if (key !== recentKey) {
      recentKey = key;
      insp.recent.innerHTML = evs.length
        ? evs.map((e) => `<li><time>${C.fmtTime(e.t)}</time><span>${C.esc(describe(e))}</span></li>`).join('')
        : '<li class="empty">No actions yet. The agent is scanning its markets.</li>';
    }
  }
  insp.toggle.addEventListener('click', () => { const a = sim.agent(state.agent); sim.setAgentPaused(a.id, !a.paused); });
  insp.delegate.addEventListener('click', () => {
    tk.owner.value = state.agent;
    validateTicket();
    openTicket();
  });

  /* ── Chart: pointer, touch and keyboard inspection ── */
  const chart = $('#chart');
  let geom = null;
  let dragging = false;

  function drawChart() {
    if (!isShown(chart)) return;
    const m = market();
    const cs = sim.candles(m, state.tf);
    $('#chartEmpty').hidden = cs.length > 0;
    geom = C.drawChart(chart, { candles: cs, dp: m.dp, tfMs: state.tf, inspectT: state.inspectT });
    if (geom && state.inspectT != null && geom.inspIdx < 0) state.inspectT = null;
    if (cs.length) renderOhlc(cs);
    else setText($('#ohlc'), '');
  }

  function renderOhlc(cs) {
    const m = market();
    let i = cs.length - 1;
    if (state.inspectT != null) {
      const k = cs.findIndex((c) => c.t === state.inspectT);
      if (k >= 0) i = k;
    }
    const c = cs[i];
    const prev = i > 0 ? cs[i - 1].c : c.o;
    const d = c.c - prev;
    const sgn = d > 0 ? '+' : d < 0 ? '−' : '';
    const f = (v) => C.fmt(v, m.dp);
    $('#ohlc').innerHTML =
      `<span class="t">${C.fmtTime(c.t)}${state.inspectT == null ? ' · latest' : ''}</span>` +
      `<span>O <b>${f(c.o)}</b></span><span>H <b>${f(c.h)}</b></span><span>L <b>${f(c.l)}</b></span><span>C <b>${f(c.c)}</b></span>` +
      `<span class="${C.dirClass(d)}">${sgn}${f(Math.abs(d))} (${sgn}${Math.abs((d / prev) * 100).toFixed(2)}%)</span>`;
  }

  function announce(c, latest) {
    const m = market();
    const f = (v) => C.fmt(v, m.dp);
    setText($('#chartLive'), `${latest ? 'Latest candle' : 'Candle'} ${C.fmtTime(c.t)}: open ${f(c.o)}, high ${f(c.h)}, low ${f(c.l)}, close ${f(c.c)}.`);
  }

  function inspectAt(e) {
    if (!geom) return;
    const x = e.clientX - chart.getBoundingClientRect().left;
    const i = Math.floor((x - geom.padL) / geom.cw);
    state.inspectT = i >= 0 && i < geom.n ? geom.cs[i].t : null;
    drawChart();
  }
  chart.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || dragging) inspectAt(e); });
  chart.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { dragging = true; inspectAt(e); } });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointercancel', () => { dragging = false; });
  chart.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { state.inspectT = null; drawChart(); } });
  chart.addEventListener('keydown', (e) => {
    if (!geom) return;
    const cs = geom.cs;
    if (e.key === 'End' || e.key === 'Escape') {
      if (state.inspectT == null && e.key === 'Escape') return;
      e.preventDefault();
      state.inspectT = null;
      drawChart();
      announce(cs[cs.length - 1], true);
      return;
    }
    let i = state.inspectT == null ? cs.length - 1 : cs.findIndex((c) => c.t === state.inspectT);
    if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
    else if (e.key === 'ArrowRight') i = Math.min(cs.length - 1, i + 1);
    else if (e.key === 'Home') i = 0;
    else return;
    e.preventDefault();
    state.inspectT = cs[i].t;
    drawChart();
    announce(cs[i], false);
  });

  /* ── Output: positions, open orders, activity ── */
  const outTabs = setupTabs($('#outTabs'));

  const posBody = $('#posBody');
  const posRows = new Map();
  function renderPositions() {
    const list = sim.openPositions().slice(0, 60);
    setText($('#posCount'), String(list.length));
    if (!list.length) {
      if (!$('.empty-row', posBody)) {
        posRows.clear();
        posBody.innerHTML = '<tr class="empty-row"><td colspan="7">No paper positions yet. Place a paper order, or wait for an agent to trade.</td></tr>';
      }
      return;
    }
    const empty = $('.empty-row', posBody);
    if (empty) empty.remove();
    const seen = new Set();
    list.forEach((p, idx) => {
      const k = `${p.owner}|${p.m.s}`;
      seen.add(k);
      let tr = posRows.get(k);
      if (!tr) {
        tr = document.createElement('tr');
        tr.innerHTML = '<td class="who"></td><td></td><td></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td>';
        posRows.set(k, tr);
      }
      const td = tr.children;
      const u = p.qty * (p.m.price - p.avg);
      setText(td[0], ownerName(p.owner));
      setText(td[1], p.m.s);
      setText(td[2], p.qty > 0 ? 'Long' : 'Short');
      td[2].className = p.qty > 0 ? 'up' : 'down';
      setText(td[3], C.fmtQty(Math.abs(p.qty)));
      setText(td[4], C.fmt(p.avg, p.m.dp));
      setText(td[5], C.fmt(p.m.price, p.m.dp));
      setText(td[6], C.fmtUsd(u));
      td[6].className = 'num ' + C.dirClass(u);
      if (posBody.children[idx] !== tr) posBody.insertBefore(tr, posBody.children[idx] || null);
    });
    for (const [k, tr] of posRows) if (!seen.has(k)) { tr.remove(); posRows.delete(k); }
  }

  const ordBody = $('#ordBody');
  function renderOrders() {
    const open = sim.orders.filter((o) => o.state === 'Resting');
    const closed = sim.orders.filter((o) => o.state !== 'Resting').slice(0, 8);
    setText($('#ordCount'), String(open.length));
    const list = [...open, ...closed];
    if (!list.length) {
      ordBody.innerHTML = '<tr class="empty-row"><td colspan="8">No paper orders yet. Choose Limit in the order ticket to place one.</td></tr>';
      return;
    }
    ordBody.innerHTML = list.map((o) => {
      const side = o.side === 'BUY' ? 'Buy' : 'Sell';
      const cancel = o.state === 'Resting'
        ? `<button type="button" class="btn btn-secondary btn-xs" data-cancel="${o.id}">Cancel<span class="visually-hidden"> limit ${side.toLowerCase()}, ${C.fmtQty(o.qty)} ${o.sym}</span></button>`
        : '';
      return `<tr><td class="who">${C.esc(ownerName(o.owner))}</td><td>${o.sym}</td><td class="${o.side === 'BUY' ? 'up' : 'down'}">${side}</td>` +
        `<td class="num">${C.fmtQty(o.qty)}</td><td class="num">${C.fmt(o.px, o.m.dp)}</td><td class="t">${C.fmtTime(o.placedAt)}</td>` +
        `<td class="state ${o.state === 'Resting' ? 'resting' : ''}">${o.state}</td><td>${cancel}</td></tr>`;
    }).join('');
  }
  ordBody.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cancel]');
    if (!b) return;
    sim.cancelOrder(Number(b.dataset.cancel));
    $('#ordScroll').focus();
  });

  // Activity: new rows are held (with a count) while the reader hovers, focuses or scrolls the list.
  const actBody = $('#actBody');
  const actScroll = $('#actScroll');
  const newBtn = $('#newEvents');
  const held = [];
  let hovering = false;
  let focusWithin = false;
  const reading = () => hovering || focusWithin || actScroll.scrollTop > 8;

  function actRow(e) {
    const tr = document.createElement('tr');
    const dir = e.side === 'BUY' ? 'up' : e.side === 'SELL' ? 'down' : '';
    const isFill = e.state === 'Paper fill';
    const details = e.qty != null ? `${C.fmtQty(e.qty)} ${e.market} @ ${C.fmt(e.px, e.dp)}` : (e.target || '—');
    tr.innerHTML =
      `<td class="t">${C.fmtTime(e.t)}</td><td class="who">${C.esc(ownerName(e.who))}</td>` +
      `<td class="${isFill ? dir : ''}">${C.esc(e.action)}</td>` +
      `<td class="det"><span class="qty">${C.esc(details)}</span>${e.why ? `<span class="why">${C.esc(e.why)}</span>` : ''}</td>` +
      `<td class="state ${e.state === 'Resting' ? 'resting' : ''}">${C.esc(e.state)}</td>`;
    return tr;
  }
  function insertActivity(evs) {
    if (!evs.length) return;
    const empty = $('.empty-row', actBody);
    if (empty) empty.remove();
    const frag = document.createDocumentFragment();
    for (let i = evs.length - 1; i >= 0; i--) frag.appendChild(actRow(evs[i]));
    actBody.prepend(frag);
    while (actBody.children.length > 200) actBody.lastElementChild.remove();
  }
  function updateHeld() {
    newBtn.hidden = held.length === 0;
    setText(newBtn, `${held.length} new ${held.length === 1 ? 'event' : 'events'} · show`);
  }
  function flushHeld() {
    insertActivity(held.splice(0));
    updateHeld();
  }
  function onEvent(e) {
    if (document.hidden || reading()) {
      held.push(e);
      if (held.length > 200) held.shift();
      updateHeld();
      return;
    }
    insertActivity([e]);
  }
  function maybeFlush() { if (!reading() && !document.hidden) flushHeld(); }
  actScroll.addEventListener('scroll', maybeFlush, { passive: true });
  actScroll.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hovering = true; });
  actScroll.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hovering = false; maybeFlush(); } });
  actScroll.addEventListener('focusin', () => { focusWithin = true; });
  actScroll.addEventListener('focusout', () => { focusWithin = false; maybeFlush(); });
  newBtn.addEventListener('click', () => { actScroll.scrollTop = 0; flushHeld(); });

  /* ── Order ticket ── */
  const tk = {
    form: $('#ticket'), qty: $('#tkQty'), px: $('#tkPx'), owner: $('#tkOwner'),
    submit: $('#tkSubmit'), outcome: $('#tkOutcome'),
    qtyErr: $('#tkQtyErr'), pxErr: $('#tkPxErr'), ownerErr: $('#tkOwnerErr'),
  };
  tk.owner.innerHTML = '<option value="OPERATOR">Operator (manual)</option>' +
    sim.agents.map((a) => `<option value="${a.id}">Delegate to ${a.id}</option>`).join('');

  function syncOwnerOptions() {
    for (const a of sim.agents) setText($(`option[value="${a.id}"]`, tk.owner), `Delegate to ${a.id}${a.paused ? ' (paused)' : ''}`);
  }

  const parseNum = (s) => {
    const t = String(s).replace(/[,\s_]/g, '');
    return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
  };
  const readTicket = () => ({
    owner: tk.owner.value,
    sym: state.sym,
    side: state.side,
    type: state.type,
    qty: parseNum(tk.qty.value),
    px: state.type === 'LIMIT' ? parseNum(tk.px.value) : undefined,
  });

  function showError(input, errEl, msg) {
    if (msg) {
      setText(errEl, msg);
      errEl.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    } else if (!errEl.hidden) {
      errEl.hidden = true;
      errEl.textContent = '';
      input.removeAttribute('aria-invalid');
    }
  }

  function validateTicket(all = false) {
    const o = readTicket();
    const errs = sim.validateOrder(o) || {};
    showError(tk.qty, tk.qtyErr, all || state.touched.qty ? errs.qty : null);
    showError(tk.px, tk.pxErr, state.type === 'LIMIT' && (all || state.touched.px) ? errs.px : null);
    showError(tk.owner, tk.ownerErr, errs.owner);
    tk.submit.disabled = Object.keys(errs).length > 0;
    renderEstimate(o, errs);
    return errs;
  }

  function renderEstimate(o, errs) {
    const m = market();
    let px = NaN;
    if (o.type === 'MARKET') px = sim.expectedFill(m, o.side);
    else if (!errs.px) px = o.px;
    setText($('#tkPxLabel'), o.type === 'MARKET' ? 'Expected fill price' : 'Limit price');
    setText($('#tkFillPx'), Number.isFinite(px) ? C.fmt(px, m.dp) : '—');
    setText($('#tkNotional'), Number.isFinite(px) && !errs.qty ? '$' + C.fmt(px * o.qty, 2) : '—');
    let rule;
    if (!sim.priced(m)) rule = 'Waiting for the live price…';
    else if (o.type === 'MARKET') rule = `Paper market orders fill at the live mark ${o.side === 'BUY' ? 'plus' : 'minus'} 0.03% slippage.`;
    else if (!Number.isFinite(px)) rule = 'Limit orders rest until the live price reaches your limit.';
    else if (o.side === 'BUY' ? px >= m.price : px <= m.price) rule = `This limit is ${o.side === 'BUY' ? 'at or above' : 'at or below'} the current price, so it fills on the next tick at your limit.`;
    else rule = 'Rests in Open orders until the live price reaches your limit.';
    setText($('#tkRule'), rule);
  }

  function renderTicketMode() {
    $('#limitField').hidden = state.type !== 'LIMIT';
    const buy = state.side === 'BUY';
    setText(tk.submit, `Place paper ${state.type === 'LIMIT' ? 'limit ' : ''}${buy ? 'buy' : 'sell'}`);
    tk.submit.classList.toggle('btn-buy', buy);
    tk.submit.classList.toggle('btn-sell', !buy);
    validateTicket();
  }

  $$('input[name="side"]').forEach((r) => r.addEventListener('change', () => { state.side = r.value; renderTicketMode(); }));
  $$('input[name="otype"]').forEach((r) => r.addEventListener('change', () => {
    state.type = r.value;
    if (state.type === 'LIMIT' && !state.touched.px && sim.priced(market())) tk.px.value = market().price.toFixed(market().dp);
    renderTicketMode();
  }));
  tk.qty.addEventListener('input', () => { state.touched.qty = true; validateTicket(); });
  tk.px.addEventListener('input', () => { state.touched.px = true; validateTicket(); });
  tk.owner.addEventListener('change', () => validateTicket());

  function showOutcome(text, cls, tab, label) {
    tk.outcome.innerHTML = `<div class="note ${cls}"><p>${C.esc(text)}</p><button type="button" class="link-btn" data-goto="${tab}">${label}</button></div>`;
  }
  tk.outcome.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) goToOutput(b.dataset.goto);
  });

  tk.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const errs = validateTicket(true);
    const first = errs.qty ? tk.qty : errs.px ? tk.px : errs.owner ? tk.owner : null;
    if (first) { first.focus(); return; }
    const o = readTicket();
    const res = sim.placeOrder(o);
    if (!res.ok) { validateTicket(true); return; }
    const m = market();
    const verb = o.side === 'BUY' ? 'buy' : 'sell';
    const forWho = o.owner === 'OPERATOR' ? '' : ` for ${o.owner}`;
    if (res.kind === 'filled') {
      showOutcome(`Paper ${verb} filled${forWho}: ${C.fmtQty(o.qty)} ${m.s} at ${C.fmt(res.px, m.dp)}. Paper fill, no real order was sent.`,
        o.side === 'BUY' ? '' : 'is-sell', 'positions', 'View positions');
    } else {
      state.lastOrderId = res.order.id;
      showOutcome(`Limit ${verb} resting${forWho}: ${C.fmtQty(o.qty)} ${m.s} at ${C.fmt(o.px, m.dp)}. It fills when the live price reaches your limit.`,
        'is-resting', 'orders', 'View open orders');
    }
  });

  sim.on('limitFilled', (o) => {
    if (o.id !== state.lastOrderId) return;
    showOutcome(`Limit ${o.side === 'BUY' ? 'buy' : 'sell'} filled: ${C.fmtQty(o.qty)} ${o.sym} at ${C.fmt(o.px, o.m.dp)}. Paper fill.`,
      o.side === 'BUY' ? '' : 'is-sell', 'positions', 'View positions');
  });

  function goToOutput(tab) {
    closeSheet(false);
    outTabs.select('tab-' + tab);
    setView('activity');
    $('#activity').scrollIntoView({ block: 'nearest' });
    $('#tab-' + tab).focus();
  }

  /* ── Order book & recent trades ── */
  const bookTabs = setupTabs($('#bookTabs'), () => { renderBook(); renderTrades(); });
  const LEVELS = 6;
  const rowHtml = '<div class="book-row"><i class="depth"></i><span></span><span></span><span></span></div>';
  const asksEl = $('#asks');
  const bidsEl = $('#bids');
  asksEl.innerHTML = rowHtml.repeat(LEVELS);
  bidsEl.innerHTML = rowHtml.repeat(LEVELS);
  const askRows = [...asksEl.children];
  const bidRows = [...bidsEl.children];

  function renderBook() {
    if (!isShown($('#pane-book'))) return;
    const m = market();
    const b = sim.book(m, LEVELS);
    $('#bookEmpty').hidden = !!b;
    $('#pane-book').classList.toggle('is-empty', !b);
    if (!b || b.asks.length < LEVELS || b.bids.length < LEVELS) return;
    const { asks, bids, step } = b;
    const mid = (asks[0].p + bids[0].p) / 2;
    let ca = 0, cb = 0;
    const cumA = asks.map((l) => (ca += l.s));
    const cumB = bids.map((l) => (cb += l.s));
    const max = Math.max(ca, cb);
    const paint = (row, l, cum) => {
      const [d, p, s, t] = row.children;
      d.style.width = `${(cum / max) * 100}%`;
      setText(p, C.fmt(l.p, m.dp));
      setText(s, C.fmtQty(l.s));
      setText(t, C.fmtQty(cum));
    };
    for (let i = 0; i < LEVELS; i++) paint(askRows[i], asks[LEVELS - 1 - i], cumA[LEVELS - 1 - i]);
    for (let i = 0; i < LEVELS; i++) paint(bidRows[i], bids[i], cumB[i]);
    $('#spread').innerHTML = `<span class="mid">${C.fmt(mid, m.dp)}</span><span class="sp">Spread ${C.fmt(step, m.dp)} · ${((step / mid) * 1e4).toFixed(2)} bps</span>`;
  }

  const tradesEl = $('#trades');
  tradesEl.innerHTML = '<li><span></span><span></span><span></span></li>'.repeat(14);
  const tradeRows = [...tradesEl.children];
  function renderTrades() {
    if (!isShown(tradesEl)) return;
    const m = market();
    tradeRows.forEach((li, i) => {
      const p = m.prints[i];
      li.hidden = !p;
      if (!p) return;
      const [a, b, c] = li.children;
      setText(a, C.fmt(p.px, m.dp));
      a.className = p.side === 'BUY' ? 'up' : 'down';
      setText(b, C.fmtQty(p.qty));
      setText(c, C.fmtTime(p.t));
    });
  }

  /* ── Agent controls & the paper-trading notice ── */
  const simToggle = $('#simToggle');
  const simBadge = $('#simBadge');
  const simInfo = $('#simInfo');
  function renderSimState() {
    const on = sim.isRunning();
    simBadge.classList.toggle('is-paused', !on);
    setText($('#simState'), on ? 'agents on' : 'agents paused');
    setText($('.sim-toggle-label', simToggle), on ? 'Pause agents' : 'Resume agents');
    $('use', simToggle).setAttribute('href', on ? '#i-pause' : '#i-play');
  }
  simToggle.addEventListener('click', () => (sim.isRunning() ? sim.pause() : sim.start()));
  function setPopover(open) {
    simInfo.hidden = !open;
    simBadge.setAttribute('aria-expanded', String(open));
  }
  simBadge.addEventListener('click', () => setPopover(simInfo.hidden));
  document.addEventListener('click', (e) => { if (!simInfo.hidden && !e.target.closest('.sim-status')) setPopover(false); });

  /* ── Phone views & the ticket sheet ── */
  const viewBtns = $$('.ws-views [data-view]');
  function setView(v) {
    state.view = v;
    grid.dataset.view = v;
    viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    state.inspectT = null;
    renderAll();
  }
  viewBtns.forEach((b) => b.addEventListener('click', () => { setView(b.dataset.view); window.scrollTo(0, 0); }));

  const shell = $('#ticketShell');
  const backdrop = $('#sheetBackdrop');
  const openBtn = $('#openTicket');
  const inertables = () => $$('[data-sheet-inert], #workspace .panel:not(.ticket)');

  function openTicket() {
    if (!phone.matches) {
      tk.form.scrollIntoView({ block: 'nearest', behavior: C.reducedMotion() ? 'auto' : 'smooth' });
      tk.qty.focus({ preventScroll: true });
      return;
    }
    if (state.sheetOpen) return;
    state.sheetOpen = true;
    document.body.classList.add('sheet-open');
    backdrop.hidden = false;
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-labelledby', 'ticketTitle');
    inertables().forEach((el) => { el.inert = true; });
    openBtn.setAttribute('aria-expanded', 'true');
    $('#ticketTitle').focus({ preventScroll: true });
  }
  function closeSheet(restoreFocus = true) {
    if (!state.sheetOpen) return;
    state.sheetOpen = false;
    document.body.classList.remove('sheet-open');
    backdrop.hidden = true;
    ['role', 'aria-modal', 'aria-labelledby'].forEach((a) => shell.removeAttribute(a));
    inertables().forEach((el) => { el.inert = false; });
    openBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) openBtn.focus();
  }
  openBtn.addEventListener('click', openTicket);
  backdrop.addEventListener('click', () => closeSheet());
  $('#sheetClose').addEventListener('click', () => closeSheet());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!simInfo.hidden) { setPopover(false); simBadge.focus(); return; }
    if (state.sheetOpen) closeSheet();
  });
  // On phones the Overview shows the chart first, then the agent summary. Move the inspector in the
  // DOM (not just visually) so reading and keyboard order match what is on screen.
  const fleetPanel = $('#agents');
  const chartPanel = $('.chart-panel');
  function placeInspector() {
    if (phone.matches) { if (chartPanel.nextElementSibling !== insp.el) chartPanel.after(insp.el); }
    else if (fleetPanel.nextElementSibling !== insp.el) fleetPanel.after(insp.el);
  }
  phone.addEventListener('change', () => { if (!phone.matches) closeSheet(false); placeInspector(); renderAll(); });

  /* ── Deep links: #agents, #ticket, #activity, ?agent=ID ── */
  function applyHash() {
    const h = location.hash.slice(1);
    if (h === 'agents') setView('agents');
    else if (h === 'activity') { outTabs.select('tab-activity'); setView('activity'); }
    else if (h === 'ticket') setTimeout(openTicket, 60);
  }
  window.addEventListener('hashchange', applyHash);

  /* ── Render loop: update in place, skip while the tab is hidden ── */
  function renderAll() {
    if (document.hidden) return;
    applyDefaults();
    renderQuote();
    renderFleet();
    renderInspector();
    drawChart();
    renderBook();
    renderTrades();
    renderPositions();
    validateTicket();
  }
  sim.on('tick', renderAll);
  sim.on('event', onEvent);
  sim.on('agents', () => { syncOwnerOptions(); renderFleet(); renderInspector(); validateTicket(); });
  sim.on('orders', renderOrders);
  sim.on('state', renderSimState);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { maybeFlush(); renderAll(); } });
  window.addEventListener('resize', drawChart);

  placeInspector();
  syncOwnerOptions();
  setMarket(state.sym);
  renderTicketMode();
  if (sim.events.length) insertActivity(sim.events.slice(-80));
  else actBody.innerHTML = '<tr class="empty-row"><td colspan="5">No activity yet. Agents are scanning live markets.</td></tr>';
  renderOrders();
  renderSimState();
  renderFeedStatus();
  renderAll();
  bookTabs.select('tab-book');
  applyHash();
  sim.start();
})(window.Clipps);
