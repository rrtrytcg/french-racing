import {
  GEARS, createRace, currentCar, legalGears,
  chooseGear, resolveAnswer, previewMove, commitMove, runBotTurn, standings
} from './engine.mjs';
import { TRACKS, getTrack, DEFAULT_TRACK_ID } from './tracks.mjs';
import { DEMO_BANK, getChallenge, gradeAnswer, correctionDiff, parsePairSet, getSetChallenge, shuffledOrder, gearChallengeCount } from './content.mjs';
import { sampleTrack, carTransform, trackSvg, tower } from './party/trackview.mjs';

const main = document.querySelector('#main');
const raceMeta = document.querySelector('#race-meta');
const soundToggle = document.querySelector('#sound-toggle');
const carColors = ['#f05a47', '#23b5aa', '#f2b84b', '#7587ed'];
const carNames = ['You', 'Mara', 'Noé', 'Sacha'];
const visualPositions = new Map();
const serials = new Map();
let soundOn = false;
let animationBusy = false;
let audioContext;
let partyBoot = false;

const ui = {
  screen: 'setup', mode: 'solo', localCount: 2, race: null, challenge: null, grade: null,
  brakes: 0, seed: null, names: ['You', 'Mara', 'Noé', 'Sacha'],
  jumblePlaced: [], correction: null,
  sets: [], activeSetId: 'builtin', importName: '', importText: '', importErrors: [], orders: {},
  trackId: DEFAULT_TRACK_ID
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const activeCar = () => ui.race ? currentCar(ui.race) : null;
const displayName = (car) => car?.name || carNames[car?.id] || `Car ${Number(car?.id ?? 0) + 1}`;
const carIndex = (car, cars = ui.race?.cars || []) => Math.max(0, cars.findIndex((item) => item.id === car?.id));
const carColor = (car, cars = ui.race?.cars || []) => car?.color || carColors[carIndex(car, cars) % carColors.length];
const isHumanTurn = (car = activeCar()) => Boolean(car?.human && !car.retired && !car.finished);
const soloViewOpts = () => ({
  activeId: activeCar()?.id || null,
  visualPositions,
  colorOf: (car, cars) => carColor(car, cars),
  nameOf: (car) => displayName(car),
  indexOf: (car, cars) => carIndex(car, cars),
});
const rangeFor = (gear) => GEARS.find((item) => item.gear === gear) || {min: 1, max: 2, label: ''};
const SETS_KEY = 'apex.sets.v1';
const ACTIVE_KEY = 'apex.activeSet.v1';
const TRACK_KEY = 'apex.track.v1';
const AI_SET_PROMPT = `Write 24 simple French sentences for A1 English-speaking learners on the theme of [THEME — for example: food and drink].
Rules:
- Simple present tense, high-frequency words, under 14 words per sentence.
- Vary the sentences: statements, likes, descriptions, things people do.
- Mix masculine and feminine forms across different sentences.
Output format (important — follow it exactly):
- One pair per line.
- English sentence, then space, then =, then space, then the French sentence.
- No numbering, no bullets, no extra commentary.
Example:
I like apples. = J'aime les pommes.
She plays football. = Elle joue au foot.`;

const builtinSet = () => ({ id: 'builtin', name: DEMO_BANK.title, title: DEMO_BANK.title, description: DEMO_BANK.description, phrases: DEMO_BANK.phrases, gradingNote: DEMO_BANK.gradingNote, builtin: true });
const activeSet = () => ui.sets.find((set) => set.id === ui.activeSetId) || builtinSet();
const activeChallenge = (gear, serial) => {
  const set = activeSet();
  return set.builtin ? getChallenge(gear, serial) : getSetChallenge(set, gear, serial);
};
function orderFor(carId, gear) {
  const key = `${carId}:${gear}`;
  const set = activeSet();
  const length = set.builtin ? gearChallengeCount(gear) : set.gears[gear].length;
  if (!ui.orders[key] || ui.orders[key].length !== length) {
    ui.orders[key] = shuffledOrder(length, `${ui.seed}|${carId}|${gear}`);
  }
  return ui.orders[key];
}
function loadStoredPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETS_KEY) || '[]');
    ui.sets = Array.isArray(parsed) ? parsed.filter((set) => set && typeof set.id === 'string' && set.gears && Array.isArray(set.phrases)) : [];
  } catch { ui.sets = []; }
  try {
    const active = localStorage.getItem(ACTIVE_KEY);
    ui.activeSetId = active && (active === 'builtin' || ui.sets.some((set) => set.id === active)) ? active : 'builtin';
  } catch { ui.activeSetId = 'builtin'; }
  try {
    const track = localStorage.getItem(TRACK_KEY);
    ui.trackId = track && TRACKS.some((entry) => entry.id === track) ? track : DEFAULT_TRACK_ID;
  } catch { ui.trackId = DEFAULT_TRACK_ID; }
}
function persistPrefs() {
  try { localStorage.setItem(SETS_KEY, JSON.stringify(ui.sets)); localStorage.setItem(ACTIVE_KEY, ui.activeSetId); localStorage.setItem(TRACK_KEY, ui.trackId); return true; }
  catch { return false; }
}
const raceTrack = () => {
  try { return getTrack((ui.race && ui.race.track && ui.race.track.id) || DEFAULT_TRACK_ID); }
  catch { return getTrack(DEFAULT_TRACK_ID); }
};







function eventLines() {
  return (ui.race?.log || []).slice(-5).reverse().map((line) => `<p class="event-line">${esc(typeof line === 'string' ? line : line.message)}</p>`).join('') || '<p class="event-line">The grid is waiting.</p>';
}

function setsHtml() {
  const sets = [builtinSet(), ...ui.sets];
  const rows = sets.map((set) => {
    const count = set.builtin ? set.phrases.length : (set.pairs ? set.pairs.length : set.phrases.length);
    const meta = set.builtin ? `Built-in · ${count} phrases` : `Imported · ${count} pairs`;
    return `<div class="set-row ${set.id === ui.activeSetId ? 'active' : ''}"><label class="set-pick"><input type="radio" name="sentence-set" data-set-id="${esc(set.id)}" ${set.id === ui.activeSetId ? 'checked' : ''}/><span class="set-name">${esc(set.name || set.title)}</span><span class="set-meta">${esc(meta)}</span></label>${set.builtin ? '' : `<button class="set-delete" data-action="delete-set" data-set-id="${esc(set.id)}" aria-label="Delete ${esc(set.name)}">×</button>`}</div>`;
  }).join('');
  const errors = (ui.importErrors || []).map((err) => `<li>${esc(err)}</li>`).join('');
  return `<details class="sets-section"><summary>Teacher: sentence sets · ${esc(activeSet().title)}</summary>${rows}<div class="import-box"><strong>Import a new set</strong><p class="how-copy">One pair per line. English sentence, then <code>=</code>, then the French sentence. At least 6 lines, at most 60. Blank lines are ignored.</p><pre class="format-sample">I like apples. = J'aime les pommes.\nShe plays football. = Elle joue au foot.</pre><label class="import-name">Set name <input data-import-name value="${esc(ui.importName)}" maxlength="60" placeholder="Pass 02 · Food"/></label><textarea class="import-text" data-import-text rows="5" placeholder="I like apples. = J'aime les pommes.">${esc(ui.importText)}</textarea>${errors ? `<ul class="import-errors">${errors}</ul>` : ''}<button class="primary-button import-button" data-action="import-set">Import set</button><details class="prompt-details"><summary>Generate a set with AI instead</summary><p class="how-copy">Copy this prompt into any AI chat, change the theme, then paste the pairs above. AI sets are a quick start — your own sentences are always better.</p><pre class="prompt-text">${esc(AI_SET_PROMPT)}</pre><button class="outline-button" data-action="copy-prompt">Copy prompt</button></details></div></details>`;
}

function tracksHtml() {
  return `<div class="tracks-section"><h3>Circuit</h3><div class="track-grid">${TRACKS.map((track) => `<label class="track-pick ${track.id === ui.trackId ? 'active' : ''}"><input type="radio" name="circuit" data-track-id="${track.id}" ${track.id === ui.trackId ? 'checked' : ''}/><svg class="mini-track" viewBox="60 20 1056 580" aria-hidden="true"><path d="${track.pathD}" class="mini-outline"/><path d="${track.pathD}" class="mini-asphalt"/></svg><span class="track-pick-name">${esc(track.name)}</span><span class="track-pick-meta">${track.length} cells · ${track.corners.length} corners</span></label>`).join('')}</div></div>`;
}

function setupView() {
  const count = ui.mode === 'solo' ? 1 : ui.localCount;
  const localCountControl = ui.mode === 'local' ? `<label class="count-select">Drivers <select data-local-count aria-label="Number of local drivers">${[2,3,4].map((n) => `<option value="${n}" ${ui.localCount === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : '';
  main.innerHTML = `<section class="setup" aria-labelledby="setup-title"><div class="setup-copy"><span class="eyebrow">Harbour circuit · language race</span><h1 id="setup-title">Pick your<br/><em>line.</em></h1><p class="lede">Read the phrase bank, choose your gear, and hold your nerve through three corners. Every answer changes the movement range. The last light is waiting.</p><div class="start-line"><button class="primary-button" type="button" data-action="start">Set the grid <span aria-hidden="true">↗</span></button><button class="text-button" type="button" data-action="practice">Phrase practice →</button><a class="text-button" href="#/host">Host classroom race →</a></div></div><section class="setup-card" aria-label="Race setup"><div class="card-heading"><h2>Set up the race</h2><span>${ui.mode === 'solo' ? '1 driver · 3 rivals' : `${count} drivers · local`}</span></div><div class="mode-tabs" role="tablist" aria-label="Race mode"><button class="mode-tab ${ui.mode === 'solo' ? 'active' : ''}" data-mode="solo" role="tab" aria-selected="${ui.mode === 'solo'}">Solo</button><button class="mode-tab ${ui.mode === 'local' ? 'active' : ''}" data-mode="local" role="tab" aria-selected="${ui.mode === 'local'}">Local grid</button></div>${localCountControl}<div class="name-fields">${ui.names.slice(0, count).map((name, i) => `<label class="name-row"><i class="car-chip" style="background:${carColors[i]}">${i+1}</i><input data-name-index="${i}" value="${esc(name)}" maxlength="18" aria-label="Driver ${i+1} name" placeholder="Driver ${i+1}"/></label>`).join('')}${ui.mode === 'solo' ? '<p class="how-copy">Three seeded rivals will use the same gear, question and movement rules as you.</p>' : '<p class="how-copy">Pass freely on the broad circuit. This local mode shares one screen and has no online connection.</p>'}</div><div class="setup-actions"><span class="how-copy">${esc(activeSet().description)}</span><button class="primary-button" type="button" data-action="start">Start lights</button></div>${tracksHtml()}${setsHtml()}<div class="practice-box"><strong>Before lights out</strong><p>Practice shows the full phrase bank. Scored challenges reveal the accepted answer only after you respond.</p></div></section></section>`;
  raceMeta.textContent = 'Ready for lights out';
}

function rulesView() {
  main.innerHTML = `<section class="secondary-screen" aria-labelledby="rules-title"><span class="eyebrow">APEX race briefing</span><h1 id="rules-title">How to race</h1><p>Choose a gear before you see the challenge. Your answer sets a seeded movement roll; spend brakes after the result to place the car exactly where you want it.</p><div class="rules-grid"><div class="rule-item"><strong>Six gears</strong><p>1: 1–2 · 2: 2–4 · 3: 4–8 · 4: 7–12 · 5: 11–20 · 6: 21–30. Up one gear; down two costs one brake.</p></div><div class="rule-item"><strong>Three outcomes</strong><p>Correct uses the full range. Partial uses its lower half. Miss uses the lower fallback. Pass is 1–2. No retries.</p></div><div class="rule-item"><strong>Brake preview</strong><p>After your answer, spend up to three brakes and never below one cell. The control shows your exact landing and wear before commit.</p></div><div class="rule-item"><strong>Corner discipline</strong><p>Esses 24–32 needs 1 stop. Harbour Hairpin 62–74 needs 2. Last Light 106–116 needs 1. Missing stops costs tyres and may spin you.</p></div><div class="rule-item"><strong>Finish</strong><p>Cross cell 144 to finish. The final round lets every driver complete a turn, so positions at the flag can still change.</p></div><div class="rule-item"><strong>Language bank</strong><p>${esc(activeSet().gradingNote)}</p></div><div class="rule-item"><strong>Sentence sets</strong><p>Race the built-in set or import your own: one English = French pair per line. Generate drafts with any AI chat using the setup-screen prompt.</p></div></div><button class="primary-button" data-action="back">Back to setup</button></section>`;
  raceMeta.textContent = 'Rules briefing';
}

function practiceView() {
  const set = activeSet();
  main.innerHTML = `<section class="secondary-screen" aria-labelledby="practice-title"><span class="eyebrow">Warm-up lap</span><h1 id="practice-title">Phrase practice: ${esc(set.title)}</h1><p>${esc(set.description)}</p><div class="practice-list">${set.phrases.map((phrase) => `<div class="phrase-row"><strong>${esc(phrase.fr)}</strong><span>${esc(phrase.en)}</span></div>`).join('')}</div><p class="how-copy">${esc(set.gradingNote)}</p><button class="primary-button" data-action="back">Back to setup</button></section>`;
  raceMeta.textContent = 'Phrase practice';
}

function gearButtons(car) {
  let legal = [];
  try { legal = legalGears(car); } catch { legal = GEARS.map((item) => item.gear); }
  return GEARS.map((item) => `<button class="gear-button ${car.gear === item.gear ? 'active' : ''}" data-gear="${item.gear}" ${ui.race.phase !== 'gear' || !legal.includes(item.gear) || animationBusy ? 'disabled' : ''} aria-label="Gear ${item.gear}, ${item.min} to ${item.max} cells"><strong>${item.gear}</strong><small>${item.min}–${item.max}</small></button>`).join('');
}

function nextCorner(car, track) {
  const corner = track.corners.find((item) => car.position < item.start);
  if (!corner) return '<span>Next corner</span><strong>Clear run to the flag</strong>';
  return `<span>Next corner · ${esc(corner.name)}</span><strong>${corner.start - car.position} cells · ${corner.stops} stop${corner.stops > 1 ? 's' : ''}</strong>`;
}

function jumbleHtml(c) {
  const placed = ui.jumblePlaced || [];
  const pool = c.tokens.map((tok, i) => ({ tok, i })).filter(({ i }) => !placed.includes(i));
  const placedChips = placed.map((tokIndex, pos) => `<button class="jumble-chip placed" data-placed-index="${pos}" ${ui.grade || animationBusy ? 'disabled' : ''} aria-label="Remove ${esc(c.tokens[tokIndex])}">${esc(c.tokens[tokIndex])}</button>`).join('') || '<span class="jumble-empty">Tap the words below in order…</span>';
  const poolChips = pool.map(({ tok, i }) => `<button class="jumble-chip" data-token-id="${i}" ${ui.grade || animationBusy ? 'disabled' : ''}>${esc(tok)}</button>`).join('');
  const complete = placed.length === c.tokens.length;
  return `<div class="jumble-placed" aria-live="polite">${placedChips}</div><div class="jumble-pool">${poolChips}</div><div class="jumble-actions"><button class="primary-button" data-action="jumble-submit" ${!complete || ui.grade || animationBusy ? 'disabled' : ''}>Check order</button></div>`;
}

function correctionHtml() {
  if (ui.correction && ui.correction.length) {
    return ui.correction.map((part) => part.changed ? `<b class="diff-chg">${esc(part.text)}</b>` : esc(part.text)).join('');
  }
  return esc(ui.grade.answer);
}

function challengeHtml() {
  if (!ui.challenge) return '';
  const c = ui.challenge;
  const inputArea = c.type === 'jumble' ? jumbleHtml(c) : `<form class="typed-answer" data-action="typed-submit"><input id="typed-answer" autocomplete="off" ${ui.grade || animationBusy ? 'disabled' : ''} aria-label="Your answer" placeholder="Type your answer"/><button class="primary-button" type="submit" ${ui.grade || animationBusy ? 'disabled' : ''}>Check</button></form>`;
  return `<div class="challenge"><div class="challenge-label"><span>Gear ${c.gear} challenge</span><span>${c.type === 'jumble' ? 'Put in order' : 'Type your answer'}</span></div><p class="challenge-prompt">${esc(c.prompt)}</p>${ui.grade ? `<div class="result-box ${ui.grade.grade}"><div class="result-grade">${ui.grade.grade === 'correct' ? 'Full range' : ui.grade.grade === 'partial' ? 'Partial range' : ui.grade.grade === 'pass' ? 'Coast' : 'Keep rolling'}</div><p class="accepted">${correctionHtml()}</p><p class="feedback">${esc(ui.grade.feedback)}</p></div>` : `${inputArea}<button class="text-button pass-button" data-action="pass-answer">Pass this challenge</button>`}<p class="hint">${esc(c.hint || '')}</p></div>`;
}

function turnPanel(car, track) {
  if (ui.race.phase === 'finished') return '<div class="panel-card turn-panel"><div class="panel-kicker">Race complete</div><h2>Flag down.</h2><p class="subline">The final standings are ready.</p><button class="primary-button" data-action="podium">View podium</button></div>';
  if (!car) return '<div class="panel-card turn-panel"><h2>No active car</h2></div>';
  if (car.retired || car.finished) return `<div class="panel-card turn-panel"><div class="panel-kicker">${car.retired ? 'Car retired' : 'Finished'}</div><h2>${esc(displayName(car))}</h2><p class="subline">${car.retired ? 'The field is still moving. Continue watching the race.' : 'You are across the line. Watch the final round.'}</p><button class="primary-button" data-action="observe">Continue race</button></div>`;
  const preview = ui.grade ? previewMove(ui.race, ui.brakes) : null;
  return `<div class="panel-card turn-panel"><div class="panel-kicker">${car.human ? 'Your turn' : 'Rival turn'}</div><h2>${esc(displayName(car))}</h2><div class="resource-strip"><span><b>${car.tyres ?? '—'}</b><small>tyres</small></span><span><b>${car.brakes ?? '—'}</b><small>brakes</small></span><span><b>G${car.gear ?? '—'}</b><small>current gear</small></span></div><p class="subline">${ui.race.phase === 'gear' ? 'Choose a gear. The challenge arrives after the lock.' : ui.race.phase === 'question' ? 'Answer the prompt to set your movement range.' : 'Shape the landing, then commit your move.'}</p>${ui.race.phase === 'gear' ? `<div class="gear-strip" role="group" aria-label="Choose gear">${gearButtons(car)}</div><div class="gear-help"><span>Up one · down two</span><span>Gear sets risk</span></div>` : ''}${challengeHtml()}${preview ? `<div class="brake-preview"><div class="preview-line"><span>Seeded roll</span><strong>${ui.race.pending?.roll ?? (preview.movement + ui.brakes)} cells</strong></div><div class="preview-line landing"><span>Projected landing</span><strong>${preview.to}/${track.length}</strong></div><div class="preview-line"><span>Tyre wear</span><strong>${preview.tyreCost ? `−${preview.tyreCost} tyres` : 'No extra wear'}</strong></div><div class="brake-controls"><div class="brake-stepper"><button class="step-button" data-brake="-1" ${ui.brakes <= 0 || animationBusy ? 'disabled' : ''}>−</button><span class="brake-count">${ui.brakes} / 3</span><button class="step-button" data-brake="1" ${ui.brakes >= Math.min(3, car.brakes, Math.max(0, (ui.race.pending?.roll ?? 1) - 1)) || animationBusy ? 'disabled' : ''}>+</button></div><button class="primary-button commit-button" data-action="commit" ${animationBusy ? 'disabled' : ''}>Commit move ↗</button></div>${preview.spin ? '<p class="wear-warning">This landing spins the car and resets it to gear 1.</p>' : preview.retired ? '<p class="wear-warning">Tyres exhausted. This car will auto-repair before the next learning turn.</p>' : ''}</div>` : ''}<div class="next-corner">${nextCorner(car, track)}</div></div>`;
}

function raceView() {
  const cars = ui.race.cars || [], car = activeCar(), round = ui.race.round || 1, track = raceTrack();
  main.innerHTML = `<section class="race" aria-labelledby="race-title"><div class="race-head"><h1 id="race-title"><small>${track.name} · Grand Prix</small>${esc(track.title)}</h1><div class="lap-readout"><span>Round <b>${round}</b></span><span>Turn <b>${(ui.race.turnIndex ?? 0) + 1}</b></span></div></div><div class="race-layout"><div class="track-card">${trackSvg(cars, track, soloViewOpts())}${tower(cars, track, soloViewOpts())}<div class="track-key"><span><i class="orange-key"></i>corner</span><span><i class="teal-key"></i>alternate line</span></div>${animationBusy ? '<div class="busy-mask">Cars moving · watch the line</div>' : ''}</div><aside class="race-side">${turnPanel(car, track)}<div class="panel-card event-log"><h3>Race radio</h3>${eventLines()}</div></aside></div></section>`;
  raceMeta.textContent = `Round ${round} · ${car ? displayName(car) : 'Race complete'}`;
}

function podiumView() {
  const rows = standings(ui.race) || [], places = rows.slice(0, 3), track = raceTrack();
  main.innerHTML = `<section class="secondary-screen podium-screen" aria-labelledby="podium-title"><span class="eyebrow">${esc(track.name)} · final classification</span><h1 id="podium-title">Flag down.</h1><p class="podium-subtitle">${rows[0] ? `${esc(displayName(rows[0]))} takes the chequered flag.` : 'The race is complete.'}</p><div class="podium">${places.map((car,i) => `<div class="podium-place ${i === 0 ? 'first' : i === 1 ? 'second' : 'third'}"><div class="podium-car" style="background:${carColor(car, rows)}">${carIndex(car, rows) + 1}</div><div class="podium-name">${esc(displayName(car))}</div><div class="podium-block">${i + 1}</div></div>`).reverse().join('')}</div><table class="final-table"><thead><tr><th>Pos</th><th>Driver</th><th>Distance</th><th>Status</th></tr></thead><tbody>${rows.map((car,i) => `<tr><td class="rank">${i+1}</td><td>${esc(displayName(car))}</td><td>${car.position}/${track.length}</td><td>${car.retired ? 'DNF' : car.finished ? 'Finished' : 'Not finished'}</td></tr>`).join('')}</tbody></table><div class="button-row"><button class="outline-button" data-action="practice">Language recap</button><button class="primary-button" data-action="restart">Race again</button></div></section>`;
  raceMeta.textContent = 'Final classification';
}

function render() {
  if (ui.screen === 'setup') setupView();
  else if (ui.screen === 'rules') rulesView();
  else if (ui.screen === 'practice') practiceView();
  else if (ui.screen === 'podium') podiumView();
  else raceView();
}

function playBlip(frequency = 140) {
  if (!soundOn) return;
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.frequency.value = frequency; oscillator.type = 'triangle';
    gain.gain.setValueAtTime(.035, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .11);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + .12);
  } catch {}
}

function animateEvent(event) {
  if (!event) return Promise.resolve();
  const car = ui.race.cars.find((item) => item.id === event.carId) || ui.race.cars.find((item) => item.name === event.name);
  if (!car) return Promise.resolve();
  const track = raceTrack();
  visualPositions.set(car.id, event.from); render();
  const start = performance.now(), duration = Math.max(520, Math.min(1050, 420 + Math.abs(event.movement || event.to - event.from) * 26));
  return new Promise((resolve) => {
    const frame = (now) => {
      const progress = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - progress, 3);
      const current = event.from + (event.to - event.from) * eased;
      visualPositions.set(car.id, current);
      const carEl = document.querySelector(`#car-${CSS.escape(String(car.id))}`), points = sampleTrack(track.pathD, track.length);
      if (carEl && points.length) {
        const same = ui.race.cars.filter((item) => item.position === car.position), lane = Math.max(-1.5, same.indexOf(car) - (same.length - 1) / 2) * 1.8;
        carEl.setAttribute('transform', carTransform(current, lane, points, track.length));
      }
      if (progress < 1) requestAnimationFrame(frame);
      else { visualPositions.delete(car.id); resolve(); }
    };
    requestAnimationFrame(frame);
  });
}

async function runBotsUntilHuman() {
  if (!ui.race) return;
  animationBusy = true; render();
  let guard = 0;
  while (ui.race.phase !== 'finished' && guard++ < 80) {
    const car = activeCar();
    if (!car) break;
    if (car.human && !car.retired && !car.finished) break;
    if (car.human) { break; }
    const result = runBotTurn(ui.race), event = result?.movement != null ? result : ui.race.lastEvent;
    await animateEvent(event);
  }
  animationBusy = false;
  if (ui.race.phase === 'finished') ui.screen = 'podium';
  render();
}

async function commitHumanMove() {
  if (!ui.race || animationBusy || !ui.grade) return;
  const car = activeCar(); if (!car) return;
  let event;
  try {
    const result = commitMove(ui.race, ui.brakes);
    event = result?.movement != null ? result : ui.race.lastEvent;
  } catch (error) { ui.race.lastEvent = {message: error.message}; render(); return; }
  ui.grade = null; ui.challenge = null; ui.correction = null; ui.jumblePlaced = []; ui.brakes = 0; animationBusy = true;
  await animateEvent(event); animationBusy = false;
  if (ui.race.phase === 'finished') { ui.screen = 'podium'; render(); return; }
  await runBotsUntilHuman();
}

function lockGear(gear) {
  if (!ui.race || animationBusy || ui.race.phase !== 'gear') return;
  const car = activeCar();
  if (!isHumanTurn(car)) return;
  try {
    chooseGear(ui.race, Number(gear));
    const perCar = serials.get(car.id) || {}, serial = perCar[gear] || 0;
    const order = orderFor(car.id, Number(gear));
    ui.challenge = activeChallenge(Number(gear), order[serial % order.length]);
    perCar[gear] = serial + 1; serials.set(car.id, perCar);
    ui.grade = null; ui.correction = null; ui.jumblePlaced = []; ui.brakes = 0; playBlip(220); render();
  } catch (error) { ui.race.lastEvent = {message: error.message}; render(); }
}

function answer(value) {
  if (!ui.race || !ui.challenge || animationBusy || ui.race.phase !== 'question') return;
  try {
    const graded = gradeAnswer(ui.challenge, value);
    resolveAnswer(ui.race, graded.grade);
    ui.grade = graded; ui.correction = correctionDiff(ui.challenge, value); ui.brakes = 0; playBlip(graded.grade === 'correct' ? 360 : 160); render();
  } catch (error) { ui.race.lastEvent = {message: error.message}; render(); }
}

function placeToken(index) {
  if (!ui.challenge || ui.challenge.type !== 'jumble' || ui.grade || animationBusy) return;
  if (!Number.isInteger(index) || index < 0 || index >= ui.challenge.tokens.length) return;
  if ((ui.jumblePlaced || []).includes(index)) return;
  ui.jumblePlaced = [...(ui.jumblePlaced || []), index];
  playBlip(280); render();
}

function unplaceToken(position) {
  if (!ui.challenge || ui.challenge.type !== 'jumble' || ui.grade || animationBusy) return;
  if (!Number.isInteger(position) || position < 0 || position >= (ui.jumblePlaced || []).length) return;
  ui.jumblePlaced = (ui.jumblePlaced || []).filter((_, i) => i !== position);
  render();
}

function submitJumble() {
  if (!ui.challenge || ui.challenge.type !== 'jumble' || ui.grade || animationBusy) return;
  if ((ui.jumblePlaced || []).length !== ui.challenge.tokens.length) return;
  answer((ui.jumblePlaced || []).map((i) => ui.challenge.tokens[i]).join(' '));
}

function importSet() {
  ui.importName = document.querySelector('[data-import-name]')?.value || '';
  ui.importText = document.querySelector('[data-import-text]')?.value || '';
  const result = parsePairSet(ui.importText, ui.importName);
  if (!result.ok) { ui.importErrors = result.errors; render(); return; }
  ui.sets = [...ui.sets, result.set];
  ui.activeSetId = result.set.id;
  if (!persistPrefs()) {
    ui.sets = ui.sets.filter((set) => set.id !== result.set.id);
    ui.activeSetId = 'builtin';
    ui.importErrors = ['Could not save the set in this browser (storage blocked or full).'];
    render(); return;
  }
  ui.importName = ''; ui.importText = ''; ui.importErrors = [];
  render();
}

function deleteSet(id) {
  if (!id || id === 'builtin') return;
  ui.sets = ui.sets.filter((set) => set.id !== id);
  if (ui.activeSetId === id) ui.activeSetId = 'builtin';
  persistPrefs(); render();
}

function copyPrompt(event) {
  const button = event.target.closest('[data-action="copy-prompt"]');
  const done = () => { if (button) button.textContent = 'Copied ✓'; };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(AI_SET_PROMPT).then(done).catch(() => fallbackCopy(done));
  else fallbackCopy(done);
}

function fallbackCopy(done) {
  try {
    const area = document.createElement('textarea');
    area.value = AI_SET_PROMPT; document.body.appendChild(area); area.select();
    document.execCommand('copy'); area.remove(); done();
  } catch {}
}

function startRace() {
  const count = ui.mode === 'solo' ? 4 : ui.localCount;
  const names = Array.from({length: count}, (_,i) => {
    const input = document.querySelector(`[data-name-index="${i}"]`);
    const value = input?.value.trim();
    return value || (ui.mode === 'solo' && i > 0 ? carNames[i] : `Driver ${i+1}`);
  });
  ui.names = names; ui.seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  ui.race = createRace({names, humanCount: ui.mode === 'solo' ? 1 : count, seed: ui.seed, trackId: ui.trackId});
  ui.screen = 'race'; ui.challenge = null; ui.grade = null; ui.correction = null; ui.jumblePlaced = []; ui.brakes = 0; serials.clear(); visualPositions.clear(); ui.orders = {};
  render(); main.focus({preventScroll:true});
}

function toggleSound() {
  soundOn = !soundOn; soundToggle.setAttribute('aria-pressed', String(soundOn));
  soundToggle.title = soundOn ? 'Sound is on' : 'Sound is muted'; soundToggle.textContent = soundOn ? '◉' : '◌';
  if (soundOn) playBlip(300);
}

document.addEventListener('click', (event) => {
  if (partyBoot) return;
  const mode = event.target.closest('[data-mode]');
  if (mode) { ui.mode = mode.dataset.mode; render(); return; }
  const gear = event.target.closest('[data-gear]');
  if (gear) { lockGear(gear.dataset.gear); return; }
  const poolTok = event.target.closest('[data-token-id]');
  if (poolTok && !poolTok.disabled) { placeToken(Number(poolTok.dataset.tokenId)); return; }
  const placedTok = event.target.closest('[data-placed-index]');
  if (placedTok && !placedTok.disabled) { unplaceToken(Number(placedTok.dataset.placedIndex)); return; }
  const brake = event.target.closest('[data-brake]');
  if (brake) { ui.brakes = Math.max(0, Math.min(3, ui.brakes + Number(brake.dataset.brake))); render(); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'start') startRace();
  else if (action === 'practice') { ui.screen = 'practice'; render(); }
  else if (action === 'rules') { ui.screen = 'rules'; render(); }
  else if (action === 'back') { ui.screen = ui.race ? 'race' : 'setup'; render(); }
  else if (action === 'home') { if (!animationBusy) { ui.screen = 'setup'; ui.race = null; render(); } }
  else if (action === 'commit') commitHumanMove();
  else if (action === 'jumble-submit') submitJumble();
  else if (action === 'podium') { ui.screen = 'podium'; render(); }
  else if (action === 'restart') { ui.screen = 'setup'; ui.race = null; render(); }
  else if (action === 'observe') runBotsUntilHuman();
  else if (action === 'pass-answer') answer('');
  else if (action === 'import-set') importSet();
  else if (action === 'delete-set') deleteSet(event.target.closest('[data-set-id]')?.dataset.setId);
  else if (action === 'copy-prompt') copyPrompt(event);
});

document.addEventListener('submit', (event) => {
  if (partyBoot) return;
  if (event.target.matches('[data-action="typed-submit"]')) {
    event.preventDefault(); answer(event.target.querySelector('input')?.value || '');
  }
});
document.addEventListener('input', (event) => {
  if (partyBoot) return;
  if (event.target.matches('[data-name-index]')) ui.names[Number(event.target.dataset.nameIndex)] = event.target.value;
  if (event.target.matches('[data-import-name]')) ui.importName = event.target.value;
  if (event.target.matches('[data-import-text]')) ui.importText = event.target.value;
});
document.addEventListener('change', (event) => {
  if (partyBoot) return;
  if (event.target.matches('[data-local-count]')) { ui.localCount = Number(event.target.value); render(); }
  if (event.target.matches('[data-set-id]')) { ui.activeSetId = event.target.dataset.setId; persistPrefs(); render(); }
  if (event.target.matches('[data-track-id]')) { ui.trackId = event.target.dataset.trackId; persistPrefs(); render(); }
});
soundToggle.addEventListener('click', toggleSound);
window.addEventListener('hashchange', () => location.reload());
const partyRoute = (() => {
  const hash = location.hash || '';
  if (hash === '#/host' || hash.startsWith('#/host/')) return { view: 'host' };
  const join = /^#\/join\/([A-Za-z0-9]{4})(?:\/([0-9]{4}))?\/?$/.exec(hash);
  if (join) return { view: 'join', code: join[1].toUpperCase(), password: join[2] || '' };
  return null;
})();
if (partyRoute) {
  partyBoot = true;
  if (partyRoute.view === 'host') import('./party/host-view.mjs').then((mod) => mod.bootHost());
  else import('./party/guest-view.mjs').then((mod) => mod.bootGuest(partyRoute));
} else {
  loadStoredPrefs();
  render();
}
