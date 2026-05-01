(function registerExtractor(global) {
  if (global.FocalFlowExtractor) {
    return;
  }

  function normalizeWhitespace(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      // Tighten errant whitespace before sentence-terminating or clause
      // punctuation. Stray spaces of this kind appear when extraction
      // joins inline fragments like `<a>writing</a>.` (rendered as
      // "writing" + " ." after node-join) or when inline markers are
      // stripped between a word and its trailing comma/period.
      .replace(/\s+([.,;:!?)\]”’])/g, '$1')
      .trim();
  }

  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIV', 'DL', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL'
  ]);
  // Selector used to detect when an "inline" element actually wraps
  // block-level descendants (e.g., paulgraham.com's Readability output
  // emits a single <span size="2"> containing the entire essay's <p>s).
  const BLOCK_TAGS_SELECTOR = Array.from(BLOCK_TAGS).map((t) => t.toLowerCase()).join(',');

  function hasBlockDescendant(element) {
    if (!element || typeof element.querySelector !== 'function') {
      return false;
    }
    return element.querySelector(BLOCK_TAGS_SELECTOR) != null;
  }

  const FALLBACK_CONTAINER_PATTERN = /(^|[\s_-])(article|content|post|entry|story|main)([\s_-]|$)/i;
  const FALLBACK_MIN_WORDS = 50;
  const FALLBACK_MIN_CHARS = 200;

  function isNoiseText(text) {
    return /^ad feedback$/i.test(normalizeWhitespace(text || ''));
  }

  function hasWordContent(token) {
    return /[A-Za-z0-9]/.test(token);
  }

  // Must agree with the progressMap increment rule in buildReadingStream:
  // pure-punctuation tokens (lone em-dashes, ellipses standing alone) do not
  // count as words. Otherwise segment word ranges drift past progressMap
  // numbering, and a paragraph boundary lands several frames before the next
  // block's first word — manifesting as paragraph pauses mid-sentence.
  function countWords(text) {
    const trimmed = String(text == null ? '' : text).trim();
    if (!trimmed) {
      return 0;
    }
    return trimmed.split(/\s+/).filter(hasWordContent).length;
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
    // Walk childNodes, accumulating consecutive text/inline elements into a
    // single paragraph block. Only block-level children (P, headings, lists,
    // quotes, pre) interrupt the run — and unknown block-level containers
    // (DIV/SECTION/ARTICLE/etc.) recurse. This avoids the prior bug where
    // collectInlineText(parent) captured all inline descendants AND a second
    // recursion into each <em>/<strong>/<a>/<span> child re-pushed the same
    // text as duplicate paragraph blocks, manifesting as spurious paragraph
    // boundaries mid-sentence during RSVP playback.
    let inlineRun = [];

    function flushInline() {
      if (inlineRun.length === 0) {
        return;
      }

      const text = normalizeWhitespace(inlineRun.join(' '));
      inlineRun = [];

      if (text && !isNoiseText(text)) {
        blocks.push({ type: 'paragraph', text });
      }
    }

    Array.from(parentNode.childNodes || []).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = normalizeWhitespace(node.textContent || '');
        if (text) {
          inlineRun.push(text);
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const tagName = node.tagName.toUpperCase();

      if (!BLOCK_TAGS.has(tagName)) {
        if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') {
          return;
        }
        // Transparent wrapper: an inline element (span, a, font, etc.)
        // that actually contains block-level descendants. Recursing
        // here preserves the inner blocks; otherwise collectInlineText
        // would silently drop every <p> child. See paulgraham.com,
        // where Readability wraps the entire essay in one <span>.
        if (hasBlockDescendant(node)) {
          flushInline();
          collectBlocks(node, blocks);
          return;
        }
        const inlineText = collectInlineText(node);
        if (inlineText && !isNoiseText(inlineText)) {
          inlineRun.push(inlineText);
        }
        return;
      }

      flushInline();

      const text = normalizeWhitespace(node.textContent || '');

      if ((!text || isNoiseText(text)) && tagName !== 'UL' && tagName !== 'OL') {
        return;
      }

      if (/^H[1-6]$/.test(tagName)) {
        blocks.push({
          type: 'heading',
          level: Number(tagName.slice(1)),
          text
        });
        return;
      }

      if (tagName === 'P') {
        blocks.push({ type: 'paragraph', text });
        return;
      }

      if (tagName === 'BLOCKQUOTE') {
        blocks.push({ type: 'quote', text });
        return;
      }

      if (tagName === 'PRE') {
        blocks.push({
          type: 'pre',
          text: (node.textContent || '').trim()
        });
        return;
      }

      if (tagName === 'UL' || tagName === 'OL') {
        const listBlock = buildListBlock(node);

        if (listBlock) {
          blocks.push(listBlock);
        }

        return;
      }

      collectBlocks(node, blocks);
    });

    flushInline();
  }

  // Footnote handling. Sites with notes/footnote sections produce two
  // representations of the same content — inline `[N]` markers in body
  // prose plus a "Notes" / "Footnotes" / "Endnotes" section at the end —
  // which corrupts RSVP flow with stray bracket tokens and a tail of
  // already-referenced material. Strategy: detect the section heading
  // (or a single block that begins with one) and a confirming `[N]`
  // pattern in the tail, then drop everything from that point on and
  // strip inline markers from remaining blocks. Pattern-based, so it
  // doesn't fire on standard articles with no notes section.
  const FOOTNOTE_SECTION_HEADING_PATTERN =
    /^(?:notes?|footnotes?|endnotes?|references)\s*[:.]?\s*$/i;
  // Inline form: the section word follows a sentence boundary (or starts
  // the block) and is immediately followed by a `[N]` item. The leading
  // anchor is captured so we can preserve any prose ahead of it.
  // Limitation: if a single block contains the sequence "...prose. [N]
  // Notes [N] foo" with no period directly before "Notes", inline-form
  // detection won't fire. Readability splits on `<br><br>`, so the
  // realistic PG-style case lands as separate blocks and goes through
  // the standalone-heading path instead.
  const FOOTNOTE_INLINE_FORM_PATTERN =
    /(^|[.!?]\s+)((?:notes?|footnotes?|endnotes?|references)\s*[:.]?\s*\[\s*\d{1,3}\s*\])/i;
  // A bracketed number only counts as a footnote marker when the bracket
  // is NOT preceded by a word character. This protects array indices
  // ("arr[3]") and similar in-word brackets while still matching
  // sentence-trailing markers ("write. [1]"), opener-prefixed markers
  // (")[1]"), and consecutive markers ("[1][2][3]").
  const INLINE_FOOTNOTE_MARKER_PATTERN = /(?<![A-Za-z0-9])\s*\[\s*\d{1,3}\s*\]/g;
  // Backlink glyphs that some sites render after each note item to
  // return to the in-body anchor. The optional VS16 (️) is the
  // emoji-presentation selector that browsers may attach.
  const FOOTNOTE_BACKLINK_PATTERN = /[↑↩]️?/g;
  const NOTE_ITEM_PATTERN = /\[\s*\d{1,3}\s*\]/;

  function blockText(block) {
    if (!block || block.type === 'list') {
      return '';
    }
    return typeof block.text === 'string' ? block.text : '';
  }

  function findFootnoteSectionStart(blocks) {
    for (let i = 0; i < blocks.length; i += 1) {
      const text = blockText(blocks[i]).trim();
      if (!text) continue;

      if (FOOTNOTE_SECTION_HEADING_PATTERN.test(text)) {
        // Standalone heading. Require a `[N]` pattern in the tail so we
        // don't trip on a body section titled "Notes" (review notes,
        // chef's notes, etc.) — including a final "Notes" block with
        // nothing after it, which we leave alone.
        const tail = blocks.slice(i + 1).map(blockText).join(' ');
        if (NOTE_ITEM_PATTERN.test(tail)) {
          return { index: i, mode: 'heading' };
        }
      }

      // Inline form: section word + `[N]` somewhere in this block,
      // preceded by a sentence boundary or block start. Trim from there
      // and drop any subsequent blocks.
      const inlineMatch = text.match(FOOTNOTE_INLINE_FORM_PATTERN);
      if (inlineMatch) {
        // The section-word starts at: match index + length of the
        // leading anchor (captured group 1).
        const sectionWordStart = inlineMatch.index + inlineMatch[1].length;
        return { index: i, mode: 'inline', sectionWordStart };
      }
    }
    return null;
  }

  function stripInlineMarkers(text) {
    if (typeof text !== 'string' || !text) return '';
    return normalizeWhitespace(
      text
        .replace(INLINE_FOOTNOTE_MARKER_PATTERN, ' ')
        .replace(FOOTNOTE_BACKLINK_PATTERN, ' ')
    );
  }

  function cleanListBlock(block) {
    const items = block.items
      .map((item) => {
        const text = stripInlineMarkers(item.text || '');
        const children = Array.isArray(item.children)
          ? item.children.map((child) => (child?.type === 'list' ? cleanListBlock(child) : child))
              .filter(Boolean)
          : [];
        if (!text && children.length === 0) return null;
        return { text, children };
      })
      .filter(Boolean);
    if (items.length === 0) return null;
    return { ...block, items };
  }

  function cleanFootnotes(blocks) {
    const cutoff = findFootnoteSectionStart(blocks);
    const upto = cutoff ? cutoff.index : blocks.length;
    const cleaned = [];

    for (let i = 0; i < upto; i += 1) {
      const block = blocks[i];
      if (!block) continue;
      if (block.type === 'list') {
        const list = cleanListBlock(block);
        if (list) cleaned.push(list);
        continue;
      }
      // Preserve `pre` blocks verbatim — bracketed numbers in code
      // (e.g., array indices) are content, not footnote markers.
      if (block.type === 'pre') {
        cleaned.push(block);
        continue;
      }
      const text = stripInlineMarkers(blockText(block));
      if (!text) continue;
      cleaned.push({ ...block, text });
    }

    // Inline-form cutoff: preserve any prose that appears *before* the
    // section word in the same block.
    if (cutoff && cutoff.mode === 'inline') {
      const block = blocks[cutoff.index];
      const text = blockText(block);
      const before = stripInlineMarkers(text.slice(0, cutoff.sectionWordStart));
      if (before) cleaned.push({ ...block, text: before });
    }

    return cleaned;
  }

  // Some sites' Readability output emits stray inline content between
  // adjacent `<p>` siblings (e.g., paulgraham.com closes the `<p>` early
  // and leaves an `<a>writing</a>.` floating before the next `<p>`).
  // After collectBlocks that orphan becomes its own short paragraph
  // even though it logically belongs to the end of the previous one.
  // Heuristic: if a short paragraph (<=3 words) follows a paragraph
  // that doesn't end with sentence-terminal punctuation, append it.
  const SENTENCE_TERMINAL_PATTERN = /[.!?](?:["')\]”’]+)?$/;
  // Orphan fragments that should be glued back are continuations of the
  // prior sentence — they start with a lowercase letter (link text like
  // "writing") or pure punctuation (a stray period). Capitalized short
  // paragraphs ("Apples", "Oranges", "Read more") are intentional new
  // paragraphs even when the prior one lacks a terminator, so we leave
  // them alone.
  const ORPHAN_CONTINUATION_PATTERN = /^[a-z]|^[^A-Za-z0-9]/;
  function stitchOrphanFragments(blocks) {
    const result = [];
    blocks.forEach((block) => {
      const prev = result[result.length - 1];
      if (
        prev
        && prev.type === 'paragraph'
        && block.type === 'paragraph'
        && typeof prev.text === 'string'
        && typeof block.text === 'string'
      ) {
        const prevText = prev.text.trim();
        const blockText = block.text.trim();
        const blockWordCount = blockText.split(/\s+/).filter(Boolean).length;
        if (
          blockWordCount <= 3
          && !SENTENCE_TERMINAL_PATTERN.test(prevText)
          && ORPHAN_CONTINUATION_PATTERN.test(blockText)
        ) {
          // Replace the prev block with a fresh object instead of
          // mutating in place, so callers can hold references safely.
          result[result.length - 1] = {
            ...prev,
            text: normalizeWhitespace(`${prevText} ${blockText}`)
          };
          return;
        }
      }
      result.push(block);
    });
    return result;
  }

  function buildBlocks(articleHtml) {
    const parsedDocument = new DOMParser().parseFromString(articleHtml, 'text/html');
    const rawBlocks = [];
    collectBlocks(parsedDocument.body, rawBlocks);

    return stitchOrphanFragments(cleanFootnotes(rawBlocks.map(normalizeBlock).filter(Boolean)));
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
    return stitchOrphanFragments(cleanFootnotes(rawBlocks.map(normalizeBlock).filter(Boolean)));
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

  // Threshold for declaring an extraction "low confidence" — too short to
  // be a real article. Roughly 1-2 sentences. Below this we route the
  // user to the graceful failure state instead of opening a reader that
  // would feel broken.
  const LOW_CONFIDENCE_WORD_THRESHOLD = 30;

  function isLowConfidence(article) {
    if (!article || typeof article !== 'object') {
      return true;
    }
    const blocks = Array.isArray(article.blocks) ? article.blocks : [];
    if (blocks.length === 0) {
      return true;
    }
    const wordCount = Number(article.wordCount);
    if (!Number.isFinite(wordCount) || wordCount < LOW_CONFIDENCE_WORD_THRESHOLD) {
      return true;
    }
    const textContent = typeof article.textContent === 'string' ? article.textContent : '';
    if (!textContent.trim()) {
      return true;
    }
    return false;
  }

  // Materially-incomplete detection. Some pages cause Readability to
  // pick a container that holds only part of the article (lede block,
  // a single section, etc.). To catch this without running the full
  // extractor twice, compare the extracted word count to a cheap
  // estimate of visible article prose: sum the word counts of <p>
  // elements that aren't inside a non-article ancestor (header/footer/
  // nav/aside/form) or a container with a "comments / sidebar / ads /
  // related" class or id hint. If the estimator has enough signal
  // (>= 200 words) and the extracted ratio drops below 0.5, the
  // extraction is likely incomplete and we route to the failure state.
  const COMPLETENESS_MIN_PAGE_PROSE = 200;
  const COMPLETENESS_RATIO_THRESHOLD = 0.5;
  const NON_ARTICLE_ANCESTOR_TAGS = new Set([
    'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'FORM'
  ]);
  const NON_ARTICLE_CONTAINER_HINT_PATTERN =
    /(?:^|[\s_-])(?:comment|comments|reply|replies|sidebar|side-bar|menu|advert|ads|promo|related|recommend|recommended|footer|header|nav|share|social|newsletter|subscribe|popup|modal)(?:[\s_-]|$)/i;

  function isInsideNonArticleContainer(node) {
    let cur = node && node.parentElement;
    while (cur) {
      if (NON_ARTICLE_ANCESTOR_TAGS.has(cur.tagName)) {
        return true;
      }
      const tokens = `${cur.className || ''} ${cur.id || ''}`;
      if (tokens && NON_ARTICLE_CONTAINER_HINT_PATTERN.test(tokens)) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  function estimatePageProseWordCount(sourceDocument) {
    if (!sourceDocument || typeof sourceDocument.querySelectorAll !== 'function') {
      return 0;
    }
    const paragraphs = sourceDocument.querySelectorAll('p');
    let total = 0;
    for (const p of paragraphs) {
      if (isInsideNonArticleContainer(p)) {
        continue;
      }
      total += countWords(p.textContent || '');
    }
    return total;
  }

  function isMateriallyIncomplete(article, sourceDocument) {
    if (!article || !sourceDocument) {
      return false;
    }
    const extracted = Number(article.wordCount);
    if (!Number.isFinite(extracted) || extracted <= 0) {
      // Fully-empty extractions are caught upstream by isLowConfidence.
      return false;
    }
    const estimated = estimatePageProseWordCount(sourceDocument);
    if (estimated < COMPLETENESS_MIN_PAGE_PROSE) {
      // Not enough signal — short pages or pages that don't use <p>.
      return false;
    }
    const ratio = extracted / estimated;
    return ratio < COMPLETENESS_RATIO_THRESHOLD;
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
    isLowConfidence,
    isMateriallyIncomplete,
    estimatePageProseWordCount,
    LOW_CONFIDENCE_WORD_THRESHOLD,
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
      collectBlocks,
      collectInlineText,
      cleanFootnotes,
      stripInlineMarkers,
      findFootnoteSectionStart,
      stitchOrphanFragments,
      hasBlockDescendant,
      isLowConfidence,
      LOW_CONFIDENCE_WORD_THRESHOLD,
      isMateriallyIncomplete,
      estimatePageProseWordCount,
      isInsideNonArticleContainer,
      COMPLETENESS_MIN_PAGE_PROSE,
      COMPLETENESS_RATIO_THRESHOLD,
      scoreCandidate,
      matchesFallbackClassOrId,
      isReadabilityResultWeak,
      FALLBACK_MIN_WORDS,
      FALLBACK_MIN_CHARS
    }
  };
})(window);
