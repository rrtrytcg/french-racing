import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_BANK, getChallenge, gradeAnswer, normalizeAnswer, correctionDiff, parsePairSet, getSetChallenge, shuffledOrder, gearChallengeCount } from '../content.mjs';

test('pass 01 bank exposes 34 unique challenges with the four locked exercise types', () => {
  assert.equal(typeof DEMO_BANK.title, 'string');
  assert.ok(DEMO_BANK.phrases.length >= 6);
  const ids = new Set();
  const expected = { 1: 'typed', 2: 'jumble', 3: 'typed', 4: 'jumble', 5: 'typed', 6: 'typed' };
  for (let gear = 1; gear <= 6; gear += 1) {
    const count = gearChallengeCount(gear);
    const challenges = Array.from({ length: count }, (_, serial) => getChallenge(gear, serial));
    assert.equal(challenges.length, count);
    for (const challenge of challenges) {
      assert.equal(challenge.gear, gear);
      assert.equal(challenge.type, expected[gear]);
      assert.ok(!ids.has(challenge.id), `duplicate challenge id ${challenge.id}`);
      ids.add(challenge.id);
      assert.equal(typeof challenge.answer, 'string');
      assert.ok(challenge.accepted.includes(challenge.answer));
      assert.ok(challenge.hint.length > 0);
      if (challenge.type === 'jumble') assert.ok(Array.isArray(challenge.tokens) && challenge.tokens.length >= 3);
    }
  }
  assert.equal(ids.size, 34);
});

test('each gear uses its assigned task format', () => {
  for (let serial = 0; serial < 6; serial += 1) {
    assert.match(getChallenge(1, serial).prompt, /Type it in English/);
    assert.match(getChallenge(2, serial).prompt, /Put the words in order/);
    assert.match(getChallenge(3, serial).prompt, /Fill the gap/);
    assert.match(getChallenge(4, serial).prompt, /Put the words in order/);
    assert.match(getChallenge(5, serial).prompt, /Write in French/);
    assert.match(getChallenge(6, serial).prompt, /Build one French sentence/);
  }
});

test('reorder tokens cover the answer exactly and never start solved', () => {
  const words = (value) => normalizeAnswer(value).split(' ').sort().join(' ');
  for (const gear of [2, 4]) {
    for (let serial = 0; serial < 6; serial += 1) {
      const challenge = getChallenge(gear, serial);
      assert.equal(words(challenge.tokens.join(' ')), words(challenge.answer));
      assert.notEqual(normalizeAnswer(challenge.tokens.join(' ')), normalizeAnswer(challenge.answer));
    }
  }
});

test('challenge selection is cyclic and returns independent copies', () => {
  const first = getChallenge(5, 0);
  const wrapped = getChallenge(5, 6);
  assert.deepEqual(wrapped, first);
  wrapped.prompt = 'mutated test copy';
  assert.notEqual(getChallenge(5, 0).prompt, wrapped.prompt);
  const jumble = getChallenge(2, 0);
  jumble.tokens.push('mutated token');
  assert.ok(!getChallenge(2, 0).tokens.includes('mutated token'));
});

test('typed grading normalizes case, accents, apostrophes and punctuation', () => {
  assert.equal(normalizeAnswer('  Je m’appelle   Antoine!!! '), 'je m appelle antoine');
  const cloze = getChallenge(3, 3); // détendue
  assert.equal(gradeAnswer(cloze, 'DETENDUE.').grade, 'correct');
  const sentence = getChallenge(5, 1); // Ça va mal.
  assert.equal(gradeAnswer(sentence, "ca va MAL!!!").grade, 'correct');
});

test('english answers are graded by meaning, never by french text', () => {
  const challenge = getChallenge(1, 0); // heureux -> happy
  assert.equal(gradeAnswer(challenge, 'happy').grade, 'correct');
  assert.equal(gradeAnswer(challenge, 'Happy!').grade, 'correct');
  assert.equal(gradeAnswer(challenge, 'heureux').grade, 'miss');
  assert.equal(gradeAnswer(challenge, 'sad').grade, 'miss');
  const thanks = getChallenge(1, 4); // merci
  assert.equal(gradeAnswer(thanks, 'thank you').grade, 'correct');
  assert.equal(gradeAnswer(thanks, 'thanks').grade, 'partial');
});

test('agreement errors earn partial credit through curated variants', () => {
  const feminine = getChallenge(3, 3); // détendue (f)
  assert.equal(gradeAnswer(feminine, 'détendue').grade, 'correct');
  assert.equal(gradeAnswer(feminine, 'détendu').grade, 'partial');
  assert.equal(gradeAnswer(feminine, 'heureuse').grade, 'miss');
  const sentence = getChallenge(5, 5); // ...énervée (f)
  assert.equal(gradeAnswer(sentence, 'Bonjour. Aujourd’hui ça va très mal parce que je suis très énervé.').grade, 'partial');
  assert.equal(gradeAnswer(sentence, '').grade, 'pass');
});

test('reorder grading rewards exact order and partial word sets', () => {
  const challenge = getChallenge(2, 0); // Je suis calme.
  assert.equal(gradeAnswer(challenge, 'Je suis calme.').grade, 'correct');
  assert.equal(gradeAnswer(challenge, 'Je calme suis').grade, 'partial');
  assert.equal(gradeAnswer(challenge, 'Je suis').grade, 'miss');
  assert.equal(gradeAnswer(challenge, '').grade, 'pass');
});

test('correction highlights only the missing feminine e', () => {
  const challenge = getChallenge(3, 3); // détendue
  const segments = correctionDiff(challenge, 'détendu');
  assert.equal(segments.map((part) => part.text).join(''), 'détendue');
  assert.deepEqual(segments.filter((part) => part.changed).map((part) => part.text), ['e']);
});

test('correction segments cover the model and flag misplaced reorder words', () => {
  const typedChallenge = getChallenge(5, 1); // Ça va mal.
  const segments = correctionDiff(typedChallenge, 'Ça va bien.');
  assert.equal(segments.map((part) => part.text).join(''), 'Ça va mal.');
  assert.ok(segments.some((part) => part.changed));
  const jumble = getChallenge(2, 0); // Je suis calme.
  const wordSegments = correctionDiff(jumble, 'Je calme suis');
  assert.equal(wordSegments.map((part) => part.text).join(''), 'Je suis calme.');
  assert.deepEqual(wordSegments.filter((part) => part.changed).map((part) => part.text), ['suis']);
});

test('correction returns null for correct answers, passes and unknown types', () => {
  const challenge = getChallenge(3, 3);
  assert.equal(correctionDiff(challenge, 'détendue'), null);
  assert.equal(correctionDiff(challenge, ''), null);
  assert.equal(correctionDiff(challenge, '   '), null);
  assert.equal(correctionDiff({ type: 'choice', answer: 'x', accepted: ['x'] }, 'y'), null);
  const alt = getChallenge(3, 1); // très/super
  assert.equal(correctionDiff(alt, 'super'), null);
});

test('content rejects invalid challenge requests', () => {
  assert.throws(() => getChallenge(0, 0), /Invalid challenge gear/);
  assert.throws(() => getChallenge(7, 0), /Invalid challenge gear/);
  assert.throws(() => getChallenge(1, -1), /Invalid challenge serial/);
  assert.throws(() => getChallenge(1, 1.5), /Invalid challenge serial/);
});

const SAMPLE_PAIRS = [
  'I like apples. = J’aime les pommes.',
  'She plays football. = Elle joue au foot.',
  'We eat bread. = Nous mangeons du pain.',
  'He drinks milk. = Il boit du lait.',
  'They read books. = Ils lisent des livres.',
  'You swim fast. = Tu nages vite.',
  'I watch films. = Je regarde des films.',
  'She sings well. = Elle chante bien.',
];

function importSample(text = SAMPLE_PAIRS.join('\n'), name = 'Test set') {
  const result = parsePairSet(text, name);
  assert.equal(result.ok, true);
  return result.set;
}

test('importer parses pairs and deals one challenge per pair across gears', () => {
  const set = importSample();
  assert.equal(set.pairs.length, 8);
  assert.equal(set.phrases.length, 8);
  assert.deepEqual(set.phrases[0], { fr: 'J’aime les pommes.', en: 'I like apples.' });
  const counts = [1, 2, 3, 4, 5, 6].map((gear) => set.gears[gear].length);
  assert.deepEqual(counts, [2, 2, 1, 1, 1, 1]);
  const ids = new Set(Object.values(set.gears).flat().map((c) => c.id));
  assert.equal(ids.size, 8);
});

test('imported gears use their assigned task formats', () => {
  const set = importSample();
  const byGear = (gear) => set.gears[gear][0];
  assert.equal(byGear(1).type, 'typed');
  assert.match(byGear(1).prompt, /Type it in English/);
  assert.equal(byGear(1).answer, 'I like apples.');
  assert.equal(byGear(2).type, 'jumble');
  assert.match(byGear(3).prompt, /Fill the gap:/);
  assert.ok(!byGear(3).prompt.includes('gaps'));
  assert.equal(byGear(4).type, 'jumble');
  assert.equal(byGear(5).type, 'typed');
  assert.match(byGear(5).prompt, /Write in French/);
  assert.match(byGear(6).prompt, /Fill the gaps:/);
});

test('imported reorder tokens cover the answer and never start solved', () => {
  const set = importSample();
  const words = (value) => normalizeAnswer(value).split(' ').sort().join(' ');
  for (const challenge of [...set.gears[2], ...set.gears[4]]) {
    assert.equal(words(challenge.tokens.join(' ')), words(challenge.answer));
    assert.notEqual(normalizeAnswer(challenge.tokens.join(' ')), normalizeAnswer(challenge.answer));
  }
});

test('imported cloze blanks a real word from its sentence', () => {
  const set = importSample();
  const cloze = set.gears[3][0];
  assert.ok(cloze.prompt.includes('___'));
  assert.ok(normalizeAnswer('Nous mangeons du pain.').split(' ').includes(normalizeAnswer(cloze.answer)));
  assert.equal(gradeAnswer(cloze, cloze.answer).grade, 'correct');
  const gaps = set.gears[6][0];
  assert.equal(gaps.prompt.split('___').length - 1, 2);
  assert.equal(gaps.answer, 'Tu nages vite.');
});

test('imported build is deterministic for identical input', () => {
  const first = importSample();
  const second = importSample();
  const stripIds = (set) => JSON.parse(JSON.stringify(set.gears, (key, value) => (key === 'id' ? undefined : value)));
  assert.deepEqual(stripIds(first), stripIds(second));
});

test('importer rejects malformed input with line-numbered errors', () => {
  assert.deepEqual(parsePairSet('no separator here\nSecond bad line', 'x').errors.length, 2);
  assert.match(parsePairSet('no separator', 'x').errors[0], /Line 1.*missing/);
  assert.match(parsePairSet('English only = ', 'x').errors[0], /both sides/);
  assert.match(parsePairSet(' = French only', 'x').errors[0], /both sides/);
  assert.match(parsePairSet('One = Un.', 'x').errors[0], /at least 6/);
  assert.match(parsePairSet(SAMPLE_PAIRS.join('\n'), '   ').errors[0], /name/);
  const blankOk = parsePairSet('\n' + SAMPLE_PAIRS.join('\n') + '\n\n', 'Blank lines');
  assert.equal(blankOk.ok, true);
  const tooMany = Array.from({ length: 61 }, (_, i) => `Line ${i} en. = Ligne ${i} fr.`);
  assert.match(parsePairSet(tooMany.join('\n'), 'Big').errors[0], /at most 60/);
});

test('shuffled orders are deterministic permutations that vary by seed', () => {
  const first = shuffledOrder(6, 'race-1|car-1|1');
  assert.deepEqual(shuffledOrder(6, 'race-1|car-1|1'), first);
  assert.deepEqual([...first].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  const distinct = new Set(Array.from({ length: 10 }, (_, i) => shuffledOrder(6, `race-${i}`).join(',')));
  assert.ok(distinct.size > 1);
  assert.throws(() => shuffledOrder(0, 'x'), /Invalid order length/);
});

test('builtin gear counts are exposed for order mapping', () => {
  const expected = { 1: 6, 2: 5, 3: 5, 4: 6, 5: 6, 6: 6 };
  for (let gear = 1; gear <= 6; gear += 1) assert.equal(gearChallengeCount(gear), expected[gear]);
  assert.throws(() => gearChallengeCount(0), /Invalid challenge gear/);
});

test('set challenges cycle per gear and reject invalid requests', () => {
  const set = importSample();
  assert.deepEqual(getSetChallenge(set, 1, 2), getSetChallenge(set, 1, 0));
  const copy = getSetChallenge(set, 2, 0);
  copy.tokens.push('mutated token');
  assert.ok(!getSetChallenge(set, 2, 0).tokens.includes('mutated token'));
  assert.throws(() => getSetChallenge(set, 0, 0), /Invalid set challenge gear/);
  assert.throws(() => getSetChallenge(set, 7, 0), /Invalid set challenge gear/);
  assert.throws(() => getSetChallenge(null, 1, 0), /Invalid set challenge gear/);
  assert.throws(() => getSetChallenge({ gears: { 1: [] } }, 1, 0), /Invalid set challenge gear/);
  assert.throws(() => getSetChallenge(set, 1, -1), /Invalid challenge serial/);
});
