// Authoritative classroom race host (no DOM: the whiteboard view renders
// snapshots). Simultaneous rounds: every active driver locks a gear and
// answers at the same time on their own device, then the host applies all
// engine turns in order and broadcasts one combined result.
import {
  createRace, currentCar, legalGears, chooseGear, resolveAnswer, commitMove,
  standings, CAR_COLORS,
} from '../engine.mjs';
import {
  getChallenge, getSetChallenge, gradeAnswer, correctionDiff,
  shuffledOrder, gearChallengeCount,
} from '../content.mjs';
import { MAX_PLAYERS, uniqueName, sanitizeName } from './net.mjs';

export const ROUND_SECONDS = 75;
export const MIN_PLAYERS = 1;

const activeCars = (race) => (race ? race.cars.filter((car) => !car.finished && !car.retired) : []);

export class PartyHost {
  constructor({ send, roomCode, password, trackId = 'port-azure', set = null, seed = null, now = null, roundSeconds = ROUND_SECONDS } = {}) {
    if (typeof send !== 'function') throw new Error('PartyHost needs a send function');
    this.send = send;
    this.roomCode = roomCode;
    this.password = password;
    this.trackId = trackId;
    this.set = set && !set.builtin ? set : null; // null = built-in bank
    this.seed = Number.isInteger(seed) ? seed >>> 0 : (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    this.now = now || (() => Date.now());
    this.roundSeconds = roundSeconds;
    this.status = 'lobby';
    this.players = []; // [{guestId, carId, name, color, colorName, carNumber, online}]
    this.race = null;
    this.roundData = null;
    this.orders = {};
    this.serials = {};
    this.log = [];
    this.lastMoves = [];
    this.settleSeq = 0;
    this.onView = null;
  }

  emit() { try { this.onView && this.onView(this.snapshot()); } catch {} }

  admitPayload(player) {
    return {
      kind: 'admit', guestId: player.guestId, carId: player.carId, name: player.name,
      color: player.color, colorName: player.colorName, carNumber: player.carNumber,
      roomCode: this.roomCode, status: this.status, trackId: this.trackId,
    };
  }

  playerByGuest(guestId) { return this.players.find((p) => p.guestId === guestId) || null; }
  playerByCar(carId) { return this.players.find((p) => p.carId === carId) || null; }
  carById(carId) { return (this.race && this.race.cars.find((car) => car.id === carId)) || null; }

  setLength(gear) {
    if (!this.set) return gearChallengeCount(gear);
    const list = this.set.gears && this.set.gears[gear];
    if (!Array.isArray(list) || !list.length) throw new Error('Imported set has no challenges for this gear');
    return list.length;
  }

  challengeFor(carId, gear) {
    const key = `${carId}:${gear}`;
    const length = this.setLength(gear);
    if (!this.orders[key] || this.orders[key].length !== length) {
      this.orders[key] = shuffledOrder(length, `${this.seed}|${carId}|${gear}`);
    }
    const serial = this.serials[key] || 0;
    this.serials[key] = serial + 1;
    const pick = this.orders[key][serial % this.orders[key].length];
    return this.set ? getSetChallenge(this.set, gear, pick) : getChallenge(gear, pick);
  }

  roster() {
    return {
      kind: 'roster', status: this.status, roomCode: this.roomCode, max: MAX_PLAYERS,
      players: this.players.map((p) => ({ carId: p.carId, name: p.name, color: p.color, colorName: p.colorName, carNumber: p.carNumber, online: p.online !== false })),
    };
  }

  standingsSummary() {
    if (!this.race) return [];
    return standings(this.race).map((car, index) => {
      const player = this.playerByCar(car.id) || {};
      return {
        pos: index + 1, carId: car.id, name: car.name, color: car.color,
        colorName: player.colorName || '', carNumber: player.carNumber || 0,
        position: car.position, gear: car.gear, tyres: car.tyres, brakes: car.brakes,
        finished: car.finished, retired: car.retired,
      };
    });
  }

  snapshot() {
    return {
      status: this.status, roomCode: this.roomCode, seed: this.seed, trackId: this.trackId,
      players: this.roster().players,
      race: this.race ? { round: this.race.round, phase: this.race.phase, cars: this.race.cars, trackId: this.trackId } : null,
      round: this.roundData ? {
        round: this.roundData.round, endsAt: this.roundData.endsAt,
        geared: Object.keys(this.roundData.gears), answered: Object.keys(this.roundData.answers),
        active: activeCars(this.race).map((car) => car.id),
      } : null,
      standings: this.standingsSummary(),
      log: this.log.slice(-6),
      lastMoves: this.lastMoves,
      settleSeq: this.settleSeq,
    };
  }

  handle(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.kind === 'join-request') this.onJoin(payload);
    else if (payload.kind === 'gear-lock') this.onGearLock(payload);
    else if (payload.kind === 'answer-submit') this.onAnswer(payload);
    else if (payload.kind === 'sync-request') this.onSync(payload);
    else if (payload.kind === 'leave') this.onLeave(payload);
  }

  onJoin({ guestId, name, password } = {}) {
    if (typeof guestId !== 'string' || !guestId) return;
    const known = this.playerByGuest(guestId);
    if (known) {
      known.online = true;
      this.send(this.admitPayload(known));
      if (this.status !== 'lobby') this.sendSync(known);
      else this.send(this.roster());
      this.emit();
      return;
    }
    if (this.status !== 'lobby') {
      this.send({ kind: 'deny', guestId, reason: 'This race already started. Wait for the next one!' });
      return;
    }
    if (password !== this.password) {
      this.send({ kind: 'deny', guestId, reason: 'Wrong password. Check the whiteboard and try again.' });
      return;
    }
    if (this.players.length >= MAX_PLAYERS) {
      this.send({ kind: 'deny', guestId, reason: 'This room is full (16 drivers).' });
      return;
    }
    const clean = sanitizeName(name) || 'Driver';
    const index = this.players.length;
    const paint = CAR_COLORS[index % CAR_COLORS.length];
    const player = { guestId, carId: `car-${index + 1}`, name: uniqueName(clean, this.players.map((p) => p.name)), color: paint.hex, colorName: paint.name, carNumber: index + 1, online: true };
    this.players.push(player);
    this.send(this.admitPayload(player));
    this.send(this.roster());
    this.emit();
  }

  onLeave({ guestId } = {}) {
    const player = this.playerByGuest(guestId);
    if (!player) return;
    if (this.status === 'lobby') {
      this.players = this.players.filter((p) => p !== player);
      // Compact car numbers so the grid stays dense, then re-admit everyone
      // so devices learn their new car ids before the race starts.
      this.players.forEach((p, i) => { p.carId = `car-${i + 1}`; p.carNumber = i + 1; const paint = CAR_COLORS[i % CAR_COLORS.length]; p.color = paint.hex; p.colorName = paint.name; });
      for (const p of this.players) this.send(this.admitPayload(p));
      this.send(this.roster());
    } else {
      player.online = false;
      this.send(this.roster());
    }
    this.emit();
  }

  startRace() {
    if (this.status !== 'lobby') throw new Error('Race already started');
    if (this.players.length < MIN_PLAYERS) throw new Error('Need at least one driver');
    const names = this.players.map((p) => p.name);
    this.race = createRace({ names, humanCount: names.length, seed: this.seed, trackId: this.trackId });
    // Engine ids are car-1..car-n in the same order as players.
    this.status = 'racing';
    this.log = [];
    this.openRound();
    this.emit();
  }

  openRound() {
    if (!this.race || this.race.phase === 'finished') { this.finishRace(); return; }
    const racing = activeCars(this.race);
    if (!racing.length) { this.finishRace(); return; }
    this.roundData = {
      round: this.race.round, endsAt: this.now() + this.roundSeconds * 1000,
      gears: {}, deals: {}, answers: {}, settled: false,
    };
    this.send({
      kind: 'round-open', round: this.roundData.round, endsAt: this.roundData.endsAt, trackId: this.trackId,
      cars: racing.map((car) => ({ carId: car.id, gear: car.gear, legal: legalGears(car), tyres: car.tyres, brakes: car.brakes, position: car.position })),
      standings: this.standingsSummary(),
    });
    this.emit();
  }

  onGearLock({ guestId, carId, round, gear } = {}) {
    const rd = this.roundData;
    if (this.status !== 'racing' || !rd || rd.settled || round !== rd.round) return;
    const player = this.playerByGuest(guestId);
    if (!player || player.carId !== carId) return;
    const car = this.carById(carId);
    if (!car || car.finished || car.retired) return;
    if (!Number.isInteger(gear) || !legalGears(car).includes(gear)) return;
    if (rd.answers[carId]) return; // already submitted
    rd.gears[carId] = gear;
    if (!rd.deals[carId]) rd.deals[carId] = this.challengeFor(carId, gear);
    this.send({ kind: 'challenge-deal', carId, round: rd.round, challenge: rd.deals[carId] });
    this.emit();
  }

  dealFor(carId) {
    const rd = this.roundData;
    if (!rd.deals[carId]) {
      const car = this.carById(carId);
      const gear = rd.gears[carId] || (car ? car.gear : 1);
      rd.gears[carId] = gear;
      rd.deals[carId] = this.challengeFor(carId, gear);
    }
    return rd.deals[carId];
  }

  onAnswer({ guestId, carId, round, input } = {}) {
    const rd = this.roundData;
    if (this.status !== 'racing' || !rd || rd.settled || round !== rd.round) return;
    const player = this.playerByGuest(guestId);
    if (!player || player.carId !== carId) return;
    const car = this.carById(carId);
    if (!car || car.finished || car.retired) return;
    if (rd.answers[carId]) return;
    const deal = this.dealFor(carId);
    const graded = gradeAnswer(deal, String(input ?? ''));
    rd.answers[carId] = { input: String(input ?? ''), grade: graded.grade };
    this.send({ kind: 'answer-ack', carId, round: rd.round, grade: graded.grade, feedback: graded.feedback, answer: deal.answer, correction: correctionDiff(deal, String(input ?? '')) });
    const racing = activeCars(this.race).map((c) => c.id);
    if (racing.every((id) => rd.answers[id])) this.settleRound();
    else this.emit();
  }

  checkTimer(now = null) {
    const t = now == null ? this.now() : now;
    const rd = this.roundData;
    if (this.status === 'racing' && rd && !rd.settled && t >= rd.endsAt) this.settleRound();
  }

  settleRound() {
    const rd = this.roundData;
    if (!rd || rd.settled) return;
    rd.settled = true;
    const moves = [];
    // One settle pass acts every car that started the round active, in engine
    // order; the engine advances turnIndex itself after each commit.
    const expected = activeCars(this.race).length;
    let guard = 0;
    while (this.race.phase !== 'finished' && moves.length < expected && guard++ < MAX_PLAYERS + 2) {
      const car = currentCar(this.race);
      if (!car) break;
      const gear = rd.gears[car.id] == null ? car.gear : rd.gears[car.id];
      const grade = (rd.answers[car.id] && rd.answers[car.id].grade) || 'pass';
      chooseGear(this.race, gear);
      resolveAnswer(this.race, grade);
      commitMove(this.race, 0);
      moves.push({ carId: car.id, gear, grade, ...this.race.lastEvent });
    }
    this.log.push(...moves);
    this.lastMoves = moves;
    this.settleSeq += 1;
    const finished = this.race.phase === 'finished';
    this.send({ kind: 'round-result', round: rd.round, moves, standings: this.standingsSummary(), finished, log: moves.map((m) => ({ carId: m.carId, message: m.message })) });
    if (finished) this.finishRace();
    else this.openRound();
    this.emit();
  }

  finishRace() {
    if (this.status === 'finished') return;
    this.status = 'finished';
    this.roundData = null;
    this.send({ kind: 'podium', standings: this.standingsSummary(), trackId: this.trackId, log: this.log.slice(-6) });
    this.emit();
  }

  endRaceEarly() {
    if (this.status !== 'racing') return;
    this.log.push({ carId: null, message: 'The teacher waves the chequered flag early.' });
    this.finishRace();
  }

  backToLobby() {
    this.status = 'lobby';
    this.race = null;
    this.roundData = null;
    this.orders = {};
    this.serials = {};
    this.log = [];
    this.send(this.roster());
    this.emit();
  }

  onSync({ guestId } = {}) {
    const player = this.playerByGuest(guestId);
    if (!player) {
      this.send({ kind: 'sync-state', guestId, known: false, status: this.status });
      return;
    }
    player.online = true;
    this.sendSync(player);
  }

  sendSync(player) {
    const rd = this.roundData;
    const car = this.carById(player.carId);
    const payload = {
      kind: 'sync-state', guestId: player.guestId, known: true, status: this.status,
      roomCode: this.roomCode, trackId: this.trackId,
      me: { carId: player.carId, name: player.name, color: player.color, colorName: player.colorName, carNumber: player.carNumber },
      roster: this.roster().players, standings: this.standingsSummary(), log: this.log.slice(-6),
      round: rd ? rd.round : (this.race ? this.race.round : 0), endsAt: rd ? rd.endsAt : 0,
      myCar: null, myGear: null, myChallenge: null, myAck: null,
    };
    if (car && rd && !rd.settled) {
      payload.myCar = { carId: car.id, gear: car.gear, legal: legalGears(car), tyres: car.tyres, brakes: car.brakes, position: car.position, finished: car.finished, retired: car.retired };
      payload.myGear = rd.gears[car.id] ?? null;
      if (rd.deals[car.id]) payload.myChallenge = rd.deals[car.id];
      if (rd.answers[car.id]) {
        const deal = rd.deals[car.id];
        const graded = gradeAnswer(deal, rd.answers[car.id].input);
        payload.myAck = { grade: graded.grade, feedback: graded.feedback, answer: deal.answer, correction: correctionDiff(deal, rd.answers[car.id].input) };
      }
    }
    this.send(payload);
  }
}
