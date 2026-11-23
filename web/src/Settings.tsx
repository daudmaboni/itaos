import { Fragment, useEffect, useRef, useState } from "react";
import Dashboard from "./Dashboard";
import Templates from "./Templates";
import MoneyHero, { HERO_STYLES, SAMPLE, saveHeroStyle, useHeroStyle, PROFIT_LOOKS, saveProfitLook, useProfitLook } from "./MoneyHero";
import type { ProfitLook } from "./MoneyHero";
import type { HeroStyle } from "./MoneyHero";
import { createPortal } from "react-dom";
import { palette, readLogo } from "./brand";
import { supabase, callFn, Workspace, canManage, canEdit, when, moneyInput, moneyText, commaRuns } from "./lib";
import PhoneApp from "./PhoneApp";
import { enterCards, enterRows, flash, shake, usePageEnter, select } from "./motion";
import { useBackLayer, replaceEntry } from "./backStack";

type Tab = "business" | "profile" | "appearance" | "rules" | "app" | "account";
const TABS: [Tab, string, string][] = [["business", "Business", "Biashara"], ["profile", "Business profile", "Wasifu wa biashara"], ["appearance", "Appearance", "Muonekano"], ["rules", "Rules & rates", "Kanuni na viwango"], ["app", "App & notifications", "App na arifa"], ["account", "My profile", "Wasifu wangu"]];
const CURRENCIES: [string, string, string][] = [["TZS", "Tanzanian shillings", "Shilingi za Tanzania"], ["KES", "Kenyan shillings", "Shilingi za Kenya"], ["UGX", "Ugandan shillings", "Shilingi za Uganda"], ["RWF", "Rwandan francs", "Faranga za Rwanda"]];  // customers pay in local money; USD is for ad spend only, never for sales
const TIMEZONES: [string, string][] = [["Africa/Dar_es_Salaam", "Tanzania (Dar es Salaam)"], ["Africa/Nairobi", "Kenya (Nairobi)"], ["Africa/Kampala", "Uganda (Kampala)"], ["Africa/Kigali", "Rwanda (Kigali)"], ["Africa/Johannesburg", "South Africa"], ["Europe/London", "UK (London)"], ["UTC", "UTC"]];

export default function Settings({ ws, onWs, theme, onTheme }: { ws: Workspace; onWs: (w: Workspace) => void; theme: "graphite" | "dark" | "light"; onTheme: (t: "graphite" | "dark" | "light", from?: HTMLElement | null) => void }) {
  const [tab, setTab] = useState<Tab>(() => { const t = location.hash.split("/")[1]; return t === "rates" ? "rules" : TABS.some(([k]) => k === t) ? (t as Tab) : "business"; });
  const [email, setEmail] = useState("");
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? "")); }, []);
  useEffect(() => { replaceEntry("#settings/" + tab); }, [tab]); // keeps the entry's number, so Home → Back still leaves the app
  useEffect(() => { document.querySelector("nav.subtabs a.on")?.scrollIntoView({ block: "nearest", inline: "center" }); }, [tab]);
  const pageRef = usePageEnter<HTMLDivElement>((root) => {
    enterCards(select(root, ":scope > .card"), { stagger: 0.07 });
    enterRows(select(root, ".field"), { delay: 0.25, y: 8, stagger: 0.04 });
  }, [tab]);

  return (
    <div className="shell-grid" ref={pageRef}>
      <div className="hero">
        <div style={{ display: "grid", gap: 4 }}>
          <h2>{T("Settings", "Mipangilio")}</h2>
          <div className="sub"><span>{ws.name} · {T("changes apply to everyone in this workspace.", "mabadiliko yanawahusu wote kwenye workspace hii.")}</span></div>
        </div>
      </div>
      <nav className="tabs subtabs" aria-label="Settings sections">
        {TABS.map(([k, en, sw]) => <a key={k} href={"#settings/" + k} className={tab === k ? "on" : ""} onClick={(e) => { e.preventDefault(); setTab(k); }}>{T(en, sw)}</a>)}
      </nav>
      {!canManage(ws) && tab !== "profile" && tab !== "account" && tab !== "appearance" && tab !== "app" && <p className="small muted">{T("Only an owner or admin can change these settings.", "Mmiliki au msimamizi tu anaweza kubadilisha mipangilio hii.")}</p>}
      {tab === "business" && <><Business ws={ws} onWs={onWs} T={T} /><Dashboard ws={ws} onWs={onWs} page="data" /></>}
      {tab === "profile" && <Profile ws={ws} T={T} />}
      {tab === "appearance" && <Appearance ws={ws} onWs={onWs} theme={theme} onTheme={onTheme} T={T} />}
      {tab === "rules" && <><PaymentsCurrency ws={ws} onWs={onWs} T={T} /><Rates ws={ws} onWs={onWs} T={T} /><ChatRules ws={ws} onWs={onWs} T={T} /><NameWords ws={ws} T={T} /><ReceiptLook ws={ws} onWs={onWs} T={T} /><Replying ws={ws} onWs={onWs} T={T} /><Templates ws={ws} T={T} /></>}
      {tab === "app" && <PhoneApp ws={ws} T={T} />}
      {tab === "account" && <><MyProfile ws={ws} T={T} /><Account email={email} T={T} /></>}
    </div>
  );
}

type Tr = (en: string, sw: string) => string;

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <span className="small muted">{hint}</span>}</div>;
}

function useSave<T extends Partial<Workspace>>(ws: Workspace, onWs: (w: Workspace) => void) {
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  async function save(patch: T, form: HTMLFormElement | null, okText: string) {
    setBusy(true); setMsg({});
    const { error } = await supabase.from("workspaces").update(patch).eq("id", ws.id);
    setBusy(false);
    if (error) { shake(form); setMsg({ err: error.message }); return false; }
    onWs({ ...ws, ...patch });
    setMsg({ ok: okText }); flash(form?.querySelector(".savemsg") ?? null);
    return true;
  }
  return { msg, busy, save };
}

function Business({ ws, onWs, T }: { ws: Workspace; onWs: (w: Workspace) => void; T: Tr }) {
  const manager = canManage(ws);
  const [name, setName] = useState(ws.name);
  const [show, setShow] = useState<"TZS" | "USD">((ws.display_currency ?? (ws.currency === "USD" ? "USD" : "TZS")) as "TZS" | "USD");
  const { msg, busy, save } = useSave(ws, onWs);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await save({ name: name.trim(), display_currency: show }, e.currentTarget, T("Saved.", "Imehifadhiwa."));
  }
  return (
    <form className="card" onSubmit={submit}>
      <div><h2>{T("Business", "Biashara")}</h2><span className="small muted">{T("Your business name and how money is shown on the dashboard.", "Jina la biashara na jinsi pesa zinavyoonyeshwa kwenye dashibodi.")}</span></div>
      <Field id="s-name" label={T("Business name", "Jina la biashara")}><input id="s-name" required value={name} disabled={!manager} onChange={(e) => setName(e.target.value)} /></Field>
      <Field id="s-show" label={T("Show money in", "Onyesha pesa kwa")} hint={T(`Sales are in ${ws.currency} and Meta bills ads in USD. Everything on the dashboard is turned into the currency you pick here, using the exchange rate in Rules & rates.`, `Mauzo ni ${ws.currency} na Meta inatoza matangazo kwa USD. Kila kitu kwenye dashibodi kinabadilishwa kuwa sarafu unayochagua hapa, kwa kiwango kilicho kwenye Kanuni na viwango.`)}>
        <div className="seg" role="group" id="s-show" aria-label={T("Show money in", "Onyesha pesa kwa")}>
          {(["TZS", "USD"] as const).map((c) => <button key={c} type="button" disabled={!manager} className={show === c ? "on" : ""} aria-pressed={show === c} onClick={() => setShow(c)}>{c === "TZS" ? T("TZS (shillings)", "TZS (shilingi)") : T("USD (dollars)", "USD (dola)")}</button>)}
        </div>
      </Field>
      {manager && <SaveRow busy={busy} msg={msg} T={T} />}
    </form>
  );
}

/** What customers pay in. TZS for everyone today; changing it asks "are you sure?" because every sale is read in this currency. */
function PaymentsCurrency({ ws, onWs, T }: { ws: Workspace; onWs: (w: Workspace) => void; T: Tr }) {
  const manager = canManage(ws);
  const [pick, setPick] = useState(ws.currency);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setPick(ws.currency); }, [ws.currency]);
  const label = (c: string) => { const x = CURRENCIES.find(([k]) => k === c); return x ? `${c} · ${T(x[1], x[2])}` : c; };
  async function confirm() {
    setBusy(true); setErr("");
    const { error } = await supabase.from("workspaces").update({ currency: pick }).eq("id", ws.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onWs({ ...ws, currency: pick }); setAsk(false);
  }
  function cancel() { setAsk(false); setPick(ws.currency); }
  useBackLayer(ask, cancel); // phone Back = "No, keep"
  return (
    <section className="card">
      <div><h2>{T("Payments from customers", "Malipo kutoka kwa wateja")}</h2>
        <span className="small muted">{T("The currency customers pay you in (M-Pesa, Tigo Pesa, cash). Every sale you record is counted in this currency.", "Sarafu wateja wanayokulipa (M-Pesa, Tigo Pesa, cash). Kila mauzo unayorekodi yanahesabiwa kwa sarafu hii.")}</span></div>
      <Field id="s-paycur" label={T("Customers pay in", "Wateja wanalipa kwa")}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <select id="s-paycur" value={pick} disabled={!manager || busy} onChange={(e) => { setPick(e.target.value); if (e.target.value !== ws.currency) setAsk(true); }} style={{ width: 260 }}>
            {(CURRENCIES.some(([c]) => c === ws.currency) ? CURRENCIES : [[ws.currency, ws.currency, ws.currency] as [string, string, string], ...CURRENCIES]).map(([c]) => <option key={c} value={c}>{label(c)}</option>)}
          </select>
          {ws.currency === "TZS" && <span className="small ok">✓ {T("Shillings, as normal", "Shilingi, kama kawaida")}</span>}
        </div>
      </Field>
      {ws.currency !== "TZS" && <p className="small warnt" style={{ margin: 0 }}>⚠ {T(`Payments are set to ${ws.currency}. If your customers pay in shillings, change this back to TZS or your revenue will be wrong.`, `Malipo yamewekwa ${ws.currency}. Kama wateja wanalipa kwa shilingi, rudisha TZS la sivyo mapato yatakuwa si sahihi.`)}</p>}
      {err && <span className="err small">{err}</span>}
      {ask && createPortal(
        <div className="dr-layer" data-noswipe role="dialog" aria-modal="true" aria-labelledby="cur-ask-h">
          <div className="dr-scrim" onClick={cancel} aria-hidden />
          <div className="confirm-modal">
            <h2 id="cur-ask-h">{T("Are you sure?", "Una uhakika?")}</h2>
            <p style={{ margin: 0 }}>{T(`Change customer payments from ${ws.currency} to ${pick}?`, `Badilisha malipo ya wateja kutoka ${ws.currency} kwenda ${pick}?`)}</p>
            <p className="small muted" style={{ margin: 0 }}>{T(`Every sale, old and new, will be read as ${pick}. A sale typed as 205,000 will mean ${pick} 205,000. Only do this if your customers really pay in ${pick}.`, `Kila mauzo, ya zamani na mapya, yatasomwa kama ${pick}. Mauzo ya 205,000 yatamaanisha ${pick} 205,000. Fanya hivi tu kama wateja wanalipa kwa ${pick} kweli.`)}</p>
            <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={cancel} disabled={busy}>{T("No, keep ", "Hapana, baki ")}{ws.currency}</button>
              <button type="button" className="primary" onClick={confirm} disabled={busy}>{busy ? T("Saving…", "Inahifadhi…") : T(`Yes, change to ${pick}`, `Ndiyo, badilisha kuwa ${pick}`)}</button>
            </div>
          </div>
        </div>, document.body)}
    </section>
  );
}

function Appearance({ ws, onWs, theme, onTheme, T }: { ws: Workspace; onWs: (w: Workspace) => void; theme: "graphite" | "dark" | "light"; onTheme: (t: "graphite" | "dark" | "light", from?: HTMLElement | null) => void; T: Tr }) {
  const { msg, busy, save } = useSave(ws, onWs);
  return (
    <>
      <section className="card">
        <div><h2>{T("Theme", "Mandhari")}</h2><span className="small muted">{T("Saved on this device only.", "Inahifadhiwa kwenye kifaa hiki tu.")}</span></div>
        <div className="seg" role="group" aria-label="Theme">
          <button type="button" className={theme === "light" ? "on" : ""} aria-pressed={theme === "light"} onClick={(e) => onTheme("light", e.currentTarget)}>{T("Light", "Mwanga")}</button>
          <button type="button" className={theme !== "light" ? "on" : ""} aria-pressed={theme !== "light"} onClick={(e) => onTheme("graphite", e.currentTarget)}>{T("Dark", "Giza")}</button>
        </div>
      </section>
      <FontPicker T={T} />
      <HeroPicker T={T} />
      <form className="card" onSubmit={(e) => e.preventDefault()}>
        <div><h2>{T("Language", "Lugha")}</h2><span className="small muted">{T("Default language for the dashboard and Kito's notes. Everyone in the workspace sees this.", "Lugha chaguo-msingi ya dashibodi na maelezo ya Kito. Wote kwenye workspace wanaiona.")}</span></div>
        <div className="seg" role="group" aria-label="Language">
          {(["sw", "en"] as const).map((l) => <button key={l} type="button" disabled={busy} className={ws.language === l ? "on" : ""} aria-pressed={ws.language === l} onClick={(e) => save({ language: l }, e.currentTarget.closest("form"), l === "sw" ? "Imehifadhiwa." : "Saved.")}>{l === "sw" ? "Kiswahili" : "English"}</button>)}
        </div>
        <SaveRow busy={busy} msg={msg} T={T} noButton />
      </form>
    </>
  );
}

/** Owners/admins can answer WhatsApp chats from itaOS. This switch turns that off for the whole business. */
function Replying({ ws, onWs, T }: { ws: Workspace; onWs: (w: Workspace) => void; T: Tr }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const on = ws.send_enabled !== false;
  async function toggle() {
    setBusy(true); setErr("");
    const { error } = await supabase.from("workspaces").update({ send_enabled: !on }).eq("id", ws.id);
    setBusy(false);
    if (error) setErr(error.message); else onWs({ ...ws, send_enabled: !on });
  }
  return (
    <section className="card">
      <div><h2>{T("Reply to customers from itaOS", "Jibu wateja kutoka itaOS")}</h2>
        <span className="small muted">{T("The owner and admins can type replies in the chat. They go out from your own WhatsApp number and also appear in the WhatsApp Business app. WhatsApp allows this only within 24 hours of the customer's last message.", "Mmiliki na admin wanaweza kuandika majibu kwenye chat. Yanatoka kwa namba yako ya WhatsApp na pia yanaonekana kwenye app ya WhatsApp Business. WhatsApp inaruhusu hili ndani ya saa 24 tangu ujumbe wa mwisho wa mteja.")}</span></div>
      <label className="row" style={{ gap: 10, cursor: canManage(ws) ? "pointer" : "default" }}>
        <input type="checkbox" checked={on} disabled={busy || !canManage(ws) || !!ws.send_blocked} onChange={toggle} />
        <span>{on ? T("On: replies can be sent from itaOS", "Imewashwa: majibu yanaweza kutumwa kutoka itaOS") : T("Off: itaOS only reads chats", "Imezimwa: itaOS inasoma chat tu")}</span>
      </label>
      {ws.send_blocked && <span className="err small">{T("Pondi Technologies has turned this off for your business. Contact hello@ponditech.com to turn it back on.", "Pondi Technologies imezima hili kwa biashara yako. Wasiliana na hello@ponditech.com ili kuliwasha tena.")}</span>}
      {err && <span className="err small">{err}</span>}
    </section>
  );
}

/** The business's own wording that itaOS looks for in chats (no AI): which first messages come from an ad,
 *  the location reply only ad customers get, and the message sent once a customer has paid. */
function ChatRules({ ws, onWs, T }: { ws: Workspace; onWs: (w: Workspace) => void; T: Tr }) {
  const lines = (a?: string[]) => (a ?? []).join("\n");
  const [ad, setAd] = useState(lines(ws.rule_ad_texts));
  const [locQ, setLocQ] = useState(lines(ws.rule_loc_question));
  const [locR, setLocR] = useState(lines(ws.rule_loc_reply));
  const [paid, setPaid] = useState(lines(ws.rule_paid_texts));
  const [deliv, setDeliv] = useState(lines(ws.rule_delivered_texts));
  const [tick, setTick] = useState(!!ws.rule_owner_tick);
  const [recv, setRecv] = useState(lines(ws.rule_received_texts));
  const { msg, busy, save } = useSave(ws, onWs);
  const manager = canManage(ws);
  const list = (v: string, max: number) => [...new Set(v.split("\n").map((x) => x.trim().slice(0, 200)).filter(Boolean))].slice(0, max);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await save({ rule_ad_texts: list(ad, 20), rule_loc_question: list(locQ, 10), rule_loc_reply: list(locR, 10), rule_paid_texts: list(paid, 10),
                 rule_delivered_texts: list(deliv, 15), rule_received_texts: list(recv, 10), rule_owner_tick: tick, rules_reviewed_at: new Date().toISOString() },
      e.currentTarget, T("Saved. New messages are read with these rules.", "Imehifadhiwa. Jumbe mpya zinasomwa kwa kanuni hizi."));
  }
  const area = { rows: 3, style: { width: "100%", maxWidth: 520, fontFamily: "inherit" }, disabled: !manager };
  return (
    <form className="card" onSubmit={submit}>
      <div><h2>{T("How itaOS reads your chats", "Jinsi itaOS inavyosoma chat zako")}</h2><span className="small muted">{T("Your own wording, so itaOS can tell which chats came from an ad and which day a customer paid. One per line. Matched as written (capital letters don't matter), never guessed by AI. Applies to new messages.", "Maneno yako mwenyewe, ili itaOS ijue chat zipi zimetoka kwenye tangazo na siku gani mteja alilipa. Moja kwa kila mstari. Yanalinganishwa kama yalivyoandikwa (herufi kubwa hazijalishi), si kwa kubahatisha. Inatumika kwa jumbe mpya.")}</span></div>
      <Field id="r-ad" label={T("Your ad's opening message", "Ujumbe wa kwanza wa tangazo lako")} hint={T("The ready-made text a customer sends when they tap your ad (e.g. \"Mnapatikana wapi?\"). Put * at the end to also catch messages that start with it.", "Maandishi tayari ambayo mteja anatuma akibonyeza tangazo lako (mf. \"Mnapatikana wapi?\"). Weka * mwishoni kukamata pia jumbe zinazoanza nayo.")}>
        <textarea id="r-ad" {...area} rows={4} value={ad} placeholder={T("e.g. Hello! Can I get more info on this*", "mf. Habari, naomba maelezo zaidi*")} onChange={(e) => setAd(e.target.value)} />
      </Field>
      <Field id="r-lq" label={T("Your location reply: the customer asks", "Jibu lako la mahali: mteja anauliza")} hint={T("The question your location reply answers. Leave empty if any message counts.", "Swali ambalo jibu lako la mahali linajibu. Acha wazi kama ujumbe wowote unahesabika.")}>
        <textarea id="r-lq" {...area} rows={2} value={locQ} placeholder={T("e.g. Mnapatikana wapi", "mf. Mnapatikana wapi")} onChange={(e) => setLocQ(e.target.value)} />
      </Field>
      <Field id="r-lr" label={T("…and your reply always contains", "…na jibu lako lina maneno haya yote")} hint={T("Words that only appear in the reply you give to people who saw your ad (all of them must be there). Leave empty to turn this off.", "Maneno yanayoonekana tu kwenye jibu unalowapa walioona tangazo lako (yote lazima yawepo). Acha wazi kuzima.")}>
        <textarea id="r-lr" {...area} rows={2} value={locR} placeholder={T("e.g. Tunapatikana\ntangazo", "mf. Tunapatikana\ntangazo")} onChange={(e) => setLocR(e.target.value)} />
      </Field>
      <Field id="r-pd" label={T("The message you send after payment", "Ujumbe unaotuma baada ya malipo")} hint={T("A message you only send once the customer has paid (e.g. usage instructions). When itaOS sees it, that day becomes the payment day.", "Ujumbe unaoutuma tu baada ya mteja kulipa (mf. maelekezo ya matumizi). itaOS ikiuona, siku hiyo inakuwa siku ya malipo.")}>
        <textarea id="r-pd" {...area} rows={2} value={paid} placeholder={T("e.g. Asante kwa malipo, mzigo unaandaliwa", "mf. Asante kwa malipo, mzigo unaandaliwa")} onChange={(e) => setPaid(e.target.value)} />
      </Field>
      <Field id="r-dl" label={T("Messages you send once the customer has the goods", "Jumbe unazotuma mteja akishapata bidhaa")} hint={T("e.g. how to use the product, care instructions. These count as a sale only together with a payment sign (a payment screenshot, the customer saying they paid, or the payment details you sent). Leave empty if you don't send such messages.", "mf. jinsi ya kutumia bidhaa, maelekezo ya utunzaji. Zinahesabika kama mauzo tu pamoja na dalili ya malipo (picha ya malipo, mteja kusema amelipa, au maelezo ya malipo uliyotuma). Acha wazi kama hutumi jumbe kama hizi.")}>
        <textarea id="r-dl" {...area} rows={3} value={deliv} placeholder={T("e.g. Jinsi ya kutumia", "mf. Jinsi ya kutumia")} onChange={(e) => setDeliv(e.target.value)} />
      </Field>
      <Field id="r-rc" label={T("Your words for \"I've received the money\"", "Maneno yako ya \"nimepokea pesa\"")} hint={T("For customers who pay at your office, in cash, or when you check your wallet yourself, with no screenshot. Any message you send with these words records a paid sale straight away. Put the price in the same message (e.g. \"Tumepokea malipo 205,000\"), or itaOS uses the last price you sent them. Leave empty if you don't use this.", "Kwa wateja wanaolipa ofisini, kwa pesa taslimu, au ukiangalia mwenyewe kwenye wallet, bila screenshot. Ujumbe wowote utakaotuma wenye maneno haya unarekodi mauzo yaliyolipwa papo hapo. Weka bei kwenye ujumbe huo huo (mf. \"Tumepokea malipo 205,000\"), la sivyo itaOS inatumia bei ya mwisho uliyowatumia. Acha wazi kama hutumii hili.")}>
        <textarea id="r-rc" {...area} rows={2} value={recv} placeholder={T("e.g. Tumepokea malipo", "mf. Tumepokea malipo")} onChange={(e) => setRecv(e.target.value)} />
      </Field>
      <div className="field">
        <label className="row" style={{ gap: 10, cursor: manager ? "pointer" : "default", alignItems: "flex-start" }}>
          <input type="checkbox" checked={tick} disabled={!manager} onChange={(e) => setTick(e.target.checked)} style={{ marginTop: 3 }} />
          <span><b>{T("I mark payments with a ✅", "Ninaweka ✅ kuonyesha malipo")}</b><br />
            <span className="small muted">{T("When you send just a price with a tick (\"TZS 205,000✅\"), itaOS records a paid sale, even with no screenshot from the customer. \"Umelipiwa✅\" or a price with other words around it counts once the customer has shown payment. Turn this off if you use ✅ for anything else.", "Ukituma bei peke yake yenye tiki (\"TZS 205,000✅\"), itaOS inarekodi mauzo yaliyolipwa, hata bila screenshot ya mteja. \"Umelipiwa✅\" au bei yenye maneno mengine inahesabika mteja akishaonyesha malipo. Zima kama unatumia ✅ kwa mambo mengine.")}</span></span>
        </label>
      </div>
      {manager && <SaveRow busy={busy} msg={msg} T={T} />}
    </form>
  );
}

// "Customer names on receipts" (migration 0058): this business's own label words. Many businesses save
// customers as "Michael Oct TTS Leads A 1182"; these words are taken out to find the real name for receipts.
// Kito also reads the chat for the name the customer gave, which comes first. Everything here is per business.
type NameRules = { tags: string[]; names: string[]; auto: { word: string; uses: number }[]; products: string[]; builtin: string[];
  examples: { saved: string; shown: string | null; source: string | null }[] };

function NameWords({ ws, T }: { ws: Workspace; T: Tr }) {
  const manager = canManage(ws);
  const [r, setR] = useState<NameRules | null>(null);
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [allAuto, setAllAuto] = useState(false);
  useEffect(() => { supabase.rpc("name_rules", { p_ws: ws.id }).then(({ data, error }) => { if (error) setErr(error.message); else setR(data as NameRules); }); }, [ws.id]);
  const change = async (words: string[], kind: "tag" | "name" | null) => {
    if (!words.length) return;
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("set_name_words", { p_ws: ws.id, p_words: words, p_kind: kind });
    setBusy(false);
    if (error) { setErr(T("Couldn't save. Try again.", "Imeshindwa kuhifadhi. Jaribu tena.")); return; }
    setR(data as NameRules);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const words = add.split(/[\s,;]+/).map((w) => w.trim()).filter(Boolean);
    change(words, "tag").then(() => setAdd(""));
  };
  const src = (s: string | null) => s === "kito" ? T("from the chat", "kutoka kwenye chat") : s === "owner" ? T("typed by you", "umeandika wewe")
    : s === "clean" ? T("from the saved name", "kutoka jina lililohifadhiwa") : s === "auto" ? T("from the delivery message", "kutoka ujumbe wa mzigo") : "";
  const x = (label: string, onClick: () => void) => manager
    ? <button type="button" className="nw-x" aria-label={label} title={label} disabled={busy} onClick={onClick}>×</button> : null;
  const auto = r ? (allAuto ? r.auto : r.auto.slice(0, 24)) : [];
  return (
    <section className="card" style={{ display: "grid", gap: 14 }}>
      <style>{`.nw-chips{display:flex;flex-wrap:wrap;gap:6px}
        .nw-chip{display:inline-flex;align-items:center;gap:4px;font-size:13px;padding:4px 6px 4px 11px;border-radius:999px;background:var(--raised);border:1px solid var(--line)}
        .nw-chip.ro{padding-right:11px}.nw-chip .muted{font-size:11px}
        .nw-x{all:unset;cursor:pointer;width:22px;height:22px;display:inline-grid;place-items:center;border-radius:999px;font-size:15px;line-height:1;color:var(--muted)}
        .nw-x:hover{background:var(--line);color:var(--ink)}.nw-x:focus-visible{outline:2px solid var(--accent)}
        .nw-keep{all:unset;cursor:pointer;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;color:var(--muted);border:1px solid var(--line)}
        .nw-keep:hover{color:var(--ink);border-color:var(--line-2)}.nw-keep:focus-visible{outline:2px solid var(--accent)}
        .nw-ex{display:grid;grid-template-columns:1fr auto 1fr;gap:4px 10px;align-items:baseline;font-size:13px}
        .nw-ex .from{color:var(--muted);overflow-wrap:anywhere}`}</style>
      <div><h2>{T("Customer names on receipts", "Majina ya wateja kwenye risiti")}</h2>
        <span className="small muted">{T("If you save customers with your own labels (campaign, month, list number…), itaOS takes those words out to find the person's real name for receipts. Kito also reads the chat for the name the customer gave, and that comes first. These words are for this business only.",
          "Ukihifadhi wateja kwa alama zako (kampeni, mwezi, namba ya orodha…), itaOS inaondoa maneno hayo kupata jina halisi la mtu kwa risiti. Kito pia husoma chat kupata jina alilotaja mteja, na hilo linatangulia. Maneno haya ni ya biashara hii tu.")}</span></div>
      {err && <span className="small err">{err}</span>}
      {!r && !err && <span className="small muted">{T("Loading…", "Inapakia…")}</span>}
      {r && <>
        <div style={{ display: "grid", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{T("Your label words", "Maneno ya alama zako")}</h3>
          <span className="small muted">{T("Always removed from saved names.", "Yanaondolewa kila mara kwenye majina yaliyohifadhiwa.")}</span>
          <div className="nw-chips">
            {r.tags.length === 0 && <span className="small muted">{T("None yet.", "Bado hakuna.")}</span>}
            {r.tags.map((w) => <span key={w} className="nw-chip">{w.toUpperCase()}{x(T(`Remove ${w}`, `Ondoa ${w}`), () => change([w], null))}</span>)}
          </div>
          {manager && <form onSubmit={submit} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder={T("e.g. TTS NGV Q4", "mf. TTS NGV Q4")} aria-label={T("Words to add", "Maneno ya kuongeza")}
              style={{ flex: "1 1 220px", maxWidth: 360 }} maxLength={300} />
            <button type="submit" disabled={busy || !add.trim()}>{busy ? T("Saving…", "Inahifadhi…") : T("Add", "Ongeza")}</button>
          </form>}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{T("Found automatically", "Yamegunduliwa yenyewe")} <span className="small muted">{r.auto.length}</span></h3>
          <span className="small muted">{T("Words that appear in many of your saved names, so itaOS treats them as labels. Checked every night. If one is really part of people's names, tap \"It's a name\".",
            "Maneno yanayojitokeza kwenye majina mengi uliyohifadhi, hivyo itaOS inayachukulia kama alama. Yanaangaliwa kila usiku. Kama moja ni sehemu ya majina ya watu, bonyeza \"Ni jina\".")}</span>
          <div className="nw-chips">
            {r.auto.length === 0 && <span className="small muted">{T("None yet.", "Bado hakuna.")}</span>}
            {auto.map((a) => <span key={a.word} className={"nw-chip" + (manager ? "" : " ro")}>{a.word.toUpperCase()} <span className="muted">{a.uses.toLocaleString()}</span>
              {manager && <button type="button" className="nw-keep" disabled={busy} onClick={() => change([a.word], "name")}>{T("It's a name", "Ni jina")}</button>}</span>)}
            {r.auto.length > 24 && <button type="button" className="nw-keep" onClick={() => setAllAuto((v) => !v)}>{allAuto ? T("Show fewer", "Onyesha machache") : T(`Show all ${r.auto.length}`, `Onyesha yote ${r.auto.length}`)}</button>}
          </div>
        </div>

        {r.names.length > 0 && <div style={{ display: "grid", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{T("Never removed", "Hayaondolewi kamwe")}</h3>
          <span className="small muted">{T("Kept as part of a name, even when they look like a label or a place.", "Yanabaki kama sehemu ya jina, hata yakionekana kama alama au mahali.")}</span>
          <div className="nw-chips">{r.names.map((w) => <span key={w} className="nw-chip">{w.charAt(0).toUpperCase() + w.slice(1)}{x(T(`Stop keeping ${w}`, `Acha kubakiza ${w}`), () => change([w], null))}</span>)}</div>
        </div>}

        <span className="small muted">
          {r.products.length > 0 && <>{T("Also removed: words from your product names", "Pia yanaondolewa: maneno ya majina ya bidhaa zako")} ({r.products.join(", ")}) · </>}
          {T("months, place names and common words like", "miezi, majina ya mahali na maneno ya kawaida kama")} {r.builtin.filter((w) => w.length > 2).slice(0, 8).join(", ")}…
        </span>

        {r.examples.length > 0 && <div style={{ display: "grid", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{T("Your latest buyers", "Wanunuzi wako wa karibuni")}</h3>
          <div className="nw-ex">
            {r.examples.map((e, i) => <Fragment key={i}>
              <span className="from">{e.saved}</span><span className="muted">→</span>
              <span><b>{e.shown ?? T("phone number", "namba ya simu")}</b>{e.source && <span className="small muted"> · {src(e.source)}</span>}</span>
            </Fragment>)}
          </div>
        </div>}
      </>}
    </section>
  );
}

function Rates({ ws, onWs, T }: { ws: Workspace; onWs: (w: Workspace) => void; T: Tr }) {
  const [rate, setRate] = useState(ws.fx_rate ? moneyText(ws.fx_rate) : "");
  const [auto, setAuto] = useState(ws.fx_auto !== false);
  const [fetching, setFetching] = useState(false);
  const [fxErr, setFxErr] = useState("");
  const [hours, setHours] = useState(String(ws.follow_up_hours ?? 24));
  const [win, setWin] = useState(String(ws.conversion_window_days ?? 30));
  const [tz, setTz] = useState(ws.timezone ?? "Africa/Dar_es_Salaam");
  const [unitCost, setUnitCost] = useState(moneyText(ws.unit_cost));
  const { msg, busy, save } = useSave(ws, onWs);
  const manager = canManage(ws);
  // fx_rate is always "1 ad-currency unit (USD) = N shillings", whatever the sales currency is set to.
  const fxFrom = ws.fx_base ?? "USD";
  const fxTo = ws.currency === fxFrom ? "TZS" : ws.currency;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = rate.trim() === "" ? null : Number(rate.replace(/[^\d.]/g, ""));
    const h = Number(hours), w = Number(win);
    const uc = unitCost.trim() === "" ? null : Number(unitCost.replace(/[^\d.]/g, ""));
    if (uc !== null && !(uc >= 0 && isFinite(uc))) { shake(e.currentTarget); return; }
    if ((!auto && v !== null && !(v > 0)) || !(h >= 1 && h <= 720) || !(w >= 1 && w <= 180)) { shake(e.currentTarget); return; }
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { shake(e.currentTarget); return; }
    const fx = auto ? { fx_auto: true } : { fx_auto: false, fx_rate: v, fx_source: "manual", fx_updated_at: new Date().toISOString() };
    const ok = await save({ ...fx, follow_up_hours: h, conversion_window_days: w, timezone: tz, unit_cost: uc }, e.currentTarget, T("Saved. Reports now use these rules.", "Imehifadhiwa. Ripoti sasa zinatumia kanuni hizi."));
    if (ok && auto && ws.fx_auto === false) refreshRate();
  }
  /** Ask the server for today's rate (only works while the rate is automatic). */
  async function refreshRate() {
    setFetching(true); setFxErr("");
    try {
      const r = await callFn<{ updated: { error?: string; skipped?: string }[] }>("fx-rate", { workspace_id: ws.id });
      const first = r.updated?.[0];
      if (first?.error) setFxErr(T("Could not get today's rate. It will try again within the hour.", "Imeshindwa kupata kiwango cha leo. Itajaribu tena ndani ya saa moja."));
      else if (first?.skipped === "no ad data") setFxErr(T("No ad account data yet, so there is nothing to convert.", "Bado hakuna data ya matangazo, hivyo hakuna cha kubadilisha."));
      const { data } = await supabase.from("workspaces").select("fx_rate,fx_auto,fx_updated_at,fx_source,fx_base").eq("id", ws.id).single();
      if (data) { onWs({ ...ws, ...data, fx_auto: true }); if (data.fx_rate) setRate(moneyText(data.fx_rate)); }
    } catch (e) { setFxErr((e as Error).message); }
    setFetching(false);
  }
  return (
    <form className="card" onSubmit={submit}>
      <div><h2>{T("Rates and counting rules", "Viwango na kanuni za kuhesabu")}</h2><span className="small muted">{T("How itaOS turns ad dollars into shillings and how it counts days, follow-ups and sales. Applied the same way on every page, never guessed by AI.", "Jinsi itaOS inavyobadilisha dola za matangazo kuwa shilingi na inavyohesabu siku, ufuatiliaji na mauzo. Zinatumika sawa kila ukurasa, si kwa kubahatisha.")}</span></div>
      <Field id="s-fx" label={T(`Exchange rate: 1 ${fxFrom} =`, `Kiwango: 1 ${fxFrom} =`)} hint={auto
          ? T("Updated automatically every few hours from the market rate. Used to compare what ads cost (USD) with what customers paid (TZS).", "Inasasishwa yenyewe kila baada ya saa chache kwa kiwango cha soko. Inatumika kulinganisha gharama ya matangazo (USD) na malipo ya wateja (TZS).")
          : T("You set this rate yourself. It stays until you change it.", "Umeweka kiwango hiki wewe mwenyewe. Kinabaki hadi ukibadilishe.")}>
        <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
          <label className="row" style={{ gap: 6, cursor: manager ? "pointer" : "default" }}><input type="radio" name="fx-mode" checked={auto} disabled={!manager} onChange={() => setAuto(true)} />{T("Automatic", "Kiotomatiki")}</label>
          <label className="row" style={{ gap: 6, cursor: manager ? "pointer" : "default" }}><input type="radio" name="fx-mode" checked={!auto} disabled={!manager} onChange={() => setAuto(false)} />{T("Set my own", "Weka mwenyewe")}</label>
        </div>
        {auto ? (
          <div className="row" style={{ gap: 10, marginTop: 6 }}>
            <b>{ws.fx_auto !== false && ws.fx_rate ? `${Number(ws.fx_rate).toLocaleString()} ${fxTo}` : "–"}</b>
            {ws.fx_auto !== false && ws.fx_updated_at && <span className="small muted">{T("updated", "imesasishwa")} {when(ws.fx_updated_at)}</span>}
            {manager && ws.fx_auto !== false && <button type="button" className="small" disabled={fetching} onClick={refreshRate}>{fetching ? "…" : T("Update now", "Sasisha sasa")}</button>}
          </div>
        ) : (
          <div className="row" style={{ marginTop: 6 }}><input id="s-fx" inputMode="decimal" style={{ width: 160 }} placeholder="e.g. 2600" value={rate} disabled={!manager} onChange={moneyInput(setRate)} /><span>{fxTo}</span></div>
        )}
        {fxErr && <span className="small err">{fxErr}</span>}
      </Field>
      <Field id="s-uc" label={T(`Default cost per order (${ws.currency})`, `Gharama ya kawaida kwa oda (${ws.currency})`)} hint={T("Product + delivery for a typical order. Used only for orders where you didn't pick products or type a cost, and the profit card then says \"estimated\". Leave empty if every order costs something different (e.g. phones).", "Bidhaa + usafiri kwa oda ya kawaida. Inatumika tu kwa oda ambazo hukuchagua bidhaa wala kuandika gharama, na kadi ya faida itasema \"makadirio\". Acha wazi kama kila oda ina gharama tofauti (mf. simu).")}>
        <input id="s-uc" inputMode="decimal" style={{ width: 160 }} placeholder={T("e.g. 10000", "mf. 10000")} value={unitCost} disabled={!manager} onChange={moneyInput(setUnitCost)} />
      </Field>
      <Field id="s-fu" label={T("Remind me to follow up after (hours)", "Nikumbushe kufuatilia baada ya (saa)")} hint={T("A customer who showed interest but got no message from you for this long shows up in Actions.", "Mteja aliyeonyesha nia bila ujumbe wako kwa muda huu anaonekana kwenye Vitendo.")}>
        <input id="s-fu" inputMode="numeric" style={{ width: 160 }} value={hours} disabled={!manager} onChange={(e) => setHours(e.target.value)} />
      </Field>
      <Field id="s-win" label={T("Count a sale for a chat if paid within (days)", "Hesabu mauzo kwa chat ikilipwa ndani ya (siku)")} hint={T("Example: 30 means a customer who starts chatting on 1 Nov and pays by 30 Nov counts as a sale from that chat (and its ad).", "Mfano: 30 maana yake mteja akianza chat 1 Nov na akalipa kabla ya 30 Nov, inahesabiwa mauzo ya chat hiyo (na tangazo lake).")}>
        <input id="s-win" inputMode="numeric" style={{ width: 160 }} value={win} disabled={!manager} onChange={(e) => setWin(e.target.value)} />
      </Field>
      <Field id="s-tz" label={T("Your time zone", "Saa za eneo lako")} hint={T("\"Today\" and \"yesterday\" start at midnight in this time zone.", "\"Leo\" na \"jana\" zinaanza saa sita usiku kwa saa hizi.")}>
        <select id="s-tz" style={{ width: 260 }} value={tz} disabled={!manager} onChange={(e) => setTz(e.target.value)}>
          {(TIMEZONES.some(([k]) => k === tz) ? TIMEZONES : [[tz, tz] as [string, string], ...TIMEZONES]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      {manager && <SaveRow busy={busy} msg={msg} T={T} />}
    </form>
  );
}

type ProfileRow = { products: { name: string; price: string; note: string }[]; delivery_areas: string; payment_methods: string; tone: string; faqs: { q: string; a: string }[]; constraints: string; updated_at?: string };
const emptyProfile = (): ProfileRow => ({ products: [], delivery_areas: "", payment_methods: "", tone: "", faqs: [], constraints: "" });

function Profile({ ws, T }: { ws: Workspace; T: Tr }) {
  const [p, setP] = useState<ProfileRow | null>(null);
  const [exists, setExists] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  const editor = canEdit(ws);
  useEffect(() => {
    supabase.from("business_profiles").select("*").eq("workspace_id", ws.id).maybeSingle().then(({ data, error }) => {
      if (error) setMsg({ err: error.message });
      if (data) { setExists(true); setP({ products: (data.products ?? []).map((x: any) => ({ name: x.name ?? "", price: x.price == null ? "" : String(x.price), note: x.note ?? "" })), delivery_areas: data.delivery_areas ?? "", payment_methods: data.payment_methods ?? "", tone: data.tone ?? "", faqs: (data.faqs ?? []).map((x: any) => ({ q: x.q ?? "", a: x.a ?? "" })), constraints: data.constraints ?? "", updated_at: data.updated_at }); }
      else setP(emptyProfile());
    });
  }, [ws.id]);
  if (!p) return <div className="skeleton" style={{ minHeight: 200 }} />;
  const set = (patch: Partial<ProfileRow>) => setP({ ...p, ...patch });
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg({});
    const row = {
      workspace_id: ws.id,
      products: p!.products.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim().slice(0, 80), price: x.price.trim().slice(0, 40), note: x.note.trim().slice(0, 160) })),
      delivery_areas: p!.delivery_areas.trim().slice(0, 600) || null, payment_methods: p!.payment_methods.trim().slice(0, 400) || null, tone: p!.tone.trim().slice(0, 300) || null,
      faqs: p!.faqs.filter((x) => x.q.trim()).map((x) => ({ q: x.q.trim().slice(0, 200), a: x.a.trim().slice(0, 500) })), constraints: p!.constraints.trim().slice(0, 800) || null,
    };
    const { error } = exists ? await supabase.from("business_profiles").update(row).eq("workspace_id", ws.id) : await supabase.from("business_profiles").insert(row);
    setBusy(false);
    if (error) { shake(e.currentTarget); setMsg({ err: error.message }); } else { setExists(true); setMsg({ ok: T("Saved. Kito uses this when drafting replies and content.", "Imehifadhiwa. Kito anatumia hii kuandika rasimu.") }); flash(e.currentTarget.querySelector(".savemsg")); }
  }
  return (
    <form className="card" onSubmit={submit}>
      <div><h2>{T("Business profile", "Wasifu wa biashara")}</h2><span className="small muted">{T("Tell Kito about your business. Kito only uses what is written here when it drafts replies or content, so keep prices and delivery up to date. Only people in this workspace can see it.", "Mweleze Kito kuhusu biashara yako. Kito anatumia tu kilichoandikwa hapa akiandika majibu au maudhui, hivyo weka bei na usafirishaji sahihi. Wanaoona ni watu wa workspace hii tu.")}{p.updated_at ? ` · ${T("last edited", "imehaririwa")} ${when(p.updated_at)}` : ""}</span></div>
      <div><h3>{T("Products and prices", "Bidhaa na bei")} <span className="small muted">(TZS)</span></h3>
        {p.products.length === 0 && <p className="small muted" style={{ margin: "4px 0 0" }}>{T("No products yet. Add each product with its price so Kito never quotes a wrong price.", "Bado hakuna bidhaa. Ongeza kila bidhaa na bei yake ili Kito asitaje bei isiyo sahihi.")}</p>}
        {p.products.map((x, i) => (
          <div className="row" key={i} style={{ marginTop: 6 }}>
            <input placeholder={T("Product", "Bidhaa")} value={x.name} disabled={!editor} onChange={(e) => set({ products: p.products.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
            <input placeholder={T("Price, e.g. 155,000", "Bei, mfano 155,000")} style={{ width: 160 }} value={x.price} disabled={!editor} onChange={(e) => set({ products: p.products.map((y, j) => (j === i ? { ...y, price: commaRuns(e.target.value) } : y)) })} />
            <input placeholder={T("Note (size, pack, what it is for)", "Maelezo")} value={x.note} disabled={!editor} onChange={(e) => set({ products: p.products.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)) })} />
            {editor && <button type="button" className="small" onClick={() => set({ products: p.products.filter((_, j) => j !== i) })}>×</button>}
          </div>
        ))}
        {editor && <button type="button" className="small" style={{ marginTop: 6 }} onClick={() => set({ products: [...p.products, { name: "", price: "", note: "" }] })}>{T("+ Add product", "+ Ongeza bidhaa")}</button>}
      </div>
      <Field id="bp-del" label={T("Delivery areas, cost and time", "Maeneo, gharama na muda wa usafirishaji")}><textarea id="bp-del" rows={2} value={p.delivery_areas} disabled={!editor} onChange={(e) => set({ delivery_areas: e.target.value })} /></Field>
      <Field id="bp-pay" label={T("Payment methods", "Njia za malipo")} hint={T("e.g. M-Pesa Lipa Namba, Tigo Pesa, cash on delivery in Dar", "mfano M-Pesa Lipa Namba, Tigo Pesa, cash ukipokea Dar")}><input id="bp-pay" value={p.payment_methods} disabled={!editor} onChange={(e) => set({ payment_methods: e.target.value })} /></Field>
      <Field id="bp-tone" label={T("Tone", "Sauti")} hint={T("How you talk to customers: formal/relaxed, Kiswahili/English, greetings you use", "Jinsi unavyoongea na wateja")}><input id="bp-tone" value={p.tone} disabled={!editor} onChange={(e) => set({ tone: e.target.value })} /></Field>
      <div><h3>{T("Common questions and your answers", "Maswali ya kawaida na majibu yako")}</h3>
        {p.faqs.map((x, i) => (
          <div className="row" key={i} style={{ marginTop: 6 }}>
            <input placeholder={T("Question", "Swali")} value={x.q} disabled={!editor} onChange={(e) => set({ faqs: p.faqs.map((y, j) => (j === i ? { ...y, q: e.target.value } : y)) })} />
            <input placeholder={T("Answer", "Jibu")} style={{ flex: 1, minWidth: 200 }} value={x.a} disabled={!editor} onChange={(e) => set({ faqs: p.faqs.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)) })} />
            {editor && <button type="button" className="small" onClick={() => set({ faqs: p.faqs.filter((_, j) => j !== i) })}>×</button>}
          </div>
        ))}
        {editor && <button type="button" className="small" style={{ marginTop: 6 }} onClick={() => set({ faqs: [...p.faqs, { q: "", a: "" }] })}>{T("+ Add question", "+ Ongeza swali")}</button>}
      </div>
      <Field id="bp-con" label={T("Things never to promise / service constraints", "Mambo ya kutoahidi / vikwazo")} hint={T("e.g. no medical claims, no same-day delivery outside Dar, no discounts below list price", "mfano hakuna madai ya kiafya, hakuna delivery siku hiyo nje ya Dar")}><textarea id="bp-con" rows={2} value={p.constraints} disabled={!editor} onChange={(e) => set({ constraints: e.target.value })} /></Field>
      {editor ? <SaveRow busy={busy} msg={msg} T={T} /> : <p className="small muted">{T("Viewer role: read-only.", "Nafasi ya kutazama tu.")}</p>}
    </form>
  );
}

/** The signed-in person: name, phone, email, role, when they joined. Name and phone are theirs to edit. */
function MyProfile({ ws, T }: { ws: Workspace; T: Tr }) {
  const [u, setU] = useState<any>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [emailMsg, setEmailMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const x = data.user; setU(x);
      setName(String(x?.user_metadata?.full_name ?? ""));
      setPhone(String(x?.user_metadata?.phone ?? ""));
    });
  }, []);
  const role: Record<string, [string, string]> = { owner: ["Owner", "Mmiliki"], admin: ["Admin", "Msimamizi"], analyst: ["Analyst", "Mchambuzi"], viewer: ["Viewer", "Mtazamaji"] };
  const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "–");

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setMsg({});
    const p = phone.trim();
    if (p && !/^\+?[0-9][0-9 -]{7,16}$/.test(p)) { shake(e.currentTarget); return setMsg({ err: T("Enter a phone number like +255 712 345 678.", "Weka namba kama +255 712 345 678.") }); }
    setBusy(true);
    const { data, error } = await supabase.auth.updateUser({ data: { full_name: name.trim().slice(0, 80) || null, phone: p || null } });
    setBusy(false);
    if (error) { shake(e.currentTarget); setMsg({ err: error.message }); } else { setU(data.user); flash(e.currentTarget); setMsg({ ok: T("Saved.", "Imehifadhiwa.") }); }
  }
  async function changeEmail() {
    setEmailMsg({});
    const em = newEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return setEmailMsg({ err: T("Enter a valid email.", "Weka barua pepe sahihi.") });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email: em }, { emailRedirectTo: location.origin + "/app#settings/account" });
    setBusy(false);
    if (error) setEmailMsg({ err: error.message });
    else { setNewEmail(""); setEmailMsg({ ok: T(`Check ${em} (and your current inbox) for a confirmation link. The email changes once you confirm.`, `Angalia ${em} (na barua pepe ya sasa) kupata kiungo cha uthibitisho. Itabadilika ukithibitisha.`) }); }
  }

  if (!u) return <section className="card"><span className="muted small">{T("Loading…", "Inapakia…")}</span></section>;
  return (
    <form className="card" onSubmit={save}>
      <div className="row between">
        <div className="row" style={{ gap: 12 }}>
          <div className="cc-avatar" aria-hidden>{(name || u.email || "?").slice(0, 1).toUpperCase()}</div>
          <div><h2>{name || T("Your profile", "Wasifu wako")}</h2><span className="small muted">{role[ws.role ?? "viewer"]?.[ws.language === "sw" ? 1 : 0] ?? ws.role} · {ws.name}</span></div>
        </div>
      </div>
      <div className="profile-facts small">
        <span><span className="muted">{T("Email", "Barua pepe")}</span><b>{u.email}</b>{u.email_confirmed_at ? <span className="ok"> ✓ {T("confirmed", "imethibitishwa")}</span> : <span className="warnt"> · {T("not confirmed", "haijathibitishwa")}</span>}</span>
        <span><span className="muted">{T("Joined", "Alijiunga")}</span><b>{day(u.created_at)}</b></span>
        <span><span className="muted">{T("Last sign-in", "Aliingia mwisho")}</span><b>{u.last_sign_in_at ? when(u.last_sign_in_at) : "–"}</b></span>
        <span><span className="muted">{T("Role", "Nafasi")}</span><b>{role[ws.role ?? "viewer"]?.[ws.language === "sw" ? 1 : 0] ?? ws.role}</b></span>
      </div>
      <Field id="p-name" label={T("Full name", "Jina kamili")}>
        <input id="p-name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Daud Maboni" />
      </Field>
      <Field id="p-phone" label={T("Phone number", "Namba ya simu")} hint={T("For your own records. itaOS never sends messages to it.", "Kwa kumbukumbu zako. itaOS haitumi ujumbe kwake.")}>
        <input id="p-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255 7xx xxx xxx" />
      </Field>
      <SaveRow busy={busy} msg={msg} T={T} />
      <Field id="p-email" label={T("Change email", "Badilisha barua pepe")} hint={T("We send a confirmation link; nothing changes until you click it.", "Tunatuma kiungo cha uthibitisho; hakuna kinachobadilika mpaka ukibonyeze.")}>
        <div className="row" style={{ gap: 6 }}>
          <input id="p-email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder={u.email} style={{ flex: 1 }} />
          <button type="button" className="small" disabled={busy || !newEmail.trim()} onClick={changeEmail}>{T("Send link", "Tuma kiungo")}</button>
        </div>
      </Field>
      {(emailMsg.ok || emailMsg.err) && <span className={"small " + (emailMsg.err ? "err" : "ok")}>{emailMsg.err ?? emailMsg.ok}</span>}
    </form>
  );
}

function Account({ email, T }: { email: string; T: Tr }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setMsg({});
    if (pw.length < 8) { shake(e.currentTarget); return setMsg({ err: T("Use at least 8 characters.", "Tumia herufi 8 au zaidi.") }); }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { shake(e.currentTarget); setMsg({ err: error.message }); } else { setPw(""); setMsg({ ok: T("Password changed.", "Nenosiri limebadilishwa.") }); }
  }
  return (
    <>
      <form className="card" onSubmit={submit}>
        <div><h2>{T("Password", "Nenosiri")}</h2><span className="small muted">{email}</span></div>
        <Field id="s-pw" label={T("New password", "Nenosiri jipya")} hint={T("At least 8 characters.", "Herufi 8 au zaidi.")}>
          <input id="s-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <SaveRow busy={busy} msg={msg} T={T} label={T("Change password", "Badilisha nenosiri")} />
      </form>
      <section className="card">
        <div className="row between">
          <div><h2>{T("Sign out", "Toka")}</h2><span className="small muted">{T("Signs you out on this device.", "Inakutoa kwenye kifaa hiki.")}</span></div>
          <button type="button" onClick={() => supabase.auth.signOut({ scope: "local" })}>{T("Sign out", "Toka")}</button>
        </div>
      </section>
    </>
  );
}

/** How this business's receipts look (migration 0059): colours, logo, town and how customers pay.
 *  Printed receipts and the public receipt page (QR) both use these. Nothing here is shared between businesses. */
function ReceiptLook({ ws, onWs, T }: { ws: Workspace; onWs: (w: Workspace) => void; T: Tr }) {
  const manager = canManage(ws);
  const [color, setColor] = useState(ws.brand_color ?? "");
  const [accent, setAccent] = useState(ws.brand_accent ?? "");
  const [town, setTown] = useState(ws.brand_town ?? "");
  const [pay, setPay] = useState(ws.pay_method ?? "");
  const [logo, setLogo] = useState<string | null>(null);
  const [logoMsg, setLogoMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { msg, busy, save } = useSave(ws, onWs);
  useEffect(() => {
    supabase.from("workspaces").select("brand_logo").eq("id", ws.id).single().then(({ data }) => setLogo((data as any)?.brand_logo ?? null));
  }, [ws.id]);
  const p = palette({ color: color || null, accent: accent || null });
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setLogoMsg("");
    try { setLogo(await readLogo(f)); }
    catch { setLogoMsg(T("Couldn't read that picture. Try a PNG or JPG.", "Imeshindwa kusoma picha hiyo. Jaribu PNG au JPG.")); }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const hex = (v: string) => (/^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
    const form = e.currentTarget;
    const { error } = await supabase.from("workspaces").update({ brand_logo: logo }).eq("id", ws.id);
    if (error) { setLogoMsg(T("Couldn't save the logo.", "Imeshindwa kuhifadhi nembo.")); return; }
    await save({ brand_color: hex(color), brand_accent: hex(accent), brand_town: town.trim().slice(0, 60) || null, pay_method: pay.trim().slice(0, 40) || null },
      form, T("Saved. New receipts use this look.", "Imehifadhiwa. Risiti mpya zinatumia muonekano huu."));
  }
  const sw = (v: string, set: (v: string) => void, id: string, fallback: string) => (
    <span className="rl-swatch">
      <input type="color" id={id} value={v || fallback} disabled={!manager} onChange={(e) => set(e.target.value)} />
      <code className="small">{v || T("itaOS default", "kawaida ya itaOS")}</code>
      {v && manager && <button type="button" className="small" onClick={() => set("")}>{T("Reset", "Rudisha")}</button>}
    </span>
  );
  return (
    <form className="card rl-card" onSubmit={submit}>
      <div><h2>{T("Your receipts", "Risiti zako")}</h2><span className="small muted">{T("Your logo, colours and details on printed receipts and on the page the receipt's QR opens. For this business only.", "Nembo, rangi na taarifa zako kwenye risiti zinazochapishwa na kwenye ukurasa unaofunguliwa na QR ya risiti. Kwa biashara hii tu.")}</span></div>
      <Field id="rl-logo" label={T("Logo", "Nembo")} hint={T("A square picture works best. It's made small automatically.", "Picha ya mraba ni bora zaidi. Inapunguzwa ukubwa yenyewe.")}>
        <span className="rl-logo">
          <span className="rl-mark" style={{ background: logo ? "#fff" : p.green }}>
            {logo ? <img src={logo} alt="" /> : ws.name.trim().charAt(0).toUpperCase()}
          </span>
          {manager && <>
            {/* The real file input is hidden: the app styles every input full width, which pushed this card off small screens. */}
            <input id="rl-logo" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} hidden />
            <button type="button" className="small" onClick={() => fileRef.current?.click()}>{logo ? T("Change logo", "Badilisha nembo") : T("Choose logo", "Chagua nembo")}</button>
            {logo && <button type="button" className="small" onClick={() => setLogo(null)}>{T("Remove", "Ondoa")}</button>}
          </>}
        </span>
        {logoMsg && <span className="err small">{logoMsg}</span>}
      </Field>
      <Field id="rl-c" label={T("Main colour", "Rangi kuu")}>{sw(color, setColor, "rl-c", p.green)}</Field>
      <Field id="rl-a" label={T("Second colour", "Rangi ya pili")}>{sw(accent, setAccent, "rl-a", p.honey)}</Field>
      <Field id="rl-t" label={T("Town shown under your name", "Mji unaoonekana chini ya jina lako")} hint={T("Leave empty to show only your phone number.", "Acha wazi kuonyesha namba ya simu tu.")}>
        <input id="rl-t" value={town} maxLength={60} disabled={!manager} placeholder={T("e.g. Arusha", "mf. Arusha")} onChange={(e) => setTown(e.target.value)} />
      </Field>
      <Field id="rl-p" label={T("How customers pay you", "Wateja wanakulipa kwa njia gani")} hint={T("Shown next to the payment code, e.g. M-Pesa, Tigo Pesa, Lipa Namba, CRDB. Leave empty to show just \"Payment\".", "Inaonekana pembeni ya namba ya muamala, mf. M-Pesa, Tigo Pesa, Lipa Namba, CRDB. Acha wazi kuonyesha \"Malipo\" tu.")}>
        <input id="rl-p" value={pay} maxLength={40} disabled={!manager} placeholder="M-Pesa" onChange={(e) => setPay(e.target.value)} />
      </Field>
      {/* A small receipt so the owner sees the look before saving. */}
      <div className="rl-preview" aria-label={T("Preview", "Mfano")}>
        <div className="rl-prev-head">
          <span className="rl-mark sm" style={{ background: logo ? "#fff" : p.green }}>{logo ? <img src={logo} alt="" /> : ws.name.trim().charAt(0).toUpperCase()}</span>
          <span className="rl-prev-name"><b style={{ color: p.greenText }}>{ws.name}</b><small>{town.trim() || T("Your phone number", "Namba yako ya simu")}</small></span>
        </div>
        <div className="rl-prev-line"><span>{T("Receipt no.", "Kumbukumbu Na.")}</span><b>001</b></div>
        <div className="rl-prev-line"><span>{pay.trim() ? `Muamala ${pay.trim()}` : "Muamala"}</span><b>QK41ABC9XY</b></div>
        <div className="rl-prev-total" style={{ background: p.green }}><span>{T("Total", "Jumla")}</span><b>TZS 75,000 <i style={{ background: p.honey }} /></b></div>
      </div>
      {manager && <SaveRow busy={busy} msg={msg} T={T} />}
    </form>
  );
}

function SaveRow({ busy, msg, T, label, noButton }: { busy: boolean; msg: { ok?: string; err?: string }; T: Tr; label?: string; noButton?: boolean }) {
  return (
    <div className="row between saverow">
      <span className={"savemsg " + (msg.err ? "err" : "ok")}>{msg.err ?? msg.ok ?? ""}</span>
      {!noButton && <button className="primary" disabled={busy}>{busy ? T("Saving…", "Inahifadhi…") : label ?? T("Save changes", "Hifadhi mabadiliko")}</button>}
    </div>
  );
}

const FONTS: { id: string; name: string; family: string; note: [string, string] }[] = [
  { id: "geist", name: "Geist", family: '"Geist", system-ui, sans-serif', note: ["Default · same as ponditech.com", "Ya kawaida · kama ponditech.com"] },
  { id: "urbanist", name: "Urbanist", family: '"Urbanist", system-ui, sans-serif', note: ["Rounded, friendly", "Ya mviringo"] },
  { id: "inter", name: "Inter", family: '"Inter", system-ui, sans-serif', note: ["Clean · easy to read numbers", "Safi · namba zinasomeka vizuri"] },
];

function FontPicker({ T }: { T: Tr }) {
  const read = () => { try { return localStorage.getItem("itaos-font") || "geist"; } catch { return "geist"; } };
  const [font, setFont] = useState(read);
  const pick = (id: string) => {
    setFont(id);
    if (id === "geist") delete document.documentElement.dataset.font; else document.documentElement.dataset.font = id;
    try { localStorage.setItem("itaos-font", id); } catch { /* storage unavailable */ }
  };
  return (
    <section className="card">
      <div><h2>{T("Font", "Herufi")}</h2><span className="small muted">{T("Saved on this device only.", "Inahifadhiwa kwenye kifaa hiki tu.")}</span></div>
      <div className="fontpick" role="group" aria-label="Font">
        {FONTS.map((f) => (
          <button key={f.id} type="button" className={font === f.id ? "on" : ""} aria-pressed={font === f.id} onClick={() => pick(f.id)} style={{ fontFamily: f.family }}>
            <span className="fp-sample">USD 462.71</span>
            <span>{f.name}</span>
            <span className="fp-name">{T(f.note[0], f.note[1])}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** How the big money cards at the top of Home look. Each choice shows a small live preview. */
function HeroPicker({ T }: { T: Tr }) {
  const cur = useHeroStyle();
  const NAMES: Record<HeroStyle, [string, string, string, string]> = {
    B: ["Two big cards", "Kadi mbili kubwa", "Ad spend, then revenue with where it came from", "Matangazo, kisha mapato na yalikotoka"],
    A: ["One money card", "Kadi moja ya pesa", "Revenue big, with spend, profit and return under it", "Mapato makubwa, na matangazo, faida na faida ya tangazo chini"],
    C: ["Side by side", "Kando kwa kando", "Revenue and spend in one row, the split under them", "Mapato na matangazo mstari mmoja, mgawanyo chini"],
    E: ["Money in, money out", "Pesa ndani, pesa nje", "Revenue joined to ad spend, the return on the join", "Mapato yameungana na matangazo, faida katikati"],
  };
  return (
    <section className="card">
      <div><h2>{T("Home money cards", "Kadi za pesa za Nyumbani")}</h2><span className="small muted">{T("How revenue and ad spend show at the top of Home. Saved on this device only.", "Jinsi mapato na matangazo yanavyoonekana juu ya Nyumbani. Inahifadhiwa kwenye kifaa hiki tu.")}</span></div>
      <div className="heropick" role="group" aria-label={T("Home money cards", "Kadi za pesa")}>
        {HERO_STYLES.map((h) => (
          <button key={h} type="button" className={cur === h ? "on" : ""} aria-pressed={cur === h} onClick={() => saveHeroStyle(h)}>
            <div className="hp-prev" aria-hidden><MoneyHero style={h} data={SAMPLE} T={T} /></div>
            <span className="hp-name">{T(NAMES[h][0], NAMES[h][1])}{cur === h && <span className="small muted">· {T("in use", "inatumika")}</span>}</span>
            <span className="hp-note">{T(NAMES[h][2], NAMES[h][3])}</span>
          </button>
        ))}
      </div>
      <ProfitPicker T={T} />
    </section>
  );
}

/** How profit shows inside the revenue card. Tapping profit on Home also moves to the next one. */
function ProfitPicker({ T }: { T: Tr }) {
  const cur = useProfitLook();
  const hero = useHeroStyle();
  const NAMES: Record<ProfitLook, [string, string]> = {
    bar: ["Where each shilling went", "Kila shilingi ilienda wapi"], headline: ["Profit as the headline", "Faida kama kichwa"],
    ring: ["Ring", "Pete"], receipt: ["Receipt", "Risiti"], pill: ["Pill under revenue", "Kidonge chini ya mapato"],
  };
  return (
    <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
      <div><h3 style={{ margin: 0 }}>{T("How profit shows", "Jinsi faida inavyoonekana")}</h3>
        <span className="small muted">{hero === "A" ? T("The one-card look shows profit in its own row; pick another look above to use these.", "Kadi moja inaonyesha faida mstari wake; chagua mwonekano mwingine juu kutumia hizi.")
          : T("Or tap the profit on Home to switch. Saved on this device.", "Au gusa faida kwenye Nyumbani kubadilisha. Inahifadhiwa kwenye kifaa hiki.")}</span></div>
      <div className="heropick" role="group" aria-label={T("How profit shows", "Jinsi faida inavyoonekana")}>
        {PROFIT_LOOKS.map((l) => (
          <button key={l} type="button" className={cur === l ? "on" : ""} aria-pressed={cur === l} onClick={() => saveProfitLook(l)}>
            <div className="hp-prev" aria-hidden><MoneyHero style={hero === "A" ? "B" : hero} data={SAMPLE} T={T} look={l} /></div>
            <span className="hp-name">{T(NAMES[l][0], NAMES[l][1])}{cur === l && <span className="small muted">· {T("in use", "inatumika")}</span>}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
