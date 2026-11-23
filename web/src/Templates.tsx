// Settings → Rules → "Messages after 24 hours" (22 Nov 2026).
// WhatsApp only lets a business message a customer more than 24 hours after the customer's last message with a
// template Meta has approved. One template per Actions list (After price, Reorders, Promises), written in the
// business's own words; itaOS submits it to Meta on the business's own WhatsApp account and shows the review result.
// {{1}} = the customer's first name, {{2}} = the product they bought (Reorders). itaOS fills them when sending.
import { useEffect, useState } from "react";
import { callFn, Workspace, canManage, ago } from "./lib";
import type { Template, Purpose } from "./SendNow";
import { useKept } from "./keep";

type Tr = (en: string, sw: string) => string;
type ListRes = { templates: Template[]; setup: "no_whatsapp" | "no_token" | null; error?: string };

const PURPOSES: Purpose[] = ["after_price", "reorder", "promise"];

/** Starting text for each list, in plain Swahili, with the business's name. The owner edits before submitting. */
function starter(p: Purpose, biz: string, sw: boolean) {
  if (!sw) return {
    after_price: `Hello {{1}}, this is ${biz}. A few days ago you asked about our products. Is there anything else you'd like to know before you order? Just reply to this message and we'll help you.`,
    reorder: `Hello {{1}}, this is ${biz}. It's been a while since you got {{2}} from us. How is it going? If you'd like to order again, just reply to this message.`,
    promise: `Hello {{1}}, this is ${biz}. Just a reminder about the order we talked about. Whenever you're ready, reply to this message and we'll sort it out for you.`,
  }[p];
  return {
    after_price: `Habari {{1}}, ni ${biz} hapa. Siku chache zilizopita uliuliza kuhusu bidhaa zetu. Kuna kitu chochote ungependa kujua kabla ya kuagiza? Jibu ujumbe huu tukusaidie.`,
    reorder: `Habari {{1}}, ni ${biz} hapa. Ni muda sasa tangu uchukue {{2}} kwetu. Unaendeleaje nayo? Ukihitaji kuagiza tena, jibu ujumbe huu tukuhudumie.`,
    promise: `Habari {{1}}, ni ${biz} hapa. Tunakukumbusha kuhusu oda tuliyozungumza. Ukiwa tayari, jibu ujumbe huu tukuhudumie.`,
  }[p];
}

export default function Templates({ ws, T }: { ws: Workspace; T: Tr }) {
  const [res, setRes] = useKept<ListRes | null>("tpl-list:" + ws.id, null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const manager = canManage(ws);
  const load = async () => {
    setLoading(true); setErr("");
    try { setRes(await callFn<ListRes>("wa-templates", { workspace_id: ws.id, action: "list" })); }
    catch (e) { setErr((e as Error).message); }
    setLoading(false);
  };
  useEffect(() => { void load(); }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const label: Record<Purpose, [string, string]> = {
    after_price: [T("Went quiet after the price", "Wamenyamaza baada ya bei"), T("Actions → After price", "Actions → Baada ya bei")],
    reorder: [T("Bring past buyers back", "Warudishe wanunuzi wa zamani"), T("Actions → Reorders · {{2}} = what they bought", "Actions → Nunua tena · {{2}} = walichonunua")],
    promise: [T("Promise reminders", "Vikumbusho vya ahadi"), T("Actions → Promises", "Actions → Ahadi")],
  };
  const list = res?.templates ?? [];

  return (
    <section className="card tpl">
      <div className="row between">
        <div><h2>{T("Messages after 24 hours", "Jumbe baada ya saa 24")}</h2>
          <span className="small muted">{T("WhatsApp lets itaOS send any message only within 24 hours of the customer's last message. After that it only allows a message WhatsApp has approved. Write one for each list below; WhatsApp usually reviews it within minutes to a day. {{1}} becomes the customer's first name. Each one sent costs a small WhatsApp fee (about TZS 70).",
            "WhatsApp inaruhusu itaOS kutuma ujumbe wowote ndani ya saa 24 tu tangu ujumbe wa mwisho wa mteja. Baada ya hapo inaruhusu ujumbe ulioidhinishwa na WhatsApp tu. Andika mmoja kwa kila orodha hapa chini; WhatsApp hukagua ndani ya dakika chache hadi siku moja. {{1}} inakuwa jina la kwanza la mteja. Kila ujumbe unaotumwa una ada ndogo ya WhatsApp (takriban TZS 70).")}</span></div>
        <button className="linkish small" disabled={loading} onClick={load}>{loading && <span className="kito-spin sm" aria-hidden />}{T("Refresh", "Onyesha upya")}</button>
      </div>
      {err && <p className="err small">{err}</p>}
      {res?.error && <p className="err small">{T("WhatsApp said: ", "WhatsApp imesema: ")}{res.error}</p>}
      {res?.setup === "no_whatsapp" && <p className="small muted">{T("Connect WhatsApp first.", "Unganisha WhatsApp kwanza.")}</p>}
      {res?.setup === "no_token" && <p className="small">{T("itaOS needs the Meta token from ", "itaOS inahitaji tokeni ya Meta kutoka ")}<a href="#connect">{T("Connections → Send sales to Meta", "Connections → Tuma mauzo kwa Meta")}</a>{T(". The same token lets it create these messages on your WhatsApp account.", ". Tokeni hiyo hiyo inairuhusu kutengeneza jumbe hizi kwenye akaunti yako ya WhatsApp.")}</p>}
      {res && !res.setup && PURPOSES.map((p) => (
        <Slot key={p} ws={ws} T={T} purpose={p} title={label[p][0]} where={label[p][1]} manager={manager}
          items={list.filter((t) => t.purpose === p)} onChange={load} />
      ))}
      {res && !res.setup && list.some((t) => t.purpose === "custom") && (
        <p className="small muted" style={{ margin: 0 }}>{T(`Also on your WhatsApp account: ${list.filter((t) => t.purpose === "custom").map((t) => t.name).join(", ")} (made outside itaOS, not used here).`, `Pia kwenye akaunti yako ya WhatsApp: ${list.filter((t) => t.purpose === "custom").map((t) => t.name).join(", ")} (zimetengenezwa nje ya itaOS, hazitumiki hapa).`)}</p>
      )}
    </section>
  );
}

function Slot({ ws, T, purpose, title, where, items, manager, onChange }: { ws: Workspace; T: Tr; purpose: Purpose; title: string; where: string; items: Template[]; manager: boolean; onChange: () => Promise<void> }) {
  const sw = ws.language === "sw";
  const [text, setText] = useState(() => starter(purpose, ws.name, sw));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const live = items.find((t) => t.status === "APPROVED") ?? items[0] ?? null;

  async function submit() {
    setBusy("create"); setMsg("");
    try {
      await callFn("wa-templates", { workspace_id: ws.id, action: "create", purpose, body: text, language: sw ? "sw" : "en" });
      setEditing(false); await onChange();
    } catch (e) { setMsg((e as Error).message); }
    setBusy("");
  }
  async function remove(t: Template) {
    if (!confirm(T("Delete this message from your WhatsApp account? You can write a new one after.", "Futa ujumbe huu kwenye akaunti yako ya WhatsApp? Unaweza kuandika mpya baadaye."))) return;
    setBusy("del:" + t.id); setMsg("");
    try { await callFn("wa-templates", { workspace_id: ws.id, action: "delete", id: t.id }); await onChange(); }
    catch (e) { setMsg((e as Error).message); }
    setBusy("");
  }
  const chip = (s: string) => s === "APPROVED" ? <span className="chip ok">{T("Approved", "Imeidhinishwa")}</span>
    : s === "PENDING" ? <span className="chip">{T("Waiting for WhatsApp", "Inasubiri WhatsApp")}</span>
    : s === "REJECTED" ? <span className="chip bad">{T("Rejected", "Imekataliwa")}</span>
    : <span className="chip">{s.toLowerCase()}</span>;

  return (
    <div className="tpl-slot">
      <div className="row between"><b>{title}</b><span className="small muted">{where}</span></div>
      {items.map((t) => (
        <div className="tpl-item" key={t.id}>
          <div className="row between" style={{ gap: 8 }}>{chip(t.status)}
            {manager && <button className="linkish small danger-text" disabled={!!busy} onClick={() => remove(t)}>{busy === "del:" + t.id && <span className="kito-spin sm" aria-hidden />}{T("Delete", "Futa")}</button>}</div>
          <p className="tpl-body">{t.body}</p>
          {t.status === "REJECTED" && <span className="small err">{T("WhatsApp's reason: ", "Sababu ya WhatsApp: ")}{t.reason ?? T("not given", "haikutolewa")}. {T("Delete it and write a plainer version (no prices, links or pressure words).", "Ifute uandike toleo rahisi zaidi (bila bei, viungo au maneno ya kulazimisha).")}</span>}
          {t.status === "PENDING" && t.synced_at && <span className="small muted">{T("Sent for review", "Imetumwa kukaguliwa")} {ago(t.synced_at)}</span>}
        </div>
      ))}
      {manager && (!live || live.status === "REJECTED") && (editing ? (
        <div className="tpl-edit">
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={1024} />
          <span className="small muted">{T("Keep {{1}} for the name", "Acha {{1}} kwa jina")}{purpose === "reorder" ? T(" and {{2}} for the product", " na {{2}} kwa bidhaa") : ""}. {T("Write it like you'd text a customer: short, friendly, asks them to reply.", "Andika kama unavyomtumia mteja: mfupi, wa kirafiki, unaomwomba ajibu.")}</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" disabled={!!busy || text.trim().length < 20} onClick={submit}>{busy === "create" && <span className="kito-spin sm" aria-hidden />}{T("Send to WhatsApp for approval", "Tuma WhatsApp iidhinishe")}</button>
            <button className="linkish small" disabled={!!busy} onClick={() => setEditing(false)}>{T("Cancel", "Ghairi")}</button>
          </div>
        </div>
      ) : (
        <button className="pc-pick" onClick={() => setEditing(true)}>{items.length ? T("Write a new one", "Andika mpya") : T("Write this message", "Andika ujumbe huu")}</button>
      ))}
      {msg && <span className="small err">{msg}</span>}
    </div>
  );
}
