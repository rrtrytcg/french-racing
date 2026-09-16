/*
 * APEX / French Racing deterministic race engine.
 *
 * This module deliberately contains no UI or language content.  The state is
 * plain JSON data so that the browser, replay tools, and tests can all use the
 * same resolver.  Additional state fields used by this module are `mode`,
 * `seed`, `track` (logic snapshot from tracks.mjs), and each bot car's `skill`
 * (the latter is only used by runBotTurn).
 */

import { getTrack, DEFAULT_TRACK_ID, trackLogic } from './tracks.mjs';

const CLASSIC_TRACK = getTrack('port-azure');

export const TRACK_LENGTH = CLASSIC_TRACK.length;

export const CORNERS = Object.freeze(CLASSIC_TRACK.corners.map((corner) => Object.freeze({ ...corner })));

export const GEARS = Object.freeze([
  Object.freeze({ gear: 1, min: 1, max: 2, label: "1" }),
  Object.freeze({ gear: 2, min: 2, max: 4, label: "2" }),
  Object.freeze({ gear: 3, min: 4, max: 8, label: "3" }),
  Object.freeze({ gear: 4, min: 7, max: 12, label: "4" }),
  Object.freeze({ gear: 5, min: 11, max: 20, label: "5" }),
  Object.freeze({ gear: 6, min: 21, max: 30, label: "6" }),
]);

// Sixteen-strong classroom grid. The first four keep the classic solo/local hues.
export const CAR_COLORS = Object.freeze([
  Object.freeze({ name: "Blaze", hex: "#f05a47" }),
  Object.freeze({ name: "Lagoon", hex: "#23b5aa" }),
  Object.freeze({ name: "Amber", hex: "#f2b84b" }),
  Object.freeze({ name: "Comet", hex: "#7587ed" }),
  Object.freeze({ name: "Bubblegum", hex: "#ec4899" }),
  Object.freeze({ name: "Volt", hex: "#84cc16" }),
  Object.freeze({ name: "Skye", hex: "#0ea5e9" }),
  Object.freeze({ name: "Tiger", hex: "#f97316" }),
  Object.freeze({ name: "Grape", hex: "#8b5cf6" }),
  Object.freeze({ name: "Palm", hex: "#10b981" }),
  Object.freeze({ name: "Solar", hex: "#eab308" }),
  Object.freeze({ name: "Abyss", hex: "#1d4ed8" }),
  Object.freeze({ name: "Neon", hex: "#d946ef" }),
  Object.freeze({ name: "Forest", hex: "#15803d" }),
  Object.freeze({ name: "Raspberry", hex: "#e11d48" }),
  Object.freeze({ name: "Copper", hex: "#b45309" }),
]);
export const MAX_HUMANS = CAR_COLORS.length;
const COLORS = CAR_COLORS.map((entry) => entry.hex);
const GRADES = new Set(["correct", "partial", "miss", "pass"]);

function fail(message) {
  throw new Error(message);
}

function integer(value, label) {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value;
}

function assertState(state) {
  if (!state || typeof state !== "object" || !Array.isArray(state.cars)) fail("invalid race state");
  if (!Number.isInteger(state.turnIndex) || !Number.isInteger(state.round)) fail("invalid race turn state");
  if (!state.rng || !Number.isInteger(state.rng.state)) fail("invalid race random state");
}

function assertPhase(state, phase) {
  assertState(state);
  if (state.phase !== phase) fail(`race is not in ${phase} phase`);
}

function trackOf(state) {
  if (state && state.track && Number.isInteger(state.track.length) && Array.isArray(state.track.corners)) return state.track;
  return { id: 'port-azure', name: 'Port Azure', length: TRACK_LENGTH, corners: CORNERS };
}

function currentIndex(state) {
  const count = state.cars.length;
  if (!count) return -1;
  const start = ((state.turnIndex % count) + count) % count;
  for (let offset = 0; offset < count; offset += 1) {
    const car = state.cars[(start + offset) % count];
    if (!car.retired && !car.finished) return (start + offset) % count;
  }
  return -1;
}

function activeCars(state) {
  return state.cars.filter((car) => !car.retired && !car.finished);
}

function gearSpec(gear) {
  return GEARS.find((entry) => entry.gear === gear);
}

function normalizeSeed(seed) {
  const value = Number.isFinite(seed) ? Math.trunc(seed) : 1;
  return (value >>> 0) || 1;
}

// Mulberry32 gives a compact reproducible PRNG while keeping the state JSONable.
function nextRandom(state) {
  let value = (state.rng.state + 0x6d2b79f5) >>> 0;
  state.rng.state = value;
  value = Math.imul(value ^ (value >>> 15), value | 1) >>> 0;
  value ^= (value + Math.imul(value ^ (value >>> 7), value | 61)) >>> 0;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function rollBetween(state, min, max) {
  return min + Math.floor(nextRandom(state) * (max - min + 1));
}

function gradeRange(spec, grade) {
  if (grade === "correct") return [spec.min, spec.max];
  if (grade === "partial") return [spec.min, Math.floor((spec.min + spec.max) / 2)];
  if (grade === "miss") return [Math.max(1, Math.floor(spec.min / 2)), Math.max(1, spec.min - 1)];
  return [1, 2];
}

function stopsValue(car, id) {
  const value = car.stops && car.stops[id];
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function validateCar(car) {
  if (!car || typeof car !== "object") fail("invalid current car");
  if (!Number.isInteger(car.position) || car.position < 0) fail("invalid car position");
  if (!Number.isInteger(car.gear) || !gearSpec(car.gear)) fail("invalid car gear");
  if (!Number.isInteger(car.tyres) || !Number.isInteger(car.brakes)) fail("invalid car resources");
}

function movementResolution(car, brakes, track) {
  const spec = gearSpec(car.gear);
  const roll = car.__roll;
  const from = car.position;
  const movement = Math.max(1, roll - brakes);
  const requestedTo = from + movement;
  let to = requestedTo;
  let tyreCost = 0;
  let spin = false;
  let message = `Moves ${movement} cell${movement === 1 ? "" : "s"}.`;
  const nextStops = { ...(car.stops || {}) };

  for (const corner of track.corners) {
    if (from > corner.end || to < corner.start) continue;

    const beganInside = from >= corner.start && from <= corner.end;
    const endsInside = to >= corner.start && to <= corner.end;

    if (endsInside) {
      nextStops[corner.id] = stopsValue(car, corner.id) + 1;
      message += ` Stops at ${corner.name}.`;
      continue;
    }

    if (to > corner.end && (beganInside || from < corner.start)) {
      const already = beganInside ? stopsValue(car, corner.id) : 0;
      const missing = Math.max(0, corner.stops - already);
      nextStops[corner.id] = 0;
      if (missing >= 2) {
        tyreCost += 5;
        spin = true;
        to = corner.end + 1;
        message = `Spins after missing ${missing} stops at ${corner.name}.`;
        break;
      }
      if (missing === 1) {
        const overshoot = Math.max(0, to - corner.end);
        const cost = Math.min(4, overshoot + 2);
        tyreCost += cost;
        message += ` Misses a stop at ${corner.name} (-${cost} tyres).`;
      } else {
        message += ` Clears ${corner.name}.`;
      }
    }
  }

  const recovery = car.tyres - tyreCost <= 0;
  const retired = false;
  const finished = to >= track.length;
  if (recovery) message += " Pit crew repairs the tyres; back in the race in gear 1.";
  if (finished) message += " Crosses the finish line.";

  return {
    from,
    to,
    movement,
    brakesSpent: brakes,
    tyreCost,
    spin,
    retired,
    finished,
    message,
    stops: nextStops,
    requestedTo,
    gearAfter: recovery || spin ? 1 : car.gear,
    recovery,
    spec,
  };
}

function noMutationValidation(state, brakes) {
  assertPhase(state, "result");
  const car = currentCar(state);
  if (!car) fail("no active car");
  validateCar(car);
  if (!state.pending || state.pending.roll == null) fail("no resolved answer");
  integer(brakes, "brakes");
  if (brakes < 0 || brakes > 3 || brakes > car.brakes || brakes > state.pending.roll - 1) fail("invalid brake spend");
  return car;
}

export function createRace({ names, humanCount, seed = 1, trackId = DEFAULT_TRACK_ID } = {}) {
  if (!Array.isArray(names)) fail("names must be an array");
  integer(humanCount, "humanCount");
  if (humanCount < 1 || humanCount > MAX_HUMANS) fail(`humanCount must be between 1 and ${MAX_HUMANS}`);
  if (names.length !== (humanCount === 1 ? 4 : humanCount)) fail("names must include every racer");
  const cleanNames = names.map((name, index) => {
    if (typeof name !== "string" || !name.trim()) fail(`name ${index + 1} is empty`);
    return name.trim();
  });
  const track = trackLogic(getTrack(trackId));
  const cars = cleanNames.map((name, index) => ({
    id: `car-${index + 1}`,
    name,
    human: index < humanCount,
    color: COLORS[index % COLORS.length],
    position: 0,
    gear: 1,
    tyres: 18,
    brakes: 8,
    stops: Object.fromEntries(track.corners.map((corner) => [corner.id, 0])),
    retired: false,
    finished: false,
    finishRound: null,
    finishFraction: null,
    ...(index >= humanCount ? { skill: Math.max(0.54, 0.82 - (index - humanCount) * 0.1) } : {}),
  }));
  return {
    mode: humanCount === 1 ? "solo" : humanCount <= 4 ? "local" : "party",
    track,
    seed: normalizeSeed(seed),
    cars,
    turnIndex: 0,
    round: 1,
    phase: "gear",
    rng: { state: normalizeSeed(seed) },
    pending: null,
    lastEvent: null,
    log: [],
    winnerId: null,
    finishRound: null,
  };
}

export function currentCar(state) {
  assertState(state);
  if (state.phase === "finished") return null;
  const index = currentIndex(state);
  return index < 0 ? null : state.cars[index];
}

export function legalGears(car) {
  validateCar(car);
  if (car.retired || car.finished) return [];
  return GEARS.filter((spec) => {
    const delta = spec.gear - car.gear;
    if (delta > 1 || delta < -2) return false;
    if (delta === -2 && car.brakes < 1) return false;
    return true;
  }).map((spec) => spec.gear);
}

export function chooseGear(state, gear) {
  assertPhase(state, "gear");
  const car = currentCar(state);
  if (!car) fail("no active car");
  validateCar(car);
  integer(gear, "gear");
  if (!legalGears(car).includes(gear)) fail("illegal gear choice");
  if (car.gear - gear === 2 && car.brakes < 1) fail("illegal gear choice: two-gear downshift needs a brake");
  const downshiftCost = car.gear - gear === 2 ? 1 : 0;
  // All validation is complete before either car or state is changed.
  car.brakes -= downshiftCost;
  car.gear = gear;
  state.pending = { gear, grade: null, roll: null };
  state.phase = "question";
  return state;
}

export function resolveAnswer(state, grade) {
  assertPhase(state, "question");
  if (!GRADES.has(grade)) fail("invalid answer grade");
  if (!state.pending || !gearSpec(state.pending.gear)) fail("no selected gear");
  if (state.pending.roll != null) fail("answer already resolved");
  const spec = gearSpec(state.pending.gear);
  const [min, max] = gradeRange(spec, grade);
  const roll = rollBetween(state, min, max);
  state.pending.grade = grade;
  state.pending.roll = roll;
  state.phase = "result";
  return state;
}

export function previewMove(state, brakes = 0) {
  const car = noMutationValidation(state, brakes);
  const working = { ...car, __roll: state.pending.roll };
  const result = movementResolution(working, brakes, trackOf(state));
  return {
    from: result.from,
    to: result.to,
    movement: result.movement,
    brakesSpent: result.brakesSpent,
    tyreCost: result.tyreCost,
    spin: result.spin,
    retired: result.retired,
    finished: result.finished,
    recovery: result.recovery,
    message: result.message,
  };
}

function advanceAfterMove(state, actorIndex) {
  const count = state.cars.length;
  if (!count) {
    state.phase = "finished";
    return;
  }
  const oldIndex = ((actorIndex % count) + count) % count;
  let nextIndex = -1;
  let wrapped = false;
  for (let step = 1; step <= count; step += 1) {
    const rawIndex = oldIndex + step;
    const candidate = rawIndex % count;
    if (rawIndex >= count) wrapped = true;
    const candidateCar = state.cars[candidate];
    if (!candidateCar.retired && !candidateCar.finished) {
      nextIndex = candidate;
      break;
    }
  }
  if (wrapped) state.round += 1;
  if (nextIndex >= 0) state.turnIndex = nextIndex;

  const hasFinished = state.cars.some((car) => car.finished);
  if (hasFinished && state.finishRound == null) state.finishRound = state.round - (nextIndex === 0 ? 1 : 0);
  const noActive = activeCars(state).length === 0;
  const finalRoundComplete = state.finishRound != null && state.round > state.finishRound;
  const safetyComplete = state.round > 45 && !hasFinished;
  if (noActive || finalRoundComplete || safetyComplete) {
    state.phase = "finished";
    const ranking = standings(state);
    state.winnerId = ranking.find((car) => !car.retired)?.id ?? null;
    if (state.finishRound == null && safetyComplete) state.finishRound = 45;
  } else {
    state.phase = "gear";
  }
  state.pending = null;
}

export function commitMove(state, brakes = 0) {
  const car = noMutationValidation(state, brakes);
  const track = trackOf(state);
  const actorIndex = currentIndex(state);
  const result = movementResolution({ ...car, __roll: state.pending.roll }, brakes, track);
  const from = car.position;
  car.position = result.to;
  const brakesAfterSpend = car.brakes - brakes;
  car.tyres = result.recovery ? 12 : Math.max(0, car.tyres - result.tyreCost);
  car.brakes = result.recovery ? Math.min(8, Math.max(3, brakesAfterSpend)) : brakesAfterSpend;
  car.stops = result.stops;
  if (result.spin || result.recovery) car.gear = 1;
  // Retired remains a compatibility field for externally authored states;
  // normal corner damage never creates a new retirement.
  car.retired = false;
  car.finished = result.finished;
  if (result.finished) {
    car.finishRound = state.round;
    car.finishFraction = (track.length - from) / result.movement;
    if (state.finishRound == null) state.finishRound = state.round;
  }
  state.lastEvent = {
    carId: car.id,
    from,
    to: car.position,
    movement: result.movement,
    brakesSpent: brakes,
    tyreCost: result.tyreCost,
    spin: result.spin,
    recovery: result.recovery,
    message: result.message,
  };
  state.log.push({ ...state.lastEvent, round: state.round });
  advanceAfterMove(state, actorIndex);
  return state;
}

function botGear(state, car) {
  const legal = legalGears(car).filter((gear) => !(car.gear - gear === 2 && car.brakes < 1));
  const track = trackOf(state);
  let best = legal[0];
  let bestScore = -Infinity;
  for (const gear of legal) {
    const spec = gearSpec(gear);
    const downshiftCost = car.gear - gear === 2 ? 1 : 0;
    const candidate = { ...car, gear, brakes: car.brakes - downshiftCost };
    let score = 0;
    for (let roll = spec.min; roll <= spec.max; roll += 1) {
      const outcome = chooseBotBrake(candidate, roll, track);
      score += outcome.score;
    }
    score /= spec.max - spec.min + 1;
    // Slightly prefer a higher gear when the expected outcomes are equally safe.
    score += gear * 0.05;
    if (score > bestScore || (score === bestScore && gear < best)) {
      best = gear;
      bestScore = score;
    }
  }
  return best;
}

function cornerFollowupRisk(car, result, brakes, track) {
  for (const corner of track.corners) {
    if (result.to < corner.start || result.to > corner.end) continue;
    if (stopsValue(result, corner.id) >= corner.stops) continue;
    const availableBrakes = Math.max(0, car.brakes - brakes);
    let canStay = false;
    for (const nextGear of GEARS) {
      const delta = nextGear.gear - car.gear;
      if (delta > 1 || delta < -2) continue;
      const downCost = delta === -2 ? 1 : 0;
      if (availableBrakes < downCost) continue;
      const nextBrakes = availableBrakes - downCost;
      const maxBrake = Math.min(3, nextBrakes, nextGear.min - 1);
      const minimumMovement = Math.max(1, nextGear.min - maxBrake);
      if (result.to + minimumMovement <= corner.end) { canStay = true; break; }
    }
    if (!canStay) return 45;
  }
  return 0;
}

function outcomeScore(car, preview, brakes, track) {
  let score = preview.movement;
  score -= preview.tyreCost * 12;
  if (preview.spin) score -= 90;
  if (preview.recovery) score -= 8;
  if (preview.retired) score -= 1000;
  score -= cornerFollowupRisk(car, preview, brakes, track);
  return score;
}

function chooseBotBrake(car, roll, track) {
  const maximum = Math.min(3, car.brakes, roll - 1);
  let best = null;
  for (let brakes = 0; brakes <= maximum; brakes += 1) {
    const preview = movementResolution({ ...car, __roll: roll }, brakes, track);
    const candidate = { brakes, preview };
    const score = outcomeScore(car, preview, brakes, track);
    if (!best || score > best.score || (score === best.score && brakes < best.brakes)) {
      best = { ...candidate, score };
    }
  }
  return best;
}

export function runBotTurn(state) {
  assertPhase(state, "gear");
  const car = currentCar(state);
  if (!car) fail("no active car");
  if (car.human) fail("current car is human");
  const gear = botGear(state, car);
  chooseGear(state, gear);
  const skill = Number.isFinite(car.skill) ? car.skill : 0.65;
  const chance = nextRandom(state);
  const grade = chance < skill ? "correct" : chance < Math.min(0.98, skill + 0.18) ? "partial" : "miss";
  resolveAnswer(state, grade);
  const chosenBrakes = chooseBotBrake(car, state.pending.roll, trackOf(state)).brakes;
  commitMove(state, chosenBrakes);
  return state;
}

export function standings(state) {
  assertState(state);
  return [...state.cars].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) {
      if (a.finishRound !== b.finishRound) return (a.finishRound ?? Infinity) - (b.finishRound ?? Infinity);
      if (a.finishFraction !== b.finishFraction) return (a.finishFraction ?? Infinity) - (b.finishFraction ?? Infinity);
    }
    if (a.retired !== b.retired) return a.retired ? 1 : -1;
    if (a.position !== b.position) return b.position - a.position;
    return String(a.id).localeCompare(String(b.id));
  });
}
