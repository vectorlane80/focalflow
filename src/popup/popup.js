const openFocusedReadingButton = document.getElementById('open-focused-reading');
const openRsvpReadingButton = document.getElementById('open-rsvp-reading');
const openPreferencesButton = document.getElementById('open-preferences');
const backToMainButton = document.getElementById('back-to-main');
const mainView = document.getElementById('main-view');
const preferencesView = document.getElementById('preferences-view');
const statusNode = document.getElementById('status');
const wpmInput = document.getElementById('wpm-input');

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
}

async function savePreferences(partial) {
  const preferences = await window.FocalFlowPreferences.update(partial);
  wpmInput.value = String(preferences.wordsPerMinute);
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

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'focalflow:open-reader',
      preferences,
      initialMode: mode
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Reader mode could not be opened on this page.');
    }

    setStatus(`${mode === 'rsvp' ? 'RSVP Reading' : 'Focused Reading'} opened.`);
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
});

wpmInput.addEventListener('change', () => {
  savePreferences({ wordsPerMinute: wpmInput.value }).catch((error) => {
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
