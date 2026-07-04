// Integration tests for the PageBolt MCP server.
//
// These connect a real MCP Client to the server over an in-memory transport
// and exercise the tool handlers end-to-end, with the PageBolt HTTP layer
// (global fetch) mocked. Run with: `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing the server module: skip stdio auto-start and
// satisfy the required-API-key guard.
process.env.PAGEBOLT_MCP_NO_AUTOSTART = '1';
process.env.PAGEBOLT_API_KEY = 'pf_test_key';
process.env.PAGEBOLT_BASE_URL = 'https://pagebolt.dev';

const { createSandboxServer } = await import('../src/index.mjs');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

// Build a fake fetch Response with just the surface callApi / the video
// download path rely on.
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => Buffer.from(JSON.stringify(body)),
  };
}

function bytesResponse(buffer, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: { get: () => null },
    arrayBuffer: async () => buffer,
    json: async () => { throw new Error('not json'); },
    text: async () => buffer.toString(),
  };
}

// Connect a fresh client/server pair, routing all HTTP through `handler`.
// `handler(url, method, body)` returns a fake Response (or throws).
async function withClient(handler, fn) {
  const prevFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    let body;
    if (options.body) {
      try { body = JSON.parse(options.body); } catch { body = options.body; }
    }
    return handler(String(url), method, body, options);
  };

  const server = createSandboxServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    await fn(client);
  } finally {
    global.fetch = prevFetch;
    await client.close();
    await server.close();
  }
}

// Concatenate all text from a tool call result.
function textOf(result) {
  return (result.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

test('observe_page format:"flatdomtree" surfaces dom_text + selectors (untrusted)', async () => {
  await withClient(
    (url, method) => {
      assert.equal(method, 'POST');
      assert.ok(url.endsWith('/api/v1/observe'));
      return jsonResponse({
        url: 'https://example.com/login',
        title: 'Sign in',
        pageType: 'login',
        dom_text: '[1]<button>Sign in</button>\n[2]<input>Email</input>',
        selectors: { '1': '#signin', '2': '#email' },
        duration_ms: 120,
      });
    },
    async (client) => {
      const res = await client.callTool({
        name: 'observe_page',
        arguments: { url: 'https://example.com/login', format: 'flatdomtree' },
      });
      const text = textOf(res);
      assert.match(text, /UNTRUSTED PAGE CONTENT/);
      assert.match(text, /FlatDomTree \(dom_text\)/);
      assert.match(text, /\[1\]<button>Sign in<\/button>/);
      assert.match(text, /Selectors \(2\)/);
      assert.match(text, /1: #signin/);
      assert.match(text, /2: #email/);
    },
  );
});

test('observe_page default json format still renders elements (backward compatible)', async () => {
  await withClient(
    (url) => {
      assert.ok(url.endsWith('/api/v1/observe'));
      return jsonResponse({
        url: 'https://example.com',
        title: 'Example',
        pageType: 'generic',
        elements: [
          { id: 'e1', role: 'button', name: 'Go', selector: '#go' },
        ],
        stats: { elementCount: 1, estimatedTokens: 42 },
        duration_ms: 90,
      });
    },
    async (client) => {
      const res = await client.callTool({
        name: 'observe_page',
        arguments: { url: 'https://example.com' },
      });
      const text = textOf(res);
      assert.match(text, /Interactive elements \(1\)/);
      assert.match(text, /e1 \[button\] "Go" — selector: #go/);
      assert.doesNotMatch(text, /FlatDomTree/);
    },
  );
});

test('import_agent_trace dry run (save:false) returns steps without saving, no quota', async () => {
  await withClient(
    (url, method, body) => {
      assert.equal(method, 'POST');
      assert.ok(url.endsWith('/api/v1/sequences/import'));
      assert.equal(body.save, false);
      assert.deepEqual(body.selectors, { '1': '#signin' });
      return jsonResponse({
        steps: [
          { action: 'navigate', url: 'https://example.com' },
          { action: 'click', selector: '#signin' },
        ],
        step_count: 2,
        saved: false,
      });
    },
    async (client) => {
      const res = await client.callTool({
        name: 'import_agent_trace',
        arguments: {
          trace: [
            { action: 'navigate', url: 'https://example.com' },
            { action: 'click', index: 1 },
          ],
          selectors: { '1': '#signin' },
          save: false,
        },
      });
      const text = textOf(res);
      assert.match(text, /Dry run/);
      assert.match(text, /Translated steps: 2/);
      assert.match(text, /does not consume request quota/i);
    },
  );
});

test('import_agent_trace saves a sequence and reports the id', async () => {
  await withClient(
    (url, method, body) => {
      assert.ok(url.endsWith('/api/v1/sequences/import'));
      // action_name-shaped entries should pass through untouched.
      assert.ok(Array.isArray(body.trace));
      return jsonResponse({
        id: 'seq_abc123',
        name: 'Login flow',
        type: 'sequence',
        step_count: 2,
        steps: [{ action: 'navigate' }, { action: 'click' }],
      });
    },
    async (client) => {
      const res = await client.callTool({
        name: 'import_agent_trace',
        arguments: {
          trace: [{ navigate: { url: 'https://example.com' } }, { click: { index: 1 } }],
          name: 'Login flow',
        },
      });
      const text = textOf(res);
      assert.match(text, /imported and saved/i);
      assert.match(text, /seq_abc123/);
      assert.match(text, /Steps:\s+2/);
    },
  );
});

test('list_jobs formats recent jobs', async () => {
  await withClient(
    (url, method) => {
      assert.equal(method, 'GET');
      assert.ok(url.endsWith('/api/v1/jobs'));
      return jsonResponse({
        jobs: [
          { id: 'job_1', type: 'video', status: 'completed', created_at: 't0', completed_at: 't1', output: { url: 'https://pagebolt.dev/v/job_1' } },
          { id: 'job_2', type: 'video', status: 'failed', error: 'boom' },
        ],
      });
    },
    async (client) => {
      const res = await client.callTool({ name: 'list_jobs', arguments: {} });
      const text = textOf(res);
      assert.match(text, /Async jobs \(2\)/);
      assert.match(text, /job_1 \[video\] — completed/);
      assert.match(text, /https:\/\/pagebolt\.dev\/v\/job_1/);
      assert.match(text, /job_2 \[video\] — failed/);
      assert.match(text, /error: boom/);
    },
  );
});

test('get_job returns completed video output URLs', async () => {
  await withClient(
    (url, method) => {
      assert.equal(method, 'GET');
      assert.ok(url.endsWith('/api/v1/jobs/job_1'));
      return jsonResponse({
        id: 'job_1',
        type: 'video',
        status: 'completed',
        created_at: 't0',
        completed_at: 't1',
        output: {
          format: 'mp4',
          size_bytes: 2048,
          duration_ms: 12000,
          url: 'https://pagebolt.dev/v/job_1',
          embed_url: 'https://pagebolt.dev/embed/v/job_1',
          file_url: 'https://pagebolt.dev/v/job_1/file',
          visibility: 'private',
          expires_at: '2026-07-10 12:00:00',
        },
      });
    },
    async (client) => {
      const res = await client.callTool({ name: 'get_job', arguments: { job_id: 'job_1' } });
      const text = textOf(res);
      assert.match(text, /Job job_1/);
      assert.match(text, /Status: completed/);
      assert.match(text, /Watch:\s+https:\/\/pagebolt\.dev\/v\/job_1/);
      assert.match(text, /Embed:\s+https:\/\/pagebolt\.dev\/embed\/v\/job_1/);
      assert.match(text, /File URL:\s+https:\/\/pagebolt\.dev\/v\/job_1\/file/);
    },
  );
});

test('record_video async enqueues, polls, downloads, and embeds the hosted video', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  const out = join(tmp, 'rec.mp4');
  const videoBytes = Buffer.from('FAKE-MP4-DATA');
  try {
    await withClient(
      (url, method, body) => {
        if (url.endsWith('/api/v1/video') && method === 'POST') {
          assert.equal(body.async, true, 'async video POST must set async:true');
          return jsonResponse(
            { job_id: 'job_9', status: 'queued', status_url: '/api/v1/jobs/job_9', queue_position: 1, estimated_wait_ms: 5000 },
            { status: 202 },
          );
        }
        if (url.endsWith('/api/v1/jobs/job_9') && method === 'GET') {
          return jsonResponse({
            id: 'job_9',
            type: 'video',
            status: 'completed',
            output: {
              format: 'mp4',
              content_type: 'video/mp4',
              size_bytes: videoBytes.length,
              duration_ms: 30000,
              frames: 900,
              steps_completed: 4,
              total_steps: 4,
              id: 'job_9',
              url: 'https://pagebolt.dev/v/job_9',
              embed_url: 'https://pagebolt.dev/embed/v/job_9',
              file_url: 'https://pagebolt.dev/v/job_9/file',
              visibility: 'private',
              expires_at: '2026-07-10 12:00:00',
            },
          });
        }
        if (url.endsWith('/v/job_9/file')) {
          return bytesResponse(videoBytes);
        }
        throw new Error(`unexpected request ${method} ${url}`);
      },
      async (client) => {
        const res = await client.callTool({
          name: 'record_video',
          arguments: {
            steps: [{ action: 'navigate', url: 'https://example.com' }],
            async: true,
            saveTo: out,
          },
        });
        const resource = (res.content || []).find((c) => c.type === 'resource');
        assert.ok(resource, 'should embed the downloaded video as a resource');
        assert.equal(resource.resource.blob, videoBytes.toString('base64'));
        const text = textOf(res);
        assert.match(text, /Video recorded successfully/);
        assert.match(text, /Job ID:\s+job_9/);
        assert.match(text, /Watch:\s+https:\/\/pagebolt\.dev\/v\/job_9/);
      },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('record_video async:false forces a synchronous inline response', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  const out = join(tmp, 'rec.mp4');
  const base64 = Buffer.from('SYNC-VIDEO').toString('base64');
  try {
    await withClient(
      (url, method, body) => {
        assert.ok(url.endsWith('/api/v1/video'));
        assert.equal(method, 'POST');
        assert.notEqual(body.async, true, 'sync path must not set async:true');
        assert.equal(body.response_type, 'json');
        return jsonResponse({
          data: base64,
          format: 'mp4',
          size_bytes: 10,
          duration_ms: 4000,
          frames: 120,
          steps_completed: 1,
          total_steps: 1,
          usage: { video_cost: 3, remaining: 100 },
        });
      },
      async (client) => {
        const res = await client.callTool({
          name: 'record_video',
          arguments: {
            steps: [{ action: 'navigate', url: 'https://example.com' }],
            async: false,
            saveTo: out,
          },
        });
        const resource = (res.content || []).find((c) => c.type === 'resource');
        assert.ok(resource);
        assert.equal(resource.resource.blob, base64);
        assert.match(textOf(res), /Cost:\s+3 API requests/);
      },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('record_video falls back to sync when async enqueue fails', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  const out = join(tmp, 'rec.mp4');
  const base64 = Buffer.from('FALLBACK-VIDEO').toString('base64');
  try {
    await withClient(
      (url, method, body) => {
        assert.ok(url.endsWith('/api/v1/video'));
        if (body.async === true) {
          // Simulate async unsupported on this plan.
          return jsonResponse({ error: 'async rendering not available on your plan' }, { status: 400 });
        }
        return jsonResponse({
          data: base64,
          format: 'mp4',
          size_bytes: 10,
          duration_ms: 4000,
          usage: { video_cost: 3, remaining: 99 },
        });
      },
      async (client) => {
        const res = await client.callTool({
          name: 'record_video',
          arguments: {
            steps: [{ action: 'navigate', url: 'https://example.com' }],
            async: true,
            saveTo: out,
          },
        });
        const resource = (res.content || []).find((c) => c.type === 'resource');
        assert.ok(resource, 'fallback should still deliver the video inline');
        assert.equal(resource.resource.blob, base64);
      },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('record_video defaults to async (hosted URL) when no saveTo is given', async () => {
  await withClient(
    (url, method, body) => {
      if (url.endsWith('/api/v1/video') && method === 'POST') {
        assert.equal(body.async, true, 'no-saveTo default must enqueue async');
        return jsonResponse({ job_id: 'job_x', status: 'queued', status_url: '/api/v1/jobs/job_x' }, { status: 202 });
      }
      if (url.endsWith('/api/v1/jobs/job_x') && method === 'GET') {
        return jsonResponse({
          id: 'job_x',
          type: 'video',
          status: 'completed',
          output: {
            format: 'mp4',
            duration_ms: 20000,
            url: 'https://pagebolt.dev/v/job_x',
            file_url: 'https://pagebolt.dev/v/job_x/file',
            visibility: 'private',
          },
        });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    },
    async (client) => {
      const res = await client.callTool({
        name: 'record_video',
        arguments: { steps: [{ action: 'navigate', url: 'https://example.com' }] },
      });
      // No saveTo → no download attempt → hosted-URL text only, no embedded resource.
      const resource = (res.content || []).find((c) => c.type === 'resource');
      assert.equal(resource, undefined, 'private hosted video should not be downloaded/embedded');
      const text = textOf(res);
      assert.match(text, /Video recorded successfully \(hosted\)/);
      assert.match(text, /Watch:\s+https:\/\/pagebolt\.dev\/v\/job_x/);
    },
  );
});

test('record_video defaults to sync (inline file) when saveTo is provided', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  const out = join(tmp, 'rec.mp4');
  const base64 = Buffer.from('SAVED-VIDEO').toString('base64');
  try {
    await withClient(
      (url, method, body) => {
        assert.ok(url.endsWith('/api/v1/video') && method === 'POST');
        assert.notEqual(body.async, true, 'saveTo default must use the synchronous path');
        assert.equal(body.response_type, 'json');
        return jsonResponse({ data: base64, format: 'mp4', size_bytes: 11, duration_ms: 4000, usage: { video_cost: 3, remaining: 50 } });
      },
      async (client) => {
        const res = await client.callTool({
          name: 'record_video',
          arguments: { steps: [{ action: 'navigate', url: 'https://example.com' }], saveTo: out },
        });
        const resource = (res.content || []).find((c) => c.type === 'resource');
        assert.ok(resource, 'saveTo default should deliver the video inline');
        assert.equal(resource.resource.blob, base64);
      },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
