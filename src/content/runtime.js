(function registerRuntime(global) {
  if (global.__focalFlowRuntimeRegistered) {
    return;
  }

  global.__focalFlowRuntimeRegistered = true;

  function logExtractionDebug(article) {
    const parsedDocument = new DOMParser().parseFromString(article.content, 'text/html');
    const topLevelNodeCount = parsedDocument.body.childElementCount;

    console.group('FocalFlow Extraction Debug');
    console.log('title:', article.title);
    console.log('text length:', article.textContent.length);
    console.log('HTML length:', article.content.length);
    console.log('top-level nodes returned:', topLevelNodeCount);
    console.groupEnd();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      return;
    }

    if (message?.type !== 'focalflow:open-reader') {
      return;
    }

    try {
      const article = global.FocalFlowExtractor.extract(document);

      if (!article) {
        sendResponse({ ok: false, error: 'No readable article content was found on this page.' });
        return;
      }

      logExtractionDebug(article);
      global.FocalFlowReaderShell.open(article, {
        preferences: message.preferences,
        initialMode: message.initialMode
      });
      sendResponse({
        ok: true,
        article: {
          title: article.title,
          wordCount: article.wordCount
        }
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || 'Extraction failed.'
      });
    }
  });
})(window);
