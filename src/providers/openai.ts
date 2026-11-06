/** OpenAI adapter — OpenAI-compatible (thin) + native passthrough. */

import type { OpenAIChatRequest, ProviderAdapter } from "./types";
import { stripProviderPrefix } from "./types";

const BASE = "https://api.openai.com";

/** Build an OpenAI-compatible chat adapter against `base`. The default
 * export is the OpenAI one; custom OpenAI-compatible services reuse this
 * factory with their own base URL (see providers/custom.ts). */
export function makeOpenAIAdapter(base: string, name: "openai" | "custom" = "openai"): ProviderAdapter {
  const adapter: ProviderAdapter = {
    name,

    models(): string[] {
      // Custom services have no static list (their models come from the
      // service's own /v1/models); the OpenAI list stays on the real one.
      return name === "custom" ? [] : ["gpt-4o", "gpt-4o-mini", "gpt-5", "gpt-5-mini", "o3-mini", "o4-mini"];
    },

    async chatCompletions(req: OpenAIChatRequest, key: string): Promise<Response> {
      const body: OpenAIChatRequest = {
        ...req,
        model: stripProviderPrefix(req.model),
      };
      // Reasoning models (o-series, gpt-5) reject `max_tokens`; they take
      // `max_completion_tokens` (which the gateway folds into max_tokens on entry).
      // Only set it when the caller didn't already supply one.
      if (/^(o[1-9]|gpt-5)/.test(String(body.model)) && typeof body.max_tokens === "number" && typeof body.max_completion_tokens !== "number") {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
      }
      return fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });
    },

    async passthrough(subPath: string, req: Request, key: string): Promise<Response> {
      const url = `${base}${subPath}`;
      const headers = new Headers(req.headers);
      headers.set("Authorization", `Bearer ${key}`);
      // Strip hop-by-host headers so the upstream origin resolves correctly.
      headers.delete("host");
      headers.delete("content-length");
      headers.delete("cookie");
      headers.delete("x-goog-api-key");
      headers.delete("x-api-key");

      const method = req.method.toUpperCase();
      const hasBody = method !== "GET" && method !== "HEAD";

      return fetch(url, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
      });
    },
  };
  return adapter;
}

const openai: ProviderAdapter = makeOpenAIAdapter(BASE);

export default openai;
