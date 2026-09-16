import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, CAR_COLORS, MAX_HUMANS } from '../engine.mjs';
import { parsePairSet } from '../content.mjs';
import {
  MAX_PLAYERS, makeRoomCode, makeRoomPassword, isRoomCode, isRoomPassword,
  sanitizeName, uniqueName, joinUrl, parseJoinHash, createLoopbackBus,
  createSupabaseTransport, channelName, loadPartyConfig, savePartyConfig,
} from '../party/net.mjs';
import { PartyHost } from '../party/host.mjs';
import { GuestClient } from '../party/guest.mjs';

const CODE = 'RACE';
const PASS = '7392';

function room({ players = ['Léa', 'Noé', 'Sacha'], seed = 42, set = null, now = null } = {}) {
  const bus = createLoopbackBus();
  let clock = 1_000_000;
  const hostTransport = bus.attach((payload) => host.handle(payload));
  const host = new PartyHost({
    send: (payload) => hostTransport.send(payload),
    roomCode: CODE, password: PASS, trackId: 'port-azure', set, seed,
    now: now || (() => clock),
  });
  const guests = players.map((name, i) => {
    const guestId = `guest-${i + 1}`;
    const transport = bus.attach((payload) => client.handle(payload));
    const client = new GuestClient({ send: (payload) => transport.send(payload), roomCode: CODE, password: PASS, guestId });
    return { guestId, transport, client };
  });
  return { bus, host, guests, names: players, tick: (ms) => { clock += ms; return clock; } };
}

function joinAll(env) {
  env.guests.forEach(({ client }, i) => {
    assert.equal(client.join(env.names[i]).ok, true);
  });
}

function playRound(env, answerOf) {
  const { host, guests } = env;
  const round = host.roundData.round;
  for (const { client } of guests) {
    const snap = client.snapshot();
    if (snap.phase !== 'gear') continue;
    const gear = Math.max(...snap.myCar.legal);
    assert.equal(client.lockGear(gear), true);
    const deal = client.snapshot().myChallenge;
    assert.ok(deal, 'gear lock deals a challenge');
    assert.equal(client.submitAnswer(answerOf(deal, snap)), true);
  }
  return round;
}

test('room codes, passwords, names, and join links validate strictly', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.equal(isRoomCode(makeRoomCode()), true);
    assert.equal(isRoomPassword(makeRoomPassword()), true);
  }
  assert.equal(isRoomCode('RACE'), true);
  assert.equal(isRoomCode('race'), false);
  assert.equal(isRoomCode('VRO'), false);
  assert.equal(isRoomCode('VRO0'), false); // 0 excluded from the alphabet
  assert.equal(isRoomPassword('7392'), true);
  assert.equal(isRoomPassword('739'), false);
  assert.equal(isRoomPassword('abcd'), false);
  assert.equal(channelName('RACE'), 'apex-party-RACE');
  assert.throws(() => channelName('nope!'), /Invalid room code/);
  assert.equal(sanitizeName('  Léa\tMartin  '), 'Léa Martin');
  assert.equal(sanitizeName('x'.repeat(40)).length, 18);
  assert.equal(sanitizeName('   '), '');
  assert.equal(uniqueName('Léa', ['Noé']), 'Léa');
  assert.equal(uniqueName('Léa', ['Léa']), 'Léa 2');
  assert.equal(uniqueName('Léa', ['Léa', 'Léa 2']), 'Léa 3');
  const url = joinUrl('http://192.168.1.5:4178/', 'RACE', '7392');
  assert.equal(url, 'http://192.168.1.5:4178/#/join/RACE/7392');
  assert.deepEqual(parseJoinHash('#/join/RACE/7392'), { code: 'RACE', password: '7392' });
  assert.deepEqual(parseJoinHash('#/join/race'), { code: 'RACE', password: '' });
  assert.equal(parseJoinHash('#/host'), null);
  assert.equal(parseJoinHash('#/join/VRO!'), null);
});

test('loopback bus never echoes the sender', () => {
  const bus = createLoopbackBus();
  const seen = [[], []];
  const a = bus.attach((payload) => seen[0].push(payload));
  const b = bus.attach((payload) => seen[1].push(payload));
  a.send({ kind: 'ping' });
  assert.deepEqual(seen[0], []);
  assert.deepEqual(seen[1], [{ kind: 'ping' }]);
  b.close();
  a.send({ kind: 'ping2' });
  assert.deepEqual(seen[1].length, 1);
});

test('engine supports a sixteen-driver party grid with unique colors', () => {
  assert.equal(MAX_HUMANS, 16);
  assert.equal(CAR_COLORS.length, 16);
  assert.equal(new Set(CAR_COLORS.map((c) => c.hex)).size, 16);
  assert.equal(new Set(CAR_COLORS.map((c) => c.name)).size, 16);
  const names = Array.from({ length: 16 }, (_, i) => `Driver ${i + 1}`);
  const race = createRace({ names, humanCount: 16, seed: 9, trackId: 'port-azure' });
  assert.equal(race.mode, 'party');
  assert.equal(new Set(race.cars.map((car) => car.color)).size, 16);
  assert.ok(race.cars.every((car) => car.human));
  assert.equal(createRace({ names: names.slice(0, 4), humanCount: 4, seed: 1 }).mode, 'local');
  assert.throws(() => createRace({ names: [...names, 'Extra'], humanCount: 17, seed: 1 }), /between 1 and 16/);
});

test('lobby admits drivers, dedupes names, and refuses bad passwords', () => {
  const env = room();
  joinAll(env);
  assert.equal(env.host.players.length, 3);
  env.guests.forEach(({ client }, i) => {
    const snap = client.snapshot();
    assert.equal(snap.status, 'lobby');
    assert.equal(snap.me.carNumber, i + 1);
    assert.equal(snap.me.color, CAR_COLORS[i].hex);
    assert.equal(snap.roster.length, 3);
  });
  // Duplicate name gets a suffix.
  const bus = env.bus;
  const dup = new GuestClient({ send: () => {}, roomCode: CODE, password: PASS, guestId: 'dup' });
  const dupIn = bus.attach((payload) => dup.handle(payload));
  dup.send = (p) => dupIn.send(p);
  dup.join('Léa');
  assert.equal(dup.snapshot().me.name, 'Léa 2');
  // Wrong password is denied with a reason.
  const denials = [];
  const badT = bus.attach((payload) => bad.handle(payload));
  void badT;
  const bad = new GuestClient({ send: (p) => badT.send(p), roomCode: CODE, password: '0000', guestId: 'bad' });
  bad.onView = () => { if (bad.snapshot().status === 'denied') denials.push(bad.snapshot().denial); };
  bad.join('Intruder');
  assert.equal(bad.snapshot().status, 'denied');
  assert.match(denials[0], /Wrong password/);
});

test('rooms cap at sixteen drivers', () => {
  const names = Array.from({ length: 16 }, (_, i) => `Kid ${i + 1}`);
  const env = room({ players: names });
  joinAll(env);
  assert.equal(env.host.players.length, 16);
  const extra = new GuestClient({ send: () => {}, roomCode: CODE, password: PASS, guestId: 'extra' });
  const t = env.bus.attach((payload) => extra.handle(payload));
  extra.send = (p) => t.send(p);
  extra.join('Seventeenth');
  assert.equal(extra.snapshot().status, 'denied');
  assert.match(extra.snapshot().denial, /full/);
});

test('a full round moves every car and updates every guest', () => {
  const env = room();
  joinAll(env);
  env.host.startRace();
  assert.equal(env.host.status, 'racing');
  for (const { client } of env.guests) {
    const snap = client.snapshot();
    assert.equal(snap.phase, 'gear');
    assert.deepEqual(snap.myCar.legal, [1, 2]);
  }
  playRound(env, (deal) => deal.answer);
  const snap = env.host.snapshot();
  assert.equal(snap.lastMoves.length, 3);
  assert.ok(snap.lastMoves.every((move) => move.grade === 'correct' && move.to > move.from));
  assert.equal(snap.round.round, 2);
  for (const { client } of env.guests) {
    const view = client.snapshot();
    assert.equal(view.round, 2);
    assert.equal(view.standings.length, 3);
    assert.ok(view.myStanding.pos >= 1 && view.myStanding.pos <= 3);
  }
});

test('wrong answers grade down and illegal or stale inputs are ignored', () => {
  const env = room();
  joinAll(env);
  env.host.startRace();
  const [g1, g2, g3] = env.guests;
  // Illegal gear never leaves the device.
  assert.equal(g1.client.lockGear(6), false);
  // Hostile raw gear is ignored by the host.
  g1.transport.send({ kind: 'gear-lock', guestId: 'guest-1', carId: 'car-1', round: 1, gear: 6 });
  assert.deepEqual(Object.keys(env.host.roundData.gears), []);
  g1.client.lockGear(1);
  g2.client.lockGear(2);
  g3.client.lockGear(1);
  g1.client.submitAnswer('nonsense words here');
  assert.equal(g1.client.snapshot().myAck.grade, 'miss');
  g2.client.submitAnswer(g2.client.snapshot().myChallenge.answer);
  g3.client.submitAnswer(''); // pass coasts 1-2 cells
  const moves = env.host.snapshot().lastMoves;
  assert.equal(moves.find((m) => m.carId === 'car-1').grade, 'miss');
  assert.equal(moves.find((m) => m.carId === 'car-3').grade, 'pass');
  // Stale round-1 submission is ignored in round 2.
  g1.transport.send({ kind: 'answer-submit', guestId: 'guest-1', carId: 'car-1', round: 1, input: 'x' });
  assert.deepEqual(Object.keys(env.host.roundData.answers), []);
});

test('silent drivers coast on the timer and answers without gear still count', () => {
  const env = room();
  joinAll(env);
  env.host.startRace();
  const [g1, g2, g3] = env.guests;
  g1.client.lockGear(2);
  g1.client.submitAnswer(g1.client.snapshot().myChallenge.answer);
  // g2 answers without locking: the host deals on the current gear.
  g2.transport.send({ kind: 'answer-submit', guestId: 'guest-2', carId: 'car-2', round: 1, input: '' });
  assert.equal(g2.client.snapshot().myAck.grade, 'pass');
  env.tick(80_000);
  env.host.checkTimer();
  const moves = env.host.snapshot().lastMoves;
  assert.equal(moves.find((m) => m.carId === 'car-3').grade, 'pass');
  assert.equal(env.host.snapshot().round.round, 2);
});

test('a race plays to the podium with ordered standings', () => {
  const env = room({ seed: 7 });
  joinAll(env);
  env.host.startRace();
  let rounds = 0;
  while (env.host.status !== 'finished' && rounds++ < 60) {
    playRound(env, (deal) => deal.answer);
  }
  assert.equal(env.host.status, 'finished');
  const standings = env.host.snapshot().standings;
  assert.deepEqual(standings.map((row) => row.pos), [1, 2, 3]);
  assert.equal(standings[0].finished, true);
  for (const { client } of env.guests) {
    const view = client.snapshot();
    assert.equal(view.status, 'finished');
    assert.equal(view.standings.length, 3);
  }
});

test('sync restores a guest that reconnects mid-round', () => {
  const env = room();
  joinAll(env);
  env.host.startRace();
  const [g1] = env.guests;
  g1.client.lockGear(2);
  const deal = g1.client.snapshot().myChallenge;
  assert.ok(deal);
  // Simulate a dropped device: fresh client object, same guest id.
  const fresh = new GuestClient({ send: (p) => g1.transport.send(p), roomCode: CODE, password: PASS, guestId: 'guest-1' });
  const t = env.bus.attach((payload) => fresh.handle(payload));
  void t;
  fresh.requestSync();
  const snap = fresh.snapshot();
  assert.equal(snap.status, 'racing');
  assert.equal(snap.myChallenge.id, deal.id);
  assert.deepEqual(snap.myCar.legal, [1, 2]);
  assert.equal(snap.me.name, 'Léa');
});

test('leaving updates the grid and the teacher can end early or race again', () => {
  const env = room();
  joinAll(env);
  env.guests[2].transport.send({ kind: 'leave', guestId: 'guest-2' });
  assert.equal(env.host.players.length, 2);
  assert.deepEqual(env.host.players.map((p) => p.carId), ['car-1', 'car-2']);
  assert.equal(env.guests[2].client.snapshot().me.carId, 'car-2');
  env.host.startRace();
  env.guests[0].transport.send({ kind: 'leave', guestId: 'guest-1' });
  assert.equal(env.host.playerByGuest('guest-1').online, false);
  env.host.endRaceEarly();
  assert.equal(env.host.status, 'finished');
  assert.equal(env.guests[0].client.snapshot().status, 'finished');
  env.host.backToLobby();
  assert.equal(env.host.status, 'lobby');
  assert.equal(env.guests[0].client.snapshot().status, 'lobby');
});

test('imported teacher sets deal to every device', () => {
  const parsed = parsePairSet('I like apples. = J’aime les pommes.\nShe plays football. = Elle joue au foot.\nWe are calm. = Nous sommes calmes.\nIt goes well. = Ça va bien.\nThank you. = Merci.\nGood evening. = Bonsoir.', 'Pass 02');
  assert.equal(parsed.ok, true);
  const env = room({ set: parsed.set, seed: 3 });
  joinAll(env);
  env.host.startRace();
  const [g1] = env.guests;
  g1.client.lockGear(1);
  const deal = g1.client.snapshot().myChallenge;
  assert.match(deal.id, /^imp-/);
  assert.match(deal.prompt, /mean\? Type it in English/);
});

test('supabase transport queues early sends and filters junk', async () => {
  const sent = [];
  const handlers = {};
  let subCb = null;
  let removed = null;
  const fakeChannel = {
    on: (type, filter, cb) => { handlers[type] = cb; },
    subscribe: (cb) => { subCb = cb; return fakeChannel; },
    send: (message) => { sent.push(message); },
  };
  const fakeClient = {
    lastName: '',
    channel: (name) => { fakeClient.lastName = name; return fakeChannel; },
    removeChannel: (channel) => { removed = channel; },
  };
  const received = [];
  const pending = createSupabaseTransport({
    url: 'https://xyzcompany.supabase.co', key: 'anon-key', roomCode: 'RACE',
    onMessage: (payload) => received.push(payload),
    clientFactory: async () => fakeClient,
  });
  for (let i = 0; i < 20 && !subCb; i += 1) await Promise.resolve();
  assert.ok(subCb, 'subscribes to the room channel');
  subCb('SUBSCRIBED');
  const transport = await pending;
  assert.equal(transport.ready, true);
  assert.equal(fakeClient.lastName, 'apex-party-RACE');
  transport.send({ kind: 'live' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, 'party');
  assert.deepEqual(sent[0].payload, { kind: 'live' });
  subCb('TIMED_OUT');
  transport.send({ kind: 'queued' });
  assert.equal(sent.length, 1);
  subCb('SUBSCRIBED');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].payload, { kind: 'queued' });
  handlers.broadcast({ payload: { kind: 'hello' } });
  handlers.broadcast({ payload: 'junk' });
  handlers.broadcast({ payload: null });
  assert.deepEqual(received, [{ kind: 'hello' }]);
  transport.send('junk');
  assert.equal(sent.length, 2);
  transport.close();
  assert.equal(removed, fakeChannel);
  await assert.rejects(() => createSupabaseTransport({ url: '', key: 'k', roomCode: 'VROO' }), /required/);
  await assert.rejects(() => createSupabaseTransport({ url: 'https://x.supabase.co', key: 'k', roomCode: 'bad!' }), /Invalid room code/);
});

test('party config resolves from file, then browser storage', async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(await loadPartyConfig({ storage, configModule: {} }), null);
  const saved = savePartyConfig('https://xyzcompany.supabase.co/', 'a'.repeat(40), storage);
  assert.equal(saved.ok, true);
  const fromBrowser = await loadPartyConfig({ storage, configModule: {} });
  assert.equal(fromBrowser.source, 'browser');
  assert.equal(fromBrowser.url, 'https://xyzcompany.supabase.co');
  const fromFile = await loadPartyConfig({ storage, configModule: { SUPABASE_URL: 'https://file.supabase.co', SUPABASE_ANON_KEY: 'k'.repeat(40) } });
  assert.equal(fromFile.source, 'file');
  assert.equal(savePartyConfig('http://nope', 'short', storage).ok, false);
});
