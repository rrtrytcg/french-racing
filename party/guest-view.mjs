// Learner device: join with a name, lock gears, answer challenges, watch the
// whiteboard. Instant local grading for feedback; the host grade is final.
import { GEARS } from '../engine.mjs';
import { ROUND_SECONDS } from './host.mjs';
import { GuestClient } from './guest.mjs';
import { launchFireworks } from './fireworks.mjs';
import {
  makeGuestId, loadPartyConfig, savePartyConfig, createSupabaseTransport,
} from './net.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rangeFor = (gear) => GEARS.find((item) => item.gear === gear) || { min: 1, max: 2 };

export async function bootGuest({ code, password }) {
  const main = document.querySelector('#main');
  const meta = document.querySelector('#race-meta');
  const idKey = `apex.guest.${code}`;
  let guestId = '';
  try {
    guestId = sessionStorage.getItem(idKey) || '';
    if (!guestId) { guestId = makeGuestId(); sessionStorage.setItem(idKey, guestId); }
  } catch { guestId = makeGuestId(); }
  const S = {
    config: null, configError: '', netStatus: 'offline', transport: null, transportPromise: null, client: null,
    name: '', password, joining: false, placed: [], challengeId: '', flash: '',
    seenRound: 0, prevPos: null, fireworksOn: false, timerId: 0, everSubscribed: false,
  };
  const setMeta = (text) => { meta.textContent = text; };
  const me = () => S.client?.snapshot().me || null;

  async function ensureTransport() {
    if (S.transport && S.client) return true;
    if (!S.config) return false;
    if (S.transportPromise) return S.transportPromise;

    S.transportPromise = (async () => {
      S.netStatus = 'connecting';
      render();
      try {
        const transport = await createSupabaseTransport({
          url: S.config.url, key: S.config.key, roomCode: code,
          onMessage: (payload) => S.client && S.client.handle(payload),
          onStatus: (status) => {
            const was = S.everSubscribed;
            S.netStatus = status === 'SUBSCRIBED' ? 'live' : status === 'CLOSED' ? 'offline' : 'reconnecting';
            if (status === 'SUBSCRIBED') {
              S.everSubscribed = true;
              if (was) S.client && S.client.requestSync();
            }
            const badge = document.querySelector('#net-badge');
            if (badge) badge.outerHTML = netBadge();
            else render();
          },
        });
        if (!transport.ready) {
          S.netStatus = 'error';
          S.transport = null;
          render();
          return false;
        }
        S.transport = transport;
        S.client = new GuestClient({ send: (payload) => S.transport.send(payload), roomCode: code, password: S.password, guestId });
        S.client.onView = onClientView;
        S.timerId = window.setInterval(tick, 500);
        return true;
      } catch (error) {
        S.netStatus = 'error';
        S.configError = `Could not reach the race server (${error.message || 'network error'}). Ask your teacher, then retry.`;
        render();
        return false;
      }
    })();
    try {
      return await S.transportPromise;
    } finally {
      S.transportPromise = null;
    }
  }

  function onClientView() {
    const snap = S.client.snapshot();
    if (snap.round !== S.seenRound && snap.round > 0) {
      S.seenRound = snap.round;
      S.placed = [];
      S.flash = flashFor(snap);
      if (snap.myStanding) S.prevPos = snap.myStanding.pos;
    }
    if (snap.phase === 'question' && snap.myChallenge && snap.myChallenge.id !== S.challengeId) {
      S.challengeId = snap.myChallenge.id;
      S.placed = [];
    }
    render(snap);
  }

  function flashFor(snap) {
    if (!me() || !snap.lastMoves.length) return '';
    const move = snap.lastMoves.find((m) => m.carId === me().carId);
    if (!move) return '';
    const now = snap.myStanding ? snap.myStanding.pos : null;
    let delta = '';
    if (now && S.prevPos && now !== S.prevPos) {
      delta = now < S.prevPos ? ` · up ${S.prevPos - now}!` : ` · down ${now - S.prevPos}`;
    }
    if (move.spin) return `Spin! The car slides to cell ${move.to}.`;
    return `+${move.movement} cells${now ? ` · P${now}` : ''}${delta}`;
  }

  function tick() {
    const fill = document.querySelector('#ptimer-fill'), text = document.querySelector('#ptimer-text');
    const snap = S.client ? S.client.snapshot() : null;
    if (fill && text && snap && snap.endsAt) {
      const total = Math.max(1, Math.ceil((snap.endsAt - Date.now()) / 1000));
      const left = Math.max(0, total);
      fill.style.width = `${Math.max(0, Math.min(100, (left / ROUND_SECONDS) * 100))}%`;
      text.textContent = left > 0 ? `${left}s left` : 'Revealing moves…';
    }
  }

  function netBadge() {
    const label = { live: '● Live', connecting: '● Joining…', reconnecting: '● Reconnecting…', offline: '● Offline', error: '● Failed' }[S.netStatus] || '● …';
    return `<span id="net-badge" class="net-badge ${S.netStatus}">${label}</span>`;
  }

  function timerHtml(snap) {
    return `<div class="ptimer"><div id="ptimer-fill" class="ptimer-fill"></div><span id="ptimer-text" class="ptimer-text"></span></div>`;
  }

  function meCard(snap) {
    const m = snap.me;
    if (!m) return '';
    const standing = snap.myStanding;
    return `<div class="me-card"><i class="car-chip big" style="background:${esc(m.color)}">${m.carNumber}</i><div><strong>${esc(m.name)}</strong><span class="how-copy">${esc(m.colorName)} car${standing ? ` · P${standing.pos} · cell ${standing.position}` : ''}</span></div></div>`;
  }

  function correctionHtml(result) {
    if (!result) return '';
    if (result.correction && result.correction.length) {
      return result.correction.map((part) => (part.changed ? `<b class="diff-chg">${esc(part.text)}</b>` : esc(part.text))).join('');
    }
    return esc(result.answer || '');
  }

  function resultHtml(result, sent) {
    if (!result) return '';
    const label = result.grade === 'correct' ? 'Full range' : result.grade === 'partial' ? 'Partial range' : result.grade === 'pass' ? 'Coast' : 'Keep rolling';
    return `<div class="result-box ${esc(result.grade)}"><div class="result-grade">${label}${sent ? ' · sent ✓' : ''}</div><p class="accepted">${correctionHtml(result)}</p><p class="feedback">${esc(result.feedback || '')}</p></div>`;
  }

  function joinView() {
    main.innerHTML = `<section class="guest-join" aria-labelledby="join-title">
      <div class="party-head"><div><span class="eyebrow">Classroom race · room ${esc(code)}</span><h1 id="join-title">Join the grid.</h1></div>${netBadge()}</div>
      ${S.config ? '' : `<div class="config-gate"><h3>Connect to the race server</h3><p class="how-copy">One tap per device. Ask your teacher for the two keys (or open the QR link again on the classroom network).</p>
        <label class="import-name">Project URL <input data-g-url placeholder="https://xyzcompany.supabase.co" autocomplete="off"/></label>
        <label class="import-name">Anon key <input data-g-key placeholder="eyJ…" autocomplete="off"/></label>
        ${S.configError ? `<p class="wear-warning">${esc(S.configError)}</p>` : ''}
        <button class="primary-button" data-g="save-config">Connect</button></div>`}
      ${S.config ? `<div class="panel-card">${S.password ? '' : '<label class="import-name">Room password <input data-g-pass maxlength="4" inputmode="numeric" placeholder="4 digits" autocomplete="off"/></label>'}<label class="import-name">Your name <input data-g-name maxlength="18" value="${esc(S.name)}" placeholder="Type your name" autocomplete="off"/></label>
        ${S.joining ? '<p class="how-copy">Joining…</p>' : '<button class="primary-button" data-g="join">Join room ' + esc(code) + '</button>'}</div>` : ''}
    </section>`;
    setMeta(`Join room ${code}`);
  }

  function lobbyView(snap) {
    main.innerHTML = `<section class="guest-lobby" aria-labelledby="lobby-title">
      <div class="party-head"><div><span class="eyebrow">Room ${esc(code)} · ${snap.roster.length} drivers in</span><h1 id="lobby-title">You are in!</h1></div>${netBadge()}</div>
      ${meCard(snap)}
      <div class="panel-card"><h3>Waiting for lights out…</h3><p class="how-copy">Watch the whiteboard. Your colour is <strong>${esc(snap.me.colorName)}</strong>, car <strong>${snap.me.carNumber}</strong>.</p>
      <div class="roster-grid compact">${snap.roster.map((p) => `<div class="roster-card ${p.online === false ? 'offline' : ''}"><i class="car-chip" style="background:${esc(p.color)}">${p.carNumber}</i><span class="roster-name">${esc(p.name)}</span></div>`).join('')}</div>
      <button class="text-button" data-g="leave">Leave room</button></div></section>`;
    setMeta('Waiting for lights out');
  }

  function gearView(snap) {
    const car = snap.myCar;
    const legal = (car && car.legal) || [];
    main.innerHTML = `<section class="guest-race" aria-labelledby="gear-title">
      <div class="party-head tight"><div><span class="eyebrow">Round ${snap.round} · choose fast, the clock runs</span><h1 id="gear-title">Pick a gear.</h1></div>${netBadge()}</div>
      ${timerHtml(snap)}${S.flash ? `<p class="flash">${esc(S.flash)}</p>` : ''}${meCard(snap)}
      <div class="panel-card"><div class="resource-strip"><span><b>${car.tyres}</b><small>tyres</small></span><span><b>${car.brakes}</b><small>brakes</small></span><span><b>G${car.gear}</b><small>now</small></span><span><b>${car.position}</b><small>cell</small></span></div>
      <div class="gear-strip big" role="group" aria-label="Choose gear">${GEARS.map((item) => `<button class="gear-button ${S.client.myGear === item.gear ? 'picked' : ''}" data-g-gear="${item.gear}" ${!legal.includes(item.gear) || S.client.myGear ? 'disabled' : ''}><strong>${item.gear}</strong><small>${item.min}–${item.max}</small></button>`).join('')}</div>
      <p class="how-copy">${S.client.myGear ? `Gear ${S.client.myGear} locked — your question is coming…` : 'Up one gear, or down two. Lock it to get your question.'}</p></div></section>`;
    setMeta(`Round ${snap.round} · pick a gear`);
  }

  function jumbleHtml(challenge) {
    const placed = S.placed;
    const pool = challenge.tokens.map((tok, i) => ({ tok, i })).filter(({ i }) => !placed.includes(i));
    const placedChips = placed.map((tokIndex, pos) => `<button class="jumble-chip placed" data-g-unplace="${pos}">${esc(challenge.tokens[tokIndex])}</button>`).join('') || '<span class="jumble-empty">Tap the words below in order…</span>';
    const poolChips = pool.map(({ tok, i }) => `<button class="jumble-chip" data-g-place="${i}">${esc(tok)}</button>`).join('');
    const complete = placed.length === challenge.tokens.length;
    return `<div class="jumble-placed">${placedChips}</div><div class="jumble-pool">${poolChips}</div><button class="primary-button" data-g="jumble-submit" ${complete ? '' : 'disabled'}>Check order</button>`;
  }

  function questionView(snap) {
    const c = snap.myChallenge;
    const inputArea = c.type === 'jumble' ? jumbleHtml(c) : `<form class="typed-answer" data-g-typed><input id="typed-answer" autocomplete="off" aria-label="Your answer" placeholder="Type your answer"/><button class="primary-button" type="submit">Check</button></form>`;
    main.innerHTML = `<section class="guest-race" aria-labelledby="q-title">
      <div class="party-head tight"><div><span class="eyebrow">Round ${snap.round} · gear ${c.gear}</span><h1 id="q-title">Answer to move.</h1></div>${netBadge()}</div>
      ${timerHtml(snap)}${meCard(snap)}
      <div class="challenge"><p class="challenge-prompt">${esc(c.prompt)}</p>${inputArea}<button class="text-button pass-button" data-g="pass">Pass this challenge</button><p class="hint">${esc(c.hint || '')}</p></div></section>`;
    setMeta(`Round ${snap.round} · answer`);
  }

  function waitingView(snap) {
    const shown = snap.myAck || snap.myGrade;
    main.innerHTML = `<section class="guest-race" aria-labelledby="wait-title">
      <div class="party-head tight"><div><span class="eyebrow">Round ${snap.round}</span><h1 id="wait-title">Answer sent.</h1></div>${netBadge()}</div>
      ${timerHtml(snap)}${meCard(snap)}
      ${resultHtml(shown, true)}
      <div class="panel-card"><h3>Watch the whiteboard</h3><p class="how-copy">The cars move when every driver has answered or the clock runs out.</p>${standingsMini(snap)}</div></section>`;
    setMeta(`Round ${snap.round} · waiting`);
  }

  function observingView(snap) {
    main.innerHTML = `<section class="guest-race"><div class="party-head tight"><div><span class="eyebrow">Round ${snap.round}</span><h1>You finished! 🏁</h1></div>${netBadge()}</div>
      ${meCard(snap)}<div class="panel-card"><h3>Final round running</h3>${standingsMini(snap)}</div></section>`;
    setMeta('Finished · watching');
  }

  function standingsMini(snap) {
    const rows = snap.standings.slice(0, 8);
    return `<div class="party-standings mini"><div class="tower-title"><span>Positions</span><span>${snap.standings.length} cars</span></div>
      ${rows.map((row) => `<div class="tower-row ${snap.me && row.carId === snap.me.carId ? 'current' : ''}"><span class="tower-pos">${row.pos}</span><i class="mini-chip" style="background:${esc(row.color)}"></i><span class="tower-name">${esc(row.name)}</span><span class="tower-dist">${row.position}</span></div>`).join('')}</div>`;
  }

  function deniedView(snap) {
    main.innerHTML = `<section class="guest-join"><div class="party-head"><div><span class="eyebrow">Room ${esc(code)}</span><h1>Could not join.</h1></div>${netBadge()}</div>
      <div class="panel-card"><p>${esc(snap.denial)}</p><button class="primary-button" data-g="retry">Try again</button></div></section>`;
    setMeta('Join refused');
  }

  function podiumView(snap) {
    const rows = snap.standings || [];
    const mine = snap.myStanding;
    const places = rows.slice(0, 3);
    main.innerHTML = `<section class="secondary-screen podium-screen party-podium" aria-labelledby="podium-title">
      <canvas id="fireworks" class="fireworks" aria-hidden="true"></canvas>
      <span class="eyebrow">Final classification · ${rows.length} drivers</span><h1 id="podium-title">${mine ? (mine.pos === 1 ? 'You win! 🏆' : `You finished P${mine.pos}!`) : 'Flag down.'}</h1>
      <div class="podium">${places.map((car, i) => `<div class="podium-place ${i === 0 ? 'first' : i === 1 ? 'second' : 'third'}"><div class="podium-car" style="background:${esc(car.color)}">${car.carNumber}</div><div class="podium-name">${esc(car.name)}</div><div class="podium-block">${i + 1}</div></div>`).reverse().join('')}</div>
      <table class="final-table"><thead><tr><th>Pos</th><th>Driver</th><th>Cell</th></tr></thead>
      <tbody>${rows.map((car, i) => `<tr class="${snap.me && car.carId === snap.me.carId ? 'me-row' : ''}"><td class="rank">${i + 1}</td><td><i class="mini-chip" style="background:${esc(car.color)}"></i> ${esc(car.name)}</td><td>${car.position}</td></tr>`).join('')}</tbody></table>
      <div class="button-row"><button class="outline-button" data-g="leave">Leave</button></div></section>`;
    setMeta('Final classification');
    if (!S.fireworksOn) {
      S.fireworksOn = true;
      launchFireworks(document.querySelector('#fireworks'));
    }
  }

  function render(snap) {
    snap = snap || (S.client ? S.client.snapshot() : null);
    if (!S.config || !S.client) { joinView(); return; }
    if (snap.status === 'denied') deniedView(snap);
    else if (snap.status === 'lobby' || (snap.status === 'join' && snap.me)) lobbyView(snap);
    else if (snap.status === 'finished') podiumView(snap);
    else if (snap.status === 'racing') {
      if (snap.phase === 'gear') gearView(snap);
      else if (snap.phase === 'question') questionView(snap);
      else if (snap.phase === 'observing') observingView(snap);
      else waitingView(snap);
    }
    else joinView();
  }

  document.addEventListener('click', async (event) => {
    const gear = event.target.closest('[data-g-gear]');
    if (gear && !gear.disabled) { S.client.lockGear(Number(gear.dataset.gGear)); return; }
    const place = event.target.closest('[data-g-place]');
    if (place) {
      const index = Number(place.dataset.gPlace);
      if (!S.placed.includes(index)) { S.placed = [...S.placed, index]; render(); }
      return;
    }
    const unplace = event.target.closest('[data-g-unplace]');
    if (unplace) {
      const pos = Number(unplace.dataset.gUnplace);
      S.placed = S.placed.filter((_, i) => i !== pos);
      render();
      return;
    }
    const action = event.target.closest('[data-g]')?.dataset.g;
    if (!action) return;
    if (action === 'save-config') {
      const url = document.querySelector('[data-g-url]')?.value || '', key = document.querySelector('[data-g-key]')?.value || '';
      const result = savePartyConfig(url, key);
      if (!result.ok) { S.configError = result.error; render(); return; }
      S.configError = '';
      S.config = await loadPartyConfig();
      render();
    } else if (action === 'join') {
      const name = document.querySelector('[data-g-name]')?.value || '';
      S.name = name;
      if (!(await ensureTransport())) return;
      const result = S.client.join(name);
      if (!result.ok) { window.alert(result.error); return; }
      S.joining = true;
      render();
    } else if (action === 'retry' || action === 'rejoin') {
      S.joining = false;
      S.fireworksOn = false;
      if (S.client) {
        S.client.status = 'join';
        S.client.denial = '';
        S.client.me = null;
      }
      render();
    } else if (action === 'jumble-submit') {
      const snap = S.client.snapshot();
      if (snap.myChallenge && S.placed.length === snap.myChallenge.tokens.length) {
        S.client.submitAnswer(S.placed.map((i) => snap.myChallenge.tokens[i]).join(' '));
      }
    } else if (action === 'pass') {
      S.client.submitAnswer('');
    } else if (action === 'leave') {
      try { S.transport.send({ kind: 'leave', guestId }); } catch {}
      location.reload();
    }
  });
  document.addEventListener('submit', (event) => {
    if (event.target.matches('[data-g-typed]')) {
      event.preventDefault();
      S.client.submitAnswer(event.target.querySelector('input')?.value || '');
    }
  });
  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-g-name]')) S.name = event.target.value;
    if (event.target.matches('[data-g-pass]')) S.password = event.target.value.replace(/\D/g, '').slice(0, 4);
  });

  S.config = await loadPartyConfig();
  if (S.config) await ensureTransport();
  render();
}
