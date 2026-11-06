/** Gemini provider adapter: OpenAI<->Gemini translation (incl. streaming) + native passthrough. */

import type { ProviderAdapter, OpenAIChatRequest } from "./types";
import { stripProviderPrefix } from "./types";
import { budgetFromEffort, canReason, normEffort } from "../reasoning";

const BASE = "https://generativelanguage.googleapis.com";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: unknown };
  functionResponse?: { name: string; response: unknown };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  thinkingConfig?: { thinkingBudget?: number; includeThoughts?: boolean };
}

interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: GeminiGenerationConfig;
}

/** Coerce OpenAI message content (string | array of parts) into plain text. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const out: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        out.push(part);
      } else if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") out.push(p.text);
      }
    }
    return out.join("\n");
  }
  if (content == null) return "";
  return String(content);
}

/** Split an OpenAI message into Gemini parts: text, images (data URLs only),
 *  tool calls (assistant) / tool results (tool role). */
function messageParts(msg: OpenAIChatRequest["messages"][number]): GeminiPart[] {
  const parts: GeminiPart[] = [];
  const content = msg.content;
  if (typeof content === "string") {
    if (content) parts.push({ text: content });
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: unknown; text?: unknown; image_url?: unknown };
      if (p.type === "text" && typeof p.text === "string" && p.text) parts.push({ text: p.text });
      else if (p.type === "image_url") {
        const url = typeof p.image_url === "string" ? p.image_url : (p.image_url as { url?: unknown } | undefined)?.url;
        if (typeof url === "string") {
          const m = /^data:([^;]+);base64,(.+)$/.exec(url);
          if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
          // Remote image URLs can't be sent to Gemini (it takes inline
          // bytes or a Files API reference) — dropped, not faked.
        }
      }
    }
  }
  const calls = (msg as { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> }).tool_calls;
  if (Array.isArray(calls)) {
    for (const c of calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(c.function?.arguments ?? "{}") as unknown;
      } catch {
        args = {};
      }
      parts.push({ functionCall: { name: c.function?.name ?? "", args } });
    }
  }
  return parts;
}

/** Build the Gemini request body from an OpenAI chat request. */
function toGeminiBody(req: OpenAIChatRequest): GeminiRequestBody {
  const contents: GeminiContent[] = [];
  const systemTexts: string[] = [];

  for (const msg of req.messages || []) {
    const text = contentToText(msg.content);
    if (msg.role === "system") {
      if (text) systemTexts.push(text);
      continue;
    }
    if (msg.role === "tool") {
      // Tool results are functionResponse parts in a USER content.
      let response: unknown = {};
      try {
        response = JSON.parse(text || "{}") as unknown;
      } catch {
        response = { result: text };
      }
      const name = (msg as { name?: string }).name ?? "";
      contents.push({ role: "user", parts: [{ functionResponse: { name, response } }] });
      continue;
    }
    const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
    const parts = messageParts(msg);
    if (parts.length) contents.push({ role, parts });
  }

  // Gemini rejects consecutive same-role contents — merge them.
  const merged: GeminiContent[] = [];
  for (const c of contents) {
    const last = merged[merged.length - 1];
    if (last && last.role === c.role) last.parts.push(...c.parts);
    else merged.push({ role: c.role, parts: [...c.parts] });
  }
  // Gemini requires the first content to be a user turn.
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", parts: [{ text: "(continue)" }] });
  }

  const body: GeminiRequestBody = { contents: merged };

  if (systemTexts.length > 0) {
    body.systemInstruction = { parts: [{ text: systemTexts.join("\n") }] };
  }

  const generationConfig: GeminiGenerationConfig = {};
  if (typeof req.max_tokens === "number") generationConfig.maxOutputTokens = req.max_tokens;
  if (typeof req.temperature === "number") generationConfig.temperature = req.temperature;
  if (typeof req.top_p === "number") generationConfig.topP = req.top_p;
  if (typeof req.stop === "string") {
    generationConfig.stopSequences = [req.stop];
  } else if (Array.isArray(req.stop)) {
    generationConfig.stopSequences = req.stop.filter((s): s is string => typeof s === "string");
  }
  // unverified (all Gemini keys disabled 2026-10-11): 2.5+ models take a
  // thinking budget; older ones reject thinkingConfig, so only send it there.
  const effort = normEffort((req as { reasoning_effort?: unknown }).reasoning_effort);
  if (effort && canReason(req.model)) {
    generationConfig.thinkingConfig = { thinkingBudget: budgetFromEffort(effort), includeThoughts: effort !== "none" };
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  return body;
}

/** Extract the concatenated text from a single Gemini response chunk/object.
 *  `thoughts` selects the `thought: true` parts instead of the answer parts. */
function extractText(obj: unknown, thoughts = false): string {
  if (!obj || typeof obj !== "object") return "";
  const o = obj as Record<string, unknown>;
  const candidates = o.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const first = candidates[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return "";
  const content = first.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== "object") return "";
  const parts = content.parts;
  if (!Array.isArray(parts)) return "";
  let text = "";
  for (const part of parts) {
    if (part && typeof part === "object") {
      const pr = part as Record<string, unknown>;
      if ((pr.thought === true) !== thoughts) continue;
      if (typeof pr.text === "string") text += pr.text;
    }
  }
  return text;
}

/** Extract the finishReason of the first candidate, if any. */
function extractFinishReason(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const candidates = o.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return null;
  const fr = first.finishReason;
  return typeof fr === "string" ? fr : null;
}

function mapFinishReason(reason: string | null): string | null {
  if (reason == null) return null;
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "content_filter";
    default:
      return "stop";
  }
}

function genId(): string {
  return "chatcmpl-" + crypto.randomUUID().replace(/-/g, "");
}

const jsonHeaders = { "content-type": "application/json" };

/** Translate a non-stream Gemini response into an OpenAI chat.completion. */
function toOpenAICompletion(gem: unknown, model: string): unknown {
  const text = extractText(gem);
  const thoughts = extractText(gem, true);
  const finish = mapFinishReason(extractFinishReason(gem)) ?? "stop";

  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  if (gem && typeof gem === "object") {
    const usage = (gem as Record<string, unknown>).usageMetadata;
    if (usage && typeof usage === "object") {
      const u = usage as Record<string, unknown>;
      if (typeof u.promptTokenCount === "number") promptTokens = u.promptTokenCount;
      if (typeof u.candidatesTokenCount === "number") completionTokens = u.candidatesTokenCount;
      if (typeof u.totalTokenCount === "number") totalTokens = u.totalTokenCount;
    }
  }

  return {
    id: genId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: thoughts ? { role: "assistant", content: text, reasoning_content: thoughts } : { role: "assistant", content: text },
        finish_reason: finish,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens || promptTokens + completionTokens,
    },
  };
}

const encoder = new TextEncoder();

/** Build an OpenAI chat.completion.chunk SSE stream from a Gemini SSE stream. */
function streamToOpenAI(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const id = genId();
  const created = Math.floor(Date.now() / 1000);
  const decoder = new TextDecoder();
  const reader = upstream.getReader();
  let buffer = "";
  let sentRole = false;

  function chunkFrame(delta: Record<string, unknown>, finishReason: string | null, usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): Uint8Array {
    const payload: Record<string, unknown> = {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    if (usage) payload.usage = usage;
    return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function handleData(jsonText: string, controller: ReadableStreamDefaultController<Uint8Array>) {
    const trimmed = jsonText.trim();
    if (!trimmed || trimmed === "[DONE]") return;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return;
    }
    const text = extractText(obj);
    const thoughts = extractText(obj, true);
    if (!sentRole) {
      controller.enqueue(chunkFrame({ role: "assistant", content: "" }, null));
      sentRole = true;
    }
    if (thoughts) {
      controller.enqueue(chunkFrame({ reasoning_content: thoughts }, null));
    }
    if (text) {
      controller.enqueue(chunkFrame({ content: text }, null));
    }
    const finish = mapFinishReason(extractFinishReason(obj));
    // Forward Gemini's usageMetadata as an OpenAI usage chunk so the pool's
    // stream scan can bill exact tokens instead of estimating.
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
    if (obj && typeof obj === "object") {
      const meta = (obj as Record<string, unknown>).usageMetadata;
      if (meta && typeof meta === "object") {
        const m = meta as Record<string, unknown>;
        const prompt = typeof m.promptTokenCount === "number" ? m.promptTokenCount : 0;
        const completion = typeof m.candidatesTokenCount === "number" ? m.candidatesTokenCount : 0;
        const total = typeof m.totalTokenCount === "number" ? m.totalTokenCount : prompt + completion;
        if (prompt || completion || total) usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
      }
    }
    if (finish) {
      controller.enqueue(chunkFrame({}, finish, usage));
    } else if (usage) {
      controller.enqueue(chunkFrame({}, null, usage));
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // Flush any remaining buffered SSE lines.
          buffer += decoder.decode();
          const lines = buffer.split("\n");
          for (const line of lines) {
            if (line.startsWith("data:")) handleData(line.slice(5), controller);
          }
          if (!sentRole) {
            controller.enqueue(chunkFrame({ role: "assistant", content: "" }, null));
            sentRole = true;
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        // Process complete lines, keep the trailing partial in the buffer.
        const newlineIdx = buffer.lastIndexOf("\n");
        if (newlineIdx === -1) return;
        const complete = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        for (const line of complete.split("\n")) {
          if (line.startsWith("data:")) handleData(line.slice(5), controller);
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });
}

const gemini: ProviderAdapter = {
  name: "gemini",

  models(): string[] {
    return ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-pro"];
  },

  async chatCompletions(req: OpenAIChatRequest, key: string): Promise<Response> {
    // A routed id like "gemini:gemini-2.0-flash" is stripped first.
    const model = stripProviderPrefix(req.model);
    const stream = req.stream === true;
    const method = stream ? "streamGenerateContent" : "generateContent";
    const url = `${BASE}/v1beta/models/${encodeURIComponent(model)}:${method}${
      stream ? "?alt=sse" : ""
    }`;

    const body = toGeminiBody(req);
    // A request with no user/model content (e.g. system-only) is invalid for
    // Gemini — fail here instead of sending an empty contents array.
    if (body.contents.length === 0) {
      return new Response(JSON.stringify({ error: { message: "no user content to send to Gemini", type: "invalid_request" } }), {
        status: 502,
        headers: jsonHeaders,
      });
    }

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(body),
    });

    // Mirror non-2xx upstream errors verbatim so the pool can classify the key.
    if (!upstream.ok) {
      const errText = await upstream.text();
      return new Response(errText, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
      });
    }

    if (stream) {
      const src = upstream.body;
      if (!src) {
        return new Response(JSON.stringify({ error: { message: "empty upstream stream", type: "upstream_error" } }), {
          status: 502,
          headers: jsonHeaders,
        });
      }
      return new Response(streamToOpenAI(src, model), {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    // A 200 with a non-JSON body (proxy error page, truncated response) is
    // not a completion — 502 it instead of crashing on .json().
    let gem: unknown;
    try {
      gem = await upstream.json();
    } catch {
      return new Response(JSON.stringify({ error: { message: "upstream returned a non-JSON 200 response", type: "upstream_error" } }), {
        status: 502,
        headers: jsonHeaders,
      });
    }
    const openai = toOpenAICompletion(gem, model);
    return new Response(JSON.stringify(openai), { status: 200, headers: jsonHeaders });
  },

  async passthrough(subPath: string, req: Request, key: string): Promise<Response> {
    const path = subPath.startsWith("/") ? subPath : `/${subPath}`;
    const url = `${BASE}${path}`;

    const headers = new Headers(req.headers);
    headers.delete("authorization");
    headers.delete("cookie");
    headers.delete("host");
    headers.set("x-goog-api-key", key);

    const method = req.method.toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";

    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error - duplex is required by the Workers runtime when streaming a request body.
      duplex: hasBody ? "half" : undefined,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  },
};

export default gemini;
