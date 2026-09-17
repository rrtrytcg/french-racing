// Teacher whiteboard: setup -> lobby (QR code + roster) -> live race ->
// podium. The host browser is authoritative; every game message flows through
// the Supabase broadcast channel owned by PartyHost.
import { TRACKS, getTrack, DEFAULT_TRACK_ID } from '../tracks.mjs';
import { DEMO_BANK } from '../content.mjs';
import { PartyHost, ROUND_SECONDS } from './host.mjs';
import { trackSvg, sampleTrack, carTransform, stackOffset } from './trackview.mjs';
import { launchFireworks } from './fireworks.mjs';
import {
  makeRoomCode, makeRoomPassword, loadPartyConfig, savePartyConfig,
  createSupabaseTransport, joinUrl, CONFIG_STORAGE_KEY,
} from './net.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const QR_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
const SETS_KEY = 'apex.sets.v1';
const ACTIVE_KEY = 'apex.activeSet.v1';
const TRACK_KEY = 'apex.track.v1';
const BASE_KEY = 'apex.joinBase.v1';

let qrLibPromise = null;
function loadQrLib() {
  if (!qrLibPromise) {
    qrLibPromise = new Promise((resolve) => {
      if (window.QRCode) { resolve(true); return; }
      const script = document.createElement('script');
      script.src = QR_LIB_URL;
      script.async = true;
      script.onload = () => resolve(Boolean(window.QRCode));
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }
  return qrLibPromise;
}

const stored = (key, fallback) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

function loadSets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((set) => set && typeof set.id === 'string' && set.gears) : [];
  } catch { return []; }
}

export async function bootHost() {
  const main = document.querySelector('#main');
  const meta = document.querySelector('#race-meta');
  const S = {
    phase: 'setup', config: null, configError: '', netStatus: 'offline',
    code: makeRoomCode(), password: makeRoomPassword(),
    trackId: TRACKS.some((t) => t.id === stored(TRACK_KEY, '')) ? stored(TRACK_KEY, '') : DEFAULT_TRACK_ID,
    sets: loadSets(), setId: stored(ACTIVE_KEY, 'builtin'),
    joinBase: stored(BASE_KEY, ''),
    transport: null, host: null, visual: new Map(),
    shownSeq: 0, animating: false, animToken: 0, fireworksOn: false,
    endsAt: 0, timerId: 0, lastQr: '',
  };
  const setMeta = (text) => { meta.textContent = text; };
  const activeSet = () => S.sets.find((set) => set.id === S.setId) || null;
  const base = () => (S.joinBase.trim() || `${location.origin}${location.pathname}`).replace(/\/+$/, '');
  const inviteUrl = () => { try { return joinUrl(base(), S.code, S.password); } catch { return ''; } };
  const onLocalhost = () => /localhost|127\.0\.0\.1/i.test(base());

  async function refreshConfig() {
    S.config = await loadPartyConfig();
    if (S.phase === 'setup') render();
  }

  async function openLobby() {
    if (!S.config || S.transport) return;
    S.netStatus = 'connecting';
    render();
    try {
      const transport = await createSupabaseTransport({
        url: S.config.url, key: S.config.key, roomCode: S.code,
        onMessage: (payload) => S.host && S.host.handle(payload),
        onStatus: (status) => {
          S.netStatus = status === 'SUBSCRIBED' ? 'live' : status === 'CLOSED' ? 'offline' : 'reconnecting';
          const badge = document.querySelector('#net-badge');
          if (badge) badge.outerHTML = netBadge();
        },
      });
      if (!transport.ready) {
        S.netStatus = 'error';
        S.transport = null;
        render();
        return;
      }
      S.transport = transport;
      S.host = new PartyHost({
        send: (payload) => S.transport.send(payload),
        roomCode: S.code, password: S.password, trackId: S.trackId, set: activeSet(),
      });
      S.host.onView = onHostView;
      S.phase = 'lobby';
      S.netStatus = 'live';
      S.timerId = window.setInterval(tick, 500);
      render();
    } catch (error) {
      S.netStatus = 'error';
      S.configError = `Could not reach Supabase (${error.message || 'network error'}). Check the keys and the connection, then try again.`;
      render();
    }
  }

  function onHostView() {
    const snap = S.host.snapshot();
    if (snap.status === 'finished') S.phase = 'podium';
    else if (snap.status === 'racing') S.phase = 'race';
    if (snap.round) S.endsAt = snap.round.endsAt;
    if (snap.settleSeq !== S.shownSeq && snap.lastMoves && snap.lastMoves.length && S.phase === 'race') {
      S.shownSeq = snap.settleSeq;
      if (!S.animating) animateMoves(snap);
      return;
    }
    render(snap);
  }

  function tick() {
    if (!S.host) return;
    S.host.checkTimer();
    const fill = document.querySelector('#ptimer-fill'), text = document.querySelector('#ptimer-text');
    if (fill && text && S.endsAt) {
      const left = Math.max(0, Math.ceil((S.endsAt - Date.now()) / 1000));
      fill.style.width = `${Math.max(0, Math.min(100, (left / ROUND_SECONDS) * 100))}%`;
      text.textContent = left > 0 ? `${left}s left to answer` : 'Revealing moves…';
    }
  }

  function animateMoves(snap) {
    const track = getTrack(snap.trackId);
    S.animating = true;
    const token = ++S.animToken;
    for (const move of snap.lastMoves) S.visual.set(move.carId, move.from);
    render(snap);
    const cars = snap.race.cars;
    const points = sampleTrack(track.pathD, track.length);
    const longest = snap.lastMoves.reduce((best, move) => Math.max(best, Math.abs(move.to - move.from)), 1);
    const duration = Math.max(700, Math.min(1600, 500 + longest * 40));
    const start = performance.now();
    const groups = new Map();
    for (const car of cars) {
      if (!groups.has(car.position)) groups.set(car.position, []);
      groups.get(car.position).push(car.id);
    }
    const frame = (now) => {
      if (token !== S.animToken) return;
      const progress = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - progress, 3);
      for (const move of snap.lastMoves) {
        const current = move.from + (move.to - move.from) * eased;
        const el = document.querySelector(`#car-${CSS.escape(String(move.carId))}`);
        if (!el) continue;
        const group = groups.get(move.to) || [move.carId];
        const { lane, along } = stackOffset(Math.max(0, group.indexOf(move.carId)), group.length);
        el.setAttribute('transform', carTransform(current + along, lane, points, track.length));
      }
      if (progress < 1) requestAnimationFrame(frame);
      else {
        S.visual.clear();
        S.animating = false;
        render(S.host.snapshot());
      }
    };
    requestAnimationFrame(frame);
  }

  function netBadge() {
    const label = { live: '● Live', connecting: '● Connecting…', reconnecting: '● Reconnecting…', offline: '● Offline', error: '● Connection failed' }[S.netStatus] || '● …';
    return `<span id="net-badge" class="net-badge ${S.netStatus}">${label}</span>`;
  }

  function configHtml() {
    if (S.config) {
      return `<div class="config-ok"><div><strong>Supabase connected</strong><span class="how-copy">${esc(S.config.url)} · keys from ${S.config.source === 'file' ? 'supabase-config.js' : 'this browser'}</span></div>${S.config.source === 'browser' ? '<button class="outline-button" data-h="forget-config">Forget keys</button>' : ''}</div>`;
    }
    return `<div class="config-gate"><h3>One-time connection setup</h3>
      <p class="how-copy">The classroom server runs on your free Supabase project. Easiest path: create <code>supabase-config.js</code> next to <code>index.html</code> once — every device on this address inherits it:</p>
      <pre class="format-sample">export const SUPABASE_URL = 'https://xyzcompany.supabase.co';
export const SUPABASE_ANON_KEY = 'paste-the-anon-public-key';</pre>
      <p class="how-copy">Find both under Supabase → Project Settings → API. Or paste them here (this browser only):</p>
      <label class="import-name">Project URL <input data-h-url placeholder="https://xyzcompany.supabase.co" autocomplete="off"/></label>
      <label class="import-name">Anon public key <input data-h-key placeholder="eyJ…" autocomplete="off"/></label>
      ${S.configError ? `<p class="wear-warning">${esc(S.configError)}</p>` : ''}
      <div class="button-row"><button class="primary-button" data-h="save-config">Save keys</button><button class="outline-button" data-h="retry-config">I added the file</button></div></div>`;
  }

  function setupView() {
    const setOptions = [`<option value="builtin" ${!activeSet() ? 'selected' : ''}>${esc(DEMO_BANK.title)}</option>`,
      ...S.sets.map((set) => `<option value="${esc(set.id)}" ${S.setId === set.id ? 'selected' : ''}>${esc(set.name || set.title)}</option>`)].join('');
    main.innerHTML = `<section class="party-setup" aria-labelledby="host-title">
      <div class="party-head"><div><span class="eyebrow">Classroom race · teacher screen</span><h1 id="host-title">Host a race.</h1>
      <p class="lede">Your browser is the server. Learners scan, join, and answer on their devices; the whiteboard shows the circuit, the cars, and the positions.</p></div>${netBadge()}</div>
      ${configHtml()}
      <div class="host-grid">
        <section class="setup-card"><div class="card-heading"><h2>Room</h2><span>up to 16 drivers</span></div>
          <div class="room-fields"><label>Room code <strong class="code-big">${S.code}</strong><button class="text-button" data-h="regen-code">↻</button></label>
          <label>Password <strong class="code-big">${S.password}</strong><button class="text-button" data-h="regen-pass">↻</button></label></div>
          <label class="import-name">Join address <input data-h-base value="${esc(S.joinBase)}" placeholder="${esc(`${location.origin}${location.pathname}`)}" autocomplete="off"/></label>
          ${onLocalhost() ? '<p class="wear-warning">Phones cannot reach localhost. Open this page through your laptop’s Wi-Fi address (same port), then the QR code just works.</p>' : '<p class="how-copy">The QR code points at this address. Leave it blank unless your network needs an override.</p>'}
        </section>
        <section class="setup-card"><div class="card-heading"><h2>Circuit &amp; language</h2></div>
          <div class="track-grid mini">${TRACKS.map((track) => `<label class="track-pick ${track.id === S.trackId ? 'active' : ''}"><input type="radio" name="host-circuit" data-h-track="${track.id}" ${track.id === S.trackId ? 'checked' : ''}/><svg class="mini-track" viewBox="60 20 1056 580" aria-hidden="true"><path d="${track.pathD}" class="mini-outline"/><path d="${track.pathD}" class="mini-asphalt"/></svg><span class="track-pick-name">${esc(track.name)}</span></label>`).join('')}</div>
          <label class="count-select">Sentence set <select data-h-set>${setOptions}</select></label>
          <p class="how-copy">Imported sets live in this browser and are dealt to every device automatically.</p>
        </section>
      </div>
      <div class="start-line"><button class="primary-button" data-h="open-lobby" ${S.config ? '' : 'disabled'}>Open lobby <span aria-hidden="true">↗</span></button></div>
    </section>`;
    setMeta('Classroom host setup');
  }

  function rosterHtml(players, compact) {
    if (!players.length) return '<p class="how-copy">Waiting for drivers… they scan the QR code, type their name, and appear here.</p>';
    return `<div class="roster-grid ${compact ? 'compact' : ''}">${players.map((p) => `<div class="roster-card ${p.online === false ? 'offline' : ''}"><i class="car-chip" style="background:${esc(p.color)}">${p.carNumber}</i><span class="roster-name">${esc(p.name)}</span><span class="roster-color">${esc(p.colorName)}</span></div>`).join('')}</div>`;
  }

  function lobbyView(snap) {
    const url = inviteUrl();
    main.innerHTML = `<section class="party-lobby" aria-labelledby="lobby-title">
      <div class="party-head"><div><span class="eyebrow">Lobby · ${snap.players.length}/16 drivers</span><h1 id="lobby-title">Scan to join.</h1></div>${netBadge()}</div>
      <div class="lobby-grid">
        <section class="qr-card"><div id="qr" class="qr-box" role="img" aria-label="QR code to join the race"></div>
          <div class="join-codes"><div><span>Room</span><strong>${S.code}</strong></div><div><span>Password</span><strong>${S.password}</strong></div></div>
          <p class="join-url">${esc(url)} <button class="text-button" data-h="copy-link">Copy</button></p>
        </section>
        <section class="setup-card"><div class="card-heading"><h2>Grid</h2><span>${esc(getTrack(S.trackId).name)} · ${activeSet() ? esc(activeSet().name || activeSet().title) : esc(DEMO_BANK.title)}</span></div>
          ${rosterHtml(snap.players)}
          <div class="start-line"><button class="primary-button" data-h="start-race" ${snap.players.length ? '' : 'disabled'}>Start the race <span aria-hidden="true">↗</span></button></div>
        </section>
      </div></section>`;
    setMeta(`Lobby ${S.code} · ${snap.players.length}/16`);
    paintQr(url);
  }

  async function paintQr(url) {
    const box = document.querySelector('#qr');
    if (!box || !url || S.lastQr === url) return;
    S.lastQr = url;
    box.innerHTML = '';
    const ok = await loadQrLib();
    const live = document.querySelector('#qr');
    if (!live) return;
    if (ok) {
      try {
        // eslint-disable-next-line no-undef
        new QRCode(live, { text: url, width: 216, height: 216, correctLevel: QRCode.CorrectLevel.M });
        return;
      } catch {}
    }
    live.innerHTML = `<p class="how-copy">QR unavailable offline.<br/>Type this address:</p><p class="join-url">${esc(url)}</p>`;
  }

  function standingsHtml(snap) {
    const answered = snap.round ? snap.round.answered : [];
    return `<div class="party-standings"><div class="tower-title"><span>Positions</span><span>Round ${snap.race ? snap.race.round : '–'}</span></div>
      ${snap.standings.map((row) => `<div class="tower-row ${row.finished ? 'finished' : ''}"><span class="tower-pos">${row.pos}</span><i class="mini-chip" style="background:${esc(row.color)}"></i><span class="tower-name">${esc(row.name)}${row.finished ? ' · 🏁' : ''}${row.online === false ? ' · …' : ''}</span>${snap.round && !row.finished ? `<span class="answer-dot ${answered.includes(row.carId) ? 'yes' : ''}" title="${answered.includes(row.carId) ? 'Answered' : 'Thinking'}">${answered.includes(row.carId) ? '✓' : '·'}</span>` : ''}<span class="tower-dist">${row.position}/${getTrack(snap.trackId).length}</span></div>`).join('')}</div>`;
  }

  function raceView(snap) {
    const track = getTrack(snap.trackId);
    const leader = snap.standings.length ? snap.standings[0].carId : null;
    const left = S.endsAt ? Math.max(0, Math.ceil((S.endsAt - Date.now()) / 1000)) : 0;
    main.innerHTML = `<section class="party-race" aria-labelledby="race-title">
      <div class="party-head tight"><div><h1 id="race-title">${esc(track.title)}</h1><span class="eyebrow">Round ${snap.race.round} · ${snap.round ? `${snap.round.answered.length}/${snap.round.active.length} answered` : ''}</span></div>${netBadge()}</div>
      <div class="ptimer"><div id="ptimer-fill" class="ptimer-fill" style="width:${Math.max(0, Math.min(100, (left / ROUND_SECONDS) * 100))}%"></div><span id="ptimer-text" class="ptimer-text">${left}s left to answer</span></div>
      <div class="race-layout whiteboard"><div class="track-card">${trackSvg(snap.race.cars, track, { activeId: leader, visualPositions: S.visual })}${S.animating ? '<div class="busy-mask">Cars moving · watch the line</div>' : ''}</div>
      <aside class="race-side">${standingsHtml(snap)}
        <details class="invite-mini"><summary>Invite more drivers · ${S.code} / ${S.password}</summary><p class="join-url">${esc(inviteUrl())} <button class="text-button" data-h="copy-link">Copy</button></p></details>
        <div class="panel-card event-log"><h3>Race radio</h3>${snap.log.slice(-5).reverse().map((line) => `<p class="event-line">${esc(line.message || '')}</p>`).join('') || '<p class="event-line">Lights out…</p>'}</div>
        <button class="outline-button" data-h="end-race">Wave the chequered flag</button></aside></div></section>`;
    setMeta(`Round ${snap.race.round} · live`);
  }

  function podiumView(snap) {
    const rows = snap.standings || [];
    const track = getTrack(snap.trackId);
    const places = rows.slice(0, 3);
    main.innerHTML = `<section class="secondary-screen podium-screen party-podium" aria-labelledby="podium-title">
      <canvas id="fireworks" class="fireworks" aria-hidden="true"></canvas>
      <span class="eyebrow">${esc(track.name)} · final classification</span><h1 id="podium-title">Flag down.</h1>
      <p class="podium-subtitle">${rows[0] ? `${esc(rows[0].name)} takes the chequered flag.` : 'The race is complete.'}</p>
      <div class="podium">${places.map((car, i) => `<div class="podium-place ${i === 0 ? 'first' : i === 1 ? 'second' : 'third'}"><div class="podium-car" style="background:${esc(car.color)}">${car.carNumber}</div><div class="podium-name">${esc(car.name)}</div><div class="podium-block">${i + 1}</div></div>`).reverse().join('')}</div>
      <table class="final-table"><thead><tr><th>Pos</th><th>Driver</th><th>Distance</th><th>Status</th></tr></thead>
      <tbody>${rows.map((car, i) => `<tr><td class="rank">${i + 1}</td><td><i class="mini-chip" style="background:${esc(car.color)}"></i> ${esc(car.name)}</td><td>${car.position}/${track.length}</td><td>${car.retired ? 'DNF' : car.finished ? 'Finished' : 'Not finished'}</td></tr>`).join('')}</tbody></table>
      <div class="button-row"><button class="outline-button" data-h="new-room">New room</button><button class="primary-button" data-h="again">Race again, same grid</button></div></section>`;
    setMeta('Final classification');
    if (!S.fireworksOn) {
      S.fireworksOn = true;
      launchFireworks(document.querySelector('#fireworks'));
    }
  }

  function render(snap) {
    snap = snap || (S.host ? S.host.snapshot() : null);
    if (S.phase === 'setup' || !snap) { setupView(); return; }
    if (snap.status === 'lobby') lobbyView(snap);
    else if (snap.status === 'racing') raceView(snap);
    else podiumView(snap);
  }

  document.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-h]')?.dataset.h;
    if (!action) return;
    if (action === 'regen-code') { S.code = makeRoomCode(); render(); }
    else if (action === 'regen-pass') { S.password = makeRoomPassword(); render(); }
    else if (action === 'save-config') {
      const url = document.querySelector('[data-h-url]')?.value || '', key = document.querySelector('[data-h-key]')?.value || '';
      const result = savePartyConfig(url, key);
      if (!result.ok) { S.configError = result.error; render(); return; }
      S.configError = '';
      await refreshConfig();
    } else if (action === 'retry-config') { await refreshConfig(); }
    else if (action === 'forget-config') {
      try { localStorage.removeItem(CONFIG_STORAGE_KEY); } catch {}
      S.config = null;
      render();
    } else if (action === 'open-lobby') { await openLobby(); }
    else if (action === 'copy-link') {
      const url = inviteUrl();
      try { await navigator.clipboard.writeText(url); event.target.textContent = 'Copied ✓'; }
      catch {
        const area = document.createElement('textarea');
        area.value = url; document.body.appendChild(area); area.select();
        try { document.execCommand('copy'); } catch {}
        area.remove();
      }
    } else if (action === 'start-race') {
      try { S.host.startRace(); } catch (error) { window.alert(error.message); }
    } else if (action === 'end-race') { S.host.endRaceEarly(); }
    else if (action === 'again') { S.fireworksOn = false; S.lastQr = ''; S.host.backToLobby(); }
    else if (action === 'new-room') { location.reload(); }
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-h-track]')) { S.trackId = event.target.dataset.hTrack; store(TRACK_KEY, S.trackId); render(); }
    if (event.target.matches('[data-h-set]')) { S.setId = event.target.value; store(ACTIVE_KEY, S.setId); render(); }
  });
  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-h-base]')) { S.joinBase = event.target.value; store(BASE_KEY, S.joinBase); }
  });

  await refreshConfig();
  render();
}
