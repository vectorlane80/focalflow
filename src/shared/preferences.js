(function registerPreferences(global) {
  if (global.FocalFlowPreferences) {
    return;
  }

  const STORAGE_KEY = 'focalflowPreferences';
  const POSITIONS_KEY = 'focalflowReadingPositions';
  const POSITIONS_CAP = 100;
  const BIONIC_MODES = ['on', 'off', 'remember'];
  const RSVP_RESUME_MODES = ['resume', 'restart'];
  const DEFAULTS = {
    wordsPerMinute: 250,
    bionicMode: 'off',
    bionicLastState: false,
    autoStartRsvp: false,
    rsvpResumeMode: 'resume'
  };

  function clampWordsPerMinute(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return DEFAULTS.wordsPerMinute;
    }

    return Math.min(600, Math.max(120, Math.round(numericValue)));
  }

  function sanitizeBionicMode(value) {
    return BIONIC_MODES.includes(value) ? value : DEFAULTS.bionicMode;
  }

  function sanitizeRsvpResumeMode(value) {
    return RSVP_RESUME_MODES.includes(value) ? value : DEFAULTS.rsvpResumeMode;
  }

  function sanitize(input) {
    const source = input && typeof input === 'object' ? input : {};

    return {
      wordsPerMinute: clampWordsPerMinute(source.wordsPerMinute),
      bionicMode: sanitizeBionicMode(source.bionicMode),
      bionicLastState: Boolean(source.bionicLastState),
      autoStartRsvp: Boolean(source.autoStartRsvp),
      rsvpResumeMode: sanitizeRsvpResumeMode(source.rsvpResumeMode)
    };
  }

  // chrome.storage calls reject with "Extension context invalidated" when the
  // extension is reloaded while a content script is still running on a page.
  // Swallow those errors so orphaned scripts degrade silently instead of
  // surfacing uncaught promise rejections.
  function isContextInvalidated(error) {
    const message = error && error.message ? String(error.message) : '';
    return message.includes('Extension context invalidated')
      || message.includes('Extension context was invalidated');
  }

  async function safeStorageGet(key) {
    if (!chrome?.storage?.local) {
      return {};
    }
    try {
      return await chrome.storage.local.get(key);
    } catch (error) {
      if (isContextInvalidated(error)) {
        return {};
      }
      throw error;
    }
  }

  async function safeStorageSet(payload) {
    if (!chrome?.storage?.local) {
      return;
    }
    try {
      await chrome.storage.local.set(payload);
    } catch (error) {
      if (isContextInvalidated(error)) {
        return;
      }
      throw error;
    }
  }

  async function get() {
    const stored = await safeStorageGet(STORAGE_KEY);
    return sanitize(stored[STORAGE_KEY]);
  }

  async function update(partial) {
    const nextPreferences = sanitize({
      ...(await get()),
      ...(partial && typeof partial === 'object' ? partial : {})
    });

    await safeStorageSet({ [STORAGE_KEY]: nextPreferences });

    return nextPreferences;
  }

  function normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    } catch (error) {
      return String(url || '');
    }
  }

  async function getAllPositions() {
    const stored = await safeStorageGet(POSITIONS_KEY);
    const value = stored[POSITIONS_KEY];
    return value && typeof value === 'object' ? value : {};
  }

  async function getPosition(url) {
    const key = normalizeUrl(url);

    if (!key) {
      return null;
    }

    const all = await getAllPositions();
    const entry = all[key];

    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const wordIndex = Number(entry.wordIndex);

    if (!Number.isFinite(wordIndex) || wordIndex < 0) {
      return null;
    }

    return {
      wordIndex: Math.floor(wordIndex),
      updatedAt: Number(entry.updatedAt) || 0
    };
  }

  async function setPosition(url, wordIndex) {
    const key = normalizeUrl(url);

    if (!key || !chrome?.storage?.local) {
      return;
    }

    const numericIndex = Number(wordIndex);

    if (!Number.isFinite(numericIndex) || numericIndex < 0) {
      return;
    }

    const all = await getAllPositions();
    all[key] = {
      wordIndex: Math.floor(numericIndex),
      updatedAt: Date.now()
    };

    // Evict oldest entries if we exceed the cap.
    const entries = Object.entries(all);
    if (entries.length > POSITIONS_CAP) {
      entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
      const trimmed = {};
      for (let i = 0; i < POSITIONS_CAP; i += 1) {
        trimmed[entries[i][0]] = entries[i][1];
      }
      await safeStorageSet({ [POSITIONS_KEY]: trimmed });
      return;
    }

    await safeStorageSet({ [POSITIONS_KEY]: all });
  }

  global.FocalFlowPreferences = {
    defaults: { ...DEFAULTS },
    sanitize,
    get,
    update,
    normalizeUrl,
    getPosition,
    setPosition
  };
})(window);
