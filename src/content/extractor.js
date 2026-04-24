(function registerExtractor(global) {
  if (global.FocalFlowExtractor) {
    return;
  }

  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
  }

  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIV', 'DL', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL'
  ]);

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

    if (!Number.isFinite(numericLevel)) {
      return 3;
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

  global.FocalFlowExtractor = {
    extract(sourceDocument) {
      if (typeof Readability !== 'function') {
        throw new Error('Readability.js is not available.');
      }

      const documentClone = sourceDocument.cloneNode(true);
      const article = new Readability(documentClone).parse();

      if (!article?.textContent || !article.content) {
        return null;
      }

      const textContent = normalizeWhitespace(article.textContent);
      const blocks = buildBlocks(article.content);

      if (!textContent || blocks.length === 0) {
        return null;
      }

      return {
        title: normalizeWhitespace(article.title || sourceDocument.title || 'Untitled article'),
        byline: normalizeWhitespace(article.byline || ''),
        excerpt: normalizeWhitespace(article.excerpt || ''),
        siteName: normalizeWhitespace(article.siteName || sourceDocument.location.hostname || ''),
        content: article.content,
        textContent,
        length: article.length || textContent.length,
        wordCount: countWords(textContent),
        blocks,
        readingStream: buildReadingStream(blocks)
      };
    }
  };
})(window);
