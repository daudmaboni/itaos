// Needs attention: one inbox for everything the business should act on now.
// Overdue follow-ups, payments detected but not confirmed, deliveries, failed syncs/imports and
// what is assigned to you. Data from needs_attention (0033) + webhook_health. Payment signals stay
// signals: confirming one happens in the chat, where the owner checks the money first.
import { useEffect, useState } from "react";
import { useKept } from "./keep";
import { enterCards, usePageEnter, select } from "./motion";
import { supabase, Workspace, L, amt, ago, canEdit } from "./lib";
import { AssignSelect, useTeam, shortName } from "./team";

type Overdue = { id: string; conversation_id: string; title: string; due_at: string | null; status: string; assigned_to: string | null; contact_name: string | null };
type Signal = { id: string; contact_name: string | null; last_message_at: string; amount: number | null; assigned_to: string | null; via: "kito" | "rules" | "name_mark" };
type Fulfil = { id: string; conversation_id: string | null; contact_name: string | null; net: number; currency: string; product: string | null;
  fulfillment_status: string; paid_at: string; delivery_issue: string | null; delivery_issue_at: string | null; assigned_to: string | null;
  why: "issue" | "returned" | "to_ship" | "in_transit" };
type Sync = { kind: "connection" | "ads_stale" | "import" | "media"; ref: string; detail: string; at: string | null };
type Mine = { kind: "chat"; id: string; contact_name: string | null; at: string; last_dir: "in" | "out" | null };
type MineOrder = { id: string; conversation_id: string | null; contact_name: string | null; fulfillment_status: string; paid_at: string; net: number; currency: string };
type Data = { overdue: Overdue[]; signals: Signal[]; signals_total: number; fulfil: Fulfil[]; sync: Sync[]; mine: Mine[]; mine_orders: MineOrder[] };
type Health = { status: string; events: number; exhausted: number };

const chatLink = (ids: (string | null)[]) => "#chats/ids=" + ids.filter(Boolean).slice(0, 100).join(",");

/** Payments to confirm, deliveries, overdue items, sync problems. Since 23 Nov 2026 a tab in Actions (embedded). */
export default function Attention({ ws, embedded }: { ws: Workspace; embedded?: boolean }) {
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  // Kept while the app is open: coming back shows the last list at once (no placeholders) and refreshes it quietly.
  const [d, setD] = useKept<Data | null>("attention:d:" + ws.id, null);
  const [health, setHealth] = useKept<Health[]>("attention:h:" + ws.id, []);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState("");
  const editor = canEdit(ws);
  const { members } = useTeam(ws.id);
  const who = (id: string | null) => (id ? shortName(members.find((m) => m.user_id === id)?.email ?? "") : "");
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    let live = true;
    Promise.all([supabase.rpc("needs_attention", { p_ws: ws.id }), supabase.rpc("webhook_health", { p_ws: ws.id })]).then(([a, h]) => {
      if (!live) return;
      if (a.error) setErr(/function .* does not exist|schema cache|could not find/i.test(a.error.message) ? T("This page needs the latest itaOS update. Try again in a few minutes.", "Ukurasa huu unahitaji sasisho jipya. Jaribu tena baada ya dakika chache.") : a.error.message);
      else { setErr(""); setD(a.data as Data); }
      setHealth((h.data as Health[]) ?? []);
    });
    return () => { live = false; };
  }, [ws.id, tick]);
  // Live: a new message, label or sale refreshes this list too (throttled).
  useEffect(() => {
    let t: number | undefined;
    const soon = () => { if (t === undefined) t = window.setTimeout(() => { t = undefined; refresh(); }, 6000); };
    const ch = supabase.channel(`attention-${ws.id}-${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `workspace_id=eq.${ws.id}` }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${ws.id}` }, soon)
      .subscribe();
    return () => { window.clearTimeout(t); supabase.removeChannel(ch); };
  }, [ws.id]);

  const pageRef = usePageEnter<HTMLDivElement>((root) => { if (d) enterCards(select(root, ":scope > .card, .hero"), { stagger: 0.05 }); }, [!!d]);

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key); setErr("");
    const { error } = await fn();
    setBusy("");
    if (error) setErr(error.message); else refresh();
  }
  const updateOrder = (id: string, patch: Record<string, unknown>) => run("o" + id, () => supabase.from("orders").update(patch).eq("id", id).eq("workspace_id", ws.id));
  const updateTask = (id: string, patch: Record<string, unknown>) => run("t" + id, () => supabase.from("follow_up_tasks").update(patch).eq("id", id).eq("workspace_id", ws.id));

  if (!d && !err) return <div className="skeletons" aria-busy="true"><div className="skeleton" style={{ minHeight: 120 }} /><div className="skeleton" style={{ minHeight: 260 }} /></div>;

  const failed = health.filter((h) => h.status === "failed").reduce((s, h) => s + Number(h.events ?? 0), 0);
  const sync = [...(d?.sync ?? []), ...(failed ? [{ kind: "connection", ref: "whatsapp", detail: T(`${failed} WhatsApp message event(s) failed to process. Retry them on Connections.`, `Matukio ${failed} ya WhatsApp hayakuchakatwa. Yajaribu tena kwenye Miunganisho.`), at: null } as Sync] : [])];
  const toShip = (d?.fulfil ?? []).filter((f) => f.why === "to_ship");
  const total = (d?.overdue.length ?? 0) + (d?.signals_total ?? 0) + (d?.fulfil.length ?? 0) + sync.length;
  const mineCount = (d?.mine.length ?? 0) + (d?.mine_orders.length ?? 0);

  return (
    <div className="shell-grid attention" ref={pageRef}>
      <div className="hero">
        <div style={{ display: "grid", gap: 4 }}>
          {!embedded && <h2>{T("Needs attention", "Yanayohitaji hatua")}</h2>}
          <div className="sub"><span>{total === 0 ? T("All clear: nothing waiting on you.", "Kila kitu kiko sawa: hakuna kinachokusubiri.") : T(`${total} things to look at`, `Mambo ${total} ya kuangalia`)}</span>
            <a href="#why">{T("Weekly summary →", "Muhtasari wa wiki →")}</a></div>
        </div>
      </div>
      {err && <p className="err">{err}</p>}

      {d && mineCount > 0 && (
        <section className="card">
          <div className="row between"><h2>{T("Assigned to you", "Umepewa wewe")}</h2>{d.mine.length > 1 && <a className="small" href={chatLink(d.mine.map((m) => m.id))}>{T("Open all in Chats", "Fungua zote kwenye Chats")}</a>}</div>
          <ul className="att-list">
            {d.mine.map((m) => <li key={m.id}><span><b>{m.contact_name ?? T("Customer", "Mteja")}</b><span className="small muted">{m.last_dir === "in" ? T("customer wrote last", "mteja aliandika mwisho") : T("you wrote last", "uliandika mwisho")} · {ago(m.at)}</span></span><a className="btn small" href={chatLink([m.id])}>{T("Open chat", "Fungua chat")}</a></li>)}
            {d.mine_orders.map((o) => <li key={o.id}><span><b>{o.contact_name ?? T("Order", "Oda")} · {amt(o.net, o.currency)} {o.currency}</b><span className="small muted">{L[lang].fulfillment[o.fulfillment_status]} · {T("paid", "imelipwa")} {ago(o.paid_at)}</span></span>{o.conversation_id && <a className="btn small" href={chatLink([o.conversation_id])}>{T("Open", "Fungua")}</a>}</li>)}
          </ul>
        </section>
      )}

      {d && (
        <section className="card">
          <div className="row between"><h2>{T("Overdue follow-ups", "Ufuatiliaji uliochelewa")} <span className="chip">{d.overdue.length}</span></h2><a className="small" href="#actions">{T("All follow-ups →", "Ufuatiliaji wote →")}</a></div>
          {d.overdue.length === 0 ? <p className="small muted">{T("None overdue.", "Hakuna uliochelewa.")}</p> : (
            <ul className="att-list">
              {d.overdue.map((t) => (
                <li key={t.id}>
                  {/* The name opens the chat, so the row keeps just two buttons on the same line (23 Nov 2026) */}
                  <a className="att-who" href={chatLink([t.conversation_id])}><b>{t.contact_name ?? t.title}</b><span className="small muted">{T("was due", "ilitakiwa")} {ago(t.due_at)}{t.assigned_to ? ` · ${who(t.assigned_to)}` : ""}</span></a>
                  <span className="att-acts">
                    {editor && <button className="small" disabled={busy === "t" + t.id} onClick={() => updateTask(t.id, { status: "snoozed", snoozed_until: new Date(Date.now() + 864e5).toISOString() })}>{T("Tomorrow", "Kesho")}</button>}
                    {editor && <button className="small primary" disabled={busy === "t" + t.id} onClick={() => updateTask(t.id, { status: "done", completed_at: new Date().toISOString() })}>{T("Done", "Imekamilika")}</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {d && (
        <section className="card">
          <div className="row between"><h2>{T("Payments to confirm", "Malipo ya kuthibitisha")} <span className="chip">{d.signals_total}</span></h2>
            {d.signals.length > 1 && <a className="small" href={chatLink(d.signals.map((s) => s.id))}>{T("Open all in Chats", "Fungua zote kwenye Chats")}</a>}</div>
          <p className="small muted">{T("A payment was detected (words, a screenshot, Kito or ✅) but no sale is recorded. They don't count in revenue until you confirm the money came in.", "Malipo yamegunduliwa (maneno, picha, Kito au ✅) lakini mauzo hayajarekodiwa. Hayahesabiwi kwenye mapato hadi uthibitishe pesa imeingia.")}</p>
          {d.signals.length === 0 ? <p className="small muted">{T("Nothing to confirm.", "Hakuna cha kuthibitisha.")}</p> : (
            <ul className="att-list">
              {d.signals.slice(0, 15).map((s) => (
                <li key={s.id}>
                  <span><b>{s.contact_name ?? T("Customer", "Mteja")}{s.amount ? ` · ${amt(s.amount, ws.currency)} ${ws.currency}` : ""}</b>
                    <span className="small muted">{s.via === "kito" ? T("Kito read a payment", "Kito ameona malipo") : s.via === "rules" ? T("payment words or screenshot", "maneno au picha ya malipo") : T("✅ on their name", "✅ kwenye jina")} · {ago(s.last_message_at)}</span></span>
                  <a className="btn small primary" href={chatLink([s.id])}>{T("Check & confirm", "Hakiki na thibitisha")}</a>
                </li>
              ))}
            </ul>
          )}
          {d.signals_total > 15 && <span className="small muted">{T(`+${d.signals_total - 15} more`, `+${d.signals_total - 15} zaidi`)}</span>}
        </section>
      )}

      {d && (
        <section className="card">
          <div className="row between"><h2>{T("Deliveries", "Usafirishaji")} <span className="chip">{d.fulfil.length}</span></h2>
            {editor && toShip.length > 3 && <button className="small" disabled={!!busy} onClick={() => {
              if (!confirm(T(`Mark all ${toShip.length} "not shipped" orders as delivered? Use this if you deliver the same day and didn't record it.`, `Weka oda zote ${toShip.length} "haijatumwa" kuwa zimefika? Tumia kama unafikisha siku hiyo hiyo na hukurekodi.`))) return;
              void run("bulk", () => supabase.from("orders").update({ fulfillment_status: "delivered" }).in("id", toShip.map((f) => f.id)).eq("workspace_id", ws.id));
            }}>{T("Mark all delivered", "Zote zimefika")}</button>}</div>
          <p className="small muted">{T("Paid orders still waiting to go out, in transit for more than 5 days, returned, or with a delivery problem.", "Oda zilizolipwa ambazo bado hazijatumwa, ziko njiani zaidi ya siku 5, zimerudishwa, au zina tatizo la usafirishaji.")}</p>
          {d.fulfil.length === 0 ? <p className="small muted">{T("Every paid order is delivered or on its way.", "Kila oda iliyolipwa imefika au iko njiani.")}</p> : (
            <ul className="att-list">
              {d.fulfil.map((f) => (
                <li key={f.id} className={f.why === "issue" || f.why === "returned" ? "bad" : ""}>
                  <span><b>{f.contact_name ?? T("Order", "Oda")} · {amt(f.net, f.currency)} {f.currency}{f.product ? ` · ${f.product}` : ""}</b>
                    <span className="small muted">{f.why === "issue" ? `⚠ ${f.delivery_issue}` : f.why === "returned" ? T("Returned", "Imerudishwa") : f.why === "to_ship" ? T("Not shipped yet", "Bado haijatumwa") : T("Shipped, not marked delivered", "Imetumwa, haijawekwa imefika")} · {T("paid", "imelipwa")} {ago(f.paid_at)}{f.assigned_to ? ` · ${who(f.assigned_to)}` : ""}</span></span>
                  <span className="row" style={{ gap: 6 }}>
                    {f.conversation_id && <a className="btn small" href={chatLink([f.conversation_id])}>{T("Chat", "Chat")}</a>}
                    {editor && <AssignSelect ws={ws} value={f.assigned_to} label={false} busy={busy === "o" + f.id} onChange={(u) => updateOrder(f.id, { assigned_to: u })} />}
                    {editor && f.why === "issue" && <button className="small" disabled={busy === "o" + f.id} onClick={() => updateOrder(f.id, { delivery_resolved_at: new Date().toISOString() })}>{T("Resolved", "Imetatuliwa")}</button>}
                    {editor && f.fulfillment_status === "not_shipped" && <button className="small" disabled={busy === "o" + f.id} onClick={() => updateOrder(f.id, { fulfillment_status: "shipped" })}>{T("Shipped", "Imetumwa")}</button>}
                    {editor && f.fulfillment_status !== "delivered" && f.why !== "returned" && <button className="small primary" disabled={busy === "o" + f.id} onClick={() => updateOrder(f.id, { fulfillment_status: "delivered" })}>{T("Delivered", "Imefika")}</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {d && (
        <section className="card">
          <div className="row between"><h2>{T("Connections and imports", "Miunganisho na uingizaji")} <span className="chip">{sync.length}</span></h2><a className="small" href="#connect">{T("Connections →", "Miunganisho →")}</a></div>
          {sync.length === 0 ? <p className="small muted">{T("WhatsApp, ads and imports are all working.", "WhatsApp, matangazo na uingizaji vyote vinafanya kazi.")}</p> : (
            <ul className="att-list">
              {sync.map((s, i) => (
                <li key={i} className="bad"><span><b>{s.kind === "import" ? T(`Import (${s.ref})`, `Uingizaji (${s.ref})`) : s.kind === "media" ? T("Customer photos", "Picha za wateja") : s.ref === "meta_ads" ? T("Meta ads", "Matangazo ya Meta") : "WhatsApp"}</b>
                  <span className="small muted">{s.detail}{s.at ? ` · ${ago(s.at)}` : ""}</span></span>
                  <a className="btn small" href="#connect">{T("Fix", "Rekebisha")}</a></li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
