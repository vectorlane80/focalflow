(function registerReaderShell(global) {
  if (global.FocalFlowReaderShell) {
    return;
  }

  const ROOT_ID = 'focalflow-reader-root';
  const STYLE_ID = 'focalflow-reader-style';
  let previousOverflow = '';
  let isOpen = false;
  let activeRsvpPlayer = null;
  let previousUrl = '';
  let routeListenersAttached = false;
  let currentMode = 'reader';

  const originalHistoryMethods = {
    pushState: history.pushState,
    replaceState: history.replaceState
  };

  function getDefaultPreferences() {
    return global.FocalFlowPreferences?.defaults || {
      wordsPerMinute: 250
    };
  }

  function sanitizePreferences(preferences) {
    if (global.FocalFlowPreferences?.sanitize) {
      return global.FocalFlowPreferences.sanitize(preferences);
    }

    return {
      ...getDefaultPreferences(),
      ...(preferences && typeof preferences === 'object' ? preferences : {})
    };
  }

  function ensureStyleTag() {
    let style = document.getElementById(STYLE_ID);

    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }

    style.textContent = `
      #${ROOT_ID} {
        --ff-bg: #f4f1ea;
        --ff-bg-alt: #eeebe4;
        --ff-surface: rgba(255, 253, 249, 0.76);
        --ff-surface-rsvp: rgba(255, 249, 242, 0.05);
        --ff-text: #262a2f;
        --ff-text-soft: #6d747d;
        --ff-accent: #2f7a78;
        --ff-accent-deep: #246766;
        --ff-orp: #b15c38;
        --ff-border: rgba(47, 122, 120, 0.12);
        --ff-radius: 18px;
        --ff-radius-pill: 999px;
        --ff-transition: 170ms ease;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        overflow-y: auto;
        background:
          radial-gradient(circle at top, rgba(47, 122, 120, 0.08), transparent 34%),
          linear-gradient(180deg, var(--ff-bg) 0%, #ece7df 100%);
        color: var(--ff-text);
      }
      #${ROOT_ID} * {
        box-sizing: border-box;
      }
      #${ROOT_ID} .ff-shell {
        width: min(880px, calc(100% - 32px));
        margin: 0 auto;
        padding: 40px 0 56px;
        font-family: Charter, "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif;
      }
      #${ROOT_ID} .ff-bar {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 18px;
        margin-bottom: 28px;
      }
      #${ROOT_ID} .ff-heading-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #${ROOT_ID} .ff-control-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 15px 18px;
        border-radius: var(--ff-radius);
        background: var(--ff-surface);
        box-shadow: inset 0 0 0 1px var(--ff-border);
      }
      #${ROOT_ID} .ff-bar-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
      }
      #${ROOT_ID}.ff-rsvp-active .ff-bar,
      #${ROOT_ID}.ff-rsvp-active article {
        display: none;
      }
      #${ROOT_ID}.ff-rsvp-active {
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(72, 57, 45, 0.12), transparent 32%),
          linear-gradient(180deg, #11100f 0%, #0b0a09 100%);
      }
      #${ROOT_ID} .ff-kicker {
        margin: 0 0 6px;
        font: 700 12px/1.3 Charter, "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ff-accent);
      }
      #${ROOT_ID} .ff-title {
        margin: 0;
        font-family: Charter, "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif;
        font-size: clamp(24px, 3.2vw, 36px);
        line-height: 1.14;
        letter-spacing: -0.01em;
      }
      #${ROOT_ID} .ff-meta {
        margin: 12px 0 0;
        font: 14px/1.7 Charter, "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif;
        color: var(--ff-text-soft);
      }
      #${ROOT_ID} .ff-close {
        flex: none;
        border: 0;
        border-radius: var(--ff-radius-pill);
        padding: 10px 14px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        background: linear-gradient(135deg, var(--ff-accent) 0%, var(--ff-accent-deep) 100%);
        color: #fbf7f0;
        cursor: pointer;
        transition: transform var(--ff-transition), opacity var(--ff-transition), box-shadow var(--ff-transition), background var(--ff-transition);
        box-shadow: 0 10px 20px rgba(36, 103, 102, 0.14);
      }
      #${ROOT_ID} .ff-close:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 24px rgba(36, 103, 102, 0.18);
      }
      #${ROOT_ID} .ff-close[data-active="true"] {
        background: linear-gradient(135deg, #469292 0%, #2f7a78 100%);
      }
      #${ROOT_ID} .ff-toggle {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: var(--ff-text-soft);
        cursor: pointer;
      }
      #${ROOT_ID} .ff-toggle input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      #${ROOT_ID} .ff-toggle-switch {
        position: relative;
        width: 46px;
        height: 28px;
        border-radius: var(--ff-radius-pill);
        background: rgba(67, 54, 43, 0.18);
        transition: background var(--ff-transition);
      }
      #${ROOT_ID} .ff-toggle-switch::after {
        content: '';
        position: absolute;
        top: 3px;
        left: 3px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #fffaf4;
        box-shadow: 0 2px 8px rgba(67, 54, 43, 0.16);
        transition: transform var(--ff-transition);
      }
      #${ROOT_ID} .ff-toggle input:checked + .ff-toggle-switch {
        background: var(--ff-accent);
      }
      #${ROOT_ID} .ff-toggle input:checked + .ff-toggle-switch::after {
        transform: translateX(18px);
      }
      #${ROOT_ID} article {
        border-top: 1px solid var(--ff-border);
        padding-top: 34px;
      }
      #${ROOT_ID} .ff-failure {
        margin: 0 auto;
        padding: 36px 28px;
        max-width: 560px;
        background: var(--ff-surface);
        border-radius: var(--ff-radius);
        box-shadow: inset 0 0 0 1px var(--ff-border);
        text-align: left;
      }
      #${ROOT_ID} .ff-failure-title {
        margin: 0 0 12px;
        font: 700 20px/1.3 Charter, "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif;
        color: var(--ff-text);
      }
      #${ROOT_ID} .ff-failure-body {
        margin: 0 0 20px;
        font: 16px/1.6 Charter, "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif;
        color: var(--ff-text-soft);
      }
      #${ROOT_ID} .ff-failure-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      #${ROOT_ID} .ff-bionic-strong {
        font-weight: 700;
        color: #2e241c;
      }
      #${ROOT_ID} .ff-rsvp {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background:
          radial-gradient(circle at top, rgba(72, 57, 45, 0.12), transparent 32%),
          linear-gradient(180deg, #11100f 0%, #0b0a09 100%);
        z-index: 1;
        /* Belt-and-suspenders for short-but-wide windows where the
           locked viewport plus controls would otherwise clip past the
           bottom — gives the user a scroll path of last resort. */
        overflow-y: auto;
        transition: opacity 220ms ease;
      }
      #${ROOT_ID} .ff-rsvp-stage {
        width: min(90vw, 1600px);
        max-width: 90vw;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 22px;
        text-align: center;
        padding: 38px 30px;
        border-radius: calc(var(--ff-radius) + 2px);
        background: var(--ff-surface-rsvp);
        box-shadow: inset 0 0 0 1px rgba(255, 248, 239, 0.05);
      }
      #${ROOT_ID} .ff-rsvp-mode-actions {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        gap: 12px;
        flex-wrap: wrap;
        transition: opacity var(--ff-transition);
      }
      #${ROOT_ID} .ff-rsvp-status {
        margin: 0;
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 236, 225, 0.74);
      }
      #${ROOT_ID} .ff-rsvp-mode-meta {
        margin: 0;
        font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: rgba(244, 236, 225, 0.46);
      }
      #${ROOT_ID} .ff-rsvp-viewport {
        position: relative;
        display: grid;
        width: 100%;
        /* Fixed height: the display and context layers share grid cell
           1/1, so without a fixed size the cell tracks the *larger* of
           the two — even when context is opacity: 0 it still drives
           layout. As active segments change, the viewport (and the
           controls below) would jump. Locking height keeps everything
           stable; long context paragraphs scroll inside.
           Bounded with clamp so very short windows (landscape mobile,
           docked) don't clip controls and very tall windows don't waste
           the whole screen on an empty viewport. */
        height: clamp(160px, 40vh, 360px);
        align-items: center;
      }
      #${ROOT_ID} .ff-rsvp-display {
        grid-area: 1 / 1;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        max-width: 100%;
        height: 100%;
        color: #f6eee3;
        font-size: calc(clamp(36px, 7vw, 72px) * var(--ff-rsvp-font-scale, 1));
        font-weight: 500;
        line-height: 1.1;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-variant-ligatures: none;
        letter-spacing: 0;
        padding: 16px 0;
        overflow: visible;
        transition: opacity 140ms ease;
      }
      #${ROOT_ID} .ff-rsvp-word {
        display: inline-flex;
        align-items: baseline;
        justify-content: center;
        white-space: pre;
        transform: translateX(0px);
        will-change: transform;
      }
      #${ROOT_ID} .ff-rsvp-token {
        display: inline;
        white-space: pre;
        transform: translateZ(0);
      }
      #${ROOT_ID} .ff-rsvp-token-prefix {
        text-align: right;
        min-width: 0;
      }
      #${ROOT_ID} .ff-rsvp-token-orp {
        text-align: center;
        color: var(--ff-orp);
        text-shadow: 0 0 12px rgba(177, 92, 56, 0.22);
        font-weight: 600;
      }
      #${ROOT_ID} .ff-rsvp-token-suffix {
        text-align: left;
        min-width: 0;
      }
      #${ROOT_ID} .ff-rsvp-context {
        grid-area: 1 / 1;
        width: min(760px, 100%);
        height: 100%;
        max-height: 100%;
        justify-self: center;
        padding: 10px 4px;
        overflow-y: auto;
        /* Match the dark RSVP overlay so the scrollbar doesn't pop a
           bright system chrome on Windows/Linux when long paragraphs
           overflow the locked viewport. */
        scrollbar-width: thin;
        scrollbar-color: rgba(246, 238, 227, 0.24) transparent;
        opacity: 0;
        pointer-events: none;
        transition: opacity 140ms ease;
      }
      #${ROOT_ID} .ff-rsvp-context-text {
        margin: 0;
        font: 21px/1.92 Charter, "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif;
        color: rgba(246, 238, 227, 0.92);
      }
      #${ROOT_ID} .ff-rsvp-context[data-variant="quote"] .ff-rsvp-context-text {
        border-left: 4px solid rgba(177, 92, 56, 0.28);
        padding-left: 18px;
        color: rgba(246, 238, 227, 0.82);
      }
      #${ROOT_ID} .ff-rsvp-context-current {
        padding: 0.02em 0.16em;
        border-radius: 6px;
        background: rgba(177, 92, 56, 0.22);
        color: #f6eee3;
        box-shadow: inset 0 -1px 0 rgba(177, 92, 56, 0.38);
      }
      #${ROOT_ID} .ff-rsvp[data-context-visible="true"] .ff-rsvp-display {
        opacity: 0;
        pointer-events: none;
      }
      #${ROOT_ID} .ff-rsvp[data-context-visible="true"] .ff-rsvp-context {
        opacity: 1;
        pointer-events: auto;
      }
      #${ROOT_ID} .ff-rsvp-controls {
        display: flex;
        width: 100%;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        transition: opacity var(--ff-transition);
      }
      #${ROOT_ID} .ff-rsvp-control-group {
        display: flex;
        flex-direction: column;
        gap: 7px;
        align-items: center;
        padding: 11px 13px;
        border-radius: 16px;
        background: rgba(255, 248, 239, 0.055);
        box-shadow: inset 0 0 0 1px rgba(255, 248, 239, 0.04);
      }
      #${ROOT_ID} .ff-rsvp-control-label {
        margin: 0;
        font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 236, 225, 0.46);
      }
      #${ROOT_ID} .ff-rsvp-control-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        flex-wrap: wrap;
      }
      #${ROOT_ID} .ff-rsvp-meta {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        gap: 8px;
      }
      #${ROOT_ID} .ff-rsvp.ff-rsvp-playing .ff-rsvp-mode-actions,
      #${ROOT_ID} .ff-rsvp.ff-rsvp-playing .ff-rsvp-controls,
      #${ROOT_ID} .ff-rsvp-mode-actions[data-playing="true"],
      #${ROOT_ID} .ff-rsvp-controls[data-playing="true"] {
        opacity: 0.28;
      }
      #${ROOT_ID} .ff-rsvp-speed-group {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      #${ROOT_ID} .ff-rsvp-speed {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: rgba(244, 236, 225, 0.72);
      }
      #${ROOT_ID} .ff-rsvp-speed-input {
        width: 88px;
        border: 1px solid rgba(123, 94, 67, 0.14);
        border-radius: var(--ff-radius-pill);
        padding: 9px 12px;
        font: inherit;
        color: #43362b;
        caret-color: #43362b;
        background: rgba(255, 251, 245, 0.96);
      }
      #${ROOT_ID} .ff-rsvp-speed-slider {
        width: 160px;
      }
      #${ROOT_ID} .ff-rsvp-button {
        border: 0;
        border-radius: var(--ff-radius-pill);
        padding: 10px 12px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        background: rgba(255, 248, 239, 0.14);
        color: #f8f1e6;
        cursor: pointer;
        transition: transform var(--ff-transition), background var(--ff-transition), opacity var(--ff-transition);
      }
      #${ROOT_ID} .ff-rsvp-button:hover:enabled {
        transform: translateY(-1px);
        background: rgba(255, 248, 239, 0.2);
      }
      #${ROOT_ID} .ff-rsvp-button:disabled {
        opacity: 0.55;
        cursor: default;
      }
      #${ROOT_ID} p,
      #${ROOT_ID} blockquote,
      #${ROOT_ID} pre,
      #${ROOT_ID} ul,
      #${ROOT_ID} ol,
      #${ROOT_ID} h1,
      #${ROOT_ID} h2,
      #${ROOT_ID} h3,
      #${ROOT_ID} h4 {
        margin: 0 0 18px;
      }
      #${ROOT_ID} p,
      #${ROOT_ID} blockquote {
        font-size: 21px;
        line-height: 1.92;
      }
      #${ROOT_ID} blockquote {
        border-left: 4px solid rgba(138, 93, 56, 0.22);
        padding-left: 20px;
        color: #625142;
      }
      #${ROOT_ID} pre {
        overflow-x: auto;
        padding: 16px;
        border-radius: 14px;
        background: rgba(67, 54, 43, 0.06);
        font: 14px/1.5 "SFMono-Regular", Consolas, monospace;
      }
      #${ROOT_ID} ul,
      #${ROOT_ID} ol {
        padding-left: 28px;
      }
      #${ROOT_ID} li {
        margin-bottom: 12px;
        font-size: 21px;
        line-height: 1.9;
      }
      #${ROOT_ID} h1,
      #${ROOT_ID} h2,
      #${ROOT_ID} h3,
      #${ROOT_ID} h4 {
        font-size: 26px;
        line-height: 1.24;
      }
      #${ROOT_ID}[data-theme="dark"] {
        --ff-bg: #1b1d20;
        --ff-bg-alt: #14161a;
        --ff-surface: rgba(34, 38, 43, 0.78);
        --ff-text: #ece6da;
        --ff-text-soft: #9aa1ab;
        --ff-border: rgba(236, 230, 218, 0.14);
        --ff-accent: #3d9896;
        --ff-accent-deep: #2f7a78;
      }
      #${ROOT_ID}[data-theme="dark"] {
        background:
          radial-gradient(circle at top, rgba(61, 152, 150, 0.07), transparent 34%),
          linear-gradient(180deg, var(--ff-bg) 0%, var(--ff-bg-alt) 100%);
      }
      #${ROOT_ID}[data-theme="dark"] blockquote {
        border-left-color: rgba(236, 230, 218, 0.18);
        color: var(--ff-text-soft);
      }
      #${ROOT_ID}[data-theme="dark"] pre {
        background: rgba(0, 0, 0, 0.28);
      }
      #${ROOT_ID}[data-theme="dark"] .ff-bionic-strong {
        /* Brighter than --ff-text in dark theme so bionic emphasis
           reads as visually heavier, not just heavier weight. */
        color: #ffffff;
      }
      @media (max-width: 640px) {
        #${ROOT_ID} .ff-shell {
          width: calc(100% - 24px);
          padding-top: 20px;
        }
        #${ROOT_ID} .ff-bar {
          align-items: flex-start;
          flex-direction: column;
        }
        #${ROOT_ID} .ff-control-bar {
          flex-direction: column;
          align-items: stretch;
        }
        #${ROOT_ID} .ff-bar-actions {
          justify-content: flex-start;
        }
        #${ROOT_ID} p,
        #${ROOT_ID} blockquote,
        #${ROOT_ID} li {
          font-size: 18px;
        }
        #${ROOT_ID} .ff-rsvp {
          padding: 16px;
        }
        #${ROOT_ID} .ff-rsvp-stage {
          padding: 24px 16px;
          width: calc(100% - 24px);
          max-width: calc(100% - 24px);
        }
        #${ROOT_ID} .ff-rsvp-viewport {
          /* Narrow screens (mobile portrait): trim the locked viewport
             height so the controls stay visible. Short-but-wide windows
             are caught by the clamp() above and the .ff-rsvp scroll
             fallback, since this breakpoint only triggers on width. */
          height: clamp(140px, 32vh, 280px);
        }
        #${ROOT_ID} .ff-rsvp-display {
          font-size: calc(clamp(28px, 10vw, 52px) * var(--ff-rsvp-font-scale, 1));
        }
      }
    `;
  }

  function handleEscape(event) {
    if (event.key === 'Escape') {
      close();
    }
  }

  function handlePageLifecycleExit() {
    close();
  }

  function handleRouteChange() {
    if (!isOpen) {
      return;
    }

    const currentUrl = global.location.href;

    if (currentUrl !== previousUrl) {
      close();
    }
  }

  function patchHistoryMethod(methodName) {
    history[methodName] = function patchedHistoryMethod(...args) {
      const result = originalHistoryMethods[methodName].apply(this, args);
      handleRouteChange();
      return result;
    };
  }

  function attachRouteListeners() {
    if (routeListenersAttached) {
      return;
    }

    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    routeListenersAttached = true;
  }

  function detachRouteListeners() {
    if (!routeListenersAttached) {
      return;
    }

    history.pushState = originalHistoryMethods.pushState;
    history.replaceState = originalHistoryMethods.replaceState;
    window.removeEventListener('popstate', handleRouteChange);
    window.removeEventListener('hashchange', handleRouteChange);
    routeListenersAttached = false;
  }

  function close() {
    const root = document.getElementById(ROOT_ID);

    if (activeRsvpPlayer) {
      activeRsvpPlayer.destroy();
      activeRsvpPlayer = null;
    }

    if (root) {
      root.remove();
    }

    document.removeEventListener('keydown', handleEscape);
    window.removeEventListener('pagehide', handlePageLifecycleExit);
    window.removeEventListener('beforeunload', handlePageLifecycleExit);
    detachRouteListeners();
    document.documentElement.style.overflow = previousOverflow;
    isOpen = false;
    currentMode = 'reader';
  }

  function appendTextContent(node, text, options = {}) {
    if (!options.bionic) {
      node.textContent = text;
      return;
    }

    const fragment = document.createDocumentFragment();
    const parts = String(text).split(/(\s+)/);

    parts.forEach((part) => {
      if (!part) {
        return;
      }

      if (/^\s+$/.test(part)) {
        fragment.appendChild(document.createTextNode(part));
        return;
      }

      const leading = part.match(/^[^A-Za-z0-9]+/)?.[0] || '';
      const trailing = part.match(/[^A-Za-z0-9]+$/)?.[0] || '';
      const core = part.slice(leading.length, part.length - trailing.length);

      if (!core) {
        fragment.appendChild(document.createTextNode(part));
        return;
      }

      const tokenNode = document.createElement('span');
      const strongNode = document.createElement('span');
      const strongLength = Math.max(1, Math.ceil(core.length * 0.5));

      strongNode.className = 'ff-bionic-strong';
      strongNode.textContent = `${leading}${core.slice(0, strongLength)}`;
      tokenNode.appendChild(strongNode);
      tokenNode.appendChild(document.createTextNode(`${core.slice(strongLength)}${trailing}`));
      fragment.appendChild(tokenNode);
    });

    node.replaceChildren(fragment);
  }

  function renderBlock(block, options = {}) {
    const tagNameMap = {
      1: 'h1',
      2: 'h2',
      3: 'h3',
      4: 'h3',
      5: 'h3',
      6: 'h3'
    };

    if (!block || typeof block !== 'object') {
      return null;
    }

    if (block.type === 'list') {
      const listNode = document.createElement(block.ordered ? 'ol' : 'ul');

      block.items.forEach((item) => {
        const listItem = renderListItem(item, options);

        if (listItem) {
          listNode.appendChild(listItem);
        }
      });

      return listNode;
    }

    const tagName = block.type === 'heading'
      ? tagNameMap[block.level] || 'h3'
      : block.type === 'quote'
        ? 'blockquote'
        : block.type === 'pre'
          ? 'pre'
          : 'p';

    const node = document.createElement(tagName);

    if (block.type === 'pre') {
      node.textContent = block.text;
      return node;
    }

    appendTextContent(node, block.text, options);
    return node;
  }

  function renderListItem(item, options = {}) {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const listItem = document.createElement('li');

    if (item.text) {
      const textNode = document.createElement('span');
      appendTextContent(textNode, item.text, options);
      listItem.appendChild(textNode);
    }

    if (Array.isArray(item.children)) {
      item.children.forEach((childBlock) => {
        const renderedChild = renderBlock(childBlock, options);

        if (renderedChild) {
          listItem.appendChild(renderedChild);
        }
      });
    }

    return listItem.childNodes.length > 0 ? listItem : null;
  }

  function renderArticleContent(articleNode, blocks, options = {}) {
    articleNode.replaceChildren();

    blocks.forEach((block) => {
      const renderedBlock = renderBlock(block, options);

      if (renderedBlock) {
        articleNode.appendChild(renderedBlock);
      }
    });
  }

  function destroyRsvpPlayer() {
    if (activeRsvpPlayer) {
      activeRsvpPlayer.destroy();
      activeRsvpPlayer = null;
    }
  }

  function setMode(root, shell, article, readerState, mode) {
    if (mode === currentMode) {
      return;
    }

    if (mode === 'rsvp') {
      if (!activeRsvpPlayer && global.FocalFlowRsvpPlayer) {
        activeRsvpPlayer = global.FocalFlowRsvpPlayer.create(article.readingStream, {
          wordCount: article.wordCount,
          blocks: article.blocks,
          initialWordsPerMinute: readerState.preferences.wordsPerMinute,
          autoStart: Boolean(readerState.preferences.autoStartRsvp),
          rsvpResumeMode: readerState.preferences.rsvpResumeMode,
          onSpeedChange: (value) => {
            readerState.preferences = sanitizePreferences({
              ...readerState.preferences,
              wordsPerMinute: value
            });
            global.FocalFlowPreferences?.update?.({
              wordsPerMinute: readerState.preferences.wordsPerMinute
            });
          },
          onExit: () => setMode(root, shell, article, readerState, 'reader'),
          onClose: () => close()
        });
        shell.insertBefore(activeRsvpPlayer.root, shell.firstChild);
      }

      root.classList.add('ff-rsvp-active');
      currentMode = 'rsvp';
      return;
    }

    root.classList.remove('ff-rsvp-active');
    destroyRsvpPlayer();
    currentMode = 'reader';
  }

  const FAILURE_TITLE_ID = 'focalflow-failure-title';

  function buildFailureShell() {
    ensureStyleTag();
    close();

    previousOverflow = document.documentElement.style.overflow;
    previousUrl = global.location.href;
    document.documentElement.style.overflow = 'hidden';

    const root = document.createElement('section');
    root.id = ROOT_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', FAILURE_TITLE_ID);

    const shell = document.createElement('div');
    shell.className = 'ff-shell';

    const headingGroup = document.createElement('div');
    headingGroup.className = 'ff-heading-group';

    const kicker = document.createElement('p');
    kicker.className = 'ff-kicker';
    kicker.textContent = 'FocalFlow';
    headingGroup.appendChild(kicker);

    const failurePanel = document.createElement('div');
    failurePanel.className = 'ff-failure';

    const failureTitle = document.createElement('h1');
    failureTitle.className = 'ff-failure-title';
    failureTitle.id = FAILURE_TITLE_ID;
    failureTitle.textContent = "FocalFlow couldn't reliably extract this page.";
    failurePanel.appendChild(failureTitle);

    const failureBody = document.createElement('p');
    failureBody.className = 'ff-failure-body';
    failureBody.textContent = 'You can continue reading it on the original site.';
    failurePanel.appendChild(failureBody);

    const actions = document.createElement('div');
    actions.className = 'ff-failure-actions';

    const returnButton = document.createElement('button');
    returnButton.type = 'button';
    returnButton.className = 'ff-close';
    returnButton.textContent = 'Return to original page';
    // Closing the overlay reveals the original page underneath; framed
    // here as a deliberate fallback rather than a generic "Close".
    returnButton.addEventListener('click', close);
    actions.appendChild(returnButton);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'ff-close';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', close);
    actions.appendChild(closeButton);

    failurePanel.appendChild(actions);

    shell.appendChild(headingGroup);
    shell.appendChild(failurePanel);
    root.appendChild(shell);
    document.body.appendChild(root);

    document.addEventListener('keydown', handleEscape);
    window.addEventListener('pagehide', handlePageLifecycleExit);
    window.addEventListener('beforeunload', handlePageLifecycleExit);
    attachRouteListeners();
    isOpen = true;
    currentMode = 'reader';

    // Move keyboard focus to the primary recovery action so screen
    // readers and keyboard-only users land inside the dialog.
    requestAnimationFrame(() => {
      try { returnButton.focus(); } catch (_) { /* ignore */ }
    });
  }

  global.FocalFlowReaderShell = {
    openFailureState() {
      buildFailureShell();
    },
    open(article, options = {}) {
      ensureStyleTag();
      close();

      const preferences = sanitizePreferences(options.preferences);
      const initialBionic = preferences.bionicMode === 'on'
        ? true
        : preferences.bionicMode === 'remember'
          ? Boolean(preferences.bionicLastState)
          : false;
      const readerState = {
        bionicEnabled: initialBionic,
        preferences
      };

      previousOverflow = document.documentElement.style.overflow;
      previousUrl = global.location.href;
      document.documentElement.style.overflow = 'hidden';

      const root = document.createElement('section');
      root.id = ROOT_ID;
      root.dataset.theme = preferences.theme || 'light';

      const shell = document.createElement('div');
      shell.className = 'ff-shell';

      const bar = document.createElement('div');
      bar.className = 'ff-bar';

      const headingGroup = document.createElement('div');
      headingGroup.className = 'ff-heading-group';

      const kicker = document.createElement('p');
      kicker.className = 'ff-kicker';
      kicker.textContent = article.siteName || 'Focused Reading';
      headingGroup.appendChild(kicker);

      const title = document.createElement('h1');
      title.className = 'ff-title';
      title.textContent = article.title;
      headingGroup.appendChild(title);

      const meta = document.createElement('p');
      meta.className = 'ff-meta';
      meta.textContent = article.byline;
      headingGroup.appendChild(meta);

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'ff-close';
      closeButton.textContent = 'Close';
      closeButton.addEventListener('click', close);

      const rsvpButton = document.createElement('button');
      rsvpButton.type = 'button';
      rsvpButton.className = 'ff-close';
      rsvpButton.textContent = 'RSVP Reading';

      const bionicToggle = document.createElement('label');
      bionicToggle.className = 'ff-toggle';

      const bionicInput = document.createElement('input');
      bionicInput.type = 'checkbox';
      bionicInput.checked = readerState.bionicEnabled;
      bionicInput.setAttribute('aria-label', 'Toggle bionic reading');
      bionicToggle.appendChild(bionicInput);

      const bionicSwitch = document.createElement('span');
      bionicSwitch.className = 'ff-toggle-switch';
      bionicToggle.appendChild(bionicSwitch);

      const bionicLabel = document.createElement('span');
      bionicLabel.textContent = 'Bionic Reading';
      bionicToggle.appendChild(bionicLabel);

      const controlBar = document.createElement('div');
      controlBar.className = 'ff-control-bar';
      const barActions = document.createElement('div');
      barActions.className = 'ff-bar-actions';
      barActions.appendChild(bionicToggle);
      barActions.appendChild(rsvpButton);
      barActions.appendChild(closeButton);

      const controlMeta = document.createElement('p');
      controlMeta.className = 'ff-meta';
      controlMeta.textContent = `${article.wordCount} words`;

      controlBar.appendChild(controlMeta);
      controlBar.appendChild(barActions);
      bar.appendChild(headingGroup);
      bar.appendChild(controlBar);
      shell.appendChild(bar);

      rsvpButton.addEventListener('click', () => {
        setMode(root, shell, article, readerState, 'rsvp');
      });

      const articleNode = document.createElement('article');
      shell.appendChild(articleNode);

      // Defer body rendering to the next frame so the header paints first.
      requestAnimationFrame(() => {
        renderArticleContent(articleNode, article.blocks, {
          bionic: readerState.bionicEnabled
        });
      });

      bionicInput.addEventListener('change', () => {
        readerState.bionicEnabled = bionicInput.checked;
        renderArticleContent(articleNode, article.blocks, {
          bionic: readerState.bionicEnabled
        });

        // Only persist last state when the user opted into "remember" mode;
        // "on"/"off" are treated as hard defaults, so toggling is session-only.
        if (readerState.preferences.bionicMode === 'remember') {
          readerState.preferences = sanitizePreferences({
            ...readerState.preferences,
            bionicLastState: readerState.bionicEnabled
          });
          global.FocalFlowPreferences?.update?.({
            bionicLastState: readerState.bionicEnabled
          });
        }
      });

      root.appendChild(shell);
      document.body.appendChild(root);

      document.addEventListener('keydown', handleEscape);
      window.addEventListener('pagehide', handlePageLifecycleExit);
      window.addEventListener('beforeunload', handlePageLifecycleExit);
      attachRouteListeners();
      isOpen = true;
      currentMode = 'reader';

      const initialMode = options.initialMode === 'rsvp' ? 'rsvp' : 'reader';

      if (initialMode === 'rsvp') {
        setMode(root, shell, article, readerState, 'rsvp');
      }
    },
    isOpen() {
      return isOpen;
    },
    close
  };
})(window);
