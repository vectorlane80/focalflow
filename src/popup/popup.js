const openFocusedReadingButton = document.getElementById('open-focused-reading');
const openRsvpReadingButton = document.getElementById('open-rsvp-reading');
const openPreferencesButton = document.getElementById('open-preferences');
const backToMainButton = document.getElementById('back-to-main');
const mainView = document.getElementById('main-view');
const preferencesView = document.getElementById('preferences-view');
const statusNode = document.getElementById('status');
const wpmInput = document.getElementById('wpm-input');
const bionicModeSelect = document.getElementById('bionic-mode-select');
const autoStartRsvpInput = document.getElementById('auto-start-rsvp-input');
const rsvpResumeModeSelect = document.getElementById('rsvp-resume-mode-select');
const themeSelect = document.getElementById('theme-select');

function setStatus(message, tone = 'default') {
  statusNode.textContent = message;
  statusNode.dataset.tone = tone;
}

function showView(viewName) {
  const showPreferences = viewName === 'preferences';
  mainView.hidden = showPreferences;
  preferencesView.hidden = !showPreferences;
}

async function loadPreferences() {
  const preferences = await window.FocalFlowPreferences.get();
  wpmInput.value = String(preferences.wordsPerMinute);
  bionicModeSelect.value = preferences.bionicMode;
  autoStartRsvpInput.checked = Boolean(preferences.autoStartRsvp);
  rsvpResumeModeSelect.value = preferences.rsvpResumeMode;
  themeSelect.value = preferences.theme;
}

async function savePreferences(partial) {
  const preferences = await window.FocalFlowPreferences.update(partial);
  wpmInput.value = String(preferences.wordsPerMinute);
  bionicModeSelect.value = preferences.bionicMode;
  autoStartRsvpInput.checked = Boolean(preferences.autoStartRsvp);
  rsvpResumeModeSelect.value = preferences.rsvpResumeMode;
  themeSelect.value = preferences.theme;
  setStatus('Preferences saved.', 'success');
  return preferences;
}

function setEntryButtonsDisabled(isDisabled) {
  openFocusedReadingButton.disabled = isDisabled;
  openRsvpReadingButton.disabled = isDisabled;
}

async function openReaderMode(mode) {
  setEntryButtonsDisabled(true);
  setStatus('Extracting this page...');

  try {
    const preferences = await window.FocalFlowPreferences.get();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      throw new Error('No active tab is available.');
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        'src/vendor/Readability.js',
        'src/shared/preferences.js',
        'src/content/extractor.js',
        'src/content/rsvp-engine.js',
        'src/content/rsvp-player.js',
        'src/content/reader-shell.js',
        'src/content/runtime.js'
      ]
    });

    // Fire the open-reader message but do not await the response; the popup
    // closes immediately so the user perceives the reader opening without a
    // visible round-trip. Errors after close are logged to the page console.
    chrome.tabs.sendMessage(tab.id, {
      type: 'focalflow:open-reader',
      preferences,
      initialMode: mode
    }).catch((error) => {
      console.error('FocalFlow: open-reader message failed', error);
    });

    window.close();
  } catch (error) {
    const fallback = 'This page does not allow extraction or script injection.';
    setStatus(error?.message || fallback, 'error');
    setEntryButtonsDisabled(false);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadPreferences().catch((error) => {
    setStatus(error?.message || 'Preferences could not be loaded.', 'error');
  });

  // Prefill the feedback link with the active tab URL so reports include
  // page context. Best-effort: if the query fails (e.g., chrome:// page),
  // the link still works without the body parameter.
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.url) return;
    const link = document.getElementById('feedback-link');
    if (link) {
      link.href += `&body=${encodeURIComponent(`Page: ${tab.url}`)}`;
    }
  }).catch(() => { /* noop */ });
});

wpmInput.addEventListener('change', () => {
  savePreferences({ wordsPerMinute: wpmInput.value }).catch((error) => {
    setStatus(error?.message || 'Preferences could not be saved.', 'error');
  });
});

bionicModeSelect.addEventListener('change', () => {
  savePreferences({ bionicMode: bionicModeSelect.value }).catch((error) => {
    setStatus(error?.message || 'Preferences could not be saved.', 'error');
  });
});

autoStartRsvpInput.addEventListener('change', () => {
  savePreferences({ autoStartRsvp: autoStartRsvpInput.checked }).catch((error) => {
    setStatus(error?.message || 'Preferences could not be saved.', 'error');
  });
});

rsvpResumeModeSelect.addEventListener('change', () => {
  savePreferences({ rsvpResumeMode: rsvpResumeModeSelect.value }).catch((error) => {
    setStatus(error?.message || 'Preferences could not be saved.', 'error');
  });
});

themeSelect.addEventListener('change', () => {
  savePreferences({ theme: themeSelect.value }).catch((error) => {
    setStatus(error?.message || 'Preferences could not be saved.', 'error');
  });
});

openFocusedReadingButton.addEventListener('click', () => {
  openReaderMode('reader');
});

openRsvpReadingButton.addEventListener('click', () => {
  openReaderMode('rsvp');
});

openPreferencesButton.addEventListener('click', () => {
  showView('preferences');
});

backToMainButton.addEventListener('click', () => {
  showView('main');
});
