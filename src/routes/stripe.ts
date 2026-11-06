/**
 * Stripe webhook (NO auth) — credits a user's balance after a completed
 * Checkout Session. Mounted at `/stripe`, so the live endpoint is
 * `POST /stripe/webhook`.
 *
 * Verifies the `Stripe-Signature` header per Stripe's scheme
 * (`t=<ts>,v1=<sig>`; signedPayload = `${t}.${rawBody}`; expected =
 * HMAC-SHA256(STRIPE_WEBHOOK_SECRET, signedPayload) in hex), is idempotent
 * via the payment_events table, and tops up on
 * `checkout.session.completed`.
 */

import { Hono } from "hono";
import type { Env } from "../types";
import { topUpMicro } from "../db";

// ---------- HMAC-SHA256 hex (WebCrypto), mirroring oidc.ts ----------

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))
  );
  return toHex(sig);
}

/** Constant-time compare of two equal-length hex strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Parse a `t=<ts>,v1=<sig>` Stripe-Signature header. Stripe can send
 *  MULTIPLE v1 signatures (secret rotation) — collect them all. */
function parseSignatureHeader(header: string): { t: string; v1s: string[] } | null {
  let t: string | null = null;
  const v1s: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1" && v) v1s.push(v);
  }
  if (!t || v1s.length === 0) return null;
  return { t, v1s };
}

// ---------- event shapes ----------

interface StripeEvent {
  id?: string;
  type?: string;
  data?: {
    object?: {
      payment_status?: string;
      amount_total?: number; // settled amount, in the currency's minor unit (cents)
      currency?: string;
      metadata?: { sub?: string; amount_micro?: string } | null;
    } | null;
  } | null;
}

/** Reject events whose signature timestamp is too old/new (replay defense). */
const SIG_TOLERANCE_SEC = 300;

// ---------- route ----------

const app = new Hono<{ Bindings: Env }>();

app.post("/webhook", async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return c.text("webhook not configured", 400);

  const rawBody = await c.req.text();
  const sigHeader = c.req.header("stripe-signature");
  if (!sigHeader) return c.text("missing signature", 400);

  const parsed = parseSignatureHeader(sigHeader);
  if (!parsed) return c.text("invalid signature", 400);

  const expected = await hmacHex(secret, `${parsed.t}.${rawBody}`);
  // Accept if ANY v1 signature matches (Stripe sends several during secret
  // rotation — the old code only checked the first and rejected the rest).
  if (!parsed.v1s.some((v1) => timingSafeEqual(expected, v1))) {
    return c.text("invalid signature", 400);
  }

  // Replay defense: the signed timestamp must be within tolerance of now.
  const ts = Number(parsed.t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIG_TOLERANCE_SEC) {
    return c.text("signature timestamp out of tolerance", 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return c.text("invalid payload", 400);
  }

  if (event.type === "checkout.session.completed") {
    // An event without an id can't be deduped — reject it rather than
    // crediting blindly (a retried id-less event would double-credit).
    const eventId = event.id;
    if (!eventId) return c.text("missing event id", 400);

    // Already processed (including events handled before the idempotent
    // topUp guard existed) — ack without re-crediting.
    const seen = await c.env.DB.prepare(
      `SELECT 1 AS one FROM keypool_gateway_payment_events WHERE event_id = ?`
    )
      .bind(eventId)
      .first<{ one: number }>();
    if (seen) return c.json({ received: true });

    const obj = event.data?.object ?? null;
    // Only credit a settled payment. Async methods fire this event with
    // payment_status 'unpaid'/'no_payment_required' before money lands.
    if (obj && obj.payment_status === "paid") {
      const sub = obj.metadata?.sub;
      // Only USD sessions are ever created (see /me/checkout) — a session
      // in another currency must not be credited at the USD rate.
      const currency = typeof obj.currency === "string" ? obj.currency.toLowerCase() : "";
      // Trust the SETTLED amount (amount_total is minor units = cents), not the
      // client-supplied metadata. micro-USD = cents * 10_000.
      const amountMicro =
        typeof obj.amount_total === "number" ? Math.round(obj.amount_total * 10000) : NaN;
      if (sub && currency === "usd" && Number.isFinite(amountMicro) && amountMicro > 0) {
        // Credit FIRST, idempotently (note `stripe:<eventId>`): if the worker
        // dies after the credit but before the event row lands, a Stripe
        // retry re-runs this and the NOT EXISTS guard skips the second credit.
        // The old order (insert event row, then credit) could lose the credit
        // entirely on a crash between the two writes.
        try {
          await topUpMicro(c.env, sub, amountMicro, "stripe: " + eventId, "stripe:" + eventId);
        } catch (err) {
          if (err instanceof Error && err.message === "user not found") {
            // Unknown sub: record the event so Stripe stops retrying, and
            // surface it — the money needs a manual credit, not a retry loop.
            await c.env.DB.prepare(
              `INSERT OR IGNORE INTO keypool_gateway_payment_events (event_id, created_at) VALUES (?, ?)`
            )
              .bind(eventId, Date.now())
              .run();
            return c.json({ received: true, error: "user not found" });
          }
          throw err;
        }
      }
    }
    // Record the event as processed (dedup for any future retry).
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO keypool_gateway_payment_events (event_id, created_at) VALUES (?, ?)`
    )
      .bind(eventId, Date.now())
      .run();
  }

  return c.json({ received: true });
});

export default app;
