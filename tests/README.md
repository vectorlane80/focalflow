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
