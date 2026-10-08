# Changelog

All notable changes to the PageBolt MCP server are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.18.0]

### Added

- **Client-side pre-flight for `record_video`, `run_sequence` and `export_sequence`.** Errors stop the call before it is billed (more than 2 `evaluate` steps, `gif` with `audioGuide`, missing or more than 5 sequence outputs). Warnings are appended to the result and the request is still sent: a `wait` right after `click` / `navigate` / `evaluate` without `live: true`, step count or format above your plan, estimated length above ~200 s / your plan budget / the 5000-frame cap (naming the step where the render would stop), `wait` x `pace` over 10 s, WebGPU in an `evaluate`, `narration` without `audioGuide.enabled`, localhost or private navigate URLs. The plan is read once from `GET /api/v1/usage` and cached; if that fails, plan checks are skipped.
- **Per-step evidence in results.** When the backend returns them, `record_video` shows failed / skipped / budget-cut steps, `start_s` / `end_s`, `changed` (`no visual change`), `thumbnail_url`, `warnings[]`, `auth_warnings[]`, `stopped_early` / `stopped_at_step` / `reason` and `effective_timeout_ms`, plus an `INCOMPLETE: n/m` line. Output is unchanged when none are present, apart from the expected output size and a reminder that `Steps: N/N` does not prove anything moved.
- **Authoring parameters** (separate commit; need `feat/video-authoring` on the backend): `coordinates` on `click` / `dblclick` / `hover`, `rect` on `highlight`, `card` step, `output {width, height, fit}`, `audio {sampleRate, channels}` and `rehearse` (dry run with per-step evidence, no video). `export_sequence` accepts them.
- Design doc for recording localhost apps without a public tunnel: `docs/design/local-target-connector.md`.
- `PAGEBOLT_MCP_SAVE_ROOT` and `PAGEBOLT_MCP_NO_PLAN_LOOKUP` environment variables.

### Changed

- **`saveTo` no longer fails silently.** Missing parent folders are created recursively; the path is validated before the render is requested; the result reports the absolute path and the byte size read back from disk; an unwritable path returns an error instead of "saved"; a hosted (private) async video that cannot be downloaded says `NOT SAVED`. `saveTo` is still confined to the working directory (symlink escapes are now refused too) unless `PAGEBOLT_MCP_SAVE_ROOT` allows more. Also applies to `generate_pdf`.
- **Tool descriptions** for `record_video`, `run_sequence`, `inspect_page`, `take_screenshot` and `export_sequence` now state: `wait` freezes one frame unless `live: true`; the 2-`evaluate` cap and that evaluate time is not recorded; plan step limits and the duration budget; output dimensions with `frame` / `background`; narration audio (mono 24 kHz, AAC / Opus); PageBolt browsers have no WebGPU (WebGL is software); the target must be public; how to verify a render.
- The `user-agent` and server `version` now report the real package version (they were stuck at 1.16.x).

## [1.17.0]

### Added

- **`export_sequence` tool** — build a sequence as importable JSON (steps, pace, `audioGuide`) without running it. Paste it into the dashboard's Sequence builder via *Import JSON*, then edit and re-run. Pass `save: true` to also store it in Saved Automations (shown in the dashboard and the Chrome extension Library).
- **Authenticated recordings** — `cookies` and `authState` on `record_video`, `run_sequence` and related tools; values are sent to PageBolt only and never returned.
- **`highlight` step** (soft indigo outline by default, optional note) and **`pauseAfter`** on steps.
- **`optional: true`** on steps — skipped quickly when the selector isn't on the page (cookie banners, popups).
- **`audioGuide.pacing`** — `overlap` (default) or `sequential` narration timing.

## [1.16.1]

### Improved

- **Clearer API error messages** — tool failures now surface PageBolt's structured
  `error`, `code`, and `hint` fields (e.g. `target_connection_timeout`,
  `request_timeout`) instead of opaque HTTP status text. Agents can tell when the
  *target site* timed out vs a PageBolt issue. Client request timeout message
  also notes that the external site may be slow.

## [1.16.0]

### Added

- **`observe_page` `format` parameter** — pass `format: "flatdomtree"` to get the
  browser-use / Alibaba page-agent representation: `dom_text` (an indexed
  plain-text DOM, e.g. `[1]<button>Sign in</button>`) plus a `selectors` map
  (`{"1":"#signin"}`) instead of the JSON `elements` array. Both are surfaced in
  the tool result and remain wrapped as untrusted page content. Defaults to
  `"json"` (unchanged behavior).
- **`import_agent_trace` tool** — wraps `POST /api/v1/sequences/import`. Convert a
  page-agent/browser-use action trace into a re-runnable PageBolt sequence.
  Accepts `trace` (required; supports both `{action, index|selector, ...}` and
  `{action_name: {...}}` shapes), `selectors` (optional index→CSS map, e.g. from
  `observe_page` `format:"flatdomtree"`), `name`, `type` (`sequence`|`video`),
  and `save` (`false` = dry run that returns the translated steps without
  persisting). Does not consume request quota.
- **Async video rendering in `record_video`** — long recordings can be enqueued
  as async jobs (`async: true`, `202 { job_id, ... }`) and polled to completion,
  so they don't hit MCP client / API request timeouts. The async result is a
  private hosted video URL (its bytes can't be pulled back via the API key).
  New optional params: `async` and `pollTimeoutMs` (default 240000). `async`
  defaults to `true`, **except when `saveTo` is provided**, in which case the
  synchronous path is used so the video file is actually produced/embedded/saved
  (preserving prior behavior). Set `async: false` explicitly to always get the
  inline video. Falls back to synchronous rendering automatically if async is
  unavailable. Quota is charged only on success.
- **`list_jobs` tool** — `GET /api/v1/jobs`. List recent async jobs. Free.
- **`get_job` tool** — `GET /api/v1/jobs/:id`. Fetch a single async job's status
  and output (for videos: the hosted watch/embed/file URLs). Free.

### Notes

- All changes are additive and backward compatible: existing tool signatures are
  unchanged and only optional parameters and new tools were added.
