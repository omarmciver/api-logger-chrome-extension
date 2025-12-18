# API Logger Chrome Extension

Record API calls (XHR/Fetch) and export them for analysis. Features session management with resume, delete, and JSONL export.

## Features

- **Record API Calls**: Capture XHR and Fetch requests with full request/response bodies
- **Session Management**: Create, pause, resume, and delete recording sessions
- **Persistent Storage**: Sessions stored in IndexedDB, survive browser restarts
- **Optimized Export**: JSONL format designed for easy analysis with compatible tools
- **Privacy-Aware**: Sensitive headers (Authorization, Cookie) auto-redacted
- **DevTools Integration**: Dedicated panel in Chrome DevTools

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extension folder
5. Open DevTools (F12) on any website
6. Find the **"API Logger"** tab

## Usage

### Recording API Calls

1. Open DevTools (F12) on the website you want to monitor
2. Go to the **API Logger** tab
3. Click **"New Session"** to create a session and start recording
4. Navigate the website - API calls will be captured automatically
5. Click **"Pause"** to temporarily stop recording
6. Click **"Stop"** to end the session

### Managing Sessions

- **Resume**: Click "Resume" on any stopped/paused session to continue recording
- **Delete**: Remove sessions you no longer need
- **Export**: Download session data as JSONL for analysis

### Filtering

Use the filter input to search recorded calls by URL or HTTP method.

## Export Format

Exports use NDJSON (newline-delimited JSON) format optimized for abalysis consumption:

```jsonl
{"type":"meta","format":"api-trace-jsonl","version":1,"session":{...},"summary":{...}}
{"type":"call","seq":1,"method":"POST","url":"https://api.example.com/login","request":{...},"response":{...}}
{"type":"call","seq":2,"method":"GET","url":"https://api.example.com/user","request":{...},"response":{...}}
```

### Export Fields

**Meta (first line)**:
- Session info (name, timestamps, source URL)
- Summary (call count, errors, domains, top endpoints)

**Call (per request)**:
- `seq`: Sequence number for ordering
- `method`, `url`: Request details
- `request.headers`, `request.body`: Request data
- `response.status`, `response.headers`, `response.body`: Response data
- `duration`: Request timing in ms

## Architecture

```
┌─────────────────────────────────────────────┐
│  DevTools Panel (panel.html + panel.js)     │
│  ├─ Session management UI                   │
│  ├─ chrome.devtools.network listener        │
│  └─ IndexedDB storage (db.js)               │
└─────────────────────────────────────────────┘
           │
           │ request.getContent()
           ▼
┌─────────────────────────────────────────────┐
│  Browser Network Stack                       │
│  (XHR, Fetch, WebSocket)                    │
└─────────────────────────────────────────────┘
```

### Why DevTools API?

This extension uses `chrome.devtools.network.onRequestFinished` because:
- **Response bodies**: `webRequest` API cannot capture response bodies in MV3
- **No scary permissions**: Doesn't need `<all_urls>` host permissions
- **Reliable**: Sees all network traffic including third-party requests
- **Trade-off**: DevTools must be open during recording

## File Structure

```
├── manifest.json           # MV3 manifest (minimal permissions)
├── devtools/
│   ├── devtools.html       # DevTools entry point
│   ├── devtools.js         # Panel creation
│   ├── panel.html          # Panel UI
│   └── panel.js            # Recording logic + UI
├── src/
│   ├── db.js               # IndexedDB operations
│   └── export.js           # JSONL export
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Permissions

**Only requires `storage` permission** - no host permissions needed since capture happens through DevTools API.

## Privacy

- Sensitive headers auto-redacted: `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`
- Large bodies truncated at 100KB
- All data stored locally in IndexedDB
- No data sent anywhere

## Development

```bash
# Watch for changes (optional)
# Just reload the extension after making changes

# Test
1. Load unpacked extension
2. Open DevTools on any site with API calls
3. Create session, record, export
4. Verify JSONL output
```

## License

MIT
