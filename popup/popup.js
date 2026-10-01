// QuoteFB Popup Logic - Persistent WhatsApp Collector with Auto-Scroll

document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const customQueryInput = document.getElementById('custom-query-input');
  const btnClearQuery = document.getElementById('btn-clear-query');
  
  const countTotalCollected = document.getElementById('count-total-collected');
  const countVisible = document.getElementById('count-visible');
  const countDuplicate = document.getElementById('count-duplicate');
  const countNonWA = document.getElementById('count-nonwa');
  
  const btnToggleAutoscroll = document.getElementById('btn-toggle-autoscroll');
  const btnCopyLinks = document.getElementById('btn-copy-links');
  const btnExportTxt = document.getElementById('btn-export-txt');
  const btnResetLinks = document.getElementById('btn-reset-links');
  
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleRequireWA = document.getElementById('toggle-require-wa');
  const toggleUnique = document.getElementById('toggle-unique');
  const queryHelper = document.getElementById('query-helper');

  let activeTabId = null;
  let cachedCollectedLinks = [];
  let isAutoScrolling = false;

  // 1. Query active tab
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tab = tabs[0];
        activeTabId = tab.id;
        const url = tab.url || '';

        if (url.includes('facebook.com')) {
          if (url.includes('/search')) {
            statusBadge.classList.add('active');
            statusText.textContent = 'Active on Search';
          } else {
            statusText.textContent = 'On Facebook';
          }

          chrome.tabs.sendMessage(activeTabId, { type: 'GET_STATUS' }, (response) => {
            if (chrome.runtime.lastError || !response) {
              loadFromStorage();
            } else {
              applyStateToUI(response);
            }
          });
        } else {
          statusText.textContent = 'Not Facebook';
          loadFromStorage();
        }
      }
    });
  } else {
    loadFromStorage();
  }

  function loadFromStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(
        ['enabled', 'requireWhatsAppLink', 'onlyUniqueWhatsApp', 'customQuery', 'quotefb_collected_links'],
        (items) => {
          if (items.enabled !== undefined) toggleEnabled.checked = items.enabled;
          if (items.requireWhatsAppLink !== undefined) toggleRequireWA.checked = items.requireWhatsAppLink;
          if (items.onlyUniqueWhatsApp !== undefined) toggleUnique.checked = items.onlyUniqueWhatsApp;
          if (items.customQuery) {
            customQueryInput.value = items.customQuery;
            queryHelper.textContent = 'Keyword filter active: "' + items.customQuery + '"';
          }

          if (Array.isArray(items.quotefb_collected_links)) {
            cachedCollectedLinks = items.quotefb_collected_links;
            updateButtonsAndCount(cachedCollectedLinks.length);
          }
        }
      );
    }
  }

  function updateButtonsAndCount(count) {
    countTotalCollected.textContent = count;
    btnCopyLinks.disabled = count === 0;
    btnExportTxt.disabled = count === 0;
    btnCopyLinks.textContent = count > 0 ? `📋 Copy ${count} Clean Link${count === 1 ? '' : 's'}` : '📋 Copy All Clean Links';
  }

  function applyStateToUI(state) {
    toggleEnabled.checked = Boolean(state.enabled);
    if (toggleRequireWA) toggleRequireWA.checked = state.requireWhatsAppLink !== false;
    if (toggleUnique) toggleUnique.checked = state.onlyUniqueWhatsApp !== false;

    countVisible.textContent = state.currentVisibleOnScreen ?? 0;
    countDuplicate.textContent = state.currentDuplicatesOnScreen ?? 0;
    countNonWA.textContent = state.currentNonWAOnScreen ?? 0;

    cachedCollectedLinks = state.collectedLinks || [];
    updateButtonsAndCount(cachedCollectedLinks.length);

    isAutoScrolling = Boolean(state.isAutoScrolling);
    if (state.reachedEnd) {
      statusBadge.className = 'status-indicator';
      statusBadge.style.background = '#fef3c7';
      statusBadge.style.color = '#b45309';
      statusText.textContent = '🏁 Reached End of Results';
    } else if (isAutoScrolling) {
      statusBadge.className = 'status-indicator active';
      statusText.textContent = '⚡ Auto-Scrolling...';
    }

    if (isAutoScrolling) {
      btnToggleAutoscroll.className = 'btn-autoscroll-main active';
      btnToggleAutoscroll.textContent = '⏹️ Stop Auto-Scroll (Active)';
    } else {
      btnToggleAutoscroll.className = 'btn-autoscroll-main';
      btnToggleAutoscroll.textContent = '▶️ Start Auto-Scroll & Collect';
    }

    if (state.customQuery) {
      customQueryInput.value = state.customQuery;
      queryHelper.textContent = 'Keyword filter active: "' + state.customQuery + '"';
    } else if (state.activeQuery) {
      customQueryInput.value = state.activeQuery;
      queryHelper.textContent = 'Auto-detected keyword from URL: "' + state.activeQuery + '"';
    } else {
      customQueryInput.placeholder = 'e.g. Crypto, Jobs, Real Estate...';
      queryHelper.textContent = 'Leave empty to collect all WhatsApp groups';
    }
  }

  function updateSettings(newSettings) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(newSettings);
    }

    if (activeTabId && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.sendMessage(
        activeTabId,
        { type: 'UPDATE_SETTINGS', settings: newSettings },
        (res) => {
          if (res) {
            applyStateToUI(res);
          }
        }
      );
    }
  }

  // Event Listeners
  btnToggleAutoscroll.addEventListener('click', () => {
    if (activeTabId && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.sendMessage(activeTabId, { type: 'TOGGLE_AUTOSCROLL' }, (res) => {
        if (res) applyStateToUI(res);
      });
    }
  });

  toggleEnabled.addEventListener('change', () => {
    updateSettings({ enabled: toggleEnabled.checked });
  });

  toggleRequireWA.addEventListener('change', () => {
    updateSettings({ requireWhatsAppLink: toggleRequireWA.checked });
  });

  toggleUnique.addEventListener('change', () => {
    updateSettings({ onlyUniqueWhatsApp: toggleUnique.checked });
  });

  let inputDebounce = null;
  customQueryInput.addEventListener('input', () => {
    if (inputDebounce) clearTimeout(inputDebounce);
    inputDebounce = setTimeout(() => {
      const val = customQueryInput.value.trim();
      updateSettings({ customQuery: val });
      queryHelper.textContent = val ? `Keyword filter active: "${val}"` : 'Leave empty to collect all WhatsApp groups';
    }, 300);
  });

  btnClearQuery.addEventListener('click', () => {
    customQueryInput.value = '';
    queryHelper.textContent = 'Leave empty to collect all WhatsApp groups';
    updateSettings({ customQuery: '' });
  });

  btnCopyLinks.addEventListener('click', () => {
    if (cachedCollectedLinks.length === 0) return;
    // Sorted alphabetically, line by line
    const sortedLinks = [...cachedCollectedLinks].sort((a, b) => a.localeCompare(b));
    const textToCopy = sortedLinks.join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
      const orig = btnCopyLinks.textContent;
      btnCopyLinks.textContent = '✅ Copied to Clipboard!';
      setTimeout(() => {
        btnCopyLinks.textContent = orig;
      }, 2000);
    });
  });

  btnExportTxt.addEventListener('click', () => {
    if (cachedCollectedLinks.length === 0) return;
    // Sorted alphabetically, line by line
    const sortedLinks = [...cachedCollectedLinks].sort((a, b) => a.localeCompare(b));
    const blob = new Blob([sortedLinks.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp_groups_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  btnResetLinks.addEventListener('click', () => {
    if (confirm('Clear all collected WhatsApp links and start fresh?')) {
      if (activeTabId && typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.sendMessage(activeTabId, { type: 'CLEAR_LINKS' }, (res) => {
          if (res) applyStateToUI(res);
        });
      } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ quotefb_collected_links: [] }, () => {
          cachedCollectedLinks = [];
          updateButtonsAndCount(0);
        });
      }
    }
  });
});
