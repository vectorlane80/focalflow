(function registerRsvpEngine(global) {
  if (global.FocalFlowRsvpEngine) {
    return;
  }

  const DEFAULT_WPM = 250;
  const MIN_WPM = 120;
  const MAX_WPM = 600;
  const EFFECTIVE_SPEED_MULTIPLIER = 0.95;
  const CLAUSE_PAUSE_MS = 75;
  const SENTENCE_PAUSE_MS = 145;
  const SENTENCE_BREAK_PAUSE_MS = 230;
  const TRAILING_PUNCTUATION_PATTERN = /^[,.;:!?…'"”’)\]\}]+$/;
  const DASH_TOKEN_PATTERN = /^[-–—]+$/;
  const SENTENCE_BREAK_ABBREVIATIONS = new Set([
    'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.',
    'rep.', 'sen.', 'gov.', 'gen.', 'col.', 'capt.', 'lt.',
    'st.', 'mt.', 'no.', 'fig.', 'dept.', 'est.', 'vs.',
    'u.s.', 'u.n.', 'e.g.', 'i.e.', 'etc.', 'a.m.', 'p.m.'
  ]);
  const TITLE_ABBREVIATION_PATTERN = /^(?:rep|reps|sen|sens|gov|govs|gen|gens|col|cols|capt|capts|lt|lts|prof|profs)\.$/i;

  function normalizeBoundaryToken(token) {
    return String(token || '')
      .trim()
      .toLowerCase()
      .replace(/^[("'[\]“”‘’]+|[)"'\]“”‘’]+$/g, '');
  }

  function tokenize(text) {
    return typeof text === 'string'
      ? text.split(/\s+/).map((token) => token.trim()).filter(Boolean)
      : [];
  }

  function mergeTokenFrames(tokens, progressMap) {
    const frames = [];

    tokens.forEach((token, index) => {
      const safeToken = String(token || '').trim();

      if (!safeToken) {
        return;
      }

      const progress = Number(progressMap[index]) || frames.length + 1;
      const previousFrame = frames[frames.length - 1];

      if (TRAILING_PUNCTUATION_PATTERN.test(safeToken) && previousFrame) {
        previousFrame.token += safeToken;
        return;
      }

      if (DASH_TOKEN_PATTERN.test(safeToken) && previousFrame) {
        previousFrame.token += ` ${safeToken}`;
        return;
      }

      frames.push({
        token: safeToken,
        progress
      });
    });

    return {
      tokens: frames.map((frame) => frame.token),
      progressMap: frames.map((frame) => frame.progress)
    };
  }

  function normalizeReadingStream(input) {
    if (input && typeof input === 'object' && Array.isArray(input.tokens)) {
      const sourceTokens = input.tokens.map((token) => String(token || '').trim()).filter(Boolean);
      const sourceProgressMap = Array.isArray(input.progressMap)
        ? input.progressMap.map((value) => Number(value) || 0).slice(0, sourceTokens.length)
        : [];
      const merged = mergeTokenFrames(
        sourceTokens,
        sourceProgressMap.length === sourceTokens.length
          ? sourceProgressMap
          : sourceTokens.map((_, index) => index + 1)
      );

      return {
        text: typeof input.text === 'string' ? input.text : merged.tokens.join(' '),
        tokens: merged.tokens,
        wordCount: Number(input.wordCount) || merged.tokens.length,
        progressMap: merged.progressMap
      };
    }

    const text = typeof input === 'string' ? input : '';
    const sourceTokens = tokenize(text);
    const merged = mergeTokenFrames(
      sourceTokens,
      sourceTokens.map((_, index) => index + 1)
    );

    return {
      text,
      tokens: merged.tokens,
      wordCount: merged.tokens.length,
      progressMap: merged.progressMap
    };
  }

  function clampWpm(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return DEFAULT_WPM;
    }

    return Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(numericValue)));
  }

  function getTokenLength(token) {
    const cleanToken = typeof token === 'string'
      ? token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
      : '';

    return cleanToken.length || (typeof token === 'string' ? token.length : 0);
  }

  function getLengthScale(token) {
    const tokenLength = getTokenLength(token);

    if (tokenLength <= 3) {
      return 0.9;
    }

    if (tokenLength >= 9) {
      return 1.12;
    }

    return 1;
  }

  function shouldSuppressSentenceBreak(token, nextToken) {
    const normalizedToken = normalizeBoundaryToken(token);
    const normalizedNextToken = String(nextToken || '').trim();

    if (!normalizedToken.endsWith('.')) {
      return false;
    }

    if (SENTENCE_BREAK_ABBREVIATIONS.has(normalizedToken)) {
      return true;
    }

    if (TITLE_ABBREVIATION_PATTERN.test(normalizedToken)) {
      return true;
    }

    if (/^(?:[a-z]\.){2,}$/i.test(normalizedToken)) {
      return true;
    }

    if (/^[a-z]\.$/i.test(normalizedToken) && /^[A-Z][a-z]/.test(normalizedNextToken)) {
      return true;
    }

    return false;
  }

  function isSentenceBreakToken(token, nextToken) {
    return /[.!?](?=["')\]“”’]*$|$)/.test(token) && !shouldSuppressSentenceBreak(token, nextToken);
  }

  function getPunctuationPause(token, nextToken) {
    if (isSentenceBreakToken(token, nextToken)) {
      return SENTENCE_PAUSE_MS + SENTENCE_BREAK_PAUSE_MS;
    }

    if (/[,:;](?=["')\]]*$|$)/.test(token)) {
      return CLAUSE_PAUSE_MS;
    }

    return 0;
  }

  function getDelayForToken(token, wpm, nextToken) {
    const baseDelay = (60000 / clampWpm(wpm)) * EFFECTIVE_SPEED_MULTIPLIER;
    const scaledDelay = baseDelay * getLengthScale(token);

    return Math.round(scaledDelay + getPunctuationPause(token, nextToken));
  }

  global.FocalFlowRsvpEngine = {
    isSentenceBreakToken,
    create(readingStream, options = {}) {
      const stream = normalizeReadingStream(readingStream);
      const tokens = stream.tokens;
      const progressMap = stream.progressMap.length === tokens.length
        ? stream.progressMap
        : tokens.map((_, index) => index + 1);
      const wordCount = stream.wordCount;
      const listeners = new Set();
      let currentIndex = 0;
      let timerId = null;
      let isPlaying = false;
      let wordsPerMinute = clampWpm(options.initialWordsPerMinute ?? DEFAULT_WPM);
      let frameDelays = tokens.map((token, index) => (
        getDelayForToken(token, wordsPerMinute, tokens[index + 1])
      ));

      function getState() {
        return {
          tokens,
          progressMap,
          wordCount,
          currentIndex,
          isPlaying,
          wordsPerMinute
        };
      }

      function notify() {
        const state = getState();
        listeners.forEach((listener) => {
          listener(state);
        });
      }

      function clearTimer() {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
      }

      function pause() {
        if (isPlaying) {
          clearTimer();
          isPlaying = false;
          notify();
        }
      }

      function scheduleNextStep() {
        if (!isPlaying || tokens.length === 0) {
          return;
        }

        const currentToken = tokens[currentIndex];
        const delay = frameDelays[currentIndex] ?? getDelayForToken(currentToken, wordsPerMinute, tokens[currentIndex + 1]);

        timerId = window.setTimeout(step, delay);
      }

      function step() {
        if (tokens.length === 0) {
          pause();
          return;
        }

        if (currentIndex >= tokens.length - 1) {
          pause();
          return;
        }

        currentIndex += 1;
        notify();
        scheduleNextStep();
      }

      function resume() {
        if (tokens.length === 0 || isPlaying) {
          return;
        }

        clearTimer();
        isPlaying = true;
        notify();
        scheduleNextStep();
      }

      function stepBy(offset) {
        if (!Number.isFinite(offset) || offset === 0 || tokens.length === 0) {
          return;
        }

        clearTimer();
        currentIndex = Math.min(tokens.length - 1, Math.max(0, currentIndex + Math.trunc(offset)));
        notify();

        if (isPlaying) {
          scheduleNextStep();
        }
      }

      return {
        subscribe(listener) {
          listeners.add(listener);
          listener(getState());

          return () => {
            listeners.delete(listener);
          };
        },
        start() {
          currentIndex = 0;
          resume();
        },
        pause,
        resume,
        restart() {
          pause();
          currentIndex = 0;
          notify();
        },
        stepBy,
        setSpeed(value) {
          wordsPerMinute = clampWpm(value);
          frameDelays = tokens.map((token, index) => (
            getDelayForToken(token, wordsPerMinute, tokens[index + 1])
          ));
          notify();

          if (isPlaying) {
            clearTimer();
            scheduleNextStep();
          }
        },
        destroy() {
          pause();
          listeners.clear();
        }
      };
    }
  };
})(window);
