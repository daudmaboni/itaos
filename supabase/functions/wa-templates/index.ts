// WhatsApp templates for follow-ups after the 24-hour window (22 Nov 2026).
// Templates live on the business's own WhatsApp Business Account. itaOS creates and reads them with the Meta
// system-user token the business saved for "Send sales to Meta" (it has whatsapp_business_management), straight
// at graph.facebook.com — Dualhook isn't needed for this part. Sending goes through wa-send (Dualhook).
//
//   action "list"   (any member): refresh statuses from Meta, return the business's templates.
//   action "create" (owner / manager): { purpose, body, language? } → submit to Meta for review.
//   action "delete" (owner / manager): { id } → delete on Meta and here.
// Body placeholders: {{1}} = customer's first name, {{2}} = product they bought (reorder only).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors } });
const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") ?? "v25.0"}`;
const PURPOSES = ["after_price", "reorder", "promise", "custom"] as const;
const EXAMPLE: Record<string, string> = { name: "Asha", product: "KayaTox", text: "mfano" };

async function graph(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${GRAPH}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } }).catch(() => null);
  if (!res) return { ok: false, body: { error: { message: "network error" } } as any };
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && !body?.error, body };
}
const metaError = (b: any) => {
  const e = b?.error ?? {};
  return `${e.error_user_msg || e.message || "Meta refused the request"}${e.code ? ` (code ${e.code}${e.error_subcode ? "/" + e.error_subcode : ""})` : ""}`.slice(0, 400);
};
/** {{1}}, {{2}} … in order of number; returns the highest number used. */
const maxVar = (s: string) => Math.max(0, ...[...s.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const ws = String(body.workspace_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(ws)) return json({ error: "workspace_id required" }, 400);
  const action = String(body.action ?? "list");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const need = action === "list" ? "is_member" : "can_manage";
  const [{ data: ok }, { data: who }] = await Promise.all([uc.rpc(need, { ws }), uc.auth.getUser()]);
  if (ok !== true) return json({ error: need === "is_member" ? "Not a member of this business." : "Only the owner or a manager can change templates." }, 403);

  // The WhatsApp account and the token that can manage its templates.
  const { data: wa } = await db.from("connections").select("meta").eq("workspace_id", ws).eq("provider", "whatsapp").eq("status", "active");
  const waba = (wa ?? []).map((c: any) => c.meta?.waba_id).find(Boolean) as string | undefined;
  const { data: capi } = await db.from("connections").select("meta,status").eq("workspace_id", ws).eq("provider", "meta_capi").maybeSingle();
  let token = "";
  if (capi?.meta?.token_secret_id) {
    try { const { data } = await db.rpc("svc_read_token", { p_secret_id: capi.meta.token_secret_id }); token = String(data ?? ""); } catch { token = ""; }
  }
  const rows = async () => (await db.from("wa_templates").select("*").eq("workspace_id", ws).order("created_at", { ascending: false })).data ?? [];
  const setup = !waba ? "no_whatsapp" : !token ? "no_token" : null;

  if (action === "list") {
    if (setup) return json({ templates: await rows(), setup });
    const r = await graph(`${waba}/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=200`, token);
    if (!r.ok) return json({ templates: await rows(), setup: null, error: metaError(r.body) });
    const mine = await rows();
    const seen = new Set<string>();
    for (const t of (r.body?.data ?? []) as any[]) {
      const text = String((t.components ?? []).find((c: any) => c.type === "BODY")?.text ?? "");
      const old = mine.find((m: any) => m.meta_id === t.id || (m.name === t.name && m.language === t.language));
      const n = maxVar(text);
      const row = {
        workspace_id: ws, waba_id: waba, name: t.name, language: t.language, category: t.category ?? "MARKETING",
        purpose: old?.purpose ?? "custom", body: text || old?.body || "", params: old?.params ?? Array.from({ length: n }, () => "text"),
        meta_id: t.id, status: t.status ?? "PENDING", reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
        synced_at: new Date().toISOString(),
      };
      seen.add(`${t.name}|${t.language}`);
      await db.from("wa_templates").upsert(row, { onConflict: "workspace_id,waba_id,name,language" });
    }
    // Deleted on Meta's side: drop ours too (only ones Meta knew about).
    const gone = mine.filter((m: any) => m.meta_id && m.waba_id === waba && !seen.has(`${m.name}|${m.language}`)).map((m: any) => m.id);
    if (gone.length) await db.from("wa_templates").delete().in("id", gone);
    return json({ templates: await rows(), setup: null });
  }

  if (setup) return json({ error: setup === "no_whatsapp" ? "Connect WhatsApp first." : "Save the Meta token on Connections → Send sales to Meta first. The same token lets itaOS create WhatsApp templates.", setup }, 400);

  if (action === "create") {
    const purpose = String(body.purpose ?? "custom");
    if (!PURPOSES.includes(purpose as any)) return json({ error: "Unknown purpose." }, 400);
    const text = String(body.body ?? "").replace(/\r\n/g, "\n").trim();
    const language = String(body.language ?? "sw").trim() || "sw";
    if (text.length < 20) return json({ error: "Write the message first (at least a sentence)." }, 400);
    if (text.length > 1024) return json({ error: "Templates can be at most 1,024 characters." }, 400);
    const n = maxVar(text);
    const params: string[] = purpose === "reorder" ? ["name", "product"] : n >= 1 ? ["name", ...Array.from({ length: n - 1 }, () => "text")] : [];
    if (purpose !== "custom" && !text.includes("{{1}}")) return json({ error: "Put {{1}} where the customer's name goes." }, 400);
    if (purpose === "reorder" && !text.includes("{{2}}")) return json({ error: "Put {{2}} where the product they bought goes." }, 400);
    if (/^\s*\{\{\d+\}\}|\{\{\d+\}\}[\s.!?]*$/.test(text)) return json({ error: "WhatsApp doesn't allow a {{…}} at the very start or end. Add words before and after it." }, 400);
    for (let i = 1; i <= n; i++) if (!text.includes(`{{${i}}}`)) return json({ error: `{{${i}}} is missing. Number them 1, 2, … in order.` }, 400);
    const name = `itaos_${purpose}_${Date.now().toString(36)}`;
    const components: any[] = [{ type: "BODY", text, ...(n ? { example: { body_text: [params.slice(0, n).map((p) => EXAMPLE[p] ?? "mfano")] } } : {}) }];
    const r = await graph(`${waba}/message_templates`, token, { method: "POST", body: JSON.stringify({ name, language, category: "MARKETING", components }) });
    if (!r.ok) return json({ error: metaError(r.body) }, 502);
    const { data: saved, error } = await db.from("wa_templates").insert({
      workspace_id: ws, waba_id: waba, name, language, category: r.body?.category ?? "MARKETING", purpose, body: text, params,
      meta_id: r.body?.id ?? null, status: r.body?.status ?? "PENDING", created_by: who?.user?.id ?? null, synced_at: new Date().toISOString(),
    }).select().single();
    if (error) return json({ error: `Sent to Meta but not saved here: ${error.message}` }, 500);
    return json({ template: saved });
  }

  if (action === "delete") {
    const id = String(body.id ?? "");
    const { data: t } = await db.from("wa_templates").select("*").eq("id", id).eq("workspace_id", ws).maybeSingle();
    if (!t) return json({ error: "Template not found." }, 404);
    if (t.meta_id) {
      const r = await graph(`${t.waba_id}/message_templates?name=${encodeURIComponent(t.name)}&hsm_id=${encodeURIComponent(t.meta_id)}`, token, { method: "DELETE" });
      if (!r.ok && !/does not exist|not found/i.test(metaError(r.body))) return json({ error: metaError(r.body) }, 502);
    }
    await db.from("wa_templates").delete().eq("id", id);
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
