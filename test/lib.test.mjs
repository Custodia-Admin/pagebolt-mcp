// Unit tests for the client-side helpers (no network, no MCP server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  preflight, formatPreflight, estimateVideoSeconds, expectedOutputSize, normalizePlan, MAX_EVALUATE_STEPS, authoringErrors,
} from '../src/lib/limits.mjs';
import { resolveSavePath, prepareSaveTarget, writeVerified } from '../src/lib/save.mjs';
import { renderEvidence, completenessNote, evidenceImages, renderRehearsal } from '../src/lib/evidence.mjs';
import { lookupPlan, resetPlanCache } from '../src/lib/plan.mjs';

const nav = { action: 'navigate', url: 'https://example.com' };

// ── validation: evaluate count ─────────────────────────────────────────
test('preflight: 11 evaluate steps is a hard error naming the steps and the fix', () => {
  const steps = [nav, ...Array.from({ length: 11 }, () => ({ action: 'evaluate', script: '1' }))];
  const r = preflight('video', { steps });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /11 evaluate steps.*step 1, step 2.*step 11.*at most 10/);
  assert.match(r.errors[0], /Merge the scripts/);
});

test('preflight: up to 10 evaluate steps is fine for video and sequence (server limit is 10, was 2)', () => {
  const ev = { action: 'evaluate', script: '1' };
  assert.equal(MAX_EVALUATE_STEPS, 10);
  const ten = Array.from({ length: 10 }, () => ev);
  assert.deepEqual(preflight('video', { steps: [nav, ...ten] }).errors, []);
  assert.deepEqual(preflight('sequence', { steps: [nav, ...ten, { action: 'screenshot' }] }).errors, []);
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
test('preflight: an explicit live:false wait right after click/navigate/evaluate warns (video); the default does not', () => {
  for (const action of ['click', 'navigate', 'evaluate', 'press_key', 'select']) {
    const prev = action === 'navigate' ? nav : action === 'evaluate' ? { action, script: '1' } : { action, selector: '#go' };
    const r = preflight('video', { steps: [nav, prev, { action: 'wait', ms: 3000, live: false }] });
    const w = r.warnings.find((x) => /step 2 is a wait with live:false right after/.test(x));
    assert.ok(w, `${action} should warn`);
    assert.match(w, /Remove live:false/);
    assert.deepEqual(r.errors, [], 'a static wait is a warning, never an error');
    // the server records this wait live by default: no warning without the flag
    const dflt = preflight('video', { steps: [nav, prev, { action: 'wait', ms: 3000 }] });
    assert.ok(!dflt.warnings.some((x) => /wait (with live:false )?right after/.test(x)), `${action} default wait is live on the server`);
  }
});

test('preflight: live:true wait, or live:false after a non-animating action, does not warn', () => {
  const live = preflight('video', { steps: [nav, { action: 'click', selector: '#go' }, { action: 'wait', ms: 3000, live: true }] });
  assert.ok(!live.warnings.some((w) => /right after/.test(w)));
  const afterHover = preflight('video', { steps: [nav, { action: 'hover', selector: '#x' }, { action: 'wait', ms: 500, live: false }] });
  assert.ok(!afterHover.warnings.some((w) => /right after/.test(w)));
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

test('evidence: server field names - per-step timing, change flags, visible:false, warnings, stopped_early + stop_reason + budget', () => {
  const t = renderEvidence({
    stopped_early: true, stopped_at_step: 9, stop_reason: 'max_duration',
    budget: { effective_timeout_ms: 75000, video_time_used_ms: 74100, max_steps: 20 },
    warnings: ['step 6 (wait, 5000 ms): no visual change captured; if the page animates, use live:true',
      'step 7 highlight #detail: element not visible (offscreen x=1520>=1440)',
      'step 7 highlight #detail: element not visible (offscreen x=1520>=1440)'],
    step_results: [
      { step_index: 6, index: 6, action: 'wait', status: 'ok', start_s: 12.0, end_s: 17.0, frames_captured: 150, screencast_frames: 0, changed: false, live: false, live_reason: 'auto_static' },
      { step_index: 7, index: 7, action: 'highlight', status: 'ok', start_s: 17.0, end_s: 18.2, changed: true, visible: false, highlight_drawn: false, selector: '#detail', warnings: ['step 7 highlight #detail: element not visible (offscreen x=1520>=1440)'] },
      { step_index: 8, index: 8, action: 'click', status: 'ok', start_s: 18.2, end_s: 19.4, changed: true, visible: true },
    ],
  }, [{}, {}, {}, {}, {}, {}, { action: 'wait', ms: 5000 }]);
  assert.match(t, /STOPPED EARLY at step 9: max_duration/);
  assert.match(t, /effective render budget: 75\.0 s, video time used 74\.1 s/);
  assert.match(t, /Step 6 wait 5\.0 s static @12\.0 s-17\.0 s: no visual change \(150 frames\)/);
  assert.match(t, /Step 7 highlight #detail @17\.0 s-18\.2 s: target NOT VISIBLE - nothing was drawn - step 7 highlight #detail: element not visible/);
  assert.match(t, /2\/3 steps visibly changed/);
  assert.doesNotMatch(t, /Step 8 click/, 'steps that changed and are visible are not listed as problems');
  const warnBlock = t.slice(t.indexOf('Server warnings'));
  assert.match(warnBlock, /Server warnings \(3\)/);
  assert.equal((warnBlock.match(/element not visible/g) || []).length, 1, 'identical warnings are listed once');
});

test('evidence: narration sync offset (script mode) and coordinate/rect step labels', () => {
  const t = renderEvidence({
    step_results: [
      { step_index: 0, action: 'click', status: 'error', error: 'timed out' },
      { step_index: 1, action: 'highlight', status: 'error', error: 'x' },
      { step_index: 2, action: 'hover', status: 'ok', sync_offset_ms: 340 },
    ],
  }, [{ action: 'click', x: 640, y: 360 }, { action: 'highlight', rect: { x: 10, y: 20, width: 30, height: 40 } }, { action: 'hover', selector: '#a' }]);
  assert.match(t, /Step 0 click \(640,360\): FAILED/);
  assert.match(t, /Step 1 highlight rect\(10,20 30x40\): FAILED/);
  assert.match(t, /Step 2 hover #a: narration marker off by 340 ms/);
});

test('evidenceImages: step_thumbnails become image blocks (capped)', () => {
  const data = { step_results: Array.from({ length: 15 }, (_, i) => ({ step_index: i, thumbnail_base64: 'QUJD', thumbnail_content_type: 'image/jpeg' })) };
  const imgs = evidenceImages(data);
  assert.equal(imgs.length, 12);
  assert.deepEqual(imgs[0], { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' });
  assert.deepEqual(evidenceImages({}), []);
  assert.equal(evidenceImages({ step_results: [{ step_index: 0 }] }).length, 0);
});

test('renderRehearsal: ok/error/visible per step, resolved point, warnings once, screenshots as images', () => {
  const shot = (s) => ({ content_type: 'image/jpeg', width: 640, height: 360, size_bytes: 3, data: s });
  const { text, images } = renderRehearsal({
    rehearse: true, ok: false, steps_total: 4, steps_ok: 3, steps_failed: 1, duration_ms: 4200, viewport: { width: 1440, height: 900 },
    usage: { rehearse_cost: 1, remaining: 99 }, ignored: ['audioGuide'],
    warnings: ['step 2 highlight #detail: element not visible (offscreen x=1520>=1440)'],
    steps: [
      { index: 0, action: 'navigate', ok: true, screenshot: shot('QQ==') },
      { index: 1, action: 'click', ok: false, error: 'Selector "#nope" did not match any element within 1200ms', screenshot: shot('Qg==') },
      { index: 2, action: 'highlight', ok: true, visible: false, highlight_drawn: false, selector: '#detail', warnings: ['step 2 highlight #detail: element not visible (offscreen x=1520>=1440)'], screenshot: shot('Qw==') },
      { index: 3, action: 'click', ok: true, visible: true, resolved_point: { x: 300, y: 200 } },
    ],
  }, [{}, { action: 'click', selector: '#nope' }, {}, { action: 'click', x: 300, y: 200 }]);
  assert.match(text, /Rehearsal FOUND PROBLEMS \(no video encoded, no narration\): 3\/4 steps ok in 4\.2 s/);
  assert.match(text, /Cost:\s+1 API request\(s\), 99 remaining/);
  assert.match(text, /Step 1 click #nope: FAILED - Selector "#nope" did not match/);
  assert.match(text, /Step 2 highlight #detail: target NOT VISIBLE \(no highlight would be drawn\) - step 2 highlight #detail: element not visible/);
  assert.equal((text.match(/element not visible/g) || []).length, 1, 'the top-level warning duplicates the step line and is not repeated');
  assert.match(text, /Ignored by a rehearsal: audioGuide/);
  assert.equal(images.length, 3);
  assert.equal(images[1].data, 'Qg==');
  assert.match(text, /3 screenshot\(s\) attached/);
});

test('evidence: the server\'s live verdict shows on the wait label; failures:false hides step errors (sequence has its own line)', () => {
  const t = renderEvidence({ step_results: [{ step_index: 0, action: 'wait', status: 'ok', start_s: 0, end_s: 5, changed: false, live: true }] }, [{ action: 'wait', ms: 5000 }]);
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

test('expectedOutputSize honours an explicit output size', () => {
  assert.deepEqual(expectedOutputSize({ output: { width: 1920, height: 1080 }, frame: { enabled: true } }), { width: 1920, height: 1080 });
});

test('estimate: card uses durationMs (default 3 s, NOT pace-scaled) + 0.35 s fade, and lasts for its narration', () => {
  const sec = (steps, extra = {}) => estimateVideoSeconds({ steps, ...extra }).seconds;
  assert.ok(Math.abs(sec([{ action: 'card', title: 'x', durationMs: 4000, pauseAfter: 0 }]) - 4.35) < 0.01);
  assert.ok(Math.abs(sec([{ action: 'card', title: 'x', pauseAfter: 0 }]) - 3.35) < 0.01);
  assert.ok(Math.abs(sec([{ action: 'card', title: 'x', durationMs: 4000, pauseAfter: 0 }], { pace: 'slow' }) - 4.35) < 0.01, 'pace does not change a card');
  const words = Array.from({ length: 50 }, () => 'w').join(' ');   // 20 s of speech at 150 wpm
  const narrated = sec([{ action: 'card', title: 'x', durationMs: 2000, narration: words, pauseAfter: 0 }], { audioGuide: { enabled: true } });
  assert.ok(narrated > 20 && narrated < 21.5, `narrated card ~20.75 s, got ${narrated}`);
});

test('estimate: a narrated highlight lasts as long as its clip (cap 40 s) unless exactDuration:true', () => {
  const words = Array.from({ length: 50 }, () => 'w').join(' ');   // 20 s of speech
  const base = { action: 'highlight', selector: '#a', duration: 2000, narration: words, pauseAfter: 0 };
  const long = estimateVideoSeconds({ steps: [base], audioGuide: { enabled: true, pacing: 'sequential' } }).seconds;
  const exact = estimateVideoSeconds({ steps: [{ ...base, exactDuration: true }], audioGuide: { enabled: true, pacing: 'sequential' } }).seconds;
  assert.ok(long >= 20, `got ${long}`);
  assert.ok(exact >= 20, 'sequential still waits for the voice to finish before the next step');
  const ov = estimateVideoSeconds({ steps: [{ ...base, exactDuration: true }], audioGuide: { enabled: true } }).seconds;
  assert.ok(ov < long + 1);
});

test('authoringErrors: output, audio, coordinate targets, rect, card, highlight style mirror the server validation', () => {
  const nav = { action: 'navigate', url: 'https://example.com' };
  const errs = (p) => authoringErrors({ viewport: { width: 640, height: 360 }, ...p });
  assert.deepEqual(errs({ output: { width: 1920, height: 1080 }, audio: { sampleRate: 48000, channels: 2 }, steps: [nav, { action: 'click', x: 10, y: 20 }, { action: 'highlight', rect: { x: 0, y: 0, width: 640, height: 360 }, style: 'glide' }, { action: 'card', title: 'Hi', durationMs: 500 }] }), []);
  assert.match(errs({ output: { width: 1921, height: 1080 }, steps: [nav] })[0], /even/);
  assert.match(errs({ output: { width: 300, height: 1080 }, steps: [nav] })[0], /output\.width/);
  assert.match(errs({ output: { width: 1920, height: 1080, fit: 'fill' }, steps: [nav] })[0], /output\.fit must be one of: contain, cover/);
  assert.match(errs({ format: 'gif', output: { width: 1920, height: 1080 }, steps: [nav] })[0], /not supported for format "gif"/);
  assert.match(errs({ audio: { sampleRate: 16000 }, steps: [nav] })[0], /audio\.sampleRate must be one of: 24000, 44100, 48000/);
  assert.match(errs({ steps: [nav, { action: 'click', x: 700, y: 20 }] })[0], /step 1 \(click\): point \(700, 20\) is outside the 640x360 viewport/);
  assert.match(errs({ steps: [nav, { action: 'hover', x: 5 }] })[0], /numeric x and y/);
  assert.match(errs({ steps: [nav, { action: 'click', selector: '#a', x: 1, y: 2 }] })[0], /either "selector" or the x\/y point/);
  assert.match(errs({ steps: [nav, { action: 'click' }] })[0], /needs a "selector" or an x\/y point/);
  assert.match(errs({ steps: [nav, { action: 'highlight', rect: { x: 600, y: 0, width: 100, height: 10 } }] })[0], /rect must lie inside the 640x360 viewport/);
  assert.match(errs({ steps: [nav, { action: 'highlight', selector: '#a', rect: { x: 0, y: 0, width: 5, height: 5 } }] })[0], /either "selector" or "rect"/);
  assert.match(errs({ steps: [nav, { action: 'highlight' }] })[0], /needs a "selector" or a "rect"/);
  assert.match(errs({ steps: [nav, { action: 'highlight', selector: '#a', style: 'sparkle' }] })[0], /style must be one of: outline, pulse, glow, spotlight, arrow, focus, ring, glide/);
  assert.match(errs({ steps: [nav, { action: 'card', title: '   ' }] })[0], /non-empty "title"/);
  assert.match(errs({ steps: [nav, { action: 'card', title: 'x', durationMs: 100 }] })[0], /durationMs must be 500-10000/);
  assert.match(errs({ steps: [nav, { action: 'card', title: 'x', theme: { accent: 'red' } }] })[0], /theme\.accent must be a #RRGGBB/);
  // default viewport is 1280x720
  assert.deepEqual(authoringErrors({ steps: [nav, { action: 'click', x: 1279, y: 719 }] }), []);
  assert.equal(authoringErrors({ steps: [nav, { action: 'click', x: 1280, y: 10 }] }).length, 1);
});
