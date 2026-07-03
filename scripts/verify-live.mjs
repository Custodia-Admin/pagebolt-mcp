#!/usr/bin/env node
/**
 * Live-API verification for the PageBolt MCP server's new capabilities.
 *
 * Exercises the real https://pagebolt.dev/api/v1 endpoints that back the new
 * MCP tools. Requires a real key:
 *
 *   PAGEBOLT_API_KEY=pf_live_... node scripts/verify-live.mjs
 *
 * Checks:
 *   1. observe  format:"flatdomtree"  → dom_text + selectors
 *   2. sequences/import  save:false    → round-trips a small trace (no quota)
 *   3. video  async:true               → job reaches "completed" with hosted URL
 *
 * This is a manual smoke test — it is NOT part of `npm test` and is excluded
 * from the published npm package.
 */

const API_KEY = process.env.PAGEBOLT_API_KEY;
const BASE_URL = (process.env.PAGEBOLT_BASE_URL || 'https://pagebolt.dev').replace(/\/$/, '');
const TARGET = process.env.PAGEBOLT_TEST_URL || 'https://example.com/';

if (!API_KEY) {
  console.error('PAGEBOLT_API_KEY is required. Run: PAGEBOLT_API_KEY=... node scripts/verify-live.mjs');
  process.exit(2);
}

async function api(endpoint, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      'x-api-key': API_KEY,
      'user-agent': 'pagebolt-mcp-verify/1.16.0',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, ok: res.ok, json };
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}`);
  if (detail) console.log(`   ${detail}`);
}

async function checkObserveFlatDomTree() {
  const { status, ok, json } = await api('/api/v1/observe', {
    method: 'POST',
    body: { url: TARGET, format: 'flatdomtree', blockBanners: true },
  });
  if (!ok) return record('observe format:"flatdomtree"', false, `HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
  const hasDom = typeof json.dom_text === 'string' && json.dom_text.length > 0;
  const hasSelectors = json.selectors && typeof json.selectors === 'object' && Object.keys(json.selectors).length > 0;
  record('observe format:"flatdomtree"', hasDom && hasSelectors,
    `dom_text: ${hasDom ? `${json.dom_text.length} chars` : 'MISSING'}; ` +
    `selectors: ${hasSelectors ? `${Object.keys(json.selectors).length} entries` : 'MISSING'}; ` +
    `elements present: ${Array.isArray(json.elements)}`);
  return { hasDom, hasSelectors, selectors: json.selectors, dom_text: json.dom_text };
}

async function checkImportDryRun() {
  const trace = [
    { action: 'navigate', url: TARGET },
    { action: 'click', selector: 'a' },
  ];
  const { status, ok, json } = await api('/api/v1/sequences/import', {
    method: 'POST',
    body: { trace, name: 'verify-live dry run', save: false },
  });
  if (!ok) return record('sequences/import save:false', false, `HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
  const steps = Array.isArray(json.steps) ? json.steps : null;
  const notSaved = json.saved === false || json.id == null;
  record('sequences/import save:false', !!steps && notSaved,
    `steps: ${steps ? steps.length : 'MISSING'}; step_count: ${json.step_count}; saved: ${json.saved}`);
}

async function checkAsyncVideo() {
  const { status, ok, json } = await api('/api/v1/video', {
    method: 'POST',
    body: {
      async: true,
      steps: [
        { action: 'navigate', url: TARGET },
        { action: 'wait', ms: 800, live: true },
      ],
      format: 'mp4',
      blockBanners: true,
    },
  });
  if (!ok) return record('video async:true (enqueue)', false, `HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
  const jobId = json.job_id || json.id;
  if (json.data && !jobId) {
    return record('video async:true', false, 'server returned inline data instead of a job_id (async may be unsupported)');
  }
  record('video async:true (enqueue)', !!jobId, `job_id: ${jobId}; status: ${json.status}; queue_position: ${json.queue_position}`);
  if (!jobId) return;

  const deadline = Date.now() + 300_000; // 5 min
  let job;
  while (Date.now() < deadline) {
    const poll = await api(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
    job = poll.json;
    if (!poll.ok) return record('video job → completed', false, `HTTP ${poll.status}: ${JSON.stringify(job).slice(0, 200)}`);
    if (job.status === 'completed' || job.status === 'failed') break;
    process.stdout.write(`   polling job ${jobId}: ${job.status}\r`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('');
  if (!job || job.status !== 'completed') {
    return record('video job → completed', false, `final status: ${job ? job.status : 'timeout'}; error: ${job && job.error}`);
  }
  const url = job.output && (job.output.url || job.output.file_url);
  record('video job → completed (hosted URL)', !!url,
    `status: ${job.status}; url: ${job.output && job.output.url}; file_url: ${job.output && job.output.file_url}; ` +
    `format: ${job.output && job.output.format}; duration_ms: ${job.output && job.output.duration_ms}`);
}

console.log(`PageBolt live verification against ${BASE_URL} (target page: ${TARGET})\n`);
await checkObserveFlatDomTree();
await checkImportDryRun();
await checkAsyncVideo();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
