// Caller's plan, looked up once per process from GET /api/v1/usage (free, no
// quota). Used only to sharpen client-side warnings: any failure returns null
// and validation falls back to plan-independent checks.

import { normalizePlan } from './limits.mjs';

const TTL_MS = 10 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000; // don't retry a failing lookup on every call
let cache = null; // { plan, at }

export function resetPlanCache() { cache = null; }

export async function lookupPlan({ baseUrl, apiKey, fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = 4000 }) {
  if (process.env.PAGEBOLT_MCP_NO_PLAN_LOOKUP === '1') return null;
  if (cache && now - cache.at < (cache.plan ? TTL_MS : FAIL_TTL_MS)) return cache.plan;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/api/v1/usage`, { headers: { 'x-api-key': apiKey, 'user-agent': 'pagebolt-mcp' }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res || !res.ok) { cache = { plan: null, at: now }; return null; }
    const data = await res.json();
    const plan = normalizePlan(data && data.plan);
    cache = { plan, at: now };
    return plan;
  } catch {
    cache = { plan: null, at: now };
    return null;
  }
}
