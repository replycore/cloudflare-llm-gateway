/** D1 data layer — all key/token/log access lives here. */

import type { Env, Provider, ApiKeyRow, Outcome, Role } from "./types";
import { stripProviderPrefix } from "./providers/types";

/** Normalize a model id for price lookup: strip any `provider:` routing
 *  prefix, trim, lowercase — so `groq:llama-3.3-70b-versatile` matches the
 *  price row an admin entered as `llama-3.3-70b-versatile`. */
export function normalizeModelKey(model: string): string {
  return stripProviderPrefix(model).trim().toLowerCase();
}

/** Safe fallback price (micro-USD per 1M tokens): a non-numeric
 *  DEFAULT_PRICE_MICRO used to poison every unpriced model with NaN. */
export function defaultPriceMicro(env: Env): number {
  const n = Number(env.DEFAULT_PRICE_MICRO ?? "500000");
  return Number.isFinite(n) && n >= 0 ? n : 500000;
}

/** Generate a url-safe random token like "sk-kp-<40 hex>" using crypto. */
export function generateToken(prefix = "sk-kp-"): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return prefix + hex;
}

/** Insert keys (status='active'). Dedup on (provider, api_key). */
export async function importKeys(
  env: Env,
  entries: Array<{ provider: Provider; api_key: string }>
): Promise<{ added: number; duplicate: number; byProvider: Record<string, number> }> {
  const byProvider: Record<string, number> = {};
  let added = 0;
  let duplicate = 0;

  // In-batch dedup so duplicates within `entries` are counted, not silently lost.
  const seen = new Set<string>();

  for (const entry of entries) {
    const key = `${entry.provider}\0${entry.api_key}`;
    if (seen.has(key)) {
      duplicate++;
      continue;
    }
    seen.add(key);

    const now = Date.now();
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO keypool_gateway_api_keys (provider, api_key, status, consecutive_fails, total_requests, total_fails, last_error, last_used_at, cooldown_until, disabled_reason, created_at)
       VALUES (?, ?, 'active', 0, 0, 0, NULL, NULL, NULL, NULL, ?)`
    )
      .bind(entry.provider, entry.api_key, now)
      .run();

    const changes = res.meta?.changes ?? 0;
    if (changes > 0) {
      added++;
      byProvider[entry.provider] = (byProvider[entry.provider] ?? 0) + 1;
    } else {
      duplicate++;
    }
  }

  return { added, duplicate, byProvider };
}

/** A small random batch of usable keys for a provider (status='active'). The
 *  LIMIT keeps the hot path O(batch), not O(pool): a request only ever tries up
 *  to MAX_KEY_RETRIES keys, so pulling the whole active set (which could be tens
 *  of thousands of rows) would be pure waste. 32 leaves ample retry headroom. */
const ACTIVE_KEY_BATCH = 32;
export async function listActiveKeys(env: Env, provider: Provider, slug?: string): Promise<ApiKeyRow[]> {
  // For custom services the pool must NOT mix services: keys of different
  // slugs are different upstreams. `slug` narrows the pick to one service.
  if (slug) {
    const res = await env.DB.prepare(
      `SELECT * FROM keypool_gateway_api_keys WHERE provider = ? AND service_slug = ? AND status = 'active' ORDER BY RANDOM() LIMIT ?`
    )
      .bind(provider, slug, ACTIVE_KEY_BATCH)
      .all();
    return (res.results ?? []) as unknown as ApiKeyRow[];
  }
  const res = await env.DB.prepare(
    `SELECT * FROM keypool_gateway_api_keys WHERE provider = ? AND status = 'active' ORDER BY RANDOM() LIMIT ?`
  )
    .bind(provider, ACTIVE_KEY_BATCH)
    .all();
  return (res.results ?? []) as unknown as ApiKeyRow[];
}

/** One active key row for a provider (and, for custom services, one service
 * slug). Full row — callers need base_url / service_slug for custom keys. */
export async function oneActiveKeyRow(env: Env, provider: Provider, slug?: string): Promise<ApiKeyRow | null> {
  const row = slug
    ? await env.DB.prepare(
        `SELECT * FROM keypool_gateway_api_keys WHERE provider = ? AND service_slug = ? AND status = 'active' LIMIT 1`
      )
        .bind(provider, slug)
        .first<ApiKeyRow>()
    : await env.DB.prepare(
        `SELECT * FROM keypool_gateway_api_keys WHERE provider = ? AND status = 'active' LIMIT 1`
      )
        .bind(provider)
        .first<ApiKeyRow>();
  return row ?? null;
}

/** Insert one custom-service key. Returns the new row id (or the existing
 * row's id on duplicate, so the UI can still open that key's model list). */
export async function addCustomKey(
  env: Env,
  entry: { slug: string; baseUrl: string; apiKey: string }
): Promise<{ added: number; duplicate: number; id: number | null }> {
  const now = Date.now();
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO keypool_gateway_api_keys (provider, api_key, base_url, service_slug, status, consecutive_fails, total_requests, total_fails, last_error, last_used_at, cooldown_until, disabled_reason, created_at)
     VALUES ('custom', ?, ?, ?, 'active', 0, 0, 0, NULL, NULL, NULL, NULL, ?)`
  )
    .bind(entry.apiKey, entry.baseUrl, entry.slug, now)
    .run();
  const changes = res.meta?.changes ?? 0;
  if (changes > 0) {
    const lastRowId = (res.meta as { last_row_id?: unknown } | undefined)?.last_row_id;
    return { added: 1, duplicate: 0, id: typeof lastRowId === "number" ? lastRowId : null };
  }
  const row = await env.DB.prepare(
    `SELECT id FROM keypool_gateway_api_keys WHERE provider = 'custom' AND api_key = ?`
  )
    .bind(entry.apiKey)
    .first<{ id: number }>();
  return { added: 0, duplicate: 1, id: row ? row.id : null };
}

/** The stored base_url for a custom service slug (any key of that service),
 * or null when the slug is unused. Used to reject a slug reused with a
 * different address. */
export async function customServiceBaseUrl(env: Env, slug: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT base_url FROM keypool_gateway_api_keys WHERE provider = 'custom' AND service_slug = ? LIMIT 1`
  )
    .bind(slug)
    .first<{ base_url: string | null }>();
  return row ? row.base_url : null;
}

/** First available model id for a custom service slug (full
 * `custom:<slug>:<model>` id), or null when the service has no added model. */
export async function firstCustomModel(env: Env, slug: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT model FROM keypool_gateway_model_status WHERE provider = 'custom' AND model LIKE ? AND available = 1 ORDER BY model ASC LIMIT 1`
  )
    .bind(`custom:${slug}:%`)
    .first<{ model: string }>();
  return row ? row.model : null;
}

/** Providers that currently have at least one active key (for the model list). */
export async function providersWithActiveKeys(env: Env): Promise<Set<string>> {
  const res = await env.DB.prepare(
    `SELECT DISTINCT provider FROM keypool_gateway_api_keys WHERE status = 'active'`
  ).all();
  const set = new Set<string>();
  for (const r of (res.results ?? []) as unknown as Array<{ provider: string }>) {
    set.add(r.provider);
  }
  return set;
}

/** Every key (all providers, all statuses) for the admin key-list page.
 *  Capped: an unbounded full-table read stalls the Worker on a big pool. */
export async function listAllKeys(env: Env): Promise<ApiKeyRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM keypool_gateway_api_keys ORDER BY provider ASC, id ASC LIMIT 5000`
  ).all();
  return (res.results ?? []) as unknown as ApiKeyRow[];
}

/** Fetch a single key row by id (includes the plaintext api_key — server-side only). */
export async function getKeyById(env: Env, id: number): Promise<ApiKeyRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM keypool_gateway_api_keys WHERE id = ?`
  )
    .bind(id)
    .first<ApiKeyRow>();
  return row ?? null;
}

/**
 * Edit a custom service key: change its base URL and/or service name (slug).
 * The route validates the format first (slug regex, http(s) base URL);
 * this does the data-level checks and the writes.
 * - Changing only the base URL touches just the key row (models are keyed
 *   by slug, not by address).
 * - Renaming the slug also renames the service's models
 *   (`custom:<old>:<model>` → `custom:<new>:<model>`) so routing keeps
 *   working; the key row and the model rename land in one D1 batch.
 * Rejected when: the key doesn't exist; it isn't a custom key; the new
 * slug is already used by a different address (same rule as POST
 * /keys/custom); the rename would collide with models the target slug
 * already has (same plain id under the new slug would violate the model
 * PK). Returns the updated row plus how many models were renamed.
 */
export async function updateCustomKey(
  env: Env,
  id: number,
  patch: { baseUrl?: string; slug?: string }
): Promise<{ row: ApiKeyRow; renamedModels: number }> {
  const key = await getKeyById(env, id);
  if (!key) throw new Error("key not found");
  if (key.provider !== "custom") throw new Error("only custom service keys can be edited");
  const newBase = patch.baseUrl !== undefined ? patch.baseUrl : key.base_url;
  const newSlug = patch.slug !== undefined ? patch.slug : key.service_slug;
  if (!newBase || !newSlug) throw new Error("custom key needs a base_url and a service_slug");
  if (newSlug !== key.service_slug) {
    const existing = await customServiceBaseUrl(env, newSlug);
    if (existing !== null && existing !== newBase) {
      throw new Error(`服务名 ${newSlug} 已存在，对应另一个地址（${existing}）`);
    }
    // A rename must not collide with models the target slug already has.
    const clash = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM keypool_gateway_model_status
        WHERE model LIKE ?
          AND substr(model, length(?) + 1) IN (
            SELECT substr(model, length(?) + 1) FROM keypool_gateway_model_status WHERE model LIKE ?
          )`
    )
      .bind(`custom:${newSlug}:%`, `custom:${newSlug}:`, `custom:${key.service_slug}:`, `custom:${key.service_slug}:%`)
      .first<{ n: number }>();
    if ((clash?.n ?? 0) > 0) {
      throw new Error(`目标服务名 ${newSlug} 下已有 ${clash?.n} 个同名模型，先删掉或换个名字`);
    }
  }
  let renamedModels = 0;
  if (newSlug !== key.service_slug) {
    const cnt = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM keypool_gateway_model_status WHERE model LIKE ?`
    )
      .bind(`custom:${key.service_slug}:%`)
      .first<{ n: number }>();
    renamedModels = cnt?.n ?? 0;
  }
  const stmts = [
    env.DB.prepare(
      `UPDATE keypool_gateway_api_keys SET base_url = ?, service_slug = ? WHERE id = ?`
    ).bind(newBase, newSlug, id),
  ];
  if (newSlug !== key.service_slug) {
    stmts.push(
      env.DB.prepare(
        `UPDATE keypool_gateway_model_status SET model = REPLACE(model, ?, ?) WHERE model LIKE ?`
      ).bind(`custom:${key.service_slug}:`, `custom:${newSlug}:`, `custom:${key.service_slug}:%`)
    );
  }
  await env.DB.batch(stmts);
  const row = await getKeyById(env, id);
  if (!row) throw new Error("key not found");
  return { row, renamedModels };
}

/**
 * Delete only PERMANENTLY-dead disabled keys — revoked/invalid keys and hard
 * not-founds. Arrears/欠费/"Access denied (good standing)"/余额不足 are kept:
 * they recover when the account is topped up (the recovery probe revives them).
 * Returns the number of keys removed.
 */
export async function prunePermanentlyDeadKeys(env: Env): Promise<number> {
  const res = await env.DB.prepare(
    `DELETE FROM keypool_gateway_api_keys
       WHERE status = 'disabled'
         AND (
           LOWER(COALESCE(disabled_reason, last_error, '')) LIKE '%invalid key%'
           OR LOWER(COALESCE(disabled_reason, last_error, '')) LIKE '%invalid api%'
           OR LOWER(COALESCE(disabled_reason, last_error, '')) LIKE '%api_key_invalid%'
           OR LOWER(COALESCE(disabled_reason, last_error, '')) LIKE '%not valid%'
           OR LOWER(COALESCE(disabled_reason, last_error, '')) LIKE '%unauthor%'
           OR LOWER(COALESCE(disabled_reason, last_error, '')) LIKE '%permission denied%'
           OR LOWER(COALESCE(disabled_reason, last_error, '')) LIKE '%not found the model%'
           OR COALESCE(disabled_reason, last_error, '') LIKE 'http 401%'
           OR COALESCE(disabled_reason, last_error, '') LIKE 'http 403%'
           OR COALESCE(disabled_reason, last_error, '') LIKE 'http 404%'
         )
         -- keep recoverable accounts: arrears / overdue / low balance.
         AND COALESCE(disabled_reason, last_error, '') NOT LIKE '%Access denied%'
         AND COALESCE(disabled_reason, last_error, '') NOT LIKE '%余额%'
         AND COALESCE(disabled_reason, last_error, '') NOT LIKE '%欠费%'
         AND LOWER(COALESCE(disabled_reason, last_error, '')) NOT LIKE '%arrear%'
         AND LOWER(COALESCE(disabled_reason, last_error, '')) NOT LIKE '%overdue%'
         AND LOWER(COALESCE(disabled_reason, last_error, '')) NOT LIKE '%insufficient%'
         AND LOWER(COALESCE(disabled_reason, last_error, '')) NOT LIKE '%good standing%'`
  ).run();
  return res.meta?.changes ?? 0;
}

/** Permanently remove a key. Returns true if a row was deleted. */
export async function deleteKey(env: Env, id: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `DELETE FROM keypool_gateway_api_keys WHERE id = ?`
  )
    .bind(id)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Mark a successful use: total_requests++, consecutive_fails=0, last_used_at=now. */
export async function recordSuccess(env: Env, keyId: number): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE keypool_gateway_api_keys
       SET total_requests = total_requests + 1,
           consecutive_fails = 0,
           last_error = NULL,
           last_used_at = ?
     WHERE id = ?`
  )
    .bind(now, keyId)
    .run();
}

/**
 * Apply a non-ok outcome to a key:
 *  - "disable":   status='disabled', disabled_reason=reason, total_fails++.
 *  - "cooldown":  status='cooldown', cooldown_until=now+minutes*60000, total_fails++.
 *  - "transient": total_fails++, consecutive_fails++. If consecutive_fails reaches
 *                 maxConsecutive, downgrade to a cooldown of `cooldownMinutes`.
 * Always set last_error and last_used_at=now.
 */
export async function applyOutcome(
  env: Env,
  keyId: number,
  outcome: Outcome,
  opts: { cooldownMinutes: number; maxConsecutive: number }
): Promise<void> {
  const now = Date.now();

  switch (outcome.kind) {
    case "ok":
      // Not a failure outcome; nothing to apply here.
      return;
    case "disable": {
      await env.DB.prepare(
        `UPDATE keypool_gateway_api_keys
           SET status = 'disabled',
               disabled_reason = ?,
               total_fails = total_fails + 1,
               last_error = ?,
               last_used_at = ?
         WHERE id = ?`
      )
        .bind(outcome.reason, outcome.reason, now, keyId)
        .run();
      return;
    }
    case "cooldown": {
      // Progressive backoff: a key that keeps failing cools down longer each
      // time (base × min(consecutive_fails+1, 30)), capping the flap for a
      // perpetually-throttled key. A success (recordSuccess) resets the counter.
      // The total is capped at max(base, 360min): a per-DAY quota cooldown
      // (base 360min) must stay ~6h, not multiply out to 7.5 days.
      const baseMs = outcome.minutes * 60000;
      const capMs = Math.max(outcome.minutes, 360) * 60000;
      await env.DB.prepare(
        `UPDATE keypool_gateway_api_keys
           SET status = 'cooldown',
               consecutive_fails = consecutive_fails + 1,
               cooldown_until = ? + MIN(? * MIN(consecutive_fails + 1, 30), ?),
               total_fails = total_fails + 1,
               last_error = ?,
               last_used_at = ?
         WHERE id = ?`
      )
        .bind(now, baseMs, capMs, outcome.reason, now, keyId)
        .run();
      return;
    }
    case "transient": {
      const until = now + opts.cooldownMinutes * 60000;
      // Bump fail counters; if consecutive_fails reaches the threshold, downgrade
      // to a cooldown in the same statement.
      await env.DB.prepare(
        `UPDATE keypool_gateway_api_keys
           SET total_fails = total_fails + 1,
               consecutive_fails = consecutive_fails + 1,
               last_error = ?,
               last_used_at = ?,
               status = CASE
                 WHEN consecutive_fails + 1 >= ? THEN 'cooldown'
                 ELSE status
               END,
               cooldown_until = CASE
                 WHEN consecutive_fails + 1 >= ? THEN ?
                 ELSE cooldown_until
               END
         WHERE id = ?`
      )
        .bind(outcome.reason, now, opts.maxConsecutive, opts.maxConsecutive, until, keyId)
        .run();
      return;
    }
  }
}

/** Cooldown keys whose cooldown_until <= now -> status='active'. Returns count.
 *  consecutive_fails is intentionally NOT reset here — only a successful call
 *  (recordSuccess) clears it, so progressive backoff accumulates for a key that
 *  keeps failing across revive cycles instead of flapping at the base interval. */
export async function reviveExpiredCooldowns(env: Env, now: number): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE keypool_gateway_api_keys
       SET status = 'active',
           cooldown_until = NULL
     WHERE status = 'cooldown' AND cooldown_until IS NOT NULL AND cooldown_until <= ?`
  )
    .bind(now)
    .run();
  return res.meta?.changes ?? 0;
}

/**
 * Disabled keys eligible for a revive probe: status='disabled' AND
 * (last_used_at IS NULL OR last_used_at <= now - probeIntervalMs). Cap `limit`.
 */
export async function listDisabledForProbe(
  env: Env,
  now: number,
  probeIntervalMs: number,
  limit: number
): Promise<ApiKeyRow[]> {
  const threshold = now - probeIntervalMs;
  const res = await env.DB.prepare(
    `SELECT * FROM keypool_gateway_api_keys
      WHERE status = 'disabled'
        AND (last_used_at IS NULL OR last_used_at <= ?)
      ORDER BY last_used_at ASC
      LIMIT ?`
  )
    .bind(threshold, limit)
    .all();
  return (res.results ?? []) as unknown as ApiKeyRow[];
}

/** status='active', consecutive_fails=0, disabled_reason=NULL, cooldown_until=NULL. */
export async function reactivateKey(env: Env, keyId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE keypool_gateway_api_keys
       SET status = 'active',
           consecutive_fails = 0,
           disabled_reason = NULL,
           cooldown_until = NULL,
           last_error = NULL,
           last_used_at = ?
     WHERE id = ?`
  )
    .bind(Date.now(), keyId)
    .run();
}

/** One batch for the rotating sweep, sized for the Worker subrequest cap.
 *  "Due" = never probed (last_probed_at NULL) OR probed before now-intervalMs.
 *  Ordering: non-active first (disabled/cooldown need recovery; active keys are
 *  validated for free by real traffic), then least-recently-probed. A larger
 *  candidate set is read so the caller can spread the batch across providers
 *  (avoid 429-storming one provider by probing N of its keys at once). */
export async function listDueForProbe(
  env: Env,
  opts: { limit: number; intervalMs: number; now: number; candidateMultiple?: number }
): Promise<ApiKeyRow[]> {
  const threshold = opts.now - opts.intervalMs;
  const candidateLimit = Math.min(512, opts.limit * (opts.candidateMultiple ?? 4));
  const res = await env.DB.prepare(
    `SELECT * FROM keypool_gateway_api_keys
      WHERE last_probed_at IS NULL OR last_probed_at <= ?
      ORDER BY (status = 'active') ASC, (last_probed_at IS NULL) DESC, last_probed_at ASC
      LIMIT ?`
  )
    .bind(threshold, candidateLimit)
    .all();
  const candidates = (res.results ?? []) as unknown as ApiKeyRow[];
  // Spread across providers: cap per-provider at ceil(limit/3) on the first pass
  // so a batch isn't all one provider, then fill any remaining budget ignoring
  // the cap (so a single-provider pool still uses the full batch).
  const perProviderCap = Math.max(1, Math.ceil(opts.limit / 3));
  const counts = new Map<string, number>();
  const out: ApiKeyRow[] = [];
  const used = new Set<number>();
  for (const k of candidates) {
    if (out.length >= opts.limit) break;
    const n = counts.get(k.provider) ?? 0;
    if (n < perProviderCap) {
      counts.set(k.provider, n + 1);
      used.add(k.id);
      out.push(k);
    }
  }
  if (out.length < opts.limit) {
    for (const k of candidates) {
      if (out.length >= opts.limit) break;
      if (!used.has(k.id)) {
        used.add(k.id);
        out.push(k);
      }
    }
  }
  return out;
}

/** Advance the sweep cursor for a probed batch in one write (≤ `ids.length`
 *  rows). Called for every probed key — alive or dead — so the rotation moves
 *  forward regardless of outcome. No-op on an empty batch. */
export async function markProbed(env: Env, ids: number[], now: number): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await env.DB.prepare(
    `UPDATE keypool_gateway_api_keys SET last_probed_at = ? WHERE id IN (${placeholders})`
  )
    .bind(now, ...ids)
    .run();
}

/** "检测全部" trigger: mark every key due for a probe (last_probed_at = NULL).
 *  The rotating sweep then drains them over successive batches. Returns rows. */
export async function markAllDueForProbe(env: Env): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE keypool_gateway_api_keys SET last_probed_at = NULL`
  ).run();
  return res.meta?.changes ?? 0;
}

/** Sweep progress for the UI/pinger: total keys and how many are still due. */
export async function getProbeProgress(
  env: Env,
  intervalMs: number,
  now: number
): Promise<{ total: number; due: number }> {
  const threshold = now - intervalMs;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN last_probed_at IS NULL OR last_probed_at <= ? THEN 1 ELSE 0 END) AS due
       FROM keypool_gateway_api_keys`
  )
    .bind(threshold)
    .first<{ total: number; due: number | null }>();
  return { total: row?.total ?? 0, due: row?.due ?? 0 };
}

/** Best-effort insert into keypool_gateway_request_logs (never throw on logging failure). */
export async function logRequest(
  env: Env,
  row: {
    provider: Provider;
    keyId: number | null;
    model: string | null;
    statusCode: number | null;
    latencyMs: number | null;
    ok: boolean;
    tokenId?: number | null;
    ownerSub?: string | null;
    totalTokens?: number | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    final?: boolean;
  }
): Promise<number | null> {
  try {
    const res = await env.DB.prepare(
      `INSERT INTO keypool_gateway_request_logs (provider, key_id, model, status_code, latency_ms, ok, token_id, owner_sub, total_tokens, prompt_tokens, completion_tokens, final, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.provider,
        row.keyId,
        row.model,
        row.statusCode,
        row.latencyMs,
        row.ok ? 1 : 0,
        row.tokenId ?? null,
        row.ownerSub ?? null,
        row.totalTokens ?? null,
        row.promptTokens ?? null,
        row.completionTokens ?? null,
        row.final ? 1 : 0,
        Date.now()
      )
      .run();
    return typeof res.meta?.last_row_id === "number" ? res.meta.last_row_id : null;
  } catch {
    // Logging must never break a request path.
    return null;
  }
}

/** Update a (streaming) log row's token count once usage is known. */
export async function updateLogTokens(
  env: Env,
  logId: number,
  totalTokens: number
): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE keypool_gateway_request_logs SET total_tokens = ? WHERE id = ?`
    )
      .bind(totalTokens, logId)
      .run();
  } catch {
    // best-effort
  }
}

/** Update a (streaming) log row's split + total token counts once usage is known. */
export async function updateLogUsage(
  env: Env,
  logId: number,
  promptTokens: number | null,
  completionTokens: number | null,
  totalTokens: number | null
): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE keypool_gateway_request_logs SET prompt_tokens = ?, completion_tokens = ?, total_tokens = ? WHERE id = ?`
    )
      .bind(promptTokens, completionTokens, totalTokens, logId)
      .run();
  } catch {
    // best-effort
  }
}

/** Resolve a bearer token to a role. ADMIN_TOKEN -> 'admin'. Else look up
 *  keypool_gateway_access_tokens where token=? AND enabled=1 AND not expired.
 *  Returns null if unknown. Expired tokens are rejected here (not only in
 *  checkTokenLimits) so they can't reach any route. */
export async function resolveToken(env: Env, token: string): Promise<Role | null> {
  if (!token) return null;
  if (timingSafeEqual(token, env.ADMIN_TOKEN ?? "")) return "admin";

  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT role FROM keypool_gateway_access_tokens WHERE token = ? AND enabled = 1 AND (expires_at IS NULL OR expires_at > ?)`
  )
    .bind(token, now)
    .first<{ role: Role }>();

  return row ? row.role : null;
}

/** Resolve a token to its row identity (role + id + owner) for usage attribution. */
export async function resolveTokenFull(
  env: Env,
  token: string
): Promise<{ role: Role; id: number | null; ownerSub: string | null } | null> {
  if (!token) return null;
  if (timingSafeEqual(token, env.ADMIN_TOKEN ?? "")) return { role: "admin", id: null, ownerSub: null };
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT id, role, owner_sub FROM keypool_gateway_access_tokens WHERE token = ? AND enabled = 1 AND (expires_at IS NULL OR expires_at > ?)`
  )
    .bind(token, now)
    .first<{ id: number; role: Role; owner_sub: string | null }>();
  return row ? { role: row.role, id: row.id, ownerSub: row.owner_sub } : null;
}

/** Constant-time string compare (for ADMIN_TOKEN, so a timing probe can't
 *  learn it byte by byte). Returns false on length mismatch. */
function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Aggregate request usage. With `ownerSub`, scopes to one consumer; else global. */
export async function usageSummary(
  env: Env,
  opts: { ownerSub?: string; sinceMs: number }
): Promise<{
  total: number;
  ok: number;
  tokens: number;
  byProvider: Array<{ provider: string; n: number; ok: number; avg_latency: number; tokens: number }>;
  byDay: Array<{ day: string; n: number; ok: number }>;
}> {
  // Only `final` rows count as a client request (one per request, not per key attempt).
  const owner = opts.ownerSub ?? null;
  const cond = owner ? "final = 1 AND created_at >= ? AND owner_sub = ?" : "final = 1 AND created_at >= ?";
  const args: Array<number | string> = owner ? [opts.sinceMs, owner] : [opts.sinceMs];

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(ok),0) AS ok, COALESCE(SUM(total_tokens),0) AS tokens FROM keypool_gateway_request_logs WHERE ${cond}`
  )
    .bind(...args)
    .first<{ n: number; ok: number; tokens: number }>();

  const byProvider = await env.DB.prepare(
    `SELECT provider, COUNT(*) AS n, COALESCE(SUM(ok),0) AS ok, COALESCE(AVG(latency_ms),0) AS avg_latency, COALESCE(SUM(total_tokens),0) AS tokens
       FROM keypool_gateway_request_logs WHERE ${cond} GROUP BY provider ORDER BY n DESC`
  )
    .bind(...args)
    .all();

  const byDay = await env.DB.prepare(
    `SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', '+8 hours') AS day, COUNT(*) AS n, COALESCE(SUM(ok),0) AS ok
       FROM keypool_gateway_request_logs WHERE ${cond} GROUP BY day ORDER BY day DESC LIMIT 14`
  )
    .bind(...args)
    .all();

  return {
    total: totals?.n ?? 0,
    ok: totals?.ok ?? 0,
    tokens: totals?.tokens ?? 0,
    byProvider: (byProvider.results ?? []) as unknown as Array<{ provider: string; n: number; ok: number; avg_latency: number; tokens: number }>,
    byDay: (byDay.results ?? []) as unknown as Array<{ day: string; n: number; ok: number }>,
  };
}

/**
 * Per-user usage leaderboard (last `sinceMs`): one row per caller, ranked by
 * request count. owner_sub NULL collapses into a single '管理员令牌' bucket.
 */
export async function usageByUser(
  env: Env,
  opts: { sinceMs: number; limit?: number }
): Promise<Array<{ owner_sub: string | null; owner_email: string | null; owner_name: string | null; n: number; ok: number; tokens: number; last_at: number }>> {
  const limit = opts.limit ?? 50;
  const res = await env.DB.prepare(
    `SELECT l.owner_sub,
            u.email AS owner_email, u.name AS owner_name,
            COUNT(*) AS n,
            COALESCE(SUM(l.ok),0) AS ok,
            COALESCE(SUM(l.total_tokens),0) AS tokens,
            MAX(l.created_at) AS last_at
       FROM keypool_gateway_request_logs l
       LEFT JOIN keypool_gateway_users u ON u.sub = l.owner_sub
      WHERE l.final = 1 AND l.created_at >= ?
      GROUP BY l.owner_sub
      ORDER BY n DESC
      LIMIT ?`
  )
    .bind(opts.sinceMs, limit)
    .all();
  return (res.results ?? []) as unknown as Array<{ owner_sub: string | null; owner_email: string | null; owner_name: string | null; n: number; ok: number; tokens: number; last_at: number }>;
}

/**
 * Per-model performance leaderboard from request logs (last `sinceMs`), so
 * consumers can pick a fast/reliable model. `n` counts final requests; `ok` the
 * successes. `avg_latency` is averaged over SUCCESSFUL requests only (failed
 * attempts carry misleading timings) and reflects responsiveness — for streamed
 * replies it is time-to-first-byte, for non-streamed the full round trip.
 * `avg_out` is the mean completion-token count of successful replies.
 */
export async function modelStats(
  env: Env,
  opts: { sinceMs: number; limit?: number }
): Promise<Array<{ model: string; provider: string; n: number; ok: number; avg_latency: number; avg_out: number; in_micro: number | null; out_micro: number | null; legacy_micro: number | null }>> {
  const limit = opts.limit ?? 100;
  // LEFT JOIN prices (≤1 row per model) so the leaderboard can show cost too;
  // the route applies the billing discount to turn market price into what the
  // consumer actually pays. MAX() keeps the price columns valid under GROUP BY.
  const res = await env.DB.prepare(
    `SELECT l.model,
            MAX(l.provider) AS provider,
            COUNT(*) AS n,
            COALESCE(SUM(l.ok),0) AS ok,
            COALESCE(AVG(CASE WHEN l.ok = 1 THEN l.latency_ms END), 0) AS avg_latency,
            COALESCE(AVG(CASE WHEN l.ok = 1 THEN l.completion_tokens END), 0) AS avg_out,
            MAX(p.input_per_mtok_micro) AS in_micro,
            MAX(p.output_per_mtok_micro) AS out_micro,
            MAX(p.price_per_mtok_micro) AS legacy_micro
       FROM keypool_gateway_request_logs l
       LEFT JOIN keypool_gateway_prices p ON p.model = l.model
      WHERE l.final = 1 AND l.created_at >= ? AND l.model IS NOT NULL AND l.model <> ''
      GROUP BY l.model
      HAVING n > 0
      ORDER BY (ok > 0) DESC, avg_latency ASC
      LIMIT ?`
  )
    .bind(opts.sinceMs, limit)
    .all();
  return (res.results ?? []) as unknown as Array<{ model: string; provider: string; n: number; ok: number; avg_latency: number; avg_out: number; in_micro: number | null; out_micro: number | null; legacy_micro: number | null }>;
}

/** Recent request rows. With `ownerSub`, scopes to one consumer; else global. */
export async function recentLogs(
  env: Env,
  opts: { ownerSub?: string; limit: number; offset?: number }
): Promise<Array<{ id: number; provider: string; model: string | null; status_code: number | null; latency_ms: number | null; ok: number; total_tokens: number | null; created_at: number; owner_sub: string | null; owner_email: string | null; owner_name: string | null }>> {
  const owner = opts.ownerSub ?? null;
  const offset = Math.max(0, opts.offset ?? 0);
  const where = owner ? "WHERE l.final = 1 AND l.owner_sub = ?" : "WHERE l.final = 1";
  const args: Array<number | string> = owner ? [owner, opts.limit, offset] : [opts.limit, offset];
  // LEFT JOIN users so the admin log view shows WHO sent each request (email/name),
  // not just the opaque OIDC subject. owner_sub NULL = admin-minted token (no user).
  const res = await env.DB.prepare(
    `SELECT l.id, l.provider, l.model, l.status_code, l.latency_ms, l.ok, l.total_tokens, l.created_at,
            l.owner_sub, u.email AS owner_email, u.name AS owner_name
       FROM keypool_gateway_request_logs l
       LEFT JOIN keypool_gateway_users u ON u.sub = l.owner_sub
       ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...args)
    .all();
  return (res.results ?? []) as unknown as Array<{ id: number; provider: string; model: string | null; status_code: number | null; latency_ms: number | null; ok: number; total_tokens: number | null; created_at: number; owner_sub: string | null; owner_email: string | null; owner_name: string | null }>;
}

/** Create an access token row. Returns the token string. */
export async function createToken(
  env: Env,
  opts: {
    name?: string;
    role?: Role;
    ownerSub?: string | null;
    expiresAt?: number | null;
    rpmLimit?: number | null;
    quotaRequests?: number | null;
  }
): Promise<{ token: string; name: string | null; role: Role }> {
  const token = generateToken();
  const name = opts.name ?? null;
  const role: Role = opts.role ?? "user";
  const ownerSub = opts.ownerSub ?? null;
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO keypool_gateway_access_tokens (token, name, role, owner_sub, enabled, expires_at, rpm_limit, quota_requests, used_requests, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0, ?)`
  )
    .bind(
      token,
      name,
      role,
      ownerSub,
      opts.expiresAt ?? null,
      opts.rpmLimit ?? null,
      opts.quotaRequests ?? null,
      now
    )
    .run();

  return { token, name, role };
}

/** Increment a token's lifetime request counter (after a successful call).
 *  The quota guard lives inside the same statement, so concurrent requests
 *  can't push used_requests past quota_requests. Returns false when the
 *  increment didn't happen (quota reached between check and increment). */
export async function incrementTokenUse(env: Env, tokenId: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE keypool_gateway_access_tokens SET used_requests = used_requests + 1 WHERE id = ? AND (quota_requests IS NULL OR used_requests < quota_requests)`
  )
    .bind(tokenId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Enforce a token's expiry / quota / rate limit. Called only for real token ids. */
export async function checkTokenLimits(
  env: Env,
  tokenId: number
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const row = await env.DB.prepare(
    `SELECT enabled, expires_at, rpm_limit, quota_requests, used_requests
       FROM keypool_gateway_access_tokens WHERE id = ?`
  )
    .bind(tokenId)
    .first<{ enabled: number; expires_at: number | null; rpm_limit: number | null; quota_requests: number | null; used_requests: number }>();
  if (!row) return { ok: false, status: 401, message: "token not found" };
  if (row.enabled === 0) return { ok: false, status: 403, message: "token disabled" };
  const now = Date.now();
  if (row.expires_at !== null && now > row.expires_at) {
    return { ok: false, status: 401, message: "token expired" };
  }
  if (row.quota_requests !== null && row.used_requests >= row.quota_requests) {
    return { ok: false, status: 429, message: "request quota exhausted" };
  }
  if (row.rpm_limit !== null) {
    const since = now - 60000;
    const cnt = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM keypool_gateway_request_logs WHERE token_id = ? AND final = 1 AND created_at >= ?`
    )
      .bind(tokenId, since)
      .first<{ n: number }>();
    if ((cnt?.n ?? 0) >= row.rpm_limit) {
      return { ok: false, status: 429, message: "rate limit exceeded (rpm)" };
    }
  }
  return { ok: true };
}

/** Tokens owned by a given SSO subject, newest first. Full token string included. */
export async function listTokensByOwner(
  env: Env,
  ownerSub: string
): Promise<Array<{ id: number; name: string | null; token: string; enabled: number; expires_at: number | null; rpm_limit: number | null; quota_requests: number | null; used_requests: number; created_at: number }>> {
  const res = await env.DB.prepare(
    `SELECT id, name, token, enabled, expires_at, rpm_limit, quota_requests, used_requests, created_at
       FROM keypool_gateway_access_tokens
      WHERE owner_sub = ?
      ORDER BY created_at DESC`
  )
    .bind(ownerSub)
    .all();
  return (res.results ?? []) as unknown as Array<{
    id: number;
    name: string | null;
    token: string;
    enabled: number;
    expires_at: number | null;
    rpm_limit: number | null;
    quota_requests: number | null;
    used_requests: number;
    created_at: number;
  }>;
}

/** Delete a token only if it is owned by ownerSub. Returns true if a row was removed. */
export async function deleteOwnedToken(env: Env, id: number, ownerSub: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `DELETE FROM keypool_gateway_access_tokens WHERE id = ? AND owner_sub = ?`
  )
    .bind(id, ownerSub)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Permanently remove an access token by id (admin; any owner). Returns true if a row was removed. */
export async function deleteToken(env: Env, id: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `DELETE FROM keypool_gateway_access_tokens WHERE id = ?`
  )
    .bind(id)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Disable (enabled=0) every token owned by ownerSub. */
export async function disableTokensByOwner(env: Env, ownerSub: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE keypool_gateway_access_tokens SET enabled = 0 WHERE owner_sub = ?`
  )
    .bind(ownerSub)
    .run();
}

export interface UserRow {
  id: number;
  sub: string;
  email: string | null;
  name: string | null;
  role: Role;
  status: "pending" | "approved" | "blocked";
  created_at: number;
  approved_at: number | null;
}

/**
 * Insert or update a user keyed on OIDC `sub`.
 *  - Admins (isAdmin) are auto-approved with role='admin' and approved_at stamped.
 *  - On conflict, email/name are refreshed; the role follows THIS login (a
 *    former admin who no longer matches ADMIN_EMAIL is demoted to 'user' —
 *    the old "role never downgrades" rule left revoked admins as admins);
 *    an already-approved user keeps status 'approved'.
 * Returns the resulting row.
 */
export async function upsertUser(
  env: Env,
  u: { sub: string; email: string | null; name: string | null; isAdmin: boolean }
): Promise<UserRow> {
  const now = Date.now();
  const role: Role = u.isAdmin ? "admin" : "user";
  const status: UserRow["status"] = u.isAdmin ? "approved" : "pending";
  const approvedAt: number | null = u.isAdmin ? now : null;

  await env.DB.prepare(
    `INSERT INTO keypool_gateway_users (sub, email, name, role, status, created_at, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sub) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       role = excluded.role,
       status = CASE
         WHEN excluded.status = 'approved' THEN 'approved'
         WHEN keypool_gateway_users.status = 'approved' THEN 'approved'
         ELSE keypool_gateway_users.status
       END,
       approved_at = CASE
         WHEN excluded.approved_at IS NOT NULL AND keypool_gateway_users.approved_at IS NULL
           THEN excluded.approved_at
         ELSE keypool_gateway_users.approved_at
       END`
  )
    .bind(u.sub, u.email, u.name, role, status, now, approvedAt)
    .run();

  const row = await getUserBySub(env, u.sub);
  if (!row) {
    throw new Error("upsertUser: row missing after upsert");
  }
  return row;
}

/** Look up a user by OIDC subject. Returns null if absent. */
export async function getUserBySub(env: Env, sub: string): Promise<UserRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, sub, email, name, role, status, created_at, approved_at
       FROM keypool_gateway_users WHERE sub = ?`
  )
    .bind(sub)
    .first<UserRow>();
  return row ?? null;
}

/** All users: pending first, then approved, then blocked; newest first within each group. Capped at 1000. */
export async function listUsers(env: Env): Promise<UserRow[]> {
  const res = await env.DB.prepare(
    `SELECT id, sub, email, name, role, status, created_at, approved_at
       FROM keypool_gateway_users
      ORDER BY
        CASE status
          WHEN 'pending' THEN 0
          WHEN 'approved' THEN 1
          WHEN 'blocked' THEN 2
          ELSE 3
        END,
        created_at DESC
      LIMIT 1000`
  ).all();
  return (res.results ?? []) as unknown as UserRow[];
}

/**
 * Set a user's status by id. Stamps approved_at when transitioning to 'approved'.
 * Returns the user's sub, or null if no such user.
 */
export async function setUserStatus(
  env: Env,
  id: number,
  status: "approved" | "blocked" | "pending"
): Promise<string | null> {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE keypool_gateway_users
       SET status = ?,
           approved_at = CASE
             WHEN ? = 'approved' THEN ?
             ELSE approved_at
           END
     WHERE id = ?`
  )
    .bind(status, status, now, id)
    .run();

  const row = await env.DB.prepare(
    `SELECT sub FROM keypool_gateway_users WHERE id = ?`
  )
    .bind(id)
    .first<{ sub: string }>();
  return row ? row.sub : null;
}

/** List access tokens (do not expose ADMIN_TOKEN — it isn't stored here). Capped at 1000. */
export async function listTokens(
  env: Env
): Promise<Array<{ id: number; name: string | null; role: Role; owner_sub: string | null; enabled: number; expires_at: number | null; rpm_limit: number | null; quota_requests: number | null; used_requests: number; created_at: number }>> {
  const res = await env.DB.prepare(
    `SELECT id, name, role, owner_sub, enabled, expires_at, rpm_limit, quota_requests, used_requests, created_at FROM keypool_gateway_access_tokens ORDER BY created_at DESC LIMIT 1000`
  ).all();
  return (res.results ?? []) as unknown as Array<{
    id: number;
    name: string | null;
    role: Role;
    owner_sub: string | null;
    enabled: number;
    expires_at: number | null;
    rpm_limit: number | null;
    quota_requests: number | null;
    used_requests: number;
    created_at: number;
  }>;
}

/** Counts grouped by provider+status, plus per-provider active counts. For /admin/keys + /healthz. */
export async function statsSummary(env: Env): Promise<{
  byProviderStatus: Array<{ provider: string; service_slug: string | null; status: string; n: number }>;
  totals: { active: number; cooldown: number; disabled: number };
}> {
  // Group by provider AND service slug: custom services are separate
  // providers in practice (different base URL, different models), and
  // grouping by provider alone collapses them into one "custom" row.
  const res = await env.DB.prepare(
    `SELECT provider, service_slug, status, COUNT(*) AS n
       FROM keypool_gateway_api_keys
      GROUP BY provider, service_slug, status`
  ).all();

  const rows = (res.results ?? []) as unknown as Array<{
    provider: string;
    service_slug: string | null;
    status: string;
    n: number;
  }>;

  const totals = { active: 0, cooldown: 0, disabled: 0 };
  for (const r of rows) {
    if (r.status === "active") totals.active += r.n;
    else if (r.status === "cooldown") totals.cooldown += r.n;
    else if (r.status === "disabled") totals.disabled += r.n;
  }

  return { byProviderStatus: rows, totals };
}

// ── Feature B: billing (balance + pricing + deduct + admin top-up) ──────────

/** Billing is enforced only when BILLING_ENABLED === "1". */
export function billingEnabled(env: Env): boolean {
  return env.BILLING_ENABLED === "1";
}

/** Global sell discount on market prices (e.g. 0.1 = 1折). Default 1 (no discount).
 *  Clamped to (0, 1]: a value above 1 would silently charge MORE than list price. */
export function billingDiscount(env: Env): number {
  const d = Number(env.DISCOUNT);
  return Number.isFinite(d) && d > 0 && d <= 1 ? d : 1;
}

/** A consumer's credit balance in micro-USD. Returns 0 if no user row exists. */
export async function getBalanceMicro(env: Env, sub: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT balance_micro FROM keypool_gateway_users WHERE sub = ?`
  )
    .bind(sub)
    .first<{ balance_micro: number }>();
  return row ? row.balance_micro : 0;
}

/**
 * Split input/output price (micro-USD per 1M tokens) for a model. Reads
 * input_per_mtok_micro / output_per_mtok_micro from the prices table, falling
 * back each side to the legacy price_per_mtok_micro, then to the configured
 * DEFAULT_PRICE_MICRO (default 500000).
 */
export async function priceForModel(
  env: Env,
  model: string | null
): Promise<{ input: number; output: number }> {
  const fallback = defaultPriceMicro(env);
  if (model) {
    // Exact match first (legacy rows stored verbatim), then the normalized key.
    const keys = [model, normalizeModelKey(model)];
    for (const key of [...new Set(keys)]) {
      const row = await env.DB.prepare(
        `SELECT input_per_mtok_micro, output_per_mtok_micro, price_per_mtok_micro
           FROM keypool_gateway_prices WHERE model = ?`
      )
        .bind(key)
        .first<{
          input_per_mtok_micro: number | null;
          output_per_mtok_micro: number | null;
          price_per_mtok_micro: number | null;
        }>();
      if (row) {
        const legacy = row.price_per_mtok_micro ?? fallback;
        return {
          input: row.input_per_mtok_micro ?? legacy,
          output: row.output_per_mtok_micro ?? legacy,
        };
      }
    }
  }
  return { input: fallback, output: fallback };
}

/**
 * Deduct the cost of a usage event from a consumer's balance and record a
 * 'charge' transaction. No-op unless billing is on, `sub` is present, and at
 * least one token was used. Input and output tokens are priced separately:
 *   cost = round(promptTokens * input / 1e6) + round(completionTokens * output / 1e6).
 * `estimated` flags charges derived from char-count estimation (no upstream usage).
 */
export async function chargeForUsage(
  env: Env,
  sub: string | null,
  model: string | null,
  promptTokens: number,
  completionTokens: number,
  estimated: boolean
): Promise<void> {
  if (!billingEnabled(env) || !sub || promptTokens + completionTokens <= 0) return;

  const p = await priceForModel(env, model);
  // prices are MARKET list price; a global DISCOUNT (0.1 = 1折) is what we sell at.
  const discount = billingDiscount(env);
  // Minimum 1 micro per charged request: a cheap model (e.g. glm-4-flash) whose
  // small request would otherwise round down to 0 still costs something.
  const cost = Math.max(
    1,
    Math.round(
      ((promptTokens * p.input) / 1_000_000 + (completionTokens * p.output) / 1_000_000) * discount
    )
  );

  // Atomic, inside one D1 batch (one transaction): the debit and the txn row
  // land together, and the txn's balance_after is read from the balance AFTER
  // the debit — no read-then-write race, no stale balance_after. A missing
  // user writes no txn row (the INSERT ... SELECT simply matches nothing).
  const stmts = [
    env.DB.prepare(
      `UPDATE keypool_gateway_users SET balance_micro = balance_micro - ? WHERE sub = ?`
    ).bind(cost, sub),
    env.DB.prepare(
      `INSERT INTO keypool_gateway_transactions (sub, kind, amount_micro, balance_after_micro, model, tokens, note, estimated, created_at)
         SELECT ?, 'charge', ?, balance_micro, ?, ?, NULL, ?, ? FROM keypool_gateway_users WHERE sub = ?`
    ).bind(sub, -cost, model, promptTokens + completionTokens, estimated ? 1 : 0, Date.now(), sub),
  ];
  await env.DB.batch(stmts);
}

/**
 * Conservative upper bound on a request's cost (micro-USD, discount applied),
 * priced at the OUTPUT rate for both prompt + the model's max output. Used to
 * pre-authorize (hold) before dispatch so concurrent requests can't overspend.
 */
export async function estimateMaxCostMicro(
  env: Env,
  model: string | null,
  promptChars: number,
  maxTokens: number | null
): Promise<number> {
  const p = await priceForModel(env, model);
  const promptTokens = Math.ceil((promptChars || 0) / 4);
  const outTokens = maxTokens && maxTokens > 0 ? maxTokens : 4096; // default cap
  const micro = ((promptTokens + outTokens) * p.output) / 1_000_000;
  return Math.max(1, Math.round(micro * billingDiscount(env)));
}

/**
 * Atomically reserve (hold) `micro` from a consumer's balance. The conditional
 * `balance_micro >= ?` makes this the concurrency-safe overspend gate: only
 * requests with enough balance succeed, even under simultaneous fire. Returns
 * false (no deduction) when the balance is insufficient.
 */
export async function reserveBalance(env: Env, sub: string, micro: number): Promise<boolean> {
  if (micro <= 0) return true;
  const res = await env.DB.prepare(
    `UPDATE keypool_gateway_users SET balance_micro = balance_micro - ?
       WHERE sub = ? AND balance_micro >= ?`
  )
    .bind(micro, sub, micro)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Total charged (spent) micro-USD for a consumer — sum of 'charge' txns. */
export async function getChargeTotalMicro(env: Env, sub: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_micro),0) AS spent FROM keypool_gateway_transactions WHERE sub = ? AND kind = 'charge'`
  )
    .bind(sub)
    .first<{ spent: number }>();
  return row?.spent ?? 0;
}

/** Return a previously-reserved hold (atomic add-back). Always best-effort. */
export async function refundBalance(env: Env, sub: string, micro: number): Promise<void> {
  if (micro <= 0) return;
  try {
    await env.DB.prepare(
      `UPDATE keypool_gateway_users SET balance_micro = balance_micro + ? WHERE sub = ?`
    )
      .bind(micro, sub)
      .run();
  } catch {
    // best-effort refund
  }
}

/**
 * Credit a consumer's balance by `amountMicro`, record a 'topup' transaction,
 * and return the new balance (micro-USD).
 */
export async function topUpMicro(
  env: Env,
  sub: string,
  amountMicro: number,
  note: string | null,
  idempotentNote?: string | null
): Promise<number> {
  if (!Number.isFinite(amountMicro) || amountMicro <= 0) throw new Error("invalid amount");
  // Atomic, inside one D1 batch (one transaction): credit + txn row land
  // together, balance_after read from the post-credit balance.
  // idempotentNote (Stripe webhook retries, OIDC signup bonus): the whole
  // credit is skipped if a topup txn with that note already exists for this
  // sub, so a retried event can't credit twice. The stored note IS the
  // idempotency key when one is given — the NOT EXISTS guard matches on
  // note, so storing a different display note would make the guard miss
  // its own rows and double-credit on retry.
  const storedNote = idempotentNote ?? note;
  const guard = idempotentNote
    ? ` AND NOT EXISTS (SELECT 1 FROM keypool_gateway_transactions t WHERE t.sub = ? AND t.kind = 'topup' AND t.note = ?)`
    : "";
  const guardBinds: (string | number)[] = idempotentNote ? [sub, idempotentNote] : [];
  const stmts = [
    env.DB.prepare(
      `UPDATE keypool_gateway_users SET balance_micro = balance_micro + ? WHERE sub = ?${guard}`
    ).bind(amountMicro, sub, ...guardBinds),
    env.DB.prepare(
      `INSERT INTO keypool_gateway_transactions (sub, kind, amount_micro, balance_after_micro, model, tokens, note, created_at)
         SELECT ?, 'topup', ?, balance_micro, NULL, NULL, ?, ? FROM keypool_gateway_users WHERE sub = ?${guard}`
    ).bind(sub, amountMicro, storedNote, Date.now(), sub, ...guardBinds),
  ];
  const results = await env.DB.batch(stmts);
  const inserted = results[1].meta?.changes ?? 0;
  if (inserted === 0) {
    // No txn row: either the user doesn't exist, or (idempotent mode) this
    // credit already landed. Tell them apart so a wrong sub fails loudly.
    const user = await env.DB.prepare(`SELECT balance_micro FROM keypool_gateway_users WHERE sub = ?`).bind(sub).first<{ balance_micro: number }>();
    if (!user) throw new Error("user not found");
    return user.balance_micro;
  }
  return await getBalanceMicro(env, sub);
}

/** Recent transactions, newest first. With `sub`, scopes to one consumer. */
export async function listTransactions(
  env: Env,
  opts: { sub?: string; limit: number }
): Promise<Array<{ id: number; sub: string; kind: string; amount_micro: number; balance_after_micro: number; model: string | null; tokens: number | null; note: string | null; estimated: number; created_at: number; owner_email: string | null; owner_name: string | null }>> {
  const sub = opts.sub ?? null;
  // LEFT JOIN users so the admin 计费 view shows WHO consumed (email/name), not just
  // the opaque OIDC subject. NULL email = an admin-minted token (no signed-in user).
  const where = sub ? "WHERE t.sub = ?" : "";
  const args: Array<number | string> = sub ? [sub, opts.limit] : [opts.limit];
  const res = await env.DB.prepare(
    `SELECT t.id, t.sub, t.kind, t.amount_micro, t.balance_after_micro, t.model, t.tokens, t.note, t.estimated, t.created_at,
            u.email AS owner_email, u.name AS owner_name
       FROM keypool_gateway_transactions t
       LEFT JOIN keypool_gateway_users u ON u.sub = t.sub
       ${where} ORDER BY t.created_at DESC LIMIT ?`
  )
    .bind(...args)
    .all();
  return (res.results ?? []) as unknown as Array<{ id: number; sub: string; kind: string; amount_micro: number; balance_after_micro: number; model: string | null; tokens: number | null; note: string | null; estimated: number; created_at: number; owner_email: string | null; owner_name: string | null }>;
}

/** All users with their balances (admin overview), highest balance first. Capped at 1000. */
export async function listBalances(
  env: Env
): Promise<Array<{ sub: string; email: string | null; balance_micro: number }>> {
  const res = await env.DB.prepare(
    `SELECT sub, email, balance_micro FROM keypool_gateway_users ORDER BY balance_micro DESC LIMIT 1000`
  ).all();
  return (res.results ?? []) as unknown as Array<{ sub: string; email: string | null; balance_micro: number }>;
}

// ── Agent A: model-level availability + gemini project tagging ──────────────

/**
 * Models currently marked unavailable (the BLOCKED set). The caller treats any
 * model NOT in this set as available, so a never-probed model is available by
 * default.
 */
export async function availableModelSet(env: Env): Promise<Set<string>> {
  const res = await env.DB.prepare(
    `SELECT model FROM keypool_gateway_model_status WHERE available = 0`
  ).all();
  const set = new Set<string>();
  for (const r of (res.results ?? []) as unknown as Array<{ model: string }>) {
    set.add(r.model);
  }
  return set;
}

/** Models explicitly marked available (added via live fetch, or probed alive).
 * The static adapter lists can't know these ids, so servableModels unions
 * this set in — otherwise a model added from a live fetch would never show
 * up in /v1/models even though chat can already serve it. */
export async function listAvailableModels(
  env: Env
): Promise<Array<{ model: string; provider: string }>> {
  const res = await env.DB.prepare(
    `SELECT model, provider FROM keypool_gateway_model_status WHERE available = 1`
  ).all();
  return (res.results ?? []) as unknown as Array<{ model: string; provider: string }>;
}

/** Upsert a model's availability status. last_checked = now (epoch-ms). */
export async function setModelStatus(
  env: Env,
  model: string,
  provider: string,
  available: boolean,
  reason: string | null
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO keypool_gateway_model_status (model, provider, available, last_checked, reason)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(model) DO UPDATE SET
       provider = excluded.provider,
       available = excluded.available,
       last_checked = excluded.last_checked,
       reason = excluded.reason`
  )
    .bind(model, provider, available ? 1 : 0, now, reason)
    .run();
}

/**
 * Batch variant of setModelStatus for bulk imports: one sequential
 * setModelStatus per model turned a 453-model import (POST /keys/add) into
 * 453 D1 round-trips (~5-10s — the import modal sat open with no feedback
 * while the request was still running). Same upsert, chunked into D1
 * batches of 50, lands in ~10 round-trips. A no-op for an empty list.
 */
export async function setModelStatusBatch(
  env: Env,
  entries: { model: string; provider: string; available: boolean; reason: string | null }[]
): Promise<void> {
  const CHUNK = 50;
  const now = Date.now();
  for (let i = 0; i < entries.length; i += CHUNK) {
    const stmts = entries.slice(i, i + CHUNK).map((e) =>
      env.DB.prepare(
        `INSERT INTO keypool_gateway_model_status (model, provider, available, last_checked, reason)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(model) DO UPDATE SET
           provider = excluded.provider,
           available = excluded.available,
           last_checked = excluded.last_checked,
           reason = excluded.reason`
      ).bind(e.model, e.provider, e.available ? 1 : 0, now, e.reason)
    );
    await env.DB.batch(stmts);
  }
}

/** Every model-status row (admin view). */
export async function listModelStatus(
  env: Env
): Promise<Array<{ model: string; provider: string; available: number; last_checked: number | null; reason: string | null }>> {
  const res = await env.DB.prepare(
    `SELECT model, provider, available, last_checked, reason
       FROM keypool_gateway_model_status
      ORDER BY available ASC, provider ASC, model ASC`
  ).all();
  return (res.results ?? []) as unknown as Array<{ model: string; provider: string; available: number; last_checked: number | null; reason: string | null }>;
}

/** Tag a key with the Google project number parsed from a probe response. */
export async function setKeyProjectId(env: Env, keyId: number, projectId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE keypool_gateway_api_keys SET project_id = ? WHERE id = ?`
  )
    .bind(projectId, keyId)
    .run();
}

/** Persist a key's last-probed upstream balance (providers that expose one). */
export async function setKeyBalance(
  env: Env,
  keyId: number,
  remaining: number | null,
  unit: string | null
): Promise<void> {
  await env.DB.prepare(
    `UPDATE keypool_gateway_api_keys SET balance_remaining = ?, balance_unit = ? WHERE id = ?`
  )
    .bind(remaining, unit, keyId)
    .run();
}

/** Any one active key's plaintext api_key for a provider, or null if none. */
export async function oneActiveKey(env: Env, provider: Provider): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT api_key FROM keypool_gateway_api_keys WHERE provider = ? AND status = 'active' LIMIT 1`
  )
    .bind(provider)
    .first<{ api_key: string }>();
  return row ? row.api_key : null;
}
