// Learner device state (no DOM: the guest view renders snapshots). The guest
// picks a gear, answers the dealt challenge, grades instantly for feedback,
// and sends the raw input to the host, whose grade is authoritative.
import { gradeAnswer, correctionDiff } from '../content.mjs';
import { sanitizeName } from './net.mjs';

export class GuestClient {
  constructor({ send, roomCode, password, guestId } = {}) {
    if (typeof send !== 'function') throw new Error('GuestClient needs a send function');
    this.send = send;
    this.roomCode = roomCode;
    this.password = password;
    this.guestId = guestId;
    this.status = 'join'; // join | lobby | racing | finished | denied
    this.denial = '';
    this.me = null;
    this.roster = [];
    this.trackId = 'port-azure';
    this.round = 0;
    this.endsAt = 0;
    this.myCar = null;
    this.myGear = null;
    this.myChallenge = null;
    this.myGrade = null; // instant local {grade, feedback, correction, answer}
    this.myAck = null; // authoritative host ack
    this.standings = [];
    this.lastMoves = [];
    this.log = [];
    this.onView = null;
  }

  emit() { try { this.onView && this.onView(this.snapshot()); } catch {} }

  myStanding() {
    return this.standings.find((row) => this.me && row.carId === this.me.carId) || null;
  }

  // Sub-phase inside a race round for the view to render.
  phase() {
    if (this.status !== 'racing') return this.status;
    if (!this.myCar || this.myCar.finished || this.myCar.retired) return 'observing';
    if (this.myAck || this.myGrade) return 'waiting';
    if (this.myChallenge) return 'question';
    if (this.round > 0) return 'gear';
    return 'racing';
  }

  snapshot() {
    return {
      status: this.status, denial: this.denial, me: this.me, roster: this.roster,
      trackId: this.trackId, round: this.round, endsAt: this.endsAt, phase: this.phase(),
      myCar: this.myCar, myGear: this.myGear, myChallenge: this.myChallenge,
      myGrade: this.myGrade, myAck: this.myAck, standings: this.standings,
      myStanding: this.myStanding(), lastMoves: this.lastMoves, log: this.log,
    };
  }

  join(name) {
    const clean = sanitizeName(name);
    if (!clean) return { ok: false, error: 'Type your name to join the grid.' };
    this.status = 'join';
    this.denial = '';
    this.send({ kind: 'join-request', guestId: this.guestId, name: clean, password: this.password });
    this.emit();
    return { ok: true };
  }

  requestSync() {
    this.send({ kind: 'sync-request', guestId: this.guestId });
  }

  lockGear(gear) {
    if (this.phase() !== 'gear' || !this.myCar) return false;
    if (!Number.isInteger(gear) || !(this.myCar.legal || []).includes(gear)) return false;
    this.myGear = gear;
    this.send({ kind: 'gear-lock', guestId: this.guestId, carId: this.me.carId, round: this.round, gear });
    this.emit();
    return true;
  }

  submitAnswer(input) {
    if (this.phase() !== 'question' || !this.myChallenge) return false;
    const text = String(input ?? '');
    const graded = gradeAnswer(this.myChallenge, text);
    this.myGrade = { grade: graded.grade, feedback: graded.feedback, answer: this.myChallenge.answer, correction: correctionDiff(this.myChallenge, text) };
    this.send({ kind: 'answer-submit', guestId: this.guestId, carId: this.me.carId, round: this.round, input: text });
    this.emit();
    return true;
  }

  handle(payload) {
    if (!payload || typeof payload !== 'object') return;
    const kind = payload.kind;
    if (kind === 'admit' && payload.guestId === this.guestId) {
      this.me = { carId: payload.carId, name: payload.name, color: payload.color, colorName: payload.colorName, carNumber: payload.carNumber };
      this.status = payload.status === 'racing' ? 'racing' : payload.status === 'finished' ? 'finished' : 'lobby';
      if (payload.trackId) this.trackId = payload.trackId;
      this.emit();
    } else if (kind === 'deny' && payload.guestId === this.guestId) {
      this.status = 'denied';
      this.denial = String(payload.reason || 'Could not join.');
      this.emit();
    } else if (kind === 'roster') {
      this.roster = Array.isArray(payload.players) ? payload.players : [];
      if (this.me && payload.status === 'lobby' && this.status !== 'join') {
        this.status = 'lobby';
        this.round = 0; this.myChallenge = null; this.myGrade = null; this.myAck = null; this.myGear = null;
      }
      this.emit();
    } else if (kind === 'round-open') {
      this.status = 'racing';
      this.round = payload.round;
      this.endsAt = payload.endsAt;
      if (payload.trackId) this.trackId = payload.trackId;
      this.standings = Array.isArray(payload.standings) ? payload.standings : [];
      this.myGrade = null; this.myAck = null; this.myGear = null; this.myChallenge = null;
      const cars = Array.isArray(payload.cars) ? payload.cars : [];
      this.myCar = (this.me && cars.find((car) => car.carId === this.me.carId)) || null;
      if (this.myCar) this.myCar = { ...this.myCar, finished: false, retired: false };
      this.emit();
    } else if (kind === 'challenge-deal' && this.me && payload.carId === this.me.carId && payload.round === this.round) {
      this.myChallenge = payload.challenge;
      this.emit();
    } else if (kind === 'answer-ack' && this.me && payload.carId === this.me.carId && payload.round === this.round) {
      this.myAck = { grade: payload.grade, feedback: payload.feedback, answer: payload.answer, correction: payload.correction || null };
      this.emit();
    } else if (kind === 'round-result') {
      this.lastMoves = Array.isArray(payload.moves) ? payload.moves : [];
      this.standings = Array.isArray(payload.standings) ? payload.standings : [];
      if (Array.isArray(payload.log)) this.log = payload.log.slice(-6);
      this.emit();
    } else if (kind === 'podium') {
      this.status = 'finished';
      this.standings = Array.isArray(payload.standings) ? payload.standings : [];
      if (payload.trackId) this.trackId = payload.trackId;
      if (Array.isArray(payload.log)) this.log = payload.log;
      this.emit();
    } else if (kind === 'sync-state' && payload.guestId === this.guestId) {
      this.applySync(payload);
    }
  }

  applySync(payload) {
    if (!payload.known) {
      this.status = 'join';
      this.me = null;
      this.emit();
      return;
    }
    this.me = payload.me;
    this.roster = Array.isArray(payload.roster) ? payload.roster : [];
    this.standings = Array.isArray(payload.standings) ? payload.standings : [];
    if (Array.isArray(payload.log)) this.log = payload.log;
    if (payload.trackId) this.trackId = payload.trackId;
    if (payload.status === 'lobby') {
      this.status = 'lobby';
      this.round = 0;
    } else if (payload.status === 'finished') {
      this.status = 'finished';
    } else {
      this.status = 'racing';
      this.round = payload.round || 0;
      this.endsAt = payload.endsAt || 0;
      this.myCar = payload.myCar || null;
      this.myGear = payload.myGear ?? null;
      this.myChallenge = payload.myChallenge || null;
      this.myAck = payload.myAck || null;
      if (this.myAck) this.myGrade = null;
    }
    this.emit();
  }
}
