(function registerRsvpEngine(global) {
  if (global.FocalFlowRsvpEngine) {
    return;
  }

  const DEFAULT_WPM = 250;
  const MIN_WPM = 120;
  const MAX_WPM = 600;
  const EFFECTIVE_SPEED_MULTIPLIER = 0.95;
  const CLAUSE_PAUSE_MS = 75;
  // Pauses scale with the current word duration so pacing feels consistent
  // across reading speeds — a fixed ms pause feels long at high WPM and short
  // at low WPM. Multipliers are applied to baseDelay (the per-word duration).
  const SENTENCE_PAUSE_MULT = 0.7;
  const PARAGRAPH_PAUSE_MULT = 1.4;
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

  // Strip emoji codepoints from a token. The single-char glyph fonts most
  // browsers fall back to when the page font lacks emoji coverage render as
  // tofu/question-mark squares during RSVP — and emoji-only tokens become
  // empty pause frames. Removing them at the engine layer keeps the
  // focused-reading view's block.text untouched (it still shows emojis).
  // Covers Extended_Pictographic plus the regional indicator pair used for
  // flags, the skin-tone modifiers, ZWJ, and the VS16 emoji presentation
  // selector that joins multi-codepoint sequences.
  const EMOJI_PATTERN = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u200D\uFE0F]/gu;

  function stripEmoji(token) {
    if (typeof token !== 'string' || !token) {
      return '';
    }
    return token.replace(EMOJI_PATTERN, '').trim();
  }

  function cleanEmojiFromTokens(tokens, progressMap) {
    const cleanTokens = [];
    const cleanProgress = [];
    const fallbackProgress = Array.isArray(progressMap) ? progressMap : [];
    tokens.forEach((token, index) => {
      const cleaned = stripEmoji(token);
      if (!cleaned) {
        return;
      }
      cleanTokens.push(cleaned);
      const progressValue = Number(fallbackProgress[index]);
      cleanProgress.push(Number.isFinite(progressValue) && progressValue > 0
        ? progressValue
        : cleanProgress.length + 1);
    });
    return { tokens: cleanTokens, progressMap: cleanProgress };
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
      const cleaned = cleanEmojiFromTokens(
        sourceTokens,
        sourceProgressMap.length === sourceTokens.length
          ? sourceProgressMap
          : sourceTokens.map((_, index) => index + 1)
      );
      const merged = mergeTokenFrames(cleaned.tokens, cleaned.progressMap);

      return {
        text: typeof input.text === 'string' ? input.text : merged.tokens.join(' '),
        tokens: merged.tokens,
        wordCount: Number(input.wordCount) || merged.tokens.length,
        progressMap: merged.progressMap
      };
    }

    const text = typeof input === 'string' ? input : '';
    const sourceTokens = tokenize(text);
    const cleaned = cleanEmojiFromTokens(
      sourceTokens,
      sourceTokens.map((_, index) => index + 1)
    );
    const merged = mergeTokenFrames(cleaned.tokens, cleaned.progressMap);

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

  function getPauseType(token, nextToken, nextWordPosition, paragraphBoundaryWords) {
    // Mirrors the branch order in getPunctuationPause so debug labels match
    // the pause actually applied.
    if (
      paragraphBoundaryWords
      && nextWordPosition != null
      && paragraphBoundaryWords.has(nextWordPosition)
    ) {
      return 'paragraph';
    }

    if (isSentenceBreakToken(token, nextToken)) {
      return 'sentence';
    }

    if (/[,:;](?=["')\]]*$|$)/.test(token)) {
      return 'clause';
    }

    return 'none';
  }

  // Gated by a localStorage flag so devs can flip RSVP debug logging on per
  // page without a rebuild: localStorage.setItem('focalflow.debug.rsvp', '1')
  function isDebugEnabled() {
    try {
      return typeof localStorage !== 'undefined'
        && localStorage.getItem('focalflow.debug.rsvp') === '1';
    } catch (_) {
      return false;
    }
  }

  function getPunctuationPause(token, nextToken, nextWordPosition, paragraphBoundaryWords, baseDelay) {
    // A paragraph/structural boundary OVERRIDES a sentence pause — we don't
    // want to add them together since that produces overly long gaps at the
    // end of headings/list items that already end in terminal punctuation.
    if (
      paragraphBoundaryWords
      && nextWordPosition != null
      && paragraphBoundaryWords.has(nextWordPosition)
    ) {
      return baseDelay * PARAGRAPH_PAUSE_MULT;
    }

    if (isSentenceBreakToken(token, nextToken)) {
      return baseDelay * SENTENCE_PAUSE_MULT;
    }

    if (/[,:;](?=["')\]]*$|$)/.test(token)) {
      return CLAUSE_PAUSE_MS;
    }

    return 0;
  }

  function getDelayForToken(token, wpm, nextToken, nextWordPosition, paragraphBoundaryWords) {
    const baseDelay = (60000 / clampWpm(wpm)) * EFFECTIVE_SPEED_MULTIPLIER;
    const scaledDelay = baseDelay * getLengthScale(token);

    return Math.round(
      scaledDelay + getPunctuationPause(token, nextToken, nextWordPosition, paragraphBoundaryWords, baseDelay)
    );
  }

  global.FocalFlowRsvpEngine = {
    isSentenceBreakToken,
    __testing: { getDelayForToken, getPunctuationPause, getPauseType, stripEmoji },
    create(readingStream, options = {}) {
      const stream = normalizeReadingStream(readingStream);
      const tokens = stream.tokens;
      const progressMap = stream.progressMap.length === tokens.length
        ? stream.progressMap
        : tokens.map((_, index) => index + 1);
      const wordCount = stream.wordCount;
      const paragraphBoundaryWords = new Set(
        Array.isArray(options.paragraphBoundaryWords) || options.paragraphBoundaryWords instanceof Set
          ? Array.from(options.paragraphBoundaryWords).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
          : []
      );
      const listeners = new Set();
      let currentIndex = 0;
      let timerId = null;
      let isPlaying = false;
      let wordsPerMinute = clampWpm(options.initialWordsPerMinute ?? DEFAULT_WPM);
      // Cache at create time so the per-tick check is a single bool read.
      const debug = isDebugEnabled();

      function computeFrameDelays() {
        return tokens.map((token, index) => (
          getDelayForToken(
            token,
            wordsPerMinute,
            tokens[index + 1],
            progressMap[index + 1],
            paragraphBoundaryWords
          )
        ));
      }

      let frameDelays = computeFrameDelays();

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
        const delay = frameDelays[currentIndex] ?? getDelayForToken(
          currentToken,
          wordsPerMinute,
          tokens[currentIndex + 1],
          progressMap[currentIndex + 1],
          paragraphBoundaryWords
        );

        if (debug) {
          console.debug('[FF/RSVP]', {
            wpm: wordsPerMinute,
            index: currentIndex,
            word: progressMap[currentIndex],
            token: currentToken,
            pauseType: getPauseType(
              currentToken,
              tokens[currentIndex + 1],
              progressMap[currentIndex + 1],
              paragraphBoundaryWords
            ),
            delayMs: delay
          });
        }

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
          frameDelays = computeFrameDelays();
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
