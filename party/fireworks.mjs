// Dependency-free canvas fireworks for the podium. Launches rocket after
// rocket for durationMs, then fades out. Respects reduced-motion settings
// (renders one static starburst instead of animating).
export function launchFireworks(canvas, { durationMs = 9000 } = {}) {
  if (!canvas || !canvas.getContext) return () => {};
  const ctx = canvas.getContext('2d');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fit = () => {
    const ratio = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
  };
  fit();
  const onResize = () => fit();
  window.addEventListener('resize', onResize);
  const PALETTE = ['#ffd166', '#ff5fa2', '#4de3ff', '#a3ff6e', '#ffffff', '#ff8c42', '#c77dff'];
  const rockets = [];
  const sparks = [];
  let stopped = false;
  const W = () => canvas.width, H = () => canvas.height;

  const burst = (x, y, big) => {
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const count = big ? 130 : 70 + Math.floor(Math.random() * 50);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (big ? 5.5 : 4.2) * (0.35 + Math.random() * 0.65);
      sparks.push({
        x, y, color,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.008 + Math.random() * 0.012, size: 1.6 + Math.random() * 2.2,
      });
    }
  };

  const launch = () => {
    rockets.push({
      x: W() * (0.12 + Math.random() * 0.76), y: H() + 8,
      vy: -(H() * 0.011 + Math.random() * H() * 0.004),
      target: H() * (0.16 + Math.random() * 0.4),
    });
  };

  if (reduced) {
    burst(W() / 2, H() * 0.4, true);
    for (const s of sparks) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x + s.vx * 22, s.y + s.vy * 22, 3, 3);
    }
    ctx.globalAlpha = 1;
    window.removeEventListener('resize', onResize);
    return () => {};
  }

  launch();
  launch();
  const started = performance.now();
  let frame = 0;
  const tick = () => {
    if (stopped) return;
    frame += 1;
    const elapsed = performance.now() - started;
    if (elapsed < durationMs && frame % 26 === 0) launch();
    ctx.clearRect(0, 0, W(), H());
    for (let i = rockets.length - 1; i >= 0; i -= 1) {
      const r = rockets[i];
      r.y += r.vy;
      r.vy *= 0.985;
      ctx.fillStyle = '#fff7dd';
      ctx.fillRect(r.x - 1, r.y, 2.5, 9);
      if (r.y <= r.target) { rockets.splice(i, 1); burst(r.x, r.y, Math.random() < 0.3); }
    }
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy;
      s.vx *= 0.985; s.vy = s.vy * 0.985 + 0.06;
      s.life -= s.decay;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, Math.min(1, s.life));
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    ctx.globalAlpha = 1;
    if (elapsed > durationMs + 2500 || (elapsed > durationMs && !rockets.length && !sparks.length)) {
      window.removeEventListener('resize', onResize);
      ctx.clearRect(0, 0, W(), H());
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => { stopped = true; window.removeEventListener('resize', onResize); };
}
