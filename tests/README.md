# FocalFlow tests

Run the suite with:

```
npm test
```

The harness is pure Node (18+) and uses the built-in `node:test` runner
plus `node:assert`. No browser, no bundler, no extra dependencies.

Source files are browser-style IIFEs that register onto `window`. The
loader in `tests/harness.js` evaluates each module against a tiny
`window` shim and returns the registered global.

DOM-dependent paths (notably `FocalFlowExtractor.extract`, which needs
`DOMParser`, `Readability`, and a live document) are marked with
`test.skip` with a reason — they are only exercised in the browser.

## Browser fixture

For manual validation of extraction and RSVP behavior in Chrome without
depending on live websites, load the static fixture:

```
file:///<repo>/tests/fixtures/test-page.html
```

Open it in Chrome, then trigger the FocalFlow popup. The page exercises
structural variety (headings, paragraphs, lists, blockquote, code),
abbreviation handling (`Dr.`, `e.g.`, `U.S.`, `a.m.`, etc.), paragraph
boundaries, and mixed punctuation. Expected word counts — overall and
per-section — are documented in an HTML comment at the bottom of the
fixture so extraction output can be validated deterministically.
