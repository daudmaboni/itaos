import { enterCards, usePageEnter, select } from "./motion";
import { useEffect, useRef, useState } from "react";
import { supabase, callFn, Workspace, canManage, when, ago } from "./lib";
import { loginForAds, embeddedSignup, metaConfigured } from "./meta";

type Health = { status: string; events: number; oldest: string | null; newest: string | null; exhausted: number };

type Conn = { id: string; provider: string; external_id: string; label: string | null; status: string; last_sync_at: string | null; last_error: string | null };
type Num = { phone_number_id: string; connection_id: string | null; display_phone: string | null; history_status: string | null; history_requested_at: string | null };

const PONDI_WA = "255626277027";
const pondiLink = (ws: Workspace, what: string) =>
  `https://wa.me/${PONDI_WA}?text=${encodeURIComponent(ws.language === "sw" ? `Habari Pondi, naomba msaada wa kuunganisha ${what} kwenye itaOS (${ws.name}).` : `Hi Pondi, please help me connect ${what} to itaOS (${ws.name}).`)}`;

/** What an owner sees: is each thing connected, and who to call if not. All setup is done by Pondi. */
export default function Connect({ ws }: { ws: Workspace }) {
  const [setup, setSetup] = useState(() => location.hash.startsWith("#connect/setup"));
  useEffect(() => {
    const on = () => setSetup(location.hash.startsWith("#connect/setup"));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  if (setup && canManage(ws)) return <ConnectSetup ws={ws} />;
  return <ConnectSimple ws={ws} />;
}

function ConnectSimple({ ws }: { ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [nums, setNums] = useState<Num[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    supabase.from("connections").select("id,provider,external_id,label,status,last_sync_at,last_error").eq("workspace_id", ws.id).then(({ data }) => setConns((data as Conn[]) ?? []));
    supabase.from("wa_numbers").select("phone_number_id,connection_id,display_phone,history_status,history_requested_at").eq("workspace_id", ws.id).then(({ data }) => setNums((data as Num[]) ?? []));
  }, [ws.id, tick]);
  // Images and voice notes from the last 7 days that weren't saved yet (needs the Dualhook key, set by Pondi).
  const [hasKey, setHasKey] = useState(false);
  const [fetching, setFetching] = useState(false);
  useEffect(() => {
    supabase.from("connections").select("meta").eq("workspace_id", ws.id).eq("provider", "whatsapp").eq("meta->>via", "dualhook").maybeSingle()
      .then(({ data }) => setHasKey(!!(data as any)?.meta?.api_key_last4));
  }, [ws.id]);
  const fetchMedia = async () => {
    setFetching(true); setMsg({});
    try {
      const r = await callFn<{ images_saved: number; images_failed: number; last_error: string | null }>("dualhook-connect", { workspace_id: ws.id, action: "backfill_media" });
      setMsg(r.images_failed && !r.images_saved
        ? { err: T(`Could not fetch images and voice notes: ${r.last_error ?? "unknown error"}`, `Imeshindwa kuleta picha na sauti: ${r.last_error ?? "hitilafu"}`) }
        : { ok: r.images_saved
            ? T(`${r.images_saved} images and voice notes fetched${r.images_failed ? `, ${r.images_failed} failed` : ""}.${r.images_saved >= 40 ? " Press again for more." : ""}`, `Picha na sauti ${r.images_saved} zimeletwa${r.images_failed ? `, ${r.images_failed} zimeshindwa` : ""}.${r.images_saved >= 40 ? " Bonyeza tena kwa zaidi." : ""}`)
            : T("Nothing missing: all images and voice notes from the last 7 days are saved.", "Hakuna kilichokosekana: picha na sauti zote za siku 7 zimehifadhiwa.") });
    } catch (e) { setMsg({ err: (e as Error).message }); }
    setFetching(false);
  };
  const pageRef = usePageEnter<HTMLDivElement>((root) => { enterCards(select(root, ":scope > .card"), { stagger: 0.07 }); });
  const ads = (conns ?? []).filter((c) => c.provider === "meta_ads" && c.status !== "revoked");
  const syncNow = async () => {
    setBusy(true); setMsg({});
    try {
      const r = await callFn<{ synced: any[] }>("ads-sync", { workspace_id: ws.id, days: 30 });
      const e = r.synced.find((x) => x.error);
      if (e) throw new Error(e.error);
      setMsg({ ok: T("Ads updated.", "Matangazo yamesasishwa.") });
    } catch (e) { setMsg({ err: (e as Error).message }); }
    setBusy(false); setTick((t) => t + 1);
  };
  const Help = ({ what }: { what: string }) => (
    <a className="btn small" href={pondiLink(ws, what)} target="_blank" rel="noopener">{T("Message Pondi on WhatsApp", "Tuma ujumbe kwa Pondi WhatsApp")}</a>
  );
  const Line = ({ ok, title, sub }: { ok: boolean; title: string; sub?: string }) => (
    <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
      <span><span className={"status-dot " + (ok ? "on" : "err")} /> <b>{title}</b>{sub && <span className="small muted"> · {sub}</span>}</span>
      <span className={"pill-s " + (ok ? "on" : "err")}>{ok ? T("Connected ✓", "Imeunganishwa ✓") : T("Needs attention", "Inahitaji kuangaliwa")}</span>
    </div>
  );
  if (conns === null) return <div className="center muted">…</div>;
  return (
    <div className="shell-grid" ref={pageRef}>
      {msg.ok && <p className="ok">{msg.ok}</p>}
      {msg.err && <p className="err">{msg.err}</p>}
      <section className="card">
        <h2>WhatsApp Business</h2>
        {nums.length === 0 ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>{T("Not connected yet. Pondi connects your number for you: it keeps working on your phone exactly as before.", "Bado haijaunganishwa. Pondi wanaunganisha namba yako kwa ajili yako: inaendelea kufanya kazi kwenye simu yako kama kawaida.")}</p>
            <div><Help what="WhatsApp" /></div>
          </>
        ) : nums.map((n) => {
          const c = conns.find((x) => x.id === n.connection_id);
          const ok = !c || (c.status === "active" && !c.last_error);
          return (
            <div key={n.phone_number_id} style={{ display: "grid", gap: 6 }}>
              <Line ok={ok} title={prettyPhone(n.display_phone ?? n.phone_number_id)} sub={c?.last_sync_at ? T(`last message ${ago(c.last_sync_at)}`, `ujumbe wa mwisho ${ago(c.last_sync_at)}`) : undefined} />
              {!ok && <div><span className="small err">{T("Messages may not be reaching itaOS.", "Huenda jumbe hazifiki itaOS.")} </span><Help what="WhatsApp" /></div>}
            </div>
          );
        })}
        {nums.length > 0 && hasKey && canManage(ws) && (
          <div className="row between" style={{ gap: 10, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            <span className="small muted">{T("Missing a photo or voice note from the last 7 days?", "Picha au sauti ya siku 7 zilizopita haipo?")}</span>
            <button className="small" disabled={fetching} onClick={fetchMedia}>{fetching ? T("Fetching…", "Inaleta…") : T("Fetch images and voice notes", "Leta picha na sauti")}</button>
          </div>
        )}
      </section>
      <section className="card">
        <div className="row between"><h2>{T("Facebook & Instagram ads", "Matangazo ya Facebook na Instagram")}</h2>
          {ads.length > 0 && <button className="small" disabled={busy} onClick={syncNow}>{busy ? T("Updating…", "Inasasisha…") : T("Update now", "Sasisha sasa")}</button>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>{T("Read-only: itaOS reads what your ads cost and the chats they bring. It never changes your ads.", "Kusoma tu: itaOS inasoma gharama za matangazo na chat yanazoleta. Haibadilishi matangazo yako.")}</p>
        {ads.length === 0 ? <div><Help what={T("my ad account", "akaunti yangu ya matangazo")} /></div> : ads.map((c) => (
          <div key={c.id} style={{ display: "grid", gap: 6 }}>
            <Line ok={c.status === "active" && !c.last_error} title={c.label ?? c.external_id} sub={c.last_sync_at ? T(`updated ${ago(c.last_sync_at)}`, `imesasishwa ${ago(c.last_sync_at)}`) : T("waiting for the first update", "inasubiri usasishaji wa kwanza")} />
            {c.last_error && <div><span className="small err">{T("itaOS can't read this ad account right now.", "itaOS haiwezi kusoma akaunti hii kwa sasa.")} </span><Help what={T("my ad account", "akaunti yangu ya matangazo")} /></div>}
          </div>
        ))}
      </section>
      {canManage(ws) && <SalesToMeta ws={ws} T={T} />}
      <GoogleCard ws={ws} T={T} />
      <p className="small muted" style={{ margin: 0 }}>{T("Exchange rate, language and your password are in ", "Kiwango cha kubadilisha fedha, lugha na nenosiri viko kwenye ")}<a href="#settings">{T("Settings", "Mipangilio")}</a>.</p>
    </div>
  );
}

/** Full connection setup (Dualhook webhook, API key, Facebook login for ads, delivery health). For Pondi staff
 *  setting a business up: reached at #connect/setup. Owners see the simple page below. */
function ConnectSetup({ ws }: { ws: Workspace }) {
  const [conns, setConns] = useState<Conn[]>([]);
  const [nums, setNums] = useState<Num[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string; currency: string }[] | null>(null);
  const [pending, setPending] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [tick, setTick] = useState(0);
  const [dh, setDh] = useState<{ webhook_url: string; verify_token: string } | null>(null);
  const [health, setHealth] = useState<Health[]>([]);
  const manager = canManage(ws);

  useEffect(() => {
    supabase.from("connections").select("id,provider,external_id,label,status,last_sync_at,last_error").eq("workspace_id", ws.id).then(({ data }) => setConns((data as Conn[]) ?? []));
    supabase.from("wa_numbers").select("phone_number_id,connection_id,display_phone,history_status,history_requested_at").eq("workspace_id", ws.id).then(({ data }) => setNums((data as Num[]) ?? []));
    supabase.rpc("webhook_health", { p_ws: ws.id }).then(({ data }) => setHealth((data as Health[]) ?? []));
  }, [ws.id, tick]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setMsg({});
    try { await fn(); } catch (e) { setMsg({ err: (e as Error).message }); }
    setBusy(""); setTick((t) => t + 1);
  };

  const connectAds = () => run("ads", async () => {
    const token = await loginForAds();
    const r = await callFn<{ accounts: any[]; pending_secret: string }>("meta-connect", { action: "ads_accounts", workspace_id: ws.id, access_token: token });
    if (!r.accounts.length) throw new Error("This Facebook account has no ad accounts it can read.");
    setAccounts(r.accounts); setPending(r.pending_secret);
  });
  const pickAccount = (a: { id: string; name: string }) => run("ads", async () => {
    await callFn("meta-connect", { action: "ads_connect", workspace_id: ws.id, pending_secret: pending, ad_account_id: a.id, label: a.name });
    setAccounts(null); setMsg({ ok: `Connected ${a.name}. Pulling the last 30 days of ads now.` });
  });
  const syncNow = () => run("sync", async () => {
    const r = await callFn<{ synced: any[] }>("ads-sync", { workspace_id: ws.id, days: 30 });
    const e = r.synced.find((x) => x.error);
    if (e) throw new Error(e.error);
    setMsg({ ok: `Synced ${r.synced.reduce((s, x) => s + (x.rows ?? 0), 0)} ad-days.` });
  });
  const connectWa = () => run("wa", async () => {
    const s = await embeddedSignup();
    const r = await callFn<{ display_phone: string; syncs: Record<string, string> }>("meta-connect", { action: "wa_connect", workspace_id: ws.id, ...s });
    setMsg({ ok: `WhatsApp ${r.display_phone ?? ""} connected. History: ${r.syncs.history}. Chats from the last 6 months will appear over the next few hours.` });
  });


  const connectDualhook = () => run("dh", async () => {
    if (dhLinked.length && prompt("This cuts off WhatsApp until you paste the new URL and token into Dualhook. Type REPLACE to continue.") !== "REPLACE") return;
    const r = await callFn<{ webhook_url: string; verify_token: string }>("dualhook-connect", { workspace_id: ws.id });
    setDh(r);
  });
  // Dualhook Outbound API key: lets itaOS download the images customers send (payment screenshots).
  const [dhKey, setDhKey] = useState("");
  const [dhKeyLast4, setDhKeyLast4] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("connections").select("meta").eq("workspace_id", ws.id).eq("provider", "whatsapp").eq("meta->>via", "dualhook").maybeSingle()
      .then(({ data }) => setDhKeyLast4((data as any)?.meta?.api_key_last4 ?? null));
  }, [ws.id, busy]);
  const saveDhKey = () => run("dhkey", async () => {
    const r = await callFn<{ images_saved: number; images_failed: number; last_error: string | null }>("dualhook-connect", { workspace_id: ws.id, action: "set_api_key", api_key: dhKey.trim() });
    setDhKey("");
    setMsg(r.images_failed && !r.images_saved
      ? { err: `Key saved, but Dualhook did not return the images and voice notes: ${r.last_error ?? "unknown error"}` }
      : { ok: `Key saved. ${r.images_saved} image${r.images_saved === 1 ? "" : "s"} and voice note${r.images_saved === 1 ? "" : "s"} from the last 7 days fetched${r.images_failed ? `, ${r.images_failed} could not be fetched` : ""}.` });
  });
  const fetchImages = () => run("dhfetch", async () => {
    const r = await callFn<{ images_saved: number; images_failed: number; last_error: string | null }>("dualhook-connect", { workspace_id: ws.id, action: "backfill_media" });
    setMsg(r.images_failed && !r.images_saved ? { err: `Could not fetch images and voice notes: ${r.last_error ?? "unknown error"}` } : { ok: `${r.images_saved} images and voice notes fetched${r.images_failed ? `, ${r.images_failed} failed` : ""}.${r.images_saved >= 40 ? " Press again for more." : ""}` });
  });

  const replay = () => run("replay", async () => {
    const r = await callFn<{ requeued: number; processed: number; checked: number }>("wa-webhook", { action: "replay", workspace_id: ws.id });
    setMsg({ ok: `Requeued ${r.requeued} events; ${r.processed} of ${r.checked} processed now. The rest retry on the next scheduled run.` });
  });
  const failed = health.find((h) => h.status === "failed");
  const processing = health.find((h) => h.status === "processing");
  const queued = health.find((h) => h.status === "pending");
  const adsConns = conns.filter((c) => c.provider === "meta_ads");
  const waConns = conns.filter((c) => c.provider === "whatsapp");
  const dhConns = waConns.filter((c) => c.external_id.startsWith("dualhook:"));
  // A Dualhook row exists as soon as "Use Dualhook" is pressed; it is only linked once Meta's first message registers a number to it.
  const dhLinked = dhConns.filter((c) => nums.some((n) => n.connection_id === c.id));
  const pageRef = usePageEnter<HTMLDivElement>((root) => { enterCards(select(root, ":scope > .card, :scope > .finding"), { stagger: 0.07 }); });

  return (
    <div className="shell-grid" ref={pageRef}>
      <div className="finding"><b>Pondi setup page</b><span className="small">Technical connection settings used by Pondi when setting a business up. <a href="#connect">Back to the simple view</a>.</span></div>
      {!metaConfigured() && <div className="finding warn"><b>Meta app not configured</b><span className="small">Add VITE_META_APP_ID and the two config IDs to the site's environment, then redeploy. See SETUP.md.</span></div>}
      {msg.ok && <p className="ok">{msg.ok}</p>}
      {msg.err && <p className="err">{msg.err}</p>}

      <section className="card">
        <div className="row between"><h2>Facebook & Instagram ads</h2>
          <div className="row">
            {adsConns.length > 0 && <button disabled={!!busy} onClick={syncNow}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>}
            <button className="primary" disabled={!!busy || !metaConfigured() || !manager} title={manager ? "" : "Only an owner or admin can connect accounts"} onClick={connectAds}>{busy === "ads" ? "Connecting…" : adsConns.length ? "Add / reconnect ad account" : "Connect ad account"}</button>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Read-only. itaOS reads spend and chats started per ad every 3 hours. It never changes your ads.</p>
        {accounts && (
          <div className="card" style={{ background: "var(--paper)" }}>
            <h3>Choose the ad account</h3>
            {accounts.map((a) => <button key={a.id} onClick={() => pickAccount(a)} disabled={!!busy}>{a.name} <span className="muted small">({a.id}, {a.currency})</span></button>)}
          </div>
        )}
        {adsConns.map((c) => (
          <div key={c.id} style={{ display: "grid", gap: 6 }}>
            <StatusRow c={c} />
            {manager && <DisconnectAds c={c} onDone={(text) => { setMsg({ ok: text }); setTick((t) => t + 1); }} onError={(text) => setMsg({ err: text })} last={adsConns.length === 1} />}
          </div>
        ))}
      </section>

      <section className="card">
        <div className="row between"><h2>WhatsApp Business</h2>
          <button className="primary" disabled={!!busy || !metaConfigured() || !manager} title={manager ? "" : "Only an owner or admin can connect accounts"} onClick={connectWa}>{busy === "wa" ? "Connecting…" : waConns.length ? "Connect another number" : "Connect WhatsApp"}</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Keeps working on your phone as before. itaOS reads chats (and the last 6 months of history, once) to find where sales are lost. It doesn't send messages.</p>
        {nums.length > 0 && (
          <div className="wa-nums">
            {nums.map((n) => {
              const c = conns.find((x) => x.id === n.connection_id);
              const via = c?.external_id.startsWith("dualhook:") ? "Dualhook" : "Meta";
              const ok = !c || (c.status === "active" && !c.last_error);
              const hist = n.history_status === "complete" ? ["on", "History imported"] : n.history_status === "receiving" ? ["warn", "Importing history…"] : n.history_status === "declined" ? ["err", "History not shared"] : ["", "History: waiting for Meta"];
              return (
                <div className={"wa-num" + (ok ? "" : " bad")} key={n.phone_number_id}>
                  <div className="wa-num-ico" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z" /></svg>
                  </div>
                  <div className="wa-num-main">
                    <div className="wa-num-phone num">{prettyPhone(n.display_phone ?? n.phone_number_id)}</div>
                    <div className="wa-num-meta">
                      <span className={"pill-s " + (ok ? "on" : "err")}><span className={"status-dot " + (ok ? "on" : "err")} />{ok ? "Connected" : "Needs attention"}</span>
                      <span className="muted">via {via}</span>
                      {c?.last_sync_at && <span className="muted">· last message {ago(c.last_sync_at)}</span>}
                    </div>
                    {c?.last_error && <span className="small err">{c.last_error}</span>}
                  </div>
                  <div className="wa-num-side small">
                    <span><span className={"status-dot " + hist[0]} /> {hist[1]}</span>
                    {via === "Dualhook" && <span><span className={"status-dot " + (dhKeyLast4 ? "on" : "warn")} /> {dhKeyLast4 ? "Reads payment screenshots" : "Screenshots: add key below"}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {dhConns.filter((c) => !dhLinked.includes(c)).map((c) => (
          <div key={c.id} className="row between small"><span><span className="status-dot warn" /> {c.label ?? "WhatsApp via Dualhook"} <span className="warnt">· not linked yet</span></span><span className="muted">Paste the webhook URL and verify token into Dualhook, then connect the number there</span></div>
        ))}
        {manager && (
          <details className="evidence wa-setup" open={!dhLinked.length || !dhKeyLast4 || !!dh}>
            <summary className="row between"><b>{dhLinked.length ? "Dualhook settings" : "Connect through Dualhook"}</b>
              {!dh && !dhConns.length && <button className="small" disabled={!!busy} onClick={(e) => { e.preventDefault(); connectDualhook(); }}>{busy === "dh" ? "Creating…" : "Use Dualhook"}</button>}
            </summary>
            <span className="small muted">Use this while itaOS's own Meta approval is pending. Dualhook is a Meta Tech Provider: the number keeps working in the WhatsApp Business app, and Meta sends chats, ad clicks and history straight to itaOS.</span>
            {dhLinked.length > 0 && (
              <div className="dh-key">
                <b className="small">Payment screenshots {dhKeyLast4 ? <span className="ok small">· key saved (…{dhKeyLast4})</span> : <span className="warnt small">· not set up</span>}</b>
                <span className="small muted">To read the images and play the voice notes customers send, itaOS downloads them through Dualhook. In Dualhook open <b>Connection → Overview → Outbound API key</b>, create a key (it starts with <code>dh_live_</code>) and paste it here. Images and voice notes from the last 7 days are fetched right away.</span>
                <div className="row">
                  <input type="password" autoComplete="off" placeholder="dh_live_…" value={dhKey} onChange={(e) => setDhKey(e.target.value)} style={{ flex: 1 }} />
                  <button className="small primary" disabled={!!busy || !dhKey.trim().startsWith("dh_live_")} onClick={saveDhKey}>{busy === "dhkey" ? "Saving…" : dhKeyLast4 ? "Replace key" : "Save key"}</button>
                  {dhKeyLast4 && <button className="small" disabled={!!busy} onClick={fetchImages}>{busy === "dhfetch" ? "Fetching…" : "Fetch images and voice notes"}</button>}
                </div>
              </div>
            )}
            {dh && (
              <>
                <ol className="small" style={{ margin: "4px 0", paddingLeft: 18 }}>
                  <li>In Dualhook, start a new connection and choose <b>Webhook Override</b>. Paste these two values <b>before</b> you open Meta's signup window:</li>
                </ol>
                <label className="small">Webhook URL</label>
                <CopyField value={dh.webhook_url} onError={() => setMsg({ err: "Copy failed. Select the text and copy it by hand." })} />
                <label className="small">Verify token</label>
                <CopyField value={dh.verify_token} onError={() => setMsg({ err: "Copy failed. Select the text and copy it by hand." })} />
                <ol className="small" start={2} style={{ margin: "4px 0", paddingLeft: 18 }}>
                  <li>Continue in Dualhook: choose <b>"Connect your existing WhatsApp Business app"</b>, scan the QR on the phone and <b>allow chat history sharing</b>.</li>
                  <li>The number appears here with its first message; the last 6 months of chats follow over a few hours.</li>
                </ol>
                <span className="small err">Save both values now: itaOS keeps only a fingerprint and can't show them again.</span>
                <div className="row"><button onClick={() => setDh(null)}>Done</button></div>
              </>
            )}
            {!dh && dhConns.length > 0 && dhLinked.length === 0 && (
              <div className="row" style={{ alignItems: "center" }}>
                <span className="small muted" style={{ flex: 1 }}>Lost the URL or token? itaOS can't show them again, but you can make new ones. Nothing is connected yet, so nothing breaks.</span>
                <button className="small" disabled={!!busy} onClick={connectDualhook}>{busy === "dh" ? "Creating…" : "Get a new URL and token"}</button>
              </div>
            )}
            {!dh && dhLinked.length > 0 && (
              <details className="small">
                <summary className="muted">Advanced: replace the webhook URL</summary>
                <span className="small err" style={{ display: "block", margin: "6px 0" }}>Only do this if the URL was leaked. The current URL stops working immediately, and no WhatsApp messages reach itaOS until you paste the new URL and token into Dualhook (Webhook Override → Change).</span>
                <button className="small danger" disabled={!!busy} onClick={connectDualhook}>{busy === "dh" ? "Creating…" : "Replace webhook URL"}</button>
              </details>
            )}
          </details>
        )}
        {nums.length === 0 && <p className="small muted" style={{ margin: 0 }}>Not connected yet.</p>}
        {(health.length > 0 || nums.length > 0) && (
          <details className="evidence wa-setup" open={!!failed?.events}>
            <summary className="row between"><b>Message delivery <span className="small muted" style={{ fontWeight: 500 }}>· {health.find((h) => h.status === "processed")?.events.toLocaleString("en-US") ?? 0} received{failed?.events ? <span className="err"> · {failed.events} failed</span> : ""}</span></b>{manager && (failed?.events || processing?.events) ? <button className="small" disabled={!!busy} onClick={(e) => { e.preventDefault(); replay(); }}>{busy === "replay" ? "Replaying…" : "Replay failed events"}</button> : null}</summary>
            {health.length === 0 ? <span className="small muted">No events received yet.</span> : health.map((h) => (
              <span className="small" key={h.status}><span className={"status-dot " + (h.status === "processed" ? "on" : h.status === "failed" ? "err" : "")} /> {h.status}: {h.events}{h.newest ? ` · latest ${ago(h.newest)}` : ""}{h.exhausted ? ` · ${h.exhausted} gave up after repeated failures (replay to retry)` : ""}</span>
            ))}
            {queued && queued.events > 0 && <span className="small muted">Pending events are picked up by the scheduled job within 3 hours.</span>}
            <span className="small muted">Every event Meta delivers is stored before it is acknowledged, then processed. Failed ones are retried automatically up to 8 times; replaying resets that counter. Counts only — message content never leaves the server here.</span>
          </details>
        )}
      </section>
    </div>
  );
}



/** Read-only field + Copy button that visibly confirms the copy on the button itself. */
function CopyField({ value, onError }: { value: string; onError: () => void }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  const timer = useRef<number>();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(value); ok = true; }
    catch {
      // Fallback for browsers without the async clipboard API.
      const el = inputRef.current;
      if (el) { el.focus(); el.select(); try { ok = document.execCommand("copy"); } catch { ok = false; } }
    }
    setState(ok ? "done" : "fail");
    if (!ok) onError();
    navigator.vibrate?.(ok ? 12 : [20, 40, 20]);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1800);
  };
  return (
    <div className="row">
      <input ref={inputRef} readOnly value={value} className={state === "done" ? "copy-flash" : ""} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
      <button type="button" className={`small copy-btn ${state}`} onClick={copy} aria-live="polite">
        {state === "done" ? "Copied ✓" : state === "fail" ? "Failed" : "Copy"}
      </button>
    </div>
  );
}

/** "255635855825" → "+255 635 855 825" */
function prettyPhone(p: string) {
  const d = p.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("255")) return `+255 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  if (d.length === 10 && d.startsWith("0")) return `+255 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return d.length > 8 ? "+" + d : p;
}

function StatusRow({ c, waitingText = "Waiting for first sync" }: { c: Conn; waitingText?: string }) {
  return (
    <div className="row between small">
      <span><span className={"status-dot " + (c.status === "active" ? "on" : "err")} /> {c.label ?? c.external_id} <span className="muted">({c.external_id})</span></span>
      <span className={c.last_error ? "err" : "muted"}>{c.last_error ? `Error: ${c.last_error}${c.last_sync_at ? ` · last good sync ${when(c.last_sync_at)}` : ""}` : c.last_sync_at ? "Last successful sync " + when(c.last_sync_at) : waitingText}</span>
    </div>
  );
}

/** Disconnect an ad account: stops syncing and deletes the stored Meta token. Past figures stay unless asked. */
function DisconnectAds({ c, onDone, onError, last }: { c: Conn; onDone: (t: string) => void; onError: (t: string) => void; last: boolean }) {
  const [open, setOpen] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { data, error } = await supabase.rpc("disconnect_ads", { p_conn: c.id, p_delete_data: wipe });
    setBusy(false);
    if (error) return onError(error.message);
    const d = data as { ads_deleted: number; days_deleted: number };
    onDone(`${c.label ?? c.external_id} disconnected. itaOS no longer reads it${wipe && last ? ` and its past ad data was deleted (${d.ads_deleted} ads).` : "; past figures stay in your reports."} You can connect it again any time.`);
  }
  if (!open) return <button className="small linkish" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>Disconnect this ad account</button>;
  return (
    <div className="dh-key">
      <b className="small">Disconnect {c.label ?? c.external_id}?</b>
      <span className="small muted">itaOS stops reading spend and ad clicks from it right away and deletes its stored Meta access. Your ads on Facebook are not changed.</span>
      {last && <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} /> Also delete its past ad data from itaOS (spend, ads list). Chats and sales stay.</label>}
      <div className="row" style={{ gap: 6 }}>
        <button className="small danger" disabled={busy} onClick={go}>{busy ? "Disconnecting…" : "Disconnect"}</button>
        <button className="small" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** Step 4: send recorded sales from ad chats back to Meta (Conversions API), so ads are optimised for buyers.
 *  The owner pastes a system-user token from their own Meta portfolio; itaOS keeps it in the vault. */
function SalesToMeta({ ws, T }: { ws: Workspace; T: (en: string, sw: string) => string }) {
  type St = { connected: boolean; last_error: string | null; last_sent_at: string | null; token_last4: string | null; sent_30d: number; failed_30d: number };
  const [st, setSt] = useState<St | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const load = () => callFn<St>("capi", { workspace_id: ws.id, action: "status" }).then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    setBusy(true); setMsg({});
    try {
      const r = await callFn<{ datasets: number; sent: number; failed: number; problems: string[] }>("capi", { workspace_id: ws.id, action: "setup", token: token.trim() });
      setToken(""); setOpen(false);
      setMsg({ ok: T(`Connected. ${r.sent} recent sale${r.sent === 1 ? "" : "s"} sent to Meta${r.failed ? `, ${r.failed} failed` : ""}.`, `Imeunganishwa. Mauzo ${r.sent} ya karibuni yametumwa kwa Meta${r.failed ? `, ${r.failed} yameshindwa` : ""}.`) });
      load();
    } catch (e) { setMsg({ err: (e as Error).message }); }
    setBusy(false);
  }
  const on = !!st?.connected;
  return (
    <section className="card">
      <h2>{T("Send sales to Meta", "Tuma mauzo kwa Meta")}</h2>
      <p className="small muted" style={{ margin: 0 }}>{T("When you record a sale from a chat that came from a WhatsApp ad, itaOS tells Meta that click became a purchase, so Facebook shows your ads to people more likely to buy. Only the ad click, the amount and the currency are sent: no names, numbers or messages.", "Ukirekodi mauzo ya chat iliyotoka kwenye tangazo la WhatsApp, itaOS inaiambia Meta kwamba bofya hilo limeleta mauzo, ili Facebook ionyeshe matangazo yako kwa watu wenye uwezekano wa kununua. Hutumwa bofya la tangazo, kiasi na sarafu tu: hakuna majina, namba wala jumbe.")}</p>
      {msg.ok && <p className="ok small" style={{ margin: 0 }}>{msg.ok}</p>}
      {msg.err && <p className="err small" style={{ margin: 0 }}>{msg.err}</p>}
      {st && on && (
        <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
          <span><span className={"status-dot " + (st.last_error ? "err" : "on")} /> <b>{T(`${st.sent_30d} sales sent in 30 days`, `Mauzo ${st.sent_30d} yametumwa siku 30`)}</b>
            <span className="small muted">{st.last_sent_at ? T(` · last ${ago(st.last_sent_at)}`, ` · mwisho ${ago(st.last_sent_at)}`) : ""}{st.token_last4 ? ` · token …${st.token_last4}` : ""}</span></span>
          <span className={"pill-s " + (st.last_error ? "err" : "on")}>{st.last_error ? T("Needs attention", "Inahitaji kuangaliwa") : T("Connected ✓", "Imeunganishwa ✓")}</span>
        </div>
      )}
      {st?.last_error && <p className="small err" style={{ margin: 0 }}>{st.last_error}</p>}
      {(!on || open) ? (
        <div style={{ display: "grid", gap: 8 }}>
          <label className="small muted" htmlFor="capi-token">{T("Meta system-user token (from your own Business portfolio, with whatsapp_business_management and whatsapp_business_manage_events)", "Token ya system user ya Meta (kutoka portfolio yako ya biashara, yenye whatsapp_business_management na whatsapp_business_manage_events)")}</label>
          <input id="capi-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAA…" />
          <div className="row" style={{ gap: 8 }}>
            <button className="small primary" disabled={busy || token.trim().length < 50} onClick={save}>{busy && <span className="kito-spin sm" aria-hidden />}{busy ? T("Checking with Meta…", "Inathibitisha na Meta…") : T("Save and connect", "Hifadhi na unganisha")}</button>
            {on && <button className="linkish small" onClick={() => { setOpen(false); setToken(""); }}>{T("Cancel", "Ghairi")}</button>}
          </div>
        </div>
      ) : <div><button className="linkish small" onClick={() => setOpen(true)}>{T("Replace token", "Badilisha token")}</button></div>}
    </section>
  );
}

/** Google (Contacts + Tasks) for this business: one Google account, two switches. The sign-in happens on
 *  Google's page and comes back to #connect with ?google=ok|cancelled|partial|norefresh|error. */
type GLink = { email: string | null; status: string; last_error: string | null; last_sync_at: string | null; connected_at: string;
  tasks_on: boolean; tasks_synced: number; contacts_on: boolean; contacts_days: number; contacts_synced: number; contacts_skipped: number; contacts_full: boolean };
function GoogleCard({ ws, T }: { ws: Workspace; T: (en: string, sw: string) => string }) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [link, setLink] = useState<GLink | null | undefined>(undefined);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>(() => {
    const r = new URLSearchParams(location.search).get("google");
    if (!r) return {};
    history.replaceState(null, "", location.pathname + location.hash);
    if (r === "ok") return { ok: T("Google connected. Your reminders are being added to Google Tasks.", "Google imeunganishwa. Vikumbusho vyako vinaongezwa Google Tasks.") };
    if (r === "partial") return { err: T("Connected, but some boxes were unticked on Google's page. Disconnect and connect again, and tick all of them.", "Imeunganishwa, lakini baadhi ya visanduku havikuwekwa tiki kwenye ukurasa wa Google. Tenganisha na unganisha tena, weka tiki zote.") };
    if (r === "cancelled") return { err: T("You cancelled on Google's page. Nothing was connected.", "Umeghairi kwenye ukurasa wa Google. Hakuna kilichounganishwa.") };
    if (r === "norefresh") return { err: T("Google didn't give itaOS lasting access. Try Connect again.", "Google haikuipa itaOS ruhusa ya kudumu. Jaribu Unganisha tena.") };
    return { err: T("Google connection failed. Try again.", "Kuunganisha Google kumeshindwa. Jaribu tena.") };
  });
  const manage = canManage(ws);
  const load = () => {
    supabase.from("google_links").select("email,status,last_error,last_sync_at,connected_at,tasks_on,tasks_synced,contacts_on,contacts_days,contacts_synced,contacts_skipped,contacts_full")
      .eq("workspace_id", ws.id).maybeSingle().then(({ data }) => setLink((data as GLink) ?? null));
    supabase.rpc("google_contacts_waiting", { p_ws: ws.id }).then(({ data }) => setWaiting(typeof data === "number" ? data : null));
  };
  useEffect(() => {
    callFn<{ configured: boolean }>("google", { action: "status" }).then((r) => setReady(!!r.configured)).catch(() => setReady(false));
    load();
    const id = setInterval(load, 30e3);
    return () => clearInterval(id);
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    setBusy("connect"); setMsg({});
    try { const r = await callFn<{ url: string }>("google", { action: "start", workspace_id: ws.id }); location.href = r.url; }
    catch (e) { setMsg({ err: (e as Error).message }); setBusy(null); }
  }
  async function save(patch: Partial<Pick<GLink, "tasks_on" | "contacts_on" | "contacts_days">>, which: string) {
    setBusy(which); setMsg({});
    setLink((l) => (l ? { ...l, ...patch } : l));
    try { await callFn("google", { action: "settings", workspace_id: ws.id, ...patch }); load(); }
    catch (e) { setMsg({ err: (e as Error).message }); load(); }
    setBusy(null);
  }
  async function disconnect() {
    if (!window.confirm(T("Disconnect Google? Tasks and contacts already in Google stay there; itaOS just stops adding new ones.", "Tenganisha Google? Kazi na majina yaliyopo Google yatabaki; itaOS itaacha kuongeza mapya."))) return;
    setBusy("disconnect"); setMsg({});
    try { await callFn("google", { action: "disconnect", workspace_id: ws.id }); setMsg({ ok: T("Google disconnected.", "Google imetenganishwa.") }); load(); }
    catch (e) { setMsg({ err: (e as Error).message }); }
    setBusy(null);
  }
  async function syncNow() {
    setBusy("sync"); setMsg({});
    try { await callFn("google", { action: "sync", workspace_id: ws.id }); load(); } catch (e) { setMsg({ err: (e as Error).message }); }
    setBusy(null);
  }

  const ok = link?.status === "active" && !link.last_error;
  const expired = link && link.status !== "active";
  const spin = (w: string) => busy === w && <span className="kito-spin sm" aria-hidden />;
  const sw = (on: boolean, onChange: () => void, label: string, which: string) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={"gsw" + (on ? " on" : "")} disabled={!manage || !!busy} onClick={onChange}>{busy === which ? <span className="kito-spin sm" aria-hidden /> : <i />}</button>
  );
  return (
    <section className="card gcard">
      <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
        <h2 className="gcard-title">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          {T("Google — Contacts & Tasks", "Google — Majina na Kazi")}
        </h2>
        {link && <span className={"pill-s " + (ok ? "on" : "err")}>{ok ? T("Connected ✓", "Imeunganishwa ✓") : T("Needs attention", "Inahitaji kuangaliwa")}</span>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{T("Connect a Google account so your promise reminders show up in Google Tasks, and your buyers' names are saved in Google Contacts (so WhatsApp on your phone shows who's who). itaOS never reads your email.", "Unganisha akaunti ya Google ili vikumbusho vya ahadi vionekane Google Tasks, na majina ya wanunuzi wako yahifadhiwe Google Contacts (WhatsApp kwenye simu itaonyesha nani ni nani). itaOS haisomi barua pepe zako.")}</p>
      {msg.ok && <p className="ok small" style={{ margin: 0 }}>{msg.ok}</p>}
      {msg.err && <p className="err small" style={{ margin: 0 }}>{msg.err}</p>}

      {link === undefined || ready === null ? null : !link ? (
        ready ? (
          manage ? <div><button className="primary" disabled={!!busy} onClick={connect}>{spin("connect")}{T("Connect Google", "Unganisha Google")}</button></div>
            : <p className="small muted" style={{ margin: 0 }}>{T("Ask the business owner to connect Google.", "Muombe mmiliki wa biashara aunganishe Google.")}</p>
        ) : <p className="small muted" style={{ margin: 0 }}><span className="status-dot warn" /> {T("Coming soon: Pondi is finishing the Google setup.", "Inakuja hivi karibuni: Pondi wanamalizia mpangilio wa Google.")}</p>
      ) : (
        <div className="gcard-body">
          <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
            <span><span className={"status-dot " + (ok ? "on" : "err")} /> <b>{link.email ?? T("Google account", "Akaunti ya Google")}</b>
              <span className="small muted">{link.last_sync_at ? T(` · synced ${ago(link.last_sync_at)}`, ` · imesawazishwa ${ago(link.last_sync_at)}`) : T(" · waiting for the first sync", " · inasubiri usawazishaji wa kwanza")}</span></span>
            {manage && !expired && <button className="small" disabled={!!busy} onClick={syncNow}>{spin("sync")}{T("Sync now", "Sawazisha sasa")}</button>}
          </div>
          {expired && <div className="finding bad small"><b>{T("Google sign-in expired.", "Muunganisho wa Google umeisha.")}</b> {T("Nothing is being added to Google until you reconnect.", "Hakuna kinachoongezwa Google mpaka uunganishe tena.")} {manage && ready && <button className="small primary" disabled={!!busy} onClick={connect} style={{ marginLeft: 6 }}>{spin("connect")}{T("Reconnect", "Unganisha tena")}</button>}</div>}
          {!expired && link.last_error && <p className="small err" style={{ margin: 0 }}>{link.last_error}</p>}

          <div className="gopt">
            <div>
              <b>{T("Promises → Google Tasks", "Ahadi → Google Tasks")}</b>
              <span className="small muted">{T(`Each reminder you confirm becomes a task in the list "itaOS · ${ws.name}", and is ticked off when the customer pays or you close it. Google Tasks shows the day, not the time.`, `Kila kikumbusho unachothibitisha kinakuwa kazi kwenye orodha "itaOS · ${ws.name}", na kinatiwa tiki mteja akilipa au ukikifunga. Google Tasks inaonyesha siku, si saa.`)}{link.tasks_synced ? T(` ${link.tasks_synced} added so far.`, ` ${link.tasks_synced} zimeongezwa hadi sasa.`) : ""}</span>
            </div>
            {sw(link.tasks_on, () => save({ tasks_on: !link.tasks_on }, "tasks"), T("Promises to Google Tasks", "Ahadi kwenda Google Tasks"), "tasks")}
          </div>

          <div className="gopt">
            <div>
              <b>{T("Save contacts to Google", "Hifadhi majina Google")}</b>
              <span className="small muted">{T(`Saved as "Name · ${ws.name.split(/\s+/)[0]} · Region" under the label itaOS. Numbers already in your Google contacts are left as they are.`, `Yanahifadhiwa kama "Jina · ${ws.name.split(/\s+/)[0]} · Mkoa" chini ya lebo itaOS. Namba zilizopo tayari kwenye Google zinaachwa kama zilivyo.`)}</span>
              {link.contacts_on && <span className="small">{T(`${link.contacts_synced} saved`, `${link.contacts_synced} yamehifadhiwa`)}{link.contacts_skipped ? T(` · ${link.contacts_skipped} already in Google`, ` · ${link.contacts_skipped} yalikuwepo Google`) : ""}{waiting ? T(` · ${waiting} waiting (about 2,400 an hour)`, ` · ${waiting} yanasubiri (karibu 2,400 kwa saa)`) : ""}</span>}
              {link.contacts_full && <span className="small err">{T("Google's limit of 25,000 contacts is reached, so itaOS stopped adding. Remove some contacts in Google to make room.", "Kikomo cha Google cha majina 25,000 kimefikiwa, itaOS imeacha kuongeza. Futa baadhi ya majina Google kupata nafasi.")}</span>}
              {link.contacts_on && manage && (
                <label className="small muted gwho">{T("Who to save", "Wahifadhiwe nani")}{" "}
                  <select value={link.contacts_days} disabled={!!busy} onChange={(e) => save({ contacts_days: Number(e.target.value) }, "days")}>
                    <option value={0}>{T("Paying buyers only", "Wanunuzi waliolipa tu")}</option>
                    <option value={30}>{T("Buyers + chats from the last 30 days", "Wanunuzi + chat za siku 30")}</option>
                    <option value={90}>{T("Buyers + chats from the last 90 days", "Wanunuzi + chat za siku 90")}</option>
                  </select>
                </label>
              )}
            </div>
            {sw(link.contacts_on, () => save({ contacts_on: !link.contacts_on }, "contacts"), T("Save contacts to Google", "Hifadhi majina Google"), "contacts")}
          </div>

          {manage && <div><button className="linkish small" disabled={!!busy} onClick={disconnect}>{spin("disconnect")}{T("Disconnect Google", "Tenganisha Google")}</button></div>}
        </div>
      )}
    </section>
  );
}
