/** Cron body: revive expired cooldowns + probe disabled keys back to health. */

import type { Env } from "./types";
import { reviveExpiredCooldowns, listDisabledForProbe, reactivateKey, setKeyBalance, setKeyProjectId } from "./db";
import { probeKey } from "./probe";

/** Default minutes between cron probes of a single disabled key. */
const DEFAULT_PROBE_INTERVAL_MINUTES = 60;

/** Max disabled keys to probe in a single cron tick (keep the run cheap). */
const PROBE_BATCH_LIMIT = 20;

function probeIntervalMs(env: Env): number {
  const raw = env.PROBE_INTERVAL_MINUTES;
  const minutes = raw != null ? Number.parseInt(raw, 10) : NaN;
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_PROBE_INTERVAL_MINUTES;
  return safe * 60000;
}

/**
 * Bump a disabled key's `last_used_at` so `listDisabledForProbe` backs it off
 * until the next probe interval. Best-effort; never throws.
 */
async function backOffKey(env: Env, keyId: number, now: number): Promise<void> {
  try {
    await env.DB.prepare(`UPDATE keypool_gateway_api_keys SET last_used_at = ? WHERE id = ?`)
      .bind(now, keyId)
      .run();
  } catch {
    // Backing off is best-effort; a failed write just means it retries sooner.
  }
}

/**
 * Runs on the cron trigger.
 *  1) reviveExpiredCooldowns(env, now)
 *  2) for each disabled key eligible for a probe, run the real probeKey
 *     (chat/balance check — the old GET /models probe LIED: it returns 200
 *     for suspended/arrears accounts, so dead keys kept "reviving").
 *     2xx-alive -> reactivateKey, else back off. Balance and project id from
 *     the probe are persisted so the admin page shows fresh numbers.
 * Each probe is wrapped in try/catch; this never throws out of scheduled().
 */
export async function runHealthCheck(
  env: Env
): Promise<{ revived: number; probed: number; reactivated: number }> {
  const now = Date.now();

  let revived = 0;
  try {
    revived = await reviveExpiredCooldowns(env, now);
  } catch {
    // A failed revive sweep must not abort the probe phase.
  }

  let probed = 0;
  let reactivated = 0;

  let candidates: Awaited<ReturnType<typeof listDisabledForProbe>> = [];
  try {
    candidates = await listDisabledForProbe(env, now, probeIntervalMs(env), PROBE_BATCH_LIMIT);
  } catch {
    candidates = [];
  }

  for (const key of candidates) {
    probed++;
    try {
      const r = await probeKey(key.provider, key.api_key);
      if (r.projectId) await setKeyProjectId(env, key.id, r.projectId);
      if (r.balance && r.balance.remaining != null) {
        await setKeyBalance(env, key.id, r.balance.remaining, r.balance.unit);
      }
      if (r.alive && !r.rateLimited) {
        await reactivateKey(env, key.id);
        reactivated++;
      } else {
        await backOffKey(env, key.id, now);
      }
    } catch {
      // Network error / probe throw: treat as still-unhealthy and back off.
      await backOffKey(env, key.id, now);
    }
  }

  return { revived, probed, reactivated };
}
