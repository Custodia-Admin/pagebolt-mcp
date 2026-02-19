#!/usr/bin/env node

/**
 * PageBolt MCP Server — COMPLETE API coverage
 *
 * A Model Context Protocol (MCP) server that exposes 100% of PageBolt's
 * API as tools for AI coding assistants (Claude, Cursor, Windsurf, Cline).
 *
 * Every parameter from every endpoint is exposed. Nothing is hidden.
 *
 * Get your free API key at https://pagebolt.dev
 *
 * Configuration (environment variables):
 *   PAGEBOLT_API_KEY   — Required. Your PageBolt API key.
 *   PAGEBOLT_BASE_URL  — Optional. Defaults to https://pagebolt.dev
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

/**
 * Validate that a saveTo path stays within the current working directory.
 * Prevents path traversal attacks (e.g., saveTo: "/etc/cron.d/malicious").
 */
function safePath(userPath, defaultName) {
  const resolved = resolve(userPath || defaultName);
  const rel = relative(process.cwd(), resolved);
  if (isAbsolute(rel) || rel.startsWith('..')) {
    throw new Error(
      `saveTo path must be within the current working directory. ` +
      `Got "${userPath}", which resolves outside CWD (${process.cwd()}).`
    );
  }
  return resolved;
}

// ─── Configuration ───────────────────────────────────────────────
const API_KEY = process.env.PAGEBOLT_API_KEY;
const BASE_URL = (process.env.PAGEBOLT_BASE_URL || 'https://pagebolt.dev').replace(/\/$/, '');

function requireApiKey() {
  if (!API_KEY) {
    throw new Error(
      'PAGEBOLT_API_KEY environment variable is required. ' +
      'Get your free API key at https://pagebolt.dev'
    );
  }
}

// ─── HTTP helper ─────────────────────────────────────────────────
async function callApi(endpoint, options = {}) {
  requireApiKey();
  const url = `${BASE_URL}${endpoint}`;
  const method = options.method || 'GET';
  const headers = {
    'x-api-key': API_KEY,
    'user-agent': 'pagebolt-mcp/1.6.2',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let errorMsg;
    try {
      const errJson = await res.json();
      errorMsg = errJson.error || JSON.stringify(errJson);
    } catch {
      errorMsg = `HTTP ${res.status} ${res.statusText}`;
    }
    throw new Error(`PageBolt API error: ${errorMsg}`);
  }

  return res;
}

// ─── MIME type helper ────────────────────────────────────────────
function imageMimeType(format) {
  const map = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp' };
  return map[format] || 'image/png';
}

// ─── Reusable Zod schemas ────────────────────────────────────────
// These are shared across multiple tools.

const cookieSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
  }),
]);

/** Screenshot style / theme options (frame, background, shadow, etc.) */
const styleSchema = z.object({
  theme: z.enum([
    'notion', 'paper', 'vercel', 'glass', 'ocean', 'sunset',
    'linear', 'arc', 'glassDark', 'glassWarm', 'spotlight',
    'neonBlue', 'neonPurple', 'neonGreen', 'lavender', 'ember', 'dots', 'grid',
  ]).optional().describe(
    'One-click theme preset. Applies curated frame + background + shadow + padding. ' +
    'Free themes: notion, paper, vercel, glass, ocean, sunset. ' +
    'Paid (Starter+): linear, arc, glassDark, glassWarm, spotlight, neonBlue, neonPurple, neonGreen, lavender, ember, dots, grid. ' +
    'Individual properties below override the theme defaults.'
  ),
  frame: z.enum(['macos', 'windows', 'minimal', 'none']).optional().describe('Window chrome style. macos = traffic lights, windows = min/max/close, minimal = dots only, none = no frame.'),
  frameTheme: z.enum(['light', 'dark', 'auto']).optional().describe('Frame color theme (default: auto)'),
  background: z.enum([
    'ocean', 'sunset', 'forest', 'midnight', 'aurora', 'lavender', 'peach', 'arctic', 'ember', 'slate', 'neon',
    'glass', 'solid', 'spotlight', 'dots', 'grid', 'noise', 'none',
  ]).optional().describe(
    'Background style. Gradients: ocean, sunset, forest, midnight, aurora, lavender, peach, arctic, ember, slate, neon. ' +
    'Special: glass (frosted glass effect), solid, spotlight, dots, grid, noise. none = transparent.'
  ),
  bgColor: z.string().optional().describe('Background color as hex (e.g. "#1e3a5f"). Used for solid backgrounds or as base for patterns.'),
  bgColors: z.array(z.string()).optional().describe('Array of 2 hex colors for custom gradient (e.g. ["#1e3a5f", "#7c3aed"])'),
  padding: z.number().int().min(0).max(120).optional().describe('Padding around screenshot in pixels (default: 40)'),
  borderRadius: z.number().int().min(0).max(40).optional().describe('Corner radius in pixels (default: 12)'),
  shadow: z.enum(['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl']).optional().describe('Drop shadow size (default: md)'),
}).optional().describe(
  'Screenshot styling options — add a macOS/Windows frame, gradient/glass background, shadow, and rounded corners. ' +
  'Use the "theme" shortcut for one-click presets, or customize individual properties.'
);

// ─── Server Instructions ────────────────────────────────────────
const SERVER_INSTRUCTIONS = `
PageBolt gives you 8 tools for web capture and browser automation. All tools use your API key automatically.

## Tools Overview

| Tool | What it does | Cost |
|------|-------------|------|
| take_screenshot | Capture a URL, HTML, or Markdown as PNG/JPEG/WebP | 1 request |
| generate_pdf | Convert a URL or HTML to PDF, saves to disk | 1 request |
| create_og_image | Generate social card images from templates or custom HTML | 1 request |
| run_sequence | Multi-step browser automation with multiple screenshot/PDF outputs | 1 request per output |
| record_video | Record browser automation as MP4/WebM/GIF with cursor effects | 3 requests |
| inspect_page | Get structured map of page elements with CSS selectors | 1 request |
| list_devices | List 25+ device presets (iPhone, iPad, MacBook, etc.) | 0 (free) |
| check_usage | Check current API usage and plan limits | 0 (free) |

## Key Workflow: Inspect Before You Interact

When building sequences or videos, ALWAYS use inspect_page first to discover reliable CSS selectors:

1. inspect_page — returns buttons, inputs, forms, links, headings with unique selectors
2. run_sequence or record_video — use the selectors from step 1

This avoids guessing selectors like "#submit" when the actual element is "#submitBtn".

## Styling Screenshots

Use the "style" parameter on take_screenshot for beautiful styled captures:
- Quick: style.theme = "glass" or "ocean" or "linear" for one-click presets
- Custom: style.frame = "macos", style.background = "glass", style.shadow = "lg"

## Video Recording Features

record_video supports polished video output:
- frame: { enabled: true, style: "macos" } — browser chrome around the video
- background: { enabled: true, type: "gradient", gradient: "ocean" } — gradient/glass background with padding
- cursor: { style: "classic", persist: true } — always-visible cursor
- **Step notes (IMPORTANT)**: Add a "note" field to EVERY action step for guided-tour-style tooltip annotations. Notes appear as beautiful styled tooltips near the element being interacted with. Example: { action: "click", selector: "#btn", note: "Click here to open settings" }. The only steps that should NOT have notes are wait/wait_for pauses.
- **Audio Guide**: Add audioGuide: { enabled: true, script: "Welcome. {{1}} Click here. {{2}} Done." } for AI voice narration. Two modes: (1) Per-step — add "narration" text to individual steps. (2) Script — provide a single "script" with {{N}} markers for continuous narration synchronized to steps.
- Audio Guide voices: ava, andrew, emma, brian, aria, guy, jenny, davis, christopher, michelle (Azure) or alloy, echo, fable, nova, onyx, shimmer (OpenAI).
- **Variables**: Pass variables: { "base_url": "https://example.com" } and use {{base_url}} in step URLs/values for reusable recordings.

## IMPORTANT: Video Step Best Practices

- **Do NOT add wait steps between every action.** The "pace" parameter already adds natural pauses between steps. Only use wait when: (1) the page needs time to load after navigation, or (2) you want to hold on a view for narration. A typical video should have very few wait steps.
- **Do NOT use zoom unless the user explicitly asks for it.** Zoom adds visual complexity and encoding time. Omit zoom entirely by default.
- **Keep videos concise.** A good demo has 5-15 action steps (navigate, click, fill, hover, scroll). More steps = longer encoding time and larger files.

## Common Parameters (available on most tools)

- blockBanners: true — hides cookie consent banners (GDPR popups, OneTrust, CookieBot, etc.)
- blockAds: true — blocks advertisements
- blockChats: true — blocks live chat widgets (Intercom, Crisp, Drift)
- blockTrackers: true — blocks analytics trackers (GA, Hotjar, Segment)
- darkMode: true — emulates dark color scheme (prefers-color-scheme: dark)
- viewportDevice: "iphone_14_pro" — emulates a specific device (use list_devices to see all 25+)

Use blockBanners on almost every request to get clean captures. Combine blockAds + blockChats + blockTrackers for completely clean screenshots.

## Tips

- For screenshots of pages behind auth: use cookies, headers, or authorization params
- extractMetadata: true on take_screenshot returns title, description, OG tags, HTTP status
- response_type: "json" returns base64 data instead of binary (useful for programmatic use)
- record_video pace presets: "fast" (0.5x), "normal" (1x), "slow" (2x), "dramatic" (3x), "cinematic" (4.5x)
- record_video cursor styles: "highlight", "circle", "spotlight", "dot", "classic"
- run_sequence requires at least 1 screenshot or pdf step as output
- record_video does NOT allow screenshot/pdf steps — the whole sequence IS the video
- Max 2 evaluate (JavaScript) steps per sequence/video
- fullPage: true on screenshots captures the entire scrollable page
- fullPageScroll: true triggers lazy-loaded images before capture

## Cost Summary

| Action | Cost |
|--------|------|
| Screenshot, PDF, OG image, Inspect | 1 request each |
| Sequence | 1 request per output (screenshot/pdf) |
| Video recording | 3 requests flat |
| list_devices, check_usage | Free |
`.trim();

// ─── Create MCP Server ──────────────────────────────────────────
function createConfiguredServer() {
  const srv = new McpServer({
    name: 'pagebolt',
    version: '1.6.2',
  }, {
    instructions: SERVER_INSTRUCTIONS,
  });
  registerTools(srv);
  registerPrompts(srv);
  registerResources(srv);
  return srv;
}

const server = createConfiguredServer();

function registerTools(server) {

// ═══════════════════════════════════════════════════════════════════
// Tool: take_screenshot — COMPLETE coverage
// ═══════════════════════════════════════════════════════════════════
server.tool(
  'take_screenshot',
  'Capture a screenshot of a URL, HTML, or Markdown content. Supports device emulation, ad/chat/tracker blocking, metadata extraction, geolocation, timezone, styling (macOS/Windows frames, gradient/glass backgrounds, shadows), and more. Returns an image (PNG, JPEG, or WebP).',
  {
    // ── Source ──
    url: z.string().url().optional().describe('URL to capture (required if no html/markdown)'),
    html: z.string().optional().describe('Raw HTML to render (required if no url/markdown)'),
    markdown: z.string().optional().describe('Render Markdown content as a screenshot'),
    // ── Viewport ──
    width: z.number().int().min(1).max(3840).optional().describe('Viewport width in pixels (default: 1280)'),
    height: z.number().int().min(1).max(2160).optional().describe('Viewport height in pixels (default: 720)'),
    viewportDevice: z.string().optional().describe('Device preset for viewport emulation (e.g. "iphone_14_pro", "macbook_pro_14"). Use list_devices to see all presets.'),
    viewportMobile: z.boolean().optional().describe('Enable mobile meta viewport emulation'),
    viewportHasTouch: z.boolean().optional().describe('Enable touch event emulation'),
    viewportLandscape: z.boolean().optional().describe('Landscape orientation'),
    deviceScaleFactor: z.number().min(1).max(3).optional().describe('Device pixel ratio, use 2 for retina (default: 1)'),
    // ── Output format ──
    format: z.enum(['png', 'jpeg', 'webp']).optional().describe('Image format (default: png)'),
    quality: z.number().int().min(1).max(100).optional().describe('JPEG/WebP quality 1-100 (default: 80)'),
    omitBackground: z.boolean().optional().describe('Transparent background (PNG/WebP only)'),
    // ── Capture region ──
    fullPage: z.boolean().optional().describe('Capture the full scrollable page (default: false)'),
    fullPageScroll: z.boolean().optional().describe('Auto-scroll page before capture to trigger lazy-loaded images'),
    fullPageScrollDelay: z.number().int().min(0).max(2000).optional().describe('Delay between scroll steps in ms (default: 400)'),
    fullPageScrollBy: z.number().int().optional().describe('Pixels to scroll per step (default: viewport height)'),
    fullPageMaxHeight: z.number().int().optional().describe('Maximum pixel height cap for full-page captures'),
    selector: z.string().optional().describe('CSS selector to capture a specific element'),
    clip: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }).optional().describe('Crop region { x, y, width, height } in pixels'),
    // ── Timing ──
    delay: z.number().int().min(0).max(30000).optional().describe('Milliseconds to wait before capture (default: 0)'),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().describe('When to consider navigation finished (default: networkidle2)'),
    waitForSelector: z.string().optional().describe('Wait for this CSS selector to appear before capturing'),
    navigationTimeout: z.number().int().min(0).max(30000).optional().describe('Navigation timeout in ms (default: 25000)'),
    // ── Emulation ──
    darkMode: z.boolean().optional().describe('Emulate dark color scheme (default: false)'),
    reducedMotion: z.boolean().optional().describe('Emulate prefers-reduced-motion to disable animations'),
    mediaType: z.enum(['screen', 'print']).optional().describe('Emulate CSS media type'),
    timeZone: z.string().optional().describe('Override browser timezone (e.g. "America/New_York")'),
    geolocation: z.object({
      latitude: z.number(),
      longitude: z.number(),
      accuracy: z.number().optional(),
    }).optional().describe('Emulate geolocation { latitude, longitude, accuracy? }'),
    userAgent: z.string().optional().describe('Override the browser User-Agent string'),
    // ── Auth & headers ──
    cookies: z.array(cookieSchema).optional().describe('Cookies to set — array of "name=value" strings or { name, value, domain? } objects'),
    headers: z.record(z.string(), z.string()).optional().describe('Extra HTTP headers to send with the request'),
    authorization: z.string().optional().describe('Authorization header value (e.g. "Bearer <token>")'),
    bypassCSP: z.boolean().optional().describe('Bypass Content-Security-Policy on the page'),
    // ── Content manipulation ──
    hideSelectors: z.array(z.string()).optional().describe('Array of CSS selectors to hide before capture'),
    click: z.string().optional().describe('CSS selector to click before capturing the screenshot'),
    injectCss: z.string().optional().describe('Custom CSS to inject before capturing (max 50KB)'),
    injectJs: z.string().optional().describe('Custom JavaScript to execute before capturing (max 50KB)'),
    // ── Blocking ──
    blockBanners: z.boolean().optional().describe('Hide cookie consent banners (default: false)'),
    blockAds: z.boolean().optional().describe('Block advertisements on the page'),
    blockChats: z.boolean().optional().describe('Block live chat widgets on the page'),
    blockTrackers: z.boolean().optional().describe('Block tracking scripts on the page'),
    blockRequests: z.array(z.string()).optional().describe('URL patterns to block (array of strings)'),
    blockResources: z.array(z.string()).optional().describe('Resource types to block (e.g. ["image", "font"])'),
    // ── Metadata ──
    extractMetadata: z.boolean().optional().describe('Extract page metadata (title, description, OG tags) alongside the screenshot'),
    // ── Styling ──
    style: styleSchema,
  },
  async (params) => {
    if (!params.url && !params.html && !params.markdown) {
      return { content: [{ type: 'text', text: 'Error: One of "url", "html", or "markdown" is required.' }], isError: true };
    }

    const res = await callApi('/api/v1/screenshot', {
      method: 'POST',
      body: { ...params, response_type: 'json' },
    });

    const data = await res.json();
    const format = params.format || 'png';

    const content = [
      {
        type: 'image',
        data: data.data,
        mimeType: imageMimeType(format),
      },
      {
        type: 'text',
        text: `Screenshot captured successfully. Format: ${format}, Size: ${data.size_bytes} bytes, Duration: ${data.duration_ms}ms`,
      },
    ];

    // Include metadata if extracted
    if (data.metadata) {
      content.push({
        type: 'text',
        text: `Metadata:\n${JSON.stringify(data.metadata, null, 2)}`,
      });
    }

    return { content };
  }
);

// ═══════════════════════════════════════════════════════════════════
// Tool: generate_pdf — COMPLETE coverage
// ═══════════════════════════════════════════════════════════════════
server.tool(
  'generate_pdf',
  'Generate a PDF from a URL or HTML content. Supports custom margins, headers/footers, page ranges, and scaling. Saves the PDF to disk and returns the file path.',
  {
    url: z.string().url().optional().describe('URL to render as PDF (required if no html)'),
    html: z.string().optional().describe('Raw HTML to render as PDF (required if no url)'),
    format: z.string().optional().describe('Paper format: A4, Letter, Legal, Tabloid, A3, A5 (default: A4)'),
    landscape: z.boolean().optional().describe('Landscape orientation (default: false)'),
    printBackground: z.boolean().optional().describe('Include CSS backgrounds (default: true)'),
    margin: z.union([
      z.string(),
      z.object({
        top: z.string().optional(),
        right: z.string().optional(),
        bottom: z.string().optional(),
        left: z.string().optional(),
      }),
    ]).optional().describe('CSS margin — string for all sides (e.g. "1cm") or object { top, right, bottom, left }'),
    scale: z.number().min(0.1).max(2).optional().describe('Rendering scale 0.1-2 (default: 1)'),
    width: z.string().optional().describe('Page width (overrides format) — CSS value like "8.5in"'),
    pageRanges: z.string().optional().describe('Page ranges to include, e.g. "1-5, 8"'),
    headerTemplate: z.string().optional().describe('HTML template for page header (uses Chromium templating)'),
    footerTemplate: z.string().optional().describe('HTML template for page footer'),
    displayHeaderFooter: z.boolean().optional().describe('Show header and footer (default: false)'),
    delay: z.number().int().min(0).max(10000).optional().describe('Milliseconds to wait before rendering (default: 0)'),
    saveTo: z.string().optional().describe('Output file path (default: ./output.pdf)'),
  },
  async (params) => {
    if (!params.url && !params.html) {
      return { content: [{ type: 'text', text: 'Error: Either "url" or "html" is required.' }], isError: true };
    }

    const { saveTo, ...apiParams } = params;
    const res = await callApi('/api/v1/pdf', {
      method: 'POST',
      body: { ...apiParams, response_type: 'json' },
    });

    const data = await res.json();

    // Best-effort save to disk (may fail in hosted/sandboxed environments)
    let savedPath = null;
    try {
      const outputPath = safePath(saveTo, './output.pdf');
      const buffer = Buffer.from(data.data, 'base64');
      writeFileSync(outputPath, buffer);
      savedPath = outputPath;
    } catch (_diskErr) {
      // Disk write failed (e.g. hosted environment, read-only FS) — data is
      // still returned as an embedded resource below, so the client gets it.
    }

    const fileNote = savedPath
      ? `  File: ${savedPath}`
      : `  File: (not saved to disk — use the embedded resource data below)`;

    return {
      content: [
        {
          type: 'resource',
          resource: {
            uri: 'pagebolt://pdf/output.pdf',
            mimeType: 'application/pdf',
            blob: data.data,   // base64-encoded PDF — always delivered to client
          },
        },
        {
          type: 'text',
          text: `PDF generated successfully.\n` +
            `${fileNote}\n` +
            `  Size: ${data.size_bytes} bytes\n` +
            `  Duration: ${data.duration_ms}ms`,
        },
      ],
    };
  }
);

// ═══════════════════════════════════════════════════════════════════
// Tool: create_og_image — COMPLETE coverage
// ═══════════════════════════════════════════════════════════════════
server.tool(
  'create_og_image',
  'Generate an Open Graph / social card image. Returns an image using built-in templates or custom HTML.',
  {
    template: z.enum(['default', 'minimal', 'gradient']).optional().describe('Built-in template name (default: "default")'),
    html: z.string().optional().describe('Custom HTML template (overrides template parameter, Growth plan+)'),
    title: z.string().optional().describe('Main title text (default: "Your Title Here")'),
    subtitle: z.string().optional().describe('Subtitle text'),
    logo: z.string().optional().describe('Logo image URL'),
    bgColor: z.string().optional().describe('Background color as hex, e.g. "#0f172a"'),
    textColor: z.string().optional().describe('Text color as hex, e.g. "#f8fafc"'),
    accentColor: z.string().optional().describe('Accent color as hex, e.g. "#6366f1"'),
    bgImage: z.string().optional().describe('Background image URL'),
    width: z.number().int().min(1).max(2400).optional().describe('Image width in pixels (default: 1200)'),
    height: z.number().int().min(1).max(1260).optional().describe('Image height in pixels (default: 630)'),
    format: z.enum(['png', 'jpeg', 'webp']).optional().describe('Image format (default: png)'),
  },
  async (params) => {
    const res = await callApi('/api/v1/og-image', {
      method: 'POST',
      body: { ...params, response_type: 'json' },
    });

    const data = await res.json();
    const format = params.format || 'png';

    return {
      content: [
        {
          type: 'image',
          data: data.data,
          mimeType: imageMimeType(format),
        },
        {
          type: 'text',
          text: `OG image created successfully. Format: ${format}, Size: ${data.size_bytes} bytes, Duration: ${data.duration_ms}ms`,
        },
      ],
    };
  }
);

// ═══════════════════════════════════════════════════════════════════
// Tool: run_sequence — COMPLETE coverage
// ═══════════════════════════════════════════════════════════════════
server.tool(
  'run_sequence',
  'Execute a multi-step browser automation sequence. Navigate pages, interact with elements (click, fill, select), and capture multiple screenshots/PDFs in a single browser session. Each output counts as 1 API request.',
  {
    steps: z.array(
      z.object({
        action: z.enum([
          'navigate', 'click', 'dblclick', 'fill', 'select', 'hover',
          'scroll', 'wait', 'wait_for', 'evaluate',
          'screenshot', 'pdf',
        ]).describe('The action to perform'),
        url: z.string().url().optional().describe('URL to navigate to (for navigate action)'),
        selector: z.string().optional().describe('CSS selector for the target element (also used for element screenshots)'),
        value: z.string().optional().describe('Value to type or select'),
        ms: z.number().int().min(0).max(10000).optional().describe('Milliseconds to wait (for wait action)'),
        timeout: z.number().int().min(0).max(15000).optional().describe('Timeout in ms for wait_for (default: 10000)'),
        x: z.number().optional().describe('Horizontal scroll position'),
        y: z.number().optional().describe('Vertical scroll position'),
        script: z.string().max(5000).optional().describe('JavaScript to execute in page context (for evaluate action)'),
        name: z.string().optional().describe('Name for the output (for screenshot/pdf actions)'),
        format: z.string().optional().describe('Image format: png, jpeg, webp (screenshot) or A4, Letter (pdf)'),
        fullPage: z.boolean().optional().describe('Capture full scrollable page (for screenshot action)'),
        fullPageScroll: z.boolean().optional().describe('Auto-scroll for lazy images (for screenshot action)'),
        quality: z.number().int().min(1).max(100).optional().describe('JPEG/WebP quality (for screenshot action)'),
        omitBackground: z.boolean().optional().describe('Transparent background (for screenshot action)'),
        delay: z.number().int().min(0).max(10000).optional().describe('Pre-capture delay in ms (for screenshot action)'),
        landscape: z.boolean().optional().describe('Landscape orientation (for pdf action)'),
        printBackground: z.boolean().optional().describe('Include CSS backgrounds (for pdf action)'),
        margin: z.string().optional().describe('CSS margin for all sides (for pdf action)'),
        scale: z.number().min(0.1).max(2).optional().describe('Rendering scale (for pdf action)'),
        style: styleSchema,
      })
    ).min(1).max(20).describe('Array of steps to execute in order. Must include at least one screenshot or pdf step. Max 20 steps, max 5 outputs.'),
    viewport: z.object({
      width: z.number().int().min(320).max(3840).optional().describe('Viewport width (default: 1280)'),
      height: z.number().int().min(200).max(2160).optional().describe('Viewport height (default: 720)'),
    }).optional().describe('Browser viewport size'),
    darkMode: z.boolean().optional().describe('Emulate dark color scheme (default: false)'),
    blockBanners: z.boolean().optional().describe('Hide cookie consent banners (default: false)'),
    blockAds: z.boolean().optional().describe('Block advertisements on the page'),
    blockChats: z.boolean().optional().describe('Block live chat widgets'),
    blockTrackers: z.boolean().optional().describe('Block tracking scripts'),
    deviceScaleFactor: z.number().min(1).max(3).optional().describe('Device pixel ratio (default: 1)'),
  },
  async (params) => {
    if (!params.steps || params.steps.length === 0) {
      return { content: [{ type: 'text', text: 'Error: "steps" must be a non-empty array.' }], isError: true };
    }

    try {
      const res = await callApi('/api/v1/sequence', {
        method: 'POST',
        body: params,
      });

      const data = await res.json();
      const content = [];

      for (const output of data.outputs) {
        if (output.type === 'screenshot') {
          content.push({
            type: 'image',
            data: output.data,
            mimeType: output.content_type,
          });
          content.push({
            type: 'text',
            text: `[${output.name}] Screenshot — ${output.format}, ${output.size_bytes} bytes, step ${output.step_index}`,
          });
        } else if (output.type === 'pdf') {
          content.push({
            type: 'text',
            text: `[${output.name}] PDF generated — ${output.format}, ${output.size_bytes} bytes, step ${output.step_index} (base64 data available in raw response)`,
          });
        }
      }

      const failedSteps = data.step_results.filter(s => s.status === 'error');
      let summary = `Sequence complete: ${data.steps_completed}/${data.total_steps} steps, ${data.outputs.length} outputs, ${data.total_duration_ms}ms total.`;
      if (failedSteps.length > 0) {
        summary += `\nFailed steps: ${failedSteps.map(s => `Step ${s.step_index} (${s.action}): ${s.error}`).join('; ')}`;
      }
      summary += `\nUsage: ${data.usage.outputs_charged} request(s) charged, ${data.usage.remaining} remaining.`;

      content.push({ type: 'text', text: summary });
      return { content };
    } catch (err) {
      return { content: [{ type: 'text', text: `Sequence error: ${err.message}` }], isError: true };
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// Tool: record_video — COMPLETE coverage
// ═══════════════════════════════════════════════════════════════════
server.tool(
  'record_video',
  'Record a professional demo video of a multi-step browser automation sequence. Produces MP4/WebM/GIF with cursor highlighting, click effects, smooth movement, step notes, browser frame (macOS/Windows), gradient/glass backgrounds, and more. Costs 3 API requests. Saves to disk. BEST PRACTICE: Keep videos concise (5-15 action steps). Do NOT add wait steps between every action — the pace parameter handles timing. Only use wait for page loads or narration holds. Do NOT use zoom unless the user explicitly asks for it.',
  {
    steps: z.array(
      z.object({
        action: z.enum([
          'navigate', 'click', 'dblclick', 'fill', 'select', 'hover',
          'scroll', 'wait', 'wait_for', 'evaluate',
        ]).describe('The action to perform (no screenshot/pdf — the whole sequence is recorded as video)'),
        url: z.string().url().optional().describe('URL to navigate to (for navigate action)'),
        selector: z.string().optional().describe('CSS selector for the target element'),
        value: z.string().optional().describe('Value to type or select'),
        ms: z.number().int().min(0).max(10000).optional().describe('Milliseconds to wait (for wait action). Only use wait steps when the page needs loading time or to hold for narration — the pace parameter handles inter-step timing automatically.'),
        timeout: z.number().int().min(0).max(15000).optional().describe('Timeout in ms for wait_for (default: 10000)'),
        x: z.number().optional().describe('Horizontal scroll position'),
        y: z.number().optional().describe('Vertical scroll position'),
        script: z.string().max(5000).optional().describe('JavaScript to execute in page context (for evaluate action)'),
        note: z.string().max(200).optional().describe('Tooltip annotation text shown during this step (max 200 chars)'),
        narration: z.string().max(500).optional().describe('Text to speak at this step (max 500 chars, requires audioGuide.enabled). Used in per-step mode.'),
        live: z.boolean().optional().describe('For wait steps: true captures animated content in real-time, false freezes a single frame (default: false)'),
        zoom: z.object({
          enabled: z.boolean().optional().describe('Enable zoom on this step (default: false). Only use when user explicitly requests zoom.'),
          level: z.number().min(1.2).max(4).optional().describe('Zoom magnification (inherits from global zoom.level if not set)'),
        }).optional().describe('Per-step zoom override. Do NOT add zoom unless the user specifically requests it — it adds encoding time and visual complexity.'),
      })
    ).min(1).max(50).describe('Array of action steps to record. Keep concise: 5-15 steps is ideal. Do NOT pad with wait steps — pace handles timing.'),
    viewport: z.object({
      width: z.number().int().min(320).max(3840).optional().describe('Viewport width (default: 1280)'),
      height: z.number().int().min(200).max(2160).optional().describe('Viewport height (default: 720)'),
    }).optional().describe('Browser viewport size'),
    format: z.enum(['mp4', 'webm', 'gif']).optional().describe('Video format (default: mp4). webm/gif require Starter+ plan.'),
    framerate: z.number().int().optional().describe('Frames per second: 24, 30, or 60 (default: 30)'),
    // ── Cursor ──
    cursor: z.object({
      visible: z.boolean().optional().describe('Show cursor overlay (default: true)'),
      style: z.enum(['highlight', 'circle', 'spotlight', 'dot', 'classic']).optional().describe('Cursor style (default: highlight). classic = natural arrow cursor.'),
      color: z.string().optional().describe('Cursor color as hex, e.g. "#3B82F6" (default: blue)'),
      size: z.number().int().min(8).max(60).optional().describe('Cursor size in pixels (default: 20)'),
      smoothing: z.boolean().optional().describe('Smooth animated cursor movement (default: true)'),
      opacity: z.number().min(0.1).max(1.0).optional().describe('Cursor opacity 0.1-1.0 (default: 1.0)'),
      persist: z.boolean().optional().describe('Keep cursor visible between actions, not just during them (default: false)'),
    }).optional().describe('Cursor appearance settings'),
    // ── Zoom (global defaults, per-step overrides available) ──
    zoom: z.object({
      enabled: z.boolean().optional().describe('Enable auto-zoom on clicks (default: false — use per-step zoom instead)'),
      level: z.number().min(1.2).max(4).optional().describe('Default zoom magnification (default: 1.5)'),
      duration: z.number().int().min(400).max(3000).optional().describe('Zoom animation duration in ms (default: 1200)'),
      easing: z.enum(['ease-in-out', 'linear', 'ease']).optional().describe('Zoom animation easing (default: ease-in-out)'),
    }).optional().describe('Global zoom settings. Only use when the user explicitly requests zoom. Do NOT enable by default.'),
    autoZoom: z.boolean().optional().describe('Enable auto-zoom on all clicks (default: false). Only use when user explicitly requests zoom.'),
    // ── Click effects ──
    clickEffect: z.object({
      enabled: z.boolean().optional().describe('Show click ripple effects (default: true)'),
      style: z.enum(['ripple', 'pulse', 'ring']).optional().describe('Click effect style (default: ripple)'),
      color: z.string().optional().describe('Click effect color as hex'),
    }).optional().describe('Visual click effect settings'),
    // ── Pace ──
    pace: z.union([
      z.number().min(0.25).max(6),
      z.enum(['fast', 'normal', 'slow', 'dramatic', 'cinematic']),
    ]).optional().describe('Controls how deliberate the video feels. Number (0.25–6.0, higher = slower) or preset: "fast" (0.5×), "normal" (1×), "slow" (2×), "dramatic" (3×), "cinematic" (4.5×). Default: "normal".'),
    // ── Frame (browser chrome) ──
    frame: z.object({
      enabled: z.boolean().optional().describe('Enable browser frame around the video (default: false)'),
      style: z.enum(['macos', 'windows', 'minimal']).optional().describe('Frame style: macos (traffic lights), windows (min/max/close), minimal (dots only). Default: macos.'),
      theme: z.enum(['light', 'dark', 'auto']).optional().describe('Frame color theme (default: auto)'),
      showUrl: z.boolean().optional().describe('Show URL in the frame bar (default: true)'),
    }).optional().describe('Browser chrome frame around the video. Adds a macOS/Windows-style title bar.'),
    // ── Background ──
    background: z.object({
      enabled: z.boolean().optional().describe('Enable styled background (default: false)'),
      type: z.enum(['solid', 'gradient']).optional().describe('Background type (default: gradient)'),
      gradient: z.enum([
        'ocean', 'sunset', 'forest', 'midnight', 'aurora',
        'lavender', 'peach', 'arctic', 'ember', 'slate', 'neon', 'custom',
      ]).optional().describe('Gradient preset name. 12 built-in presets, or "custom" to use colors array. Default: ocean.'),
      color: z.string().optional().describe('Solid background color as hex (e.g. "#1e3a5f"). Used when type is "solid" or gradient is "custom".'),
      colors: z.array(z.string()).optional().describe('Array of 2 hex colors for custom gradient (e.g. ["#1e3a5f", "#7c3aed"]). Only used when gradient is "custom".'),
      padding: z.number().int().min(0).max(120).optional().describe('Padding around the video in pixels (default: 40)'),
      borderRadius: z.number().int().min(0).max(40).optional().describe('Corner radius in pixels (default: 12)'),
    }).optional().describe('Styled background behind the video. Adds gradient/solid background with padding and rounded corners — creates a "floating window" effect.'),
    // ── Blocking ──
    darkMode: z.boolean().optional().describe('Emulate dark color scheme (default: false)'),
    blockBanners: z.boolean().optional().describe('Hide cookie consent banners (default: true for videos)'),
    blockAds: z.boolean().optional().describe('Block advertisements on the page'),
    blockChats: z.boolean().optional().describe('Block live chat widgets'),
    blockTrackers: z.boolean().optional().describe('Block tracking scripts'),
    deviceScaleFactor: z.number().min(1).max(3).optional().describe('Device pixel ratio (default: 1)'),
    // ── Audio Guide ──
    audioGuide: z.object({
      enabled: z.boolean().optional().describe('Enable Audio Guide narration'),
      provider: z.enum(['azure', 'openai']).optional().describe('TTS provider (default: azure)'),
      voice: z.string().optional().describe('Voice preset: ava, andrew, emma, brian, aria, guy, jenny, davis, christopher, michelle (azure) or alloy, echo, fable, nova, onyx, shimmer (openai)'),
      speed: z.number().min(0.5).max(2.0).optional().describe('Speech rate (default: 1.0)'),
      pitch: z.string().optional().describe('Voice pitch: default, x-low, low, medium, high, x-high (Azure only)'),
      volume: z.string().optional().describe('Audio volume: default, silent, x-soft, soft, medium, loud, x-loud (Azure only)'),
      style: z.string().optional().describe('Speaking style: narration-professional, cheerful, excited, friendly, etc. (Azure only)'),
      styleDegree: z.number().min(0.01).max(2.0).optional().describe('Style intensity 0.01-2.0 (Azure only)'),
      model: z.enum(['tts-1', 'tts-1-hd']).optional().describe('OpenAI model (OpenAI only, default: tts-1)'),
      script: z.string().max(5000).optional().describe('Script mode: a single narration script with {{N}} step markers (0-indexed) for synchronized narration. Steps execute when narration reaches each marker. When provided, per-step "narration" fields are ignored.'),
    }).optional().describe('Audio Guide TTS settings. Two modes: (1) Per-step — add "narration" to individual steps. (2) Script — provide "script" with {{N}} markers for continuous narration synchronized to steps.'),
    variables: z.record(z.string()).optional().describe('Key-value map for variable substitution in step URLs/values. E.g. { "base_url": "https://example.com" } replaces {{base_url}} in steps.'),
    saveTo: z.string().optional().describe('Output file path (default: ./recording.mp4)'),
  },
  async (params) => {
    if (!params.steps || params.steps.length === 0) {
      return { content: [{ type: 'text', text: 'Error: "steps" must be a non-empty array.' }], isError: true };
    }

    try {
      const { saveTo, ...apiParams } = params;

      const res = await callApi('/api/v1/video', {
        method: 'POST',
        body: { ...apiParams, response_type: 'json' },
      });

      const data = await res.json();
      const format = params.format || 'mp4';
      const ext = format === 'gif' ? 'gif' : format;

      // Determine video MIME type
      const videoMimeTypes = { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' };
      const mimeType = videoMimeTypes[ext] || 'video/mp4';

      // Best-effort save to disk (may fail in hosted/sandboxed environments)
      let savedPath = null;
      try {
        const outputPath = safePath(saveTo, `./recording.${ext}`);
        const buffer = Buffer.from(data.data, 'base64');
        writeFileSync(outputPath, buffer);
        savedPath = outputPath;
      } catch (_diskErr) {
        // Disk write failed (e.g. hosted environment, read-only FS) — data is
        // still returned as an embedded resource below, so the client gets it.
      }

      const durationSec = (data.duration_ms / 1000).toFixed(1);
      const fileNote = savedPath
        ? `  File:     ${savedPath}\n`
        : `  File:     (not saved to disk — use the embedded resource data below)\n`;

      return {
        content: [
          {
            type: 'resource',
            resource: {
              uri: `pagebolt://video/recording.${ext}`,
              mimeType,
              blob: data.data,   // base64-encoded video — always delivered to client
            },
          },
          {
            type: 'text',
            text: `Video recorded successfully.\n` +
              fileNote +
              `  Format:   ${data.format}\n` +
              `  Size:     ${(data.size_bytes / 1024).toFixed(1)} KB\n` +
              `  Duration: ${durationSec}s\n` +
              `  Frames:   ${data.frames}\n` +
              `  Steps:    ${data.steps_completed}/${data.total_steps} completed\n` +
              `  Cost:     ${data.usage.video_cost} API requests\n` +
              `  Remaining: ${data.usage.remaining} requests`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Video recording error: ${err.message}` }], isError: true };
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// Tool: inspect_page — COMPLETE coverage
// ═══════════════════════════════════════════════════════════════════
server.tool(
  'inspect_page',
  'Inspect a web page and get a structured map of all interactive elements, headings, forms, links, and images — each with a unique CSS selector. Use this BEFORE run_sequence or record_video to discover what elements exist on the page and get reliable selectors. Returns text (not an image), so it is fast and cheap. Costs 1 API request.',
  {
    // ── Source ──
    url: z.string().url().optional().describe('URL to inspect (required if no html)'),
    html: z.string().optional().describe('Raw HTML to inspect (required if no url)'),
    // ── Viewport ──
    width: z.number().int().min(1).max(3840).optional().describe('Viewport width in pixels (default: 1280)'),
    height: z.number().int().min(1).max(2160).optional().describe('Viewport height in pixels (default: 720)'),
    viewportDevice: z.string().optional().describe('Device preset for viewport emulation (e.g. "iphone_14_pro"). Use list_devices to see all presets.'),
    viewportMobile: z.boolean().optional().describe('Enable mobile meta viewport emulation'),
    viewportHasTouch: z.boolean().optional().describe('Enable touch event emulation'),
    viewportLandscape: z.boolean().optional().describe('Landscape orientation'),
    deviceScaleFactor: z.number().min(1).max(3).optional().describe('Device pixel ratio (default: 1)'),
    // ── Timing ──
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().describe('When to consider navigation finished (default: networkidle2)'),
    waitForSelector: z.string().optional().describe('Wait for this CSS selector to appear before inspecting'),
    navigationTimeout: z.number().int().min(0).max(30000).optional().describe('Navigation timeout in ms (default: 25000)'),
    // ── Emulation ──
    darkMode: z.boolean().optional().describe('Emulate dark color scheme (default: false)'),
    reducedMotion: z.boolean().optional().describe('Emulate prefers-reduced-motion'),
    mediaType: z.enum(['screen', 'print']).optional().describe('Emulate CSS media type'),
    timeZone: z.string().optional().describe('Override browser timezone'),
    geolocation: z.object({
      latitude: z.number(),
      longitude: z.number(),
      accuracy: z.number().optional(),
    }).optional().describe('Emulate geolocation'),
    userAgent: z.string().optional().describe('Override the browser User-Agent string'),
    // ── Auth & headers ──
    cookies: z.array(cookieSchema).optional().describe('Cookies to set — array of "name=value" strings or { name, value, domain? } objects'),
    headers: z.record(z.string(), z.string()).optional().describe('Extra HTTP headers to send with the request'),
    authorization: z.string().optional().describe('Authorization header value (e.g. "Bearer <token>")'),
    bypassCSP: z.boolean().optional().describe('Bypass Content-Security-Policy on the page'),
    // ── Content manipulation ──
    hideSelectors: z.array(z.string()).optional().describe('Array of CSS selectors to hide before inspecting'),
    injectCss: z.string().optional().describe('Custom CSS to inject before inspecting'),
    injectJs: z.string().optional().describe('Custom JavaScript to execute before inspecting'),
    // ── Blocking ──
    blockBanners: z.boolean().optional().describe('Hide cookie consent banners (default: false)'),
    blockAds: z.boolean().optional().describe('Block advertisements on the page'),
    blockChats: z.boolean().optional().describe('Block live chat widgets'),
    blockTrackers: z.boolean().optional().describe('Block tracking scripts'),
    blockRequests: z.array(z.string()).optional().describe('URL patterns to block'),
    blockResources: z.array(z.string()).optional().describe('Resource types to block'),
  },
  async (params) => {
    if (!params.url && !params.html) {
      return { content: [{ type: 'text', text: 'Error: Either "url" or "html" is required.' }], isError: true };
    }

    try {
      const res = await callApi('/api/v1/inspect', {
        method: 'POST',
        body: params,
      });

      const data = await res.json();

      // Format as structured text for efficient LLM consumption
      const lines = [];

      lines.push(`Page: ${data.title || '(untitled)'} (${data.url || params.url || 'html content'})`);
      if (data.metadata) {
        if (data.metadata.description) lines.push(`Description: ${data.metadata.description}`);
        if (data.metadata.lang) lines.push(`Language: ${data.metadata.lang}`);
        if (data.metadata.httpStatusCode) lines.push(`HTTP Status: ${data.metadata.httpStatusCode}`);
      }
      lines.push('');

      if (data.headings && data.headings.length > 0) {
        lines.push(`Headings (${data.headings.length}):`);
        for (const h of data.headings) {
          lines.push(`  H${h.level}: ${h.text} — selector: ${h.selector}`);
        }
        lines.push('');
      }

      if (data.elements && data.elements.length > 0) {
        lines.push(`Interactive Elements (${data.elements.length}):`);
        for (const el of data.elements) {
          let desc = `[${el.tag}`;
          if (el.attributes && el.attributes.type) desc += ` type=${el.attributes.type}`;
          desc += `]`;
          if (el.text) desc += ` "${el.text}"`;
          if (el.attributes && el.attributes.placeholder) desc += ` placeholder="${el.attributes.placeholder}"`;
          if (el.attributes && el.attributes.href) desc += ` → ${el.attributes.href}`;
          desc += ` — selector: ${el.selector}`;
          lines.push(`  ${desc}`);
        }
        lines.push('');
      }

      if (data.forms && data.forms.length > 0) {
        lines.push(`Forms (${data.forms.length}):`);
        for (const f of data.forms) {
          const method = f.method || 'GET';
          const action = f.action || '(none)';
          lines.push(`  ${f.selector} (${method} ${action}): ${f.fields.length} field(s)`);
          for (const field of f.fields) {
            lines.push(`    - ${field}`);
          }
        }
        lines.push('');
      }

      if (data.links && data.links.length > 0) {
        lines.push(`Links (${data.links.length}):`);
        for (const l of data.links) {
          lines.push(`  "${l.text || '(no text)'}" → ${l.href} — selector: ${l.selector}`);
        }
        lines.push('');
      }

      if (data.images && data.images.length > 0) {
        lines.push(`Images (${data.images.length}):`);
        for (const img of data.images) {
          const alt = img.alt ? `"${img.alt}"` : '(no alt)';
          lines.push(`  ${alt} src=${img.src} — selector: ${img.selector}`);
        }
        lines.push('');
      }

      lines.push(`Duration: ${data.duration_ms}ms`);

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Inspect error: ${err.message}` }], isError: true };
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// Tool: list_devices
// ═══════════════════════════════════════════════════════════════════
server.tool(
  'list_devices',
  'List all available device presets for viewport emulation (e.g. iphone_14_pro, macbook_pro_14). Use the returned device names with the viewportDevice parameter in take_screenshot.',
  {},
  async () => {
    const res = await callApi('/api/v1/devices');
    const data = await res.json();

    const lines = data.devices.map((d) => {
      const touch = d.hasTouch ? ', touch' : '';
      const mobile = d.isMobile ? ', mobile' : '';
      return `  ${d.name} — ${d.viewport.width}x${d.viewport.height} @${d.viewport.deviceScaleFactor}x${mobile}${touch}`;
    });

    return {
      content: [
        {
          type: 'text',
          text:
            `Available device presets (${data.devices.length}):\n` +
            lines.join('\n') +
            `\n\nUse the device name as the "viewportDevice" parameter in take_screenshot.`,
        },
      ],
    };
  }
);

// ═══════════════════════════════════════════════════════════════════
// Tool: check_usage
// ═══════════════════════════════════════════════════════════════════
server.tool(
  'check_usage',
  'Check your current PageBolt API usage and plan limits.',
  {},
  async () => {
    const res = await callApi('/api/v1/usage');
    const data = await res.json();

    const { plan, usage } = data;
    const pct = usage.limit > 0 ? Math.round((usage.current / usage.limit) * 100) : 0;

    return {
      content: [
        {
          type: 'text',
          text:
            `PageBolt Usage\n` +
            `  Plan:      ${plan}\n` +
            `  Used:      ${usage.current.toLocaleString()} / ${usage.limit.toLocaleString()} requests\n` +
            `  Remaining: ${usage.remaining.toLocaleString()}\n` +
            `  Usage:     ${pct}%`,
        },
      ],
    };
  }
);

} // end registerTools

// ─── Prompts ────────────────────────────────────────────────────
function registerPrompts(server) {

  server.prompt(
    'capture-page',
    'Capture a clean screenshot of any URL with sensible defaults. Optionally inspects the page first.',
    {
      url: z.string().describe('The URL to capture'),
      device: z.string().optional().describe('Device preset, e.g. "iphone_14_pro" or "macbook_pro_14"'),
      dark_mode: z.enum(['true', 'false']).optional().describe('Enable dark mode (default: false)'),
      full_page: z.enum(['true', 'false']).optional().describe('Capture the full scrollable page (default: false)'),
      style_theme: z.enum([
        'notion', 'paper', 'vercel', 'glass', 'ocean', 'sunset',
        'linear', 'arc', 'glassDark', 'glassWarm', 'spotlight',
        'neonBlue', 'neonPurple', 'neonGreen', 'lavender', 'ember', 'dots', 'grid',
        'none',
      ]).optional().describe('Screenshot style theme (default: none). Use "glass" for frosted glass, "ocean" for gradient, "linear" for Linear-style dark.'),
    },
    (args) => {
      const device = args.device ? `\n- Use device preset: ${args.device}` : '';
      const dark = args.dark_mode === 'true' ? '\n- Enable dark mode' : '';
      const full = args.full_page === 'true' ? '\n- Capture the full scrollable page' : '';
      const style = args.style_theme && args.style_theme !== 'none'
        ? `\n- Apply style theme: "${args.style_theme}" (adds frame, background, shadow)`
        : '';

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Take a clean screenshot of ${args.url} with these settings:
- Block banners, ads, chats, and trackers for a clean capture${device}${dark}${full}${style}
- Use PNG format

Call take_screenshot with:
  url: "${args.url}"
  blockBanners: true
  blockAds: true
  blockChats: true
  blockTrackers: true${args.device ? `\n  viewportDevice: "${args.device}"` : ''}${args.dark_mode === 'true' ? '\n  darkMode: true' : ''}${args.full_page === 'true' ? '\n  fullPage: true\n  fullPageScroll: true' : ''}${args.style_theme && args.style_theme !== 'none' ? `\n  style: { theme: "${args.style_theme}" }` : ''}`,
            },
          },
        ],
      };
    }
  );

  server.prompt(
    'record-demo',
    'Record a professional demo video of a web page or flow. Generates a step sequence automatically.',
    {
      url: z.string().describe('The starting URL to record'),
      description: z.string().describe('What the demo should show, e.g. "Sign in and explore the dashboard"'),
      pace: z.enum(['fast', 'normal', 'slow', 'dramatic', 'cinematic']).optional().describe('Video pace preset (default: normal)'),
      format: z.enum(['mp4', 'webm', 'gif']).optional().describe('Output format (default: mp4)'),
      frame: z.enum(['macos', 'windows', 'minimal', 'none']).optional().describe('Browser frame style (default: none)'),
      background: z.enum(['ocean', 'sunset', 'midnight', 'glass', 'none']).optional().describe('Background style (default: none)'),
    },
    (args) => {
      const pace = args.pace || 'normal';
      const format = args.format || 'mp4';
      const frame = args.frame || 'none';
      const bg = args.background || 'none';

      const frameConfig = frame !== 'none'
        ? `\n   - frame: { enabled: true, style: "${frame}", theme: "dark" }`
        : '';
      const bgConfig = bg !== 'none'
        ? `\n   - background: { enabled: true, type: "gradient", gradient: "${bg}", padding: 40, borderRadius: 12 }`
        : '';

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Record a professional demo video. Here's what I need:

**Starting URL:** ${args.url}
**What to demo:** ${args.description}
**Pace:** ${pace}
**Format:** ${format}

Please follow this workflow:

1. First, call inspect_page on ${args.url} (with blockBanners: true) to discover the page structure and get reliable CSS selectors.

2. Based on the inspection results and the description above, plan a sequence of steps (navigate, click, fill, scroll, wait, etc.) that demonstrates the described flow.

3. Call record_video with:
   - The planned steps array
   - format: "${format}"
   - pace: "${pace}"
   - blockBanners: true
   - cursor: { style: "classic", visible: true, persist: true }
   - clickEffect: { style: "ripple" }${frameConfig}${bgConfig}

Important tips:
- Use selectors from the inspect_page results — never guess selectors
- Do NOT add wait steps between every action — the pace parameter already handles timing between steps. Only use wait when: (1) the page needs time to load new content after navigation, or (2) you need to hold on a view for narration.
- Do NOT use zoom unless I specifically ask for it
- **ALWAYS add a "note" field on every meaningful step** — notes render as styled tooltip annotations that explain what's happening, creating a guided tour experience. Examples:
  - navigate: note: "Opening the dashboard"
  - click: note: "This button creates a new project"
  - fill: note: "Enter your email to get started"
  - hover: note: "Hover to reveal the dropdown menu"
  - The ONLY steps without notes should be wait/wait_for (pauses)
- Keep to 5-15 action steps for best results. Fewer steps = faster encoding and smaller files.
- Each video costs 3 API requests`,
            },
          },
        ],
      };
    }
  );

  server.prompt(
    'audit-page',
    'Inspect a page and return a structured analysis of its elements, forms, links, and interactive components.',
    {
      url: z.string().describe('The URL to audit'),
    },
    (args) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Perform a structured audit of ${args.url}.

1. Call inspect_page with:
   - url: "${args.url}"
   - blockBanners: true
   - blockAds: true

2. Analyze the results and provide a clear summary:
   - **Page overview:** Title, description, language, HTTP status
   - **Navigation:** List all nav links with their destinations
   - **Forms:** List all forms with their fields and actions
   - **Interactive elements:** Buttons, dropdowns, toggles with their selectors
   - **Headings:** Document outline (h1-h6 hierarchy)
   - **Images:** Count and list images missing alt text
   - **Potential issues:** Missing form labels, broken links, accessibility concerns

3. If this page will be used for automation (sequence/video), list the most useful CSS selectors the user should know about.`,
            },
          },
        ],
      };
    }
  );

} // end registerPrompts

// ─── Resources ──────────────────────────────────────────────────
function registerResources(server) {

  server.resource(
    'api-docs',
    'pagebolt://api-docs',
    { description: 'Complete PageBolt API reference with all endpoints, parameters, examples, and plan limits. Read this for detailed documentation beyond tool descriptions.', mimeType: 'text/plain' },
    async () => {
      try {
        const res = await fetch(`${BASE_URL}/llms-full.txt`);
        if (res.ok) {
          const text = await res.text();
          return { contents: [{ uri: 'pagebolt://api-docs', text, mimeType: 'text/plain' }] };
        }
      } catch (_) {
        // fall through to embedded fallback
      }
      return {
        contents: [{
          uri: 'pagebolt://api-docs',
          text: 'Full API docs available at https://pagebolt.dev/docs or https://pagebolt.dev/llms-full.txt',
          mimeType: 'text/plain',
        }],
      };
    }
  );

} // end registerResources

// ─── Smithery sandbox export ─────────────────────────────────────
export function createSandboxServer() {
  return createConfiguredServer();
}

// ─── Start ──────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
