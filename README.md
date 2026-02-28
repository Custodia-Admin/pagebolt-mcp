# PageBolt MCP Server

[![npm version](https://img.shields.io/npm/v/pagebolt-mcp.svg)](https://www.npmjs.com/package/pagebolt-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-compatible-brightgreen)](https://modelcontextprotocol.io)

Take screenshots, generate PDFs, create OG images, inspect pages, and record demo videos directly from your AI coding assistant.

**Works with Claude Desktop, Cursor, Windsurf, Cline, and any MCP-compatible client.**

<img width="1280" height="1279" alt="pagebolt-screenshot_1" src="https://github.com/user-attachments/assets/fd21a372-df4d-41cd-baf4-5b6dd6a9a685" />

---

## What It Does

PageBolt MCP Server connects your AI assistant to [PageBolt's web capture API](https://pagebolt.dev), giving it the ability to:

- **Take screenshots** of any URL, HTML, or Markdown (30+ parameters)
- **Generate PDFs** from URLs or HTML (invoices, reports, docs)
- **Create OG images** for social cards using templates or custom HTML
- **Run browser sequences** — multi-step automation (navigate, click, fill, screenshot)
- **Record demo videos** — browser automation as MP4/WebM/GIF with cursor effects, click animations, and auto-zoom
- **Inspect pages** — get a structured map of interactive elements with CSS selectors (use before sequences)
- **List device presets** — 25+ devices (iPhone, iPad, MacBook, Galaxy, etc.)
- **Check usage** — monitor your API quota in real time

All results are returned inline — screenshots appear directly in your chat.

---

## Quick Start

### 1. Get a free API key

Sign up at [pagebolt.dev](https://pagebolt.dev) — the free tier includes 100 requests/month, no credit card required.

### 2. Install & configure

#### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pagebolt": {
      "command": "npx",
      "args": ["-y", "pagebolt-mcp"],
      "env": {
        "PAGEBOLT_API_KEY": "pf_live_your_key_here"
      }
    }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json` in your project (or global config):

```json
{
  "mcpServers": {
    "pagebolt": {
      "command": "npx",
      "args": ["-y", "pagebolt-mcp"],
      "env": {
        "PAGEBOLT_API_KEY": "pf_live_your_key_here"
      }
    }
  }
}
```

#### Windsurf

Add to your Windsurf MCP settings:

```json
{
  "mcpServers": {
    "pagebolt": {
      "command": "npx",
      "args": ["-y", "pagebolt-mcp"],
      "env": {
        "PAGEBOLT_API_KEY": "pf_live_your_key_here"
      }
    }
  }
}
```

#### Cline / Other MCP Clients

Same config pattern — set `command` to `npx`, `args` to `["-y", "pagebolt-mcp"]`, and provide your API key in `env`.

### 3. Try it

Ask your AI assistant:

> "Take a screenshot of https://github.com in dark mode at 1920x1080"

The screenshot will appear inline in your chat.

---

## Tools

### `take_screenshot`

Capture a pixel-perfect screenshot of any URL, HTML, or Markdown.

**Key parameters:**
- `url` / `html` / `markdown` — content source
- `width`, `height` — viewport size (default: 1280x720)
- `viewportDevice` — device preset (e.g. `"iphone_14_pro"`, `"macbook_pro_14"`)
- `fullPage` — capture the entire scrollable page
- `darkMode` — emulate dark color scheme
- `format` — `png`, `jpeg`, or `webp`
- `blockBanners` — hide cookie consent banners
- `blockAds` — block advertisements
- `blockChats` — remove live chat widgets
- `blockTrackers` — block tracking scripts
- `extractMetadata` — get page title, description, OG tags alongside the screenshot
- `selector` — capture a specific DOM element
- `delay` — wait before capture (for animations)
- `cookies`, `headers`, `authorization` — authenticated captures
- `geolocation`, `timeZone` — location emulation
- ...and 15+ more

**Example prompts:**
- "Screenshot https://example.com on an iPhone 14 Pro"
- "Take a full-page screenshot of https://news.ycombinator.com with ad blocking"
- "Capture this HTML in dark mode: `<h1>Hello World</h1>`"

### `generate_pdf`

Generate a PDF from any URL or HTML content.

**Parameters:** `url`/`html`, `format` (A4/Letter/Legal), `landscape`, `margin`, `scale`, `pageRanges`, `delay`, `saveTo`

**Example prompts:**
- "Generate a PDF of https://example.com and save it to ./report.pdf"
- "Create a PDF from this invoice HTML in Letter format, landscape"

### `create_og_image`

Create Open Graph / social preview images.

**Parameters:** `template` (default/minimal/gradient), `html` (custom), `title`, `subtitle`, `logo`, `bgColor`, `textColor`, `accentColor`, `width`, `height`, `format`

**Example prompts:**
- "Create an OG image with title 'How to Build a SaaS' using the gradient template"
- "Generate a social card with a dark blue background and white text"

### `run_sequence`

Execute multi-step browser automation.

**Actions:** `navigate`, `click`, `fill`, `select`, `hover`, `scroll`, `wait`, `wait_for`, `evaluate`, `screenshot`, `pdf`

**Example prompts:**
- "Go to https://example.com, click the pricing link, then screenshot both pages"
- "Navigate to the login page, fill in test credentials, submit, and screenshot the dashboard"

### `inspect_page`

Inspect a web page and get a structured map of all interactive elements, headings, forms, links, and images — each with a unique CSS selector.

**Key parameters:** `url`/`html`, `width`, `height`, `viewportDevice`, `darkMode`, `cookies`, `headers`, `authorization`, `blockBanners`, `blockAds`, `waitUntil`, `waitForSelector`

**Example prompts:**
- "Inspect https://example.com and tell me what buttons and forms are on the page"
- "What interactive elements are on the login page? I need selectors for a sequence"

**Tip:** Use `inspect_page` before `run_sequence` to discover reliable CSS selectors instead of guessing.

### `record_video`

Record a professional demo video of a multi-step browser automation sequence with cursor effects, click animations, smooth movement, and optional AI voice narration.

**Key parameters:**
- `steps` — same actions as `run_sequence` (except no screenshot/pdf — the whole sequence is the video)
- `format` — `mp4`, `webm`, or `gif` (default: mp4; webm/gif require Starter+)
- `framerate` — 24, 30, or 60 fps (default: 30)
- `pace` — speed preset: `"fast"`, `"normal"`, `"slow"`, `"dramatic"`, `"cinematic"`, or a number 0.25–6.0
- `cursor` — style (`highlight`/`circle`/`spotlight`/`dot`/`classic`), color, size, smoothing, persist
- `clickEffect` — style (`ripple`/`pulse`/`ring`), color
- `zoom` — auto-zoom on clicks with configurable level and duration
- `frame` — browser chrome: `{ enabled: true, style: "macos" }` adds a macOS title bar
- `background` — styled background: `{ enabled: true, type: "gradient", gradient: "midnight", padding: 40, borderRadius: 12 }`
- `audioGuide` — AI voice narration: `{ enabled: true, script: "Intro. {{1}} Step one. {{2}} Step two. Outro." }`
- `darkMode` — emulate dark color scheme in the browser (recommended for light-background sites)
- `blockBanners` — hide cookie consent popups (use on almost every recording)
- `saveTo` — output file path

**Example prompts:**
- "Record a video of logging into https://example.com with a spotlight cursor"
- "Make a narrated demo video of the signup flow at slow pace, save as demo.mp4"
- "Record a demo of https://example.com with a macOS frame and midnight background"

---

#### Best Practices for Polished Video Demos

**1. Always inspect_page first**

Never guess CSS selectors. Call `inspect_page` on the target URL before building your steps — it returns exact selectors for every button, input, and link. Guessed selectors like `button.primary` frequently miss; discovered selectors like `#radix-trigger-tab-dashboard` always hit.

```
1. inspect_page(url, { blockBanners: true })
2. record_video(steps using selectors from step 1, ...)
```

**2. Use `live: true` on wait steps after clicks and navigations**

After a click or navigate, content loads asynchronously. `live: false` (the default) freezes a single frame immediately — before anything renders. Set `live: true` on any wait step that follows an interaction so the video captures the actual page loading.

```json
{ "action": "click", "selector": "#submit-btn", "note": "Submitting the form" },
{ "action": "wait", "ms": 2000, "live": true }
```

**3. Use `darkMode: true` for light-background sites**

If the target site has a white or very light background, it will clash with gradient/glass video backgrounds. Set `darkMode: true` to emulate `prefers-color-scheme: dark` — most modern sites adapt cleanly, and the result looks far more polished on screen.

**4. Use `pace`, not wait steps, for timing**

`pace` automatically inserts pauses between every step. Only use `wait` steps when the page genuinely needs load time (after navigation, after a click that triggers a fetch). Don't pad every transition with a wait — it creates dead air.

| Use case | What to do |
|----------|-----------|
| Natural pacing between steps | Set `pace: "slow"` or `pace: "dramatic"` |
| Page needs to load after click | `{ action: "wait", ms: 1500, live: true }` |
| Hold on a view for narration | `{ action: "wait", ms: 3000, live: true }` |

**5. Write an outro in the narration script**

Audio is the master clock — the video trims or extends to match the TTS duration. Always end your `audioGuide.script` with a sentence after the last `{{N}}` marker. This prevents abrupt endings and gives the viewer a call to action.

```json
"audioGuide": {
  "enabled": true,
  "script": "Welcome to PageBolt. {{1}} First, navigate to the dashboard. {{2}} Click on the export button. {{3}} Your report downloads instantly. Try it free at pagebolt.dev."
}
```

The text after `{{3}}` plays over the final frames as a clean outro. Without it, the audio ends mid-sequence and the remaining video plays in silence.

**6. Add notes on every meaningful step**

Notes render as styled tooltip overlays during playback. Add a `"note"` field on every action step except `wait`/`wait_for`. Keep them short (under 80 chars). They turn a raw browser recording into a guided tour.

```json
{ "action": "navigate", "url": "https://example.com", "note": "Opening the dashboard" },
{ "action": "click", "selector": "#export-btn", "note": "Click to export as PDF" }
```

**7. Complete polished video example**

```json
{
  "steps": [
    { "action": "navigate", "url": "https://app.example.com", "note": "Opening the app" },
    { "action": "wait", "ms": 1500, "live": true },
    { "action": "click", "selector": "#tab-reports", "note": "Switch to the Reports tab" },
    { "action": "wait", "ms": 1200, "live": true },
    { "action": "click", "selector": "#btn-export", "note": "Export the current report" },
    { "action": "wait", "ms": 2000, "live": true },
    { "action": "scroll", "y": 400, "note": "Scroll to see the full results" }
  ],
  "pace": "slow",
  "format": "mp4",
  "darkMode": true,
  "blockBanners": true,
  "frame": { "enabled": true, "style": "macos", "theme": "dark" },
  "background": { "enabled": true, "type": "gradient", "gradient": "midnight", "padding": 40, "borderRadius": 12 },
  "cursor": { "style": "classic", "visible": true, "persist": true },
  "clickEffect": { "style": "ripple" },
  "audioGuide": {
    "enabled": true,
    "script": "Here's how the export flow works. {{1}} Open the app and navigate to the dashboard. {{2}} Switch to the Reports tab. {{3}} Click Export. {{4}} Your report is ready in seconds. Try it free at example.com."
  }
}
```

### `list_devices`

List all 25+ available device presets with viewport dimensions.

**Example prompt:**
- "What device presets are available for screenshots?"

### `check_usage`

Check your current API usage and plan limits.

**Example prompt:**
- "How many API requests do I have left this month?"

---

## Prompts

Pre-built prompt templates for common workflows. In clients that support MCP prompts, these appear as slash commands.

### `/capture-page`

Capture a clean screenshot of any URL with sensible defaults (blocks banners, ads, chats, trackers).

**Arguments:** `url` (required), `device`, `dark_mode`, `full_page`

### `/record-demo`

Record a professional demo video. The agent inspects the page first to discover selectors, then builds a video recording sequence.

**Arguments:** `url` (required), `description` (required — what the demo should show), `pace`, `format`

### `/audit-page`

Inspect a page and get a structured analysis of its elements, forms, links, headings, and potential issues.

**Arguments:** `url` (required)

---

## Resources

### `pagebolt://api-docs`

The full PageBolt API reference as a text resource. AI agents that support MCP resources can read this for detailed parameter documentation beyond what fits in tool descriptions. Content is fetched from the live `llms-full.txt` endpoint.

---

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `PAGEBOLT_API_KEY` | **Yes** | — | Your PageBolt API key ([get one free](https://pagebolt.dev)) |
| `PAGEBOLT_BASE_URL` | No | `https://pagebolt.dev` | API base URL |

---

## Pricing

| Plan | Price | Requests/mo | Rate Limit |
|------|-------|-------------|------------|
| **Free** | $0 | 100 | 10 req/min |
| Starter | $29/mo | 5,000 | 60 req/min |
| Growth | $79/mo | 25,000 | 120 req/min |
| Scale | $199/mo | 100,000 | 300 req/min |

Free plan requires no credit card. Starter and Growth include a 14-day free trial.

---

## Why PageBolt?

- **6 APIs, one key** — screenshot, PDF, OG image, browser automation, video recording, page inspection. Stop paying for separate tools.
- **Clean captures** — automatic ad blocking, cookie banner removal, chat widget suppression, tracker blocking.
- **25+ device presets** — iPhone SE to Galaxy S24 Ultra, iPad Pro, MacBook, Desktop 4K.
- **Ship in 5 minutes** — plain HTTP, no SDKs required, works in any language.
- **Inline results** — screenshots and OG images appear directly in your AI chat.

---

## Links

- **Website:** [pagebolt.dev](https://pagebolt.dev)
- **API Docs:** [pagebolt.dev/docs.html](https://pagebolt.dev/docs.html)
- **npm:** [npmjs.com/package/pagebolt-mcp](https://www.npmjs.com/package/pagebolt-mcp)
- **Issues:** [github.com/Custodia-Admin/pagebolt-mcp/issues](https://github.com/Custodia-Admin/pagebolt-mcp/issues)

---

## License

MIT
