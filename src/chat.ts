/**
 * Shared chat dispatch: billing reserve → cheapest-first cross-provider
 * fallback → per-token charge → refund hold. Returns an OpenAI-shaped Response
 * (stream or JSON), already billed, with X-KeyPool-* headers. Used by both the
 * OpenAI route (/v1/chat/completions) and the Anthropic route (/v1/messages,
 * which translates around it).
 */

import type { Env, Provider, TokenScope } from "./types";
import { PROVIDERS } from "./types";
import type { OpenAIChatRequest } from "./providers/types";
import { routeModelToProvider, FALLBACK_MODEL, clampMaxTokens, customServiceSlug } from "./providers/types";
import { getAdapter } from "./providers";
import { makeCustomAdapter } from "./providers/custom";
import { callWithPool } from "./keypool";
import {
  incrementTokenUse,
  billingEnabled,
  providersWithActiveKeys,
  logRequest,
  estimateMaxCostMicro,
  reserveBalance,
  refundBalance,
  priceForModel,
  availableModelSet,
  listAvailableModels,
  getAlias,
} from "./db";
import { applyReasoning, canReason, normalizeChatRequest, normalizeReasoningResponse, normEffort } from "./reasoning";

/** Virtual model id: let the gateway pick whichever provider can serve now. */
export const AUTO_MODEL = "auto";

/**
 * "auto" preference, strongest tool-capable chat models first. Agent clients
 * (Pi, Codex, Claude Code) send long system prompts plus many tools; a small
 * model accepts the request but answers badly, so capability beats price here.
 * Pooled models missing from this list are tried after it, at each provider's
 * default model.
 */
const AUTO_RANK: string[] = [
  "gpt-4o",
  "deepseek-chat",
  "qwen-max",
  "gemini-1.5-pro",
  "mistral-large-latest",
  "deepseek/deepseek-chat",
  "gemini-2.0-flash",
  "glm-4.5-flash",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-3.3-70b-instruct",
  "command-r-plus",
  "qwen-plus",
  "moonshot-v1-128k",
  "codestral-latest",
  "gpt-4o-mini",
  "mistral-small-latest",
  "moonshot-v1-32k",
  "command-r",
  "qwen-turbo",
  "open-mistral-nemo",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "glm-4-flash",
  "llama-3.1-8b-instant",
];

/** Providers to try for "auto", each with its best servable model, best first.
 *  Candidates come only from the models the user added via live fetch
 *  (`model_status` available=1) — never the static adapter lists, so a
 *  hardcoded model that was blocked and had its row deleted can never be
 *  picked for "auto" again. A provider with an active key but no added
 *  models falls back to its FALLBACK_MODEL (if not blocked), preserving
 *  "auto" for freshly added keys. */
export async function autoCandidates(
  env: Env,
  avail: Set<string>,
  wantReasoning: boolean
): Promise<Array<{ p: Provider; model: string }>> {
  const blocked = await availableModelSet(env);
  const added = await listAvailableModels(env);
  const byProvider = new Map<string, string[]>();
  for (const row of added) {
    if (!avail.has(row.provider)) continue;
    const list = byProvider.get(row.provider) ?? [];
    list.push(row.model);
    byProvider.set(row.provider, list);
  }
  const rankOf = (m: string): number => {
    let r = AUTO_RANK.indexOf(m);
    // Asked to think: models that can think go ahead of those that can't.
    if (r >= 0 && wantReasoning && !canReason(m)) r += AUTO_RANK.length;
    // Not in AUTO_RANK: sort after every ranked model, deterministically.
    return r >= 0 ? r : AUTO_RANK.length * 2;
  };
  const best = new Map<Provider, { model: string; rank: number }>();
  for (const p of PROVIDERS) {
    if (!avail.has(p)) continue;
    let pick: { model: string; rank: number } | null = null;
    for (const m of byProvider.get(p) ?? []) {
      const r = rankOf(m);
      if (!pick || r < pick.rank || (r === pick.rank && m < pick.model)) pick = { model: m, rank: r };
    }
    if (!pick) {
      const fb = FALLBACK_MODEL[p];
      if (fb && !blocked.has(fb)) pick = { model: fb, rank: AUTO_RANK.length };
    }
    if (pick) best.set(p, pick);
  }
  return [...best.entries()].sort((a, b) => a[1].rank - b[1].rank).map(([p, v]) => ({ p, model: v.model }));
}

/**
 * Collapse text-only content-part arrays (`[{type:"text",text}]`) into a plain
 * string. Agent clients (Pi, Codex …) send user/system/tool content as parts,
 * but several upstreams (GLM, among others) silently drop a parts array on a
 * text model — the request "succeeds" and the model never sees the message.
 * Arrays holding images or other non-text parts are left untouched.
 */
export function flattenTextParts(body: OpenAIChatRequest): void {
  for (const m of body.messages ?? []) {
    const c: unknown = m.content;
    if (!Array.isArray(c) || c.length === 0) continue;
    const parts = c as Array<{ type?: string; text?: unknown }>;
    if (!parts.every((p) => p && (p.type === "text" || p.type === "input_text") && typeof p.text === "string")) continue;
    m.content = parts.map((p) => p.text as string).join("\n");
  }
}

export function isAutoModel(model: string): boolean {
  return (model || "").trim().toLowerCase() === AUTO_MODEL;
}

export interface Caller {
  tokenId: number | null;
  ownerSub: string | null;
  /** Token scope: "aliases" callers may only use virtual model aliases. */
  scope: TokenScope;
}

export async function serveChat(
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  body: OpenAIChatRequest,
  caller: Caller
): Promise<Response> {
  flattenTextParts(body);
  normalizeChatRequest(body);
  const auto = isAutoModel(body.model);
  // Resolve a model alias (virtual model) to its real targets before
  // routing: the alias name itself has no provider prefix and must never
  // reach an upstream. Alias names are bare words (no "/" or ":", enforced
  // by the admin route), so a model id containing either can never be an
  // alias and skips the lookup — the hot path stays at two D1 reads.
  const looksLikeAlias = !auto && !body.model.includes("/") && !body.model.includes(":");
  const alias = looksLikeAlias ? await getAlias(env, body.model) : null;
  // An aliases-scoped token may only chat through virtual aliases.
  if (caller.scope === "aliases" && !alias) {
    return new Response(
      JSON.stringify({ error: { message: "this token can only use model aliases", type: "invalid_request_error" } }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }
  // Primary model for billing / provider routing: the first failover target,
  // the load-balanced pick, or the requested model itself.
  const primaryModel = alias
    ? alias.strategy === "loadbalance"
      ? alias.targets[Math.floor(Math.random() * alias.targets.length)]
      : alias.targets[0]
    : body.model;
  const provider = routeModelToProvider(primaryModel);
  const promptChars = (body.messages ?? []).reduce((sum, m) => {
    const content: unknown = m.content;
    if (typeof content === "string") return sum + content.length;
    // Content-part arrays: count TEXT parts only. Image parts carry base64
    // (tens of KB per image) — counting them would inflate the billing
    // reserve and the prompt-token estimate by orders of magnitude.
    if (Array.isArray(content)) {
      return (
        sum +
        content.reduce((s, p) => {
          const part = p as { type?: unknown; text?: unknown };
          return s + (part && part.type === "text" && typeof part.text === "string" ? part.text.length : 0);
        }, 0)
      );
    }
    return sum;
  }, 0);

  const billing = billingEnabled(env) && !!caller.ownerSub;
  const maxTokens =
    typeof (body as { max_tokens?: unknown }).max_tokens === "number"
      ? (body as { max_tokens: number }).max_tokens
      : null;
  let hold = 0;
  // Whether the response that left the try block was a stream: the finally
  // below must not release the hold for streams (the background scan does).
  let streamed = false;
  if (billing) {
    hold = await estimateMaxCostMicro(env, primaryModel, promptChars, maxTokens);
    if (!(await reserveBalance(env, caller.ownerSub as string, hold))) {
      return new Response(
        JSON.stringify({ error: { message: "余额不足,请充值", type: "insufficient_balance" } }),
        { status: 402, headers: { "content-type": "application/json" } }
      );
    }
  }

  try {
    const allowFallback = (body as { fallback?: unknown }).fallback !== false;
    if ("fallback" in body) delete (body as { fallback?: unknown }).fallback;
    const avail = await providersWithActiveKeys(env);
    // Attempts are (provider, model) pairs tried in order. A failover alias
    // tries each target in turn; everything else tries the primary model
    // first, then the usual per-provider fallback models (cheapest first).
    let attempts: Array<{ prov: Provider; model: string }> = [];
    if (auto) {
      const effort = normEffort((body as { reasoning_effort?: unknown }).reasoning_effort);
      const cands = await autoCandidates(env, avail, !!effort && effort !== "none");
      attempts = cands.map((c) => ({ prov: c.p, model: c.model }));
      if (!allowFallback) attempts = attempts.slice(0, 1);
    } else if (alias && alias.strategy === "failover") {
      const seenProv = new Set<Provider>();
      for (const t of alias.targets) {
        const p = routeModelToProvider(t);
        attempts.push({ prov: p, model: t });
        seenProv.add(p);
      }
      if (allowFallback) {
        // Fallback providers must have a real fallback model: elevenlabs and
        // stability have no chat model (FALLBACK_MODEL is ""), so sending them
        // an empty model would fail pointlessly.
        const others = PROVIDERS.filter((p) => !seenProv.has(p) && avail.has(p) && FALLBACK_MODEL[p]);
        const priced = await Promise.all(
          others.map(async (p) => ({ p, price: (await priceForModel(env, FALLBACK_MODEL[p])).output }))
        );
        priced.sort((a, b) => a.price - b.price);
        for (const x of priced) attempts.push({ prov: x.p, model: FALLBACK_MODEL[x.p] });
      }
    } else {
      attempts = [{ prov: provider, model: primaryModel }];
      if (allowFallback) {
        // Fallback providers must have a real fallback model: elevenlabs and
        // stability have no chat model (FALLBACK_MODEL is ""), so sending them
        // an empty model would fail pointlessly.
        const others = PROVIDERS.filter((p) => p !== provider && avail.has(p) && FALLBACK_MODEL[p]);
        const priced = await Promise.all(
          others.map(async (p) => ({ p, price: (await priceForModel(env, FALLBACK_MODEL[p])).output }))
        );
        priced.sort((a, b) => a.price - b.price);
        for (const x of priced) attempts.push({ prov: x.p, model: FALLBACK_MODEL[x.p] });
      }
    }

    let res: Response | null = null;
    let servedBy: Provider = provider;
    let servedModel = primaryModel;
    let fellBack = false;
    // Hold release for streaming: the reserve stays locked until the
    // background scan has charged the real usage (see onStreamCharged).
    const releaseHold = billing && hold > 0
      ? () => refundBalance(env, caller.ownerSub as string, hold)
      : undefined;
    for (let i = 0; i < attempts.length; i++) {
      const prov = attempts[i].prov;
      // Custom services have no registry adapter: each key carries its own
      // base URL, so the adapter is built per key inside the attempt.
      const adapter = prov === "custom" ? null : getAdapter(prov);
      const useModel = attempts[i].model;
      // Custom models are `custom:<slug>:<model>` — the slug picks which
      // service's keys the pool tries (keys of other services must not mix).
      const slug = prov === "custom" ? customServiceSlug(useModel) ?? undefined : undefined;
      // Clamp max_tokens to the provider's cap: an over-limit value makes some
      // upstreams reject (or emit an empty SSE stream) instead of serving.
      const clamped = clampMaxTokens(prov, (body as { max_tokens?: number }).max_tokens, useModel);
      // Thinking params are provider-specific, so translate per attempt
      // (a fallback can land on a provider with a different dialect).
      // The upstream always gets the resolved model: for an alias the
      // virtual name must never leak through (the primary attempt used to
      // pass body.model unchanged, which was the real model then — now
      // useModel already is body.model for a plain primary attempt).
      const reqBody: OpenAIChatRequest = applyReasoning(
        prov,
        { ...body, model: useModel, max_tokens: clamped }
      );
      // Ask for a usage frame in the stream so the scan can bill exact
      // tokens instead of estimating from character counts.
      if ((reqBody as { stream?: unknown }).stream) {
        (reqBody as { stream_options?: unknown }).stream_options = { include_usage: true };
      }
      try {
        res = await callWithPool(env, prov, (row) => {
          const a = prov === "custom" ? makeCustomAdapter(row.base_url ?? "") : adapter!;
          return a.chatCompletions(reqBody, row.api_key);
        }, {
          model: useModel,
          slug,
          tokenId: caller.tokenId,
          ownerSub: caller.ownerSub,
          ctx,
          promptChars,
          finalOnFailure: false,
          maxKeys: i === 0 ? undefined : 2,
          onStreamCharged: releaseHold,
        });
      } catch (err) {
        // callWithPool throwing (DB/pool failure) must not become an unhandled
        // 500: return a JSON error for this attempt and stop the chain.
        res = new Response(
          JSON.stringify({ error: { message: `pool error: ${err instanceof Error ? err.message : String(err)}`, type: "pool_error" } }),
          { status: 502, headers: { "content-type": "application/json" } }
        );
        break;
      }
      if (res.status >= 200 && res.status <= 299) {
        res = await normalizeReasoningResponse(prov, res);
        servedBy = prov;
        servedModel = useModel;
        fellBack = i > 0 && !auto;
        streamed = (res.headers.get("content-type") || "").includes("text/event-stream");
        break;
      }
      // Fall back only on retryable failures (429 / 5xx / pool-exhausted 503).
      // Any other 4xx is a caller error (bad model, bad params) — another
      // provider would reject the same request, so stop and return it.
      if (res.status !== 429 && res.status < 500) break;
    }

    if (!res) {
      return new Response(
        JSON.stringify({ error: { message: "no providers available", type: "upstream_unavailable" } }),
        { status: 503, headers: { "content-type": "application/json" } }
      );
    }
    const ok = res.status >= 200 && res.status <= 299;
    if (!ok) {
      await logRequest(env, {
        provider, keyId: null, model: body.model, tokenId: caller.tokenId,
        ownerSub: caller.ownerSub, statusCode: res.status, latencyMs: null, ok: false, final: true,
      });
    }
    if (caller.tokenId !== null && ok) {
      await incrementTokenUse(env, caller.tokenId);
    }
    if (ok) {
      const safeModel = String(servedModel).replace(/[^\x20-\x7E]/g, "").slice(0, 200);
      const out = new Response(res.body, res);
      out.headers.set("X-KeyPool-Provider", servedBy);
      out.headers.set("X-KeyPool-Model", safeModel);
      if (fellBack) out.headers.set("X-KeyPool-Fallback", "1");
      return out;
    }
    return res;
  } finally {
    // Non-streaming: the real charge already landed inside callWithPool, so
    // the reserve can be released now. Streaming: the charge lands later in
    // the background scan, which releases the hold via onStreamCharged —
    // releasing here would let a concurrent request spend the same money.
    if (billing && hold > 0 && !streamed) await refundBalance(env, caller.ownerSub as string, hold);
  }
}
