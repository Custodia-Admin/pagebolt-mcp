// Integration tests for the PageBolt MCP server.
//
// These connect a real MCP Client to the server over an in-memory transport
// and exercise the tool handlers end-to-end, with the PageBolt HTTP layer
// (global fetch) mocked. Run with: `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing the server module: skip stdio auto-start and
// satisfy the required-API-key guard.
process.env.PAGEBOLT_MCP_NO_AUTOSTART = '1';
process.env.PAGEBOLT_API_KEY = 'pf_test_key';
process.env.PAGEBOLT_BASE_URL = 'https://pagebolt.dev';
// saveTo is confined to CWD or this root; tests write under the OS temp dir.
process.env.PAGEBOLT_MCP_SAVE_ROOT = tmpdir();
// Tests that don't exercise the plan lookup must not issue an extra /usage call.
process.env.PAGEBOLT_MCP_NO_PLAN_LOOKUP = '1';

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

test('observe_page surfaces structured API error code and hint', async () => {
  await withClient(
    () => jsonResponse({
      error: 'Could not connect to the target site (https://example.gov). The server did not respond.',
      code: 'target_connection_timeout',
      hint: 'Confirm the site loads in a normal browser from a public network.',
    }, { status: 504 }),
    async (client) => {
      const res = await client.callTool({
        name: 'observe_page',
        arguments: { url: 'https://example.gov' },
      });
      assert.equal(res.isError, true);
      const text = textOf(res);
      assert.match(text, /target_connection_timeout/);
      assert.match(text, /Confirm the site loads/);
      assert.match(text, /\(504\)/);
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

// ── Authenticated capture: cookies + authState must reach the API intact ──
const AUTH_COOKIE = {
  name: 'sid', value: 'abc123', domain: '.app.example.com', path: '/',
  secure: true, httpOnly: true, sameSite: 'Lax', expires: 1990000000,
};
const AUTH_STATE = {
  cookies: [AUTH_COOKIE],
  localStorage: [{ origin: 'https://app.example.com', items: [{ name: 'token', value: 't0k' }] }],
};

test('record_video forwards full cookies and authState to /api/v1/video', async () => {
  let seen;
  await withClient(
    (url, method, body) => {
      if (url.endsWith('/api/v1/video') && method === 'POST') {
        seen = body;
        return jsonResponse({ data: Buffer.from('v').toString('base64'), format: 'mp4', duration_ms: 1000, steps_completed: 1, total_steps: 1 });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    },
    async (client) => {
      const res = await client.callTool({
        name: 'record_video',
        arguments: {
          steps: [{ action: 'navigate', url: 'https://app.example.com/dash' }],
          async: false,
          saveTo: join(tmpdir(), 'pagebolt-auth-test.mp4'),
          cookies: [AUTH_COOKIE, 'plain=1'],
          authState: AUTH_STATE,
        },
      });
      assert.ok(!res.isError, textOf(res));
    },
  );
  assert.deepEqual(seen.cookies, [AUTH_COOKIE, 'plain=1'], 'cookies (with path/secure/httpOnly/sameSite/expires) must not be stripped');
  assert.deepEqual(seen.authState, AUTH_STATE);
});

test('run_sequence forwards full cookies and authState to /api/v1/sequence', async () => {
  let seen;
  await withClient(
    (url, method, body) => {
      if (url.endsWith('/api/v1/sequence') && method === 'POST') {
        seen = body;
        return jsonResponse({ outputs: [], steps_completed: 2, total_steps: 2 });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    },
    async (client) => {
      await client.callTool({
        name: 'run_sequence',
        arguments: {
          steps: [{ action: 'navigate', url: 'https://app.example.com/' }, { action: 'screenshot', name: 's' }],
          cookies: [AUTH_COOKIE],
          authState: AUTH_STATE,
        },
      });
    },
  );
  assert.deepEqual(seen.cookies, [AUTH_COOKIE]);
  assert.deepEqual(seen.authState, AUTH_STATE);
});

test('run_sequence accepts more than 20 steps (limit is enforced per-plan by the server)', async () => {
  let seen;
  await withClient(
    (url, method, body) => {
      if (url.endsWith('/api/v1/sequence') && method === 'POST') { seen = body; return jsonResponse({ outputs: [], step_results: [], steps_completed: 30, total_steps: 30, total_duration_ms: 1, usage: { outputs_charged: 1, remaining: 99 } }); }
      throw new Error(`unexpected request ${method} ${url}`);
    },
    async (client) => {
      const steps = Array.from({ length: 29 }, (_, i) => ({ action: 'navigate', url: `https://example.com/${i}` }));
      steps.push({ action: 'screenshot', name: 's' });
      const res = await client.callTool({ name: 'run_sequence', arguments: { steps } });
      assert.ok(!res.isError, textOf(res));
    },
  );
  assert.equal(seen.steps.length, 30);
});

test('record_video accepts highlight steps and forwards style/color/duration/label', async () => {
  let seen;
  await withClient(
    (url, method, body) => {
      if (url.endsWith('/api/v1/video') && method === 'POST') {
        seen = body;
        return jsonResponse({ data: Buffer.from('v').toString('base64'), format: 'mp4', duration_ms: 1000, steps_completed: 2, total_steps: 2 });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    },
    async (client) => {
      const res = await client.callTool({
        name: 'record_video',
        arguments: {
          async: false,
          saveTo: join(tmpdir(), 'pagebolt-hl-test.mp4'),
          steps: [
            { action: 'navigate', url: 'https://example.com' },
            { action: 'highlight', selector: '#cta', style: 'spotlight', color: '#ff0066', duration: 3000, label: 'Start here' },
          ],
        },
      });
      assert.ok(!res.isError, textOf(res));
    },
  );
  assert.deepEqual(seen.steps[1], { action: 'highlight', selector: '#cta', style: 'spotlight', color: '#ff0066', duration: 3000, label: 'Start here' });
});

test('export_sequence returns importable JSON (nothing saved, no HTTP call) and validates steps', async () => {
  let calls = 0;
  await withClient(async () => { calls++; return jsonResponse({}); }, async (client) => {
    const res = await client.callTool({
      name: 'export_sequence',
      arguments: {
        name: 'Demo',
        steps: [
          { action: 'navigate', url: 'https://example.com' },
          { action: 'highlight', selector: 'h1', note: 'Headline', narration: 'This is the headline.' },
        ],
        pace: 1.2,
        audioGuide: { enabled: true, pacing: 'overlap' },
      },
    });
    assert.notEqual(res.isError, true);
    const text = res.content[0].text;
    const json = JSON.parse(text.slice(text.indexOf('```json') + 7, text.indexOf('```', text.indexOf('```json') + 7)));
    assert.equal(json.steps.length, 2);
    assert.equal(json.pace, 1.2);
    assert.equal(json.audioGuide.pacing, 'overlap');
    assert.match(text, /Import JSON/);
    assert.equal(calls, 0, 'export must not hit the API unless save:true');
  });
});

test('export_sequence rejects unknown actions and steps without required fields', async () => {
  await withClient(async () => jsonResponse({}), async (client) => {
    const bad = await client.callTool({ name: 'export_sequence', arguments: { name: 'x', steps: [{ action: 'teleport' }] } });
    assert.equal(bad.isError, true);
    const noSel = await client.callTool({ name: 'export_sequence', arguments: { name: 'x', steps: [{ action: 'click' }] } });
    assert.equal(noSel.isError, true);
    assert.match(noSel.content[0].text, /step 1.*selector/i);
  });
});

test('export_sequence save:true stores it in the library via /api/v1/sequences', async () => {
  let seen;
  await withClient(async (url, method, body) => {
    if (url.endsWith('/api/v1/sequences') && method === 'POST') { seen = body; return jsonResponse({ id: 'seq_1', name: body.name }, { status: 201 }); }
    return jsonResponse({});
  }, async (client) => {
    const res = await client.callTool({ name: 'export_sequence', arguments: { name: 'Saved one', type: 'video', save: true, steps: [{ action: 'navigate', url: 'https://example.com' }] } });
    assert.notEqual(res.isError, true);
    assert.match(res.content[0].text, /seq_1/);
    assert.equal(seen.type, 'video');
    assert.equal(seen.name, 'Saved one');
  });
});

// ── First-time-right: pre-flight, saveTo, evidence (integration) ──────────
const okVideo = (extra = {}) => jsonResponse({
  data: Buffer.from('VIDEO-BYTES').toString('base64'), format: 'mp4', size_bytes: 11, duration_ms: 9000,
  steps_completed: 2, total_steps: 2, usage: { video_cost: 3, remaining: 90 }, ...extra,
});

test('record_video with 3 evaluate steps is rejected client-side: no HTTP call, not billed', async () => {
  let calls = 0;
  await withClient(() => { calls++; return okVideo(); }, async (client) => {
    const ev = { action: 'evaluate', script: '1' };
    const res = await client.callTool({ name: 'record_video', arguments: { steps: [{ action: 'navigate', url: 'https://example.com' }, ev, ev, ev], async: false } });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /Not sent \(nothing was billed\)/);
    assert.match(textOf(res), /3 evaluate steps.*at most 2/);
  });
  assert.equal(calls, 0);
});

test('record_video: non-live wait after click is sent, with a warning + estimate in the result', async () => {
  let sent;
  await withClient((url, method, body) => { sent = body; return okVideo(); }, async (client) => {
    const res = await client.callTool({
      name: 'record_video',
      arguments: {
        async: false, saveTo: join(tmpdir(), 'pb-warn-test', 'v.mp4'),
        steps: [{ action: 'navigate', url: 'https://example.com' }, { action: 'click', selector: '#go' }, { action: 'wait', ms: 3000 }],
      },
    });
    assert.notEqual(res.isError, true, textOf(res));
    const text = textOf(res);
    assert.match(text, /Pre-flight warnings \(1, request was still sent\)/);
    assert.match(text, /step 2 is a wait right after click without live:true/);
    assert.match(text, /Pre-flight estimate: ~\d+ s of video/);
  });
  assert.equal(sent.steps.length, 3, 'request is still sent unchanged');
  rmSync(join(tmpdir(), 'pb-warn-test'), { recursive: true, force: true });
});

test('record_video: clean request gets only the one-line estimate, no warnings', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  try {
    await withClient(() => okVideo(), async (client) => {
      const res = await client.callTool({ name: 'record_video', arguments: { async: false, saveTo: join(tmp, 'v.mp4'), steps: [{ action: 'navigate', url: 'https://example.com' }] } });
      assert.match(textOf(res), /Pre-flight estimate: ~\d+ s of video\./);
      assert.doesNotMatch(textOf(res), /Pre-flight warnings/);
    });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('record_video saveTo creates missing parent folders and reports absolute path + bytes', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  const out = join(tmp, 'deep', 'er', 'rec.mp4');
  try {
    await withClient(() => okVideo(), async (client) => {
      const res = await client.callTool({ name: 'record_video', arguments: { async: false, saveTo: out, steps: [{ action: 'navigate', url: 'https://example.com' }] } });
      assert.notEqual(res.isError, true, textOf(res));
      assert.match(textOf(res), new RegExp(`File:\\s+${out.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')} \\(11 bytes\\)`));
    });
    assert.ok(existsSync(out));
    assert.equal(statSync(out).size, 11);
    assert.equal(readFileSync(out, 'utf8'), 'VIDEO-BYTES');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('record_video saveTo that cannot be honoured fails BEFORE the render is requested', async () => {
  let calls = 0;
  await withClient(() => { calls++; return okVideo(); }, async (client) => {
    const res = await client.callTool({ name: 'record_video', arguments: { async: false, saveTo: '/etc/pagebolt-nope/v.mp4', steps: [{ action: 'navigate', url: 'https://example.com' }] } });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /Not sent \(nothing was billed\)/);
    assert.match(textOf(res), /outside the allowed folder.*PAGEBOLT_MCP_SAVE_ROOT/s);
    assert.equal((res.content || []).find((c) => c.type === 'resource'), undefined);
  });
  assert.equal(calls, 0);
  assert.equal(existsSync('/etc/pagebolt-nope'), false);
});

test('record_video async hosted + saveTo that cannot be downloaded says NOT SAVED (never "saved")', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  const out = join(tmp, 'x', 'rec.mp4');
  try {
    await withClient((url, method) => {
      if (url.endsWith('/api/v1/video')) return jsonResponse({ job_id: 'j1' }, { status: 202 });
      if (url.endsWith('/api/v1/jobs/j1')) return jsonResponse({ id: 'j1', status: 'completed', output: { format: 'mp4', duration_ms: 5000, url: 'https://pagebolt.dev/v/j1', file_url: 'https://pagebolt.dev/v/j1/file' } });
      if (url.endsWith('/v/j1/file')) return jsonResponse({}, { status: 401 });
      throw new Error(`unexpected ${method} ${url}`);
    }, async (client) => {
      const res = await client.callTool({ name: 'record_video', arguments: { async: true, saveTo: out, steps: [{ action: 'navigate', url: 'https://example.com' }] } });
      const text = textOf(res);
      assert.match(text, /File:\s+NOT SAVED/);
      assert.match(text, /private and could not be downloaded/);
      assert.match(text, /Watch:\s+https:\/\/pagebolt\.dev\/v\/j1/);
    });
    assert.equal(existsSync(out), false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('record_video renders per-step evidence, stop reason and warnings when the backend sends them', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  try {
    await withClient(() => okVideo({
      steps_completed: 2, total_steps: 3, stopped_early: true, stopped_at_step: 2, reason: 'video budget reached (28 s)', effective_timeout_ms: 30000,
      warnings: ['wait at step 1 had no visual change'],
      step_results: [
        { step_index: 0, action: 'navigate', status: 'ok', start_s: 0, end_s: 1.2, changed: true },
        { step_index: 1, action: 'wait', status: 'ok', start_s: 1.2, end_s: 6.2, changed: false, change_pct: 0 },
        { step_index: 2, action: 'click', status: 'timeout', error: 'budget' },
      ],
    }), async (client) => {
      const res = await client.callTool({ name: 'record_video', arguments: { async: false, saveTo: join(tmp, 'v.mp4'), steps: [
        { action: 'navigate', url: 'https://example.com' }, { action: 'wait', ms: 5000, live: true }, { action: 'click', selector: '#x' },
      ] } });
      const text = textOf(res);
      assert.match(text, /STOPPED EARLY at step 2: video budget reached/);
      assert.match(text, /Step 1 wait 5\.0 s live @1\.2 s-6\.2 s: no visual change/);
      assert.match(text, /Step 2 click #x: NOT RUN \(budget\)/);
      assert.match(text, /INCOMPLETE: 2\/3/);
      assert.match(text, /Server warnings \(1\)/);
    });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('record_video with an old backend response (no new fields) keeps the original output and adds one honest note', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  try {
    await withClient(() => okVideo(), async (client) => {
      const text = textOf(await client.callTool({ name: 'record_video', arguments: { async: false, saveTo: join(tmp, 'v.mp4'), steps: [{ action: 'navigate', url: 'https://example.com' }] } }));
      assert.match(text, /Video recorded successfully\./);
      assert.match(text, /Steps:\s+2\/2 completed/);
      assert.doesNotMatch(text, /STOPPED EARLY|Step evidence|INCOMPLETE/);
      assert.match(text, /means no step errored, not that anything moved/);
      assert.match(text, /Output:\s+~1280x720/);
    });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('record_video output line uses backend width/height when given', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  try {
    await withClient(() => okVideo({ width: 1512, height: 1012 }), async (client) => {
      const text = textOf(await client.callTool({ name: 'record_video', arguments: { async: false, saveTo: join(tmp, 'v.mp4'), steps: [{ action: 'navigate', url: 'https://example.com' }] } }));
      assert.match(text, /Output:\s+1512x1012\n/);
    });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('plan lookup: free plan + 12 steps warns once from /usage, which is called a single time', async () => {
  const prev = process.env.PAGEBOLT_MCP_NO_PLAN_LOOKUP;
  delete process.env.PAGEBOLT_MCP_NO_PLAN_LOOKUP;
  const { resetPlanCache } = await import('../src/lib/plan.mjs');
  resetPlanCache();
  let usageCalls = 0;
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  try {
    await withClient((url) => {
      if (url.endsWith('/api/v1/usage')) { usageCalls++; return jsonResponse({ plan: 'free', usage: { current: 1, limit: 100, remaining: 99 } }); }
      return okVideo();
    }, async (client) => {
      const steps = Array.from({ length: 12 }, () => ({ action: 'navigate', url: 'https://example.com' }));
      const args = { async: false, saveTo: join(tmp, 'v.mp4'), steps };
      assert.match(textOf(await client.callTool({ name: 'record_video', arguments: args })), /exceeds the 10-step limit of the free plan/);
      await client.callTool({ name: 'record_video', arguments: args });
    });
    assert.equal(usageCalls, 1);
  } finally {
    process.env.PAGEBOLT_MCP_NO_PLAN_LOOKUP = prev ?? '1';
    resetPlanCache();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('run_sequence: 3 evaluate steps rejected client-side; warnings are appended on success', async () => {
  let calls = 0;
  await withClient(() => { calls++; return jsonResponse({ outputs: [], step_results: [], steps_completed: 3, total_steps: 3, total_duration_ms: 1, usage: { outputs_charged: 1, remaining: 9 } }); }, async (client) => {
    const ev = { action: 'evaluate', script: '1' };
    const bad = await client.callTool({ name: 'run_sequence', arguments: { steps: [{ action: 'navigate', url: 'https://example.com' }, ev, ev, ev, { action: 'screenshot' }] } });
    assert.equal(bad.isError, true);
    assert.match(textOf(bad), /3 evaluate steps/);
    assert.equal(calls, 0);
    const none = await client.callTool({ name: 'run_sequence', arguments: { steps: [{ action: 'navigate', url: 'https://example.com' }] } });
    assert.equal(none.isError, true);
    assert.match(textOf(none), /at least one output step/);
    const warn = await client.callTool({ name: 'run_sequence', arguments: { steps: [{ action: 'navigate', url: 'https://example.com' }, { action: 'click', selector: '#a' }, { action: 'wait', ms: 500 }, { action: 'screenshot', name: 's' }] } });
    assert.notEqual(warn.isError, true);
    assert.match(textOf(warn), /Sequence complete/);
    assert.match(textOf(warn), /Pre-flight warnings/);
  });
});

test('tool descriptions state the rules agents kept learning from 400s', async () => {
  await withClient(() => jsonResponse({}), async (client) => {
    const { tools } = await client.listTools();
    const d = Object.fromEntries(tools.map((t) => [t.name, t.description]));
    assert.match(d.record_video, /live:true/);
    assert.match(d.record_video, /Max 2 evaluate steps/);
    assert.match(d.record_video, /Free 10 \/ 20 s \+ 5 s/);
    assert.match(d.record_video, /no WebGPU/);
    assert.match(d.record_video, /24 kHz/);
    assert.match(d.record_video, /1520x1020/);
    assert.match(d.record_video, /saveTo creates missing parent folders/);
    assert.match(d.run_sequence, /max 2 evaluate steps/);
    assert.match(d.run_sequence, /wait_for/);
    assert.match(d.inspect_page, /no WebGPU/);
    assert.match(d.take_screenshot, /no WebGPU/);
    assert.match(d.export_sequence, /pre-flight warnings/i);
    const vsteps = tools.find((t) => t.name === 'record_video').inputSchema.properties.steps.items.properties;
    assert.match(vsteps.live.description, /freezes ONE frame/);
    assert.match(vsteps.script.description, /Max 2 evaluate/);
  });
});

test('export_sequence reports pre-flight warnings and refuses 3 evaluate steps', async () => {
  await withClient(async () => jsonResponse({}), async (client) => {
    const ev = { action: 'evaluate', script: '1' };
    const bad = await client.callTool({ name: 'export_sequence', arguments: { name: 'x', steps: [ev, ev, ev] } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /3 evaluate steps/);
    const ok = await client.callTool({ name: 'export_sequence', arguments: { name: 'x', steps: [{ action: 'navigate', url: 'https://example.com' }, { action: 'click', selector: '#a' }, { action: 'wait', ms: 2000 }] } });
    assert.notEqual(ok.isError, true);
    assert.match(ok.content[0].text, /Pre-flight warnings/);
  });
});

// ── Authoring params (requires pagebolt feat/video-authoring) ─────────────
test('record_video forwards coordinates, rect, card, output and audio unchanged', async () => {
  let seen;
  const tmp = mkdtempSync(join(tmpdir(), 'pagebolt-'));
  try {
    await withClient((url, method, body) => { seen = body; return okVideo(); }, async (client) => {
      const res = await client.callTool({ name: 'record_video', arguments: {
        async: false, saveTo: join(tmp, 'v.mp4'),
        output: { width: 1920, height: 1080, fit: 'contain' },
        audio: { sampleRate: 48000, channels: 2 },
        steps: [
          { action: 'card', title: 'Intro', subtitle: 'What we build', duration: 2000 },
          { action: 'navigate', url: 'https://example.com' },
          { action: 'click', coordinates: { x: 640, y: 360 } },
          { action: 'hover', coordinates: { x: 10, y: 20 } },
          { action: 'highlight', rect: { x: 100, y: 100, width: 300, height: 200 }, label: 'Canvas' },
        ],
      } });
      assert.notEqual(res.isError, true, textOf(res));
      assert.match(textOf(res), /Output:\s+1920x1080|Output:\s+~1920x1080/);
    });
    assert.deepEqual(seen.output, { width: 1920, height: 1080, fit: 'contain' });
    assert.deepEqual(seen.audio, { sampleRate: 48000, channels: 2 });
    assert.deepEqual(seen.steps[2], { action: 'click', coordinates: { x: 640, y: 360 } });
    assert.deepEqual(seen.steps[4].rect, { x: 100, y: 100, width: 300, height: 200 });
    assert.equal(seen.steps[0].title, 'Intro');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('record_video rehearse:true sends rehearse, renders evidence and saves no file', async () => {
  let seen;
  await withClient((url, method, body) => {
    seen = body;
    return jsonResponse({ steps_completed: 2, total_steps: 2, duration_ms: 7000, step_results: [
      { step_index: 0, action: 'navigate', status: 'ok', start_s: 0, end_s: 1, changed: true },
      { step_index: 1, action: 'click', status: 'error', error: 'selector #nope not found' },
    ] });
  }, async (client) => {
    const res = await client.callTool({ name: 'record_video', arguments: { rehearse: true, steps: [{ action: 'navigate', url: 'https://example.com' }, { action: 'click', selector: '#nope' }] } });
    const text = textOf(res);
    assert.match(text, /Rehearsal complete \(no video encoded\)/);
    assert.match(text, /Step 1 click #nope: FAILED - selector #nope not found/);
    assert.equal((res.content || []).find((c) => c.type === 'resource'), undefined);
  });
  assert.equal(seen.rehearse, true);
});

test('record_video rehearse against an older backend says so instead of pretending', async () => {
  await withClient(() => jsonResponse({ steps_completed: 1, total_steps: 1 }), async (client) => {
    const text = textOf(await client.callTool({ name: 'record_video', arguments: { rehearse: true, steps: [{ action: 'navigate', url: 'https://example.com' }] } }));
    assert.match(text, /may not support "rehearse"/);
  });
});

test('export_sequence accepts coordinates/rect in place of selectors and card steps', async () => {
  await withClient(async () => jsonResponse({}), async (client) => {
    const ok = await client.callTool({ name: 'export_sequence', arguments: { name: 'c', steps: [
      { action: 'card', title: 'Hi' },
      { action: 'click', coordinates: { x: 1, y: 2 } },
      { action: 'highlight', rect: { x: 0, y: 0, width: 5, height: 5 } },
    ] } });
    assert.notEqual(ok.isError, true, ok.content[0].text);
    const bad = await client.callTool({ name: 'export_sequence', arguments: { name: 'c', steps: [{ action: 'click' }] } });
    assert.equal(bad.isError, true);
  });
});
