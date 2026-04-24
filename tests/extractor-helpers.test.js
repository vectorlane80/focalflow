'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./harness');

function loadExtractor() {
  return loadModule('src/content/extractor.js', 'FocalFlowExtractor');
}

test('exposes __testing namespace with pure helpers', () => {
  const extractor = loadExtractor();
  assert.equal(typeof extractor.__testing, 'object');
  assert.equal(typeof extractor.__testing.normalizeWhitespace, 'function');
  assert.equal(typeof extractor.__testing.normalizeBlock, 'function');
  assert.equal(typeof extractor.__testing.normalizeHeadingLevel, 'function');
  assert.equal(typeof extractor.__testing.isReadabilityResultWeak, 'function');
  assert.equal(typeof extractor.__testing.matchesFallbackClassOrId, 'function');
});

test('normalizeWhitespace collapses whitespace runs', () => {
  const { normalizeWhitespace } = loadExtractor().__testing;
  assert.equal(normalizeWhitespace('  hello   world  \n\tthere '), 'hello world there');
  assert.equal(normalizeWhitespace(''), '');
  assert.equal(normalizeWhitespace(null), '');
});

test('normalizeHeadingLevel clamps invalid levels to 2', () => {
  const { normalizeHeadingLevel } = loadExtractor().__testing;
  assert.equal(normalizeHeadingLevel(0), 2);
  assert.equal(normalizeHeadingLevel(NaN), 2);
  assert.equal(normalizeHeadingLevel('garbage'), 2);
  assert.equal(normalizeHeadingLevel(undefined), 2);
  assert.equal(normalizeHeadingLevel(1), 1);
  assert.equal(normalizeHeadingLevel(2), 2);
  assert.equal(normalizeHeadingLevel(5), 3);
});

test('normalizeBlock drops empty paragraphs', () => {
  const { normalizeBlock } = loadExtractor().__testing;
  assert.equal(normalizeBlock({ type: 'paragraph', text: '' }), null);
  assert.equal(normalizeBlock({ type: 'paragraph', text: '   \n  ' }), null);
});

test('normalizeBlock collapses whitespace in text blocks', () => {
  const { normalizeBlock } = loadExtractor().__testing;
  const result = normalizeBlock({ type: 'paragraph', text: 'a   b\n\nc' });
  assert.deepEqual(result, { type: 'paragraph', text: 'a b c' });
});

test('normalizeBlock drops lists with no usable items', () => {
  const { normalizeBlock } = loadExtractor().__testing;
  const result = normalizeBlock({
    type: 'list',
    ordered: false,
    items: [
      { text: '', children: [] },
      { text: '   ', children: [] }
    ]
  });
  assert.equal(result, null);
});

test('normalizeBlock keeps list items with children even if text is empty', () => {
  const { normalizeBlock } = loadExtractor().__testing;
  const result = normalizeBlock({
    type: 'list',
    ordered: false,
    items: [
      {
        text: '',
        children: [
          {
            type: 'list',
            ordered: false,
            items: [{ text: 'child', children: [] }]
          }
        ]
      },
      { text: 'visible', children: [] }
    ]
  });
  assert.equal(result.type, 'list');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].text, '');
  assert.equal(result.items[0].children.length, 1);
  assert.equal(result.items[1].text, 'visible');
});

test('normalizeBlock normalizes unknown heading level to 2', () => {
  const { normalizeBlock } = loadExtractor().__testing;
  const result = normalizeBlock({ type: 'heading', level: NaN, text: 'Hello' });
  assert.deepEqual(result, { type: 'heading', level: 2, text: 'Hello' });
});

test('isReadabilityResultWeak flags null, empty, and tiny articles', () => {
  const { isReadabilityResultWeak } = loadExtractor().__testing;
  assert.equal(isReadabilityResultWeak(null), true);
  assert.equal(isReadabilityResultWeak({}), true);
  assert.equal(isReadabilityResultWeak({ textContent: 'short', content: '<p>short</p>' }), true);

  const longText = 'word '.repeat(80).trim();
  assert.equal(
    isReadabilityResultWeak({ textContent: longText, content: `<p>${longText}</p>` }),
    false
  );
});

test('matchesFallbackClassOrId matches expected container hints', () => {
  const { matchesFallbackClassOrId } = loadExtractor().__testing;
  assert.equal(matchesFallbackClassOrId({ className: 'post-body', id: '' }), true);
  assert.equal(matchesFallbackClassOrId({ className: '', id: 'main-content' }), true);
  assert.equal(matchesFallbackClassOrId({ className: 'story-wrap', id: '' }), true);
  assert.equal(matchesFallbackClassOrId({ className: 'sidebar', id: 'nav' }), false);
  assert.equal(matchesFallbackClassOrId({ className: '', id: '' }), false);
});

test('countWords returns 0 on empty input', () => {
  const { countWords } = loadExtractor().__testing;
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords('one two three'), 3);
});

test('buildReadingStream produces aligned tokens and progress map', () => {
  const { buildReadingStream } = loadExtractor().__testing;
  const stream = buildReadingStream([
    { type: 'heading', level: 1, text: 'Title' },
    { type: 'paragraph', text: 'One two three.' }
  ]);
  assert.equal(stream.text, 'Title One two three.');
  assert.equal(stream.tokens.length, stream.progressMap.length);
  assert.equal(stream.wordCount, 4);
});

test.skip('extract() fallback path — requires DOMParser, Readability, and a live document; skipped without a DOM shim.', () => {});
