(function registerRuntime(global) {
  if (global.__focalFlowRuntimeRegistered) {
    return;
  }

  global.__focalFlowRuntimeRegistered = true;

  const FOCALFLOW_DEBUG = true;

  function summarizeBlockTypes(blocks) {
    const summary = {};

    if (!Array.isArray(blocks)) {
      return summary;
    }

    blocks.forEach((block) => {
      if (!block || typeof block.type !== 'string') {
        return;
      }

      summary[block.type] = (summary[block.type] || 0) + 1;
    });

    return summary;
  }

  function firstContentSnippet(blocks) {
    if (!Array.isArray(blocks)) {
      return '';
    }

    for (const block of blocks) {
      if (!block) {
        continue;
      }

      if (typeof block.text === 'string' && block.text) {
        return block.text.slice(0, 80);
      }

      if (block.type === 'list' && Array.isArray(block.items)) {
        const firstItemWithText = block.items.find((item) => item && item.text);
        if (firstItemWithText) {
          return firstItemWithText.text.slice(0, 80);
        }
      }
    }

    return '';
  }

  function logExtractionDebug(article) {
    if (!FOCALFLOW_DEBUG) {
      return;
    }

    const parsedDocument = new DOMParser().parseFromString(article.content, 'text/html');
    const topLevelNodeCount = parsedDocument.body.childElementCount;
    const blockTypeBreakdown = summarizeBlockTypes(article.blocks);
    const blockCount = Array.isArray(article.blocks) ? article.blocks.length : 0;
    const snippet = firstContentSnippet(article.blocks);
    const source = article._extractionSource || 'unknown';

    console.group('FocalFlow Extraction Debug');
    console.log('title:', article.title);
    console.log('text length:', article.textContent.length);
    console.log('HTML length:', article.content.length);
    console.log('top-level nodes returned:', topLevelNodeCount);
    console.log('extraction source:', source);
    console.log('fallback used:', source === 'fallback');
    console.log('block count:', blockCount);
    console.log('block types:', blockTypeBreakdown);
    console.log('first block snippet:', snippet);
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
