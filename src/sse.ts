/**
 * Shared helpers for re-shaping an OpenAI chat-completion SSE stream into
 * another protocol's stream (Responses API, Gemini streamGenerateContent).
 */

export interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Read an OpenAI SSE body and call `onChunk` for every parsed
 * `chat.completion.chunk`. Resolves when the upstream ends.
 *
 * An upstream error frame (`{"error": {...}}` mid-stream) or a read error is
 * NOT swallowed: the error is thrown so the caller can surface it instead of
 * ending the stream with a fake success (the old code silently completed the
 * stream, leaving the client with a truncated answer and no error).
 */
export async function forEachOpenAIChunk(
  upstream: ReadableStream<Uint8Array>,
  onChunk: (c: OpenAIChunk) => void
): Promise<void> {
  const reader = upstream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const handle = (line: string) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      /* skip malformed frame */
      return;
    }
    const err = (parsed as { error?: { message?: unknown; code?: unknown } }).error;
    if (err && typeof err === "object") {
      throw new Error(
        typeof err.message === "string" && err.message
          ? err.message
          : `upstream stream error${typeof err.code === "string" ? `: ${err.code}` : ""}`
      );
    }
    onChunk(parsed as OpenAIChunk);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) handle(l);
    }
    if (buf.trim()) handle(buf);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/** Accumulates streamed tool_call deltas by index. */
export class ToolCallAccumulator {
  private calls = new Map<number, { id: string; name: string; args: string }>();

  add(deltas: NonNullable<NonNullable<OpenAIChunk["choices"]>[number]["delta"]>["tool_calls"]): void {
    for (const d of deltas ?? []) {
      const i = d.index ?? 0;
      const cur = this.calls.get(i) ?? { id: "", name: "", args: "" };
      if (d.id) cur.id = d.id;
      if (d.function?.name) cur.name += d.function.name;
      if (d.function?.arguments) cur.args += d.function.arguments;
      this.calls.set(i, cur);
    }
  }

  list(): Array<{ id: string; name: string; args: string }> {
    return [...this.calls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }
}

export function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let hex = "";
  for (const b of a) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Collapse a message's content — plain string or an array of content parts —
 * into one text string. Non-text parts (images, files) contribute nothing.
 * Shared by the Anthropic, Responses and Gemini translators so the three
 * don't drift (they previously joined with different separators, or counted
 * image parts).
 */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          const part = p as { type?: unknown; text?: unknown };
          if (typeof part.text === "string") return part.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Pull a readable message out of an OpenAI-shaped error response. */
export async function upstreamErrorMessage(res: Response): Promise<string> {  const text = await res.text().catch(() => "");
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
  } catch {
    return text || `upstream ${res.status}`;
  }
}

export const KEYPOOL_HEADERS = ["X-KeyPool-Provider", "X-KeyPool-Model", "X-KeyPool-Fallback"];

export function passKeypoolHeaders(from: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of KEYPOOL_HEADERS) {
    const v = from.headers.get(h);
    if (v) out[h] = v;
  }
  return out;
}
