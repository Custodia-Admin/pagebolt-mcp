# Changelog

All notable changes to the PageBolt MCP server are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- **Async video rendering in `record_video`** — long recordings are now enqueued
  as async jobs (`async: true`, `202 { job_id, ... }`) and polled to completion
  by default, so they don't hit MCP client / API request timeouts. The finished
  video is delivered as a hosted URL and downloaded + embedded when possible.
  New optional params: `async` (default `true`; set `false` to force a single
  blocking synchronous request) and `pollTimeoutMs` (default 240000). Falls back
  to synchronous rendering automatically if async is unavailable. Quota is
  charged only on success.
- **`list_jobs` tool** — `GET /api/v1/jobs`. List recent async jobs. Free.
- **`get_job` tool** — `GET /api/v1/jobs/:id`. Fetch a single async job's status
  and output (for videos: the hosted watch/embed/file URLs). Free.

### Notes

- All changes are additive and backward compatible: existing tool signatures are
  unchanged and only optional parameters and new tools were added.
