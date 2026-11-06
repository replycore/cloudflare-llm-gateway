/** OpenAI-compatible routes: `/v1/models`, `/v1/chat/completions`, `/v1/responses`, and Anthropic `/v1/messages`. User auth. */

import { Hono } from "hono";
import type { Env } from "../types";
import type { OpenAIChatRequest } from "../providers/types";
import { requireUser, resolveCaller } from "../auth";
import { checkTokenLimits, providersWithActiveKeys, availableModelSet, listAvailableModels, getBalanceMicro, getChargeTotalMicro } from "../db";
import { serveChat, AUTO_MODEL } from "../chat";
import { anthropicToOpenAI, openAIToAnthropic, openAIStreamToAnthropic } from "../anthropic";
import type { AnthropicRequest } from "../anthropic";
import { responsesToChat, chatToResponses, chatStreamToResponses } from "../responses";
import type { ResponsesRequest } from "../responses";
import { passKeypoolHeaders, upstreamErrorMessage } from "../sse";
import { canReason, REASONING_LEVELS } from "../reasoning";

const app = new Hono<{ Bindings: Env }>();

app.use("*", requireUser);

/** Models a caller can actually be served right now: the virtual "auto"
 *  model (if any provider has an active key) plus the models the user added
 *  via live fetch (`model_status` available=1), for providers with an active
 *  key. Deliberately NOT the static adapter lists: those ids are hardcoded,
 *  and listing them as servable when they were never added (or were blocked
 *  and their rows deleted) would advertise models that can't serve. */
export async function servableModels(env: Env): Promise<Array<{ id: string; owner: string }>> {
  const avail = await providersWithActiveKeys(env);
  // BLOCKED set: models explicitly marked unavailable (a never-probed model is
  // available by default, so it won't appear here).
  const blocked = await availableModelSet(env);
  const out: Array<{ id: string; owner: string }> = [];
  // Virtual "auto" model first: routed to whichever provider can serve now.
  if (avail.size) out.push({ id: AUTO_MODEL, owner: "keypool" });
  // Models added from a live fetch (POST /admin/keys/:id/models) live in
  // model_status with available=1 — the static adapter lists can't know
  // them, but chat can already serve them (routing is provider-agnostic),
  // so they belong in /v1/models too. Only for providers with an active key.
  const seen = new Set(out.map((m) => m.id));
  for (const row of await listAvailableModels(env)) {
    if (!avail.has(row.provider)) continue;
    if (seen.has(row.model) || blocked.has(row.model)) continue;
    seen.add(row.model);
    out.push({ id: row.model, owner: row.provider });
  }
  return out;
}

/** Model entry readable by both OpenAI (`object`/`owned_by`) and Anthropic
 *  (`type`/`display_name`/`created_at`) clients. */
function modelEntry(m: { id: string; owner: string }) {
  const reasoning = canReason(m.id);
  return {
    // Thinking capability, in the shape Magpie / Codex-style clients read.
    reasoning,
    supported_reasoning_levels: reasoning ? REASONING_LEVELS.map((effort) => ({ effort })) : [],
    id: m.id,
    object: "model" as const,
    owned_by: m.owner,
    type: "model" as const,
    display_name: m.id,
    created_at: "2024-01-01T00:00:00Z",
  };
}

/** GET /models — one list in a shape both OpenAI and Anthropic SDKs parse
 *  (`object`+`data` for OpenAI; `data`+`has_more`+`first_id`/`last_id` for
 *  Anthropic). */
app.get("/models", async (c) => {
  const data = (await servableModels(c.env)).map(modelEntry);
  return c.json({
    object: "list",
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  });
});

app.get("/models/:id{.+}", async (c) => {
  const id = c.req.param("id");
  const m = (await servableModels(c.env)).find((x) => x.id === id);
  if (!m) return c.json({ error: { message: `model not found: ${id}`, type: "invalid_request_error" } }, 404);
  return c.json(modelEntry(m));
});

/** POST /chat/completions — route to a provider and dispatch through the pool. */
app.post("/chat/completions", async (c) => {
  let body: OpenAIChatRequest;
  try {
    body = (await c.req.json()) as OpenAIChatRequest;
  } catch {
    return c.json(
      { error: { message: "invalid json body", type: "invalid_request_error" } },
      400,
    );
  }

  if (!body || typeof body.model !== "string" || !body.model) {
    return c.json(
      { error: { message: "missing required field: model", type: "invalid_request_error" } },
      400,
    );
  }
  if (!Array.isArray(body.messages)) {
    return c.json(
      { error: { message: "messages must be an array", type: "invalid_request_error" } },
      400,
    );
  }
  if (body.messages.length === 0) {
    return c.json(
      { error: { message: "messages must not be empty", type: "invalid_request_error" } },
      400,
    );
  }
  // Field validation the old code skipped: a bad max_tokens / temperature /
  // top_p used to travel all the way to the upstream and come back as a
  // confusing provider error (or a silent empty stream).
  const maxTokens = (body as { max_tokens?: unknown }).max_tokens;
  if (maxTokens !== undefined && (typeof maxTokens !== "number" || !Number.isFinite(maxTokens) || maxTokens <= 0)) {
    return c.json(
      { error: { message: "max_tokens must be a positive number", type: "invalid_request_error" } },
      400,
    );
  }
  const temperature = (body as { temperature?: unknown }).temperature;
  if (temperature !== undefined && (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    return c.json(
      { error: { message: "temperature must be between 0 and 2", type: "invalid_request_error" } },
      400,
    );
  }
  const topP = (body as { top_p?: unknown }).top_p;
  if (topP !== undefined && (typeof topP !== "number" || !Number.isFinite(topP) || topP < 0 || topP > 1)) {
    return c.json(
      { error: { message: "top_p must be between 0 and 1", type: "invalid_request_error" } },
      400,
    );
  }

  const caller = await resolveCaller(c.env, c.req.raw);
  if (caller.tokenId !== null) {
    const chk = await checkTokenLimits(c.env, caller.tokenId);
    if (!chk.ok) {
      return c.json({ error: { message: chk.message, type: "limit_exceeded" } }, chk.status as 429);
    }
  }
  return serveChat(c.env, c.executionCtx, body, caller);
});

/**
 * Industry-standard balance endpoints (OpenAI legacy billing shape), the format
 * NewAPI/OneAPI + most clients (ChatGPT-Next-Web, Lobe, Bob, 沉浸式翻译, …) read.
 * Balance = hard_limit_usd − total_usage/100. Authed by the caller's token.
 */
app.get("/dashboard/billing/subscription", async (c) => {
  const caller = await resolveCaller(c.env, c.req.raw);
  let grantedUsd = 999999; // admin / unattributed token => effectively unlimited
  if (caller.ownerSub) {
    const balance = await getBalanceMicro(c.env, caller.ownerSub);
    const spent = await getChargeTotalMicro(c.env, caller.ownerSub);
    grantedUsd = (balance + spent) / 1_000_000; // total granted = remaining + spent
  }
  return c.json({
    object: "billing_subscription",
    has_payment_method: true,
    canceled: false,
    soft_limit_usd: grantedUsd,
    hard_limit_usd: grantedUsd,
    system_hard_limit_usd: grantedUsd,
    access_until: 0,
  });
});

app.get("/dashboard/billing/usage", async (c) => {
  const caller = await resolveCaller(c.env, c.req.raw);
  let spentMicro = 0;
  if (caller.ownerSub) spentMicro = await getChargeTotalMicro(c.env, caller.ownerSub);
  // total_usage is in cents (USD * 100).
  return c.json({ object: "list", total_usage: (spentMicro / 1_000_000) * 100 });
});

/** POST /messages — Anthropic Messages API. Translates to OpenAI, dispatches
 *  through the shared pool, and translates the response back to Anthropic. */
app.post("/messages", async (c) => {
  let a: AnthropicRequest;
  try {
    a = (await c.req.json()) as AnthropicRequest;
  } catch {
    return c.json({ type: "error", error: { type: "invalid_request_error", message: "invalid json body" } }, 400);
  }
  if (!a || typeof a.model !== "string" || !a.model || !Array.isArray(a.messages)) {
    return c.json({ type: "error", error: { type: "invalid_request_error", message: "model and messages are required" } }, 400);
  }

  const caller = await resolveCaller(c.env, c.req.raw);
  if (caller.tokenId !== null) {
    const chk = await checkTokenLimits(c.env, caller.tokenId);
    if (!chk.ok) {
      return c.json({ type: "error", error: { type: "rate_limit_error", message: chk.message } }, chk.status as 429);
    }
  }

  const stream = a.stream === true;
  const oai = await serveChat(c.env, c.executionCtx, anthropicToOpenAI(a), caller);

  if (oai.status < 200 || oai.status > 299) {
    const text = await oai.text().catch(() => "");
    let msg = text;
    try { msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text; } catch { /* keep text */ }
    const type =
      oai.status === 402 ? "insufficient_quota"
      : oai.status === 429 ? "rate_limit_error"
      : oai.status === 400 || oai.status === 404 ? "invalid_request_error"
      : "api_error";
    return c.json({ type: "error", error: { type, message: msg || `upstream ${oai.status}` } }, oai.status as 500);
  }

  const passHeaders: Record<string, string> = {};
  for (const h of ["X-KeyPool-Provider", "X-KeyPool-Model", "X-KeyPool-Fallback"]) {
    const v = oai.headers.get(h);
    if (v) passHeaders[h] = v;
  }

  if (stream && oai.body) {
    return new Response(openAIStreamToAnthropic(oai.body, a.model), {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", ...passHeaders },
    });
  }
  // A 200 with an empty or non-JSON body is not a message — 502 it. The old
  // code translated `{}` into a 200 with empty text (a fake success).
  const text = await oai.text().catch(() => "");
  let j: Parameters<typeof openAIToAnthropic>[0];
  try {
    j = JSON.parse(text) as Parameters<typeof openAIToAnthropic>[0];
  } catch {
    return c.json({ type: "error", error: { type: "api_error", message: "upstream returned a non-JSON 200 response" } }, 502);
  }
  if (!j || typeof j !== "object" || !Array.isArray(j.choices)) {
    return c.json({ type: "error", error: { type: "api_error", message: "upstream returned an empty 200 response" } }, 502);
  }
  return new Response(JSON.stringify(openAIToAnthropic(j, a.model)), {
    status: 200,
    headers: { "content-type": "application/json", ...passHeaders },
  });
});

/** POST /responses — OpenAI Responses API. Translates to chat completions,
 *  dispatches through the shared pool, and translates back. */
app.post("/responses", async (c) => {
  let r: ResponsesRequest;
  try {
    r = (await c.req.json()) as ResponsesRequest;
  } catch {
    return c.json({ error: { message: "invalid json body", type: "invalid_request_error" } }, 400);
  }
  if (!r || typeof r.model !== "string" || !r.model) {
    return c.json({ error: { message: "missing required field: model", type: "invalid_request_error" } }, 400);
  }
  if (r.input === undefined || r.input === null || (typeof r.input !== "string" && !Array.isArray(r.input))) {
    return c.json({ error: { message: "input must be a string or an array", type: "invalid_request_error" } }, 400);
  }

  const caller = await resolveCaller(c.env, c.req.raw);
  if (caller.tokenId !== null) {
    const chk = await checkTokenLimits(c.env, caller.tokenId);
    if (!chk.ok) {
      return c.json({ error: { message: chk.message, type: "limit_exceeded" } }, chk.status as 429);
    }
  }

  const oai = await serveChat(c.env, c.executionCtx, responsesToChat(r), caller);
  if (oai.status < 200 || oai.status > 299) {
    const message = await upstreamErrorMessage(oai);
    const type =
      oai.status === 402 ? "insufficient_quota"
      : oai.status === 429 ? "rate_limit_error"
      : oai.status === 400 || oai.status === 404 ? "invalid_request_error"
      : "api_error";
    return c.json({ error: { message, type } }, oai.status as 500);
  }
  const passHeaders = passKeypoolHeaders(oai);
  if (r.stream === true && oai.body) {
    return new Response(chatStreamToResponses(oai.body, r), {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", ...passHeaders },
    });
  }
  // A 200 with an empty or non-JSON body is not a response — 502 it.
  const text = await oai.text().catch(() => "");
  let j: Parameters<typeof chatToResponses>[0];
  try {
    j = JSON.parse(text) as Parameters<typeof chatToResponses>[0];
  } catch {
    return c.json({ error: { message: "upstream returned a non-JSON 200 response", type: "api_error" } }, 502);
  }
  if (!j || typeof j !== "object" || !Array.isArray(j.choices)) {
    return c.json({ error: { message: "upstream returned an empty 200 response", type: "api_error" } }, 502);
  }
  return new Response(JSON.stringify(chatToResponses(j, r)), {
    status: 200,
    headers: { "content-type": "application/json", ...passHeaders },
  });
});

export default app;
