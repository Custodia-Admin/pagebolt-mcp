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

if (!API_KEY) {
  console.error(
    'ERROR: PAGEBOLT_API_KEY environment variable is required.\n\n' +
    'Get your free API key at https://pagebolt.dev\n\n' +
    'Then set it in your MCP client config:\n\n' +
    '  Claude Desktop (~/.claude/claude_desktop_config.json):\n' +
    '    "env": { "PAGEBOLT_API_KEY": "pf_live_..." }\n\n' +
    '  Cursor (.cursor/mcp.json):\n' +
    '    "env": { "PAGEBOLT_API_KEY": "pf_live_..." }\n'
  );
  process.exit(1);
}

// ─── HTTP helper ─────────────────────────────────────────────────
async function callApi(endpoint, options = {}) {
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

// ─── Create MCP Server ──────────────────────────────────────────
const server = new McpServer({
  name: 'pagebolt',
  version: '1.0.0',
});

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
    headers: z.record(z.string()).optional().describe('Extra HTTP headers to send with the request'),
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

// ─── Start ──────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
