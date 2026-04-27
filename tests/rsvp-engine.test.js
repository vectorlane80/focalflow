'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./harness');

const engineNamespace = loadModule('src/content/rsvp-engine.js', 'FocalFlowRsvpEngine');

test('engine namespace exposes expected API', () => {
  assert.equal(typeof engineNamespace.create, 'function');
  assert.equal(typeof engineNamespace.isSentenceBreakToken, 'function');
});

test('create(...) returns controller with expected methods', () => {
  const controller = engineNamespace.create('hello world');
  ['start', 'pause', 'resume', 'stepBy', 'setSpeed', 'subscribe', 'destroy'].forEach((name) => {
    assert.equal(typeof controller[name], 'function', `missing ${name}`);
  });
  controller.destroy();
});

test('tokenization merges trailing punctuation into previous token', () => {
  // Drive tokenization via create(...) which runs normalizeReadingStream internally.
  const controller = engineNamespace.create({
    text: 'Hello , world .',
    tokens: ['Hello', ',', 'world', '.'],
    progressMap: [1, 2, 3, 4],
    wordCount: 2
  });

  let observed = null;
  const unsubscribe = controller.subscribe((state) => {
    observed = state;
  });

  assert.deepEqual(observed.tokens, ['Hello,', 'world.']);
  unsubscribe();
  controller.destroy();
});

test('simple sentence tokenizes into merged frames', () => {
  const controller = engineNamespace.create('The quick brown fox jumps.');
  let observed = null;
  controller.subscribe((state) => { observed = state; });
  // "jumps." stays as a single token since no whitespace splits it from "."
  assert.deepEqual(observed.tokens, ['The', 'quick', 'brown', 'fox', 'jumps.']);
  controller.destroy();
});

test('isSentenceBreakToken identifies sentence-ending punctuation', () => {
  const { isSentenceBreakToken } = engineNamespace;
  assert.equal(isSentenceBreakToken('end.'), true);
  assert.equal(isSentenceBreakToken('wow!'), true);
  assert.equal(isSentenceBreakToken('really?'), true);
});

test('isSentenceBreakToken suppresses known abbreviations', () => {
  const { isSentenceBreakToken } = engineNamespace;
  assert.equal(isSentenceBreakToken('Dr.', 'Smith'), false);
  assert.equal(isSentenceBreakToken('e.g.', 'this'), false);
  assert.equal(isSentenceBreakToken('U.S.', 'economy'), false);
  assert.equal(isSentenceBreakToken('a.', 'Dog'), false);
});

test('setSpeed clamps values to [120, 600]', () => {
  const controller = engineNamespace.create('one two three', { initialWordsPerMinute: 250 });
  let observed = null;
  controller.subscribe((state) => { observed = state; });

  controller.setSpeed(50);
  assert.equal(observed.wordsPerMinute, 120);

  controller.setSpeed(9999);
  assert.equal(observed.wordsPerMinute, 600);

  controller.setSpeed(300);
  assert.equal(observed.wordsPerMinute, 300);

  controller.setSpeed('not a number');
  // Non-finite falls back to default (250), which is within range.
  assert.equal(observed.wordsPerMinute, 250);

  controller.destroy();
});

test('__testing namespace exposes pause helpers', () => {
  assert.equal(typeof engineNamespace.__testing.getDelayForToken, 'function');
  assert.equal(typeof engineNamespace.__testing.getPunctuationPause, 'function');
  assert.equal(typeof engineNamespace.__testing.getPauseType, 'function');
});

test('getPauseType classifies pause kinds for debug logging', () => {
  const { getPauseType } = engineNamespace.__testing;
  const boundaries = new Set([2]);
  // paragraph boundary wins over sentence terminator
  assert.equal(getPauseType('hello.', 'World', 2, boundaries), 'paragraph');
  // sentence terminator with no boundary
  assert.equal(getPauseType('end.', 'Next', 2, new Set()), 'sentence');
  assert.equal(getPauseType('wow!', 'Next', 2, new Set()), 'sentence');
  assert.equal(getPauseType('really?', 'Next', 2, new Set()), 'sentence');
  // clause punctuation
  assert.equal(getPauseType('hello,', 'world', 2, new Set()), 'clause');
  assert.equal(getPauseType('hello;', 'world', 2, new Set()), 'clause');
  assert.equal(getPauseType('hello:', 'world', 2, new Set()), 'clause');
  // plain word
  assert.equal(getPauseType('hello', 'world', 2, new Set()), 'none');
});

// Pauses now scale with baseDelay (per-word ms). At 250 WPM:
//   baseDelay = 60000/250 * 0.95 = 228 ms
//   sentence (×0.7) ≈ 159.6 ms, paragraph (×1.4) ≈ 319.2 ms
const BASE_DELAY_AT_250 = (60000 / 250) * 0.95;
const SENTENCE_AT_250 = BASE_DELAY_AT_250 * 0.7;
const PARAGRAPH_AT_250 = BASE_DELAY_AT_250 * 1.4;

test('sentence-end token produces speed-relative sentence pause', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  assert.equal(
    getPunctuationPause('hello.', 'world', 2, new Set(), BASE_DELAY_AT_250),
    SENTENCE_AT_250
  );
});

test('paragraph boundary overrides sentence pause (does not add)', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  const boundaries = new Set([2]);
  assert.equal(
    getPunctuationPause('hello.', 'World', 2, boundaries, BASE_DELAY_AT_250),
    PARAGRAPH_AT_250
  );
});

test('paragraph boundary fires even without sentence terminator', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  const boundaries = new Set([2]);
  assert.equal(
    getPunctuationPause('Heading', 'Body', 2, boundaries, BASE_DELAY_AT_250),
    PARAGRAPH_AT_250
  );
});

test('mid-sentence comma still returns fixed clause pause', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  assert.equal(getPunctuationPause('hello,', 'world', 2, new Set(), BASE_DELAY_AT_250), 75);
});

test('non-punctuated token returns zero pause', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  assert.equal(getPunctuationPause('hello', 'world', 2, new Set(), BASE_DELAY_AT_250), 0);
});

test('final token (no next word position) skips paragraph check, sentence still fires', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  assert.equal(
    getPunctuationPause('end.', undefined, undefined, new Set(), BASE_DELAY_AT_250),
    SENTENCE_AT_250
  );
});

test('pauses scale with reading speed (faster WPM => shorter pauses)', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  const baseSlow = (60000 / 200) * 0.95;
  const baseFast = (60000 / 450) * 0.95;
  const slowSentence = getPunctuationPause('end.', 'Next', 2, new Set(), baseSlow);
  const fastSentence = getPunctuationPause('end.', 'Next', 2, new Set(), baseFast);
  assert.ok(slowSentence > fastSentence, 'slow WPM should produce longer sentence pause');
  assert.equal(slowSentence, baseSlow * 0.7);
  assert.equal(fastSentence, baseFast * 0.7);
});

test('getDelayForToken paragraph override adds proportional delta', () => {
  const { getDelayForToken } = engineNamespace.__testing;
  const boundaries = new Set([2]);
  const withBoundary = getDelayForToken('hello.', 250, 'World', 2, boundaries);
  const withoutBoundary = getDelayForToken('hello.', 250, 'World', 2, new Set());
  // Delta = (paragraph - sentence) * baseDelay = (1.4 - 0.7) * 228 ≈ 159.6, rounds to 159 or 160
  const expectedDelta = Math.round(BASE_DELAY_AT_250 * (1.4 - 0.7));
  assert.ok(Math.abs((withBoundary - withoutBoundary) - expectedDelta) <= 1);
});

test('stripEmoji removes pictographs, flags, skin tones, ZWJ, and VS16', () => {
  const { stripEmoji } = engineNamespace.__testing;
  // Mixed token: keep word characters, drop the emoji.
  assert.equal(stripEmoji('hello🎉'), 'hello');
  assert.equal(stripEmoji('🎉world'), 'world');
  // Emoji-only token reduces to empty.
  assert.equal(stripEmoji('🚀'), '');
  // Flag (regional indicator pair).
  assert.equal(stripEmoji('🇺🇸'), '');
  // ZWJ family sequence with skin tones.
  assert.equal(stripEmoji('👨🏽\u200D👩🏽\u200D👧🏽'), '');
  // Heart with VS16 emoji presentation selector.
  assert.equal(stripEmoji('❤\uFE0F'), '');
  // Plain text untouched.
  assert.equal(stripEmoji('high-profile'), 'high-profile');
  assert.equal(stripEmoji('hello,'), 'hello,');
});

test('emoji-only tokens are dropped from the playback stream', () => {
  const controller = engineNamespace.create({
    text: 'launch 🚀 today',
    tokens: ['launch', '🚀', 'today'],
    progressMap: [1, 1, 2],
    wordCount: 2
  });
  let observed = null;
  controller.subscribe((state) => { observed = state; });
  assert.deepEqual(observed.tokens, ['launch', 'today']);
  controller.destroy();
});

test('mixed emoji+text tokens keep their text content', () => {
  const controller = engineNamespace.create('party🎉 time');
  let observed = null;
  controller.subscribe((state) => { observed = state; });
  assert.deepEqual(observed.tokens, ['party', 'time']);
  controller.destroy();
});

test('stepBy moves currentIndex and clamps to stream bounds', () => {
  const controller = engineNamespace.create('alpha beta gamma delta');
  let observed = null;
  controller.subscribe((state) => { observed = state; });

  controller.stepBy(2);
  assert.equal(observed.currentIndex, 2);

  controller.stepBy(-10);
  assert.equal(observed.currentIndex, 0);

  controller.stepBy(100);
  assert.equal(observed.currentIndex, observed.tokens.length - 1);

  controller.destroy();
});
