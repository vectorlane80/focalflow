(function registerPreferences(global) {
  if (global.FocalFlowPreferences) {
    return;
  }

  const STORAGE_KEY = 'focalflowPreferences';
  const POSITIONS_KEY = 'focalflowReadingPositions';
  const POSITIONS_CAP = 100;
  const BIONIC_MODES = ['on', 'off', 'remember'];
  const DEFAULTS = {
    wordsPerMinute: 250,
    bionicMode: 'off',
    bionicLastState: false,
    autoStartRsvp: false
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

  function sanitize(input) {
    const source = input && typeof input === 'object' ? input : {};

    return {
      wordsPerMinute: clampWordsPerMinute(source.wordsPerMinute),
      bionicMode: sanitizeBionicMode(source.bionicMode),
      bionicLastState: Boolean(source.bionicLastState),
      autoStartRsvp: Boolean(source.autoStartRsvp)
    };
  }

  async function get() {
    if (!chrome?.storage?.local) {
      return { ...DEFAULTS };
    }

    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return sanitize(stored[STORAGE_KEY]);
  }

  async function update(partial) {
    const nextPreferences = sanitize({
      ...(await get()),
      ...(partial && typeof partial === 'object' ? partial : {})
    });

    if (chrome?.storage?.local) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: nextPreferences
      });
    }

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
    if (!chrome?.storage?.local) {
      return {};
    }

    const stored = await chrome.storage.local.get(POSITIONS_KEY);
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
      await chrome.storage.local.set({ [POSITIONS_KEY]: trimmed });
      return;
    }

    await chrome.storage.local.set({ [POSITIONS_KEY]: all });
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
