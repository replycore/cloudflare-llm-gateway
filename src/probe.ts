/**
 * Shared key probing. `probeKey` does a per-provider liveness/balance check
 * (chat-based where /models would lie about a suspended/arrears account);
 * `runCheckAll` probes every key and auto-revives the healthy ones / auto-
 * disables the dead ones. Used by the admin "检测全部" button, the per-key
 * "测活", and the scheduled (cron) auto health-check.
 */

import type { ApiKeyRow, Env, Provider } from "./types";
import { PROVIDERS } from "./types";
import { listDueForProbe, markProbed, markAllDueForProbe, getProbeProgress, reactivateKey, applyOutcome, setKeyProjectId, setKeyBalance, setModelStatusBatch, listModelStatus, oneActiveKey, oneActiveKeyRow, firstCustomModel } from "./db";
import { getAdapter } from "./providers";
import { makeCustomAdapter, normalizeBaseUrl } from "./providers/custom";
import { customServiceSlug } from "./providers/types";
import { cooldownMinutes, MAX_CONSECUTIVE_FAILS } from "./keypool";

/** Truncate an upstream error body for a compact status reason. */
function snippet(body: string, max = 200): string {
  const s = (body || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export interface KeyBalance {
  remaining: number | null;
  total: number | null;
  usage: number | null;
  unit: string;
}

export interface ProbeResult {
  alive: boolean;
  status: number;
  rateLimited: boolean;
  balance: KeyBalance | null;
  error?: string;
  /** Google project number parsed from a gemini error body, when present. */
  projectId?: string;
}

/** Free OpenRouter model that works on accounts that never purchased credits.
 * The `:free`-suffixed models do NOT (they 404 with "unavailable for free"
 * unless the account bought credits); this one does — verified live
 * 2026-11-06: 200, cost 0, balance still 0. Used as the liveness probe for
 * 0-balance keys. Deliberately NOT in the adapter's static model list: the
 * model list is fetched live after entering a key, never hardcoded. */
export const OPENROUTER_FREE_PROBE_MODEL = "stealth/crouton-alpha";

/** Live-probe one key. OpenRouter/DeepSeek also return real balance.
 * Custom keys need `opts.baseUrl` (their service's base URL) and, when the
 * service has an added model, `opts.model` for a real inference probe. */
export async function probeKey(provider: Provider, key: string, opts?: { baseUrl?: string; model?: string }): Promise<ProbeResult> {
  try {
    if (provider === "custom") {
      const base = normalizeBaseUrl(opts?.baseUrl ?? "");
      if (!base) return { alive: false, status: 0, rateLimited: false, balance: null, error: "自定义服务缺少 base_url" };
      // With a known added model, prove real inference with a 1-token chat;
      // otherwise the /v1/models list is the liveness check (same as mistral/openai).
      if (opts?.model) {
        const r = await makeCustomAdapter(base).chatCompletions(
          { model: opts.model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 },
          key
        );
        if (r.status === 401 || r.status === 403) return { alive: false, status: r.status, rateLimited: false, balance: null, error: "invalid key" };
        if (r.ok || r.status === 429) return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : "限流" };
        const t = await r.text().catch(() => "");
        return { alive: false, status: r.status, rateLimited: false, balance: null, error: snippet(t) || `http ${r.status}` };
      }
      const r = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } });
      return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : `http ${r.status}` };
    }
    if (provider === "openrouter") {
      const r = await fetch("https://openrouter.ai/api/v1/credits", { headers: { authorization: `Bearer ${key}` } });
      if (r.status === 401 || r.status === 403) return { alive: false, status: r.status, rateLimited: false, balance: null, error: "invalid key" };
      const j = (await r.json().catch(() => null)) as { data?: { total_credits?: number; total_usage?: number } } | null;
      const total = j?.data?.total_credits ?? null;
      const usage = j?.data?.total_usage ?? null;
      const remaining = total !== null && usage !== null ? total - usage : null;
      const balance: KeyBalance = { remaining, total, usage, unit: "credits" };
      if (r.ok && (remaining === null || remaining > 0)) {
        return { alive: true, status: r.status, rateLimited: false, balance };
      }
      if (r.ok && remaining !== null && remaining <= 0) {
        // 0 credits does NOT mean dead: the account may still serve free
        // models. Prove it with a 1-token chat on the free model before
        // calling the key dead — otherwise the sweep disables a usable key
        // and the pool stays empty.
        const free = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model: OPENROUTER_FREE_PROBE_MODEL, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
        });
        if (free.status === 401 || free.status === 403) return { alive: false, status: free.status, rateLimited: false, balance, error: "invalid key" };
        if (free.ok) return { alive: true, status: free.status, rateLimited: false, balance };
        if (free.status === 429) return { alive: false, status: free.status, rateLimited: true, balance, error: "限流" };
        const t = await free.text().catch(() => "");
        return { alive: false, status: free.status, rateLimited: false, balance, error: snippet(t) || "余额不足" };
      }
      return { alive: false, status: r.status, rateLimited: false, balance, error: "余额不足" };
    }
    if (provider === "mistral") {
      const r = await fetch("https://api.mistral.ai/v1/models", { headers: { authorization: `Bearer ${key}` } });
      return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : `http ${r.status}` };
    }
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } });
      return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : `http ${r.status}` };
    }
    if (provider === "deepseek") {
      const r = await fetch("https://api.deepseek.com/user/balance", { headers: { authorization: `Bearer ${key}` } });
      if (r.status === 401 || r.status === 403) return { alive: false, status: r.status, rateLimited: false, balance: null, error: "invalid key" };
      if (!r.ok) return { alive: false, status: r.status, rateLimited: r.status === 429, balance: null, error: `http ${r.status}` };
      const j = (await r.json().catch(() => null)) as { balance_infos?: Array<{ total_balance?: string | number; currency?: string }> } | null;
      const info = j?.balance_infos?.[0] ?? null;
      const remaining = info && info.total_balance != null ? Number(info.total_balance) : null;
      const unit = info?.currency ?? "USD";
      // A key with 0 (or unparseable → NaN) balance is dead: the old code
      // returned alive:true whenever the balance endpoint answered.
      const alive = remaining === null ? true : Number.isFinite(remaining) && remaining > 0;
      return { alive, status: r.status, rateLimited: false, balance: { remaining: Number.isFinite(remaining) ? remaining : null, total: null, usage: null, unit }, error: alive ? undefined : "余额不足" };
    }
    if (provider === "groq") {
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${key}` } });
      return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : `http ${r.status}` };
    }
    if (provider === "moonshot") {
      const r = await fetch("https://api.moonshot.cn/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: getAdapter(provider).models()[0] ?? "moonshot-v1-8k", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
      if (r.status === 401 || r.status === 403) return { alive: false, status: r.status, rateLimited: false, balance: null, error: "invalid key" };
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        const arrears = /insufficient|balance|余额|exceeded_current_quota/i.test(t);
        return { alive: false, status: r.status, rateLimited: r.status === 429 && !arrears, balance: null, error: arrears ? "欠费/余额不足" : `http ${r.status}` };
      }
      return { alive: true, status: r.status, rateLimited: false, balance: null };
    }
    if (provider === "qwen") {
      const r = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: getAdapter(provider).models()[0] ?? "qwen-turbo", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
      if (r.status === 401 || r.status === 403) return { alive: false, status: r.status, rateLimited: false, balance: null, error: "invalid key" };
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        const arrears = /arrearage|overdue|欠费|insufficient/i.test(t);
        return { alive: false, status: r.status, rateLimited: r.status === 429, balance: null, error: arrears ? "欠费/余额不足" : `http ${r.status}` };
      }
      return { alive: true, status: r.status, rateLimited: false, balance: null };
    }
    if (provider === "glm") {
      const r = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: getAdapter(provider).models()[0] ?? "glm-4-flash", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
      if (r.status === 401 || r.status === 403) return { alive: false, status: r.status, rateLimited: false, balance: null, error: "invalid key" };
      return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : `http ${r.status}` };
    }
    if (provider === "deepinfra") {
      // GET /models returns 200 even for an account with no payment method, so it
      // lies about usability. Probe real inference: 402 = 欠费/需付款, 401/403 =
      // dead key. DeepInfra exposes no balance API (only the web console does), so
      // balance stays null — we can only surface the usable/unusable verdict.
      const r = await fetch("https://api.deepinfra.com/v1/openai/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: getAdapter(provider).models()[0] ?? "meta-llama/Meta-Llama-3.1-8B-Instruct", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
      if (r.status === 401 || r.status === 403) return { alive: false, status: r.status, rateLimited: false, balance: null, error: "invalid key" };
      if (r.status === 402) return { alive: false, status: r.status, rateLimited: false, balance: null, error: "欠费/需付款" };
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        const arrears = /payment|insufficient|balance|欠费|prohibited/i.test(t);
        return { alive: false, status: r.status, rateLimited: r.status === 429 && !arrears, balance: null, error: arrears ? "欠费/需付款" : `http ${r.status}` };
      }
      return { alive: true, status: r.status, rateLimited: false, balance: null };
    }
    if (provider === "fireworks") {
      const r = await fetch("https://api.fireworks.ai/inference/v1/models", { headers: { authorization: `Bearer ${key}` } });
      return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : `http ${r.status}` };
    }
    if (provider === "cerebras") {
      const r = await fetch("https://api.cerebras.ai/v1/models", { headers: { authorization: `Bearer ${key}` } });
      return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : `http ${r.status}` };
    }
    if (provider === "cohere") {
      const r = await fetch("https://api.cohere.com/v1/models", { headers: { authorization: `Bearer ${key}` } });
      return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : `http ${r.status}` };
    }
    if (provider === "ai21") {
      const r = await fetch("https://api.ai21.com/studio/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: getAdapter(provider).models()[0] ?? "jamba-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
      if (r.status === 401 || r.status === 403) return { alive: false, status: r.status, rateLimited: false, balance: null, error: "invalid key" };
      // 400/422 = auth ok, body quibble; still a live key.
      const alive = r.ok || r.status === 400 || r.status === 422 || r.status === 429;
      return { alive, status: r.status, rateLimited: r.status === 429, balance: null, error: alive ? undefined : `http ${r.status}` };
    }
    if (provider === "elevenlabs") {
      const r = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": key } });
      return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : `http ${r.status}` };
    }
    if (provider === "stability") {
      const r = await fetch("https://api.stability.ai/v1/user/account", { headers: { authorization: `Bearer ${key}` } });
      return { alive: r.ok, status: r.status, rateLimited: r.status === 429, balance: null, error: r.ok ? undefined : `http ${r.status}` };
    }
    // gemini — /v1beta/models is NOT rate-limited and lies about usability, so
    // probe the actual generateContent path with a 1-token request.
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      }
    );
    const rateLimited = r.status === 429; // valid key, just throttled (per-minute/day)
    const alive = r.ok || rateLimited;
    let projectId: string | undefined;
    if (!r.ok) {
      // Read the body once: parse the Google project number out of the error.
      const body = await r.text().catch(() => "");
      const m = /project_number:(\d+)/.exec(body);
      if (m) projectId = m[1];
    }
    if (r.status === 401 || r.status === 403) return { alive: false, status: r.status, rateLimited: false, balance: null, error: "invalid key", projectId };
    return { alive, status: r.status, rateLimited, balance: null, error: r.ok ? undefined : rateLimited ? "限流" : `http ${r.status}`, projectId };
  } catch (err) {
    return { alive: false, status: 0, rateLimited: false, balance: null, error: String(err instanceof Error ? err.message : err) };
  }
}

/** Default minutes before a probed key becomes "due" for another probe. */
const DEFAULT_PROBE_INTERVAL_MINUTES = 60;

function probeIntervalMs(env: Env): number {
  const raw = env.PROBE_INTERVAL_MINUTES;
  const m = raw != null ? Number.parseInt(raw, 10) : NaN;
  return (Number.isFinite(m) && m > 0 ? m : DEFAULT_PROBE_INTERVAL_MINUTES) * 60000;
}

export interface SweepResult {
  checked: number;
  alive: number;
  dead: number;
  /** total keys in the pool */
  total: number;
  /** keys still due for a probe after this batch (0 = pool fully swept) */
  due: number;
  /** true while keys remain due (more batches needed to cover the pool) */
  capped: boolean;
}

/**
 * One rotating sweep batch — the scale-safe primitive that both the
 * 检测全部 button (polled) and the external pinger / cron tick call.
 *
 * A single Worker invocation can't probe an unbounded pool (free tier caps
 * outbound subrequests at ~50), so each call probes at most `limit` keys that
 * are *due* (never probed, or probed > PROBE_INTERVAL ago), least-recently-
 * probed first, spread across providers. It advances `last_probed_at` for the
 * whole batch so successive calls roll through the rest. With `markAll`, every
 * key is first marked due (the button) so the next batches re-validate the
 * entire pool; without it, only genuinely-stale keys are touched (cheap
 * background rotation — active keys are validated for free by real traffic).
 */
/** Probe options for a key row: custom keys need their base URL and, when
 * the service has an added model, that model for a real inference probe.
 * Built-ins need nothing. */
export async function probeOptsForKey(
  env: Env,
  key: { provider: Provider; base_url: string | null; service_slug: string | null }
): Promise<{ baseUrl?: string; model?: string }> {
  if (key.provider !== "custom") return {};
  const opts: { baseUrl?: string; model?: string } = {};
  if (key.base_url) opts.baseUrl = key.base_url;
  if (key.service_slug) {
    const m = await firstCustomModel(env, key.service_slug);
    if (m) opts.model = m;
  }
  return opts;
}

export async function runSweep(
  env: Env,
  opts: { markAll?: boolean; limit?: number } = {}
): Promise<SweepResult> {
  const limit = opts.limit ?? 24;
  if (opts.markAll) await markAllDueForProbe(env);
  const now = Date.now();
  const intervalMs = probeIntervalMs(env);
  const subset = await listDueForProbe(env, { limit, intervalMs, now });
  const results = await Promise.all(
    subset.map(async (k) => {
      try {
        const r = await probeKey(k.provider, k.api_key, await probeOptsForKey(env, k));
        if (r.projectId) await setKeyProjectId(env, k.id, r.projectId);
        if (r.balance && r.balance.remaining != null) {
          await setKeyBalance(env, k.id, r.balance.remaining, r.balance.unit);
        }
        if (r.alive && !r.rateLimited) {
          // Healthy: ensure active AND clear any stale last_error (e.g. a glm key
          // that errored on a paid model but works for the free one).
          await reactivateKey(env, k.id);
        } else if (r.rateLimited) {
          // Valid key but can't serve right now — cool it down so it shows as
          // 'cooldown' (not a misleading green 'active') and is skipped until it
          // recovers; inline revive brings it back when cooldown_until passes.
          await applyOutcome(
            env,
            k.id,
            { kind: "cooldown", minutes: cooldownMinutes(env), reason: r.error || "rate limited" },
            { cooldownMinutes: cooldownMinutes(env), maxConsecutive: MAX_CONSECUTIVE_FAILS }
          );
        } else if (!r.alive && !r.rateLimited) {
          await applyOutcome(
            env,
            k.id,
            { kind: "disable", reason: r.error || `http ${r.status}` },
            { cooldownMinutes: cooldownMinutes(env), maxConsecutive: MAX_CONSECUTIVE_FAILS }
          );
        }
        return r.alive && !r.rateLimited;
      } catch {
        return false;
      }
    })
  );
  // Advance the cursor for the whole batch (alive or dead) so the next sweep
  // rotates to the next slice instead of re-probing these.
  await markProbed(env, subset.map((k) => k.id), now);
  const alive = results.filter(Boolean).length;
  const { total, due } = await getProbeProgress(env, intervalMs, now);
  return { checked: results.length, alive, dead: results.length - alive, total, due, capped: due > 0 };
}

/** Back-compat alias: one rotating batch. Used by the cron tick and the
 *  /admin/check-all-keys endpoint (external pingers / health-check workflow). */
export function runCheckAll(env: Env): Promise<SweepResult> {
  return runSweep(env, {});
}

/** Cheap read for the UI progress bar / pinger: { total, due }. */
export function sweepProgress(env: Env): Promise<{ total: number; due: number }> {
  return getProbeProgress(env, probeIntervalMs(env), Date.now());
}

/**
 * Probe model-level availability for the models the user added via the key
 * list (`model_status` rows) — the ones /v1/models actually serves.
 * Available rows first (confirm they're still alive), blocked rows after
 * (a revived model comes back). Capped at 24 upstream calls.
 * Deliberately NOT the static per-provider catalog: the catalog ids are
 * hardcoded, and probing them recreated the same three blocked rows
 * (deepseek/llama/auto on a 0-balance OpenRouter account) in the
 * availability UI every run. Only user-added models are probed.
 * A 1-token chat: 2xx or 429 means the model itself works (just throttled);
 * any other non-2xx marks it unavailable with a reason snippet (e.g. glm
 * '余额不足/无资源包', or a 404/400 model-not-found). Each call is isolated
 * in try/catch so one failure never aborts the sweep. Cheap enough to run
 * from the health check.
 */
export async function probeModels(env: Env): Promise<{ checked: number; blocked: number }> {
  const MAX_CALLS = 24;
  let checked = 0;
  let blocked = 0;
  const probed = new Set<string>();
  const keyCache = new Map<string, string | null>();
  const keyFor = async (provider: Provider): Promise<string | null> => {
    if (!keyCache.has(provider)) keyCache.set(provider, await oneActiveKey(env, provider));
    return keyCache.get(provider) ?? null;
  };
  // One key row per custom service (slug): every model of a service shares
  // its key, so looking it up per model is N redundant D1 reads.
  const keyRowCache = new Map<string, ApiKeyRow | null>();
  // Status writes are collected and landed in one D1 batch at the end: one
  // setModelStatus per model was a sequential D1 round-trip per probe.
  const pending: { model: string; provider: string; available: boolean; reason: string | null }[] = [];
  const probeOne = async (provider: Provider, model: string): Promise<void> => {
    const k = provider + "\0" + model;
    if (probed.has(k)) return;
    probed.add(k);
    if (checked >= MAX_CALLS) return;
    // Custom models are `custom:<slug>:<model>` — the probe must use a key
    // of THAT service (keys of other custom services point elsewhere).
    let key: string | null;
    let adapter = getAdapter(provider);
    if (provider === "custom") {
      const slug = customServiceSlug(model);
      if (!slug) return;
      if (!keyRowCache.has(slug)) keyRowCache.set(slug, await oneActiveKeyRow(env, provider, slug));
      const row = keyRowCache.get(slug);
      if (!row) return;
      key = row.api_key;
      adapter = makeCustomAdapter(row.base_url ?? "");
    } else {
      key = await keyFor(provider);
      if (!key) return;
    }
    checked++;
    try {
      const r = await adapter.chatCompletions(
        { model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 },
        key
      );
      if (r.ok || r.status === 429) {
        pending.push({ model, provider, available: true, reason: null });
      } else {
        const body = await r.text().catch(() => "");
        pending.push({ model, provider, available: false, reason: snippet(body) || `http ${r.status}` });
        blocked++;
      }
    } catch (err) {
      pending.push({ model, provider, available: false, reason: snippet(String(err instanceof Error ? err.message : err)) });
      blocked++;
    }
  };

  // Only user-added models — never the static catalog: probing it
  // recreated hardcoded rows in the availability UI. Rotate by
  // least-recently-checked first (never-checked sorts first): the old
  // available-first sort re-probed the same leading 24 models every run
  // and never reached the rest of the pool.
  const rows = await listModelStatus(env);
  rows.sort(
    (a, b) =>
      (a.last_checked ?? 0) - (b.last_checked ?? 0) ||
      b.available - a.available ||
      (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0) ||
      (a.model < b.model ? -1 : a.model > b.model ? 1 : 0)
  );
  for (const row of rows) {
    if (checked >= MAX_CALLS) break;
    if (!(PROVIDERS as string[]).includes(row.provider)) continue;
    // One bad key lookup must not abort the whole sweep (the chat call
    // below is already isolated; the lookup above it was not).
    try {
      await probeOne(row.provider as Provider, row.model);
    } catch {
      // Skip this model and keep sweeping.
    }
  }
  if (pending.length) await setModelStatusBatch(env, pending);

  return { checked, blocked };
}
