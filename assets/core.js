'use strict';
/* The Clipps core — a decorative brand illustration (the canvas is aria-hidden).
   A slab with gold circuitry; light pulses run along the traces when agents trade.
   It renders only while visible on screen, and holds a still frame for reduced motion. */
window.Clipps = window.Clipps || {};

(function (C) {
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
          const ny = clamp(y + d, y0, y1);
          x += Math.abs(ny - y) * (Math.random() < 0.5 ? -1 : 1);
          y = ny;
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

  C.mountCore = function (canvas) {
    const goldTraces = genTraces(SIDE_W, BAND[0] + 6, BAND[1] - 6, 90);
    const faintTraces = genTraces(SIDE_W, 8, SIDE_H - 8, 70, 5);

    const sideBase = document.createElement('canvas');
    sideBase.width = SIDE_W; sideBase.height = SIDE_H;
    (() => {
      const g = sideBase.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 0, SIDE_H);
      grd.addColorStop(0, '#24357e'); grd.addColorStop(0.5, '#142057'); grd.addColorStop(1, '#0a1033');
      g.fillStyle = grd; g.fillRect(0, 0, SIDE_W, SIDE_H);
      g.strokeStyle = 'rgba(140,165,255,0.10)'; g.lineWidth = 1;
      for (let x = 0; x < SIDE_W; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, SIDE_H); g.stroke(); }
      g.strokeStyle = 'rgba(150,180,255,0.28)'; g.lineWidth = 1.4;
      faintTraces.forEach((t) => strokeTrace(g, t));
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
    })();

    const topTex = document.createElement('canvas');
    topTex.width = topTex.height = 512;
    (() => {
      const g = topTex.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 512, 512);
      grd.addColorStop(0, '#f4f5ff'); grd.addColorStop(0.45, '#bfc8f6'); grd.addColorStop(1, '#5a68c4');
      g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
      for (let i = 64; i < 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
      g.strokeStyle = 'rgba(70,85,170,0.25)';
      genTraces(512, 20, 492, 30, 4).forEach((t) => strokeTrace(g, t));
    })();

    const sideWork = document.createElement('canvas');
    sideWork.width = SIDE_W; sideWork.height = SIDE_H;
    const sideCtx = sideWork.getContext('2d');

    const pulses = [];
    let activity = 0.4;
    const spawn = (d = 0) => pulses.push({ t: pick(goldTraces), d, v: rand(160, 420), dir: Math.random() < 0.5 ? 1 : -1 });

    function updateTexture(dt) {
      sideCtx.globalCompositeOperation = 'source-over';
      sideCtx.drawImage(sideBase, 0, 0);
      sideCtx.globalCompositeOperation = 'lighter';
      if (dt > 0 && Math.random() < 0.5 + activity * 1.5) spawn();
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

    function drawSlab(ctx, t, ox, oy, S) {
      const W = S * 0.5, H = S * 0.14, D = S * 0.3;
      const yaw = -0.62 + 0.22 * Math.sin(t * 0.13);
      const pitch = 0.46 + 0.05 * Math.sin(t * 0.21);
      const roll = -0.16;
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      const rot = ([x, y, z]) => {
        const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2];
      };
      const P = (sx, sy, sz) => { const [x, y] = rot([sx * W, sy * H, sz * D]); return [ox + x, oy - y]; };
      const L = [-0.35, 0.75, 0.55].map((c, _, v) => c / Math.hypot(...v));
      const faces = [
        { n: [0, 1, 0], c: [[-1, 1, -1], [1, 1, -1], [-1, 1, 1]], tex: topTex, top: true },
        { n: [0, -1, 0], c: [[-1, -1, 1], [1, -1, 1], [-1, -1, -1]], tex: sideWork },
        { n: [0, 0, 1], c: [[-1, 1, 1], [1, 1, 1], [-1, -1, 1]], tex: sideWork },
        { n: [0, 0, -1], c: [[1, 1, -1], [-1, 1, -1], [1, -1, -1]], tex: sideWork },
        { n: [1, 0, 0], c: [[1, 1, 1], [1, 1, -1], [1, -1, 1]], tex: sideWork },
        { n: [-1, 0, 0], c: [[-1, 1, -1], [-1, 1, 1], [-1, -1, -1]], tex: sideWork },
      ];

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createRadialGradient(ox, oy + H, 0, ox, oy + H, S * 0.75);
      gl.addColorStop(0, `rgba(216,178,104,${0.08 + activity * 0.1})`);
      gl.addColorStop(1, 'rgba(216,178,104,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(ox - S, oy - S, S * 2, S * 2);
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

    function drawRings(ctx, t, cx, cy, R) {
      ctx.save();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(245,247,250,0.35)';
      const a0 = t * 0.05;
      [[0.1, 1.35], [1.55, 2.6], [2.8, 4.1], [4.3, 5.9]].forEach(([s, e]) => {
        ctx.beginPath(); ctx.arc(cx, cy, R, a0 + s, a0 + e); ctx.stroke();
      });
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(245,247,250,0.5)';
      const a1 = -t * 0.08;
      [[0.3, 0.9], [2.0, 2.35], [3.4, 4.6], [5.2, 5.5]].forEach(([s, e]) => {
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.88, a1 + s, a1 + e); ctx.stroke();
      });
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(245,247,250,0.18)';
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2 + a0 * 0.5;
        const r1 = R * 1.04, r2 = R * (i % 6 === 0 ? 1.09 : 1.06);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
      }
      const rx = cx + R * 0.02 + Math.sin(t * 0.7) * R * 0.03, ry = cy + R * 0.12 + Math.cos(t * 0.5) * R * 0.02;
      ctx.strokeStyle = 'rgba(245,247,250,0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(rx, ry, R * 0.1, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#d8b268';
      ctx.beginPath(); ctx.arc(rx, ry, R * 0.035, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    const reduced = C.reducedMotion();
    let t = 8, last = 0, raf = 0;
    let userPaused = false, pageVisible = !document.hidden, onScreen = true;

    function draw() {
      const { w, h, dpr } = C.fitCanvas(canvas);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.4;
      const cx = w / 2, cy = h / 2;
      drawSlab(ctx, t, cx - R * 0.1, cy - R * 0.12 + Math.sin(t * 0.6) * 3, R * 1.45);
      drawRings(ctx, t, cx, cy, R);
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      activity = Math.max(0.15, activity - dt * 0.25);
      updateTexture(dt);
      draw();
      raf = requestAnimationFrame(frame);
    }

    const shouldRun = () => !reduced && !userPaused && pageVisible && onScreen;
    function sync() {
      if (shouldRun()) {
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    // A still frame with lit traces — the reduced-motion view, and the first paint.
    for (let i = 0; i < 40; i++) spawn(rand(0, 300));
    updateTexture(0);
    draw();

    document.addEventListener('visibilitychange', () => { pageVisible = !document.hidden; sync(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }).observe(canvas);
    }
    window.addEventListener('resize', () => { if (!raf) draw(); });
    sync();

    return {
      reduced,
      burst(n = 6) {
        if (!raf) return;
        activity = Math.min(1, activity + 0.3);
        for (let i = 0; i < n; i++) spawn();
      },
      setPaused(p) { userPaused = p; sync(); },
      isPaused: () => userPaused,
    };
  };
})(window.Clipps);
