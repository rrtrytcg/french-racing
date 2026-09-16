// French Pass 01: teacher sentence builder — greetings, ça va, feelings.
// Teacher-authored set; see CURRICULUM_NOTES.md for source mapping.
export const DEMO_BANK = {
  title: 'French Pass 01 · Greetings and feelings',
  description: 'Greet the paddock and say how today is going. Practise these greetings, ça va patterns and feeling words before racing. Paddock talk for race day.',
  source: { file: '../curriculum/IGCSE 0520 vocab list.xlsx', syllabus: '0520, examination from 2028', topic: 'Greetings and feelings', note: 'Teacher sentence builder. Core greetings and feelings checked against the list; connector frames and sentence patterns authored by the teacher. See CURRICULUM_NOTES.md.' },
  phrases: [
    { fr: 'Salut.', en: 'Hello. (informal)' },
    { fr: 'Bonjour.', en: 'Good day. (hello)' },
    { fr: 'Bonsoir.', en: 'Good evening.' },
    { fr: 'Comment tu t’appelles ?', en: 'How are you called? (informal)' },
    { fr: 'Je m’appelle Antoine.', en: 'I am called Antoine.' },
    { fr: 'Ça va.', en: 'It is going OK.' },
    { fr: 'Ça va bien.', en: 'It is going well.' },
    { fr: 'Ça va mal.', en: 'It is going badly.' },
    { fr: 'très bien', en: 'very well' },
    { fr: 'merci', en: 'thank you' },
    { fr: 'parce que', en: 'because' },
    { fr: 'mais', en: 'but' },
    { fr: 'Je suis heureux.', en: 'I am happy. (m)' },
    { fr: 'Je suis heureuse.', en: 'I am happy. (f)' },
    { fr: 'Je suis triste.', en: 'I am sad.' },
    { fr: 'Je suis calme.', en: 'I am calm.' }
  ],
  gradingNote: 'This bank checks the displayed target patterns and listed alternatives. Case, accents and punctuation do not affect the result. A wrong adjective ending is partial credit: study the highlighted correction. Reorder tasks accept the exact order; right words in the wrong order earn partial credit.'
};

const typed = (id, gear, prompt, answer, accepted=[], partials=[], hint='') => ({id,gear,type:'typed',prompt,answer,accepted:[answer,...accepted],partials,hint});
const jumble = (id, gear, prompt, answer, shown, hint='') => ({id,gear,type:'jumble',prompt,answer,tokens:shown,accepted:[answer],partials:[],hint});
const BANK = {
  1: [
    typed('g1-heureux',1,'What does « heureux » mean? Type it in English.','happy',[],[],'A feeling word. Masculine form shown.'),
    typed('g1-triste',1,'What does « triste » mean? Type it in English.','sad',[],[],'A feeling word. Same form for everyone.'),
    typed('g1-calme',1,'What does « calme » mean? Type it in English.','calm',[],[],'A feeling word. Same form for everyone.'),
    typed('g1-mal',1,'What does « mal » mean? Type it in English.','badly',[],[],'Describes how today is going.'),
    typed('g1-merci',1,'What does « merci » mean? Type it in English.','thank you',[],['thanks'],'Say it when things go well.'),
    typed('g1-tres-bien',1,'What does « très bien » mean? Type it in English.','very well',[],[],'Two words: how well is it going?')
  ],
  2: [
    jumble('g2-calme',2,'Put the words in order: I am calm.','Je suis calme.',['calme.','Je','suis'],'Start with Je.'),
    jumble('g2-mal',2,'Put the words in order: It is going badly.','Ça va mal.',['mal.','Ça','va'],'Start with Ça.'),
    jumble('g2-name',2,'Put the words in order: I am called Antoine.','Je m’appelle Antoine.',['Antoine.','Je','m’appelle'],'Start with Je.'),
    jumble('g2-bien',2,'Put the words in order: It is going very well.','Ça va très bien.',['très','bien.','Ça','va'],'The intensifier sits before bien.'),
    jumble('g2-triste',2,'Put the words in order: I am very sad.','Je suis très triste.',['triste.','Je','très','suis'],'The feeling word goes last.'),
    jumble('g2-soir',2,'Put the words in order: Good evening. It is going badly.','Bonsoir. Ça va mal.',['va','Bonsoir.','mal.','Ça'],'The greeting comes first.')
  ],
  3: [
    typed('g3-suis',3,'Fill the gap: Je ___ calme.','suis',[],[],'Write only the missing word. Meaning: I am calm.'),
    typed('g3-antoine',3,'Fill the gap: Je m’appelle ___.','Antoine',[],[],'Write only the missing name.'),
    typed('g3-bien',3,'Fill the gap: Ça va ___ bien.','très',['super'],[],'Write the intensifier: very or really.'),
    typed('g3-enerve',3,'Fill the gap: Je suis un peu ___ (m).','énervé',[],['énervée'],'Write the feeling word. Masculine ending.'),
    typed('g3-detendue',3,'Fill the gap: Je suis très ___ (f).','détendue',[],['détendu'],'Write the feeling word. Feminine ending: do not forget the final e.'),
    typed('g3-comment',3,'Fill the gap: ___ tu t’appelles ?','Comment',[],[],'Write the question word meaning “how”.')
  ],
  4: [
    jumble('g4-heureux',4,'Put the words in order: Hello. Today it is going very well, thank you, because I am very happy.','Salut. Aujourd’hui ça va très bien, merci, parce que je suis très heureux.',['parce','Salut.','Aujourd’hui','très','merci,','ça','heureux.','que','je','va','bien,','suis','très'],'Greeting first, feeling last. Watch the two très.'),
    jumble('g4-heureuse',4,'Put the words in order: Good evening. Today it is going very badly but I am quite happy (f).','Bonsoir. Aujourd’hui ça va très mal mais je suis assez heureuse.',['mais','heureuse.','Aujourd’hui','Bonsoir.','assez','ça','je','mal','suis','va','très'],'Mais links the bad day to the happy ending.'),
    jumble('g4-detendue',4,'Put the words in order: Good day. Today it is going very well, thank you, because I am quite relaxed (f).','Bonjour. Aujourd’hui ça va très bien, merci, parce que je suis assez détendue.',['assez','merci,','Bonjour.','parce','détendue.','très','je','ça','que','va','bien,','Aujourd’hui','suis'],'Merci sits inside commas.'),
    jumble('g4-enerve',4,'Put the words in order: Hello. Today it is going badly because I am a bit annoyed.','Salut. Aujourd’hui ça va mal parce que je suis un peu énervé.',['parce','mal','Salut.','un','je','ça','que','Aujourd’hui','peu','suis','énervé.','va'],'Un peu is two words that stay together.'),
    jumble('g4-stresse',4,'Put the words in order: Good evening. Today it is going very well but I am quite stressed.','Bonsoir. Aujourd’hui ça va très bien mais je suis assez stressé.',['stressé.','très','Bonsoir.','mais','assez','va','bien','je','Aujourd’hui','ça','suis'],'Mais contrasts the good day with stress.'),
    jumble('g4-triste',4,'Put the words in order: Hello. Today it is going really well but I am very sad.','Salut. Aujourd’hui ça va super bien mais je suis très triste.',['super','triste.','Salut.','mais','très','va','bien','je','Aujourd’hui','ça','suis'],'Super bien means really well.')
  ],
  5: [
    typed('g5-calme',5,'Write in French: I am calm.','Je suis calme.',[],['calme'],'Use the je suis pattern from practice.'),
    typed('g5-mal',5,'Write in French: It is going badly.','Ça va mal.',[],['mal'],'Use the ça va pattern from practice.'),
    typed('g5-heureux',5,'Write in French: Good evening. Today it is going very well because I am happy.','Bonsoir. Aujourd’hui ça va très bien parce que je suis heureux.',[],['Bonsoir.','Ça va très bien.','Je suis heureux.'],'Link a greeting, the day, and a feeling with “because”.'),
    typed('g5-calme2',5,'Write in French: Hello. Today it is going badly but I am calm.','Salut. Aujourd’hui ça va mal mais je suis calme.',[],['Salut.','Ça va mal.','Je suis calme.'],'Mais contrasts the bad day with calm.'),
    typed('g5-triste',5,'Write in French: Good evening. Today it is going badly because I am very sad.','Bonsoir. Aujourd’hui ça va mal parce que je suis très triste.',[],['Bonsoir.','Ça va mal.','Je suis très triste.'],'Give the reason with parce que.'),
    typed('g5-enervee',5,'Write in French: Good day. Today it is going very badly because I am very annoyed (f).','Bonjour. Aujourd’hui ça va très mal parce que je suis très énervée.',[],['Bonjour. Aujourd’hui ça va très mal parce que je suis très énervé.','Je suis très énervée.','Ça va très mal.'],'Feminine ending: do not forget the final e.')
  ],
  6: [
    typed('g6-soir',6,'Build one French sentence: greet with Bonsoir, say today is going very well, and say you are calm or happy.','Bonsoir. Aujourd’hui ça va très bien parce que je suis calme.',['Bonsoir. Aujourd’hui ça va très bien parce que je suis heureux.'],['Bonsoir.','Ça va très bien.','Je suis calme.','Je suis heureux.'],'Guided production: greeting + day + feeling with parce que.'),
    typed('g6-salut',6,'Build one French sentence: greet with Salut, say it is going badly, and say you are calm or very sad.','Salut. Aujourd’hui ça va mal mais je suis calme.',['Salut. Aujourd’hui ça va mal parce que je suis très triste.'],['Salut.','Ça va mal.','Je suis calme.','Je suis très triste.'],'Guided production: mais contrasts, parce que explains.'),
    typed('g6-bonjour',6,'Build one French sentence: greet with Bonjour, say today is going very well, thank them, and say you are quite relaxed (f) or a bit annoyed (f).','Bonjour. Aujourd’hui ça va très bien, merci, parce que je suis assez détendue.',['Bonjour. Aujourd’hui ça va très bien, merci, mais je suis un peu énervée.'],['Bonjour.','Ça va très bien.','Je suis assez détendue.','Je suis un peu énervée.'],'Guided production: watch both feminine endings.'),
    typed('g6-stress',6,'Build one French sentence: greet with Salut, say today is going very well, and say you are quite stressed (m) or very sad.','Salut. Aujourd’hui ça va très bien mais je suis assez stressé.',['Salut. Aujourd’hui ça va très bien mais je suis très triste.'],['Salut.','Ça va très bien.','Je suis assez stressé.','Je suis très triste.'],'Guided production: mais joins the good day to the feeling.'),
    typed('g6-optimiste',6,'Build one French sentence: greet with Salut, say today is going very well, and say you are optimistic or calm.','Salut. Aujourd’hui ça va très bien parce que je suis optimiste.',['Salut. Aujourd’hui ça va très bien parce que je suis calme.'],['Salut.','Ça va très bien.','Je suis optimiste.','Je suis calme.'],'Guided production: optimiste never changes its ending.'),
    typed('g6-enerve',6,'Build one French sentence: greet with Bonsoir, say it is going badly, and say you are a bit annoyed (m) or very sad.','Bonsoir. Aujourd’hui ça va mal parce que je suis un peu énervé.',['Bonsoir. Aujourd’hui ça va mal parce que je suis très triste.'],['Bonsoir.','Ça va mal.','Je suis un peu énervé.','Je suis très triste.'],'Guided production: un peu is two words.')
  ]
};

export function getChallenge(gear,serial=0) {
  if (!Number.isInteger(gear) || !BANK[gear]) throw new Error('Invalid challenge gear');
  if (!Number.isInteger(serial) || serial<0) throw new Error('Invalid challenge serial');
  return structuredClone(BANK[gear][serial % BANK[gear].length]);
}
export function normalizeAnswer(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/œ/g,'oe').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

// Same normalization as normalizeAnswer, but remembers which original
// character produced each normalized character so diffs can be shown
// on the displayed model answer.
function normalizeWithMap(value) {
  const original = String(value ?? '');
  const stripped = original.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  let norm = '';
  const map = [];
  let pendingSpace = -1;
  const flushSpace = () => {
    if (pendingSpace < 0 || !norm || norm.endsWith(' ')) { pendingSpace = -1; return; }
    norm += ' ';
    map.push(pendingSpace);
    pendingSpace = -1;
  };
  // Iterate the NFD-stripped string; indices past removed marks still point
  // at the right base character for display purposes.
  let j = 0;
  for (const ch of stripped.toLowerCase().replace(/œ/g,'oe')) {
    void j;
    if (/[a-z0-9]/.test(ch)) { flushSpace(); norm += ch; map.push(Math.min(j, original.length - 1)); }
    else pendingSpace = Math.min(j, original.length - 1);
    j += 1;
  }
  norm = norm.trim();
  while (map.length > norm.length) map.pop();
  return { norm, map, original };
}

function lcsTable(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let k = b.length - 1; k >= 0; k -= 1)
      rows[i][k] = a[i] === b[k] ? rows[i + 1][k + 1] + 1 : Math.max(rows[i + 1][k], rows[i][k + 1]);
  return rows;
}

// Character-level diff: which model characters the learner missed or changed.
// Returns segments over the MODEL answer: [{text, changed}]. Pure data, no HTML.
function charDiff(model, input) {
  const m = normalizeWithMap(model), n = normalizeWithMap(input);
  const table = lcsTable(m.norm, n.norm);
  const changedNorm = new Array(m.norm.length).fill(true);
  for (let i = 0, k = 0; i < m.norm.length && k < n.norm.length;) {
    if (m.norm[i] === n.norm[k]) { changedNorm[i] = false; i += 1; k += 1; }
    else if (table[i + 1][k] >= table[i][k + 1]) i += 1;
    else k += 1;
  }
  const changedOrig = new Array(m.original.length).fill(false);
  changedNorm.forEach((changed, i) => { if (changed && m.map[i] != null) changedOrig[m.map[i]] = true; });
  const segments = [];
  for (let i = 0; i < m.original.length;) {
    let k = i;
    while (k < m.original.length && changedOrig[k] === changedOrig[i]) k += 1;
    segments.push({ text: m.original.slice(i, k), changed: changedOrig[i] });
    i = k;
  }
  return segments;
}

// Word-level diff for reorder tasks: model words out of place are flagged.
function wordDiff(model, input) {
  const modelWords = model.split(/(\s+)/);
  const normModel = normalizeAnswer(model).split(' ').filter(Boolean);
  const normInput = normalizeAnswer(input).split(' ').filter(Boolean);
  const table = lcsTable(normModel, normInput);
  const changedWord = new Array(normModel.length).fill(true);
  for (let i = 0, k = 0; i < normModel.length && k < normInput.length;) {
    if (normModel[i] === normInput[k]) { changedWord[i] = false; i += 1; k += 1; }
    else if (table[i + 1][k] >= table[i][k + 1]) i += 1;
    else k += 1;
  }
  const segments = [];
  let wordIndex = -1;
  for (const token of modelWords) {
    if (!token.trim()) { segments.push({ text: token, changed: false }); continue; }
    wordIndex += 1;
    segments.push({ text: token, changed: Boolean(changedWord[wordIndex]) });
  }
  return segments;
}

// Correction segments for a non-passing answer, or null when no correction
// applies (correct answer, pass, or unknown type).
export function correctionDiff(challenge, input) {
  const raw = String(input ?? '').trim();
  if (!raw || !challenge || (challenge.type !== 'typed' && challenge.type !== 'jumble')) return null;
  if (normalizeAnswer(raw) === normalizeAnswer(challenge.answer)) return null;
  const accepted = (challenge.accepted || []).some((a) => normalizeAnswer(raw) === normalizeAnswer(a));
  if (accepted) return null;
  return challenge.type === 'jumble' ? wordDiff(challenge.answer, raw) : charDiff(challenge.answer, raw);
}

export function gradeAnswer(challenge,input) {
  const raw=String(input ?? '').trim();
  let grade='miss';
  if (!raw) grade='pass';
  else if (challenge.type==='jumble') {
    const normInput=normalizeAnswer(raw), normAnswer=normalizeAnswer(challenge.answer);
    if (normInput===normAnswer) grade='correct';
    else {
      const sameWords=normInput.split(' ').sort().join(' ')===normAnswer.split(' ').sort().join(' ');
      grade=sameWords?'partial':'miss';
    }
  }
  else {
    const normalized=normalizeAnswer(raw);
    if (challenge.accepted.some(answer=>normalizeAnswer(answer)===normalized)) grade='correct';
    else if ((challenge.partials||[]).some(answer=>normalizeAnswer(answer)===normalized)) grade='partial';
  }
  let feedback={correct:'Target pattern matched. Full gear range.',partial:'One target chunk matched. Read the full model, then keep racing.',miss:'Read the model, then keep racing. This bank checks the practised target pattern.',pass:'Coast this turn. Read the model and keep racing.'}[grade];
  if (challenge.type==='jumble'&&grade==='partial') feedback='Right words, wrong order. Study the highlighted order, then keep racing.';
  if (challenge.type==='jumble'&&grade==='miss') feedback='Not all words placed. Read the full order, then keep racing.';
  return {grade,answer:challenge.answer,feedback};
}

// ---- Imported sentence sets ----
// Teachers paste one pair per line: English sentence = French sentence.
// Each pair becomes one challenge; pairs deal round-robin across the gears.
const PAIR_LIMIT = 60;
const PAIR_MINIMUM = 6;

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle(items, seed) {
  const order = [...items];
  let state = seed >>> 0 || 1;
  const rand = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
  for (let i = order.length - 1; i > 0; i -= 1) {
    const k = Math.floor(rand() * (i + 1));
    [order[i], order[k]] = [order[k], order[i]];
  }
  return order;
}

function splitWords(sentence) {
  return String(sentence ?? '').split(/\s+/).filter(Boolean);
}

function stripEdgePunct(token) {
  return String(token ?? '').replace(/^[^\p{L}'’]+|[^\p{L}'’]+$/gu, '');
}

function lettersOnly(token) {
  return stripEdgePunct(token).replace(/['’]/g, '');
}

function pickBlankToken(tokens) {
  let best = 0, bestLen = -1;
  tokens.forEach((tok, i) => {
    const len = lettersOnly(tok).length;
    if (len >= 2 && len > bestLen) { best = i; bestLen = len; }
  });
  return best;
}

function pickTwoBlanks(tokens) {
  const ranked = tokens.map((tok, i) => ({ i, len: lettersOnly(tok).length }))
    .filter((entry) => entry.len >= 2).sort((a, b) => b.len - a.len).slice(0, 2).map((entry) => entry.i);
  if (ranked.length === 2) return ranked;
  if (tokens.length >= 2) return [0, tokens.length - 1];
  return [0];
}

function makePairChallenge(pair, index, gear) {
  const id = `imp-${hashSeed(`${index}|${pair.en}|${pair.fr}`).toString(36)}-g${gear}`;
  const hint = 'From your imported set.';
  if (gear === 1) return { id, gear, type: 'typed', prompt: `What does « ${pair.fr} » mean? Type it in English.`, answer: pair.en, accepted: [pair.en], partials: [], hint };
  if (gear === 5) return { id, gear, type: 'typed', prompt: `Write in French: ${pair.en}`, answer: pair.fr, accepted: [pair.fr], partials: [], hint };
  if (gear === 3 || gear === 6) {
    const tokens = splitWords(pair.fr);
    const blanks = gear === 3 ? [pickBlankToken(tokens)] : pickTwoBlanks(tokens);
    const gapPrompt = tokens.map((tok, i) => (blanks.includes(i) ? '___' : tok)).join(' ');
    const answer = gear === 3 ? stripEdgePunct(tokens[blanks[0]]) : pair.fr;
    return { id, gear, type: 'typed', prompt: `Fill the gap${blanks.length > 1 ? 's' : ''}: ${gapPrompt}`, answer, accepted: [answer], partials: [], hint };
  }
  const tokens = splitWords(pair.fr);
  let shown = tokens;
  for (let attempt = 0; attempt < 10 && normalizeAnswer(shown.join(' ')) === normalizeAnswer(pair.fr); attempt += 1)
    shown = seededShuffle(tokens, hashSeed(`${id}|${attempt}`));
  if (normalizeAnswer(shown.join(' ')) === normalizeAnswer(pair.fr)) shown = [...tokens].reverse();
  return { id, gear, type: 'jumble', prompt: `Put the words in order: ${pair.en}`, answer: pair.fr, tokens: shown, accepted: [pair.fr], partials: [], hint };
}

function buildPairSet(name, pairs) {
  const gears = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  pairs.forEach((pair, index) => {
    gears[(index % 6) + 1].push(makePairChallenge(pair, index, (index % 6) + 1));
  });
  return {
    id: `import-${Date.now().toString(36)}-${hashSeed(name + pairs.length).toString(36)}`,
    name, title: name,
    description: `${pairs.length} teacher-imported pairs. G1 English meanings, G2/G4 reorder, G3 cloze, G5 French sentences, G6 double gaps.`,
    gradingNote: 'Imported teacher set. Case, accents and punctuation do not affect the result.',
    phrases: pairs.map((p) => ({ fr: p.fr, en: p.en })),
    pairs: pairs.map((p) => ({ ...p })),
    gears,
  };
}

export function parsePairSet(text, name = '') {
  const errors = [];
  const pairs = [];
  String(text ?? '').split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const cut = trimmed.indexOf('=');
    if (cut < 0) { errors.push(`Line ${index + 1}: missing “=”. Write: English sentence = French sentence.`); return; }
    const en = trimmed.slice(0, cut).trim(), fr = trimmed.slice(cut + 1).trim();
    if (!en || !fr) { errors.push(`Line ${index + 1}: needs text on both sides of “=”.`); return; }
    pairs.push({ en, fr });
  });
  if (!errors.length && pairs.length < PAIR_MINIMUM) errors.push(`Only ${pairs.length} pair(s) found. Import at least ${PAIR_MINIMUM} lines.`);
  if (pairs.length > PAIR_LIMIT) errors.push(`Too many pairs (${pairs.length}). Import at most ${PAIR_LIMIT} lines.`);
  const cleanName = String(name ?? '').trim();
  if (!errors.length && !cleanName) errors.push('Give the set a name (for example “Pass 02 · Food”).');
  if (errors.length) return { ok: false, errors };
  return { ok: true, set: buildPairSet(cleanName, pairs) };
}

export function getSetChallenge(set, gear, serial = 0) {
  if (!set || typeof set !== 'object' || !set.gears || !Array.isArray(set.gears[gear]) || !set.gears[gear].length) throw new Error('Invalid set challenge gear');
  if (!Number.isInteger(serial) || serial < 0) throw new Error('Invalid challenge serial');
  return structuredClone(set.gears[gear][serial % set.gears[gear].length]);
}

// Deterministic per-race question order: same seed replays identically,
// different seeds (and cars, and gears) see different sequences.
export function shuffledOrder(length, seed) {
  if (!Number.isInteger(length) || length < 1) throw new Error('Invalid order length');
  const indexes = Array.from({ length }, (_, i) => i);
  return seededShuffle(indexes, typeof seed === 'number' ? seed : hashSeed(String(seed)));
}

export function gearChallengeCount(gear) {
  if (!Number.isInteger(gear) || !BANK[gear]) throw new Error('Invalid challenge gear');
  return BANK[gear].length;
}
