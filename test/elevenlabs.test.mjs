// ElevenLabs bring-your-own-key: record_video routes the key into the X-ElevenLabs-Key header
// (from ELEVENLABS_API_KEY or audioGuide.elevenlabs.apiKey), never into the request body or the
// tool output; list_elevenlabs_voices calls GET /api/v1/elevenlabs/voices with the header.
// Field names match the backend (Custodia-Admin/pagebolt, audioGuide.provider "elevenlabs").

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PAGEBOLT_MCP_NO_AUTOSTART = '1';
process.env.PAGEBOLT_API_KEY = 'pf_test_key';
process.env.PAGEBOLT_BASE_URL = 'https://pagebolt.dev';

const { createSandboxServer } = await import('../src/index.mjs');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

const EL_KEY = 'sk_' + 'a1b2c3d4'.repeat(6);

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => Buffer.from(JSON.stringify(body)),
  };
}

async function withClient(handler, fn) {
  const prevFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    let body;
    if (options.body) { try { body = JSON.parse(options.body); } catch { body = options.body; } }
    const call = { url: String(url), method: options.method || 'GET', body, headers: options.headers || {}, rawBody: options.body || '' };
    calls.push(call);
    return handler(call);
  };
  const server = createSandboxServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  try { await fn(client, calls); } finally {
    global.fetch = prevFetch;
    await client.close();
    await server.close();
  }
}

const textOf = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const VIDEO_OK = { format: 'mp4', data: Buffer.from('mp4').toString('base64'), size_bytes: 3, duration_ms: 1000, steps_completed: 1, total_steps: 1 };

test('record_video provider elevenlabs: key from ELEVENLABS_API_KEY goes in the header only', async () => {
  process.env.ELEVENLABS_API_KEY = EL_KEY;
  try {
    await withClient(async () => jsonResponse(VIDEO_OK), async (client, calls) => {
      const res = await client.callTool({
        name: 'record_video',
        arguments: {
          async: false,
          steps: [{ action: 'navigate', url: 'https://example.com' }],
          audioGuide: { enabled: true, provider: 'elevenlabs', script: '{{0}} Hello.', elevenlabs: { voiceId: '21m00Tcm4TlvDq8ikWAM', modelId: 'eleven_turbo_v2_5', stability: 0.5 } },
        },
      });
      assert.notEqual(res.isError, true, textOf(res));
      const call = calls.find((c) => c.url.endsWith('/api/v1/video'));
      assert.equal(call.headers['X-ElevenLabs-Key'], EL_KEY);
      assert.equal(call.body.audioGuide.provider, 'elevenlabs');
      assert.deepEqual(call.body.audioGuide.elevenlabs, { voiceId: '21m00Tcm4TlvDq8ikWAM', modelId: 'eleven_turbo_v2_5', stability: 0.5 });
      assert.ok(!call.rawBody.includes(EL_KEY), 'key must not be in the request body');
      assert.ok(!JSON.stringify(res).includes(EL_KEY), 'key must not be in the tool output');
    });
  } finally { delete process.env.ELEVENLABS_API_KEY; }
});

test('record_video: an apiKey passed in arguments is moved to the header and stripped from the body', async () => {
  await withClient(async () => jsonResponse(VIDEO_OK), async (client, calls) => {
    const res = await client.callTool({
      name: 'record_video',
      arguments: {
        async: false,
        steps: [{ action: 'navigate', url: 'https://example.com', narration: 'Hi.' }],
        audioGuide: { enabled: true, provider: 'elevenlabs', elevenlabs: { voiceName: 'Rachel', apiKey: EL_KEY } },
      },
    });
    assert.notEqual(res.isError, true, textOf(res));
    const call = calls.find((c) => c.url.endsWith('/api/v1/video'));
    assert.equal(call.headers['X-ElevenLabs-Key'], EL_KEY);
    assert.equal(call.body.audioGuide.elevenlabs.apiKey, undefined);
    assert.equal(call.body.audioGuide.elevenlabs.voiceName, 'Rachel');
  });
});

test('record_video provider elevenlabs without any key fails locally, before calling PageBolt', async () => {
  delete process.env.ELEVENLABS_API_KEY;
  await withClient(async () => jsonResponse(VIDEO_OK), async (client, calls) => {
    const res = await client.callTool({
      name: 'record_video',
      arguments: { steps: [{ action: 'navigate', url: 'https://example.com' }], audioGuide: { enabled: true, provider: 'elevenlabs', elevenlabs: { voiceId: '21m00Tcm4TlvDq8ikWAM' } } },
    });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /ELEVENLABS_API_KEY/);
    assert.equal(calls.length, 0);
  });
});

test('record_video async: an ElevenLabs refusal is surfaced, not retried as a sync render', async () => {
  process.env.ELEVENLABS_API_KEY = EL_KEY;
  try {
    await withClient(async () => jsonResponse({ error: 'ElevenLabs rejected your API key.', code: 'elevenlabs_invalid_key', provider: 'elevenlabs' }, { status: 401 }), async (client, calls) => {
      const res = await client.callTool({
        name: 'record_video',
        arguments: { steps: [{ action: 'navigate', url: 'https://example.com' }], audioGuide: { enabled: true, provider: 'elevenlabs', elevenlabs: { voiceId: '21m00Tcm4TlvDq8ikWAM' } } },
      });
      assert.equal(res.isError, true);
      assert.match(textOf(res), /elevenlabs_invalid_key/);
      assert.equal(calls.filter((c) => c.url.endsWith('/api/v1/video')).length, 1);
      assert.ok(!JSON.stringify(res).includes(EL_KEY));
    });
  } finally { delete process.env.ELEVENLABS_API_KEY; }
});

test('azure narration is unchanged: no X-ElevenLabs-Key header is sent', async () => {
  process.env.ELEVENLABS_API_KEY = EL_KEY;
  try {
    await withClient(async () => jsonResponse(VIDEO_OK), async (client, calls) => {
      const res = await client.callTool({ name: 'record_video', arguments: { async: false, steps: [{ action: 'navigate', url: 'https://example.com', narration: 'Hi' }], audioGuide: { enabled: true, voice: 'ava' } } });
      assert.notEqual(res.isError, true, textOf(res));
      const call = calls.find((c) => c.url.endsWith('/api/v1/video'));
      assert.equal(call.headers['X-ElevenLabs-Key'], undefined);
    });
  } finally { delete process.env.ELEVENLABS_API_KEY; }
});

test('list_elevenlabs_voices calls the backend with the header and lists voices', async () => {
  process.env.ELEVENLABS_API_KEY = EL_KEY;
  try {
    await withClient(async (call) => {
      if (call.url.includes('/api/v1/elevenlabs/voices')) {
        return jsonResponse({ provider: 'elevenlabs', voices: [{ voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', category: 'premade', labels: { accent: 'american' } }], has_more: false });
      }
      return jsonResponse({});
    }, async (client, calls) => {
      const res = await client.callTool({ name: 'list_elevenlabs_voices', arguments: { search: 'Rach' } });
      assert.notEqual(res.isError, true, textOf(res));
      assert.match(textOf(res), /21m00Tcm4TlvDq8ikWAM — Rachel/);
      assert.equal(calls[0].headers['X-ElevenLabs-Key'], EL_KEY);
      assert.match(calls[0].url, /\/api\/v1\/elevenlabs\/voices\?search=Rach$/);
      assert.ok(!calls[0].url.includes(EL_KEY));
    });
  } finally { delete process.env.ELEVENLABS_API_KEY; }
});

test('export_sequence never echoes or saves an ElevenLabs key', async () => {
  await withClient(async (call) => jsonResponse({ id: 'seq_1', name: call.body && call.body.name }, { status: 201 }), async (client, calls) => {
    const res = await client.callTool({
      name: 'export_sequence',
      arguments: {
        name: 'el', save: true, steps: [{ action: 'navigate', url: 'https://example.com' }],
        audioGuide: { enabled: true, provider: 'elevenlabs', elevenlabs: { voiceId: '21m00Tcm4TlvDq8ikWAM', apiKey: EL_KEY } },
      },
    });
    assert.notEqual(res.isError, true, textOf(res));
    assert.ok(!textOf(res).includes(EL_KEY));
    assert.ok(!calls[0].rawBody.includes(EL_KEY));
    assert.match(textOf(res), /"provider": "elevenlabs"/);
  });
});
