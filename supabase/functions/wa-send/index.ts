// Send a WhatsApp reply from itaOS (owners and admins only).
//
// Goes out from the business's own number through Dualhook's runtime
// (POST https://api.dualhook.com/v25.0/<PHONE_NUMBER_ID>/messages, Bearer dh_live_… key the owner
// saved on the Connect page). With Coexistence the reply also appears in the WhatsApp Business app.
// WhatsApp only allows free-form replies inside the 24-hour customer service window (24 h after the
// customer's last message); outside it this refuses, because only approved templates may be sent.
// Every message sent here is saved with origin "itaos" and the sender's user id.
// Templates (22 Nov 2026): with template_id, sends an approved WhatsApp template instead (allowed any time).
// itaOS fills the placeholders itself: {{1}} = the customer's first name, {{2}} = the product they last bought.
import { admin, userClient, json, cors, reanalyze, readToken } from "../_shared/db.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const DUALHOOK = "https://api.dualhook.com/v25.0";
const WINDOW_MS = 24 * 3600e3;
const LIMIT = { chatPerMinute: 6, perMinute: 20, perHour: 300 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const ws = String(body.workspace_id ?? "");
  const convId = String(body.conversation_id ?? "");
  const text = String(body.text ?? "").replace(/\r\n/g, "\n").trim();
  const templateId = body.template_id ? String(body.template_id) : null;
  if (!/^[0-9a-f-]{36}$/i.test(ws) || !/^[0-9a-f-]{36}$/i.test(convId)) return json({ error: "workspace_id and conversation_id required" }, 400);
  if (templateId && !/^[0-9a-f-]{36}$/i.test(templateId)) return json({ error: "Bad template." }, 400);
  if (!text && !templateId) return json({ error: "Write a message first." }, 400);
  if (text.length > 4096) return json({ error: "WhatsApp messages can be at most 4,096 characters." }, 400);

  const uc = userClient(req);
  const [{ data: ok }, { data: user }] = await Promise.all([uc.rpc("can_manage", { ws }), uc.auth.getUser()]);
  if (!ok || !user?.user) return json({ error: "Only the owner or an admin can send WhatsApp messages from itaOS." }, 403);

  const db = admin();
  const { data: w } = await db.from("workspaces").select("send_enabled").eq("id", ws).maybeSingle();
  if (w && w.send_enabled === false) return json({ error: "Sending from itaOS is turned off for this business (Settings)." }, 403);
  const { data: st } = await db.from("workspace_admin_state").select("status").eq("workspace_id", ws).maybeSingle();
  if (st?.status === "suspended") return json({ error: "This itaOS account is paused. Contact Pondi Technologies (hello@ponditech.com)." }, 403);
  const { data: conv } = await db.from("conversations").select("id,phone_number_id,contacts(wa_id,name,full_name,not_customer)").eq("id", convId).eq("workspace_id", ws).maybeSingle();
  if (!conv) return json({ error: "Chat not found." }, 404);
  const to = String((conv as any).contacts?.wa_id ?? "").replace(/\D/g, "");
  if (conv.phone_number_id === "import" || !to) return json({ error: "This chat came from an uploaded file, so it can't be answered from itaOS." }, 400);

  const { data: lastIn } = await db.from("messages").select("sent_at").eq("conversation_id", convId).eq("direction", "in").order("sent_at", { ascending: false }).limit(1);
  const lastInAt = lastIn?.[0]?.sent_at ? Date.parse(lastIn[0].sent_at) : 0;
  if (!templateId && (!lastInAt || Date.now() - lastInAt > WINDOW_MS)) {
    return json({ error: "More than 24 hours since the customer's last message. WhatsApp only allows approved template messages now; reply from the WhatsApp app.", window_closed: true }, 409);
  }

  // Send limits (21 Nov 2026): far above a person typing replies, but stops a burst (a stuck button,
  // a script, a stolen login) from flooding customers and getting the number blocked by WhatsApp.
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const sentSince = (since: string, conv?: string) => {
    let q = db.from("messages").select("id", { count: "exact", head: true })
      .eq("workspace_id", ws).eq("direction", "out").eq("origin", "itaos").gte("sent_at", since);
    if (conv) q = q.eq("conversation_id", conv);
    return q.then(({ count }) => count ?? 0);
  };
  const [perChatMin, perMin, perHour] = await Promise.all([sentSince(ago(60e3), convId), sentSince(ago(60e3)), sentSince(ago(3600e3))]);
  if (perChatMin >= LIMIT.chatPerMinute) return json({ error: "Too many messages to this customer in a minute. Wait a moment, then send again.", rate_limited: true }, 429);
  if (perMin >= LIMIT.perMinute) return json({ error: "Too many messages sent in the last minute. Wait a moment, then send again.", rate_limited: true }, 429);
  if (perHour >= LIMIT.perHour) return json({ error: "This business has sent the most messages allowed in an hour from itaOS. Try again later, or reply from the WhatsApp app.", rate_limited: true }, 429);

  const key = await dualhookKey(db, ws);
  if (!key) return json({ error: "Add your Dualhook API key (dh_live_…) on the Connections page to send from itaOS." }, 400);

  // Template: fill the placeholders from what itaOS knows about this customer.
  let payload: Record<string, unknown> = { type: "text", text: { body: text, preview_url: false } };
  let saved = { type: "text", body: text, raw: {} as Record<string, unknown> };
  if (templateId) {
    const ct = (conv as any).contacts ?? {};
    if (ct.not_customer) return json({ error: "This contact is marked Not a customer." }, 400);
    const { data: t } = await db.from("wa_templates").select("*").eq("id", templateId).eq("workspace_id", ws).maybeSingle();
    if (!t) return json({ error: "Template not found." }, 404);
    if (t.status !== "APPROVED") return json({ error: "WhatsApp hasn't approved this template yet." }, 409);
    const en = String(t.language).startsWith("en");
    const values: string[] = [];
    for (const p of (t.params ?? []) as string[]) {
      if (p === "name") values.push(firstName(ct.full_name) ?? firstName(ct.name) ?? (en ? "there" : "ndugu"));
      else if (p === "product") {
        const { data: o } = await db.from("orders").select("product,items").eq("conversation_id", convId).eq("status", "paid").order("paid_at", { ascending: false }).limit(1);
        const prod = o?.[0]?.product || ((o?.[0]?.items ?? []) as any[]).map((i) => i?.name).filter(Boolean).join(", ");
        values.push(clean(prod) || (en ? "our products" : "bidhaa zetu"));
      } else return json({ error: "This template has a blank itaOS can't fill. Use one made in itaOS." }, 400);
    }
    payload = { type: "template", template: { name: t.name, language: { code: t.language }, components: values.length ? [{ type: "body", parameters: values.map((v) => ({ type: "text", text: v })) }] : [] } };
    saved = { type: "template", body: String(t.body).replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => values[Number(n) - 1] ?? ""), raw: { template: t.name, template_id: t.id, params: values } };
  }

  const res = await fetch(`${DUALHOOK}/${encodeURIComponent(conv.phone_number_id)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
  }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok || out.error) {
    const e = out.error ?? {};
    console.error("wa-send failed", res?.status, e.code, String(e.message ?? "").slice(0, 160));
    const msg = e.code === 131047 ? "More than 24 hours since the customer's last message. Reply from the WhatsApp app."
      : e.code === 131042 ? "WhatsApp needs a payment method on your WhatsApp Business account before it sends templates (Meta Business Settings → WhatsApp account → Payment settings)."
      : e.code === 131049 ? "WhatsApp held this back so customers don't get too many business messages. Try again in a few days."
      : e.code === 132001 || e.code === 132000 ? "WhatsApp doesn't know this template (or its language). Refresh templates in Settings."
      : e.code === 132015 || e.code === 132016 ? "WhatsApp has paused or turned off this template. Check it in Settings."
      : res?.status === 401 || res?.status === 403 ? "Dualhook refused the key. Save it again on the Connections page."
      : `WhatsApp didn't accept the message${e.message ? `: ${String(e.message).slice(0, 160)}` : "."}`;
    return json({ error: msg, code: e.code ?? null }, 502);
  }
  const id = out.messages?.[0]?.id;
  if (!id) return json({ error: "WhatsApp gave no message id; check the chat in WhatsApp." }, 502);

  const now = new Date().toISOString();
  const { error } = await db.from("messages").upsert({
    id, workspace_id: ws, conversation_id: convId, direction: "out", origin: "itaos", sent_at: now, type: saved.type, body: saved.body,
    raw: { sent_via: "itaos", to, ...saved.raw }, sent_by: user.user.id,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) console.error("wa-send: sent but not saved", error.message);
  await reanalyze(db, [convId]).catch((e) => console.error("wa-send reanalyze", String(e?.message ?? e).slice(0, 160)));
  return json({ ok: true, id, sent_at: now, body: saved.body, template: !!templateId });
});

/** The business's Dualhook API key (same as _shared/media.ts dualhookKey; kept here so this function stays small). */
async function dualhookKey(db: SupabaseClient, ws: string): Promise<string | null> {
  const { data } = await db.from("connections").select("meta").eq("workspace_id", ws).eq("provider", "whatsapp").eq("meta->>via", "dualhook").maybeSingle();
  const id = data?.meta?.api_key_secret_id;
  if (!id) return null;
  try { return await readToken(db, id); } catch { return null; }
}
/** Template text can't have new lines, tabs or 4+ spaces in a row. */
function clean(s: string | null | undefined) { return String(s ?? "").replace(/[\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 60); }
/** First real name from "Stephen J. Masele · Kayani · Dar es Salaam" → "Stephen"; null if it's only a number or tags. */
function firstName(s: string | null | undefined): string | null {
  const head = String(s ?? "").split(/[·|•,(]/)[0].trim();
  const w = head.split(/\s+/).find((x) => /^[\p{L}'’]{2,}$/u.test(x));
  if (!w) return null;
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}
