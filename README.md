# QuoteFB - Facebook Persistent Unique WhatsApp Group Link Harvester

A lightweight Manifest V3 Chrome Extension that automatically scrolls Facebook search feeds, actively filters out clutter, and **continuously collects unique normalized WhatsApp group invite links (`chat.whatsapp.com`) without ever repeating previously copied links**.

---

## Key Features

- **Always Active Across Facebook**:
  - The floating harvester stays active across all groups, search queries, feeds, and pages on Facebook without ever disappearing or wiping collected links.
  - Seamlessly hop from group to group while your link counter continues accumulating new unique links.
- **Copy-Archive System (Never Repeats Copied Links)**:
  - When you click **"Copy & Archive"** (or Export), the copied links are automatically saved to your permanent archive (`quotefb_archived_links`).
  - Next time you search or scroll on Facebook, the extension recognizes previously copied links and automatically filters out their posts.
- **Streamlined Workflow (Start / Pause / Resume / Stop & Copy)**:
  - **Start**: Click **"▶️ Start Harvesting"** to begin auto-scrolling and collecting unique links.
  - **Pause**: Click **"⏸️ Pause"** or press <kbd>P</kbd> to freeze harvesting in place.
  - **Auto-Pause on End of Results**: Automatically pauses when Facebook's feed displays *"End of results"*, preserving all harvested links.
  - **Resume**: Click **"▶️ Resume"** or press <kbd>P</kbd> to continue scrolling and harvesting.
  - **Stop & Copy**: Click **"⏹️ Stop & Copy"** or press <kbd>Esc</kbd> to halt and automatically sort and copy all clean links (A-Z) to your clipboard, saving them directly into your permanent archive.
- **Strict URL Normalization**:
  - Strips all tracking queries (`?fbclid=...`, `?context=...`, `?mode=...`) and unwraps `l.facebook.com` redirects into clean canonical `https://chat.whatsapp.com/<INVITE_CODE>` links.
- **Alphabetical Export**:
  - Automatically sorts all links from A to Z, line by line, before placing them on your clipboard or saving to `.txt`.

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
2. Click **"▶️ Auto-Scroll & Grab Links"** in the bottom-right floating widget or in the extension popup.
3. The extension will scroll the page automatically, filter out non-WhatsApp and duplicate posts, and harvest new unique clean links.
4. When finished (or stopped at "End of Results"), click **"📋 Copy & Archive Links"** or **"💾 Export .txt"**.
5. All copied links are copied alphabetically to your clipboard and permanently recorded into your copy history so they will never appear again in future searches.
