#!/usr/bin/env node

/**
 * PageBolt MCP Server
 *
 * A Model Context Protocol (MCP) server that exposes PageBolt's
 * screenshot, PDF, and OG image APIs as tools for AI coding assistants
 * (Claude Desktop, Cursor, Windsurf, Cline, etc.).
 *
 * Get your free API key at https://pagebolt.dev
 *
 * Configuration (environment variables):
 *   PAGEBOLT_API_KEY   — Required. Your PageBolt API key.
 *   PAGEBOLT_BASE_URL  — Optional. Defaults to https://pagebolt.dev
 *
 * Usage:
 *   npx pagebolt-mcp
 *   # or after global install:
 *   pagebolt-mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    'user-agent': 'pagebolt-mcp/1.0.0',
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

// ─── Server Instructions ────────────────────────────────────────
// Sent to the AI agent on connection so it knows how to use the tools.
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
- record_video cursor styles: "highlight", "circle", "spotlight", "dot"
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
    version: '1.3.0',
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

// ─── Tool: take_screenshot ──────────────────────────────────────
server.tool(
  'take_screenshot',
  'Capture a screenshot of a URL, HTML, or Markdown content. 30+ parameters including device emulation, ad/chat/tracker blocking, metadata extraction, geolocation, timezone, and more. Returns an image (PNG, JPEG, or WebP).',
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
    deviceScaleFactor: z.number().min(1).max(3).optional().describe('Device pixel ratio, use 2 for retina (default: 1)'),
    // ── Output format ──
    format: z.enum(['png', 'jpeg', 'webp']).optional().describe('Image format (default: png)'),
    quality: z.number().int().min(1).max(100).optional().describe('JPEG/WebP quality 1-100 (default: 80)'),
    omitBackground: z.boolean().optional().describe('Transparent background (PNG/WebP only)'),
    // ── Capture region ──
    fullPage: z.boolean().optional().describe('Capture the full scrollable page (default: false)'),
    fullPageScroll: z.boolean().optional().describe('Auto-scroll page before capture to trigger lazy-loaded images'),
    fullPageMaxHeight: z.number().int().optional().describe('Maximum pixel height cap for full-page captures'),
    selector: z.string().optional().describe('CSS selector to capture a specific element'),
    clip: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }).optional().describe('Crop region { x, y, width, height } in pixels'),
    // ── Timing ──
    delay: z.number().int().min(0).max(10000).optional().describe('Milliseconds to wait before capture (default: 0)'),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().describe('When to consider navigation finished (default: networkidle2)'),
    waitForSelector: z.string().optional().describe('Wait for this CSS selector to appear before capturing'),
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
    cookies: z.array(
      z.union([
        z.string(),
        z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string().optional(),
        }),
      ])
    ).optional().describe('Cookies to set — array of "name=value" strings or { name, value, domain? } objects'),
    headers: z.record(z.string(), z.string()).optional().describe('Extra HTTP headers to send with the request'),
    authorization: z.string().optional().describe('Authorization header value (e.g. "Bearer <token>")'),
    bypassCSP: z.boolean().optional().describe('Bypass Content-Security-Policy on the page'),
    // ── Content manipulation ──
    hideSelectors: z.array(z.string()).optional().describe('Array of CSS selectors to hide before capture'),
    click: z.string().optional().describe('CSS selector to click before capturing the screenshot'),
    blockBanners: z.boolean().optional().describe('Hide cookie consent banners (default: false)'),
    blockAds: z.boolean().optional().describe('Block advertisements on the page'),
    blockChats: z.boolean().optional().describe('Block live chat widgets on the page'),
    blockTrackers: z.boolean().optional().describe('Block tracking scripts on the page'),
    // ── Extras ──
    extractMetadata: z.boolean().optional().describe('Extract page metadata (title, description, OG tags) alongside the screenshot'),
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

    return {
      content: [
        {
          type: 'image',
          data: data.data,
          mimeType: imageMimeType(format),
        },
        {
          type: 'text',
          text: `Screenshot captured successfully. Format: ${format}, Size: ${data.size_bytes} bytes, Duration: ${data.duration_ms}ms`,
        },
      ],
    };
  }
);

// ─── Tool: generate_pdf ─────────────────────────────────────────
server.tool(
  'generate_pdf',
  'Generate a PDF from a URL or HTML content. Saves the PDF to disk and returns the file path.',
  {
    url: z.string().url().optional().describe('URL to render as PDF (required if no html)'),
    html: z.string().optional().describe('Raw HTML to render as PDF (required if no url)'),
    format: z.string().optional().describe('Paper format: A4, Letter, Legal, Tabloid (default: A4)'),
    landscape: z.boolean().optional().describe('Landscape orientation (default: false)'),
    printBackground: z.boolean().optional().describe('Include CSS backgrounds (default: true)'),
    margin: z.string().optional().describe('CSS margin for all sides, e.g. "1cm" or "0.5in"'),
    scale: z.number().min(0.1).max(2).optional().describe('Rendering scale 0.1-2 (default: 1)'),
    pageRanges: z.string().optional().describe('Page ranges to include, e.g. "1-5, 8"'),
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
    const outputPath = resolve(saveTo || './output.pdf');

    // Decode base64 and write to disk
    const buffer = Buffer.from(data.data, 'base64');
    writeFileSync(outputPath, buffer);

    return {
      content: [
        {
          type: 'text',
          text: `PDF generated successfully.\n` +
            `  File: ${outputPath}\n` +
            `  Size: ${data.size_bytes} bytes\n` +
            `  Duration: ${data.duration_ms}ms`,
        },
      ],
    };
  }
);

// ─── Tool: create_og_image ──────────────────────────────────────
server.tool(
  'create_og_image',
  'Generate an Open Graph / social card image. Returns an image using built-in templates or custom HTML.',
  {
    template: z.enum(['default', 'minimal', 'gradient']).optional().describe('Built-in template name (default: "default")'),
    html: z.string().optional().describe('Custom HTML template (overrides template parameter)'),
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

// ─── Tool: run_sequence ─────────────────────────────────────────
server.tool(
  'run_sequence',
  'Execute a multi-step browser automation sequence. Navigate pages, interact with elements (click, fill, select), and capture multiple screenshots/PDFs in a single browser session. Each output counts as 1 API request.',
  {
    steps: z.array(
      z.object({
        action: z.enum([
          'navigate', 'click', 'fill', 'select', 'hover',
          'scroll', 'wait', 'wait_for', 'evaluate',
          'screenshot', 'pdf',
        ]).describe('The action to perform'),
        url: z.string().url().optional().describe('URL to navigate to (for navigate action)'),
        selector: z.string().optional().describe('CSS selector for the target element'),
        value: z.string().optional().describe('Value to type or select'),
        ms: z.number().int().min(0).max(10000).optional().describe('Milliseconds to wait (for wait action)'),
        timeout: z.number().int().min(0).max(15000).optional().describe('Timeout in ms for wait_for (default: 10000)'),
        x: z.number().optional().describe('Horizontal scroll position'),
        y: z.number().optional().describe('Vertical scroll position'),
        script: z.string().max(5000).optional().describe('JavaScript to execute in page context (for evaluate action)'),
        name: z.string().optional().describe('Name for the output (for screenshot/pdf actions)'),
        format: z.string().optional().describe('Image format: png, jpeg, webp (screenshot) or A4, Letter (pdf)'),
        fullPage: z.boolean().optional().describe('Capture full scrollable page (for screenshot action)'),
        quality: z.number().int().min(1).max(100).optional().describe('JPEG/WebP quality (for screenshot action)'),
        landscape: z.boolean().optional().describe('Landscape orientation (for pdf action)'),
        printBackground: z.boolean().optional().describe('Include CSS backgrounds (for pdf action)'),
        margin: z.string().optional().describe('CSS margin for all sides (for pdf action)'),
        scale: z.number().min(0.1).max(2).optional().describe('Rendering scale (for pdf action)'),
      })
    ).min(1).max(20).describe('Array of steps to execute in order. Must include at least one screenshot or pdf step. Max 20 steps, max 5 outputs.'),
    viewport: z.object({
      width: z.number().int().min(320).max(3840).optional().describe('Viewport width (default: 1280)'),
      height: z.number().int().min(200).max(2160).optional().describe('Viewport height (default: 720)'),
    }).optional().describe('Browser viewport size'),
    darkMode: z.boolean().optional().describe('Emulate dark color scheme (default: false)'),
    blockBanners: z.boolean().optional().describe('Hide cookie consent banners (default: false)'),
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

// ─── Tool: record_video ─────────────────────────────────────────
server.tool(
  'record_video',
  'Record a professional demo video of a multi-step browser automation sequence. Produces MP4/WebM/GIF with automatic cursor highlighting, click ripple effects, smooth cursor movement, and auto-zoom on clicks (Cursorful-style). Each video costs 3 API requests. Saves to disk and returns the file path.',
  {
    steps: z.array(
      z.object({
        action: z.enum([
          'navigate', 'click', 'fill', 'select', 'hover',
          'scroll', 'wait', 'wait_for', 'evaluate',
        ]).describe('The action to perform (no screenshot/pdf — the whole sequence is recorded as video)'),
        url: z.string().url().optional().describe('URL to navigate to (for navigate action)'),
        selector: z.string().optional().describe('CSS selector for the target element'),
        value: z.string().optional().describe('Value to type or select'),
        ms: z.number().int().min(0).max(10000).optional().describe('Milliseconds to wait (for wait action)'),
        timeout: z.number().int().min(0).max(15000).optional().describe('Timeout in ms for wait_for (default: 10000)'),
        x: z.number().optional().describe('Horizontal scroll position'),
        y: z.number().optional().describe('Vertical scroll position'),
        script: z.string().max(5000).optional().describe('JavaScript to execute in page context (for evaluate action)'),
      })
    ).min(1).max(50).describe('Array of steps to execute and record. Max steps depends on plan (10-50).'),
    viewport: z.object({
      width: z.number().int().min(320).max(3840).optional().describe('Viewport width (default: 1280)'),
      height: z.number().int().min(200).max(2160).optional().describe('Viewport height (default: 720)'),
    }).optional().describe('Browser viewport size'),
    format: z.enum(['mp4', 'webm', 'gif']).optional().describe('Video format (default: mp4). webm/gif require Starter+ plan.'),
    framerate: z.number().int().optional().describe('Frames per second: 24, 30, or 60 (default: 30)'),
    cursor: z.object({
      visible: z.boolean().optional().describe('Show cursor overlay (default: true)'),
      style: z.enum(['highlight', 'circle', 'spotlight', 'dot']).optional().describe('Cursor style (default: highlight)'),
      color: z.string().optional().describe('Cursor color as hex, e.g. "#3B82F6" (default: blue)'),
      size: z.number().int().min(8).max(60).optional().describe('Cursor size in pixels (default: 20)'),
      smoothing: z.boolean().optional().describe('Smooth animated cursor movement (default: true)'),
    }).optional().describe('Cursor appearance settings'),
    zoom: z.object({
      enabled: z.boolean().optional().describe('Auto-zoom on clicks (default: true)'),
      level: z.number().min(1.5).max(4).optional().describe('Zoom magnification (default: 2.0)'),
      duration: z.number().int().min(200).max(2000).optional().describe('Zoom animation duration in ms (default: 600)'),
    }).optional().describe('Auto-zoom settings for click actions'),
    autoZoom: z.boolean().optional().describe('Shorthand: set to true to enable auto-zoom with defaults (same as zoom.enabled=true)'),
    clickEffect: z.object({
      enabled: z.boolean().optional().describe('Show click ripple effects (default: true)'),
      style: z.enum(['ripple', 'pulse', 'ring']).optional().describe('Click effect style (default: ripple)'),
      color: z.string().optional().describe('Click effect color as hex'),
    }).optional().describe('Visual click effect settings'),
    pace: z.union([
      z.number().min(0.25).max(6),
      z.enum(['fast', 'normal', 'slow', 'dramatic', 'cinematic']),
    ]).optional().describe('Controls how deliberate the video feels. Number (0.25–6.0, higher = slower) or preset: "fast" (0.5×), "normal" (1×), "slow" (2×), "dramatic" (3×), "cinematic" (4.5×). Default: "normal".'),
    darkMode: z.boolean().optional().describe('Emulate dark color scheme (default: false)'),
    blockBanners: z.boolean().optional().describe('Hide cookie consent banners (default: true)'),
    deviceScaleFactor: z.number().min(1).max(3).optional().describe('Device pixel ratio (default: 1)'),
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
      const outputPath = resolve(saveTo || `./recording.${ext}`);

      // Decode base64 and write to disk
      const buffer = Buffer.from(data.data, 'base64');
      writeFileSync(outputPath, buffer);

      const durationSec = (data.duration_ms / 1000).toFixed(1);

      return {
        content: [
          {
            type: 'text',
            text: `Video recorded successfully.\n` +
              `  File:     ${outputPath}\n` +
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

// ─── Tool: inspect_page ─────────────────────────────────────────
server.tool(
  'inspect_page',
  'Inspect a web page and get a structured map of all interactive elements, headings, forms, links, and images — each with a unique CSS selector. Use this BEFORE run_sequence to discover what elements exist on the page and get reliable selectors. Returns text (not an image), so it is fast and cheap. Costs 1 API request.',
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
    deviceScaleFactor: z.number().min(1).max(3).optional().describe('Device pixel ratio (default: 1)'),
    // ── Timing ──
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().describe('When to consider navigation finished (default: networkidle2)'),
    waitForSelector: z.string().optional().describe('Wait for this CSS selector to appear before inspecting'),
    // ── Emulation ──
    darkMode: z.boolean().optional().describe('Emulate dark color scheme (default: false)'),
    reducedMotion: z.boolean().optional().describe('Emulate prefers-reduced-motion'),
    userAgent: z.string().optional().describe('Override the browser User-Agent string'),
    // ── Auth & headers ──
    cookies: z.array(
      z.union([
        z.string(),
        z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string().optional(),
        }),
      ])
    ).optional().describe('Cookies to set — array of "name=value" strings or { name, value, domain? } objects'),
    headers: z.record(z.string(), z.string()).optional().describe('Extra HTTP headers to send with the request'),
    authorization: z.string().optional().describe('Authorization header value (e.g. "Bearer <token>")'),
    bypassCSP: z.boolean().optional().describe('Bypass Content-Security-Policy on the page'),
    // ── Content manipulation ──
    hideSelectors: z.array(z.string()).optional().describe('Array of CSS selectors to hide before inspecting'),
    blockBanners: z.boolean().optional().describe('Hide cookie consent banners (default: false)'),
    blockAds: z.boolean().optional().describe('Block advertisements on the page'),
    blockChats: z.boolean().optional().describe('Block live chat widgets'),
    blockTrackers: z.boolean().optional().describe('Block tracking scripts'),
    injectCss: z.string().optional().describe('Custom CSS to inject before inspecting'),
    injectJs: z.string().optional().describe('Custom JavaScript to execute before inspecting'),
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

      // Header
      lines.push(`Page: ${data.title || '(untitled)'} (${data.url || params.url || 'html content'})`);
      if (data.metadata) {
        if (data.metadata.description) lines.push(`Description: ${data.metadata.description}`);
        if (data.metadata.lang) lines.push(`Language: ${data.metadata.lang}`);
        if (data.metadata.httpStatusCode) lines.push(`HTTP Status: ${data.metadata.httpStatusCode}`);
      }
      lines.push('');

      // Headings
      if (data.headings && data.headings.length > 0) {
        lines.push(`Headings (${data.headings.length}):`);
        for (const h of data.headings) {
          lines.push(`  H${h.level}: ${h.text} — selector: ${h.selector}`);
        }
        lines.push('');
      }

      // Interactive elements
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

      // Forms
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

      // Links
      if (data.links && data.links.length > 0) {
        lines.push(`Links (${data.links.length}):`);
        for (const l of data.links) {
          lines.push(`  "${l.text || '(no text)'}" → ${l.href} — selector: ${l.selector}`);
        }
        lines.push('');
      }

      // Images
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
        content: [
          {
            type: 'text',
            text: lines.join('\n'),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Inspect error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: list_devices ─────────────────────────────────────────
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

// ─── Tool: check_usage ──────────────────────────────────────────
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

  // ── Prompt: capture-page ──────────────────────────────────────
  server.prompt(
    'capture-page',
    'Capture a clean screenshot of any URL with sensible defaults. Optionally inspects the page first.',
    {
      url: z.string().describe('The URL to capture'),
      device: z.string().optional().describe('Device preset, e.g. "iphone_14_pro" or "macbook_pro_14"'),
      dark_mode: z.enum(['true', 'false']).optional().describe('Enable dark mode (default: false)'),
      full_page: z.enum(['true', 'false']).optional().describe('Capture the full scrollable page (default: false)'),
    },
    (args) => {
      const device = args.device ? `\n- Use device preset: ${args.device}` : '';
      const dark = args.dark_mode === 'true' ? '\n- Enable dark mode' : '';
      const full = args.full_page === 'true' ? '\n- Capture the full scrollable page' : '';

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Take a clean screenshot of ${args.url} with these settings:
- Block banners, ads, chats, and trackers for a clean capture${device}${dark}${full}
- Use PNG format
- If the page looks complex or you need to verify elements, run inspect_page first

Call take_screenshot with:
  url: "${args.url}"
  blockBanners: true
  blockAds: true
  blockChats: true
  blockTrackers: true${args.device ? `\n  viewportDevice: "${args.device}"` : ''}${args.dark_mode === 'true' ? '\n  darkMode: true' : ''}${args.full_page === 'true' ? '\n  fullPage: true\n  fullPageScroll: true' : ''}`,
            },
          },
        ],
      };
    }
  );

  // ── Prompt: record-demo ───────────────────────────────────────
  server.prompt(
    'record-demo',
    'Record a professional demo video of a web page or flow. Generates a step sequence automatically.',
    {
      url: z.string().describe('The starting URL to record'),
      description: z.string().describe('What the demo should show, e.g. "Sign in and explore the dashboard"'),
      pace: z.enum(['fast', 'normal', 'slow', 'dramatic', 'cinematic']).optional().describe('Video pace preset (default: normal)'),
      format: z.enum(['mp4', 'webm', 'gif']).optional().describe('Output format (default: mp4)'),
    },
    (args) => {
      const pace = args.pace || 'normal';
      const format = args.format || 'mp4';

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
   - cursor: { style: "spotlight", color: "#6366f1" }
   - clickEffect: { style: "ripple", color: "#6366f1" }

Important tips:
- Use selectors from the inspect_page results — never guess selectors
- Add scroll actions between sections to show content naturally
- Use wait_for after navigation to ensure the page loads
- Keep to 15 steps or fewer for best results
- Each video costs 3 API requests`,
            },
          },
        ],
      };
    }
  );

  // ── Prompt: audit-page ────────────────────────────────────────
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

  // ── Resource: pagebolt://api-docs ─────────────────────────────
  server.resource(
    'api-docs',
    'pagebolt://api-docs',
    { description: 'Complete PageBolt API reference with all endpoints, parameters, examples, and plan limits. Read this for detailed documentation beyond tool descriptions.', mimeType: 'text/plain' },
    async () => {
      // Serve a comprehensive API reference. In production this is baked in;
      // we could also fetch /llms-full.txt but embedding avoids a network call.
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

// ─── Smithery sandbox export (for scanning tools without credentials) ─
export function createSandboxServer() {
  return createConfiguredServer();
}

// ─── Start ──────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
