(function registerPreferences(global) {
  if (global.FocalFlowPreferences) {
    return;
  }

  const STORAGE_KEY = 'focalflowPreferences';
  const DEFAULTS = {
    wordsPerMinute: 250
  };

  function clampWordsPerMinute(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return DEFAULTS.wordsPerMinute;
    }

    return Math.min(600, Math.max(120, Math.round(numericValue)));
  }

  function sanitize(input) {
    const source = input && typeof input === 'object' ? input : {};

    return {
      wordsPerMinute: clampWordsPerMinute(source.wordsPerMinute)
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

  global.FocalFlowPreferences = {
    defaults: { ...DEFAULTS },
    sanitize,
    get,
    update
  };
})(window);
