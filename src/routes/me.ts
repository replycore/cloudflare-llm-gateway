/**
 * Consumer self-service routes. Mounted at `/me`.
 *
 * Auth is a valid SSO session cookie (via `getSession`), NOT a bearer token.
 * Approved users can list, mint, and delete their own access tokens; pending
 * or blocked users are gated out of minting with a 403.
 */

import { Hono } from "hono";
import type { Env } from "../types";
import { getSession } from "../oidc";
import {
  listTokensByOwner,
  createToken,
  deleteOwnedToken,
  getUserBySub,
  usageSummary,
  recentLogs,
  getBalanceMicro,
  listTransactions,
  modelStats,
  billingDiscount,
  resolveTokenFull,
  defaultPriceMicro,
} from "../db";

const app = new Hono<{ Bindings: Env }>();

type MeIdentity = { sub: string; via: "session" | "token" };

function unauth(): Response {
  return new Response(JSON.stringify({ error: { message: "未登录", type: "unauthorized" } }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

/** Bearer-token identity (for read routes + checkout): an admin bearer maps
 *  to the synthetic sub "admin-token" (read-only preview; checkout rejects it
 *  — it isn't a real user, so a payment under it could never be credited);
 *  a user token maps to its owner, gated on that user being approved. */
async function bearerIdentity(env: Env, req: Request): Promise<MeIdentity | null> {
  const auth = req.headers.get("authorization");
  const m = auth ? /^\s*Bearer\s+(.+)\s*$/i.exec(auth) : null;
  const token = m?.[1]?.trim();
  if (!token) return null;
  const full = await resolveTokenFull(env, token);
  if (!full) return null;
  if (full.role === "admin") return { sub: "admin-token", via: "token" };
  if (!full.ownerSub) return null;
  const u = await getUserBySub(env, full.ownerSub);
  if (!u || u.status !== "approved") return null;
  return { sub: full.ownerSub, via: "token" };
}

/** SSO-session identity, gated on the user being approved. */
async function sessionIdentity(env: Env, req: Request): Promise<MeIdentity | null> {
  const sess = await getSession(env, req);
  if (!sess) return null;
  const u = await getUserBySub(env, sess.sub);
  if (!u || u.status !== "approved") return null;
  return { sub: sess.sub, via: "session" };
}

/** Either identity: session first, then bearer token. */
async function anyIdentity(env: Env, req: Request): Promise<MeIdentity | null> {
  return (await sessionIdentity(env, req)) ?? (await bearerIdentity(env, req));
}

/** List the caller's own tokens (full token strings — they're the owner). */
app.get("/tokens", async (c) => {
  // Token management stays session-only (a bearer token must not be able
  // to list tokens, which would leak full token strings).
  const session = await getSession(c.env, c.req.raw);
  if (!session) return unauth();
  const user = await getUserBySub(c.env, session.sub);
  if (!user || user.status !== "approved") {
    return c.json({ error: { message: "账号待开通,请联系管理员", type: "not_approved" } }, 403);
  }
  const tokens = await listTokensByOwner(c.env, session.sub);
  // Bare array — matches the admin /tokens shape and what the console expects.
  return c.json(tokens);
});

/** Mint a token for the caller. Requires an approved account. */
app.post("/tokens", async (c) => {
  const session = await getSession(c.env, c.req.raw);
  if (!session) {
    return c.json({ error: { message: "未登录", type: "unauthorized" } }, 401);
  }

  const user = await getUserBySub(c.env, session.sub);
  if (!user || user.status !== "approved") {
    return c.json(
      {
        error: { message: "账号待开通,请联系管理员", type: "not_approved" },
      },
      403
    );
  }

  let name: string | undefined;
  try {
    const body = (await c.req.json()) as { name?: unknown } | null;
    if (body && typeof body.name === "string") name = body.name.slice(0, 100);
  } catch {
    // empty / invalid body → unnamed token
  }

  const created = await createToken(c.env, {
    name,
    role: "user",
    ownerSub: session.sub,
  });
  return c.json({ token: created.token, name: created.name });
});

/** Delete one of the caller's own tokens. 404 if not owned. */
app.delete("/tokens/:id", async (c) => {
  const session = await getSession(c.env, c.req.raw);
  if (!session) return unauth();
  const user = await getUserBySub(c.env, session.sub);
  if (!user || user.status !== "approved") {
    return c.json({ error: { message: "账号待开通,请联系管理员", type: "not_approved" } }, 403);
  }

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) {
    return c.json({ error: { message: "无效的令牌 ID", type: "bad_request" } }, 400);
  }

  const ok = await deleteOwnedToken(c.env, id, session.sub);
  if (!ok) {
    return c.json({ error: { message: "令牌不存在", type: "not_found" } }, 404);
  }
  return c.json({ ok: true });
});

// GET /usage — the caller's own usage aggregates (last 30 days).
app.get("/usage", async (c) => {
  // Read routes accept a bearer token too (admin-token preview works here);
  // a blocked/pending user is gated out either way.
  const me = await anyIdentity(c.env, c.req.raw);
  if (!me) return unauth();
  const session = me;
  const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return c.json(await usageSummary(c.env, { ownerSub: session.sub, sinceMs }));
});

// GET /logs — the caller's own recent requests.
app.get("/logs", async (c) => {
  const me = await anyIdentity(c.env, c.req.raw);
  if (!me) return unauth();
  const session = me;
  return c.json(await recentLogs(c.env, { ownerSub: session.sub, limit: 50 }));
});

// GET /model-stats — global per-model performance leaderboard (last 7 days), so a
// consumer can pick a fast/reliable model. Aggregate-only (no per-user identity).
app.get("/model-stats", async (c) => {
  const me = await anyIdentity(c.env, c.req.raw);
  if (!me) return unauth();
  const session = me;
  const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows = await modelStats(c.env, { sinceMs, limit: 100 });
  // Apply the billing discount so the price columns show what the consumer pays
  // (micro-USD per 1M tokens). Fall back input/output → legacy → DEFAULT_PRICE.
  const discount = billingDiscount(c.env);
  const fallback = defaultPriceMicro(c.env);
  const out = rows.map((r) => {
    const legacy = r.legacy_micro ?? fallback;
    const priceInMicro = Math.round((r.in_micro ?? legacy) * discount);
    const priceOutMicro = Math.round((r.out_micro ?? legacy) * discount);
    return {
      model: r.model,
      provider: r.provider,
      n: r.n,
      ok: r.ok,
      avg_latency: r.avg_latency,
      avg_out: r.avg_out,
      price_in_micro: priceInMicro,
      price_out_micro: priceOutMicro,
    };
  });
  return c.json(out);
});

// GET /balance — the caller's own balance in micro-USD.
app.get("/balance", async (c) => {
  const me = await anyIdentity(c.env, c.req.raw);
  if (!me) return unauth();
  const session = me;
  return c.json({ balance_micro: await getBalanceMicro(c.env, session.sub) });
});

// GET /transactions — the caller's own billing transactions.
app.get("/transactions", async (c) => {
  const me = await anyIdentity(c.env, c.req.raw);
  if (!me) return unauth();
  const session = me;
  return c.json(await listTransactions(c.env, { sub: session.sub, limit: 50 }));
});

// POST /checkout — start a Stripe Checkout Session to top up credit.
app.post("/checkout", async (c) => {
  const session = await anyIdentity(c.env, c.req.raw);
  if (!session) return unauth();

  // The admin-token preview identity ("admin-token") is not a real user: a
  // checkout under it would take the money and the webhook could never
  // credit it (no such user row). Block it here instead of after payment.
  if (session.sub === "admin-token") {
    return c.json(
      { error: { message: "管理员预览账号不支持充值，请用网页登录后充值", type: "bad_request" } },
      400
    );
  }

  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json(
      { error: { message: "payment not configured", type: "not_configured" } },
      503
    );
  }

  let amountUsd = 0;
  try {
    const body = (await c.req.json()) as { amount_usd?: unknown } | null;
    if (body && typeof body.amount_usd === "number") amountUsd = body.amount_usd;
  } catch {
    // invalid body → amountUsd stays 0 and fails the check below
  }
  if (!Number.isFinite(amountUsd) || amountUsd < 0.5 || amountUsd > 10000) {
    return c.json(
      { error: { message: "金额需在 0.5 到 10000 美元之间", type: "bad_request" } },
      400
    );
  }

  const base = c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin;
  // Checkout only ever charges USD: a misconfigured CURRENCY would create a
  // session whose amount_micro (USD) no longer matches what was paid.
  const currency = (c.env.CURRENCY || "usd").toLowerCase();
  if (currency !== "usd") {
    return c.json(
      { error: { message: "仅支持 USD 充值", type: "bad_request" } },
      400
    );
  }
  const unitAmount = Math.round(amountUsd * 100);
  const amountMicro = Math.round(amountUsd * 1_000_000);

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${base}/?topup=success`);
  form.set("cancel_url", `${base}/?topup=cancel`);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", currency);
  form.set("line_items[0][price_data][unit_amount]", String(unitAmount));
  form.set("line_items[0][price_data][product_data][name]", "Credit top-up");
  form.set("metadata[sub]", session.sub);
  form.set("metadata[amount_micro]", String(amountMicro));

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    // Don't echo Stripe's error body: it can carry account details.
    return c.json({ error: { message: "stripe error", type: "stripe_error" } }, 502);
  }

  const sessionJson = (await res.json()) as { url?: string };
  return c.json({ url: sessionJson.url });
});

export default app;
