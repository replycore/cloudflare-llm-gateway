/** Custom OpenAI-compatible service adapter.
 *
 * A custom service is just an OpenAI-compatible endpoint at a user-supplied
 * base URL (e.g. a self-hosted relay). There is no static model list and no
 * fixed base URL, so the adapter is built per key from the key row's stored
 * `base_url` — see `makeCustomAdapter`. The registry's default export is a
 * placeholder whose chat/passthrough throw: calling it means the caller
 * forgot to resolve the key's base URL, and silently sending the request to
 * api.openai.com would be worse than failing loudly.
 */

import type { ProviderAdapter } from "./types";
import { makeOpenAIAdapter } from "./openai";

/**
 * Normalize a user-pasted base URL into the stored origin: trim, drop
 * trailing slashes, and strip a trailing `/v1` (callers append `/v1/...`
 * themselves). Accepts both `https://host` and `https://host/v1`; a deeper
 * path (e.g. `https://host/api/v1`) keeps its prefix. Returns "" for a
 * non-http(s) URL.
 */
export function normalizeBaseUrl(raw: string): string {
  const s = (raw || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) return "";
  return s.endsWith("/v1") ? s.slice(0, -"/v1".length) : s;
}

/** A custom service is valid only when its slug is URL/model-id safe:
 * lowercase letters, digits, hyphens; must start with a letter or digit. */
export function isValidServiceSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(slug || "");
}

/** Build the adapter for one custom service from its stored base URL. */
export function makeCustomAdapter(baseUrl: string): ProviderAdapter {
  return makeOpenAIAdapter(normalizeBaseUrl(baseUrl), "custom");
}

const custom: ProviderAdapter = {
  name: "custom",

  models(): string[] {
    return [];
  },

  async chatCompletions(): Promise<Response> {
    throw new Error("custom provider needs a base_url: build the adapter with makeCustomAdapter(key.base_url)");
  },

  async passthrough(): Promise<Response> {
    throw new Error("custom provider needs a base_url: build the adapter with makeCustomAdapter(key.base_url)");
  },
};

export default custom;
