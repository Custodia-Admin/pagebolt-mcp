// Client-side pre-flight for record_video / run_sequence.
//
// Everything here mirrors limits the PageBolt backend enforces (or silently
// applies) so an agent hears about them BEFORE paying for a render:
//   - errors: requests the server rejects for sure (evaluate cap, gif+audio,
//     missing/too many sequence outputs). Not sent; nothing is billed either way.
//   - warnings: everything else, including plan-table checks (the table below is
//     a client-side copy and may lag the server, so it never blocks a request).
// Constants are copied from pagebolt src/config.js (videoLimits, sequenceLimits)
// and src/services/{video,sequence,highlight,narrationPacing}.js. Keep them in
// sync; the plan table is only a fallback when the plan cannot be looked up.

export const MAX_EVALUATE_STEPS = 2;
export const MAX_WAIT_MS = 10_000;
export const MAX_SEQUENCE_OUTPUTS = 5;
export const MAX_FRAMES = 5000;
export const RENDER_WALL_CAP_S = 240;
export const DURATION_WARN_S = 200;
const INTER_STEP_PAUSE_S = 0.4;
const NARRATION_WPM = 150;
const NARRATION_GAP_S = 0.25;
const TAIL_HOLD_S = 0.4;
const BUDGET_STOP_MARGIN_S = 2;

// plan -> { videoSteps, baseMs, perStepMs, formats, sequenceSteps }
export const PLAN_LIMITS = {
  free:    { videoSteps: 10, baseMs: 20_000, perStepMs: 5_000, formats: ['mp4'], sequenceSteps: 20 },
  hobby:   { videoSteps: 15, baseMs: 25_000, perStepMs: 5_000, formats: ['mp4'], sequenceSteps: 20 },
  starter: { videoSteps: 20, baseMs: 30_000, perStepMs: 5_000, formats: ['mp4', 'webm'], sequenceSteps: 30 },
  growth:  { videoSteps: 30, baseMs: 45_000, perStepMs: 6_000, formats: ['mp4', 'webm', 'gif'], sequenceSteps: 50 },
  scale:   { videoSteps: 50, baseMs: 60_000, perStepMs: 6_000, formats: ['mp4', 'webm', 'gif'], sequenceSteps: 100 },
  payg:    { videoSteps: 20, baseMs: 30_000, perStepMs: 5_000, formats: ['mp4', 'webm'], sequenceSteps: 30 },
};

const PACE_PRESETS = { fast: 0.5, normal: 1, slow: 2, dramatic: 3, cinematic: 4.5 };

export function paceMultiplier(pace) {
  if (typeof pace === 'number' && Number.isFinite(pace)) return Math.min(Math.max(pace, 0.25), 6);
  if (typeof pace === 'string' && PACE_PRESETS[pace]) return PACE_PRESETS[pace];
  return 1;
}

export function normalizePlan(plan) {
  const key = String(plan || '').toLowerCase().replace(/[^a-z]/g, '');
  if (PLAN_LIMITS[key]) return key;
  if (key === 'payasyougo') return 'payg';
  return null;
}

const wordCount = (text) => (String(text || '').trim().match(/\S+/g) || []).length;
const narrationSeconds = (text, speed) => (wordCount(text) / NARRATION_WPM) * 60 / (speed || 1);

// Same formula as the backend's highlight hold: duration*pace, long enough for
// a note to be read, never shorter than the spoken narration.
function highlightSeconds(step, pace, narrationS) {
  const base = ((step.duration || 3500) * pace) / 1000;
  const spoken = narrationS > 0 ? Math.min(narrationS + 0.3, 6) : 0;
  let hold = Math.max(base, spoken);
  if (step.note) {
    const read = Math.max(2000, Math.min(6000, String(step.note).length * 50));
    hold = Math.max(hold, ((read + 1200) * pace) / 1000);
  }
  return hold;
}

// Rough video seconds a step adds BEFORE the inter-step pause. Derived from the
// backend executor (cursor move 500 ms*pace, click effects, typing ~70 ms/char,
// 800 ms*pace navigate hold ...). Good to roughly +-30 %, which is enough to
// tell a 90 s plan from a 260 s one.
function stepSeconds(step, pace, narrationS) {
  const noteS = step.note && step.action !== 'highlight'
    ? Math.max(2, Math.min(6, String(step.note).length * 0.05)) : 0;
  switch (step.action) {
    case 'navigate': return 0.8 * pace + noteS;
    case 'click': return 0.82 * pace + 0.5 + noteS;
    case 'dblclick': return 0.9 * pace + 0.6 + noteS;
    case 'hover': return 0.7 * pace + noteS;
    case 'fill': return 0.7 * pace + (String(step.value || '').length * 0.07 * pace) + noteS;
    case 'select': return 1.0 * pace + noteS;
    case 'scroll': return 1.3 * pace + 0.8 + noteS;
    case 'press_key': return 0.3 * pace + noteS;
    case 'wait': return Math.min((step.ms || 0) * pace, MAX_WAIT_MS) / 1000;
    case 'wait_for': return 0.2;
    case 'evaluate': return 0.1;
    case 'highlight': return highlightSeconds(step, pace, narrationS);
    default: return 0;
  }
}

/** Estimate the finished video length. Returns { seconds, startsAt[] } (startsAt = video second each step begins). */
export function estimateVideoSeconds(params) {
  const steps = params.steps || [];
  const pace = paceMultiplier(params.pace);
  const guide = params.audioGuide && params.audioGuide.enabled ? params.audioGuide : null;
  const speed = guide && guide.speed ? guide.speed : 1;
  const sequentialNarration = guide && guide.pacing === 'sequential';
  const scriptMode = !!(guide && guide.script);

  let t = 0;
  let busyUntil = 0; // when the last narration clip stops speaking
  const startsAt = [];
  for (const step of steps) {
    const narrationS = guide && !scriptMode && step.narration ? narrationSeconds(step.narration, speed) : 0;
    if (narrationS > 0 && !sequentialNarration && busyUntil - t > 0.05) t = busyUntil + NARRATION_GAP_S;
    startsAt.push(t);
    if (narrationS > 0) busyUntil = t + narrationS;
    t += stepSeconds(step, pace, narrationS);
    t += typeof step.pauseAfter === 'number' ? step.pauseAfter / 1000 : INTER_STEP_PAUSE_S * pace;
    if (narrationS > 0 && sequentialNarration && busyUntil > t) t = busyUntil;
  }
  if (scriptMode) {
    t = Math.max(t, narrationSeconds(guide.script.replace(/\{\{\d+\}\}/g, ' '), speed));
  } else if (busyUntil > t) {
    t = busyUntil + TAIL_HOLD_S;
  }
  return { seconds: t, startsAt };
}

function planBudgetSeconds(plan, stepCount, pace) {
  const lim = PLAN_LIMITS[plan];
  if (!lim) return null;
  return (lim.baseMs + stepCount * lim.perStepMs * Math.max(pace, 1)) / 1000;
}

const fmtS = (s) => `${Math.round(s)} s`;

/**
 * Validate a record_video / run_sequence request.
 * @param {'video'|'sequence'} kind
 * @param {object} params   tool arguments
 * @param {{plan?: string|null}} [ctx]   caller's plan if known
 * @returns {{errors: string[], warnings: string[], estimate: null | {seconds:number, budgetSeconds:number|null}}}
 */
export function preflight(kind, params, ctx = {}) {
  const errors = [];
  const warnings = [];
  const steps = Array.isArray(params.steps) ? params.steps : [];
  const plan = normalizePlan(ctx.plan);
  const lim = plan ? PLAN_LIMITS[plan] : null;
  const label = (i) => `step ${i}`; // 0-based, same as the server's "Step N" errors

  // ── hard: evaluate cap ──
  const evalIdx = steps.map((s, i) => (s.action === 'evaluate' ? i : -1)).filter((i) => i >= 0);
  if (evalIdx.length > MAX_EVALUATE_STEPS) {
    errors.push(
      `${evalIdx.length} evaluate steps (at ${evalIdx.map(label).join(', ')}) but PageBolt allows at most ${MAX_EVALUATE_STEPS} per ${kind}. ` +
      'Fold the page actions into ONE async IIFE with setTimeout gaps, or expose hooks from the app and drive them from a single evaluate.',
    );
  }

  // ── plan step cap: a WARNING (the table is a client-side copy; the server's 400 is authoritative) ──
  if (lim) {
    const max = kind === 'video' ? lim.videoSteps : lim.sequenceSteps;
    if (steps.length > max) {
      warnings.push(`${steps.length} steps exceeds the ${max}-step limit of the ${plan} plan for ${kind === 'video' ? 'record_video' : 'run_sequence'}; the server will most likely reject it. Cut steps or upgrade.`);
    }
  }

  if (kind === 'video') {
    const format = params.format || 'mp4';
    if (lim && !lim.formats.includes(format)) {
      warnings.push(`format "${format}" is not available on the ${plan} plan (allowed: ${lim.formats.join(', ')}); the server will most likely reject it.`);
    }
    if (format === 'gif' && params.audioGuide && params.audioGuide.enabled) {
      errors.push('audioGuide is not supported with format "gif". Use mp4 or webm.');
    }
  } else {
    const outputs = steps.filter((s) => ['screenshot', 'pdf', 'diff'].includes(s.action)).length;
    if (outputs === 0) errors.push('run_sequence needs at least one output step (screenshot, pdf or diff).');
    if (outputs > MAX_SEQUENCE_OUTPUTS) errors.push(`${outputs} output steps; the maximum is ${MAX_SEQUENCE_OUTPUTS} per sequence.`);
  }

  // ── warnings: wait without live:true right after something that animates ──
  steps.forEach((s, i) => {
    if (s.action !== 'wait' || s.live || i === 0) return;
    const prev = steps[i - 1];
    if (['click', 'dblclick', 'navigate', 'evaluate'].includes(prev.action)) {
      warnings.push(
        `${label(i)} is a wait right after ${prev.action}` + (kind === 'video' ? ' without live:true. ' : '. ') +
        (kind === 'video'
          ? 'A non-live wait freezes ONE frame for its whole length, so any animation, video, canvas or loading state that follows the ' + prev.action + ' will NOT be captured. Add live:true to record it in real time (or delete the wait if you only wanted a pause).'
          : 'In run_sequence a wait is just a delay; use wait_for with a selector if you need the page to be ready.'),
      );
    }
  });

  if (kind === 'video') {
    const pace = paceMultiplier(params.pace);
    steps.forEach((s, i) => {
      if (s.action === 'wait' && s.ms && s.ms * pace > MAX_WAIT_MS) {
        warnings.push(`${label(i)}: wait ${s.ms} ms x pace ${pace} = ${Math.round(s.ms * pace)} ms, capped at ${MAX_WAIT_MS} ms by the server.`);
      }
      if (s.action === 'evaluate') {
        warnings.push(`${label(i)} (evaluate): the script runs but its own time is not recorded as motion. Anything it starts (timers, animation) only shows up if a live:true wait follows it.`);
      }
      if (s.action === 'evaluate' && /navigator\s*\.\s*gpu|requestAdapter|webgpu/i.test(s.script || '')) {
        warnings.push(`${label(i)} (evaluate) references WebGPU. PageBolt's browsers have no WebGPU; the page will take its fallback path on camera.`);
      }
    });

    const narratedSteps = steps.filter((s) => s.narration).length;
    if (narratedSteps > 0 && !(params.audioGuide && params.audioGuide.enabled)) {
      warnings.push(`${narratedSteps} step(s) have "narration" but audioGuide.enabled is not true, so the narration is ignored (silent video).`);
    }

    const urls = steps.filter((s) => s.action === 'navigate' && s.url).map((s) => s.url);
    const local = urls.find((u) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^/]*\.local(?::|\/|$))/i.test(u));
    if (local) {
      warnings.push(`navigate target ${local} looks local/private. PageBolt renders in its own cloud browser and refuses private addresses; expose the app on a public HTTPS URL (tunnel) first.`);
    }

    // ── warnings: duration ──
    const est = estimateVideoSeconds(params);
    const fps = params.framerate || 30;
    const frameCapS = MAX_FRAMES / fps;
    const budget = plan ? planBudgetSeconds(plan, steps.length, pace) : null;
    if (est.seconds > DURATION_WARN_S) {
      warnings.push(`estimated length ${fmtS(est.seconds)} is above ${DURATION_WARN_S} s. Renders stop at ~${RENDER_WALL_CAP_S} s of wall-clock and ${MAX_FRAMES} frames (${fmtS(frameCapS)} at ${fps} fps) and silently drop the remaining steps (the result only shows "Steps: N/M"). Cut low-value steps, use pace:"fast", or split into segments.`);
    } else if (est.seconds > frameCapS) {
      warnings.push(`estimated length ${fmtS(est.seconds)} exceeds the ${MAX_FRAMES}-frame cap (${fmtS(frameCapS)} at ${fps} fps); the tail will be cut.`);
    }
    if (budget && est.seconds > budget - BUDGET_STOP_MARGIN_S) {
      const stopAt = est.startsAt.findIndex((t) => t >= budget - BUDGET_STOP_MARGIN_S);
      warnings.push(
        `estimated length ${fmtS(est.seconds)} exceeds the ${plan} plan's video budget of ${fmtS(budget)} ` +
        `(${lim.baseMs / 1000} s + ${steps.length} steps x ${lim.perStepMs / 1000} s x max(pace,1)). ` +
        (stopAt >= 0 ? `Rendering will stop before ${label(stopAt)} (${steps[stopAt].action}) and later steps will be dropped.` : 'The last steps will be cut.'),
      );
    }
    return { errors, warnings, estimate: { seconds: est.seconds, budgetSeconds: budget } };
  }

  return { errors, warnings, estimate: null };
}

/** Compact text block for tool results. */
export function formatPreflight({ warnings, estimate }, { includeEstimate = true } = {}) {
  const lines = [];
  if (estimate && includeEstimate) {
    lines.push(`Pre-flight estimate: ~${fmtS(estimate.seconds)} of video` + (estimate.budgetSeconds ? ` (plan budget ${fmtS(estimate.budgetSeconds)})` : '') + '.');
  }
  if (warnings.length) {
    lines.push(`Pre-flight warnings (${warnings.length}, request was still sent):`);
    for (const w of warnings) lines.push(`  - ${w}`);
  }
  return lines.join('\n');
}

const makeEven = (n) => (n % 2 === 0 ? n : n + 1);

/**
 * Expected output pixel size of a video, mirroring the backend's compositing
 * (viewport x deviceScaleFactor, + 40 px*dsf title bar when frame is on,
 * + 2*padding on each axis when background is on; padding 0 is treated as the
 * default 40 by the server). Returns {width, height}. Informational only.
 */
export function expectedOutputSize(params) {
  const vp = params.viewport || {};
  const dsf = Math.min(Math.max(params.deviceScaleFactor || 1, 1), 3);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  let w = makeEven(clamp(vp.width || 1280, 320, 3840) * dsf);
  let h = makeEven(clamp(vp.height || 720, 200, 2160) * dsf);
  if (params.frame && params.frame.enabled) h += Math.round(40 * dsf);
  if (params.background && params.background.enabled) {
    const pad = clamp(params.background.padding || 40, 0, 120);
    w = makeEven(w + pad * 2);
    h = makeEven(h + pad * 2);
  }
  return { width: w, height: h };
}
