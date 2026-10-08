# Recording a localhost app without a public tunnel

Status: proposal, nothing implemented. Author: PageBolt MCP. Scope: `record_video`, `run_sequence`, `take_screenshot`, `inspect_page` against `http://localhost:*` or other private targets.

## Problem

PageBolt renders in its own cloud browsers. Those browsers sit behind an egress guard (`src/services/egressGuard.js`, `src/utils/address.js`) that blocks private, loopback and link-local addresses on every request the page makes, including redirects and subresources, and fails closed. So a developer who wants a demo of the app on their laptop must first expose it (Tailscale Funnel, ngrok, Cloudflare Tunnel), keep the tunnel alive for the whole render, and remember to close it. Agents hit this on the first try; the MCP now warns before sending (`looks local/private`), but the user still has to build the tunnel.

Requirements for any fix: the guard keeps blocking private ranges for everyone else; one tenant can never reach another tenant's machine or the cloud's own network; the existing cloud path (the paying customer, traffic `pagebolt-mcp/*`) is untouched unless the caller opts in.

## Options

### (a) Local mode: run the step engine on the user's machine, use the cloud only for encode and narration

The MCP launches Chromium/Playwright locally (already installed on most dev machines, or fetched on demand), runs the same step engine, captures frames, and either encodes with a local ffmpeg or uploads frames to a cloud encode endpoint. Narration is the only mandatory cloud call: a narrow `POST /api/v1/narration` that returns audio clips and durations (the engine needs durations to pace the video).

- Security: the cloud never connects to the user's network, so there is no new inbound surface, no tenant-isolation question and no egress-guard exception. The local browser can reach anything on the user's machine, which is the point and is the user's own authority. New cloud surface is only "synthesise this text" (rate-limited, metered, same plan gating as `audioGuide` today). Credentials and cookies never leave the machine unless the user records a public site.
- Parity: today the engine is `src/services/video.js` (about 3,200 lines, CommonJS, tied to the pagebolt repo, puppeteer, the browser pool and the plan limits). Local mode needs it extracted into a shared package consumed by both server and MCP, or a second implementation that will drift (cursor, highlights, notes, pacing, frame, background). Local Chromium also differs from the cloud one: it will usually have a GPU and WebGPU, which is a feature for WebGPU demos but means output is not byte-identical to a cloud render.
- Cost: no tunnel infrastructure, no egress bandwidth. Cloud CPU drops (no capture or encode if ffmpeg is local). Metering needs a rule (suggest: narration billed as today, local capture billed as a flat per-video fee or free, decided by product).
- Effort: high up front (extract engine, package it, local ffmpeg detection, narration endpoint, tests), about 3 to 5 weeks. Ongoing: one engine, two hosts.
- Fit with the paying customer: zero change to their path. Opt-in via `local: true` or `PAGEBOLT_MCP_MODE=local`. Risk to production is limited to the extraction refactor, which can ship behind the same test suite before anything calls it.

### (b) Outbound-only connector (`pagebolt connect`) with a scoped, short-lived reverse tunnel per job

A small CLI or MCP-embedded agent on the user's machine opens an outbound WebSocket to PageBolt, authenticated with the API key, and asks for a tunnel for one job. PageBolt returns a one-off hostname (`<random>.t.pagebolt.dev`); the cloud browser for that job, and only that job, may navigate to it; requests are relayed over the socket to a single configured local origin (for example `127.0.0.1:5173`).

- Security: this opens a path from PageBolt's cloud into a customer machine, so every property must hold by construction: the hostname is unguessable and bound to one job and one tenant; the egress guard allows it only inside that job's page (per-page allow-list, not a global exception) and still blocks everything else private; the connector forwards only to the one configured origin and refuses other hosts, ports and `Host` header tricks; the tunnel dies when the job ends or after a hard TTL (for example job duration plus 60 s); relay requests are size and rate limited; the connector shows what is being exposed and requires an explicit local confirmation or a flag. The relay becomes a new internet-facing service on the production host, which is the part that needs a security review, abuse controls (it can proxy arbitrary content under a pagebolt.dev name, so cookie scope and phishing/abuse handling matter) and its own failure budget.
- Parity: full. Same cloud engine, same output, same browser (no WebGPU), nothing to extract.
- Cost: relay bandwidth for page assets plus a long-lived socket per active job. Small per job, but another component to run and monitor.
- Effort: medium to high, about 3 to 4 weeks plus a security review: relay service, token minting, per-page egress allow-list, connector CLI, TTL and abuse limits, tests that prove the guard still blocks the neighbours.
- Fit with the paying customer: they are on the shared prod host. A new ingress service, even isolated, adds risk to the only revenue path; it needs its own container, limits and a kill switch. Their cloud-only flow is unchanged functionally.

### (c) Status quo: the user brings a tunnel

Document it well (done in this PR: descriptions, README, pre-flight warning) and stop there.

- Security: smallest PageBolt surface. The user decides what is public, and a public URL is exposed to the whole internet, not just PageBolt, for the length of the render. Funnel-style tunnels also take minutes to propagate DNS (a documented failure mode).
- Parity: full. Cost: zero. Effort: zero beyond docs.
- Fit: no change for the customer. Cost is paid by every other user in setup time, leaked internal apps and failed first attempts.

## Comparison

| | (a) local mode | (b) connector | (c) tunnel |
|---|---|---|---|
| New cloud attack surface | narration endpoint only | relay + per-job allow-list | none |
| Tenant isolation | not applicable | must be built and proven | not applicable |
| Egress guard parity | not needed locally | guard stays, per-job exception | unchanged |
| Output parity | engine shared, GPU differs | identical | identical |
| User setup | local Chromium (+ ffmpeg) | install connector | build and tear down a tunnel |
| Effort | high, front-loaded | medium-high + review | none |
| Risk to prod / paying customer | low (refactor behind tests) | highest (new ingress) | none |

## Recommendation

Build (a), in phases, and keep (c) documented as the supported fallback until it ships. (a) is the only option that adds no inbound path from the cloud to a customer machine and no exception to the egress guard, so it cannot regress the prod isolation model or the paying customer, and its main cost is a one-time refactor (extracting the step engine into a shared package) that can be tested before anything depends on it. Reconsider (b) only if users need renders to run in the cloud for reasons local mode cannot meet (CI without a browser, identical cloud output), and then only with a dedicated security review.

Phases: 0 documented tunnel and pre-flight warning (this PR); 1 narration-only endpoint and extract the engine into a package with the existing tests; 2 `local: true` in `record_video` / `run_sequence` with local Chromium and a local-ffmpeg encode; 3 optional cloud encode for users without ffmpeg.

## Open questions

- Billing for local captures and for narration-only calls.
- Which platforms and browsers local mode supports at launch (macOS and Linux Chromium; Windows later).
- Whether the cloud encode phase needs frame upload limits that mirror the 5000-frame cap.
