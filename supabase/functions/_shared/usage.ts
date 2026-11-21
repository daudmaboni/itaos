// Pure helpers for api_usage rows (no imports, so web tests can load them too).
export type Feature = "ask_kito" | "chat_analysis" | "reply_draft" | "content_ideas" | "receipt_reading" | "product_matching" | "voice_transcription" | "name_reading";
export type UsageMeta = { feature: Feature; workspaceId: string | null; attempt?: number };

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/** Usage row from an API response body (exported for tests). */
export function usageRow(meta: UsageMeta, model: string, status: number | null, ok: boolean, body: any, ms: number, requestId: string | null) {
  const u = body?.usage ?? {};
  return {
    workspace_id: meta.workspaceId, feature: meta.feature, model: String(model || body?.model || "unknown").slice(0, 100),   // the id we asked for, so it matches api_pricing
    input_tokens: int(u.input_tokens), output_tokens: int(u.output_tokens),
    cache_read_tokens: int(u.cache_read_input_tokens), cache_write_tokens: int(u.cache_creation_input_tokens),
    ok, status, error: ok ? null : String(body?.error?.message ?? (status == null ? "network error" : `HTTP ${status}`)).slice(0, 300),
    attempt: Math.max(1, meta.attempt ?? 1), duration_ms: Math.round(ms), request_id: requestId,
  };
}

