// QuoteFB Popup Logic - WhatsApp Harvester with Streamlined Controls

document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const customQueryInput = document.getElementById('custom-query-input');
  const btnClearQuery = document.getElementById('btn-clear-query');
  
  const countTotalCollected = document.getElementById('count-total-collected');
  const countArchivedSub = document.getElementById('count-archived-sub');
  const countVisible = document.getElementById('count-visible');
  const countDuplicate = document.getElementById('count-duplicate');
  const countNonWA = document.getElementById('count-nonwa');
  
  const btnStartHarvest = document.getElementById('btn-start-harvest');
  const harvestSplitControls = document.getElementById('harvest-split-controls');
  const btnPauseHarvest = document.getElementById('btn-pause-harvest');
  const btnResumeHarvest = document.getElementById('btn-resume-harvest');
  const btnStopHarvest = document.getElementById('btn-stop-harvest');
  
  const feedbackBanner = document.getElementById('popup-feedback-banner');
  const btnResetLinks = document.getElementById('btn-reset-links');
  const btnClearArchive = document.getElementById('btn-clear-archive');
  
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleRequireWA = document.getElementById('toggle-require-wa');
  const toggleUnique = document.getElementById('toggle-unique');
  const queryHelper = document.getElementById('query-helper');

  let activeTabId = null;
  let cachedCollectedLinks = [];
  let cachedArchivedLinks = [];

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
        [
          'enabled',
          'requireWhatsAppLink',
          'onlyUniqueWhatsApp',
          'customQuery',
          'quotefb_collected_links',
          'quotefb_archived_links',
        ],
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
          }
          if (Array.isArray(items.quotefb_archived_links)) {
            cachedArchivedLinks = items.quotefb_archived_links;
          }
          updateCounts(cachedCollectedLinks.length, cachedArchivedLinks.length);
        }
      );
    }
  }

  function updateCounts(newCount, archivedCount) {
    countTotalCollected.textContent = newCount;
    if (countArchivedSub) {
      countArchivedSub.textContent = `📦 ${archivedCount} previously copied & archived`;
    }
  }

  function showBanner(text, isSuccess = false) {
    if (!feedbackBanner) return;
    if (!text) {
      feedbackBanner.style.display = 'none';
      return;
    }
    feedbackBanner.textContent = text;
    feedbackBanner.className = isSuccess ? 'feedback-banner success' : 'feedback-banner';
    feedbackBanner.style.display = 'block';
  }

  function applyStateToUI(state) {
    toggleEnabled.checked = Boolean(state.enabled);
    if (toggleRequireWA) toggleRequireWA.checked = state.requireWhatsAppLink !== false;
    if (toggleUnique) toggleUnique.checked = state.onlyUniqueWhatsApp !== false;

    countVisible.textContent = state.currentVisibleOnScreen ?? 0;
    countDuplicate.textContent = state.currentDuplicatesOnScreen ?? 0;
    countNonWA.textContent = state.currentNonWAOnScreen ?? 0;

    cachedCollectedLinks = state.collectedLinks || [];
    cachedArchivedLinks = state.archivedLinks || [];
    updateCounts(cachedCollectedLinks.length, cachedArchivedLinks.length);

    const isScrolling = Boolean(state.isAutoScrolling);
    const isPaused = Boolean(state.isPaused);

    // Streamlined Harvest Buttons
    if (!isScrolling) {
      btnStartHarvest.style.display = 'flex';
      harvestSplitControls.style.display = 'none';
    } else {
      btnStartHarvest.style.display = 'none';
      harvestSplitControls.style.display = 'grid';

      if (isPaused) {
        btnPauseHarvest.style.display = 'none';
        btnResumeHarvest.style.display = 'flex';
      } else {
        btnPauseHarvest.style.display = 'flex';
        btnResumeHarvest.style.display = 'none';
      }
    }

    // Status Badge & Banner
    if (state.reachedEnd) {
      statusBadge.className = 'status-indicator paused';
      statusText.textContent = '🏁 Reached End of Results';
      showBanner('🏁 Reached End of Results (Paused)');
    } else if (isScrolling) {
      if (isPaused) {
        statusBadge.className = 'status-indicator paused';
        statusText.textContent = '⏸️ Harvesting Paused';
        showBanner('⏸️ Harvesting is paused. Click Resume or Stop & Copy.');
      } else {
        statusBadge.className = 'status-indicator active';
        statusText.textContent = '⚡ Harvesting Active...';
        showBanner('⚡ Auto-scrolling and collecting unique WhatsApp links...');
      }
    } else {
      if (state.lastActionFeedback) {
        showBanner(state.lastActionFeedback, state.lastActionFeedback.startsWith('✅'));
      } else {
        showBanner('');
      }
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

  // Streamlined Harvest Event Listeners
  btnStartHarvest.addEventListener('click', () => {
    if (activeTabId && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.sendMessage(activeTabId, { type: 'START_HARVEST' }, (res) => {
        if (res) applyStateToUI(res);
      });
    }
  });

  btnPauseHarvest.addEventListener('click', () => {
    if (activeTabId && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.sendMessage(activeTabId, { type: 'PAUSE_HARVEST' }, (res) => {
        if (res) applyStateToUI(res);
      });
    }
  });

  btnResumeHarvest.addEventListener('click', () => {
    if (activeTabId && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.sendMessage(activeTabId, { type: 'RESUME_HARVEST' }, (res) => {
        if (res) applyStateToUI(res);
      });
    }
  });

  // Stop & Copy Automatically
  btnStopHarvest.addEventListener('click', () => {
    if (activeTabId && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.sendMessage(activeTabId, { type: 'STOP_AND_COPY' }, (res) => {
        if (res) applyStateToUI(res);
      });
    } else if (cachedCollectedLinks.length > 0) {
      const sortedLinks = [...cachedCollectedLinks].sort((a, b) => a.localeCompare(b));
      navigator.clipboard.writeText(sortedLinks.join('\n')).then(() => {
        const combined = Array.from(new Set([...cachedArchivedLinks, ...cachedCollectedLinks]));
        chrome.storage.local.set({
          quotefb_collected_links: [],
          quotefb_archived_links: combined,
        }, () => {
          cachedArchivedLinks = combined;
          cachedCollectedLinks = [];
          updateCounts(0, combined.length);
          showBanner(`✅ Stopped & Copied ${sortedLinks.length} Links!`, true);
        });
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

  // Clear current batch
  btnResetLinks.addEventListener('click', () => {
    if (activeTabId && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.sendMessage(activeTabId, { type: 'CLEAR_CURRENT' }, (res) => {
        if (res) applyStateToUI(res);
      });
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ quotefb_collected_links: [] }, () => {
        cachedCollectedLinks = [];
        updateCounts(0, cachedArchivedLinks.length);
        showBanner('🗑️ Cleared new links queue');
      });
    }
  });

  // Clear permanent archive history
  btnClearArchive.addEventListener('click', () => {
    if (activeTabId && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.sendMessage(activeTabId, { type: 'CLEAR_ALL_HISTORY' }, (res) => {
        if (res) applyStateToUI(res);
      });
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        quotefb_collected_links: [],
        quotefb_archived_links: [],
      }, () => {
        cachedCollectedLinks = [];
        cachedArchivedLinks = [];
        updateCounts(0, 0);
        showBanner('🗑️ Reset full copy history');
      });
    }
  });
});
