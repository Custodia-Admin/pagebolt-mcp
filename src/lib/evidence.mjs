// Render per-step evidence from a PageBolt video/sequence response so an agent
// can tell whether a render actually did what it asked.
//
// Everything is optional and shape-tolerant. Fields understood (any subset):
//   step_results[]  { step_index, action, status: ok|skipped|error|timeout, error,
//                     duration_ms,                      // exists today
//                     start_s, end_s, changed, change_pct, thumbnail_url }  // newer backends
//   warnings[]      string | { code?, message, step_index? }
//   auth_warnings[] same shapes (exists today, previously not shown)
//   stopped_early   boolean;  stopped_at_step; reason | stopped_reason
//   effective_timeout_ms | effective_max_duration_ms
// With none of the newer fields present the output is only the steps that
// failed/timed out (from step_results) - or nothing.

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
    if (held != null) label += ` ${sec(held)}${req && req.live ? ' live' : ''}`;
  } else if (req && req.selector) {
    label += ` ${req.selector}`;
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

  // stopped early / budget
  const reason = data.reason || data.stopped_reason;
  if (data.stopped_early || data.stopped_at_step != null) {
    let l = `STOPPED EARLY${data.stopped_at_step != null ? ` at step ${data.stopped_at_step}` : ''}`;
    if (reason) l += `: ${reason}`;
    else l += ': later steps were not recorded';
    lines.push(l);
  }
  const eff = data.effective_timeout_ms ?? data.effective_max_duration_ms;
  if (eff != null && (data.stopped_early || data.stopped_at_step != null)) {
    lines.push(`  effective render budget: ${sec(eff / 1000)}`);
  }

  // problems: failed, timed out, skipped, or (when known) no visual change
  const problem = [];
  for (const r of results) {
    if (!failures && (r.status === 'error' || r.status === 'timeout' || r.status === 'skipped')) continue;
    const where = timed.includes(r) ? ` @${sec(r.start_s)}-${sec(r.end_s)}` : '';
    if (r.status === 'error' || r.status === 'timeout') {
      problem.push(`  ${stepName(r, steps)}${where}: ${r.status === 'timeout' ? 'NOT RUN (budget)' : 'FAILED'}${r.error ? ` - ${r.error}` : ''}`);
    } else if (r.status === 'skipped') {
      problem.push(`  ${stepName(r, steps)}${where}: skipped (optional target not found)`);
    } else if (r.changed === false) {
      const pct = r.change_pct != null ? ` (${r.change_pct}%)` : '';
      problem.push(`  ${stepName(r, steps)}${where}: no visual change${pct}${r.thumbnail_url ? ` - ${r.thumbnail_url}` : ''}`);
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

  const warns = [...(data.warnings || []), ...(data.auth_warnings || [])].map(warnText).filter(Boolean);
  if (warns.length) {
    lines.push(`Server warnings (${warns.length}):`);
    for (const w of warns) lines.push(`  - ${w}`);
  }
  return lines.join('\n');
}

/** One-line completeness verdict from step counts. */
export function completenessNote(data) {
  if (!data || data.steps_completed == null || data.total_steps == null) return '';
  if (data.steps_completed >= data.total_steps) return '';
  return `INCOMPLETE: ${data.steps_completed}/${data.total_steps} steps ran. The video exists but is missing steps; check the list above (or the 200 s / plan budget) and re-record the missing segment.`;
}
