// QuoteFB - Facebook Persistent Unique WhatsApp Group Invite Filter with Auto-Scroll
// Content Script (Manifest V3)

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__QUOTE_FB_LOADED__) return;
  window.__QUOTE_FB_LOADED__ = true;

  // Global persistent storage keys
  const STORAGE_LINKS_KEY = 'quotefb_collected_links';

  // In-memory state
  const state = {
    enabled: true,
    requireWhatsAppLink: true,
    onlyUniqueWhatsApp: true,
    caseSensitive: false,
    customQuery: '',
    widgetCollapsed: false,
    activeQuery: '',
    
    // Auto-Scroll state
    isAutoScrolling: false,
    scrollIntervalMs: 1800, // Balanced interval to allow Facebook GraphQL feed fetch
    
    // Counters
    currentVisibleOnScreen: 0,
    currentDuplicatesOnScreen: 0,
    currentNonWAOnScreen: 0,
    
    // Persistent collected unique links across the entire scrolling/browsing session
    collectedLinks: [], // Array of normalized string URLs: ['https://chat.whatsapp.com/...']
    isSearchPage: false,
  };

  // Set of codes for fast O(1) deduplication
  const persistentSeenCodes = new Set();

  let scanDebounceTimer = null;
  let observer = null;
  let currentUrl = window.location.href;
  let autoScrollTimer = null;

  // --- 1. SETTINGS & PERSISTENT STORAGE ---

  function loadPersistentData(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(
        ['enabled', 'requireWhatsAppLink', 'onlyUniqueWhatsApp', 'caseSensitive', 'customQuery', 'widgetCollapsed', STORAGE_LINKS_KEY],
        (items) => {
          if (items.enabled !== undefined) state.enabled = items.enabled;
          if (items.requireWhatsAppLink !== undefined) state.requireWhatsAppLink = items.requireWhatsAppLink;
          if (items.onlyUniqueWhatsApp !== undefined) state.onlyUniqueWhatsApp = items.onlyUniqueWhatsApp;
          if (items.caseSensitive !== undefined) state.caseSensitive = items.caseSensitive;
          if (items.customQuery !== undefined) state.customQuery = items.customQuery;
          if (items.widgetCollapsed !== undefined) state.widgetCollapsed = items.widgetCollapsed;

          if (Array.isArray(items[STORAGE_LINKS_KEY])) {
            state.collectedLinks = items[STORAGE_LINKS_KEY];
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

  function persistCollectedLinks() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [STORAGE_LINKS_KEY]: state.collectedLinks });
    }
  }

  function clearAllCollectedLinks() {
    persistentSeenCodes.clear();
    state.collectedLinks = [];
    persistCollectedLinks();
    filterPosts();
    renderOverlayHTML();
  }

  // --- 2. AUTO-SCROLL ENGINE & END OF RESULTS DETECTION ---

  let stuckCounter = 0;
  let lastScrollHeight = 0;

  function checkEndOfResults() {
    // 1. Text-based detection for Facebook's end-of-feed markers
    const mainEl = document.querySelector('div[role="main"]') || document.querySelector('div[role="feed"]') || document.body;
    if (mainEl) {
      const text = mainEl.innerText || '';
      // Common Facebook search termination phrases
      if (
        /end of results/i.test(text) ||
        /no more results/i.test(text) ||
        /you've reached the end/i.test(text)
      ) {
        return true;
      }
    }

    // 2. Physical scroll bottom detection (stuck at bottom with no new content loading)
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

  function startAutoScroll() {
    if (state.isAutoScrolling) return;
    state.isAutoScrolling = true;
    stuckCounter = 0;
    lastScrollHeight = document.documentElement.scrollHeight;
    state.reachedEnd = false;
    renderOverlayHTML();

    function performScrollStep() {
      if (!state.isAutoScrolling) return;

      // Check if End of Results has been reached
      if (checkEndOfResults()) {
        state.reachedEnd = true;
        stopAutoScroll();
        updateOverlayUI();
        return;
      }

      // Scroll smoothly down the page
      const scrollAmount = Math.floor(window.innerHeight * 0.85);
      window.scrollBy({
        top: scrollAmount,
        behavior: 'smooth',
      });

      // Check again after scrolling
      setTimeout(() => {
        if (state.isAutoScrolling && checkEndOfResults()) {
          state.reachedEnd = true;
          stopAutoScroll();
          updateOverlayUI();
          return;
        }
      }, 600);

      // Schedule next scroll step with a small natural jitter
      const jitter = Math.floor(Math.random() * 300) - 150;
      const nextDelay = Math.max(1200, state.scrollIntervalMs + jitter);
      autoScrollTimer = setTimeout(performScrollStep, nextDelay);
    }

    performScrollStep();
  }

  function stopAutoScroll() {
    state.isAutoScrolling = false;
    if (autoScrollTimer) {
      clearTimeout(autoScrollTimer);
      autoScrollTimer = null;
    }
    renderOverlayHTML();
  }

  function toggleAutoScroll() {
    if (state.isAutoScrolling) {
      stopAutoScroll();
    } else {
      startAutoScroll();
    }
  }

  // Stop auto-scroll on Escape key press
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isAutoScrolling) {
      stopAutoScroll();
    }
  });

  // --- 3. URL & SEARCH QUERY DETECTION ---

  function checkIsSearchPage() {
    return window.location.pathname.startsWith('/search') || window.location.pathname.includes('/search/');
  }

  function extractUrlSearchQuery() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const rawQuery = urlParams.get('q') || '';
      return rawQuery.replace(/^["'](.*)["']$/, '$1').trim();
    } catch {
      return '';
    }
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

    // 1. Group Invite regex: chat.whatsapp.com/(invite/)?<code...>
    const groupMatch = rawStr.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{10,32})/i);
    if (groupMatch && groupMatch[1]) {
      const code = groupMatch[1];
      return {
        code: code,
        url: `https://chat.whatsapp.com/${code}`, // Strictly normalized without any query parameters
      };
    }

    // 2. wa.me short link invite: wa.me/(invite/)?<code...>
    const waMatch = rawStr.match(/wa\.me\/(?:invite\/)?([a-zA-Z0-9_-]{10,32})/i);
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
    if (href.includes('l.facebook.com/l.php')) {
      try {
        const parsed = new URL(href, window.location.origin);
        const u = parsed.searchParams.get('u');
        if (u) targetUrl = decodeURIComponent(u);
      } catch {
        // use raw href
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

    const anchors = card.querySelectorAll('a[href]');
    anchors.forEach((a) => {
      const rawHref = a.getAttribute('href') || '';
      const resolved = extractFromHref(rawHref);
      if (resolved) {
        const parsed = normalizeWhatsAppUrl(resolved);
        if (parsed) {
          found.set(parsed.code, parsed.url);
        }
      }
    });

    const text = (card.innerText || '') + ' ' + (card.textContent || '') + ' ' + getAccessibleText(card);
    const regex = /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{10,32})/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const parsed = normalizeWhatsAppUrl(match[0]);
      if (parsed) {
        found.set(parsed.code, parsed.url);
      }
    }

    return Array.from(found.entries()).map(([code, url]) => ({ code, url }));
  }

  // --- 5. DOM POST SELECTION & FILTERING ---

  function findPostContainers() {
    const articles = Array.from(document.querySelectorAll('div[role="article"]'));
    if (articles.length > 0) {
      return articles.filter((art) => !art.parentElement.closest('div[role="article"]'));
    }

    const feed = document.querySelector('div[role="feed"]') || document.querySelector('div[role="main"]');
    if (feed) {
      const children = Array.from(feed.children);
      return children.filter((child) => {
        return child.innerText && child.innerText.trim().length > 15 && child.getAttribute('role') !== 'navigation';
      });
    }

    return [];
  }

  function filterPosts() {
    state.isSearchPage = checkIsSearchPage();
    state.activeQuery = getEffectiveQuery();

    if (!state.isSearchPage) {
      if (state.isAutoScrolling) stopAutoScroll();
      removeFilterOverlay();
      return;
    }

    ensureFilterOverlay();

    const posts = findPostContainers();
    const query = state.activeQuery;
    const normalizedQuery = normalizeText(query, state.caseSensitive);

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

      const waLinks = extractNormalizedWhatsAppLinks(post);
      const hasWaLink = waLinks.length > 0;

      if (state.requireWhatsAppLink && !hasWaLink) {
        post.classList.add('quotefb-hidden');
        post.classList.remove('quotefb-matched');
        removeWABadges(post);
        nonWaCount++;
        return;
      }

      if (normalizedQuery) {
        const visibleText = post.innerText || post.textContent || '';
        const ariaText = getAccessibleText(post);
        const combinedText = visibleText + ' ' + ariaText;
        const normalizedPostText = normalizeText(combinedText, state.caseSensitive);

        if (!normalizedPostText.includes(normalizedQuery)) {
          post.classList.add('quotefb-hidden');
          post.classList.remove('quotefb-matched');
          removeWABadges(post);
          nonWaCount++;
          return;
        }
      }

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

        freshLinks.forEach((l) => {
          persistentSeenCodes.add(l.code);
          state.collectedLinks.push(l.url);
          newlyDiscoveredLinks++;
        });

        if (waLinks[0]) {
          post.dataset.quotefbCode = waLinks[0].code;
        }

        post.classList.remove('quotefb-hidden');
        post.classList.add('quotefb-matched');
        attachWABadges(post, waLinks);
        visibleCount++;
      } else {
        if (hasWaLink) {
          waLinks.forEach((l) => {
            if (!persistentSeenCodes.has(l.code)) {
              persistentSeenCodes.add(l.code);
              state.collectedLinks.push(l.url);
              newlyDiscoveredLinks++;
            }
          });
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
      persistCollectedLinks();
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
      .title-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        color: #15803d;
        font-size: 13px;
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
      .actions-block {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .btn-autoscroll {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        background: #0284c7;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 9px 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;
      }
      .btn-autoscroll:hover {
        background: #0369a1;
      }
      .btn-autoscroll.active {
        background: #ea580c;
        animation: activeGlow 1.2s infinite alternate;
      }
      @keyframes activeGlow {
        from { box-shadow: 0 0 5px #ea580c; }
        to { box-shadow: 0 0 14px #ea580c; }
      }
      .btn-copy-main {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        background: #25d366;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 9px 12px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(37, 211, 102, 0.35);
        transition: all 0.15s;
      }
      .btn-copy-main:hover {
        background: #1eb956;
      }
      .btn-copy-main:disabled {
        background: #e4e6eb;
        color: #8a8d91;
        box-shadow: none;
        cursor: not-allowed;
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

  function removeFilterOverlay() {
    const el = document.getElementById('quotefb-root');
    if (el) el.remove();
    rootContainer = null;
    shadowRoot = null;
  }

  function renderOverlayHTML() {
    if (!shadowRoot) return;
    const container = shadowRoot.getElementById('panel-container');
    if (!container) return;

    const linkCount = state.collectedLinks.length;

    if (state.widgetCollapsed) {
      container.innerHTML = `
        <div class="panel collapsed ${state.isAutoScrolling ? 'autoscrolling' : ''}" id="btn-expand" title="QuoteFB: Click to expand">
          <span class="collapsed-icon">${state.isAutoScrolling ? '⚡' : '💬'}</span>
          ${linkCount > 0 ? `<span class="collapsed-badge">${linkCount}</span>` : ''}
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
        <div class="header">
          <div class="title-wrap">
            <span>${state.isAutoScrolling ? '⚡ Auto-Scrolling Active' : '💬 QuoteFB WA Collector'}</span>
          </div>
          <button class="btn-icon" id="btn-collapse" title="Minimize">─</button>
        </div>
        <div class="body">
          <div class="collector-hero">
            <div class="collector-info">
              <span class="collector-number" id="val-total-collected">${linkCount}</span>
              <span class="collector-label">Unique Normalized Links</span>
            </div>
            ${
              linkCount > 0
                ? `<button class="btn-clear" id="btn-clear-links" title="Clear collected links and start fresh">Reset</button>`
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
            state.reachedEnd
              ? `<div style="background: #fef3c7; border: 1px solid #fde047; border-radius: 8px; padding: 6px 10px; font-size: 11px; font-weight: 700; color: #b45309; text-align: center;">
                  🏁 Reached "End of Results"
                </div>`
              : ''
          }
          
          <div class="actions-block">
            <button class="btn-autoscroll ${state.isAutoScrolling ? 'active' : ''}" id="btn-autoscroll-toggle">
              ${state.isAutoScrolling ? '⏹️ Stop Auto-Scroll (Esc)' : '▶️ Auto-Scroll & Grab Links'}
            </button>

            <button class="btn-copy-main" id="btn-copy-links" ${linkCount === 0 ? 'disabled' : ''}>
              📋 Copy All ${linkCount} Clean Link${linkCount === 1 ? '' : 's'}
            </button>
          </div>

          <div class="controls-row">
            <label class="toggle-wrap" title="Toggle WhatsApp Filter">
              <span class="switch">
                <input type="checkbox" id="toggle-filter" ${state.enabled ? 'checked' : ''}>
                <span class="slider"></span>
              </span>
              <span class="toggle-label">Filter Active</span>
            </label>

            <label class="toggle-wrap" title="Only keep first post per unique group link">
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

    shadowRoot.getElementById('btn-autoscroll-toggle')?.addEventListener('click', () => {
      toggleAutoScroll();
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
      if (confirm('Clear all collected WhatsApp links?')) {
        clearAllCollectedLinks();
      }
    });

    shadowRoot.getElementById('btn-copy-links')?.addEventListener('click', () => {
      if (state.collectedLinks.length === 0) return;
      // Sorted alphabetically, line by line
      const sortedLinks = [...state.collectedLinks].sort((a, b) => a.localeCompare(b));
      const textToCopy = sortedLinks.join('\n');
      navigator.clipboard.writeText(textToCopy).then(() => {
        const btn = shadowRoot.getElementById('btn-copy-links');
        if (btn) {
          const orig = btn.innerHTML;
          btn.innerHTML = '✅ Copied to Clipboard!';
          setTimeout(() => {
            if (btn) btn.innerHTML = orig;
          }, 2000);
        }
      });
    });
  }

  function updateOverlayUI() {
    if (!shadowRoot) return;

    if (state.widgetCollapsed) {
      renderOverlayHTML();
      return;
    }

    const totalCollectedEl = shadowRoot.getElementById('val-total-collected');
    const visibleEl = shadowRoot.getElementById('val-visible');
    const duplicateEl = shadowRoot.getElementById('val-duplicate');
    const nonmatchingEl = shadowRoot.getElementById('val-nonmatching');
    const copyBtn = shadowRoot.getElementById('btn-copy-links');
    const autoScrollBtn = shadowRoot.getElementById('btn-autoscroll-toggle');

    const linkCount = state.collectedLinks.length;

    if (totalCollectedEl) totalCollectedEl.textContent = linkCount;
    if (visibleEl) visibleEl.textContent = state.currentVisibleOnScreen;
    if (duplicateEl) duplicateEl.textContent = state.currentDuplicatesOnScreen;
    if (nonmatchingEl) nonmatchingEl.textContent = state.currentNonWAOnScreen;

    if (copyBtn) {
      copyBtn.disabled = linkCount === 0;
      copyBtn.textContent = `📋 Copy All ${linkCount} Clean Link${linkCount === 1 ? '' : 's'}`;
    }

    if (autoScrollBtn) {
      autoScrollBtn.className = `btn-autoscroll ${state.isAutoScrolling ? 'active' : ''}`;
      autoScrollBtn.textContent = state.isAutoScrolling ? '⏹️ Stop Auto-Scroll (Esc)' : '▶️ Auto-Scroll & Grab Links';
    }
  }

  // --- 7. OBSERVERS & SPA ROUTING LISTENERS ---

  function setupMutationObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        scheduleScan();
        return;
      }
      scheduleScan();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function setupHistoryListener() {
    const handleUrlChange = () => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        renderOverlayHTML();
        scheduleScan();
      }
    };

    window.addEventListener('popstate', handleUrlChange);

    const originalPushState = history.pushState;
    history.pushState = function () {
      originalPushState.apply(this, arguments);
      handleUrlChange();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
      originalReplaceState.apply(this, arguments);
      handleUrlChange();
    };

    setInterval(handleUrlChange, 1000);
  }

  // --- 8. MESSAGING (POPUP INTERACTION) ---

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_STATUS') {
        state.isSearchPage = checkIsSearchPage();
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
      } else if (message.type === 'TOGGLE_AUTOSCROLL') {
        toggleAutoScroll();
        sendResponse({ success: true, ...state });
      } else if (message.type === 'CLEAR_LINKS') {
        clearAllCollectedLinks();
        sendResponse({ success: true, ...state });
      }
      return true;
    });
  }

  // --- 9. INITIALIZATION ---

  loadPersistentData(() => {
    setupHistoryListener();
    setupMutationObserver();
    scheduleScan();
  });
})();
