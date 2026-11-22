// "Send from itaOS" for the Actions cards (22 Nov 2026).
// Inside WhatsApp's 24-hour window (the customer wrote in the last 24 h) it sends the draft as a normal message.
// Outside it, WhatsApp only accepts a template Meta approved, so it shows the business's approved template for
// this list with the customer's name filled in, and sends that after the owner confirms. Either way, onSent
// runs so the card can record the follow-up as Sent (and the Home "Money itaOS brought back" card can count it).
import { useEffect, useState } from "react";
import { supabase, callFn, Workspace, canManage, canSend } from "./lib";
import { useKept } from "./keep";

export type Purpose = "after_price" | "reorder" | "promise";
export type Template = { id: string; name: string; language: string; purpose: Purpose | "custom"; body: string; params: string[]; status: string; reason: string | null; category: string; synced_at?: string | null };

const WINDOW = 24 * 3600e3;

/** The business's templates, kept while the app is open. */
export function useTemplates(ws: Workspace) {
  const [list, setList] = useKept<Template[] | null>("templates:" + ws.id, null);
  useEffect(() => {
    let live = true;
    supabase.from("wa_templates").select("*").eq("workspace_id", ws.id).order("created_at", { ascending: false })
      .then(({ data }) => { if (live && data) setList(data as Template[]); });
    return () => { live = false; };
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return list ?? [];
}

/** First name the way wa-send fills {{1}} — only for the preview; the server decides what is sent. */
function firstName(s: string | null | undefined) {
  const head = String(s ?? "").split(/[·|•,(]/)[0].trim();
  const w = head.split(/\s+/).find((x) => /^[\p{L}'’]{2,}$/u.test(x));
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : null;
}

export function SendNow({ ws, conversationId, purpose, draft, name, product, T, onSent }: {
  ws: Workspace; conversationId: string; purpose: Purpose; draft: string | null | undefined; name: string | null | undefined; product?: string | null;
  T: (en: string, sw: string) => string; onSent: (sentText: string) => void | Promise<void>;
}) {
  const templates = useTemplates(ws);
  const tpl = templates.find((t) => t.purpose === purpose && t.status === "APPROVED") ?? null;
  const pending = templates.some((t) => t.purpose === purpose && t.status === "PENDING");
  const [open, setOpen] = useState<null | "text" | "template">(null);   // what will be sent, once checked
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (!canManage(ws) || !canSend(ws)) return null;

  async function check() {
    setBusy(true); setMsg("");
    const { data } = await supabase.from("messages").select("sent_at").eq("conversation_id", conversationId).eq("direction", "in").order("sent_at", { ascending: false }).limit(1);
    setBusy(false);
    const last = data?.[0]?.sent_at ? Date.parse(data[0].sent_at) : 0;
    const inWindow = !!last && Date.now() - last < WINDOW;
    if (inWindow && draft?.trim()) { setOpen("text"); return; }
    if (inWindow) { setMsg(T("They wrote in the last 24 hours, so you can send any message. Ask Kito for a draft or write one first.", "Ameandika ndani ya saa 24, hivyo unaweza kutuma ujumbe wowote. Muombe Kito rasimu au andika kwanza.")); return; }
    if (tpl) { setOpen("template"); return; }
    setMsg(pending
      ? T("More than 24 hours since they wrote, so WhatsApp needs an approved template. Yours is still waiting for WhatsApp's review.", "Zimepita saa 24 tangu aandike, hivyo WhatsApp inahitaji kiolezo kilichoidhinishwa. Chako bado kinasubiri ukaguzi wa WhatsApp.")
      : T("More than 24 hours since they wrote, so WhatsApp only allows an approved template. Create one in Settings → Rules → Messages after 24 hours, or send from the WhatsApp app.", "Zimepita saa 24 tangu aandike, hivyo WhatsApp inaruhusu kiolezo kilichoidhinishwa tu. Tengeneza kwenye Mipangilio → Kanuni → Jumbe baada ya saa 24, au tuma kutoka app ya WhatsApp."));
  }

  async function send() {
    setBusy(true); setMsg("");
    try {
      const r = await callFn<{ ok: boolean; body?: string; error?: string }>("wa-send", open === "template"
        ? { workspace_id: ws.id, conversation_id: conversationId, template_id: tpl!.id }
        : { workspace_id: ws.id, conversation_id: conversationId, text: draft });
      if ((r as any)?.error) throw new Error((r as any).error);
      setOpen(null);
      await onSent(r?.body ?? (open === "text" ? String(draft) : preview));
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }

  const who = firstName(name) ?? (tpl?.language.startsWith("en") ? "there" : "ndugu");
  const preview = tpl ? tpl.body.replace(/\{\{(\d+)\}\}/g, (_, n) => (tpl.params[Number(n) - 1] === "product" ? (product?.split(",")[0]?.trim() || "bidhaa zetu") : who)) : "";

  return (
    <div className="sendnow">
      {!open && <button className="pc-pick sn-go" disabled={busy} onClick={check} title={T("Sends from your WhatsApp number and marks it Sent", "Inatuma kutoka namba yako ya WhatsApp na kuweka Nimetuma")}>{busy && <span className="kito-spin sm" aria-hidden />}{T("Send from itaOS", "Tuma kutoka itaOS")}</button>}
      {open === "text" && (
        <div className="sn-confirm">
          <span className="small muted">{T("They wrote in the last 24 hours: your draft goes out as it is.", "Ameandika ndani ya saa 24: rasimu yako itatumwa kama ilivyo.")}</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" disabled={busy} onClick={send}>{busy && <span className="kito-spin sm" aria-hidden />}{T("Send now", "Tuma sasa")}</button>
            <button className="linkish small" disabled={busy} onClick={() => setOpen(null)}>{T("Cancel", "Ghairi")}</button>
          </div>
        </div>
      )}
      {open === "template" && tpl && (
        <div className="sn-confirm">
          <span className="small muted">{T("More than 24 hours since they wrote, so WhatsApp only allows your approved message. This is what they'll get (a small WhatsApp fee applies):", "Zimepita saa 24 tangu aandike, hivyo WhatsApp inaruhusu ujumbe wako ulioidhinishwa tu. Atapokea huu (WhatsApp inatoza ada ndogo):")}</span>
          <blockquote className="sn-preview">{preview}</blockquote>
          <span className="small muted">{T("When they reply, the 24 hours open again and you can send Kito's draft.", "Akijibu, saa 24 zinafunguka tena na unaweza kutuma rasimu ya Kito.")}</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" disabled={busy} onClick={send}>{busy && <span className="kito-spin sm" aria-hidden />}{T("Send this", "Tuma huu")}</button>
            <button className="linkish small" disabled={busy} onClick={() => setOpen(null)}>{T("Cancel", "Ghairi")}</button>
          </div>
        </div>
      )}
      {msg && <div className="small err">{msg}</div>}
    </div>
  );
}
