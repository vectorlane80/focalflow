(function registerRsvpPlayer(global) {
  if (global.FocalFlowRsvpPlayer) {
    return;
  }

  const DEFAULT_WPM = 250;
  const MIN_WPM = 120;
  const MAX_WPM = 600;
  const NAVIGATION_STEP = 5;

  function countWords(text) {
    const trimmed = String(text || '').trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  function hasWordContent(token) {
    return /[A-Za-z0-9]/.test(token);
  }

  function getFontScale(tokenLength) {
    if (tokenLength <= 18) {
      return 1;
    }

    if (tokenLength <= 24) {
      return 0.92;
    }

    if (tokenLength <= 30) {
      return 0.84;
    }

    return 0.76;
  }

  function getRecognitionIndex(token) {
    const cleanToken = typeof token === 'string' ? token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '') : '';
    const length = cleanToken.length || (typeof token === 'string' ? token.length : 0);

    if (length <= 1) {
      return 0;
    }

    if (length <= 5) {
      return 1;
    }

    if (length <= 9) {
      return 2;
    }

    return Math.min(4, Math.floor(length * 0.35));
  }

  function splitTokenForOrp(token) {
    const safeToken = typeof token === 'string' ? token : '';

    if (!safeToken) {
      return { prefix: '', orp: '', suffix: '' };
    }

    const leading = safeToken.match(/^[^A-Za-z0-9]+/)?.[0] || '';
    const trailing = safeToken.match(/[^A-Za-z0-9]+$/)?.[0] || '';
    const core = safeToken.slice(leading.length, safeToken.length - trailing.length);

    if (!core) {
      const punctuationIndex = Math.min(getRecognitionIndex(safeToken), Math.max(safeToken.length - 1, 0));

      return {
        prefix: safeToken.slice(0, punctuationIndex),
        orp: safeToken.charAt(punctuationIndex) || '',
        suffix: safeToken.slice(punctuationIndex + 1)
      };
    }

    const recognitionIndex = Math.min(getRecognitionIndex(core), Math.max(core.length - 1, 0));

    return {
      prefix: leading + core.slice(0, recognitionIndex),
      orp: core.charAt(recognitionIndex) || '',
      suffix: core.slice(recognitionIndex + 1) + trailing
    };
  }

  function buildContextSegments(blocks) {
    const segments = [];
    let wordCursor = 0;

    function pushSegment(text, variant = 'paragraph') {
      const safeText = String(text || '').trim();

      if (!safeText) {
        return;
      }

      const wordCount = countWords(safeText);

      if (wordCount === 0) {
        return;
      }

      segments.push({
        text: safeText,
        variant,
        startWord: wordCursor + 1,
        endWord: wordCursor + wordCount
      });
      wordCursor += wordCount;
    }

    function appendListSegments(listBlock) {
      if (!listBlock || !Array.isArray(listBlock.items)) {
        return;
      }

      listBlock.items.forEach((item) => {
        if (item?.text) {
          pushSegment(item.text, 'list-item');
        }

        if (Array.isArray(item?.children)) {
          item.children.forEach((childBlock) => {
            if (childBlock?.type === 'list') {
              appendListSegments(childBlock);
            }
          });
        }
      });
    }

    (Array.isArray(blocks) ? blocks : []).forEach((block) => {
      if (!block || typeof block !== 'object') {
        return;
      }

      if (block.type === 'list') {
        appendListSegments(block);
        return;
      }

      if (typeof block.text !== 'string' || !block.text.trim()) {
        return;
      }

      if (block.type === 'heading') {
        pushSegment(block.text, 'heading');
        return;
      }

      pushSegment(block.text, block.type === 'quote' ? 'quote' : 'paragraph');
    });

    return segments;
  }

  function getContextSegment(segments, currentWord) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return null;
    }

    const targetWord = Math.max(1, Number(currentWord) || 1);

    for (const segment of segments) {
      if (targetWord >= segment.startWord && targetWord <= segment.endWord) {
        return segment;
      }
    }

    return segments.find((segment) => targetWord <= segment.endWord) || segments[segments.length - 1];
  }

  function renderHighlightedContext(node, text, targetWordIndex) {
    const fragment = document.createDocumentFragment();
    const parts = String(text || '').split(/(\s+)/);
    let currentWordIndex = 0;

    parts.forEach((part) => {
      if (!part) {
        return;
      }

      if (/^\s+$/.test(part)) {
        fragment.appendChild(document.createTextNode(part));
        return;
      }

      if (!hasWordContent(part)) {
        fragment.appendChild(document.createTextNode(part));
        return;
      }

      currentWordIndex += 1;

      if (currentWordIndex === targetWordIndex) {
        const highlight = document.createElement('mark');
        highlight.className = 'ff-rsvp-context-current';
        highlight.textContent = part;
        fragment.appendChild(highlight);
        return;
      }

      fragment.appendChild(document.createTextNode(part));
    });

    node.replaceChildren(fragment);
  }

  global.FocalFlowRsvpPlayer = {
    create(readingStream, options = {}) {
      const contextSegments = buildContextSegments(options.blocks);
      const engine = global.FocalFlowRsvpEngine.create(readingStream, {
        initialWordsPerMinute: options.initialWordsPerMinute
      });
      let latestState = {
        tokens: [],
        currentIndex: 0,
        isPlaying: false,
        wordsPerMinute: DEFAULT_WPM
      };
      let contextVisible = false;
      let lastRenderedWord = 0;

      const root = document.createElement('section');
      root.className = 'ff-rsvp';

      const stage = document.createElement('div');
      stage.className = 'ff-rsvp-stage';
      root.appendChild(stage);

      const modeActions = document.createElement('div');
      modeActions.className = 'ff-rsvp-mode-actions';
      stage.appendChild(modeActions);

      const readerButton = document.createElement('button');
      readerButton.type = 'button';
      readerButton.className = 'ff-rsvp-button ff-rsvp-exit';
      readerButton.textContent = 'Focused Reading';
      modeActions.appendChild(readerButton);

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'ff-rsvp-button ff-rsvp-exit';
      closeButton.textContent = 'Close';
      modeActions.appendChild(closeButton);

      const viewport = document.createElement('div');
      viewport.className = 'ff-rsvp-viewport';
      stage.appendChild(viewport);

      const display = document.createElement('div');
      display.className = 'ff-rsvp-display';
      viewport.appendChild(display);

      const displayWord = document.createElement('div');
      displayWord.className = 'ff-rsvp-word';
      display.appendChild(displayWord);

      const displayPrefix = document.createElement('span');
      displayPrefix.className = 'ff-rsvp-token ff-rsvp-token-prefix';
      displayWord.appendChild(displayPrefix);

      const displayOrp = document.createElement('span');
      displayOrp.className = 'ff-rsvp-token ff-rsvp-token-orp';
      displayWord.appendChild(displayOrp);

      const displaySuffix = document.createElement('span');
      displaySuffix.className = 'ff-rsvp-token ff-rsvp-token-suffix';
      displayWord.appendChild(displaySuffix);

      const contextView = document.createElement('div');
      contextView.className = 'ff-rsvp-context';
      viewport.appendChild(contextView);

      const contextText = document.createElement('p');
      contextText.className = 'ff-rsvp-context-text';
      contextView.appendChild(contextText);

      const controls = document.createElement('div');
      controls.className = 'ff-rsvp-controls';
      stage.appendChild(controls);

      const modeMeta = document.createElement('p');
      modeMeta.className = 'ff-rsvp-mode-meta';
      modeMeta.textContent = 'RSVP Reading';

      const playbackGroup = document.createElement('div');
      playbackGroup.className = 'ff-rsvp-control-group';
      controls.appendChild(playbackGroup);

      const playbackGroupLabel = document.createElement('p');
      playbackGroupLabel.className = 'ff-rsvp-control-label';
      playbackGroupLabel.textContent = 'Playback';
      playbackGroup.appendChild(playbackGroupLabel);

      const playbackGroupBody = document.createElement('div');
      playbackGroupBody.className = 'ff-rsvp-control-row';
      playbackGroup.appendChild(playbackGroupBody);

      const playbackToggleButton = document.createElement('button');
      playbackToggleButton.type = 'button';
      playbackToggleButton.className = 'ff-rsvp-button';
      playbackToggleButton.textContent = 'Play';
      playbackGroupBody.appendChild(playbackToggleButton);

      const restartButton = document.createElement('button');
      restartButton.type = 'button';
      restartButton.className = 'ff-rsvp-button';
      restartButton.textContent = 'Restart';
      playbackGroupBody.appendChild(restartButton);

      const navigationGroup = document.createElement('div');
      navigationGroup.className = 'ff-rsvp-control-group';
      controls.appendChild(navigationGroup);

      const navigationGroupLabel = document.createElement('p');
      navigationGroupLabel.className = 'ff-rsvp-control-label';
      navigationGroupLabel.textContent = 'Navigation';
      navigationGroup.appendChild(navigationGroupLabel);

      const navigationGroupBody = document.createElement('div');
      navigationGroupBody.className = 'ff-rsvp-control-row';
      navigationGroup.appendChild(navigationGroupBody);

      const backButton = document.createElement('button');
      backButton.type = 'button';
      backButton.className = 'ff-rsvp-button';
      backButton.textContent = 'Back';
      navigationGroupBody.appendChild(backButton);

      const forwardButton = document.createElement('button');
      forwardButton.type = 'button';
      forwardButton.className = 'ff-rsvp-button';
      forwardButton.textContent = 'Forward';
      navigationGroupBody.appendChild(forwardButton);

      const speedGroupPanel = document.createElement('div');
      speedGroupPanel.className = 'ff-rsvp-control-group';
      controls.appendChild(speedGroupPanel);

      const speedGroupLabel = document.createElement('p');
      speedGroupLabel.className = 'ff-rsvp-control-label';
      speedGroupLabel.textContent = 'Speed';
      speedGroupPanel.appendChild(speedGroupLabel);

      const speedGroupRow = document.createElement('div');
      speedGroupRow.className = 'ff-rsvp-control-row';
      speedGroupPanel.appendChild(speedGroupRow);

      const speedGroup = document.createElement('div');
      speedGroup.className = 'ff-rsvp-speed-group';
      speedGroupRow.appendChild(speedGroup);

      const speedLabel = document.createElement('label');
      speedLabel.className = 'ff-rsvp-speed';
      speedLabel.textContent = 'WPM';
      speedGroup.appendChild(speedLabel);

      const speedInput = document.createElement('input');
      speedInput.type = 'number';
      speedInput.className = 'ff-rsvp-speed-input';
      speedInput.min = String(MIN_WPM);
      speedInput.max = String(MAX_WPM);
      speedInput.step = '10';
      speedInput.value = String(DEFAULT_WPM);
      speedLabel.appendChild(speedInput);

      const speedSlider = document.createElement('input');
      speedSlider.type = 'range';
      speedSlider.className = 'ff-rsvp-speed-slider';
      speedSlider.min = String(MIN_WPM);
      speedSlider.max = String(MAX_WPM);
      speedSlider.step = '10';
      speedSlider.value = String(DEFAULT_WPM);
      speedGroup.appendChild(speedSlider);

      const meta = document.createElement('div');
      meta.className = 'ff-rsvp-meta';
      stage.appendChild(meta);
      const status = document.createElement('p');
      status.className = 'ff-rsvp-status';
      meta.appendChild(status);
      meta.appendChild(modeMeta);
      let alignmentFrameId = null;

      function queueAlignment() {
        if (alignmentFrameId !== null) {
          cancelAnimationFrame(alignmentFrameId);
        }

        displayWord.style.visibility = 'hidden';

        alignmentFrameId = requestAnimationFrame(() => {
          alignmentFrameId = null;

          const wordWidth = Math.round(displayWord.getBoundingClientRect().width);
          const prefixWidth = Math.round(displayPrefix.getBoundingClientRect().width);
          const orpWidth = Math.round(displayOrp.getBoundingClientRect().width);
          const anchorOffset = (wordWidth / 2) - (prefixWidth + (orpWidth / 2));

          displayWord.style.transform = `translateX(${Math.round(anchorOffset)}px)`;
          displayWord.style.visibility = 'visible';
        });
      }

      function syncContextState() {
        root.dataset.contextVisible = contextVisible ? 'true' : 'false';
      }

      function render(state) {
        latestState = state;
        root.classList.toggle('ff-rsvp-playing', state.isPlaying);
        modeActions.dataset.playing = state.isPlaying ? 'true' : 'false';
        controls.dataset.playing = state.isPlaying ? 'true' : 'false';
        const displayToken = typeof state.tokens?.[state.currentIndex] === 'string'
          ? state.tokens[state.currentIndex]
          : '';
        const parts = splitTokenForOrp(displayToken);
        const tokenLength = displayToken.length;
        display.style.setProperty('--ff-rsvp-font-scale', String(getFontScale(tokenLength)));
        displayPrefix.textContent = parts.prefix;
        displayOrp.textContent = parts.orp || '•';
        displaySuffix.textContent = parts.suffix;
        queueAlignment();
        const totalWords = Number.isFinite(options.wordCount)
          ? options.wordCount
          : (Number.isFinite(state.wordCount) ? state.wordCount : state.tokens.length);
        const currentWord = Array.isArray(state.progressMap)
          ? Math.max(1, Math.min(totalWords, Number(state.progressMap[state.currentIndex]) || 1))
          : Math.min(state.currentIndex + 1, totalWords);

        lastRenderedWord = currentWord;
        const activeContextSegment = getContextSegment(contextSegments, currentWord);
        const localWordIndex = activeContextSegment
          ? currentWord - activeContextSegment.startWord + 1
          : 1;

        if (activeContextSegment) {
          contextView.dataset.variant = activeContextSegment.variant;
          renderHighlightedContext(contextText, activeContextSegment.text, localWordIndex);
        } else {
          contextView.dataset.variant = 'paragraph';
          contextText.textContent = '';
        }

        status.textContent = state.tokens.length > 0
          ? `Word ${currentWord} of ${totalWords} at ${state.wordsPerMinute} WPM`
          : 'No tokens available for playback';
        speedInput.value = String(state.wordsPerMinute);
        speedSlider.value = String(state.wordsPerMinute);
        playbackToggleButton.textContent = state.isPlaying ? 'Pause' : 'Play';
        playbackToggleButton.disabled = state.tokens.length === 0;
        backButton.disabled = state.tokens.length === 0 || state.currentIndex === 0;
        restartButton.disabled = state.tokens.length === 0;
        forwardButton.disabled = state.tokens.length === 0 || state.currentIndex >= state.tokens.length - 1;
        syncContextState();
      }

      const unsubscribe = engine.subscribe(render);

      function handleSpeedChange(value) {
        engine.setSpeed(value);
        options.onSpeedChange?.(value);
      }

      playbackToggleButton.addEventListener('click', () => {
        if (latestState.isPlaying) {
          contextVisible = true;
          engine.pause();
          return;
        }

        contextVisible = false;

        if (latestState.currentIndex >= latestState.tokens.length - 1) {
          engine.start();
          return;
        }

        engine.resume();
      });
      restartButton.addEventListener('click', () => {
        contextVisible = false;
        engine.restart();
      });
      backButton.addEventListener('click', () => {
        engine.stepBy(-NAVIGATION_STEP);
      });
      forwardButton.addEventListener('click', () => {
        engine.stepBy(NAVIGATION_STEP);
      });
      readerButton.addEventListener('click', () => {
        options.onExit?.();
      });
      closeButton.addEventListener('click', () => {
        options.onClose?.();
      });
      speedInput.addEventListener('change', () => {
        handleSpeedChange(speedInput.value);
      });
      speedSlider.addEventListener('input', () => {
        handleSpeedChange(speedSlider.value);
      });

      return {
        root,
        setActive(isActive) {
          root.hidden = !isActive;
        },
        destroy() {
          if (alignmentFrameId !== null) {
            cancelAnimationFrame(alignmentFrameId);
          }
          unsubscribe();
          engine.destroy();
          root.remove();
        }
      };
    }
  };
})(window);
