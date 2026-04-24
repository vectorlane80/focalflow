'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./harness');

// The extractor module is a browser IIFE that registers FocalFlowExtractor
// on window. The only public method is `extract(document)`, which requires
// a full DOM (Readability + DOMParser + Node constants + document tree).
// Its internal helpers (normalizeBlock, buildReadingStream, etc.) are not
// exposed on the global, so they are unreachable from pure Node without
// modifying the source, which is explicitly out of scope for this harness.

test('extractor module registers FocalFlowExtractor on the window shim', () => {
  const extractor = loadModule('src/content/extractor.js', 'FocalFlowExtractor');
  assert.equal(typeof extractor, 'object');
  assert.equal(typeof extractor.extract, 'function');
});

test.skip('extractor.extract() — requires DOMParser, Readability, Node constants, and a live document; not runnable in pure Node without a DOM shim like jsdom. Intentionally skipped to keep the harness dependency-free.', () => {});

test.skip('internal block normalization helpers — not exported on the FocalFlowExtractor namespace, so they cannot be invoked from tests without modifying the source module. Intentionally skipped.', () => {});
