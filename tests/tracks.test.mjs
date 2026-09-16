import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, DEFAULT_TRACK_ID, getTrack, trackLogic } from '../tracks.mjs';

test('registry holds three unique circuits with a valid default', () => {
  assert.ok(TRACKS.length >= 3);
  assert.equal(new Set(TRACKS.map((track) => track.id)).size, TRACKS.length);
  assert.ok(TRACKS.some((track) => track.id === DEFAULT_TRACK_ID));
  assert.equal(getTrack(DEFAULT_TRACK_ID).id, DEFAULT_TRACK_ID);
  assert.throws(() => getTrack('no-such-track'), /Unknown track/);
});

test('every circuit has ordered non-overlapping corner windows inside its lap', () => {
  for (const track of TRACKS) {
    assert.ok(Number.isInteger(track.length) && track.length >= 60);
    assert.ok(track.corners.length >= 2);
    const ids = new Set();
    let previousEnd = -1;
    for (const corner of track.corners) {
      assert.ok(!ids.has(corner.id), `duplicate corner ${corner.id} on ${track.id}`);
      ids.add(corner.id);
      assert.ok(Number.isInteger(corner.start) && Number.isInteger(corner.end) && corner.start < corner.end);
      assert.ok(corner.start >= 0 && corner.end < track.length);
      assert.ok(corner.start > previousEnd, `overlapping corners on ${track.id}`);
      assert.ok(Number.isInteger(corner.stops) && corner.stops >= 1);
      previousEnd = corner.end;
    }
  }
});

test('every circuit carries a closed path and a complete baked layout', () => {
  for (const track of TRACKS) {
    assert.match(track.pathD, /^M/);
    assert.match(track.pathD, /Z$/);
    assert.ok(track.pathD.length > 60);
    const [labelX, labelY] = track.layout.startLabel;
    assert.ok(labelX >= 0 && labelX <= 1176 && labelY >= 0 && labelY <= 620);
    assert.ok(Number.isFinite(track.layout.arrow.x) && Number.isFinite(track.layout.arrow.rotation));
    assert.ok(Number.isFinite(track.layout.finishRotation));
    assert.deepEqual(Object.keys(track.layout.badges).sort(), track.corners.map((corner) => corner.id).sort());
    for (const [x, y] of Object.values(track.layout.badges)) {
      assert.ok(x >= 8 && y >= 8 && x + 168 <= 1168 && y + 48 <= 612, `badge out of frame on ${track.id}`);
    }
  }
});

test('port azure keeps its locked classic values', () => {
  const classic = getTrack('port-azure');
  assert.equal(classic.length, 144);
  assert.deepEqual(classic.corners, [
    { id: 'c1', name: 'The Esses', start: 24, end: 32, stops: 1 },
    { id: 'c2', name: 'Harbour Hairpin', start: 62, end: 74, stops: 2 },
    { id: 'c3', name: 'Last Light', start: 106, end: 116, stops: 1 },
  ]);
});

test('stacked folds stay merged as single 2-stop zones', () => {
  const shape = (track) => getTrack(track).corners.map((c) => [c.id, c.start, c.end, c.stops]);
  assert.deepEqual(shape('riviera'), [
    ['rv1', 4, 12, 1], ['rv2', 58, 66, 1], ['rv3', 81, 103, 1], ['rv4', 112, 141, 2],
  ]);
  assert.deepEqual(shape('lion-city'), [
    ['lc1', 42, 50, 1], ['lc2', 60, 68, 1], ['lc3', 88, 110, 2], ['lc4', 134, 168, 2],
  ]);
});

test('trackLogic snapshots plain data without sharing references', () => {
  const snap = trackLogic(getTrack('riviera'));
  assert.equal(snap.length, 156);
  assert.equal(getTrack('lion-city').length, 180);
  assert.ok(!('pathD' in snap) && !('layout' in snap));
  snap.corners[0].start = -999;
  assert.equal(getTrack('riviera').corners[0].start, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), { ...snap, corners: snap.corners });
});
