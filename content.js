// QuoteFB - Facebook Persistent Unique WhatsApp Group Invite Filter with Streamlined Controls
// Content Script (Manifest V3)

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__QUOTE_FB_LOADED__) return;
  window.__QUOTE_FB_LOADED__ = true;

  // Global persistent storage keys
  const STORAGE_LINKS_KEY = 'quotefb_collected_links';
  const STORAGE_ARCHIVED_KEY = 'quotefb_archived_links';

  // In-memory state
  const state = {
    enabled: true,
    requireWhatsAppLink: true,
    onlyUniqueWhatsApp: true,
    caseSensitive: false,
    customQuery: '',
    widgetCollapsed: false,
    activeQuery: '',
    
    // Auto-Scroll & Pause/Resume state
    isAutoScrolling: false,
    isPaused: false,
    scrollIntervalMs: 1800,
    reachedEnd: false,
    
    // Counters on current active screen
    currentVisibleOnScreen: 0,
    currentDuplicatesOnScreen: 0,
    currentNonWAOnScreen: 0,
    
    // Persistent uncopied session batch across ALL Facebook pages and groups
    collectedLinks: [], // Array of normalized string URLs
    
    // Permanent history of previously copied/exported links
    archivedLinks: [],
    lastActionFeedback: '',
  };

  // Sets of codes for fast O(1) deduplication
  const persistentSeenCodes = new Set();
  const archivedCodes = new Set();

  let scanDebounceTimer = null;
  let observer = null;
  let currentUrl = window.location.href;
  let autoScrollTimer = null;

  // --- 1. SETTINGS & PERSISTENT STORAGE ---

  function loadPersistentData(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(
        [
          'enabled',
          'requireWhatsAppLink',
          'onlyUniqueWhatsApp',
          'caseSensitive',
          'customQuery',
          'widgetCollapsed',
          STORAGE_LINKS_KEY,
          STORAGE_ARCHIVED_KEY,
        ],
        (items) => {
          if (items.enabled !== undefined) state.enabled = items.enabled;
          if (items.requireWhatsAppLink !== undefined) state.requireWhatsAppLink = items.requireWhatsAppLink;
          if (items.onlyUniqueWhatsApp !== undefined) state.onlyUniqueWhatsApp = items.onlyUniqueWhatsApp;
          if (items.caseSensitive !== undefined) state.caseSensitive = items.caseSensitive;
          if (items.customQuery !== undefined) state.customQuery = items.customQuery;
          if (items.widgetCollapsed !== undefined) state.widgetCollapsed = items.widgetCollapsed;

          // 1. Load Archived History
          archivedCodes.clear();
          if (Array.isArray(items[STORAGE_ARCHIVED_KEY])) {
            state.archivedLinks = items[STORAGE_ARCHIVED_KEY];
            state.archivedLinks.forEach((url) => {
              const parsed = normalizeWhatsAppUrl(url);
              if (parsed) {
                archivedCodes.add(parsed.code);
                persistentSeenCodes.add(parsed.code);
              }
            });
          }

          // 2. Load Uncopied Current Batch
          if (Array.isArray(items[STORAGE_LINKS_KEY])) {
            state.collectedLinks = items[STORAGE_LINKS_KEY].filter((url) => {
              const parsed = normalizeWhatsAppUrl(url);
              return parsed && !archivedCodes.has(parsed.code);
            });

            state.collectedLinks.forEach((url) => {
              const parsed = normalizeWhatsAppUrl(url);
              if (parsed) persistentSeenCodes.add(parsed.code);
            });
          }

          if (callback) callback();
        }
      );
    } else {
      if (callback) callback();
    }
  }

  function saveSettings(keys) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(keys);
    }
  }

  function persistAllData() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        [STORAGE_LINKS_KEY]: state.collectedLinks,
        [STORAGE_ARCHIVED_KEY]: state.archivedLinks,
      });
    }
  }

  function archiveCurrentLinks() {
    if (state.collectedLinks.length === 0) return;

    state.collectedLinks.forEach((url) => {
      const parsed = normalizeWhatsAppUrl(url);
      if (parsed) {
        archivedCodes.add(parsed.code);
        persistentSeenCodes.add(parsed.code);
        if (!state.archivedLinks.includes(url)) {
          state.archivedLinks.push(url);
        }
      }
    });

    state.collectedLinks = [];
    persistAllData();
    filterPosts();
    renderOverlayHTML();
  }

  function clearAllData(includeArchive = false) {
    if (includeArchive) {
      archivedCodes.clear();
      state.archivedLinks = [];
    }
    persistentSeenCodes.clear();
    state.archivedLinks.forEach((url) => {
      const parsed = normalizeWhatsAppUrl(url);
      if (parsed) persistentSeenCodes.add(parsed.code);
    });

    state.collectedLinks = [];
    persistAllData();
    filterPosts();
    renderOverlayHTML();
  }

  // --- 2. STREAMLINED HARVESTING ENGINE (START / PAUSE / RESUME / STOP & COPY) ---

  let stuckCounter = 0;
  let lastScrollHeight = 0;

  function checkEndOfResults() {
    const mainEl = document.querySelector('div[role="main"]') || document.querySelector('div[role="feed"]') || document.body;
    if (mainEl) {
      const text = mainEl.innerText || '';
      if (
        /end of results/i.test(text) ||
        /no more results/i.test(text) ||
        /you've reached the end/i.test(text)
      ) {
        return true;
      }
    }

    const isAtBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 150;
    const currentHeight = document.documentElement.scrollHeight;

    if (isAtBottom && currentHeight === lastScrollHeight) {
      stuckCounter++;
      if (stuckCounter >= 4) {
        return true;
      }
    } else {
      stuckCounter = 0;
      lastScrollHeight = currentHeight;
    }

    return false;
  }

  function performScrollStep() {
    if (!state.isAutoScrolling || state.isPaused) return;

    // When reaching the end of results, pause automatically
    if (checkEndOfResults()) {
      state.reachedEnd = true;
      pauseHarvesting();
      showFeedback('🏁 Reached End of Results (Paused)');
      return;
    }

    const scrollAmount = Math.floor(window.innerHeight * 0.85);
    window.scrollBy({
      top: scrollAmount,
      behavior: 'smooth',
    });

    setTimeout(() => {
      if (state.isAutoScrolling && !state.isPaused && checkEndOfResults()) {
        state.reachedEnd = true;
        pauseHarvesting();
        showFeedback('🏁 Reached End of Results (Paused)');
        return;
      }
    }, 600);

    const jitter = Math.floor(Math.random() * 300) - 150;
    const nextDelay = Math.max(1200, state.scrollIntervalMs + jitter);
    autoScrollTimer = setTimeout(performScrollStep, nextDelay);
  }

  function startHarvesting() {
    state.isAutoScrolling = true;
    state.isPaused = false;
    state.reachedEnd = false;
    stuckCounter = 0;
    lastScrollHeight = document.documentElement.scrollHeight;
    showFeedback('');
    renderOverlayHTML();
    performScrollStep();
  }

  function pauseHarvesting() {
    if (!state.isAutoScrolling) return;
    state.isPaused = true;
    if (autoScrollTimer) {
      clearTimeout(autoScrollTimer);
      autoScrollTimer = null;
    }
    renderOverlayHTML();
  }

  function resumeHarvesting() {
    if (!state.isAutoScrolling) {
      startHarvesting();
      return;
    }
    state.isPaused = false;
    state.reachedEnd = false;
    showFeedback('');
    renderOverlayHTML();
    performScrollStep();
    scheduleScan();
  }

  function stopAndCopy() {
    state.isAutoScrolling = false;
    state.isPaused = false;
    if (autoScrollTimer) {
      clearTimeout(autoScrollTimer);
      autoScrollTimer = null;
    }

    const countToCopy = state.collectedLinks.length;
    if (countToCopy > 0) {
      const sortedLinks = [...state.collectedLinks].sort((a, b) => a.localeCompare(b));
      const textToCopy = sortedLinks.join('\n');
      
      navigator.clipboard.writeText(textToCopy).then(() => {
        showFeedback(`✅ Stopped & Copied ${countToCopy} Links!`);
        archiveCurrentLinks();
      }).catch(() => {
        showFeedback(`✅ Stopped (${countToCopy} Links Ready)`);
        archiveCurrentLinks();
      });
    } else {
      showFeedback('⏹️ Stopped (No new links)');
      renderOverlayHTML();
    }
  }

  function showFeedback(text) {
    state.lastActionFeedback = text;
    renderOverlayHTML();
    if (text && text.startsWith('✅')) {
      setTimeout(() => {
        if (state.lastActionFeedback === text) {
          state.lastActionFeedback = '';
          renderOverlayHTML();
        }
      }, 4000);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) {
      return;
    }

    if (e.key === 'Escape' && state.isAutoScrolling) {
      stopAndCopy();
    } else if (e.key.toLowerCase() === 'p' && state.isAutoScrolling) {
      if (state.isPaused) {
        resumeHarvesting();
      } else {
        pauseHarvesting();
      }
    }
  });

  // --- 3. URL, GROUP & SEARCH QUERY DETECTION ---

  function extractUrlSearchQuery() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const rawQuery = urlParams.get('q') || '';
      return rawQuery.replace(/^["'](.*)["']$/, '$1').trim();
    } catch {
      return '';
    }
  }

  function isGenericWhatsAppQuery(query) {
    if (!query) return true;
    const q = query.toLowerCase().trim();
    const genericTerms = [
      'chat.whatsapp.com',
      'https://chat.whatsapp.com',
      'http://chat.whatsapp.com',
      'whatsapp.com',
      'whatsapp',
      'wa.me',
      'whatsapp group',
      'whatsapp groups',
      'whatsapp link',
      'whatsapp group link',
      'whatsapp group links',
      'chat whatsapp',
      'chat whatsapp com',
    ];
    return (
      genericTerms.includes(q) ||
      q.startsWith('chat.whatsapp.com') ||
      q.startsWith('https://chat.whatsapp.com') ||
      q.startsWith('http://chat.whatsapp.com') ||
      q.includes('chat.whatsapp.com') ||
      q === 'whatsapp group'
    );
  }

  function getEffectiveQuery() {
    if (state.customQuery && state.customQuery.trim().length > 0) {
      return state.customQuery.trim();
    }
    return extractUrlSearchQuery();
  }

  function normalizeText(text, isCaseSensitive) {
    if (!text) return '';
    let normalized = text.replace(/\s+/g, ' ').trim();
    if (!isCaseSensitive) {
      normalized = normalized.toLowerCase();
    }
    return normalized;
  }

  // --- 4. WHATSAPP LINK EXTRACTION & STRICT NORMALIZATION ---

  function normalizeWhatsAppUrl(rawStr) {
    if (!rawStr) return null;

    // Clean common Facebook wrappers, spaces or artifacts
    const cleaned = rawStr.replace(/[\s\r\n]+/g, '');

    const groupMatch = cleaned.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{10,32})/i);
    if (groupMatch && groupMatch[1]) {
      const code = groupMatch[1];
      return {
        code: code,
        url: `https://chat.whatsapp.com/${code}`,
      };
    }

    const waMatch = cleaned.match(/wa\.me\/(?:invite\/)?([a-zA-Z0-9_-]{10,32})/i);
    if (waMatch && waMatch[1] && isNaN(Number(waMatch[1]))) {
      const code = waMatch[1];
      return {
        code: code,
        url: `https://chat.whatsapp.com/${code}`,
      };
    }

    return null;
  }

  function extractFromHref(href) {
    if (!href) return '';
    let targetUrl = href;
    try {
      if (targetUrl.includes('l.facebook.com/l.php') || targetUrl.includes('/l.php?')) {
        const urlObj = new URL(targetUrl, window.location.origin);
        const u = urlObj.searchParams.get('u');
        if (u) {
          targetUrl = decodeURIComponent(u);
        }
      }
    } catch {
      const match = targetUrl.match(/[?&]u=([^&]+)/);
      if (match) {
        try {
          targetUrl = decodeURIComponent(match[1]);
        } catch {}
      }
    }
    return targetUrl;
  }

  function getAccessibleText(element) {
    let result = '';
    const labeledElements = element.querySelectorAll('[aria-label]');
    for (let i = 0; i < labeledElements.length; i++) {
      const label = labeledElements[i].getAttribute('aria-label');
      if (label) result += ' ' + label;
    }
    return result;
  }

  function extractNormalizedWhatsAppLinks(card) {
    const found = new Map();

    // 1. Scan all interactive elements & attributes (href, data-lynx-uri, data-href, aria-label, title)
    const elements = card.querySelectorAll('a, [data-lynx-uri], [data-href], [aria-label], [title]');
    elements.forEach((el) => {
      const rawValues = [
        el.getAttribute('href'),
        el.getAttribute('data-lynx-uri'),
        el.getAttribute('data-href'),
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
      ].filter(Boolean);

      for (const raw of rawValues) {
        const resolved = extractFromHref(raw);
        if (resolved) {
          const parsed = normalizeWhatsAppUrl(resolved);
          if (parsed) {
            found.set(parsed.code, parsed.url);
          }
        }
      }
    });

    // 2. Scan full card text (innerText + textContent + accessible text)
    const text = (card.innerText || '') + ' ' + (card.textContent || '') + ' ' + getAccessibleText(card);
    
    // Normalize potential obfuscation like "chat . whatsapp . com"
    const deobfuscated = text.replace(/chat\s*\.\s*whatsapp\s*\.\s*com\s*\/\s*(?:invite\/)?\s*([a-zA-Z0-9_-]{10,32})/gi, 'chat.whatsapp.com/$1');
    
    const groupRegex = /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{10,32})/gi;
    let match;
    while ((match = groupRegex.exec(deobfuscated)) !== null) {
      const parsed = normalizeWhatsAppUrl(match[0]);
      if (parsed) {
        found.set(parsed.code, parsed.url);
      }
    }

    const waRegex = /(?:https?:\/\/)?(?:www\.)?wa\.me\/(?:invite\/)?([a-zA-Z0-9_-]{10,32})/gi;
    let waMatch;
    while ((waMatch = waRegex.exec(deobfuscated)) !== null) {
      const parsed = normalizeWhatsAppUrl(waMatch[0]);
      if (parsed) {
        found.set(parsed.code, parsed.url);
      }
    }

    return Array.from(found.entries()).map(([code, url]) => ({ code, url }));
  }

  // --- 5. ROBUST DOM POST SELECTION & ACTIVELY FILTERING POSTS ---

  function findPostContainers() {
    // Strategy 1: Standard articles
    const articles = Array.from(document.querySelectorAll('div[role="article"]'));
    if (articles.length > 0) {
      return articles.filter((art) => !art.parentElement.closest('div[role="article"]'));
    }

    // Strategy 2: Group search results & feed unit pagelets
    const pagelets = Array.from(document.querySelectorAll('div[data-pagelet*="GroupSearchResults"], div[data-pagelet*="FeedUnit"], div[data-pagelet*="SearchResults"]'));
    if (pagelets.length > 0) {
      return pagelets;
    }

    // Strategy 3: Feed direct or secondary children
    const feed = document.querySelector('div[role="feed"]') || document.querySelector('div[role="main"]');
    if (feed) {
      const children = Array.from(feed.children);
      const validChildren = children.filter((child) => {
        return child.innerText && child.innerText.trim().length > 15 && child.getAttribute('role') !== 'navigation';
      });
      if (validChildren.length > 0) {
        return validChildren;
      }
      if (children.length === 1 && children[0].children.length > 1) {
        const subChildren = Array.from(children[0].children).filter((c) => {
          return c.innerText && c.innerText.trim().length > 15 && c.getAttribute('role') !== 'navigation';
        });
        if (subChildren.length > 0) {
          return subChildren;
        }
      }
    }

    return [];
  }

  function filterPosts() {
    state.activeQuery = getEffectiveQuery();
    ensureFilterOverlay();

    const posts = findPostContainers();
    const query = state.activeQuery;
    const isTopicFilter = query && !isGenericWhatsAppQuery(query);
    const normalizedTopicQuery = normalizeText(query, state.caseSensitive);

    let visibleCount = 0;
    let duplicateCount = 0;
    let nonWaCount = 0;
    let newlyDiscoveredLinks = 0;

    posts.forEach((post) => {
      if (!state.enabled) {
        post.classList.remove('quotefb-hidden');
        post.classList.remove('quotefb-matched');
        removeWABadges(post);
        visibleCount++;
        return;
      }

      // 1. WhatsApp Link Extraction
      const waLinks = extractNormalizedWhatsAppLinks(post);
      const hasWaLink = waLinks.length > 0;

      if (state.requireWhatsAppLink && !hasWaLink) {
        post.classList.add('quotefb-hidden');
        post.classList.remove('quotefb-matched');
        removeWABadges(post);
        nonWaCount++;
        return;
      }

      // 2. Specific Topic Filter (only if user provided a specific topic like "Crypto", not generic "chat.whatsapp.com")
      if (isTopicFilter) {
        const visibleText = post.innerText || post.textContent || '';
        const ariaText = getAccessibleText(post);
        const combinedText = visibleText + ' ' + ariaText;
        const normalizedPostText = normalizeText(combinedText, state.caseSensitive);

        if (!normalizedPostText.includes(normalizedTopicQuery)) {
          post.classList.add('quotefb-hidden');
          post.classList.remove('quotefb-matched');
          removeWABadges(post);
          nonWaCount++;
          return;
        }
      }

      // 3. Deduplication & Unseen check
      if (state.requireWhatsAppLink && state.onlyUniqueWhatsApp && hasWaLink) {
        const cardSeenCode = post.dataset.quotefbCode;
        const freshLinks = waLinks.filter((l) => !persistentSeenCodes.has(l.code));

        if (freshLinks.length === 0 && !cardSeenCode) {
          post.classList.add('quotefb-hidden');
          post.classList.remove('quotefb-matched');
          removeWABadges(post);
          duplicateCount++;
          return;
        }

        if (!state.isPaused) {
          freshLinks.forEach((l) => {
            persistentSeenCodes.add(l.code);
            state.collectedLinks.push(l.url);
            newlyDiscoveredLinks++;
          });
        }

        if (waLinks[0]) {
          post.dataset.quotefbCode = waLinks[0].code;
        }

        post.classList.remove('quotefb-hidden');
        post.classList.add('quotefb-matched');
        attachWABadges(post, waLinks);
        visibleCount++;
      } else {
        if (hasWaLink) {
          if (!state.isPaused) {
            waLinks.forEach((l) => {
              if (!persistentSeenCodes.has(l.code)) {
                persistentSeenCodes.add(l.code);
                state.collectedLinks.push(l.url);
                newlyDiscoveredLinks++;
              }
            });
          }
          attachWABadges(post, waLinks);
        }
        post.classList.remove('quotefb-hidden');
        post.classList.add('quotefb-matched');
        visibleCount++;
      }
    });

    state.currentVisibleOnScreen = visibleCount;
    state.currentDuplicatesOnScreen = duplicateCount;
    state.currentNonWAOnScreen = nonWaCount;

    if (newlyDiscoveredLinks > 0) {
      persistAllData();
    }

    updateOverlayUI();
  }

  function attachWABadges(post, links) {
    let container = post.querySelector('.quotefb-wa-badge-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'quotefb-wa-badge-container';
      post.prepend(container);
    }

    container.innerHTML = `
      <span class="quotefb-wa-label">WhatsApp Invite:</span>
      ${links
        .map(
          (l) =>
            `<a href="${l.url}" target="_blank" rel="noopener noreferrer" class="quotefb-wa-badge" title="Open Clean Group Invite">
              <span>💬</span> ${l.url.replace('https://chat.whatsapp.com/', '')} ↗
            </a>`
        )
        .join('')}
    `;
  }

  function removeWABadges(post) {
    const container = post.querySelector('.quotefb-wa-badge-container');
    if (container) container.remove();
  }

  function scheduleScan() {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => {
      filterPosts();
    }, 120);
  }

  // --- 6. FLOATING SHADOW DOM OVERLAY ---

  let rootContainer = null;
  let shadowRoot = null;

  function ensureFilterOverlay() {
    if (document.getElementById('quotefb-root')) return;

    rootContainer = document.createElement('div');
    rootContainer.id = 'quotefb-root';
    shadowRoot = rootContainer.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        color: #1c1e21;
        box-sizing: border-box;
      }
      *, *::before, *::after {
        box-sizing: border-box;
      }
      .panel {
        background: #ffffff;
        border-radius: 14px;
        box-shadow: 0 6px 28px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.08);
        width: 320px;
        overflow: hidden;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .panel.collapsed {
        width: 52px;
        height: 52px;
        border-radius: 26px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #25d366;
        color: white;
        box-shadow: 0 4px 18px rgba(37, 211, 102, 0.5);
        position: relative;
      }
      .panel.collapsed.autoscrolling {
        animation: pulse 1.5s infinite;
        background: #15803d;
      }
      .panel.collapsed.paused {
        background: #d97706;
        box-shadow: 0 4px 18px rgba(217, 119, 6, 0.5);
      }
      @keyframes pulse {
        0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.7); }
        70% { transform: scale(1.06); box-shadow: 0 0 0 12px rgba(37, 211, 102, 0); }
        100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(37, 211, 102, 0); }
      }
      .collapsed-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        background: #15803d;
        color: white;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 10px;
        border: 2px solid white;
      }
      .collapsed-icon {
        font-size: 24px;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: #f0fdf4;
        border-bottom: 1px solid #bbf7d0;
      }
      .header.paused-header {
        background: #fffbeb;
        border-color: #fde68a;
      }
      .title-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        color: #15803d;
        font-size: 13px;
      }
      .title-wrap.paused-title {
        color: #b45309;
      }
      .btn-icon {
        background: transparent;
        border: none;
        cursor: pointer;
        color: #65676b;
        font-size: 14px;
        padding: 4px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .btn-icon:hover {
        background: rgba(0, 0, 0, 0.06);
        color: #1c1e21;
      }
      .body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .collector-hero {
        background: #f0fdf4;
        border: 1px solid #86efac;
        border-radius: 10px;
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .collector-info {
        display: flex;
        flex-direction: column;
      }
      .collector-number {
        font-size: 22px;
        font-weight: 800;
        color: #15803d;
        line-height: 1.1;
      }
      .collector-label {
        font-size: 11px;
        font-weight: 600;
        color: #166534;
      }
      .archived-info {
        font-size: 10px;
        color: #65676b;
        margin-top: 2px;
      }
      .btn-clear {
        background: #fee2e2;
        color: #b91c1c;
        border: 1px solid #fca5a5;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 8px;
        cursor: pointer;
        transition: background 0.15s;
      }
      .btn-clear:hover {
        background: #fecaca;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 6px;
        text-align: center;
      }
      .stat-card {
        padding: 5px 3px;
        border-radius: 6px;
        background: #f7f8fa;
        border: 1px solid #e4e6eb;
      }
      .stat-value {
        font-size: 14px;
        font-weight: 700;
        color: #1c1e21;
      }
      .stat-card.visible-card .stat-value {
        color: #15803d;
      }
      .stat-card.duplicate-card .stat-value {
        color: #d97706;
      }
      .stat-card.hidden-card .stat-value {
        color: #8a8d91;
      }
      .stat-label {
        font-size: 9px;
        color: #65676b;
      }
      .feedback-banner {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 700;
        color: #1d4ed8;
        text-align: center;
      }
      .feedback-banner.success {
        background: #f0fdf4;
        border-color: #86efac;
        color: #15803d;
      }
      .actions-block {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .harvest-controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      .btn-harvest-action {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        border: none;
        border-radius: 8px;
        padding: 10px 10px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;
      }
      .btn-start-master {
        background: #0284c7;
        color: white;
        grid-column: span 2;
        box-shadow: 0 2px 6px rgba(2, 132, 199, 0.35);
      }
      .btn-start-master:hover {
        background: #0369a1;
      }
      .btn-pause-action {
        background: #d97706;
        color: white;
      }
      .btn-pause-action:hover {
        background: #b45309;
      }
      .btn-resume-action {
        background: #15803d;
        color: white;
      }
      .btn-resume-action:hover {
        background: #166534;
      }
      .btn-stop-action {
        background: #dc2626;
        color: white;
      }
      .btn-stop-action:hover {
        background: #b91c1c;
      }
      .controls-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 6px;
        border-top: 1px solid #e4e6eb;
      }
      .toggle-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        user-select: none;
      }
      .switch {
        position: relative;
        display: inline-block;
        width: 32px;
        height: 18px;
      }
      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .slider {
        position: absolute;
        cursor: pointer;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: #ccd0d5;
        transition: .2s;
        border-radius: 18px;
      }
      .slider:before {
        position: absolute;
        content: "";
        height: 12px;
        width: 12px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: .2s;
        border-radius: 50%;
      }
      input:checked + .slider {
        background-color: #25d366;
      }
      input:checked + .slider:before {
        transform: translateX(14px);
      }
      .toggle-label {
        font-size: 11px;
        font-weight: 600;
        color: #1c1e21;
      }
    `;

    shadowRoot.appendChild(style);

    const container = document.createElement('div');
    container.id = 'panel-container';
    shadowRoot.appendChild(container);

    document.body.appendChild(rootContainer);
    renderOverlayHTML();
  }

  function renderOverlayHTML() {
    if (!shadowRoot) return;
    const container = shadowRoot.getElementById('panel-container');
    if (!container) return;

    const newLinkCount = state.collectedLinks.length;
    const archivedCount = state.archivedLinks.length;

    let statusTitle = '💬 QuoteFB WA Collector';
    let isPausedClass = '';
    let isScrollingClass = '';

    if (state.isAutoScrolling) {
      if (state.isPaused) {
        statusTitle = '⏸️ Harvesting Paused';
        isPausedClass = 'paused';
      } else {
        statusTitle = '⚡ Auto-Harvesting Active';
        isScrollingClass = 'autoscrolling';
      }
    }

    if (state.widgetCollapsed) {
      container.innerHTML = `
        <div class="panel collapsed ${isScrollingClass} ${isPausedClass}" id="btn-expand" title="QuoteFB: Click to expand">
          <span class="collapsed-icon">${state.isPaused ? '⏸️' : state.isAutoScrolling ? '⚡' : '💬'}</span>
          ${newLinkCount > 0 ? `<span class="collapsed-badge">${newLinkCount}</span>` : ''}
        </div>
      `;
      shadowRoot.getElementById('btn-expand')?.addEventListener('click', () => {
        state.widgetCollapsed = false;
        saveSettings({ widgetCollapsed: false });
        renderOverlayHTML();
      });
      return;
    }

    container.innerHTML = `
      <div class="panel">
        <div class="header ${state.isPaused ? 'paused-header' : ''}">
          <div class="title-wrap ${state.isPaused ? 'paused-title' : ''}">
            <span>${statusTitle}</span>
          </div>
          <button class="btn-icon" id="btn-collapse" title="Minimize">─</button>
        </div>
        <div class="body">
          <div class="collector-hero">
            <div class="collector-info">
              <span class="collector-number" id="val-total-collected">${newLinkCount}</span>
              <span class="collector-label">New Unique Links</span>
              <span class="archived-info" id="val-archived-info">📦 ${archivedCount} previously copied</span>
            </div>
            ${
              newLinkCount > 0
                ? `<button class="btn-clear" id="btn-clear-links" title="Clear current new links">Clear</button>`
                : ''
            }
          </div>
          
          <div class="stats-grid">
            <div class="stat-card visible-card">
              <div class="stat-value" id="val-visible">${state.currentVisibleOnScreen}</div>
              <div class="stat-label">On Screen</div>
            </div>
            <div class="stat-card duplicate-card">
              <div class="stat-value" id="val-duplicate">${state.currentDuplicatesOnScreen}</div>
              <div class="stat-label">Dupes Blocked</div>
            </div>
            <div class="stat-card hidden-card">
              <div class="stat-value" id="val-nonmatching">${state.currentNonWAOnScreen}</div>
              <div class="stat-label">Non-WA Blocked</div>
            </div>
          </div>

          ${
            state.lastActionFeedback
              ? `<div class="feedback-banner ${state.lastActionFeedback.startsWith('✅') ? 'success' : ''}">
                  ${state.lastActionFeedback}
                </div>`
              : ''
          }
          
          <div class="actions-block">
            <div class="harvest-controls">
              ${
                !state.isAutoScrolling
                  ? `<button class="btn-harvest-action btn-start-master" id="btn-start-harvest">
                      ▶️ Start Harvesting
                    </button>`
                  : state.isPaused
                  ? `<button class="btn-harvest-action btn-resume-action" id="btn-resume-harvest">
                      ▶️ Resume (P)
                    </button>
                    <button class="btn-harvest-action btn-stop-action" id="btn-stop-harvest">
                      ⏹️ Stop & Copy (Esc)
                    </button>`
                  : `<button class="btn-harvest-action btn-pause-action" id="btn-pause-harvest">
                      ⏸️ Pause (P)
                    </button>
                    <button class="btn-harvest-action btn-stop-action" id="btn-stop-harvest">
                      ⏹️ Stop & Copy (Esc)
                    </button>`
              }
            </div>
          </div>

          <div class="controls-row">
            <label class="toggle-wrap" title="Toggle WhatsApp Filter (hides non-WA posts)">
              <span class="switch">
                <input type="checkbox" id="toggle-filter" ${state.enabled ? 'checked' : ''}>
                <span class="slider"></span>
              </span>
              <span class="toggle-label">Filter Active</span>
            </label>

            <label class="toggle-wrap" title="Hides duplicates and previously copied links">
              <span class="switch">
                <input type="checkbox" id="toggle-unique" ${state.onlyUniqueWhatsApp ? 'checked' : ''}>
                <span class="slider"></span>
              </span>
              <span class="toggle-label">Unique Only</span>
            </label>
          </div>
        </div>
      </div>
    `;

    shadowRoot.getElementById('btn-collapse')?.addEventListener('click', () => {
      state.widgetCollapsed = true;
      saveSettings({ widgetCollapsed: true });
      renderOverlayHTML();
    });

    shadowRoot.getElementById('btn-start-harvest')?.addEventListener('click', () => {
      startHarvesting();
    });

    shadowRoot.getElementById('btn-pause-harvest')?.addEventListener('click', () => {
      pauseHarvesting();
    });

    shadowRoot.getElementById('btn-resume-harvest')?.addEventListener('click', () => {
      resumeHarvesting();
    });

    shadowRoot.getElementById('btn-stop-harvest')?.addEventListener('click', () => {
      stopAndCopy();
    });

    shadowRoot.getElementById('toggle-filter')?.addEventListener('change', (e) => {
      state.enabled = e.target.checked;
      saveSettings({ enabled: state.enabled });
      filterPosts();
    });

    shadowRoot.getElementById('toggle-unique')?.addEventListener('change', (e) => {
      state.onlyUniqueWhatsApp = e.target.checked;
      saveSettings({ onlyUniqueWhatsApp: state.onlyUniqueWhatsApp });
      filterPosts();
    });

    shadowRoot.getElementById('btn-clear-links')?.addEventListener('click', () => {
      clearAllData(false);
      showFeedback('🗑️ Cleared new links queue');
    });
  }

  function updateOverlayUI() {
    if (!shadowRoot) return;

    if (state.widgetCollapsed) {
      renderOverlayHTML();
      return;
    }

    const totalCollectedEl = shadowRoot.getElementById('val-total-collected');
    const archivedInfoEl = shadowRoot.getElementById('val-archived-info');
    const visibleEl = shadowRoot.getElementById('val-visible');
    const duplicateEl = shadowRoot.getElementById('val-duplicate');
    const nonmatchingEl = shadowRoot.getElementById('val-nonmatching');

    const newLinkCount = state.collectedLinks.length;
    const archivedCount = state.archivedLinks.length;

    if (totalCollectedEl) totalCollectedEl.textContent = newLinkCount;
    if (archivedInfoEl) archivedInfoEl.textContent = `📦 ${archivedCount} previously copied`;
    if (visibleEl) visibleEl.textContent = state.currentVisibleOnScreen;
    if (duplicateEl) duplicateEl.textContent = state.currentDuplicatesOnScreen;
    if (nonmatchingEl) nonmatchingEl.textContent = state.currentNonWAOnScreen;
  }

  // --- 7. OBSERVERS, STORAGE SYNC & SPA ROUTING LISTENERS ---

  function setupMutationObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      if (window.location.href !== currentUrl) {
        handleUrlTransition();
        return;
      }
      scheduleScan();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function handleUrlTransition() {
    currentUrl = window.location.href;
    state.reachedEnd = false;
    stuckCounter = 0;
    lastScrollHeight = 0;
    
    loadPersistentData(() => {
      ensureFilterOverlay();
      renderOverlayHTML();
      scheduleScan();
    });
  }

  function setupHistoryListener() {
    window.addEventListener('popstate', handleUrlTransition);

    const originalPushState = history.pushState;
    history.pushState = function () {
      originalPushState.apply(this, arguments);
      handleUrlTransition();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
      originalReplaceState.apply(this, arguments);
      handleUrlTransition();
    };

    setInterval(() => {
      if (window.location.href !== currentUrl) {
        handleUrlTransition();
      }
    }, 1000);
  }

  // Sync when storage changes from popup or another tab
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        let needsReRender = false;
        if (changes[STORAGE_LINKS_KEY]) {
          state.collectedLinks = changes[STORAGE_LINKS_KEY].newValue || [];
          needsReRender = true;
        }
        if (changes[STORAGE_ARCHIVED_KEY]) {
          state.archivedLinks = changes[STORAGE_ARCHIVED_KEY].newValue || [];
          archivedCodes.clear();
          state.archivedLinks.forEach((url) => {
            const parsed = normalizeWhatsAppUrl(url);
            if (parsed) archivedCodes.add(parsed.code);
          });
          needsReRender = true;
        }
        if (needsReRender) {
          updateOverlayUI();
        }
      }
    });
  }

  // --- 8. MESSAGING (POPUP INTERACTION) ---

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_STATUS') {
        state.activeQuery = getEffectiveQuery();
        sendResponse({
          ...state,
        });
      } else if (message.type === 'UPDATE_SETTINGS') {
        if (message.settings.enabled !== undefined) state.enabled = message.settings.enabled;
        if (message.settings.requireWhatsAppLink !== undefined) state.requireWhatsAppLink = message.settings.requireWhatsAppLink;
        if (message.settings.onlyUniqueWhatsApp !== undefined) state.onlyUniqueWhatsApp = message.settings.onlyUniqueWhatsApp;
        if (message.settings.caseSensitive !== undefined) state.caseSensitive = message.settings.caseSensitive;
        if (message.settings.customQuery !== undefined) state.customQuery = message.settings.customQuery;

        saveSettings(message.settings);
        renderOverlayHTML();
        filterPosts();
        sendResponse({ success: true, ...state });
      } else if (message.type === 'START_HARVEST') {
        startHarvesting();
        sendResponse({ success: true, ...state });
      } else if (message.type === 'PAUSE_HARVEST') {
        pauseHarvesting();
        sendResponse({ success: true, ...state });
      } else if (message.type === 'RESUME_HARVEST') {
        resumeHarvesting();
        sendResponse({ success: true, ...state });
      } else if (message.type === 'STOP_AND_COPY') {
        stopAndCopy();
        sendResponse({ success: true, ...state });
      } else if (message.type === 'CLEAR_CURRENT') {
        clearAllData(false);
        sendResponse({ success: true, ...state });
      } else if (message.type === 'CLEAR_ALL_HISTORY') {
        clearAllData(true);
        sendResponse({ success: true, ...state });
      }
      return true;
    });
  }

  // --- 9. INITIALIZATION ---

  loadPersistentData(() => {
    ensureFilterOverlay();
    setupHistoryListener();
    setupMutationObserver();
    scheduleScan();
  });
})();
