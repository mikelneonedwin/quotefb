# QuoteFB - Facebook Persistent Unique WhatsApp Group Link Harvester

A lightweight Manifest V3 Chrome Extension that automatically scrolls Facebook search feeds, filters out clutter, and **continuously collects unique normalized WhatsApp group invite links (`chat.whatsapp.com`)**.

---

## Key Features

- **Automated Hands-Free Auto-Scroll**:
  - Automatically scrolls down the feed at balanced intervals to let Facebook's GraphQL feed load continuously.
  - Can be started/stopped with one click from the in-page floating widget or toolbar popup, or stopped instantly by pressing `Escape`.
- **Persistent Link Collection**:
  - Accumulates clean unique links in `chrome.storage.local` across all scrolls and page transitions without losing links when posts are unmounted by Facebook's virtual DOM.
- **Strict URL Normalization**:
  - Strips all tracking queries (`?fbclid=...`, `?context=...`, `?mode=...`) and unwraps `l.facebook.com` redirects into clean canonical `https://chat.whatsapp.com/<INVITE_CODE>` links.
- **Real-Time Deduplication**:
  - Only keeps the first post per unique WhatsApp invite link; hides subsequent duplicate spam posts.
- **Alphabetical 1-Click Export**:
  - **Copy All Clean Links**: Copies all unique normalized links sorted in **alphabetical order**, one per line, directly to your clipboard.
  - **Export .txt**: Downloads an alphabetically sorted text file of all collected groups.

---

## Installation & Setup

1. Open Google Chrome (or Brave, Edge, Arc).
2. Go to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** (top-left button).
5. Select this project directory (`/home/winner/workspace/quotefb`).

---

## How to Use

1. Go to Facebook Search Posts (e.g., [facebook.com/search/posts/?q=whatsapp+group+link](https://www.facebook.com/search/posts/?q=whatsapp+group+link)).
2. Click **"▶️ Auto-Scroll & Grab Links"** in the bottom-right widget or extension popup.
3. The extension will scroll the page automatically, filter out non-WhatsApp and duplicate posts, and harvest all unique clean links.
4. When done, press `Escape` or click **"⏹️ Stop Auto-Scroll"**, then click **"📋 Copy All Clean Links"** or **"💾 Export .txt"**.
