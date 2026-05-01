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

test('countWords ignores pure-punctuation tokens (regression: #23)', () => {
  // Must agree with progressMap, which only increments for tokens that
  // contain word content. Counting bare em-dashes/ellipses here makes
  // segment startWord drift past the engine's word numbering.
  const { countWords } = loadExtractor().__testing;
  assert.equal(countWords('hello — world'), 2);
  assert.equal(countWords('foo … bar'), 2);
  assert.equal(countWords('— — —'), 0);
});

test('buildReadingStream wordCount aligns with progressMap maximum', () => {
  const { buildReadingStream } = loadExtractor().__testing;
  const stream = buildReadingStream([
    { type: 'paragraph', text: 'hello — world' },
    { type: 'paragraph', text: 'foo bar' }
  ]);
  // 4 word-content tokens across both blocks; the bare em-dash doesn't count.
  assert.equal(stream.wordCount, 4);
  assert.equal(Math.max(...stream.progressMap), 4);
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

// Minimal DOM shim: just the surface collectBlocks/collectInlineText touch.
function el(tag, children = []) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: [],
    children: [],
    attributes: {},
    getAttribute(name) { return this.attributes[name] ?? null; },
    get textContent() {
      return this.childNodes.map((child) => (
        child.nodeType === 3 ? child.textContent : child.textContent
      )).join('');
    }
  };
  children.forEach((child) => {
    const childNode = typeof child === 'string'
      ? { nodeType: 3, textContent: child }
      : child;
    node.childNodes.push(childNode);
    if (childNode.nodeType === 1) {
      node.children.push(childNode);
    }
  });
  return node;
}

test('collectBlocks merges inline formatting into one paragraph (regression: #23)', () => {
  const { collectBlocks } = loadExtractor().__testing;
  // <p>Subscribers get 19 premium products <em>for free</em> for one year:
  //   <strong>Lovable</strong>, <a>Replit</a>, Gamma, n8n.</p>
  const paragraph = el('P', [
    'Subscribers get 19 premium products ',
    el('em', ['for free']),
    ' for one year: ',
    el('strong', ['Lovable']),
    ', ',
    el('a', ['Replit']),
    ', Gamma, n8n.'
  ]);
  const article = el('ARTICLE', [paragraph]);
  // Wrap in body so root === ownerDocument.body skip path doesn't apply.
  const body = el('BODY', [article]);
  body.ownerDocument = { body };
  // Children of article need ownerDocument too if collectBlocks recurses.
  article.ownerDocument = { body };
  paragraph.ownerDocument = { body };

  const blocks = [];
  collectBlocks(body, blocks);

  // Should yield exactly one paragraph — no duplicates from <em>/<strong>/<a>.
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(
    blocks[0].text,
    'Subscribers get 19 premium products for free for one year: Lovable, Replit, Gamma, n8n.'
  );
});

test('collectBlocks separates sibling block elements but keeps inline runs intact', () => {
  const { collectBlocks } = loadExtractor().__testing;
  const body = el('BODY', [
    el('H2', ['Heading']),
    el('P', [
      'Intro with ',
      el('em', ['emphasis']),
      ' continues here.'
    ]),
    el('P', ['Second paragraph.'])
  ]);
  body.ownerDocument = { body };

  const blocks = [];
  collectBlocks(body, blocks);

  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[0].text, 'Heading');
  assert.equal(blocks[1].type, 'paragraph');
  assert.equal(blocks[1].text, 'Intro with emphasis continues here.');
  assert.equal(blocks[2].type, 'paragraph');
  assert.equal(blocks[2].text, 'Second paragraph.');
});

test('cleanFootnotes drops PG-shape Notes section and strips inline [N] markers (regression: #24)', () => {
  const { cleanFootnotes } = loadExtractor().__testing;
  // Mirrors what Readability + collectBlocks produce for paulgraham.com:
  // body paragraphs with inline [1]/[2], a "Notes" heading-as-paragraph,
  // and per-note paragraphs starting with [N].
  const blocks = [
    { type: 'paragraph', text: 'Reading about x doesnt just teach you about x; it also teaches you how to write. [1]' },
    { type: 'paragraph', text: 'You have to be good at reading, and read good things. [2]' },
    { type: 'paragraph', text: 'Notes' },
    { type: 'paragraph', text: '[1] Audiobooks can give you examples of good writing.' },
    { type: 'paragraph', text: '[2] By "good at reading" I dont mean good at the mechanics of reading.' }
  ];

  const cleaned = cleanFootnotes(blocks);

  assert.equal(cleaned.length, 2);
  assert.equal(
    cleaned[0].text,
    'Reading about x doesnt just teach you about x; it also teaches you how to write.'
  );
  assert.equal(
    cleaned[1].text,
    'You have to be good at reading, and read good things.'
  );
});

test('cleanFootnotes leaves articles without a notes section unchanged in structure', () => {
  const { cleanFootnotes } = loadExtractor().__testing;
  const blocks = [
    { type: 'heading', level: 1, text: 'Title' },
    { type: 'paragraph', text: 'A normal first paragraph.' },
    { type: 'paragraph', text: 'A normal second paragraph.' }
  ];
  const cleaned = cleanFootnotes(blocks);
  assert.equal(cleaned.length, 3);
  assert.deepEqual(cleaned.map((b) => b.text), [
    'Title',
    'A normal first paragraph.',
    'A normal second paragraph.'
  ]);
});

test('cleanFootnotes does not fire on a body section happening to be titled "Notes"', () => {
  // Section heading "Notes" without any `[N]` pattern in the tail must
  // not trigger cutoff — protects articles that have a Notes-titled body
  // section (review notes, meeting notes, etc.).
  const { cleanFootnotes } = loadExtractor().__testing;
  const blocks = [
    { type: 'paragraph', text: 'Intro prose.' },
    { type: 'heading', level: 2, text: 'Notes' },
    { type: 'paragraph', text: 'These are general observations, not footnotes.' },
    { type: 'paragraph', text: 'More general observations.' }
  ];
  const cleaned = cleanFootnotes(blocks);
  assert.equal(cleaned.length, 4);
});

test('stripInlineMarkers removes [N] markers and tightens spacing', () => {
  const { stripInlineMarkers } = loadExtractor().__testing;
  assert.equal(
    stripInlineMarkers('teaches you how to write. [1]'),
    'teaches you how to write.'
  );
  assert.equal(
    stripInlineMarkers('a sentence [3] mid-stream and tail [42]'),
    'a sentence mid-stream and tail'
  );
  // In-word brackets (e.g., array indices) are NOT footnote markers.
  assert.equal(stripInlineMarkers('foo[1]bar'), 'foo[1]bar');
  // Backlink glyphs (return arrows) are stripped too.
  assert.equal(stripInlineMarkers('back to body ↩'), 'back to body');
});

test('stripInlineMarkers does not eat array indices or other in-word brackets', () => {
  // Bracket markers only count when not preceded by a word character.
  const { stripInlineMarkers } = loadExtractor().__testing;
  assert.equal(stripInlineMarkers('the value of arr[3] is five'), 'the value of arr[3] is five');
  assert.equal(stripInlineMarkers('items[0] and items[10]'), 'items[0] and items[10]');
  assert.equal(stripInlineMarkers('hash#tag[1]ref'), 'hash#tag[1]ref');
});

test('stripInlineMarkers strips consecutive markers like [1][2][3]', () => {
  // The lookbehind only blocks word-character prefixes, so a closing `]`
  // before the next `[` is fine — all three markers are removed.
  const { stripInlineMarkers } = loadExtractor().__testing;
  assert.equal(stripInlineMarkers('see [1][2][3] for details'), 'see for details');
  assert.equal(stripInlineMarkers('citations [1][2] follow'), 'citations follow');
});

test('cleanFootnotes preserves pre/code blocks verbatim', () => {
  const { cleanFootnotes } = loadExtractor().__testing;
  const blocks = [
    { type: 'paragraph', text: 'Body. [1]' },
    { type: 'pre', text: 'const x = arr[1] + arr[2];' },
    { type: 'paragraph', text: 'Notes' },
    { type: 'paragraph', text: '[1] note text' }
  ];
  const cleaned = cleanFootnotes(blocks);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].type, 'paragraph');
  assert.equal(cleaned[0].text, 'Body.');
  assert.equal(cleaned[1].type, 'pre');
  assert.equal(cleaned[1].text, 'const x = arr[1] + arr[2];');
});

test('cleanFootnotes detects Footnotes / Endnotes / References variants', () => {
  const { cleanFootnotes } = loadExtractor().__testing;
  ['Footnotes', 'Endnotes', 'References', 'Footnotes:', 'Notes.'].forEach((heading) => {
    const cleaned = cleanFootnotes([
      { type: 'paragraph', text: 'Body prose.' },
      { type: 'paragraph', text: heading },
      { type: 'paragraph', text: '[1] foo' }
    ]);
    assert.equal(cleaned.length, 1, `cutoff failed for "${heading}"`);
    assert.equal(cleaned[0].text, 'Body prose.');
  });
});

test('cleanFootnotes does not drop a final "Notes" heading with no notes after it', () => {
  // Reviewer caught: a legitimate final "Notes" section (e.g. recipe
  // chef’s notes) should not be cut just because it’s last.
  const { cleanFootnotes } = loadExtractor().__testing;
  const blocks = [
    { type: 'paragraph', text: 'Body prose.' },
    { type: 'paragraph', text: 'Notes' }
  ];
  const cleaned = cleanFootnotes(blocks);
  assert.equal(cleaned.length, 2);
});

test('cleanFootnotes preserves heading level after stripping', () => {
  const { cleanFootnotes } = loadExtractor().__testing;
  const blocks = [
    { type: 'heading', level: 1, text: 'Title [1]' },
    { type: 'paragraph', text: 'Body. [1]' },
    { type: 'paragraph', text: 'Notes' },
    { type: 'paragraph', text: '[1] foo' }
  ];
  const cleaned = cleanFootnotes(blocks);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].type, 'heading');
  assert.equal(cleaned[0].level, 1);
  assert.equal(cleaned[0].text, 'Title');
});

test('normalizeWhitespace tightens space before sentence/clause punctuation', () => {
  const { normalizeWhitespace } = loadExtractor().__testing;
  // Stray space before period/comma after inline fragment join.
  assert.equal(normalizeWhitespace('writing .'), 'writing.');
  assert.equal(normalizeWhitespace('foo ,  bar .'), 'foo, bar.');
  assert.equal(normalizeWhitespace('hello ; world :'), 'hello; world:');
});

test('collectBlocks treats inline wrappers with block descendants as transparent (regression: PG #24)', () => {
  // Mirrors paulgraham.com after Readability: a single <span> wraps the
  // entire essay's <p>s. Without transparent recursion, collectInlineText
  // skipped every <p> child and produced one giant inline-only block
  // containing only stray markers and Notes content.
  const { collectBlocks } = loadExtractor().__testing;
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(
    '<body><div><span>'
    + '<p>Body one.</p><p>Body two.</p>'
    + '<span>[<a href="#fn1">1</a>]</span>'
    + '<p>Body three.</p>'
    + '</span></div></body>'
  );
  const blocks = [];
  collectBlocks(dom.window.document.body, blocks);
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks.map((b) => b.text), [
    'Body one.',
    'Body two.',
    // normalizeWhitespace tightens space before `]`; the `[ 1` portion
    // stays whitespace-padded because no rule tightens after `[`.
    '[ 1]',
    'Body three.'
  ]);
});

test('stitchOrphanFragments merges short orphan fragments into the prior mid-sentence paragraph', () => {
  const { stitchOrphanFragments } = loadExtractor().__testing;
  // Mirrors Readability emitting `<p>...by </p><a>writing</a>.<p>Next...`
  const blocks = [
    { type: 'paragraph', text: 'There is a kind of thinking that can only be done by' },
    { type: 'paragraph', text: 'writing .' },
    { type: 'paragraph', text: 'There are of course kinds of thinking.' }
  ];
  const result = stitchOrphanFragments(blocks);
  assert.equal(result.length, 2);
  assert.equal(
    result[0].text,
    'There is a kind of thinking that can only be done by writing.'
  );
});

test('stitchOrphanFragments leaves short standalone paragraphs alone when prior block ends a sentence', () => {
  // "November 2022" followed by a real body paragraph: the date is short
  // but the prior block didn't end mid-sentence (no prior block at all),
  // so it must not be merged into the next.
  const { stitchOrphanFragments } = loadExtractor().__testing;
  const blocks = [
    { type: 'paragraph', text: 'November 2022' },
    { type: 'paragraph', text: 'In the science fiction books I read as a kid.' },
    { type: 'paragraph', text: 'A normal sentence.' }
  ];
  const result = stitchOrphanFragments(blocks);
  assert.equal(result.length, 3);
  assert.equal(result[0].text, 'November 2022');
});

test('stitchOrphanFragments does not merge when prior paragraph ends with a sentence terminator', () => {
  // Reviewer caught: the prior test passed because the second block was
  // long, not because of the terminator rule. Pin the actual rule.
  const { stitchOrphanFragments } = loadExtractor().__testing;
  const blocks = [
    { type: 'paragraph', text: 'A complete sentence.' },
    { type: 'paragraph', text: 'short.' },
    { type: 'paragraph', text: 'Another paragraph.' }
  ];
  const result = stitchOrphanFragments(blocks);
  assert.equal(result.length, 3);
  assert.equal(result[1].text, 'short.');
});

test('stitchOrphanFragments does not merge capitalized short paragraphs (bullet-style)', () => {
  // Pages that emit `<p>Apples</p><p>Oranges</p>` instead of <ul>: each
  // paragraph is short and lacks a terminator, but they are intentional
  // new paragraphs (start with a capital), not orphan continuations.
  const { stitchOrphanFragments } = loadExtractor().__testing;
  const blocks = [
    { type: 'paragraph', text: 'Apples' },
    { type: 'paragraph', text: 'Oranges' },
    { type: 'paragraph', text: 'Pears' }
  ];
  const result = stitchOrphanFragments(blocks);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((b) => b.text), ['Apples', 'Oranges', 'Pears']);
});

test('isLowConfidence flags null, empty, and below-threshold extractions (#25)', () => {
  const { isLowConfidence, LOW_CONFIDENCE_WORD_THRESHOLD } = loadExtractor().__testing;
  assert.equal(isLowConfidence(null), true);
  assert.equal(isLowConfidence(undefined), true);
  assert.equal(isLowConfidence({}), true);
  // Empty blocks → low confidence even if wordCount is high.
  assert.equal(
    isLowConfidence({ blocks: [], wordCount: 500, textContent: 'lots of text here' }),
    true
  );
  // Below threshold word count.
  assert.equal(
    isLowConfidence({
      blocks: [{ type: 'paragraph', text: 'short' }],
      wordCount: LOW_CONFIDENCE_WORD_THRESHOLD - 1,
      textContent: 'short'
    }),
    true
  );
  // Empty textContent.
  assert.equal(
    isLowConfidence({
      blocks: [{ type: 'paragraph', text: 'foo' }],
      wordCount: 500,
      textContent: '   '
    }),
    true
  );
});

test('isLowConfidence accepts plausible articles', () => {
  const { isLowConfidence } = loadExtractor().__testing;
  // 50 words of body text, several blocks, real textContent → confident.
  const text = 'word '.repeat(50).trim();
  assert.equal(
    isLowConfidence({
      blocks: [
        { type: 'heading', level: 1, text: 'Title' },
        { type: 'paragraph', text }
      ],
      wordCount: 50,
      textContent: text
    }),
    false
  );
});

test('isLowConfidence treats exactly-threshold word counts as confident', () => {
  // Pin the boundary so a future swap of `<` for `<=` is caught.
  const { isLowConfidence, LOW_CONFIDENCE_WORD_THRESHOLD } = loadExtractor().__testing;
  const text = 'word '.repeat(LOW_CONFIDENCE_WORD_THRESHOLD).trim();
  assert.equal(
    isLowConfidence({
      blocks: [{ type: 'paragraph', text }],
      wordCount: LOW_CONFIDENCE_WORD_THRESHOLD,
      textContent: text
    }),
    false
  );
});

test('estimatePageProseWordCount sums <p> words and skips non-article ancestors (#32)', () => {
  const { estimatePageProseWordCount } = loadExtractor().__testing;
  const { JSDOM } = require('jsdom');
  // Body has 5 words of real prose, 4 in nav, 6 in a comments aside,
  // 3 in a sidebar div. Estimator should return only the 5 real words.
  const dom = new JSDOM(`
    <body>
      <header><p>Site title and tagline goes here</p></header>
      <nav><p>Home About Contact</p></nav>
      <main>
        <article>
          <p>One two three four five</p>
        </article>
      </main>
      <aside class="comments"><p>Reader comment one two three four five six</p></aside>
      <div id="related-articles"><p>Related one two three</p></div>
      <footer><p>Footer copyright text</p></footer>
    </body>
  `);
  assert.equal(estimatePageProseWordCount(dom.window.document), 5);
});

test('isMateriallyIncomplete fires when extracted is much smaller than visible prose (#32)', () => {
  const { isMateriallyIncomplete, COMPLETENESS_MIN_PAGE_PROSE } = loadExtractor().__testing;
  const { JSDOM } = require('jsdom');
  // Build a body with COMPLETENESS_MIN_PAGE_PROSE * 2 words of real prose.
  const proseWords = 'word '.repeat(COMPLETENESS_MIN_PAGE_PROSE * 2).trim();
  const dom = new JSDOM(`<body><article><p>${proseWords}</p></article></body>`);
  // Pretend extractor only got 50 words (well below 0.5 ratio).
  const article = { wordCount: 50, blocks: [{ type: 'paragraph', text: 'foo' }], textContent: 'foo' };
  assert.equal(isMateriallyIncomplete(article, dom.window.document), true);
});

test('isMateriallyIncomplete does not fire when extracted is close to visible prose', () => {
  const { isMateriallyIncomplete, COMPLETENESS_MIN_PAGE_PROSE } = loadExtractor().__testing;
  const { JSDOM } = require('jsdom');
  const proseWords = 'word '.repeat(COMPLETENESS_MIN_PAGE_PROSE * 2).trim();
  const dom = new JSDOM(`<body><article><p>${proseWords}</p></article></body>`);
  // Extracted matches the full prose count.
  const article = { wordCount: COMPLETENESS_MIN_PAGE_PROSE * 2, blocks: [{ type: 'paragraph', text: 'foo' }], textContent: 'foo' };
  assert.equal(isMateriallyIncomplete(article, dom.window.document), false);
});

test('isMateriallyIncomplete returns false when there is not enough page-prose signal', () => {
  // If the page has very little prose, ratios are noisy — skip the check.
  const { isMateriallyIncomplete } = loadExtractor().__testing;
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<body><p>only ten words here ' + 'word '.repeat(5).trim() + '</p></body>');
  const article = { wordCount: 10, blocks: [{ type: 'paragraph', text: 'foo' }], textContent: 'foo' };
  assert.equal(isMateriallyIncomplete(article, dom.window.document), false);
});

test('isMateriallyIncomplete returns false on null inputs', () => {
  const { isMateriallyIncomplete } = loadExtractor().__testing;
  assert.equal(isMateriallyIncomplete(null, null), false);
  assert.equal(isMateriallyIncomplete(null, {}), false);
  assert.equal(isMateriallyIncomplete({}, null), false);
});

test('isMateriallyIncomplete does not trigger at exactly the ratio threshold', () => {
  // Pin the comparator: check is `<`, so extracted == 0.5 × estimated
  // must NOT flag. A future flip to `<=` would slip through.
  const { isMateriallyIncomplete, COMPLETENESS_RATIO_THRESHOLD, COMPLETENESS_MIN_PAGE_PROSE } = loadExtractor().__testing;
  const { JSDOM } = require('jsdom');
  const proseLen = COMPLETENESS_MIN_PAGE_PROSE * 2; // 400 words of estimable prose
  const dom = new JSDOM(`<body><article><p>${'word '.repeat(proseLen).trim()}</p></article></body>`);
  const article = {
    wordCount: Math.round(proseLen * COMPLETENESS_RATIO_THRESHOLD), // exactly 0.5
    blocks: [{ type: 'paragraph', text: 'foo' }],
    textContent: 'foo'
  };
  assert.equal(isMateriallyIncomplete(article, dom.window.document), false);
});

test('isMateriallyIncomplete applies the check at exactly the min-prose signal floor', () => {
  // Pin the comparator: check is `< MIN`, so estimated == MIN must
  // run the ratio check (not skip). Extracted is far below half so
  // the result here verifies the gate didn't no-op us into success.
  const { isMateriallyIncomplete, COMPLETENESS_MIN_PAGE_PROSE } = loadExtractor().__testing;
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(`<body><article><p>${'word '.repeat(COMPLETENESS_MIN_PAGE_PROSE).trim()}</p></article></body>`);
  const article = {
    wordCount: 10, // 10/200 = 0.05, well below 0.5
    blocks: [{ type: 'paragraph', text: 'foo' }],
    textContent: 'foo'
  };
  assert.equal(isMateriallyIncomplete(article, dom.window.document), true);
});

test('cleanFootnotes handles inline-form section (single block contains "Notes [1] ...")', () => {
  const { cleanFootnotes } = loadExtractor().__testing;
  const blocks = [
    { type: 'paragraph', text: 'Body prose with [1] a marker. Notes [1] First note. [2] Second note.' }
  ];
  const cleaned = cleanFootnotes(blocks);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].text, 'Body prose with a marker.');
});

test('collectBlocks recurses into unknown block-level wrappers without duplicating text', () => {
  const { collectBlocks } = loadExtractor().__testing;
  // <div><div><p>Hello <em>world</em>.</p></div></div>
  const inner = el('DIV', [el('P', ['Hello ', el('em', ['world']), '.'])]);
  const outer = el('DIV', [inner]);
  const body = el('BODY', [outer]);
  body.ownerDocument = { body };

  const blocks = [];
  collectBlocks(body, blocks);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'Hello world.');
});
