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
  const sim = C.createSim();
  sim.setAgentPaused('VEGA-3', true);   // show an operator control in the preview
  const SHOWN = ['ORION-7', 'VEGA-3', 'LYRA-12'];
  const SYM = 'CLIP-PERP';

  const agentList = $('#pvAgents');
  agentList.innerHTML = SHOWN.map((id) => `
    <li>
      <a class="pv-agent" href="demo/?agent=${id}#agents">
        <svg class="agent-icon" aria-hidden="true"><use href="#mark" /></svg>
        <span class="pv-agent-name">${id}</span>
        <span class="pv-agent-status"></span>
        <svg class="pv-chev" aria-hidden="true"><use href="#i-chevron-right" /></svg>
      </a>
    </li>`).join('');
  const agentLinks = [...agentList.querySelectorAll('.pv-agent')];

  function renderAgents() {
    SHOWN.forEach((id, i) => {
      const a = sim.agent(id);
      const status = a.paused ? 'Paused' : a.status;
      const el = agentLinks[i];
      if (el.dataset.status === status) return;
      el.dataset.status = status;
      el.querySelector('.pv-agent-status').textContent = status;
      el.setAttribute('aria-label', `${id}, ${status}. Inspect in the demo`);
    });
  }

  const chart = $('#pvChart');
  function renderChart() {
    const m = sim.market(SYM);
    C.drawChart(chart, { candles: m.candles, dp: m.dp, axes: false, barSpace: 6 });
    $('#pvPrice').textContent = C.fmt(m.price, m.dp);
  }

  const feed = $('#pvFeed');
  function sentence(e) {
    const who = e.who === 'OPERATOR' ? 'Operator' : e.who;
    if (e.action === 'Paper buy') return `${who} bought ${C.fmtQty(e.qty)} ${e.market}`;
    if (e.action === 'Paper sell') return `${who} sold ${C.fmtQty(e.qty)} ${e.market}`;
    if (e.action === 'Paused agent') return `${who} paused ${e.target}`;
    if (e.action === 'Resumed agent') return `${who} resumed ${e.target}`;
    return `${who}: ${e.action.toLowerCase()} ${e.market || ''}`.trim();
  }
  let lastId = -1;
  function renderFeed() {
    const evs = sim.events.slice(-4).reverse();
    if (!evs.length || evs[0].id === lastId) return;
    lastId = evs[0].id;
    feed.innerHTML = evs.map((e) => {
      const dir = e.side === 'BUY' ? 'up' : e.side === 'SELL' ? 'down' : '';
      return `<li><span class="dot ${dir}" aria-hidden="true"></span><time>${C.fmtTime(e.t, false)}</time><span>${C.esc(sentence(e))}</span></li>`;
    }).join('');
  }

  function render() {
    if (document.hidden) return;
    renderAgents();
    renderChart();
    renderFeed();
  }
  sim.on('tick', render);
  sim.on('state', render);
  document.addEventListener('visibilitychange', render);
  window.addEventListener('resize', renderChart);

  const pvPause = $('#pvPause');
  pvPause.addEventListener('click', () => {
    if (sim.isRunning()) sim.pause(); else sim.start();
    const running = sim.isRunning();
    pvPause.querySelector('use').setAttribute('href', running ? '#i-pause' : '#i-play');
    pvPause.querySelector('.visually-hidden').textContent = running ? 'Pause preview' : 'Resume preview';
    $('#pvBadge').classList.toggle('is-paused', !running);
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
