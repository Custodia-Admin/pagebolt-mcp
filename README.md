# PageBolt MCP Server

[![npm version](https://img.shields.io/npm/v/pagebolt-mcp.svg)](https://www.npmjs.com/package/pagebolt-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-compatible-brightgreen)](https://modelcontextprotocol.io)

Take screenshots, generate PDFs, and create OG images directly from your AI coding assistant.

**Works with Claude Desktop, Cursor, Windsurf, Cline, and any MCP-compatible client.**

<p align="center">
  <img src="https://pagebolt.dev/og-image-default.png" alt="PageBolt" width="600" />
</p>

---

## What It Does

PageBolt MCP Server connects your AI assistant to [PageBolt's web capture API](https://pagebolt.dev), giving it the ability to:

- **Take screenshots** of any URL, HTML, or Markdown (30+ parameters)
- **Generate PDFs** from URLs or HTML (invoices, reports, docs)
- **Create OG images** for social cards using templates or custom HTML
- **Run browser sequences** — multi-step automation (navigate, click, fill, screenshot)
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

### `list_devices`

List all 25+ available device presets with viewport dimensions.

**Example prompt:**
- "What device presets are available for screenshots?"

### `check_usage`

Check your current API usage and plan limits.

**Example prompt:**
- "How many API requests do I have left this month?"

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

- **5 APIs, one key** — screenshot, PDF, OG image, browser automation, and MCP server. Stop paying for separate tools.
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
