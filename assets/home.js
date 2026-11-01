'use strict';
/* Clipps homepage: mobile menu, the live workspace preview and the core illustration. */
(function (C) {
  const $ = (s, r = document) => r.querySelector(s);

  /* ── Mobile menu ── */
  const menuBtn = $('#menuBtn');
  const menu = $('#mobileMenu');
  function setMenu(open) {
    menuBtn.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
  }
  menuBtn.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); }
  });

  /* ── Live preview (its own simulation; nothing leaves the browser) ── */
  const sim = C.createSim({ narrate: true });
  sim.setAgentPaused('VEGA-3', true);   // show an operator control in the preview
  sim.review('LYRA-12');
  const SHOWN = ['ORION-7', 'VEGA-3', 'LYRA-12'];
  const SYM = 'CLIP-PERP';
  let tf = 5000;

  const agentList = $('#pvAgents');
  agentList.innerHTML = SHOWN.map((id) => `
    <li>
      <a class="pv-agent" href="demo/?agent=${id}#agents">
        ${C.avatar(id)}
        <span class="pv-agent-name">${id}</span>
        <span class="pv-agent-status"></span>
        <svg class="pv-chev" aria-hidden="true"><use href="#i-chevron-right" /></svg>
      </a>
    </li>`).join('');
  const agentLinks = [...agentList.querySelectorAll('.pv-agent')];

  function renderAgents() {
    let changed = false;
    SHOWN.forEach((id, i) => {
      const a = sim.agent(id);
      const status = a.paused ? 'Paused' : a.status;
      const el = agentLinks[i];
      if (el.dataset.status === status) return;
      changed = true;
      el.dataset.status = status;
      el.querySelector('.pv-agent-status').textContent = status;
      el.setAttribute('aria-label', `${id}, ${status}. Inspect in the demo`);
    });
    if (changed) drawWires();
  }

  // Gold wires from each agent into a hub node; a paused agent's wire dims.
  const wires = $('#pvWires');
  const agentsCard = $('.pv-agents-card');
  function drawWires() {
    const cr = agentsCard.getBoundingClientRect();
    if (!cr.width) return;
    const rs = agentLinks.map((a) => a.getBoundingClientRect());
    const x0 = Math.max(...rs.map((r) => r.right)) - cr.left;
    const ys = rs.map((r) => r.top + r.height / 2 - cr.top);
    const xn = cr.width - 16, yn = ys[1];
    const xm = x0 + (xn - x0) * 0.45;
    const rad = 6;
    const paths = ys.map((y, i) => {
      let d = `M${x0} ${y}H${xn - 7}`;
      if (Math.abs(y - yn) >= 1) {
        const s = y < yn ? 1 : -1;
        d = `M${x0} ${y}H${xm - rad}Q${xm} ${y} ${xm} ${y + s * rad}V${yn - s * rad}Q${xm} ${yn} ${xm + rad} ${yn}H${xn - 7}`;
      }
      return `<path class="pv-wire" data-status="${agentLinks[i].dataset.status || ''}" d="${d}"/>`;
    }).join('');
    wires.setAttribute('viewBox', `0 0 ${cr.width} ${cr.height}`);
    wires.innerHTML = paths +
      `<rect class="pv-node" x="${xn - 7}" y="${yn - 7}" width="14" height="14" rx="2"/>` +
      `<rect class="pv-node-core" x="${xn - 2.5}" y="${yn - 2.5}" width="5" height="5"/>`;
  }

  const chart = $('#pvChart');
  function renderChart() {
    const m = sim.market(SYM);
    C.drawChart(chart, { candles: sim.candles(m, tf), dp: m.dp, tfMs: tf, axes: false, grid: true, lastLine: false, barSpace: 6 });
  }
  const tfButtons = [...document.querySelectorAll('.pv-tf button')];
  tfButtons.forEach((b) => b.addEventListener('click', () => {
    tf = Number(b.dataset.tf);
    tfButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderChart();
  }));

  // The feed follows the three agents shown above.
  const feed = $('#pvFeed');
  const relevant = (e) => SHOWN.includes(e.who) || SHOWN.includes(e.target);
  function sentence(e) {
    if (e.kind === 'note') return `${e.who} ${e.text}`;
    if (e.action === 'Paper buy') return `${e.who} bought ${C.fmtQty(e.qty)} ${e.market}`;
    if (e.action === 'Paper sell') return `${e.who} sold ${C.fmtQty(e.qty)} ${e.market}`;
    if (e.action === 'Paused agent') return `${e.target} paused by operator`;
    if (e.action === 'Resumed agent') return `${e.target} resumed by operator`;
    return `${e.who === 'OPERATOR' ? 'Operator' : e.who} ${e.action.toLowerCase()}`;
  }
  function dotClass(e) {
    if (e.side === 'BUY' || e.action === 'Resumed agent') return 'up';
    if (e.side === 'SELL' || e.action === 'Paused agent') return 'down';
    if (e.note === 'review') return 'gold';
    return 'up';   // scans and watchlist changes
  }
  let lastId = -1;
  function renderFeed() {
    const evs = [];
    for (let i = sim.events.length - 1; i >= 0 && evs.length < 4; i--) if (relevant(sim.events[i])) evs.push(sim.events[i]);
    if (!evs.length || evs[0].id === lastId) return;
    lastId = evs[0].id;
    feed.innerHTML = evs.map((e) =>
      `<li><span class="dot ${dotClass(e)}" aria-hidden="true"></span><time>${C.fmtTime(e.t, false)}</time><span>${C.esc(sentence(e))}</span></li>`
    ).join('');
  }

  function render() {
    if (document.hidden) return;
    renderAgents();
    renderChart();
    renderFeed();
  }
  sim.on('tick', render);
  sim.on('agents', renderAgents);
  sim.on('state', render);
  document.addEventListener('visibilitychange', render);
  window.addEventListener('resize', () => { renderChart(); drawWires(); });
  if ('ResizeObserver' in window) new ResizeObserver(drawWires).observe(agentsCard);
  if (document.fonts) document.fonts.ready.then(drawWires);

  const pvPause = $('#pvPause');
  pvPause.addEventListener('click', () => {
    if (sim.isRunning()) sim.pause(); else sim.start();
    const running = sim.isRunning();
    const label = running ? 'Pause preview' : 'Resume preview';
    pvPause.querySelector('use').setAttribute('href', running ? '#i-pause' : '#i-play');
    pvPause.querySelector('.visually-hidden').textContent = label;
    pvPause.title = label;
    $('#pvLive').classList.toggle('is-paused', !running);
  });

  /* ── Core illustration ── */
  const core = C.mountCore($('#core'));
  sim.on('fill', () => core.burst(6));
  const corePause = $('#corePause');
  if (core.reduced) {
    corePause.hidden = true;   // reduced motion: the core is a still image
  } else {
    corePause.addEventListener('click', () => {
      core.setPaused(!core.isPaused());
      const paused = core.isPaused();
      corePause.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
      corePause.querySelector('.visually-hidden').textContent = paused ? 'Play animation' : 'Pause animation';
    });
  }

  render();
  sim.start();
})(window.Clipps);
