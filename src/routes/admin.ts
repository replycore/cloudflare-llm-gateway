/** Admin routes: key import + management + token minting. Mounted at /admin. */

import { Hono } from "hono";
import type { Env, Provider } from "../types";
import { PROVIDERS } from "../types";
import { requireAdmin } from "../auth";
import {
  importKeys,
  statsSummary,
  reactivateKey,
  applyOutcome,
  createToken,
  listTokens,
  listUsers,
  setUserStatus,
  disableTokensByOwner,
  listAllKeys,
  getKeyById,
  setKeyBalance,
  deleteKey,
  deleteToken,
  prunePermanentlyDeadKeys,
  usageSummary,
  usageByUser,
  recentLogs,
  listBalances,
  topUpMicro,
  listTransactions,
  billingEnabled,
  billingDiscount,
  listModelStatus,
  listAvailableModels,
  setModelStatusBatch,
  normalizeModelKey,
  addCustomKey,
  customServiceBaseUrl,
  updateKey,
  firstCustomModel,
  listAliases,
  upsertAlias,
  deleteAlias,
  setAliasEnabled,
} from "../db";
import { cooldownMinutes, MAX_CONSECUTIVE_FAILS } from "../keypool";
import { runHealthCheck } from "../cron";
import { probeKey, runCheckAll, runSweep, sweepProgress, probeModels, probeOptsForKey } from "../probe";
import { getAdapter } from "../providers";
import { makeCustomAdapter, normalizeBaseUrl, isValidServiceSlug } from "../providers/custom";
import { customServiceSlug, customPlainModel, customModelId } from "../providers/types";
import type { OpenAIChatRequest } from "../providers/types";

const app = new Hono<{ Bindings: Env }>();

app.use("*", requireAdmin);

function isProvider(value: string): value is Provider {
  return (PROVIDERS as string[]).includes(value);
}

/**
 * Parse `provider:key` lines. Provider is the text before the FIRST colon;
 * the rest (which may itself contain colons) is the key. Unknown providers and
 * malformed lines are collected as `skipped`.
 */
function parseKeyLines(text: string): {
  entries: Array<{ provider: Provider; api_key: string }>;
  skipped: string[];
} {
  const entries: Array<{ provider: Provider; api_key: string }> = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) {
      skipped.push(line);
      continue;
    }
    const provider = line.slice(0, idx).trim().toLowerCase();
    const api_key = line.slice(idx + 1).trim();
    // Custom services carry a base URL that `provider:key` lines can't
    // express — they go through POST /keys/custom instead.
    if (provider === "custom") {
      skipped.push(line);
      continue;
    }
    if (api_key.length === 0 || !isProvider(provider)) {
      skipped.push(line);
      continue;
    }
    entries.push({ provider, api_key });
  }
  return { entries, skipped };
}

// GET /providers — provider names (admin UI dropdown).
app.get("/providers", (c) => c.json({ providers: PROVIDERS }));

// GET /providers/:provider/models — static model list for a provider.
app.get("/providers/:provider/models", (c) => {
  const raw = c.req.param("provider") || "";
  const provider = raw.trim().toLowerCase();
  if (!isProvider(provider)) {
    return c.json({ error: { message: "unknown provider", type: "invalid_request_error" } }, 400);
  }
  try {
    return c.json({ provider, models: getAdapter(provider as Provider).models() });
  } catch {
    return c.json({ error: { message: "provider not registered", type: "invalid_request_error" } }, 400);
  }
});

/** Shared live-model fetch: ask the provider's /models endpoint with a key
 * and return the model ids (deduped; gemini "models/" prefix stripped).
 * Used by POST /providers/:provider/live-models (key pasted by the admin)
 * and POST /admin/keys/:id/live-models (key already stored). */
type LiveModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; status: number; message: string; type: string; upstreamStatus?: number };

async function liveModelsFor(provider: Provider, apiKey: string, baseUrl?: string): Promise<LiveModelsResult> {
  // provider -> { url, header }（Bearer 或 query 参数）
  const LIVE: Record<string, { url: string; auth: "bearer" | "query"; extraHeaders?: Record<string, string> }> = {
    openai:     { url: "https://api.openai.com/v1/models", auth: "bearer" },
    groq:       { url: "https://api.groq.com/openai/v1/models", auth: "bearer" },
    mistral:    { url: "https://api.mistral.ai/v1/models", auth: "bearer" },
    deepseek:   { url: "https://api.deepseek.com/v1/models", auth: "bearer" },
    openrouter: { url: "https://openrouter.ai/api/v1/models", auth: "bearer", extraHeaders: { "HTTP-Referer": "https://keypool.local", "X-Title": "keypool-gateway" } },
    deepinfra:  { url: "https://api.deepinfra.com/v1/openai/models", auth: "bearer" },
    fireworks:  { url: "https://api.fireworks.ai/inference/v1/models", auth: "bearer" },
    cerebras:   { url: "https://api.cerebras.ai/v1/models", auth: "bearer" },
    ai21:       { url: "https://api.ai21.com/studio/v1/models", auth: "bearer" },
    cohere:     { url: "https://api.cohere.ai/compatibility/v1/models", auth: "bearer" },
    glm:        { url: "https://open.bigmodel.cn/api/paas/v4/models", auth: "bearer" },
    qwen:       { url: "https://dashscope.aliyuncs.com/compatible-mode/v1/models", auth: "bearer" },
    moonshot:   { url: "https://api.moonshot.cn/v1/models", auth: "bearer" },
    gemini:     { url: "https://generativelanguage.googleapis.com/v1beta/models", auth: "query" },
    elevenlabs: { url: "", auth: "bearer" },
    stability:  { url: "", auth: "bearer" },
  };
  // Custom services have no fixed URL: the key's stored base URL is the endpoint.
  let cfg: { url: string; auth: "bearer" | "query"; extraHeaders?: Record<string, string> } | undefined;
  if (provider === "custom") {
    const base = normalizeBaseUrl(baseUrl ?? "");
    if (!base) {
      return { ok: false, status: 400, message: "custom service needs a base_url", type: "invalid_request_error" };
    }
    cfg = { url: `${base}/v1/models`, auth: "bearer" };
  } else {
    cfg = LIVE[provider];
  }
  if (!cfg || !cfg.url) {
    return { ok: false, status: 400, message: `provider "${provider}" does not expose a /models live endpoint; showing the built-in list instead`, type: "invalid_request_error" };
  }
  const headers: Record<string, string> = { ...(cfg.extraHeaders || {}) };
  let url = cfg.url;
  if (cfg.auth === "bearer") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    url += `?key=${encodeURIComponent(apiKey)}`;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers, redirect: "follow" });
  } catch (e) {
    return { ok: false, status: 502, message: `upstream fetch failed: ${e instanceof Error ? e.message : String(e)}`, type: "upstream_error" };
  }
  if (!upstream.ok) {
    const txt = (await upstream.text()).slice(0, 400);
    return { ok: false, status: 502, message: `upstream returned ${upstream.status}: ${txt}`, type: "upstream_error", upstreamStatus: upstream.status };
  }
  let json: any;
  try {
    json = await upstream.json();
  } catch {
    return { ok: false, status: 502, message: "upstream did not return JSON", type: "upstream_error" };
  }

  // 兼容两种返回形状并提取 id
  const extract = (o: any): string | null => {
    if (typeof o === "string") return o;
    if (o && typeof o === "object") {
      const id = o.id ?? o.name ?? o.model ?? o.model_id;
      if (typeof id === "string" && id) return id;
    }
    return null;
  };
  let rawList: unknown[] = [];
  if (Array.isArray(json)) rawList = json;
  else if (Array.isArray(json?.data)) rawList = json.data;
  else if (Array.isArray(json?.models)) rawList = json.models;
  // google returns {"name":"models/gemini-2.0-flash"} — strip the prefix
  // BEFORE deduping, so a list containing both "models/x" and "x" doesn't
  // return x twice.
  const models = Array.from(
    new Set(
      rawList
        .map(extract)
        .filter((x): x is string => !!x)
        .map((m) => (provider === "gemini" && m.startsWith("models/") ? m.slice("models/".length) : m))
    )
  );
  return { ok: true, models };
}

// POST /providers/:provider/live-models — 用用户输入的 Key 实时去上游拉
// 该 Provider 当前可用的模型列表（OpenAI 兼容 /models 风格）。
// Body: { key: string }
app.post("/providers/:provider/live-models", async (c) => {
  const raw = c.req.param("provider") || "";
  const provider = raw.trim().toLowerCase();
  if (!isProvider(provider)) {
    return c.json({ error: { message: "unknown provider", type: "invalid_request_error" } }, 400);
  }
  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "invalid json body", type: "invalid_request_error" } }, 400);
  }
  const key = (body as { key?: unknown } | null)?.key;
  if (typeof key !== "string" || !key.trim()) {
    return c.json({ error: { message: "expected { key: string }", type: "invalid_request_error" } }, 400);
  }
  // Custom services need the base URL too (no fixed upstream to call).
  const baseUrl = (body as { base_url?: unknown } | null)?.base_url;
  const res = await liveModelsFor(provider as Provider, key.trim(), typeof baseUrl === "string" ? baseUrl : undefined);
  if (!res.ok) {
    return c.json(
      {
        error: {
          message: res.message,
          type: res.type,
          ...(res.upstreamStatus !== undefined ? { status: res.upstreamStatus } : {}),
        },
      },
      res.status as 400 | 502
    );
  }
  return c.json({ provider, models: res.models, source: "live" });
});

// POST /keys/:id/live-models — 用该 key 已存的凭证实时去上游拉模型列表
// （key 列表里每行的「新增模型」按钮；不用再贴一次 key）。
// 响应：{ provider, models, known, source: "live" }，known 是其中已经
// 可服务的模型（内置列表或已入库可用），其余即新模型。
app.post("/keys/:id/live-models", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json(
      { error: { message: "invalid key id", type: "invalid_request_error" } },
      400
    );
  }
  const key = await getKeyById(c.env, id);
  if (!key) {
    return c.json({ error: { message: "key not found", type: "not_found" } }, 404);
  }
  const res = await liveModelsFor(key.provider, key.api_key, key.base_url ?? undefined);
  if (!res.ok) {
    return c.json(
      {
        error: {
          message: res.message,
          type: res.type,
          ...(res.upstreamStatus !== undefined ? { status: res.upstreamStatus } : {}),
        },
      },
      res.status as 400 | 502
    );
  }
  const known = new Set<string>(getAdapter(key.provider).models());
  for (const row of await listAvailableModels(c.env)) {
    if (row.provider !== key.provider) continue;
    // Custom rows store the full `custom:<slug>:<model>` id, but the live
    // list returns plain ids — compare plain ids so already-added models
    // show as known instead of as new.
    if (key.provider === "custom") {
      const plain = customPlainModel(row.model);
      if (plain) known.add(plain);
    } else {
      known.add(row.model);
    }
  }
  return c.json({
    provider: key.provider,
    models: res.models,
    known: res.models.filter((m) => known.has(m)),
    source: "live",
  });
});

// POST /keys/:id/models — 把从实时列表里挑出的模型记为可用（available=1），
// 使其进入 /v1/models（servableModels 会并入 model_status 里 available=1 的行）。
// Body: { models: string[] }
app.post("/keys/:id/models", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json(
      { error: { message: "invalid key id", type: "invalid_request_error" } },
      400
    );
  }
  const key = await getKeyById(c.env, id);
  if (!key) {
    return c.json({ error: { message: "key not found", type: "not_found" } }, 404);
  }
  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "invalid json body", type: "invalid_request_error" } }, 400);
  }
  const raw = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(raw)) {
    return c.json({ error: { message: "expected { models: string[] }", type: "invalid_request_error" } }, 400);
  }
  const models = Array.from(
    new Set(
      raw
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim())
        // Model ids are single tokens: drop anything with whitespace (a
        // pasted phrase is never a valid id) and absurdly long ids. This
        // also guards the custom-model input in the console, which posts
        // ids the upstream list never returned.
        .filter((m) => Boolean(m) && !/\s/.test(m) && m.length <= 200)
    )
  ).slice(0, 200);
  // Custom keys store models as `custom:<slug>:<model>`: the slug is what
  // routes a request to the right service, and two services can serve the
  // same plain id. Normalize any pasted `custom:<other>:` prefix first so a
  // re-pasted id doesn't double-prefix.
  let stored = models;
  if (key.provider === "custom") {
    const slug = key.service_slug;
    if (!slug) {
      return c.json({ error: { message: "custom key is missing its service slug", type: "invalid_request_error" } }, 400);
    }
    stored = models.map((m) => customModelId(slug, customPlainModel(m) ?? m));
  }
  const already = new Set(
    (await listAvailableModels(c.env))
      .filter((r) => r.provider === key.provider)
      .map((r) => r.model)
  );
  let added = 0;
  for (const m of stored) {
    if (!already.has(m)) added++;
  }
  // Bulk add (e.g. 401 checked models) must not do one D1 round-trip per
  // model — the same 5-10s stall as POST /keys/add. Same upsert, batched.
  await setModelStatusBatch(
    c.env,
    stored.map((m) => ({ model: m, provider: key.provider, available: true, reason: null }))
  );
  return c.json({ provider: key.provider, added, total: stored.length, models: stored });
});

// POST /keys/custom — add a custom OpenAI-compatible service: one key for a
// user-named service (slug) at a base URL. Body: { slug, base_url, api_key }.
// The slug is the service's identity: keys sharing a slug pool together
// (same upstream); a slug reused with a different address is rejected so two
// services can't silently share a name. Returns the key id so the console
// can fetch that service's live models right after.
app.post("/keys/custom", async (c) => {
  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "invalid json body", type: "invalid_request_error" } }, 400);
  }
  const b = (body ?? {}) as { slug?: unknown; base_url?: unknown; api_key?: unknown };
  const slug = typeof b.slug === "string" ? b.slug.trim().toLowerCase() : "";
  const baseUrl = typeof b.base_url === "string" ? normalizeBaseUrl(b.base_url) : "";
  const apiKey = typeof b.api_key === "string" ? b.api_key.trim() : "";
  if (!isValidServiceSlug(slug)) {
    return c.json({ error: { message: "服务名须为小写字母/数字/连字符（1-32 字符），如 2api", type: "invalid_request_error" } }, 400);
  }
  if (!baseUrl) {
    return c.json({ error: { message: "base_url 须为 http(s) 地址，如 https://ai.example.com/v1", type: "invalid_request_error" } }, 400);
  }
  if (!apiKey) {
    return c.json({ error: { message: "api_key 不能为空", type: "invalid_request_error" } }, 400);
  }
  const existing = await customServiceBaseUrl(c.env, slug);
  if (existing !== null && existing !== baseUrl) {
    return c.json({ error: { message: `服务名 ${slug} 已存在，对应另一个地址（${existing}）`, type: "invalid_request_error" } }, 400);
  }
  const result = await addCustomKey(c.env, { slug, baseUrl, apiKey });
  return c.json({ added: result.added, duplicate: result.duplicate, id: result.id, slug, base_url: baseUrl });
});

// POST /keys/:id/edit — edit a key: rotate its api_key (any key) and/or, for
// a custom service key, its base URL and service name (slug). Built-in
// providers have no editable name or address (fixed by the adapter), only
// the key itself. Renaming a slug also renames the service's models
// (custom:<old>:<model> → custom:<new>:<model>), so callers don't have to
// re-add them.
app.post("/keys/:id/edit", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json({ error: { message: "invalid key id", type: "invalid_request_error" } }, 400);
  }
  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "invalid json body", type: "invalid_request_error" } }, 400);
  }
  const b = (body ?? {}) as { api_key?: unknown; base_url?: unknown; service_slug?: unknown };
  const patch: { apiKey?: string; baseUrl?: string; slug?: string } = {};
  if (b.api_key !== undefined) {
    if (typeof b.api_key !== "string" || !b.api_key.trim()) {
      return c.json({ error: { message: "api_key 不能为空", type: "invalid_request_error" } }, 400);
    }
    patch.apiKey = b.api_key.trim();
  }
  if (b.base_url !== undefined) {
    if (typeof b.base_url !== "string") {
      return c.json({ error: { message: "base_url 须为字符串", type: "invalid_request_error" } }, 400);
    }
    const baseUrl = normalizeBaseUrl(b.base_url);
    if (!baseUrl) {
      return c.json({ error: { message: "base_url 须为 http(s) 地址，如 https://ai.example.com/v1", type: "invalid_request_error" } }, 400);
    }
    patch.baseUrl = baseUrl;
  }
  if (b.service_slug !== undefined) {
    if (typeof b.service_slug !== "string") {
      return c.json({ error: { message: "service_slug 须为字符串", type: "invalid_request_error" } }, 400);
    }
    const slug = b.service_slug.trim().toLowerCase();
    if (!isValidServiceSlug(slug)) {
      return c.json({ error: { message: "服务名须为小写字母/数字/连字符（1-32 字符），如 2api", type: "invalid_request_error" } }, 400);
    }
    patch.slug = slug;
  }
  if (patch.apiKey === undefined && patch.baseUrl === undefined && patch.slug === undefined) {
    return c.json({ error: { message: "nothing to update", type: "invalid_request_error" } }, 400);
  }
  try {
    const { row, renamedModels } = await updateKey(c.env, id, patch);
    return c.json({
      id: row.id,
      provider: row.provider,
      service_slug: row.service_slug,
      base_url: row.base_url,
      status: row.status,
      renamed_models: renamedModels,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "update failed";
    if (msg === "key not found") {
      return c.json({ error: { message: msg, type: "not_found" } }, 404);
    }
    return c.json({ error: { message: msg, type: "invalid_request_error" } }, 400);
  }
});

// POST /keys/add — JSON { provider, api_key, models[] }: import one key and
// set models NOT in the list unavailable (so future requests skip them).
app.post("/keys/add", async (c) => {
  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "invalid json body", type: "invalid_request_error" } }, 400);
  }
  const b = (body ?? {}) as { provider?: unknown; api_key?: unknown; models?: unknown };
  if (typeof b.provider !== "string" || typeof b.api_key !== "string") {
    return c.json(
      { error: { message: "expected { provider: string, api_key: string, models?: string[] }", type: "invalid_request_error" } },
      400
    );
  }
  const provider = b.provider.trim().toLowerCase();
  const api_key = b.api_key.trim();
  if (!isProvider(provider) || !api_key) {
    return c.json({ error: { message: "unknown provider or empty api_key", type: "invalid_request_error" } }, 400);
  }
  // A custom service needs a base URL, which this endpoint doesn't take —
  // use POST /keys/custom (Key 池「添加自定义服务」) instead.
  if (provider === "custom") {
    return c.json({ error: { message: "自定义服务需要 base_url：请用 Key 池「添加自定义服务」", type: "invalid_request_error" } }, 400);
  }
  const selected = Array.isArray(b.models) ? b.models.filter((m): m is string => typeof m === "string") : [];
  const result = await importKeys(c.env, [{ provider: provider as Provider, api_key }]);
  // The old code marked every model NOT in `selected` unavailable GLOBALLY
  // (setModelStatus) — importing one key with a subset silently blocked those
  // models for every other key of the provider too. Only the SELECTED models
  // are recorded now (available=1, same as POST /keys/:id/models); the rest
  // are left untouched. `blocked` stays [] to keep the response shape.
  const toAdd = selected
    .map((m) => m.trim())
    .filter((id) => id && !/\s/.test(id) && id.length <= 200);
  // Bulk import must not do one D1 round-trip per model: 453 models took
  // 5-10s sequentially, during which the import modal sat open with no
  // feedback. Same upsert, batched (see setModelStatusBatch).
  await setModelStatusBatch(
    c.env,
    toAdd.map((id) => ({ model: id, provider, available: true, reason: null }))
  );
  const blocked: string[] = [];
  return c.json({ added: result.added, duplicate: result.duplicate, provider, selected, blocked });
});

// POST /keys/import — JSON { keys: "..." } or raw text/plain lines.
app.post("/keys/import", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  let text = "";
  if (contentType.includes("application/json")) {
    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: { message: "invalid json body", type: "invalid_request_error" } },
        400
      );
    }
    if (
      body !== null &&
      typeof body === "object" &&
      typeof (body as { keys?: unknown }).keys === "string"
    ) {
      text = (body as { keys: string }).keys;
    } else {
      return c.json(
        {
          error: {
            message: "expected { keys: string }",
            type: "invalid_request_error",
          },
        },
        400
      );
    }
  } else {
    text = await c.req.text();
  }

  const { entries, skipped } = parseKeyLines(text);
  const result = await importKeys(c.env, entries);
  return c.json({
    added: result.added,
    duplicate: result.duplicate,
    skipped,
    byProvider: result.byProvider,
  });
});

// GET /keys — counts by provider/status.
app.get("/keys", async (c) => {
  const summary = await statsSummary(c.env);
  return c.json(summary);
});

// GET /config — billing flags for the console.
app.get("/config", (c) => {
  return c.json({
    billing_enabled: billingEnabled(c.env),
    discount: billingDiscount(c.env),
  });
});

// GET /usage — global usage aggregates (last 30 days). ?owner=<sub> scopes to one user.
app.get("/usage", async (c) => {
  const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const owner = c.req.query("owner") || undefined;
  return c.json(await usageSummary(c.env, { sinceMs, ownerSub: owner }));
});

// GET /usage/by-user — per-user usage leaderboard (last 30 days), ranked by requests.
app.get("/usage/by-user", async (c) => {
  const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return c.json(await usageByUser(c.env, { sinceMs, limit: 100 }));
});

// GET /logs — recent requests. ?owner=<sub> filters to one user; ?page=N&size=M paginates.
app.get("/logs", async (c) => {
  const owner = c.req.query("owner") || undefined;
  const size = Math.min(200, Math.max(1, parseInt(c.req.query("size") || "50", 10) || 50));
  const page = Math.max(0, parseInt(c.req.query("page") || "0", 10) || 0);
  // Fetch one extra row to tell the UI whether a next page exists.
  const rows = await recentLogs(c.env, { ownerSub: owner, limit: size + 1, offset: page * size });
  const hasMore = rows.length > size;
  return c.json({ rows: hasMore ? rows.slice(0, size) : rows, page, size, hasMore });
});

// POST /probe — run the unattended health check on demand (revive expired
// cooldowns + probe disabled keys). Replaces the CF cron; point a free external
// pinger (cron-job.org, GitHub Actions) at it for fully unattended recovery.
app.post("/probe", async (c) => {
  const result = await runHealthCheck(c.env);
  return c.json({ ok: true, ...result });
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

// POST /keys/:id/enable — manual reactivation.
app.post("/keys/:id/enable", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json(
      { error: { message: "invalid key id", type: "invalid_request_error" } },
      400
    );
  }
  if (!(await getKeyById(c.env, id))) {
    return c.json({ error: { message: "key not found", type: "not_found" } }, 404);
  }
  await reactivateKey(c.env, id);
  return c.json({ id, status: "active" });
});

// POST /keys/:id/disable — manual disable.
app.post("/keys/:id/disable", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json(
      { error: { message: "invalid key id", type: "invalid_request_error" } },
      400
    );
  }
  if (!(await getKeyById(c.env, id))) {
    return c.json({ error: { message: "key not found", type: "not_found" } }, 404);
  }
  await applyOutcome(
    c.env,
    id,
    { kind: "disable", reason: "manual disable" },
    { cooldownMinutes: cooldownMinutes(c.env), maxConsecutive: MAX_CONSECUTIVE_FAILS }
  );
  return c.json({ id, status: "disabled" });
});

// POST /tokens — mint an access token.
app.post("/tokens", async (c) => {
  let opts: {
    name?: string;
    role?: "admin" | "user";
    scope?: "full" | "aliases";
    quotaRequests?: number | null;
    rpmLimit?: number | null;
    expiresAt?: number | null;
  } = {};
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body: unknown = await c.req.json();
      if (body !== null && typeof body === "object") {
        const b = body as {
          name?: unknown;
          role?: unknown;
          scope?: unknown;
          quota_requests?: unknown;
          rpm_limit?: unknown;
          expires_in_days?: unknown;
        };
        // Name is capped (100 chars); quota/rpm must be positive integers
        // (a fractional quota silently truncated downstream); expiry is
        // capped at 10 years so a typo can't mint a forever token.
        if (typeof b.name === "string") opts.name = b.name.slice(0, 100);
        if (b.role === "admin" || b.role === "user") opts.role = b.role;
        // scope "aliases" mints a token that only sees virtual aliases.
        if (b.scope === "aliases" || b.scope === "full") opts.scope = b.scope;
        if (b.quota_requests !== undefined) {
          if (typeof b.quota_requests !== "number" || !Number.isInteger(b.quota_requests) || b.quota_requests <= 0) {
            return c.json({ error: { message: "quota_requests must be a positive integer", type: "invalid_request_error" } }, 400);
          }
          opts.quotaRequests = b.quota_requests;
        }
        if (b.rpm_limit !== undefined) {
          if (typeof b.rpm_limit !== "number" || !Number.isInteger(b.rpm_limit) || b.rpm_limit <= 0) {
            return c.json({ error: { message: "rpm_limit must be a positive integer", type: "invalid_request_error" } }, 400);
          }
          opts.rpmLimit = b.rpm_limit;
        }
        if (b.expires_in_days !== undefined) {
          if (typeof b.expires_in_days !== "number" || !Number.isFinite(b.expires_in_days) || b.expires_in_days <= 0 || b.expires_in_days > 3650) {
            return c.json({ error: { message: "expires_in_days must be between 0 and 3650", type: "invalid_request_error" } }, 400);
          }
          opts.expiresAt = Date.now() + b.expires_in_days * 86400000;
        }
      }
    } catch {
      return c.json(
        { error: { message: "invalid json body", type: "invalid_request_error" } },
        400
      );
    }
  }
  const created = await createToken(c.env, opts);
  return c.json(created);
});

// GET /tokens — list access tokens.
app.get("/tokens", async (c) => {
  const tokens = await listTokens(c.env);
  return c.json(tokens);
});

// DELETE /tokens/:id — permanently revoke an access token.
app.delete("/tokens/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json({ error: { message: "invalid token id", type: "invalid_request_error" } }, 400);
  }
  const ok = await deleteToken(c.env, id);
  return c.json({ ok }, ok ? 200 : 404);
});

// GET /aliases — list all model aliases.
app.get("/aliases", async (c) => {
  return c.json(await listAliases(c.env));
});

// POST /aliases — create or replace a model alias.
app.post("/aliases", async (c) => {
  let b: unknown;
  try {
    b = await c.req.json();
  } catch {
    return c.json({ error: { message: "invalid json body", type: "invalid_request_error" } }, 400);
  }
  if (!b || typeof b !== "object") {
    return c.json({ error: { message: "invalid json body", type: "invalid_request_error" } }, 400);
  }
  const body = b as { alias?: unknown; targets?: unknown; strategy?: unknown };
  // Alias names are bare words: they must not collide with real model ids
  // (which carry "/" or ":"), with "auto", or with each other.
  if (typeof body.alias !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(body.alias)) {
    return c.json({ error: { message: "alias must be 1-64 chars of letters, digits, - or _", type: "invalid_request_error" } }, 400);
  }
  if (body.alias.toLowerCase() === "auto") {
    return c.json({ error: { message: "alias must not be \"auto\"", type: "invalid_request_error" } }, 400);
  }
  if (!Array.isArray(body.targets) || !body.targets.length || body.targets.length > 16) {
    return c.json({ error: { message: "targets must be 1-16 model ids", type: "invalid_request_error" } }, 400);
  }
  const targets: string[] = [];
  for (const t of body.targets) {
    if (typeof t !== "string" || !t.trim() || t.includes(" ") || t.length > 200) {
      return c.json({ error: { message: "each target must be a model id (no spaces, <= 200 chars)", type: "invalid_request_error" } }, 400);
    }
    targets.push(t.trim());
  }
  const strategy = body.strategy === "loadbalance" ? "loadbalance" : "failover";
  await upsertAlias(c.env, body.alias, targets, strategy);
  return c.json({ ok: true, alias: body.alias });
});

// DELETE /aliases/:alias — delete a model alias.
app.delete("/aliases/:alias", async (c) => {
  const alias = c.req.param("alias");
  const ok = await deleteAlias(c.env, alias);
  return c.json({ ok }, ok ? 200 : 404);
});

// POST /aliases/:alias/enable — enable or disable a model alias.
app.post("/aliases/:alias/enable", async (c) => {
  const alias = c.req.param("alias");
  let b: unknown;
  try {
    b = await c.req.json();
  } catch {
    b = {};
  }
  const enabled = (b as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") {
    return c.json({ error: { message: "enabled must be a boolean", type: "invalid_request_error" } }, 400);
  }
  const ok = await setAliasEnabled(c.env, alias, enabled);
  return c.json({ ok }, ok ? 200 : 404);
});

// GET /users — list all users (pending first, newest first within group).
app.get("/users", async (c) => {
  const users = await listUsers(c.env);
  return c.json(users);
});

// POST /users/:id/approve — approve a pending/blocked user.
app.post("/users/:id/approve", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json(
      { error: { message: "invalid user id", type: "invalid_request_error" } },
      400
    );
  }
  const sub = await setUserStatus(c.env, id, "approved");
  if (!sub) return c.json({ error: { message: "user not found", type: "not_found" } }, 404);
  return c.json({ ok: true });
});

// POST /users/:id/block — block a user and disable all their tokens.
app.post("/users/:id/block", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json(
      { error: { message: "invalid user id", type: "invalid_request_error" } },
      400
    );
  }
  const sub = await setUserStatus(c.env, id, "blocked");
  if (!sub) return c.json({ error: { message: "user not found", type: "not_found" } }, 404);
  await disableTokensByOwner(c.env, sub);
  return c.json({ ok: true });
});

/** Mask a secret for display: first 6 + last 4. */
function mask(key: string): string {
  if (key.length <= 12) return key.slice(0, 2) + "…" + key.slice(-2);
  return key.slice(0, 6) + "…" + key.slice(-4);
}

// GET /keys/list — every key (masked) with per-key stats for the list page.
app.get("/keys/list", async (c) => {
  const keys = await listAllKeys(c.env);
  return c.json({
    keys: keys.map((k) => ({
      id: k.id,
      provider: k.provider,
      service_slug: k.service_slug,
      base_url: k.base_url,
      masked: mask(k.api_key),
      status: k.status,
      consecutive_fails: k.consecutive_fails,
      total_requests: k.total_requests,
      total_fails: k.total_fails,
      last_error: k.last_error,
      disabled_reason: k.disabled_reason,
      last_used_at: k.last_used_at,
      cooldown_until: k.cooldown_until,
      created_at: k.created_at,
      project_id: k.project_id,
      balance_remaining: k.balance_remaining,
      balance_unit: k.balance_unit,
    })),
  });
});

// GET /keys/:id/reveal — full plaintext key for admin copy. The whole /admin
// router is behind requireAdmin, so this is admin-only. Fetched on-demand per
// click so the list payload stays masked (full keys never sit in the page).
app.get("/keys/:id/reveal", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json(
      { error: { message: "invalid key id", type: "invalid_request_error" } },
      400
    );
  }
  const row = await c.env.DB.prepare(
    `SELECT api_key FROM keypool_gateway_api_keys WHERE id = ?`
  )
    .bind(id)
    .first<{ api_key: string }>();
  if (!row) {
    return c.json({ error: { message: "key not found", type: "not_found" } }, 404);
  }
  return c.json({ id, api_key: row.api_key });
});

// GET /models-status — per-model availability (probed by /probe-models).
app.get("/models-status", async (c) => {
  return c.json(await listModelStatus(c.env));
});

// POST /probe-models — probe one active key per provider against each model
// and record availability. Returns { checked, blocked }.
app.post("/probe-models", async (c) => {
  return c.json(await probeModels(c.env));
});

// POST /check-all-keys — one rotating sweep batch (back-compat alias of /sweep).
// Used by the health-check workflow / external pingers. (Outside /keys/ to avoid
// colliding with the /keys/:id param routes.)
app.post("/check-all-keys", async (c) => {
  return c.json(await runCheckAll(c.env));
});

// POST /sweep — the scale-safe rotating probe. Each call probes one batch of
// due keys and advances the cursor; `?all=1` first marks the WHOLE pool due so
// successive batches re-validate everything (the 检测全部 button), otherwise it
// only touches genuinely-stale keys (cheap background rotation for pingers/cron).
app.post("/sweep", async (c) => {
  const markAll = c.req.query("all") === "1";
  return c.json(await runSweep(c.env, { markAll }));
});

// GET /sweep-status — cheap progress read for the UI bar: { total, due }.
app.get("/sweep-status", async (c) => {
  return c.json(await sweepProgress(c.env));
});

// POST /keys/:id/chat — chat directly through ONE specific key (bypasses the
// pool; no billing, no key-health side effects). For admins to test a key.
app.post("/keys/:id/chat", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json({ error: { message: "invalid key id", type: "invalid_request_error" } }, 400);
  }
  const row = await getKeyById(c.env, id);
  if (!row) return c.json({ error: { message: "key not found", type: "not_found" } }, 404);
  const body = (await c.req.json().catch(() => null)) as
    | { messages?: unknown; model?: unknown; max_tokens?: unknown; stream?: unknown }
    | null;
  if (!body || !Array.isArray(body.messages)) {
    return c.json({ error: { message: "messages required", type: "invalid_request_error" } }, 400);
  }
  // Custom keys need their base URL; the default model is the service's
  // first added model (no static list exists for custom).
  let adapter = getAdapter(row.provider);
  let model = typeof body.model === "string" && body.model ? body.model : undefined;
  if (row.provider === "custom") {
    adapter = makeCustomAdapter(row.base_url ?? "");
    if (!model && row.service_slug) model = (await firstCustomModel(c.env, row.service_slug)) ?? undefined;
  } else if (!model) {
    model = adapter.models()[0];
  }
  if (!model) {
    return c.json({ error: { message: "no model: pass { model } or add a model to this key first", type: "invalid_request_error" } }, 400);
  }
  const max_tokens = typeof body.max_tokens === "number" ? body.max_tokens : 256;
  const req: OpenAIChatRequest = {
    model,
    messages: body.messages as OpenAIChatRequest["messages"],
    max_tokens,
    stream: body.stream === true ? true : undefined,
  };
  return adapter.chatCompletions(req, row.api_key);
});

// POST /keys/prune — delete only permanently-dead keys (invalid/revoked/404).
// Arrears / 欠费 / 余额不足 are kept (they auto-recover on top-up).
app.post("/keys/prune", async (c) => {
  const removed = await prunePermanentlyDeadKeys(c.env);
  return c.json({ removed });
});

// DELETE /keys/:id — permanently remove a key.
app.delete("/keys/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json({ error: { message: "invalid key id", type: "invalid_request_error" } }, 400);
  }
  const ok = await deleteKey(c.env, id);
  return c.json({ ok }, ok ? 200 : 404);
});


// POST /keys/:id/check — live liveness + balance probe. Revives the key if alive.
app.post("/keys/:id/check", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) {
    return c.json({ error: { message: "invalid key id", type: "invalid_request_error" } }, 400);
  }
  const row = await getKeyById(c.env, id);
  if (!row) return c.json({ error: { message: "key not found", type: "not_found" } }, 404);

  const result = await probeKey(row.provider, row.api_key, await probeOptsForKey(c.env, row));
  // A successful check brings a disabled/cooled key back into rotation AND clears
  // any stale last_error (so a "可用" key no longer shows an old error).
  if (result.alive && !result.rateLimited) {
    await reactivateKey(c.env, id);
  }
  // Persist the freshly-probed balance so the list shows it without re-probing.
  if (result.balance && result.balance.remaining != null) {
    await setKeyBalance(c.env, id, result.balance.remaining, result.balance.unit);
  }
  return c.json({ id, provider: row.provider, ...result });
});

// GET /balances — all consumers and their credit balances (admin overview).
app.get("/balances", async (c) => {
  return c.json(await listBalances(c.env));
});

// POST /balances/:sub/topup — credit a consumer's balance. Body { amount_usd, note? }.
app.post("/balances/:sub/topup", async (c) => {
  let sub: string;
  try {
    // A malformed % escape in the sub must be a 400, not an uncaught 500.
    sub = decodeURIComponent(c.req.param("sub"));
  } catch {
    return c.json({ error: { message: "invalid sub", type: "invalid_request_error" } }, 400);
  }
  let amountUsd = 0;
  let note: string | null = null;
  try {
    const body: unknown = await c.req.json();
    if (body !== null && typeof body === "object") {
      const b = body as { amount_usd?: unknown; note?: unknown };
      if (typeof b.amount_usd === "number" && Number.isFinite(b.amount_usd)) amountUsd = b.amount_usd;
      if (typeof b.note === "string") note = b.note;
    }
  } catch {
    return c.json(
      { error: { message: "invalid json body", type: "invalid_request_error" } },
      400
    );
  }
  if (amountUsd <= 0) {
    return c.json(
      { error: { message: "amount_usd must be positive", type: "invalid_request_error" } },
      400
    );
  }
  let balance_micro: number;
  try {
    balance_micro = await topUpMicro(c.env, sub, Math.round(amountUsd * 1_000_000), note);
  } catch (err) {
    // topUpMicro throws on a missing user — that used to surface as a 500.
    if (err instanceof Error && err.message === "user not found") {
      return c.json({ error: { message: "user not found", type: "not_found" } }, 404);
    }
    throw err;
  }
  return c.json({ balance_micro });
});

// GET /transactions — recent transactions. ?owner=<sub> filters to one consumer.
app.get("/transactions", async (c) => {
  const sub = c.req.query("owner") || undefined;
  return c.json(await listTransactions(c.env, { sub, limit: 100 }));
});

// GET /prices — list per-model token prices (micro-USD per 1M tokens, all columns).
app.get("/prices", async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT model, price_per_mtok_micro, input_per_mtok_micro, output_per_mtok_micro
       FROM keypool_gateway_prices ORDER BY model ASC`
  ).all();
  return c.json(
    (res.results ?? []) as unknown as Array<{
      model: string;
      price_per_mtok_micro: number;
      input_per_mtok_micro: number | null;
      output_per_mtok_micro: number | null;
    }>
  );
});

// POST /prices — upsert split input/output prices for a model.
// Body { model, input_per_mtok_micro, output_per_mtok_micro }; legacy
// { model, price_per_mtok_micro } sets both input and output to that value.
app.post("/prices", async (c) => {
  let model = "";
  let input = NaN;
  let output = NaN;
  let legacy = NaN;
  try {
    const body: unknown = await c.req.json();
    if (body !== null && typeof body === "object") {
      const b = body as {
        model?: unknown;
        input_per_mtok_micro?: unknown;
        output_per_mtok_micro?: unknown;
        price_per_mtok_micro?: unknown;
      };
      if (typeof b.model === "string") model = b.model.trim();
      if (typeof b.input_per_mtok_micro === "number" && Number.isFinite(b.input_per_mtok_micro)) {
        input = b.input_per_mtok_micro;
      }
      if (typeof b.output_per_mtok_micro === "number" && Number.isFinite(b.output_per_mtok_micro)) {
        output = b.output_per_mtok_micro;
      }
      if (typeof b.price_per_mtok_micro === "number" && Number.isFinite(b.price_per_mtok_micro)) {
        legacy = b.price_per_mtok_micro;
      }
    }
  } catch {
    return c.json(
      { error: { message: "invalid json body", type: "invalid_request_error" } },
      400
    );
  }
  // Legacy single price fills any unspecified side.
  if (Number.isFinite(legacy)) {
    if (!Number.isFinite(input)) input = legacy;
    if (!Number.isFinite(output)) output = legacy;
  }
  // Normalize the model name (strip `provider:` prefix, lowercase, trim) so
  // the stored row matches what priceForModel looks up — an admin entering
  // "Groq:llama-3.3-70b-versatile" used to create a row billing never hit.
  model = normalizeModelKey(model);
  if (
    model.length === 0 ||
    !Number.isFinite(input) ||
    input < 0 ||
    !Number.isFinite(output) ||
    output < 0
  ) {
    return c.json(
      {
        error: {
          message:
            "expected { model: string, input_per_mtok_micro: number, output_per_mtok_micro: number } (or legacy price_per_mtok_micro)",
          type: "invalid_request_error",
        },
      },
      400
    );
  }
  const inputMicro = Math.round(input);
  const outputMicro = Math.round(output);
  // price_per_mtok_micro is NOT NULL legacy column — keep it in sync with input.
  await c.env.DB.prepare(
    `INSERT INTO keypool_gateway_prices
       (model, price_per_mtok_micro, input_per_mtok_micro, output_per_mtok_micro)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(model) DO UPDATE SET
       price_per_mtok_micro = excluded.price_per_mtok_micro,
       input_per_mtok_micro = excluded.input_per_mtok_micro,
       output_per_mtok_micro = excluded.output_per_mtok_micro`
  )
    .bind(model, inputMicro, inputMicro, outputMicro)
    .run();
  return c.json({
    model,
    price_per_mtok_micro: inputMicro,
    input_per_mtok_micro: inputMicro,
    output_per_mtok_micro: outputMicro,
  });
});

export default app;
