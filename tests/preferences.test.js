'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./harness.js');

const shim = loadModule('src/shared/preferences.js', null, undefined);
const Prefs = shim.FocalFlowPreferences;

describe('sanitizeTheme', () => {
  it("accepts 'light'", () => {
    assert.equal(Prefs.sanitizeTheme('light'), 'light');
  });

  it("accepts 'dark'", () => {
    assert.equal(Prefs.sanitizeTheme('dark'), 'dark');
  });

  it('rejects unknown string, falls back to light', () => {
    assert.equal(Prefs.sanitizeTheme('sepia'), 'light');
  });

  it('rejects undefined, falls back to light', () => {
    assert.equal(Prefs.sanitizeTheme(undefined), 'light');
  });

  it('rejects null, falls back to light', () => {
    assert.equal(Prefs.sanitizeTheme(null), 'light');
  });

  it('rejects empty string, falls back to light', () => {
    assert.equal(Prefs.sanitizeTheme(''), 'light');
  });

  it('rejects non-string inputs (number, boolean, object, array), falls back to light', () => {
    assert.equal(Prefs.sanitizeTheme(0), 'light');
    assert.equal(Prefs.sanitizeTheme(1), 'light');
    assert.equal(Prefs.sanitizeTheme(true), 'light');
    assert.equal(Prefs.sanitizeTheme({}), 'light');
    assert.equal(Prefs.sanitizeTheme([]), 'light');
  });
});

describe('sanitize() theme field', () => {
  it('defaults theme to light when field is absent', () => {
    const result = Prefs.sanitize({});
    assert.equal(result.theme, 'light');
  });

  it('defaults theme to light for unknown input', () => {
    const result = Prefs.sanitize({ theme: 'solarized' });
    assert.equal(result.theme, 'light');
  });

  it('preserves dark theme through sanitize', () => {
    const result = Prefs.sanitize({ theme: 'dark' });
    assert.equal(result.theme, 'dark');
  });

  it('preserves light theme through sanitize', () => {
    const result = Prefs.sanitize({ theme: 'light' });
    assert.equal(result.theme, 'light');
  });

  it('sanitize with null input defaults theme to light', () => {
    const result = Prefs.sanitize(null);
    assert.equal(result.theme, 'light');
  });
});
