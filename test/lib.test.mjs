// Unit tests for the client-side helpers (no network, no MCP server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  preflight, formatPreflight, estimateVideoSeconds, expectedOutputSize, normalizePlan, MAX_EVALUATE_STEPS,
} from '../src/lib/limits.mjs';
import { resolveSavePath, prepareSaveTarget, writeVerified } from '../src/lib/save.mjs';
import { renderEvidence, completenessNote } from '../src/lib/evidence.mjs';
import { lookupPlan, resetPlanCache } from '../src/lib/plan.mjs';

const nav = { action: 'navigate', url: 'https://example.com' };

// ── validation: evaluate count ─────────────────────────────────────────
test('preflight: 3 evaluate steps is a hard error naming the steps and the fix', () => {
  const steps = [nav, ...Array.from({ length: 3 }, () => ({ action: 'evaluate', script: '1' }))];
  const r = preflight('video', { steps });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /3 evaluate steps.*step 1, step 2, step 3.*at most 2/);
  assert.match(r.errors[0], /IIFE/);
});

test('preflight: exactly 2 evaluate steps is fine for video and sequence', () => {
  const ev = { action: 'evaluate', script: '1' };
  assert.equal(MAX_EVALUATE_STEPS, 2);
  assert.deepEqual(preflight('video', { steps: [nav, ev, ev] }).errors, []);
  assert.deepEqual(preflight('sequence', { steps: [nav, ev, ev, { action: 'screenshot' }] }).errors, []);
});

// ── validation: step counts vs plan ────────────────────────────────────
test('preflight: steps over the plan cap warn (table is advisory), under the cap are silent', () => {
  const steps = Array.from({ length: 12 }, () => nav);
  const free = preflight('video', { steps }, { plan: 'free' });
  assert.deepEqual(free.errors, []);
  assert.ok(free.warnings.some((w) => /12 steps exceeds the 10-step limit of the free plan/.test(w)));
  const starter = preflight('video', { steps }, { plan: 'starter' });
  assert.ok(!starter.warnings.some((w) => /step limit/.test(w)));
  const seq = preflight('sequence', { steps: [...Array.from({ length: 21 }, () => nav), { action: 'screenshot' }] }, { plan: 'hobby' });
  assert.ok(seq.warnings.some((w) => /22 steps exceeds the 20-step limit of the hobby plan for run_sequence/.test(w)));
});

test('preflight: unknown plan skips plan checks; plan names normalise', () => {
  const r = preflight('video', { steps: Array.from({ length: 40 }, () => nav) });
  assert.ok(!r.warnings.some((w) => /step limit/.test(w)));
  assert.equal(normalizePlan('Pay As You Go'), 'payg');
  assert.equal(normalizePlan('Starter'), 'starter');
  assert.equal(normalizePlan('enterprise'), null);
});

test('preflight: run_sequence needs 1..5 outputs; gif + audio rejected', () => {
  assert.match(preflight('sequence', { steps: [nav] }).errors[0], /at least one output/);
  const six = Array.from({ length: 6 }, () => ({ action: 'screenshot' }));
  assert.match(preflight('sequence', { steps: [nav, ...six] }).errors[0], /6 output steps; the maximum is 5/);
  assert.match(preflight('video', { steps: [nav], format: 'gif', audioGuide: { enabled: true } }).errors[0], /gif/);
});

// ── validation: live wait ──────────────────────────────────────────────
test('preflight: wait directly after click/navigate/evaluate without live:true warns (video)', () => {
  for (const action of ['click', 'navigate', 'evaluate']) {
    const prev = action === 'navigate' ? nav : action === 'evaluate' ? { action, script: '1' } : { action, selector: '#go' };
    const r = preflight('video', { steps: [nav, prev, { action: 'wait', ms: 3000 }] });
    const w = r.warnings.find((x) => /step 2 is a wait right after/.test(x));
    assert.ok(w, `${action} should warn`);
    assert.match(w, /live:true/);
    assert.deepEqual(r.errors, [], 'a missing live flag is a warning, never an error');
  }
});

test('preflight: live wait, or wait after other actions, does not warn', () => {
  const live = preflight('video', { steps: [nav, { action: 'click', selector: '#go' }, { action: 'wait', ms: 3000, live: true }] });
  assert.ok(!live.warnings.some((w) => /wait right after/.test(w)));
  const afterHover = preflight('video', { steps: [nav, { action: 'hover', selector: '#x' }, { action: 'wait', ms: 500 }] });
  assert.ok(!afterHover.warnings.some((w) => /wait right after/.test(w)));
});

test('preflight: sequence wait after click gives the wait_for hint, not the live hint', () => {
  const r = preflight('sequence', { steps: [nav, { action: 'click', selector: '#a' }, { action: 'wait', ms: 500 }, { action: 'screenshot' }] });
  const w = r.warnings.find((x) => /wait right after/.test(x));
  assert.match(w, /wait_for/);
  assert.doesNotMatch(w, /live:true/);
});

test('preflight: wait x pace over 10 s, WebGPU evaluate, ignored narration, local URL', () => {
  const r = preflight('video', {
    pace: 'cinematic',
    audioGuide: { enabled: false },
    steps: [
      { action: 'navigate', url: 'http://localhost:3000/app', narration: 'hi' },
      { action: 'wait', ms: 4000, live: true },
      { action: 'evaluate', script: 'navigator.gpu.requestAdapter()' },
    ],
  });
  const all = r.warnings.join('\n');
  assert.match(all, /wait 4000 ms x pace 4\.5 = 18000 ms, capped at 10000/);
  assert.match(all, /references WebGPU/);
  assert.match(all, /1 step\(s\) have "narration" but audioGuide\.enabled is not true/);
  assert.match(all, /looks local\/private/);
});

// ── duration estimate ──────────────────────────────────────────────────
test('estimate: sums waits, pauseAfter, highlights and the default inter-step pause', () => {
  const e = estimateVideoSeconds({
    steps: [
      { action: 'wait', ms: 5000, live: true, pauseAfter: 0 },
      { action: 'wait', ms: 2000, pauseAfter: 1000 },
      { action: 'highlight', selector: '#x', duration: 3000, pauseAfter: 0 },
    ],
  });
  assert.equal(Math.round(e.seconds * 10) / 10, 11.0); // 5 + 2 + 1 + 3
  assert.deepEqual(e.startsAt.map((t) => Math.round(t * 10) / 10), [0, 5, 8]);
});

test('estimate: pace scales waits and default pauses; pauseAfter is exact', () => {
  const steps = [{ action: 'wait', ms: 1000 }, { action: 'wait', ms: 1000, pauseAfter: 500 }];
  const normal = estimateVideoSeconds({ steps }).seconds;      // 1+0.4 + 1+0.5
  const slow = estimateVideoSeconds({ steps, pace: 'slow' }).seconds; // 2+0.8 + 2+0.5
  assert.ok(Math.abs(normal - 2.9) < 0.01);
  assert.ok(Math.abs(slow - 5.3) < 0.01);
});

test('estimate: narration at ~150 wpm, overlap vs sequential, script mode', () => {
  const words = (n) => Array.from({ length: n }, () => 'word').join(' ');
  const step = { action: 'hover', selector: '#a', narration: words(75), pauseAfter: 0 }; // 30 s of speech
  const overlap = estimateVideoSeconds({ steps: [step], audioGuide: { enabled: true } }).seconds;
  const seq = estimateVideoSeconds({ steps: [step], audioGuide: { enabled: true, pacing: 'sequential' } }).seconds;
  assert.ok(overlap >= 30 && overlap < 31, `overlap ${overlap}`);
  assert.ok(seq >= 30 && seq < 31, `sequential ${seq}`);
  const ignored = estimateVideoSeconds({ steps: [step] }).seconds; // narration off
  assert.ok(ignored < 3);
  const script = estimateVideoSeconds({ steps: [{ action: 'hover', selector: '#a' }], audioGuide: { enabled: true, script: `Intro {{0}} ${words(150)}` } }).seconds;
  assert.ok(script >= 60 && script < 61, `script ${script}`);
});

test('estimate: warns above ~200 s, names the step where the plan budget ends, stays quiet below', () => {
  const long = Array.from({ length: 15 }, (_, i) => ({ action: 'wait', ms: 10000, live: true, pauseAfter: 0, ...(i === 0 ? {} : {}) }));
  const r = preflight('video', { steps: [nav, ...long], pace: 'normal' }, { plan: 'scale' });
  assert.ok(r.estimate.seconds > 150 && r.estimate.seconds < 160, `got ${r.estimate.seconds}`); // 0.8 + 0.4 + 150
  assert.deepEqual(r.warnings, [], '~151 s is under the 200 s warning line');
  const wayLong = preflight('video', { steps: [nav, ...Array.from({ length: 30 }, () => ({ action: 'wait', ms: 10000, live: true, pauseAfter: 0 }))] }, { plan: 'scale' });
  assert.match(wayLong.warnings.join('\n'), /above 200 s.*silently drop/);
  assert.match(wayLong.warnings.join('\n'), /Rendering will stop before step \d+ \(wait\)/);
  const short = preflight('video', { steps: [nav, { action: 'click', selector: '#a' }] }, { plan: 'starter' });
  assert.deepEqual(short.warnings, []);
  assert.ok(short.estimate.seconds < 10);
});

test('estimate: 5000-frame cap at the chosen framerate', () => {
  const steps = [nav, ...Array.from({ length: 20 }, () => ({ action: 'wait', ms: 10000, pauseAfter: 0 }))];
  const r = preflight('video', { steps, framerate: 60 });
  assert.match(r.warnings.join('\n'), /83 s at 60 fps/);
});

test('formatPreflight: empty when clean, estimate line + bullet list otherwise', () => {
  assert.equal(formatPreflight({ warnings: [], estimate: null }), '');
  const t = formatPreflight({ warnings: ['a', 'b'], estimate: { seconds: 41.2, budgetSeconds: 90 } });
  assert.match(t, /Pre-flight estimate: ~41 s of video \(plan budget 90 s\)/);
  assert.match(t, /warnings \(2, request was still sent\)/);
  assert.match(t, / {2}- a\n {2}- b/);
});

test('expectedOutputSize: viewport, frame bar, background padding, dsf', () => {
  assert.deepEqual(expectedOutputSize({}), { width: 1280, height: 720 });
  assert.deepEqual(expectedOutputSize({ viewport: { width: 1440, height: 900 }, frame: { enabled: true }, background: { enabled: true } }), { width: 1520, height: 1020 });
  assert.deepEqual(expectedOutputSize({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 2, frame: { enabled: true } }), { width: 2000, height: 1280 });
  assert.deepEqual(expectedOutputSize({ background: { enabled: true, padding: 100 } }), { width: 1480, height: 920 });
});

// ── saveTo ─────────────────────────────────────────────────────────────
function tmp() { return mkdtempSync(join(tmpdir(), 'pb-save-')); }

test('saveTo: creates missing parent folders recursively and returns absolute path + bytes', () => {
  const root = tmp();
  try {
    const env = { PAGEBOLT_MCP_SAVE_ROOT: root };
    const abs = resolveSavePath(join(root, 'a/b/c/demo.mp4'), 'x.mp4', { env, cwd: root });
    assert.equal(existsSync(join(root, 'a')), false, 'resolve alone must not touch disk');
    prepareSaveTarget(abs, { env, cwd: root });
    const out = writeVerified(abs, Buffer.from('hello world'));
    assert.equal(out.path, abs);
    assert.equal(out.path.startsWith('/'), true);
    assert.equal(out.bytes, 11);
    assert.equal(readFileSync(abs, 'utf8'), 'hello world');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('saveTo: relative paths resolve against cwd; default name used when omitted', () => {
  const root = tmp();
  try {
    const env = {};
    assert.equal(resolveSavePath('out/v.mp4', 'd.mp4', { env, cwd: root }), join(root, 'out/v.mp4'));
    assert.equal(resolveSavePath(undefined, './recording.mp4', { env, cwd: root }), join(root, 'recording.mp4'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('saveTo: outside the allowed roots fails loudly and says how to allow it', () => {
  const root = tmp();
  try {
    assert.throws(() => resolveSavePath('/etc/cron.d/x', 'd.mp4', { env: {}, cwd: root }), /outside the allowed folder.*PAGEBOLT_MCP_SAVE_ROOT/s);
    assert.throws(() => resolveSavePath('../escape.mp4', 'd.mp4', { env: {}, cwd: root }), /outside the allowed folder/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('saveTo: parent that cannot be created (a file is in the way) throws a clear error', () => {
  const root = tmp();
  try {
    writeFileSync(join(root, 'blocker'), 'x');
    const abs = join(root, 'blocker', 'sub', 'v.mp4');
    assert.throws(() => prepareSaveTarget(abs, { env: { PAGEBOLT_MCP_SAVE_ROOT: root }, cwd: root }), /cannot create parent folder/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('saveTo: a directory target and a symlink escaping the root are refused', () => {
  const root = tmp();
  const outside = tmp();
  try {
    const env = { PAGEBOLT_MCP_SAVE_ROOT: root };
    mkdirSync(join(root, 'dir'));
    assert.throws(() => prepareSaveTarget(join(root, 'dir'), { env, cwd: root }), /is a directory/);
    symlinkSync(outside, join(root, 'link'));
    assert.throws(() => prepareSaveTarget(join(root, 'link', 'v.mp4'), { env, cwd: root }), /symlink.*outside/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('saveTo: writeVerified throws (never returns a path) when the write fails', () => {
  const root = tmp();
  try {
    assert.throws(() => writeVerified(join(root, 'nope', 'v.mp4'), Buffer.from('x')), /writing .* failed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── evidence rendering ─────────────────────────────────────────────────
test('evidence: nothing to say when the backend sends none of the new fields', () => {
  assert.equal(renderEvidence({ steps_completed: 3, total_steps: 3, step_results: [{ step_index: 0, action: 'navigate', status: 'ok', duration_ms: 900 }] }, []), '');
  assert.equal(renderEvidence({}, []), '');
  assert.equal(renderEvidence(null, []), '');
});

test('evidence: failed, timed-out and skipped steps are listed (fields that exist today)', () => {
  const t = renderEvidence({
    step_results: [
      { step_index: 0, action: 'navigate', status: 'ok' },
      { step_index: 1, action: 'click', status: 'error', error: 'selector not found' },
      { step_index: 2, action: 'click', status: 'skipped' },
      { step_index: 3, action: 'wait', status: 'timeout', error: 'Video duration reached 28000ms' },
    ],
    auth_warnings: ['cookie for other domain ignored'],
  }, [nav, { action: 'click', selector: '#buy' }]);
  assert.match(t, /Step 1 click #buy: FAILED - selector not found/);
  assert.match(t, /Step 2 click.*skipped/);
  assert.match(t, /Step 3 wait: NOT RUN \(budget\) - Video duration reached 28000ms/);
  assert.match(t, /Server warnings \(1\)[\s\S]*cookie for other domain ignored/);
});

test('evidence: per-step timing, change flags, thumbnails, warnings, stopped_early, effective timeout', () => {
  const t = renderEvidence({
    stopped_early: true, stopped_at_step: 9, reason: 'duration budget reached', effective_timeout_ms: 75000,
    warnings: ['wait without live', { code: 'no_motion', message: 'canvas never repainted', step_index: 6 }],
    step_results: [
      { step_index: 6, action: 'wait', status: 'ok', start_s: 12.0, end_s: 17.0, changed: false, change_pct: 0, thumbnail_url: 'https://x/t6.jpg' },
      { step_index: 7, action: 'click', status: 'ok', start_s: 17.0, end_s: 18.2, changed: true },
    ],
  }, [{}, {}, {}, {}, {}, {}, { action: 'wait', ms: 5000 }]);
  assert.match(t, /STOPPED EARLY at step 9: duration budget reached/);
  assert.match(t, /effective render budget: 75\.0 s/);
  assert.match(t, /Step 6 wait 5\.0 s @12\.0 s-17\.0 s: no visual change \(0%\) - https:\/\/x\/t6\.jpg/);
  assert.match(t, /1\/2 steps visibly changed/);
  assert.match(t, /no_motion|canvas never repainted/);
  assert.match(t, /step 6: canvas never repainted \[no_motion\]/);
  assert.doesNotMatch(t, /Step 7 click/, 'steps that changed are not listed as problems');
});

test('evidence: live flag shows on the wait label; failures:false hides step errors (sequence has its own line)', () => {
  const t = renderEvidence({ step_results: [{ step_index: 0, action: 'wait', status: 'ok', start_s: 0, end_s: 5, changed: false }] }, [{ action: 'wait', ms: 5000, live: true }]);
  assert.match(t, /Step 0 wait 5\.0 s live/);
  const seq = renderEvidence({ step_results: [{ step_index: 0, action: 'click', status: 'error', error: 'x' }] }, [], { failures: false });
  assert.equal(seq, '');
});

test('completenessNote: only when steps_completed < total_steps', () => {
  assert.equal(completenessNote({ steps_completed: 5, total_steps: 5 }), '');
  assert.equal(completenessNote({}), '');
  assert.match(completenessNote({ steps_completed: 22, total_steps: 25 }), /INCOMPLETE: 22\/25/);
});

// ── plan lookup ────────────────────────────────────────────────────────
test('lookupPlan: reads /usage once, caches, and returns null on failure', async () => {
  const saved = process.env.PAGEBOLT_MCP_NO_PLAN_LOOKUP;
  delete process.env.PAGEBOLT_MCP_NO_PLAN_LOOKUP;
  try {
    resetPlanCache();
    let calls = 0;
    const ok = async (url, o) => { calls++; assert.ok(url.endsWith('/api/v1/usage')); assert.equal(o.headers['x-api-key'], 'k'); return { ok: true, json: async () => ({ plan: 'growth' }) }; };
    assert.equal(await lookupPlan({ baseUrl: 'https://pb', apiKey: 'k', fetchImpl: ok }), 'growth');
    assert.equal(await lookupPlan({ baseUrl: 'https://pb', apiKey: 'k', fetchImpl: ok }), 'growth');
    assert.equal(calls, 1);
    resetPlanCache();
    assert.equal(await lookupPlan({ baseUrl: 'https://pb', apiKey: 'k', fetchImpl: async () => { throw new Error('boom'); } }), null);
    resetPlanCache();
    assert.equal(await lookupPlan({ baseUrl: 'https://pb', apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 500 }) }), null);
  } finally {
    if (saved !== undefined) process.env.PAGEBOLT_MCP_NO_PLAN_LOOKUP = saved;
    resetPlanCache();
  }
});
