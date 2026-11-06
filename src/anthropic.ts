/**
 * Anthropic Messages API <-> OpenAI Chat Completions translation, so
 * Anthropic-native clients (Claude Code, cc-haha, the Anthropic SDK) can use the
 * gateway at POST /v1/messages. Requests are translated to OpenAI, dispatched
 * through the shared pool, and the OpenAI response (JSON or SSE) is translated
 * back into the Anthropic shape.
 */

import type { OpenAIChatRequest } from "./providers/types";
import { effortFromBudget, normEffort } from "./reasoning";
import { contentToText, ToolCallAccumulator } from "./sse";

// ---------- request: Anthropic -> OpenAI ----------

interface AnthropicTextBlock { type: "text"; text: string }
interface AnthropicImageBlock {
  type: "image";
  source?: { type?: string; media_type?: string; data?: string; url?: string };
}
type AnthropicBlock = AnthropicTextBlock | AnthropicImageBlock | { type: string; [k: string]: unknown };

export interface AnthropicRequest {
  model: string;
  max_tokens?: number;
  system?: string | AnthropicBlock[];
  messages: Array<{ role: string; content: string | AnthropicBlock[] }>;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  /** Extended thinking: enabled + budget, adaptive, or disabled. */
  thinking?: { type?: string; budget_tokens?: number };
  /** Newer effort knob (`output_config.effort`). */
  output_config?: { effort?: string };
}

function blocksToOpenAIContent(content: string | AnthropicBlock[]): OpenAIChatRequest["messages"][number]["content"] {
  if (typeof content === "string") return content;
  const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
  for (const b of content) {
    if (b && (b as AnthropicTextBlock).type === "text") {
      parts.push({ type: "text", text: String((b as AnthropicTextBlock).text ?? "") });
    } else if (b && (b as AnthropicImageBlock).type === "image") {
      const s = (b as AnthropicImageBlock).source;
      if (s?.url) parts.push({ type: "image_url", image_url: { url: s.url } });
      else if (s?.data && s?.media_type) {
        parts.push({ type: "image_url", image_url: { url: `data:${s.media_type};base64,${s.data}` } });
      }
    }
    // tool_use / tool_result blocks are handled at message level in
    // anthropicToOpenAI (they change the message shape, not just content).
  }
  // If every part is text, collapse to a plain string for max provider compatibility.
  if (parts.every((p) => p.type === "text")) {
    return parts.map((p) => (p as { text: string }).text).join("\n");
  }
  return parts as unknown as OpenAIChatRequest["messages"][number]["content"];
}

function systemToText(system: string | AnthropicBlock[] | undefined): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system
    .filter((b) => (b as AnthropicTextBlock).type === "text")
    .map((b) => (b as AnthropicTextBlock).text)
    .join("\n");
}

/** Build an OpenAI chat request from an Anthropic Messages request. */
export function anthropicToOpenAI(a: AnthropicRequest): OpenAIChatRequest {
  const messages: OpenAIChatRequest["messages"] = [];
  const sys = systemToText(a.system);
  if (sys) messages.push({ role: "system", content: sys });
  for (const m of a.messages) {
    const blocks = Array.isArray(m.content) ? m.content : null;
    if (blocks) {
      const toolUses = blocks.filter((b) => b?.type === "tool_use") as Array<{ type: "tool_use"; id?: string; name?: string; input?: unknown }>;
      const toolResults = blocks.filter((b) => b?.type === "tool_result") as Array<{ type: "tool_result"; tool_use_id?: string; content?: unknown }>;
      if (toolUses.length > 0) {
        // Assistant turn that called tools: text (if any) + tool_calls.
        const text = blocks
          .filter((b) => b?.type === "text")
          .map((b) => String((b as AnthropicTextBlock).text ?? ""))
          .join("\n");
        messages.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUses.map((t) => ({
            id: t.id ?? "",
            type: "function" as const,
            function: { name: t.name ?? "", arguments: JSON.stringify(t.input ?? {}) },
          })),
        } as unknown as OpenAIChatRequest["messages"][number]);
        continue;
      }
      if (toolResults.length > 0) {
        // Tool results become OpenAI `tool` messages; accompanying text
        // stays a user message first (Anthropic allows both in one message).
        const text = blocks
          .filter((b) => b?.type === "text")
          .map((b) => String((b as AnthropicTextBlock).text ?? ""))
          .join("\n");
        if (text) messages.push({ role: "user", content: text });
        for (const tr of toolResults) {
          messages.push({
            role: "tool",
            tool_call_id: tr.tool_use_id ?? "",
            content: typeof tr.content === "string" ? tr.content : contentToText(tr.content),
          } as unknown as OpenAIChatRequest["messages"][number]);
        }
        continue;
      }
    }
    messages.push({ role: m.role, content: blocksToOpenAIContent(m.content) });
  }
  const out: OpenAIChatRequest = {
    model: a.model,
    messages,
    stream: a.stream === true ? true : undefined,
    max_tokens: typeof a.max_tokens === "number" ? a.max_tokens : undefined,
    temperature: typeof a.temperature === "number" ? a.temperature : undefined,
    top_p: typeof a.top_p === "number" ? a.top_p : undefined,
    stop: Array.isArray(a.stop_sequences) ? a.stop_sequences : undefined,
  };
  const effort =
    normEffort(a.output_config?.effort) ??
    (a.thinking?.type === "disabled"
      ? "none"
      : a.thinking?.type === "enabled"
        ? effortFromBudget(typeof a.thinking.budget_tokens === "number" ? a.thinking.budget_tokens : 8192)
        : a.thinking?.type === "adaptive"
          ? "medium"
          : undefined);
  if (effort) out.reasoning_effort = effort;
  return out;
}

// ---------- response: OpenAI -> Anthropic ----------

/** Placeholder signature on synthesized thinking blocks. Anthropic clients
 *  echo it back on the next turn; the gateway drops thinking blocks from
 *  history, so it is never verified. */
const THINKING_SIGNATURE = "keypool-gateway";

function mapStopReason(finish: string | null | undefined): string {
  switch (finish) {
    case "length": return "max_tokens";
    case "tool_calls": return "tool_use";
    // A content-filter stop is a refusal, not a stop sequence.
    case "content_filter": return "refusal";
    default: return "end_turn"; // "stop" / null
  }
}

function msgId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  let hex = "";
  for (const b of a) hex += b.toString(16).padStart(2, "0");
  return "msg_" + hex;
}

interface OpenAICompletion {
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Translate a non-streaming OpenAI completion JSON into an Anthropic message. */
export function openAIToAnthropic(oai: OpenAICompletion, model: string): unknown {
  const choice = oai.choices?.[0];
  const text = contentToText(choice?.message?.content);
  const thinking = typeof choice?.message?.reasoning_content === "string" ? choice.message.reasoning_content : "";
  const content: unknown[] = [];
  if (thinking) content.push({ type: "thinking", thinking, signature: THINKING_SIGNATURE });
  content.push({ type: "text", text });
  // Assistant tool calls become Anthropic tool_use blocks.
  for (const tc of choice?.message?.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = JSON.parse(tc.function?.arguments ?? "{}") as unknown;
    } catch {
      input = {};
    }
    content.push({ type: "tool_use", id: tc.id ?? "", name: tc.function?.name ?? "", input });
  }
  return {
    id: msgId(),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: oai.usage?.prompt_tokens ?? 0,
      output_tokens: oai.usage?.completion_tokens ?? 0,
    },
  };
}

// ---------- streaming: OpenAI SSE -> Anthropic SSE ----------

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Wrap an OpenAI SSE stream (chat.completion.chunk frames + `data: [DONE]`) into
 * an Anthropic Messages SSE stream (message_start → content_block_delta* →
 * message_delta → message_stop).
 */
export function openAIStreamToAnthropic(upstream: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const id = msgId();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = "";
  let started = false;
  let stopReason = "end_turn";
  let outTokens = 0;
  let inTokens = 0;
  // Open content block: thinking (reasoning_content) comes first, then text.
  let block: "thinking" | "text" | "tool_use" | null = null;
  let index = -1;
  // Tool-call streaming: accumulate deltas per OpenAI index, one Anthropic
  // tool_use block per call.
  const toolAcc = new ToolCallAccumulator();
  const toolMeta = new Map<number, { id: string; name: string }>();
  let toolIndex: number | null = null;
  let streamError: string | null = null;
  const reader = upstream.getReader();

  function emit(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
    controller.enqueue(enc.encode(sse(event, data)));
  }

  function startEvents(controller: ReadableStreamDefaultController<Uint8Array>) {
    emit(controller, "message_start", {
      type: "message_start",
      message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inTokens, output_tokens: 0 } },
    });
    started = true;
  }

  function closeBlock(controller: ReadableStreamDefaultController<Uint8Array>) {
    if (block === "thinking") {
      emit(controller, "content_block_delta", { type: "content_block_delta", index, delta: { type: "signature_delta", signature: THINKING_SIGNATURE } });
    }
    if (block) emit(controller, "content_block_stop", { type: "content_block_stop", index });
    block = null;
  }

  function openBlock(
    controller: ReadableStreamDefaultController<Uint8Array>,
    kind: "thinking" | "text" | "tool_use",
    contentBlock?: unknown
  ) {
    // tool_use blocks are re-opened per call index (the caller only asks
    // when the index changed); thinking/text dedupe on the same kind.
    if (block === kind && kind !== "tool_use") return;
    closeBlock(controller);
    index++;
    block = kind;
    const content_block =
      contentBlock ??
      (kind === "thinking" ? { type: "thinking", thinking: "", signature: "" } : { type: "text", text: "" });
    emit(controller, "content_block_start", { type: "content_block_start", index, content_block });
  }

  function handleLine(line: string, controller: ReadableStreamDefaultController<Uint8Array>) {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let obj: {
      choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: unknown; code?: unknown };
    };
    try { obj = JSON.parse(data); } catch { return; }
    // An upstream error frame mid-stream must surface, not silently end
    // the stream with a fake success.
    if (obj.error && typeof obj.error === "object") {
      throw new Error(
        typeof obj.error.message === "string" && obj.error.message
          ? obj.error.message
          : "upstream stream error"
      );
    }
    if (obj.usage) {
      if (typeof obj.usage.prompt_tokens === "number") inTokens = obj.usage.prompt_tokens;
      if (typeof obj.usage.completion_tokens === "number") outTokens = obj.usage.completion_tokens;
    }
    const ch = obj.choices?.[0];
    if (!started) startEvents(controller);
    const thought = ch?.delta?.reasoning_content;
    if (typeof thought === "string" && thought.length) {
      openBlock(controller, "thinking");
      emit(controller, "content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: thought } });
    }
    const piece = ch?.delta?.content;
    if (typeof piece === "string" && piece.length) {
      openBlock(controller, "text");
      emit(controller, "content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
    }
    // Tool-call deltas: stream the arguments as input_json_delta events.
    const toolDeltas = ch?.delta?.tool_calls;
    if (toolDeltas && toolDeltas.length > 0) {
      toolAcc.add(toolDeltas);
      for (const d of toolDeltas) {
        const i = d.index ?? 0;
        if (d.id) toolMeta.set(i, { ...(toolMeta.get(i) ?? { id: "", name: "" }), id: d.id });
        if (d.function?.name) toolMeta.set(i, { ...(toolMeta.get(i) ?? { id: "", name: "" }), name: (toolMeta.get(i)?.name ?? "") + d.function.name });
        if (toolIndex !== i || block !== "tool_use") {
          toolIndex = i;
          const meta = toolMeta.get(i) ?? { id: d.id ?? "", name: d.function?.name ?? "" };
          openBlock(controller, "tool_use", { type: "tool_use", id: meta.id, name: meta.name, input: {} });
        }
        if (d.function?.arguments) {
          emit(controller, "content_block_delta", {
            type: "content_block_delta",
            index,
            delta: { type: "input_json_delta", partial_json: d.function.arguments },
          });
        }
      }
    }
    if (ch?.finish_reason) stopReason = mapStopReason(ch.finish_reason);
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split("\n");
            buf = parts.pop() ?? "";
            for (const line of parts) handleLine(line, controller);
          }
          if (buf.trim()) handleLine(buf, controller);
        } catch (err) {
          // An upstream error frame (or a read abort) surfaces as an
          // Anthropic error event — not as a fake clean message_stop.
          streamError = err instanceof Error ? err.message : String(err);
        }
        try {
          if (streamError) {
            emit(controller, "error", { type: "error", error: { type: "api_error", message: streamError } });
            controller.close();
            return;
          }
          if (!started) startEvents(controller);
          if (index < 0) openBlock(controller, "text");
          closeBlock(controller);
          emit(controller, "message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outTokens } });
          emit(controller, "message_stop", { type: "message_stop" });
          controller.close();
        } catch {
          /* already closed */
        }
      })();
    },
  });
}
