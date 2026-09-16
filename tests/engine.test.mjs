import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACK_LENGTH, CORNERS, GEARS, createRace, currentCar, legalGears,
  chooseGear, resolveAnswer, previewMove, commitMove, runBotTurn, standings,
} from '../engine.mjs';

const names = ['Ada', 'Benoît', 'Camille', 'Dario'];

function armResult(state, index, { position = 0, gear = 1, roll = 1, tyres = 18, brakes = 8, stops = {} } = {}) {
  state.turnIndex = index;
  state.phase = 'result';
  const car = state.cars[index];
  Object.assign(car, { position, gear, tyres, brakes, retired: false, finished: false, stops: { c1: 0, c2: 0, c3: 0, ...stops } });
  state.pending = { gear, grade: 'correct', roll };
  return car;
}

function armResultWithCursor(state, carIndex, cursorIndex, options = {}) {
  armResult(state, carIndex, options);
  state.turnIndex = cursorIndex;
  return state.cars[carIndex];
}

function jsonCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

test('published track and gear constants match the director contract', () => {
  assert.equal(TRACK_LENGTH, 144);
  assert.deepEqual(CORNERS, [
    { id: 'c1', name: 'The Esses', start: 24, end: 32, stops: 1 },
    { id: 'c2', name: 'Harbour Hairpin', start: 62, end: 74, stops: 2 },
    { id: 'c3', name: 'Last Light', start: 106, end: 116, stops: 1 },
  ]);
  assert.deepEqual(GEARS.map(({ gear, min, max }) => [gear, min, max]), [[1, 1, 2], [2, 2, 4], [3, 4, 8], [4, 7, 12], [5, 11, 20], [6, 21, 30]]);
});

test('creation and legal gear changes enforce the one-up/two-down brake rule', () => {
  const state = createRace({ names, humanCount: 4, seed: 123 });
  assert.equal(state.cars.length, 4);
  assert.deepEqual(state.cars.map((car) => [car.position, car.gear, car.tyres, car.brakes]), Array(4).fill([0, 1, 18, 8]));
  assert.deepEqual(legalGears(state.cars[0]), [1, 2]);
  state.cars[0].gear = 3;
  assert.deepEqual(legalGears(state.cars[0]), [1, 2, 3, 4]);
  state.cars[0].brakes = 0;
  assert.deepEqual(legalGears(state.cars[0]), [2, 3, 4]);
  state.cars[0].gear = 3;
  state.cars[0].brakes = 8;
  chooseGear(state, 1);
  assert.equal(state.cars[0].gear, 1);
  assert.equal(state.cars[0].brakes, 7, 'a two-gear downshift spends exactly one brake');
  assert.equal(state.phase, 'question');
});

test('invalid operations are atomic across phase, gear, answer and brake validation', () => {
  const state = createRace({ names, humanCount: 4, seed: 22 });
  let before = jsonCopy(state);
  assert.throws(() => chooseGear(state, 3), /illegal gear/i);
  assert.deepEqual(state, before);
  assert.throws(() => resolveAnswer(state, 'correct'), /not in question/i);
  assert.deepEqual(state, before);

  chooseGear(state, 2);
  before = jsonCopy(state);
  assert.throws(() => resolveAnswer(state, 'bogus'), /invalid answer grade/i);
  assert.deepEqual(state, before);
  resolveAnswer(state, 'correct');
  before = jsonCopy(state);
  assert.throws(() => previewMove(state, 4), /invalid brake/i);
  assert.deepEqual(state, before);
  assert.throws(() => commitMove(state, -1), /invalid brake/i);
  assert.deepEqual(state, before);
});

test('preview is pure and commit applies the exact preview result', () => {
  const state = createRace({ names, humanCount: 4, seed: 4 });
  armResult(state, 0, { position: 10, gear: 3, roll: 7 });
  const before = jsonCopy(state);
  const preview = previewMove(state, 2);
  assert.deepEqual(state, before);
  commitMove(state, 2);
  assert.equal(state.lastEvent.from, preview.from);
  assert.equal(state.lastEvent.to, preview.to);
  assert.equal(state.lastEvent.movement, preview.movement);
  assert.equal(state.lastEvent.brakesSpent, preview.brakesSpent);
  assert.equal(state.lastEvent.tyreCost, preview.tyreCost);
  assert.equal(state.lastEvent.spin, preview.spin);
  assert.equal(state.cars[0].brakes, 6);
});

test('answer grades roll inside their locked gear ranges exactly once', () => {
  const expected = { correct: [21, 30], partial: [21, 25], miss: [10, 20], pass: [1, 2] };
  for (const [grade, [min, max]] of Object.entries(expected)) {
    const state = createRace({ names, humanCount: 4, seed: 80 + min });
    const car = state.cars[0];
    car.gear = 6;
    state.phase = 'question';
    state.pending = { gear: 6, grade: null, roll: null };
    resolveAnswer(state, grade);
    assert.ok(state.pending.roll >= min && state.pending.roll <= max, `${grade} roll ${state.pending.roll}`);
    const before = jsonCopy(state);
    assert.throws(() => resolveAnswer(state, grade), /not in question/i);
    assert.deepEqual(state, before);
  }
});

test('corner entry records a stop, bypass costs overshoot plus two tyres, and two missed stops spin', () => {
  const entry = createRace({ names, humanCount: 4, seed: 1 });
  armResult(entry, 0, { position: 23, gear: 1, roll: 1 });
  const entryPreview = previewMove(entry);
  assert.equal(entryPreview.to, 24);
  assert.equal(entryPreview.tyreCost, 0);
  commitMove(entry);
  assert.equal(entry.cars[0].stops.c1, 1);

  const bypass = createRace({ names, humanCount: 4, seed: 2 });
  armResult(bypass, 0, { position: 23, gear: 3, roll: 10 });
  const bypassPreview = previewMove(bypass);
  assert.equal(bypassPreview.to, 33);
  assert.equal(bypassPreview.tyreCost, 3, 'one-cell overshoot uses overshoot plus two tyres, capped at four');
  assert.equal(bypassPreview.spin, false);

  const capped = createRace({ names, humanCount: 4, seed: 20 });
  armResult(capped, 0, { position: 23, gear: 6, roll: 20 });
  assert.equal(previewMove(capped).tyreCost, 4, 'large single-stop overshoot is capped at four wear');

  const spin = createRace({ names, humanCount: 4, seed: 3 });
  armResult(spin, 0, { position: 61, gear: 6, roll: 14, tyres: 18 });
  const spinPreview = previewMove(spin);
  assert.equal(spinPreview.to, 75);
  assert.equal(spinPreview.tyreCost, 5);
  assert.equal(spinPreview.spin, true);
  commitMove(spin);
  assert.equal(spin.cars[0].gear, 1);

  const lastLight = createRace({ names, humanCount: 4, seed: 4 });
  armResult(lastLight, 0, { position: 105, gear: 5, roll: 12 });
  const lastLightPreview = previewMove(lastLight);
  assert.equal(lastLightPreview.to, 117);
  assert.equal(lastLightPreview.tyreCost, 3);
  assert.equal(lastLightPreview.spin, false);
});

test('brakes reduce movement by one each, never below one, and resources stay nonnegative', () => {
  const state = createRace({ names, humanCount: 4, seed: 9 });
  armResult(state, 0, { position: 10, gear: 3, roll: 4, brakes: 3 });
  assert.equal(previewMove(state, 0).movement, 4);
  assert.equal(previewMove(state, 3).movement, 1);
  commitMove(state, 3);
  assert.equal(state.cars[0].brakes, 0);
  assert.ok(state.cars[0].position >= 11);
  assert.ok(state.cars[0].tyres >= 0);
});

test('corner recovery prevents retirement when wear exhausts tyres and restores race resources', () => {
  const state = createRace({ names, humanCount: 4, seed: 11 });
  armResult(state, 0, { position: 61, gear: 6, roll: 14, tyres: 4 });
  const preview = previewMove(state);
  assert.equal(preview.tyreCost, 5);
  assert.equal(preview.recovery, true);
  commitMove(state);
  assert.equal(state.cars[0].retired, false);
  assert.equal(state.cars[0].finished, false);
  assert.equal(state.cars[0].tyres, 12);
  assert.ok(state.cars[0].brakes >= 3 && state.cars[0].brakes <= 8);
  assert.equal(state.lastEvent.recovery, true);
  assert.equal(currentCar(state).id, 'car-2', 'recovered car takes no extra turn');
});

test('a car crossing the finish records its final-round fraction and leaves the result phase', () => {
  const state = createRace({ names, humanCount: 4, seed: 12 });
  armResult(state, 0, { position: 143, gear: 1, roll: 1 });
  const preview = previewMove(state);
  assert.equal(preview.finished, true);
  commitMove(state);
  assert.equal(state.cars[0].finished, true);
  assert.equal(state.cars[0].position, TRACK_LENGTH);
  assert.equal(state.cars[0].finishRound, 1);
  assert.equal(state.cars[0].finishFraction, 1);
  assert.equal(state.finishRound, 1);
  assert.equal(state.phase, 'gear');
  assert.equal(currentCar(state).id, 'car-2');
});

test('standings rank finishers by round and crossing fraction, then active distance, then retirees', () => {
  const state = createRace({ names, humanCount: 4, seed: 1 });
  Object.assign(state.cars[0], { finished: true, finishRound: 3, finishFraction: 0.80, position: 144 });
  Object.assign(state.cars[1], { finished: true, finishRound: 3, finishFraction: 0.20, position: 144 });
  Object.assign(state.cars[2], { position: 120 });
  Object.assign(state.cars[3], { retired: true, position: 130 });
  assert.deepEqual(standings(state).map((car) => car.id), ['car-2', 'car-1', 'car-3', 'car-4']);
});

test('inactive leading and intermediate slots are skipped exactly once after a move', () => {
  const leading = createRace({ names, humanCount: 4, seed: 1 });
  leading.cars[0].retired = true;
  armResultWithCursor(leading, 1, 0, { position: 10, gear: 1, roll: 1 });
  assert.equal(currentCar(leading).id, 'car-2');
  commitMove(leading);
  assert.equal(currentCar(leading).id, 'car-3');

  const intermediate = createRace({ names, humanCount: 4, seed: 2 });
  intermediate.cars[1].retired = true;
  armResult(intermediate, 0, { position: 10, gear: 1, roll: 1 });
  commitMove(intermediate);
  assert.equal(currentCar(intermediate).id, 'car-3');
  armResultWithCursor(intermediate, 2, 1, { position: 10, gear: 1, roll: 1 });
  commitMove(intermediate);
  assert.equal(currentCar(intermediate).id, 'car-4');
});

test('a trailing inactive slot does not create a phantom turn', () => {
  const state = createRace({ names, humanCount: 4, seed: 3 });
  state.cars[3].retired = true;
  armResult(state, 2, { position: 10, gear: 1, roll: 1 });
  commitMove(state);
  assert.equal(currentCar(state).id, 'car-1');
});

test('the final round gives active racers one turn, then ends without repeating a finished racer', () => {
  const state = createRace({ names, humanCount: 4, seed: 5 });
  Object.assign(state.cars[0], { finished: true, position: TRACK_LENGTH, finishRound: 2, finishFraction: 0.5 });
  state.finishRound = 2;
  state.round = 2;
  armResultWithCursor(state, 1, 0, { position: 10, gear: 1, roll: 1 });
  commitMove(state);
  assert.equal(currentCar(state).id, 'car-3');
  armResult(state, 2, { position: 10, gear: 1, roll: 1 });
  commitMove(state);
  assert.equal(currentCar(state).id, 'car-4');
  armResult(state, 3, { position: 10, gear: 1, roll: 1 });
  commitMove(state);
  assert.equal(state.phase, 'finished');
  assert.equal(state.cars[0].position, TRACK_LENGTH, 'finished racer receives no extra final-round move');
  assert.equal(state.log.filter((event) => event.carId === 'car-1').length, 0);
});

function playSeededCampaign(seed, trackId = 'port-azure') {
  const state = createRace({ names: ['You', 'Élan', 'Mistral', 'Soleil'], humanCount: 1, seed, trackId });
  for (let steps = 0; steps < 500 && state.phase !== 'finished'; steps += 1) {
    const car = currentCar(state);
    assert.ok(car, `current car exists at step ${steps}`);
    if (car.human) {
      chooseGear(state, Math.max(...legalGears(car)));
      resolveAnswer(state, 'correct');
      commitMove(state);
    } else {
      runBotTurn(state);
    }
  }
  assert.equal(state.phase, 'finished', 'seeded campaign reaches a terminal state');
  assert.ok(state.winnerId, 'terminal race records a winner');
  assert.ok(state.round >= 1 && state.round <= 46, 'race ends at or before the safety finish');
  assert.ok(state.cars.every((car) => car.tyres >= 0 && car.brakes >= 0));
  const turns = new Set(state.log.map((event) => `${event.carId}:${event.round}`));
  assert.equal(turns.size, state.log.length, 'no racer receives a duplicate turn in one round');
  return state;
}

test('seeded bot campaign is complete and replay-identical', () => {
  const first = playSeededCampaign(987654);
  const second = playSeededCampaign(987654);
  assert.deepEqual(second, first);
  assert.ok(first.log.length > 0);
  assert.ok(first.winnerId);
});

test('races carry their circuit snapshot and default to port azure', () => {
  const classic = createRace({ names, humanCount: 1, seed: 7 });
  assert.equal(classic.track.id, 'port-azure');
  assert.equal(classic.track.length, 144);
  assert.deepEqual(classic.cars[0].stops, { c1: 0, c2: 0, c3: 0 });
  const riviera = createRace({ names, humanCount: 1, seed: 7, trackId: 'riviera' });
  assert.equal(riviera.track.id, 'riviera');
  assert.equal(riviera.track.length, 156);
  assert.deepEqual(Object.keys(riviera.cars[0].stops).sort(), ['rv1', 'rv2', 'rv3', 'rv4']);
  assert.throws(() => createRace({ names, humanCount: 1, seed: 7, trackId: 'nope' }), /Unknown track/);
});

test('finish line and corner stops follow the selected circuit', () => {
  const riviera = createRace({ names, humanCount: 4, seed: 30, trackId: 'riviera' });
  armResult(riviera, 0, { position: 155, gear: 1, roll: 1 });
  assert.equal(previewMove(riviera).finished, true);
  commitMove(riviera);
  assert.equal(riviera.cars[0].finished, true);
  assert.equal(riviera.cars[0].finishFraction, 1);

  const entry = createRace({ names, humanCount: 4, seed: 31, trackId: 'riviera' });
  armResult(entry, 0, { position: 3, gear: 1, roll: 1 });
  assert.equal(previewMove(entry).tyreCost, 0);
  commitMove(entry);
  assert.equal(entry.cars[0].stops.rv1, 1);

  const lion = createRace({ names, humanCount: 4, seed: 32, trackId: 'lion-city' });
  armResult(lion, 0, { position: 98, gear: 4, roll: 13 });
  const spin = previewMove(lion);
  assert.equal(spin.to, 111);
  assert.equal(spin.tyreCost, 5);
  assert.equal(spin.spin, true);
  commitMove(lion);
  assert.equal(lion.cars[0].gear, 1);
});

test('seeded bot campaigns complete and replay identically on every circuit', () => {
  for (const trackId of ['port-azure', 'riviera', 'lion-city']) {
    const first = playSeededCampaign(424242, trackId);
    const second = playSeededCampaign(424242, trackId);
    assert.deepEqual(second, first);
    assert.ok(first.log.length > 0);
  }
});
