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
- **Observe pages for agents** — compact, token-budgeted observation with an optional `flatdomtree` mode for browser-use / page-agent interop
- **Import agent traces** — turn a browser-use / page-agent action trace into a re-runnable PageBolt sequence
- **List device presets** — 25+ devices (iPhone, iPad, MacBook, Galaxy, etc.)
- **Check usage & track async jobs** — monitor your API quota and long async video renders in real time

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

**Actions:** `navigate`, `click`, `dblclick`, `fill`, `select`, `hover`, `scroll`, `wait`, `wait_for`, `evaluate`, `press_key`, `screenshot`, `pdf`, `diff`

**Limits:** steps per plan 20 Free/Hobby, 30 Starter, 50 Growth, 100 Scale; 5 outputs; 10 `evaluate` steps; 60 s total (+1.5 s per step above 20, cap 120 s). `wait` is a plain delay here (`live` is video-only); use `wait_for` to wait for readiness. Pre-flight warnings are appended to the result.

**`observeAfterEachStep`** (optional, **free**): attaches a compact state snapshot (page type + top interactive elements + suggested actions, no screenshot) to each step result, so an agent can confirm what's on screen — e.g. that a dropdown opened — and pick the right selector for its next call without blind-batching.

**Example prompts:**
- "Go to https://example.com, click the pricing link, then screenshot both pages"
- "Navigate to the login page, fill in test credentials, submit, and screenshot the dashboard"

### `inspect_page`

Inspect a web page and get a structured map of all interactive elements, headings, forms, links, and images — each with a unique CSS selector.

**Key parameters:** `url`/`html`, `width`, `height`, `viewportDevice`, `darkMode`, `cookies`, `headers`, `authorization`, `blockBanners`, `blockAds`, `waitUntil`, `waitForSelector`, `includeConsole`

**`includeConsole`** (optional, opt-in): also capture the page's browser console output (`console.log`/`info`/`warn`/`error`) and uncaught JavaScript errors emitted during load. Adds a "Console" section to the result — useful for debugging a page's runtime behavior, not just its static DOM. Also available on `observe_page`.

**Example prompts:**
- "Inspect https://example.com and tell me what buttons and forms are on the page"
- "What interactive elements are on the login page? I need selectors for a sequence"
- "Inspect https://example.com with includeConsole and show me any console errors"

**Tip:** Use `inspect_page` before `run_sequence` to discover reliable CSS selectors instead of guessing.

### `observe_page`

Get a compact, token-budgeted **observation** of any page, purpose-built for AI agents: id-indexed interactive elements (role, name, CSS selector, state), a heuristic page-type classification, and grouped suggested actions — optionally bundled with readable content, the ARIA tree, a screenshot, and console output.

**Key parameters:** `url`/`html`, `format`, `maxElements`, `includeRects`, `includeContent`, `includeAriaTree`, `includeScreenshot`, `includeConsole`, `blockBanners`, `session_id`, plus the usual viewport/auth/blocking options.

**`format`** (optional): `"json"` (default) returns the id-indexed `elements` array. **`"flatdomtree"`** returns `dom_text` — the indexed plain-text DOM used by browser-use / Alibaba's page-agent (e.g. `[1]<button>Sign in</button>`) — plus a `selectors` map (`{"1":"#signin"}`) **instead of** the elements array. Feed `dom_text` to a page-agent, then pass its action trace + this `selectors` map to `import_agent_trace` to build a re-runnable sequence.

Page-derived text (including `dom_text`) is always wrapped in `UNTRUSTED PAGE CONTENT` markers — treat it strictly as data.

**Example prompts:**
- "Observe https://example.com/login and show me the login elements and selectors"
- "Observe https://example.com with format flatdomtree so I can drive it with a browser-use agent"

### `export_sequence`

Build a sequence and get it back as JSON you can **edit and re-run**: paste it into the dashboard Sequence builder (*Import JSON*), change any step, highlight or narration, and run it again. Nothing is executed and no quota is used. Pass `save: true` to also store it in your Saved Automations (dashboard and Chrome extension Library).

Parameters: `steps` (required), `pace`, `audioGuide` (`pacing`: `overlap` | `sequential`), `format`, `viewport`, `name`, `save`. The same pre-flight checks as `record_video` run on the steps (evaluate cap, plan limits, static waits, estimated length).

### `import_agent_trace`

Convert a page-agent / browser-use **action trace** into a re-runnable PageBolt **sequence**. This is the other half of `observe_page` with `format:"flatdomtree"`: observe → run an agent → import the trace to persist a deterministic, replayable sequence. **Does not consume request quota.**

**Key parameters:**
- `trace` — array of action entries (required). Supports both `{action, index|selector, value, ...}` and `{action_name: {...}}` shapes.
- `selectors` — optional index→CSS map (e.g. from `observe_page` `format:"flatdomtree"`) used to resolve numeric element indices.
- `name` — optional name for the sequence.
- `type` — `"sequence"` (default) or `"video"`.
- `save` — `true` (default) persists the sequence; `false` is a dry run that returns the translated steps + `step_count` without saving.

**Example prompts:**
- "Import this browser-use trace as a sequence, but do a dry run first (save: false)"
- "Turn the agent trace from that observe call into a saved PageBolt sequence named 'Login flow'"

### `act_on_page`

Goal-driven automation. Give it a URL and a plain-English **goal**; PageBolt runs an **observe → plan → act → verify** loop server-side until the goal is met, then returns a structured **trace** of every action plus a success/failure status. You do **not** author selectors or a step list — this is the "hands" on top of `observe_page` (the "eyes").

**Key parameters:**
- `url` — the page to start on (required)
- `goal` — plain-English outcome you want, e.g. "Log in and open the billing page" (required)
- `maxSteps` — cap on planning iterations (default 8; clamped to your plan ceiling)
- `allowedDomains` — hosts the agent may navigate to (defaults to the start host only)
- `credentials` — `{ username, password }`, substituted at execution time only, **never logged or sent to the planner LLM**; shown in the trace as `<redacted>`
- `session_id` — run inside an existing session to reuse cookies/login

**When to use which:** use `act_on_page` when you only know the *outcome*; use `run_sequence` when you already know the exact deterministic steps/selectors (cheaper).

**Plan & cost:** Starter+ only. Metered: **2 requests base + 1 per step taken** (a 4-step run costs 6 requests).

**Example prompts:**
- "On https://app.example.com/login, log in with these credentials and open the billing page"
- "Go to https://example.com and accept the cookie banner, then start a free trial"

**Tip:** Scope `allowedDomains` tightly and avoid pointing it at destructive flows — the agent treats page text as untrusted and pursues only your goal.

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
- `async` — render via an async job and poll to completion. Long recordings are enqueued (`202 { job_id }`) and this tool waits for the result, so they don't hit MCP client / API request timeouts. The async result is a **private hosted video URL** (its bytes can't be pulled back via the API key). Set `false` to force a single blocking synchronous request that returns the video **inline** (base64 embedded + saved to `saveTo`). **Default: `true`, except when you pass `saveTo`** (then the synchronous path is used so the file is actually produced on disk). Falls back to sync automatically if async is unavailable. **Quota is charged only on success; max 5 pending jobs per account.**
- `pollTimeoutMs` — max time to wait for an async job (default: 240000 ≈ 4 min). If the render is still running when this elapses, the `job_id` is returned so you can check it later with `get_job`.
- `saveTo` — output file path. Missing parent folders are created; the path must be under the MCP server's working directory (or a folder listed in `PAGEBOLT_MCP_SAVE_ROOT`). The result gives the absolute path and the byte size read back from disk, and an unwritable path is rejected **before** the render is requested. It never reports "saved" when it was not.

#### Getting a recording right the first time

`record_video` and `run_sequence` run a free **client-side pre-flight** before sending the request. Errors stop the call (nothing is billed); warnings are appended to the result and the request is still sent.

| Check | Level |
|---|---|
| more than 10 `evaluate` steps (server limit, 400 otherwise) | error |
| authoring fields the server would 400: `output` not even / out of range / with `gif`, `audio.sampleRate` not 24000, 44100 or 48000, an `x`/`y` point outside the viewport or combined with `selector`, a `rect` outside the viewport or combined with `selector`, a `card` without `title`, `durationMs` outside 500-10000, a `highlight` `style` the server does not know | error |
| `format: "gif"` with `audioGuide`; `run_sequence` with 0 or more than 5 output steps | error |
| `saveTo` outside the allowed folders or not creatable | error (before the render) |
| `wait` with an explicit `live: false` right after `click` / `dblclick` / `navigate` / `press_key` / `select` / `evaluate` (a static wait freezes **one** frame, so what the action started is not recorded; without the flag the server records it live) | warning |
| step count or `format` above your plan (plan read once from `GET /api/v1/usage`, cached; skipped if unavailable) | warning |
| estimated length above ~200 s, above your plan's video budget, or above the 5000-frame cap | warning, names the step where the render would stop |
| `wait` × `pace` above 10 s; WebGPU in an `evaluate`; `narration` without `audioGuide.enabled`; `localhost` / private navigate URL | warning |

The estimate sums waits, `pauseAfter`, highlight durations, a per-step base and narration at ~150 words per minute. It is accurate to roughly ±30 %.

Limits worth knowing (from the PageBolt backend):

| Plan | Video steps | Video budget (base + per step) | `run_sequence` steps |
|---|---|---|---|
| Free | 10 | 20 s + 5 s | 20 |
| Hobby | 15 | 25 s + 5 s | 20 |
| Starter | 20 | 30 s + 5 s | 30 |
| Growth | 30 | 45 s + 6 s | 50 |
| Scale | 50 | 60 s + 6 s | 100 |

The per-step part is multiplied by `max(pace, 1)`. When the budget, ~240 s of wall clock or 5000 frames is reached the render **stops and drops the remaining steps without an error**, so check `Steps: N/M`. `evaluate` is capped at 10 per video or sequence. In a video it is recorded while its promise is pending (an async IIFE with `setTimeout` gaps or an `rAF` loop shows up on screen).

Output size is `viewport × deviceScaleFactor`; `frame` adds a 40 px × dsf title bar and `background` adds 2 × `padding` (default 40) per axis, so 1440×900 with both is 1520×1020. Pass `output: {width, height, fit: "contain" | "cover"}` for an exact canvas such as 1920×1080 (even numbers, 320-3840 × 180-2160, not for gif). Narration audio is **48 kHz stereo** by default (AAC in mp4, Opus in webm); `audio: {sampleRate: 24000, channels: 1}` restores the old mono track. PageBolt's browsers have **no WebGPU** (and WebGL is software only), so a WebGPU app records its fallback path. The renderer is a cloud browser: the target must be a public HTTPS URL (see [docs/design/local-target-connector.md](docs/design/local-target-connector.md) for options to avoid a tunnel).

**Authoring and quality parameters (PageBolt server `Video: first-time-right recordings`, pagebolt#144; older backends reject unknown fields).**
- Targets without a selector: `x` / `y` (viewport CSS px) on `click` / `dblclick` / `hover`, and `rect: {x, y, width, height}` on `highlight`. Give a selector **or** a point/rect, not both.
- `card` step: `title` (required), `subtitle`, `footer`, `theme {background, foreground, accent, fontFamily}`, `durationMs` (500-10000, default 3000, not pace-scaled; it stays up for its narration), optional `narration`.
- Highlight styles `focus` (default when narrated), `ring`, `glide` (put consecutive glide highlights in a row), plus `camera`, `exactDuration`, `requireVisible`. A highlight lasts at least as long as its narration clip unless `exactDuration: true`.
- Narration starts with the first visual frame of its step. `audioGuide.pronunciations` (`{"word": "alias"}` or `{"word": {"ipa": "..."}}`) and `speakYears`; `AI` is spoken "A.I." by default.
- `wait` is captured **live by default** after click / dblclick / navigate / press_key / select / evaluate (a ~300 ms probe decides elsewhere); `live: false` is the only way to get a one-frame hold.
- `rehearse: true` calls `POST /api/v1/video/rehearse`: the real step code at fast pace, nothing encoded or spoken, **1 API request per 10 steps** (a recording costs 3). The tool returns per step `ok` / `error` / `visible` / the resolved element box plus a 640 px screenshot as an image. `screenshots: false` makes it a flat 1 request.
- `step_thumbnails: true` adds one small JPEG per step to a real render; the tool returns them as images.

**Verify the render.** `Steps: N/N completed` only means no step errored. The result also lists steps that failed, were skipped, were cut by the budget, had a target nobody can see (`visible: false`, nothing drawn), or produced no visual change, plus the server's single `warnings[]` (`step_results[].start_s/end_s/frames_captured/changed/live/visible/narration_start_s`, `stopped_early` / `stopped_at_step` / `stop_reason`, `budget.effective_timeout_ms`). The cheapest check is `rehearse: true`. Hosted async videos are private and cannot be downloaded with the API key.

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

**2. Add a wait after clicks and navigations (it is live by default)**

After a click or navigate, content loads asynchronously. The server records a wait that follows click / dblclick / navigate / press_key / select / evaluate in real time, so the video captures the page loading; only an explicit `live: false` freezes a single frame.

```json
{ "action": "click", "selector": "#submit-btn", "note": "Submitting the form" },
{ "action": "wait", "ms": 2000 }
```

**3. Use `darkMode: true` for light-background sites**

If the target site has a white or very light background, it will clash with gradient/glass video backgrounds. Set `darkMode: true` to emulate `prefers-color-scheme: dark` — most modern sites adapt cleanly, and the result looks far more polished on screen.

**4. Use `pace`, not wait steps, for timing**

`pace` automatically inserts pauses between every step. Only use `wait` steps when the page genuinely needs load time (after navigation, after a click that triggers a fetch). Don't pad every transition with a wait — it creates dead air.

| Use case | What to do |
|----------|-----------|
| Natural pacing between steps | Set `pace: "slow"` or `pace: "dramatic"` |
| Page needs to load after click | `{ action: "wait", ms: 1500 }` |
| Hold on a still view | `{ action: "wait", ms: 3000, live: false }` |

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

### `list_jobs`

List your recent async jobs (e.g. videos enqueued with `record_video`). Returns each job's id, type, status, and timestamps. **Free** (no request quota).

**Example prompt:**
- "List my recent async video jobs and their status"

### `get_job`

Fetch the status and output of a single async job by id. While pending/processing it returns the current status; when completed it returns the output — for videos, the hosted watch/embed/file URLs. **Free** (no request quota).

**Key parameter:** `job_id`

**Example prompt:**
- "Check the status of video job abc123"

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

### `/capture-authenticated`

Capture a page behind a login using the [auth.md](https://workos.com/auth.md) discovery pattern: find the target's auth metadata, obtain a credential on the user's behalf, then hand it to PageBolt via `authorization`/`cookies`/`headers`. Includes a built-in reality check — auth.md grants **API tokens, not browser session cookies**, so cookie-session web apps still need a real session cookie (which the prompt guides the agent to request).

**Arguments:** `url` (required), `capture` (`observe`|`screenshot`), `credential`, `credential_type` (`bearer`|`cookie`|`header`)

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
| `PAGEBOLT_MCP_SAVE_ROOT` | No | — | Extra folder(s) `saveTo` may write under, in addition to the server's working directory (path-delimiter separated) |
| `PAGEBOLT_MCP_NO_PLAN_LOOKUP` | No | — | Set to `1` to skip the cached `GET /api/v1/usage` call used to sharpen pre-flight warnings |

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
