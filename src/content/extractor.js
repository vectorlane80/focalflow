(function registerExtractor(global) {
  if (global.FocalFlowExtractor) {
    return;
  }

  function normalizeWhitespace(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIV', 'DL', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL'
  ]);

  const FALLBACK_CONTAINER_PATTERN = /(^|[\s_-])(article|content|post|entry|story|main)([\s_-]|$)/i;
  const FALLBACK_MIN_WORDS = 50;
  const FALLBACK_MIN_CHARS = 200;

  function isNoiseText(text) {
    return /^ad feedback$/i.test(normalizeWhitespace(text || ''));
  }

  function countWords(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  function hasWordContent(token) {
    return /[A-Za-z0-9]/.test(token);
  }

  function normalizeHeadingLevel(level) {
    const numericLevel = Number(level);

    if (!Number.isFinite(numericLevel) || numericLevel <= 0) {
      return 2;
    }

    if (numericLevel <= 1) {
      return 1;
    }

    if (numericLevel === 2) {
      return 2;
    }

    return 3;
  }

  function normalizeBlock(block) {
    if (!block || typeof block !== 'object') {
      return null;
    }

    if (block.type === 'list') {
      const items = Array.isArray(block.items)
        ? block.items.map(normalizeListItem).filter(Boolean)
        : [];

      if (items.length === 0) {
        return null;
      }

      return {
        type: 'list',
        ordered: Boolean(block.ordered),
        items
      };
    }

    const text = typeof block.text === 'string' ? normalizeWhitespace(block.text) : '';

    if (!text || isNoiseText(text)) {
      return null;
    }

    if (block.type === 'heading') {
      return {
        type: 'heading',
        level: normalizeHeadingLevel(block.level),
        text
      };
    }

    if (block.type === 'paragraph' || block.type === 'quote' || block.type === 'pre') {
      return {
        type: block.type,
        text
      };
    }

    return null;
  }

  function normalizeListItem(item) {
    if (typeof item === 'string') {
      const text = normalizeWhitespace(item);
      return text ? { text, children: [] } : null;
    }

    if (!item || typeof item !== 'object') {
      return null;
    }

    const text = typeof item.text === 'string' ? normalizeWhitespace(item.text) : '';
    const children = Array.isArray(item.children)
      ? item.children.map(normalizeBlock).filter((block) => block?.type === 'list')
      : [];

    if (!text && children.length === 0) {
      return null;
    }

    return { text, children };
  }

  function appendReadingTextFromList(listBlock, textSegments) {
    listBlock.items.forEach((item) => {
      if (item.text) {
        textSegments.push(item.text);
      }

      item.children.forEach((childBlock) => {
        appendReadingTextFromList(childBlock, textSegments);
      });
    });
  }

  function buildReadingStream(blocks) {
    const textSegments = [];

    blocks.forEach((block) => {
      if (block.type === 'list') {
        appendReadingTextFromList(block, textSegments);
        return;
      }

      textSegments.push(block.text);
    });

    const text = normalizeWhitespace(textSegments.join(' '));
    const tokens = text ? text.split(/\s+/) : [];
    let wordProgress = 0;
    const progressMap = tokens.map((token) => {
      if (hasWordContent(token)) {
        wordProgress += 1;
      }

      return wordProgress;
    });

    return {
      text,
      tokens,
      wordCount: countWords(text),
      progressMap
    };
  }

  function collectInlineText(node) {
    const parts = [];

    Array.from(node.childNodes).forEach((childNode) => {
      if (childNode.nodeType === Node.TEXT_NODE) {
        const text = normalizeWhitespace(childNode.textContent || '');

        if (text) {
          parts.push(text);
        }

        return;
      }

      if (childNode.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const tagName = childNode.tagName.toUpperCase();

      if (BLOCK_TAGS.has(tagName)) {
        return;
      }

      if (childNode.getAttribute('aria-hidden') === 'true') {
        return;
      }

      const text = collectInlineText(childNode);

      if (text && !isNoiseText(text)) {
        parts.push(text);
      }
    });

    return normalizeWhitespace(parts.join(' '));
  }

  function buildListItemBlock(itemNode) {
    const text = collectInlineText(itemNode);
    const children = [];

    Array.from(itemNode.children).forEach((childNode) => {
      if (childNode.tagName === 'UL' || childNode.tagName === 'OL') {
        const nestedListBlock = buildListBlock(childNode);

        if (nestedListBlock) {
          children.push(nestedListBlock);
        }
      }
    });

    if (!text && children.length === 0) {
      return null;
    }

    return { text, children };
  }

  function buildListBlock(listNode) {
    const items = Array.from(listNode.children)
      .filter((child) => child.tagName === 'LI')
      .map(buildListItemBlock)
      .filter(Boolean);

    if (items.length === 0) {
      return null;
    }

    return {
      type: 'list',
      ordered: listNode.tagName === 'OL',
      items
    };
  }

  function collectBlocks(parentNode, blocks) {
    const directText = collectInlineText(parentNode);

    if (directText && parentNode !== parentNode.ownerDocument.body && !isNoiseText(directText)) {
      blocks.push({ type: 'paragraph', text: directText });
    }

    Array.from(parentNode.children).forEach((node) => {
      const text = normalizeWhitespace(node.textContent || '');

      if ((!text || isNoiseText(text)) && node.tagName !== 'UL' && node.tagName !== 'OL') {
        return;
      }

      if (/^H[1-6]$/.test(node.tagName)) {
        blocks.push({
          type: 'heading',
          level: Number(node.tagName.slice(1)),
          text
        });
        return;
      }

      if (node.tagName === 'P') {
        blocks.push({ type: 'paragraph', text });
        return;
      }

      if (node.tagName === 'BLOCKQUOTE') {
        blocks.push({ type: 'quote', text });
        return;
      }

      if (node.tagName === 'PRE') {
        blocks.push({
          type: 'pre',
          text: (node.textContent || '').trim()
        });
        return;
      }

      if (node.tagName === 'UL' || node.tagName === 'OL') {
        const listBlock = buildListBlock(node);

        if (listBlock) {
          blocks.push(listBlock);
        }

        return;
      }

      collectBlocks(node, blocks);
    });
  }

  function buildBlocks(articleHtml) {
    const parsedDocument = new DOMParser().parseFromString(articleHtml, 'text/html');
    const rawBlocks = [];
    collectBlocks(parsedDocument.body, rawBlocks);

    return rawBlocks.map(normalizeBlock).filter(Boolean);
  }

  // Fallback heuristic: when Readability yields no usable content, rank
  // plausible article containers by raw text length minus a link-density
  // penalty, since navigation/list blocks tend to be dense with anchor text
  // but sparse with prose. We then walk the winning container to produce
  // the same block shape the renderer consumes.
  function scoreCandidate(node) {
    const text = normalizeWhitespace(node.textContent || '');
    const textLength = text.length;

    if (textLength === 0) {
      return 0;
    }

    let linkTextLength = 0;
    Array.from(node.querySelectorAll('a')).forEach((anchor) => {
      linkTextLength += normalizeWhitespace(anchor.textContent || '').length;
    });

    const linkDensity = linkTextLength / textLength;
    return textLength * (1 - Math.min(linkDensity, 0.95));
  }

  function matchesFallbackClassOrId(node) {
    const tokens = `${node.className || ''} ${node.id || ''}`;
    return FALLBACK_CONTAINER_PATTERN.test(tokens);
  }

  function collectFallbackCandidates(sourceDocument) {
    const candidates = [];
    const seen = new Set();

    function push(node) {
      if (node && !seen.has(node)) {
        seen.add(node);
        candidates.push(node);
      }
    }

    Array.from(sourceDocument.querySelectorAll('main, article, section')).forEach(push);

    Array.from(sourceDocument.body ? sourceDocument.body.querySelectorAll('div') : []).forEach((node) => {
      if (matchesFallbackClassOrId(node)) {
        push(node);
      }
    });

    return candidates;
  }

  function pickBestFallbackContainer(sourceDocument) {
    const candidates = collectFallbackCandidates(sourceDocument);
    let best = null;
    let bestScore = 0;

    candidates.forEach((node) => {
      const score = scoreCandidate(node);

      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    });

    return best;
  }

  function buildBlocksFromContainer(container) {
    const rawBlocks = [];
    collectBlocks(container, rawBlocks);
    return rawBlocks.map(normalizeBlock).filter(Boolean);
  }

  function extractFallback(sourceDocument) {
    const container = pickBestFallbackContainer(sourceDocument);

    if (!container) {
      return null;
    }

    const blocks = buildBlocksFromContainer(container);

    if (blocks.length === 0) {
      return null;
    }

    const textContent = normalizeWhitespace(container.textContent || '');

    if (!textContent) {
      return null;
    }

    const contentHtml = container.innerHTML || '';
    const title = normalizeWhitespace(
      sourceDocument.title
        || (sourceDocument.querySelector('h1')?.textContent || '')
        || 'Untitled article'
    );
    const siteName = normalizeWhitespace(sourceDocument.location?.hostname || '');

    return {
      title,
      byline: '',
      excerpt: '',
      siteName,
      content: contentHtml,
      textContent,
      length: textContent.length,
      wordCount: countWords(textContent),
      blocks,
      readingStream: buildReadingStream(blocks)
    };
  }

  function isReadabilityResultWeak(article) {
    if (!article || !article.textContent || !article.content) {
      return true;
    }

    const text = normalizeWhitespace(article.textContent);
    return countWords(text) < FALLBACK_MIN_WORDS && text.length < FALLBACK_MIN_CHARS;
  }

  function attachSource(result, source) {
    if (!result) {
      return result;
    }

    try {
      Object.defineProperty(result, '_extractionSource', {
        value: source,
        enumerable: false,
        configurable: true,
        writable: true
      });
    } catch (error) {
      result._extractionSource = source;
    }

    return result;
  }

  global.FocalFlowExtractor = {
    extract(sourceDocument) {
      if (typeof Readability !== 'function') {
        throw new Error('Readability.js is not available.');
      }

      let readabilityArticle = null;
      try {
        const documentClone = sourceDocument.cloneNode(true);
        readabilityArticle = new Readability(documentClone).parse();
      } catch (error) {
        readabilityArticle = null;
      }

      if (!isReadabilityResultWeak(readabilityArticle)) {
        const textContent = normalizeWhitespace(readabilityArticle.textContent);
        const blocks = buildBlocks(readabilityArticle.content);

        if (textContent && blocks.length > 0) {
          return attachSource({
            title: normalizeWhitespace(readabilityArticle.title || sourceDocument.title || 'Untitled article'),
            byline: normalizeWhitespace(readabilityArticle.byline || ''),
            excerpt: normalizeWhitespace(readabilityArticle.excerpt || ''),
            siteName: normalizeWhitespace(readabilityArticle.siteName || sourceDocument.location?.hostname || ''),
            content: readabilityArticle.content,
            textContent,
            length: readabilityArticle.length || textContent.length,
            wordCount: countWords(textContent),
            blocks,
            readingStream: buildReadingStream(blocks)
          }, 'readability');
        }
      }

      const fallback = extractFallback(sourceDocument);
      return attachSource(fallback, fallback ? 'fallback' : null);
    },
    __testing: {
      normalizeWhitespace,
      normalizeBlock,
      normalizeListItem,
      normalizeHeadingLevel,
      countWords,
      buildReadingStream,
      scoreCandidate,
      matchesFallbackClassOrId,
      isReadabilityResultWeak,
      FALLBACK_MIN_WORDS,
      FALLBACK_MIN_CHARS
    }
  };
})(window);
