// Render per-step evidence from a PageBolt video/sequence response so an agent
// can tell whether a render actually did what it asked.
//
// Field names are the server's (pagebolt src/services/videoEvidence.js, docs/video-first-time-right.md):
//   step_results[]  { step_index, index, action, status: ok|skipped|error|timeout, error,
//                     duration_ms, selector, start_s, end_s, frames_captured, screencast_frames,
//                     changed (true|false|null), live, live_reason (waits),
//                     visible (false = target hidden / off-screen / covered), warnings[],
//                     highlight_style, highlight_drawn, highlight_start_s, narration_start_s,
//                     sync_offset_ms, thumbnail_base64 + thumbnail_content_type (step_thumbnails:true) }
//   warnings[]      strings, ONE list for the request (visibility, narration sync, static waits, early stop)
//   auth_warnings[] strings
//   stopped_early   boolean (always present); stopped_at_step, stop_reason when true
//   budget          { effective_timeout_ms, max_steps, per_step_budget_ms, max_frames, video_time_used_ms, ... }
//   video_duration_s
// Older backends send none of the newer fields: the output is then only the steps that
// failed/timed out - or nothing.

const sec = (v) => `${(Number(v)).toFixed(1)} s`;

function warnText(w) {
  if (w == null) return null;
  if (typeof w === 'string') return w;
  const msg = w.message || w.error || w.text || JSON.stringify(w);
  const where = w.step_index != null ? `step ${w.step_index}: ` : '';
  return `${where}${msg}${w.code ? ` [${w.code}]` : ''}`;
}

function stepName(r, steps) {
  const req = steps && steps[r.step_index];
  const action = r.action || (req && req.action) || 'step';
  let label = `Step ${r.step_index} ${action}`;
  if (action === 'wait') {
    const held = r.start_s != null && r.end_s != null ? r.end_s - r.start_s : (req && req.ms != null ? req.ms / 1000 : null);
    if (held != null) label += ` ${sec(held)}`;
    // Server verdict first (r.live), then what was asked for.
    const live = typeof r.live === 'boolean' ? r.live : !!(req && req.live);
    if (live) label += ' live';
    else if (r.live === false) label += ' static';
  } else if (r.selector || (req && req.selector)) {
    label += ` ${r.selector || req.selector}`;
  } else if (req && typeof req.x === 'number' && typeof req.y === 'number') {
    label += ` (${req.x},${req.y})`;
  } else if (req && req.rect) {
    label += ` rect(${req.rect.x},${req.rect.y} ${req.rect.width}x${req.rect.height})`;
  }
  return label;
}

/**
 * @param {object} data    API response (or async job output)
 * @param {Array}  steps   the steps that were sent (for labels)
 * @returns {string}       multi-line text ('' when there is nothing to add)
 */
export function renderEvidence(data, steps = [], { failures = true } = {}) {
  if (!data || typeof data !== 'object') return '';
  const lines = [];
  const results = Array.isArray(data.step_results) ? data.step_results.filter((r) => r && r.step_index != null) : [];
  const timed = results.filter((r) => r.start_s != null && r.end_s != null);
  const hasChangeInfo = results.some((r) => typeof r.changed === 'boolean');

  // stopped early / budget (stop_reason is the server's; reason / stopped_reason kept for older builds)
  const reason = data.stop_reason || data.reason || data.stopped_reason;
  if (data.stopped_early || data.stopped_at_step != null) {
    let l = `STOPPED EARLY${data.stopped_at_step != null ? ` at step ${data.stopped_at_step}` : ''}`;
    if (reason) l += `: ${reason}`;
    else l += ': later steps were not recorded';
    lines.push(l);
    const eff = (data.budget && data.budget.effective_timeout_ms) ?? data.effective_timeout_ms ?? data.effective_max_duration_ms;
    if (eff != null) {
      const used = data.budget && data.budget.video_time_used_ms;
      lines.push(`  effective render budget: ${sec(eff / 1000)}${used != null ? `, video time used ${sec(used / 1000)}` : ''}`);
    }
  }

  // problems: failed, timed out, skipped, hidden target, or (when known) no visual change
  const problem = [];
  for (const r of results) {
    if (!failures && (r.status === 'error' || r.status === 'timeout' || r.status === 'skipped')) continue;
    const where = timed.includes(r) ? ` @${sec(r.start_s)}-${sec(r.end_s)}` : '';
    if (r.status === 'error' || r.status === 'timeout') {
      problem.push(`  ${stepName(r, steps)}${where}: ${r.status === 'timeout' ? 'NOT RUN (budget)' : 'FAILED'}${r.error ? ` - ${r.error}` : ''}`);
    } else if (r.status === 'skipped') {
      problem.push(`  ${stepName(r, steps)}${where}: skipped (optional target not found)`);
    } else if (r.visible === false) {
      const drawn = r.highlight_drawn === false ? ' - nothing was drawn' : '';
      problem.push(`  ${stepName(r, steps)}${where}: target NOT VISIBLE${drawn}${Array.isArray(r.warnings) && r.warnings[0] ? ` - ${r.warnings[0]}` : ''}`);
    } else if (r.changed === false) {
      problem.push(`  ${stepName(r, steps)}${where}: no visual change${r.frames_captured != null ? ` (${r.frames_captured} frames)` : ''}`);
    }
  }
  if (problem.length) {
    lines.push('Step evidence (only steps that need attention):');
    lines.push(...problem);
  }

  if (hasChangeInfo) {
    const moved = results.filter((r) => r.changed === true).length;
    const known = results.filter((r) => typeof r.changed === 'boolean').length;
    lines.push(`  ${moved}/${known} steps visibly changed the picture.`);
  }
  if (timed.length && results.length && !data.stopped_early) {
    const last = timed[timed.length - 1];
    lines.push(`  Timeline covers ${sec(timed[0].start_s)}-${sec(last.end_s)} across ${timed.length} step(s).`);
  }
  const desynced = results.filter((r) => typeof r.sync_offset_ms === 'number');
  for (const r of desynced) lines.push(`  ${stepName(r, steps)}: narration marker off by ${r.sync_offset_ms} ms`);

  // ONE warnings[] from the server (step-level warnings are already inside it).
  const warns = [...(data.warnings || []), ...(data.auth_warnings || [])].map(warnText).filter(Boolean);
  if (warns.length) {
    lines.push(`Server warnings (${warns.length}):`);
    for (const w of [...new Set(warns)]) lines.push(`  - ${w}`);
  }
  return lines.join('\n');
}

/**
 * MCP image blocks for per-step thumbnails (request step_thumbnails:true). The server caps the
 * whole response at ~400 KB; we additionally attach at most `max` of them.
 */
export function evidenceImages(data, { max = 12 } = {}) {
  const results = data && Array.isArray(data.step_results) ? data.step_results : [];
  const out = [];
  for (const r of results) {
    if (out.length >= max) break;
    if (r && typeof r.thumbnail_base64 === 'string' && r.thumbnail_base64) {
      out.push({ type: 'image', data: r.thumbnail_base64, mimeType: r.thumbnail_content_type || 'image/jpeg' });
    }
  }
  return out;
}

/** One-line completeness verdict from step counts. */
export function completenessNote(data) {
  if (!data || data.steps_completed == null || data.total_steps == null) return '';
  if (data.steps_completed >= data.total_steps) return '';
  return `INCOMPLETE: ${data.steps_completed}/${data.total_steps} steps ran. The video exists but is missing steps; check the list above (or the plan budget) and re-record the missing segment.`;
}

/**
 * Text + screenshots for a rehearsal response (POST /api/v1/video/rehearse):
 *   { rehearse, ok, steps_total, steps_ok, steps_failed, duration_ms, viewport,
 *     steps: [{ index, action, ok, error?, skipped?, duration_ms, selector?, selector_matches?,
 *              resolved_selector_box?, resolved_point?, in_viewport?, visible?, warnings?,
 *              highlight_drawn?, screenshot?{content_type,width,height,size_bytes,data} }],
 *     warnings?, ignored?, usage{rehearse_cost, remaining} }
 */
export function renderRehearsal(data, steps = [], { maxImages = 20 } = {}) {
  const lines = [];
  const images = [];
  const list = Array.isArray(data && data.steps) ? data.steps : [];
  lines.push(`Rehearsal ${data.ok ? 'passed' : 'FOUND PROBLEMS'} (no video encoded, no narration): ${data.steps_ok ?? list.filter((s) => s.ok).length}/${data.steps_total ?? list.length} steps ok${data.duration_ms != null ? ` in ${sec(data.duration_ms / 1000)}` : ''}.`);
  if (data.viewport) lines.push(`  Viewport: ${data.viewport.width}x${data.viewport.height}`);
  if (data.usage && data.usage.rehearse_cost != null) lines.push(`  Cost:     ${data.usage.rehearse_cost} API request(s)${data.usage.remaining != null ? `, ${data.usage.remaining} remaining` : ''}`);
  const nameOf = (s) => {
    const req = steps[s.index] || {};
    let l = `Step ${s.index} ${s.action}`;
    if (s.selector || req.selector) l += ` ${s.selector || req.selector}`;
    else if (s.resolved_point) l += ` (${s.resolved_point.x},${s.resolved_point.y})`;
    return l;
  };
  const bad = [];
  for (const s of list) {
    if (s.skipped && s.ok) { bad.push(`  ${nameOf(s)}: skipped (optional target not found or banner already hidden)`); continue; }
    if (!s.ok) { bad.push(`  ${nameOf(s)}: ${s.skipped ? 'NOT RUN' : 'FAILED'}${s.error ? ` - ${s.error}` : ''}`); continue; }
    if (s.visible === false) bad.push(`  ${nameOf(s)}: target NOT VISIBLE${s.highlight_drawn === false ? ' (no highlight would be drawn)' : ''}${s.warnings && s.warnings[0] ? ` - ${s.warnings[0]}` : ''}`);
    else if (s.in_viewport === false) bad.push(`  ${nameOf(s)}: target is outside the viewport (it will be scrolled into view in a recording)`);
  }
  if (bad.length) { lines.push('Needs attention:'); lines.push(...bad); }
  const warns = Array.isArray(data.warnings) ? data.warnings.map(warnText).filter(Boolean) : [];
  const extra = warns.filter((w) => !bad.some((b) => b.includes(w)));
  if (extra.length) { lines.push(`Warnings (${extra.length}):`); for (const w of extra) lines.push(`  - ${w}`); }
  if (Array.isArray(data.ignored) && data.ignored.length) lines.push(`  Ignored by a rehearsal: ${data.ignored.join(', ')}`);
  for (const s of list) {
    if (images.length >= maxImages) break;
    if (s.screenshot && s.screenshot.data) images.push({ type: 'image', data: s.screenshot.data, mimeType: s.screenshot.content_type || 'image/jpeg' });
  }
  if (images.length) lines.push(`${images.length} screenshot(s) attached, one per step in order (640 px wide jpeg of the moment the effect is on screen).`);
  return { text: lines.join('\n'), images };
}
