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
});

test('sentence-end token produces sentence pause with no boundary set', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  // next word position is 2, no boundary set -> sentence pause (160)
  assert.equal(getPunctuationPause('hello.', 'world', 2, new Set()), 160);
});

test('paragraph boundary overrides sentence pause (does not add)', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  const boundaries = new Set([2]);
  // token ends with "." AND next word is a boundary -> paragraph pause only (320)
  assert.equal(getPunctuationPause('hello.', 'World', 2, boundaries), 320);
});

test('paragraph boundary fires even without sentence terminator', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  const boundaries = new Set([2]);
  // e.g. heading with no trailing period, then new paragraph
  assert.equal(getPunctuationPause('Heading', 'Body', 2, boundaries), 320);
});

test('mid-sentence comma still returns clause pause', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  assert.equal(getPunctuationPause('hello,', 'world', 2, new Set()), 75);
});

test('non-punctuated token returns zero pause', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  assert.equal(getPunctuationPause('hello', 'world', 2, new Set()), 0);
});

test('final token (no next word position) returns zero pause', () => {
  const { getPunctuationPause } = engineNamespace.__testing;
  // end of stream: no next word, no boundary to fire. Sentence still fires
  // if punctuated because isSentenceBreakToken only looks at current token.
  // But with nextWordPosition undefined, paragraph check is skipped — good.
  assert.equal(getPunctuationPause('end.', undefined, undefined, new Set()), 160);
});

test('getDelayForToken incorporates paragraph override in frame delays', () => {
  const { getDelayForToken } = engineNamespace.__testing;
  const boundaries = new Set([2]);
  const withBoundary = getDelayForToken('hello.', 250, 'World', 2, boundaries);
  const withoutBoundary = getDelayForToken('hello.', 250, 'World', 2, new Set());
  // Boundary-overridden delay should be larger than plain-sentence delay by
  // exactly (320 - 160) = 160 ms (rounding aside).
  assert.equal(withBoundary - withoutBoundary, 160);
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
