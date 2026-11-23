// Chats: one card per customer, written so anyone can read it at a glance.
// Each card answers three questions: who is this, where do things stand, and what should I do now.
// The technical detail (which rule or Kito reading decided the label) is still there, tucked away.
import { useRemembered } from "./remember";
import { enterRows, usePageEnter, select } from "./motion";
import { takeChatReturn } from "./chatReturn";
import { pushEntry, replaceEntry, cameFrom } from "./backStack";
import { useEffect, useRef, useState } from "react";
import { supabase, callFn, Workspace, Outcome, Task, fmt, when, canEdit, canManage, money, localDay } from "./lib";
import DateRange from "./DateRange";
import { RangeSel, resolveRange, addDays, saveRange, presetLabel } from "./ranges";
import { signalDismissed, fromLocalInput } from "./Orders";
import { KitoLogo } from "./Logo";
import { KitoLoader } from "./KitoLoader";
import { Source, Run, Lite, Tr, timeGroup, waLink, agoT, statusOf, kitoStale, interest, phoneOf, nameOf, fromOf, lostWhy } from "./chatParts";
import { ChatPane, PartyHint, prefetchMsgs } from "./ChatPane";
export { timeGroup, waLink } from "./chatParts";

import { PAGE, views, getSnap, setSnap, viewKeyOf, chatsRange, type Filter } from "./chatsCache";
export { preloadChats, clearChatsCache } from "./chatsCache";
/** Same rules as the database filters below, used to count each tab. */
const inFilter = (r: Lite, f: Filter) =>
  f === "all" ? true
  : f === "follow" ? r.outcome !== "sold" && (r.kito_temp === "hot" || r.kito_temp === "warm" || (r.kito_temp == null && r.warm))
  : f === "signals" ? Number(r.paid_orders) === 0 && !signalDismissed(r) && ((r.kito_outcome === "sold" && r.kito_confidence !== "low") || r.outcome_override === "sold")
  : f === "sold" ? Number(r.paid_orders) > 0
  : r.outcome === f;
const inSource = (r: Lite, s: Source) => s === "any" || (s === "import" ? (r as any).phone_number_id === "import" : r.phone_number_id !== "import");


// The open chat lives in the address (#chats/open=<id>) so a reload brings you back inside it.
const hashOpen = () => {
  const m = location.hash.match(/#chats\/open=([0-9a-f-]+)/i);
  return m ? m[1] : null;
};

const hashIds = () => {
  const m = location.hash.match(/#chats\/ids=([0-9a-f,-]+)/i);
  return m ? m[1].split(",").filter(Boolean).slice(0, 100) : null;
};

// Kito's automatic catch-up runs once per business while the app is open, not every time Chats opens.
const autoRan = new Set<string>();

export default function Chats({ ws }: { ws: Workspace }) {
  const [ids, setIds] = useState<string[] | null>(hashIds());
  const cached = !ids ? getSnap(ws.id) : null;
  const [filter, setFilter] = useState<Filter>(ids ? "ids" : cached?.filter ?? "all");
  const [src, setSrc] = useRemembered<Source>("chats-src", cached?.src ?? "any", (v) => v === "any" || v === "live" || v === "import");
  const [rows, setRows] = useState<Outcome[]>(cached?.rows ?? []);
  const [lite, setLite] = useState<Lite[]>(cached?.lite ?? []);
  const [counts, setCounts] = useState<Record<string, number> | null>(cached?.counts ?? null);
  // Bought + a date picked: chat id -> when that customer actually paid (the order's paid date, read from the chat),
  // and how many bought on those days. Null when no date is picked.
  const [paidOn, setPaidOn] = useState<Record<string, string> | null>(cached?.paidOn ?? null);
  const [boughtInRange, setBoughtInRange] = useState<number | null>(cached?.boughtInRange ?? null);
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(hashOpen());
  // Opened from another page's "Open chat" link: the back arrow on that chat returns to that page.
  const backTo = useRef<string | null>(ids ? takeChatReturn() : null);
  const autoOpened = useRef<string | null>(null);
  // Search by name or phone, and an optional date range (own to this page; empty = all dates).
  const [qText, setQText] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { const t = window.setTimeout(() => { setSearch(qText.trim()); setLimit(PAGE); }, 350); return () => window.clearTimeout(t); }, [qText]);
  const [range, setRangeState] = useState<RangeSel | null>(chatsRange);
  const setRange = (r: RangeSel | null) => { setRangeState(r); setLimit(PAGE); try { if (r) { saveRange("chats", r); localStorage.removeItem("itaos:chats:alldates"); } else localStorage.setItem("itaos:chats:alldates", "1"); } catch { /* storage blocked */ } };
  const tzChats = ws.timezone || "Africa/Dar_es_Salaam";
  const todayChats = localDay(new Date(), tzChats);
  const period = range ? resolveRange(range, todayChats) : null;
  // First day with a chat, so "All time" in the date picker shows the real span (no range = every chat).
  const [chatStart, setChatStart] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("conversation_outcomes").select("last_message_at").eq("workspace_id", ws.id).not("last_message_at", "is", null)
      .order("last_message_at", { ascending: true }).limit(1)
      .then(({ data }) => { const t = (data as any)?.[0]?.last_message_at; setChatStart(t ? localDay(new Date(t), tzChats) : null); });
  }, [ws.id, tzChats]);
  const [openConfirm, setOpenConfirm] = useState(false);
  const [adNames, setAdNames] = useState<Record<string, string>>(cached?.adNames ?? {});
  const [phones, setPhones] = useState<Record<string, string>>(cached?.phones ?? {});
  const [tasks, setTasks] = useState<Record<string, Task>>(cached?.tasks ?? {});
  const [runs, setRuns] = useState<Run[]>(cached?.runs ?? []);
  // Which list is on screen (tab, source, search, dates, page size). The grey placeholders only show when
  // this changes; a refresh of the same list (live update, Kito finished, coming back to the tab) updates in place.
  const shownKey = useRef<string | null>(cached?.key ?? null);
  const [loading, setLoading] = useState(!cached);
  const [tick, setTick] = useState(0);
  const [rechecking, setRechecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const lang = ws.language;
  const T: Tr = (en, sw) => (lang === "sw" ? sw : en);
  const refresh = () => setTick((t) => t + 1);
  const [quiet, setQuiet] = useState(false);   // live refresh: update in place, no "Loading…"
  const [refreshing, setRefreshing] = useState(false);
  const [held, setHeld] = useState<Outcome[] | null>(null);   // newer list waiting while you read further down   // a list is on screen and a fresh one is loading: thin line under the top bar
  const [live, setLive] = useState(false);

  // Live: new WhatsApp messages, Kito's labels and recorded sales appear without reloading.
  useEffect(() => {
    let timer: number | undefined, kitoTimer: number | undefined;
    // At most one reload every 5 s: a newly connected number backfills thousands of rows at once.
    let last = 0;
    let missed = false;
    const bump = () => {
      // Background tabs don't reload on every change; they catch up once when shown again.
      if (document.visibilityState !== "visible") { missed = true; return; }
      if (timer) return;
      const wait = Math.max(800, 5000 - (Date.now() - last));
      timer = window.setTimeout(() => { timer = undefined; last = Date.now(); setQuiet(true); refresh(); window.dispatchEvent(new Event("itaos:live")); }, wait);
    };
    const ch = supabase.channel(`chats-${ws.id}-${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${ws.id}` }, (p: any) => {
        // A chat changes whenever a message lands (its summary is recomputed), so this covers new messages too.
        // The messages table itself is not streamed: backfills write thousands of rows at once.
        bump();
        // Let Kito read the new message shortly after it lands — only when the chat has news Kito hasn't read
        // (Kito's own label updates also change the chat; those must not wake it again).
        const c = p?.new;
        if (!c?.last_message_at || (c.kito_checked_at && Date.parse(c.last_message_at) <= Date.parse(c.kito_checked_at))) return;
        window.clearTimeout(kitoTimer); kitoTimer = window.setTimeout(() => { callFn("kito", { workspace_id: ws.id }).then(() => { setQuiet(true); refresh(); }).catch(() => {}); }, 20000);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `workspace_id=eq.${ws.id}` }, bump)
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    const onVis = () => { if (document.visibilityState === "visible" && missed) { missed = false; bump(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearTimeout(timer); window.clearTimeout(kitoTimer); document.removeEventListener("visibilitychange", onVis); supabase.removeChannel(ch); };
  }, [ws.id]);

  useEffect(() => {
    const onHash = () => {
      const i = hashIds(); setIds(i); if (i) setFilter("ids");
      // Back gesture / button out of an open chat lands on "#chats": close the chat and show the list.
      if (!i && location.hash.startsWith("#chats")) setOpenId(hashOpen());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const viewKey = viewKeyOf(ws.id, filter, ids, src, limit, search, period?.from, period?.to);

  useEffect(() => {
    if (!quiet && shownKey.current !== viewKey) {
      const mem = views.get(viewKey);
      if (mem) { setRows(mem.rows); setPhones(mem.phones); setPaidOn(mem.paidOn); setBoughtInRange(mem.boughtInRange); setLoading(false); shownKey.current = viewKey; }
      else setLoading(true);
    }
    const liveUpdate = quiet && shownKey.current === viewKey;   // a live refresh of the list already on screen
    const blank = !quiet && shownKey.current !== viewKey && !views.get(viewKey);
    setRefreshing(!blank && !quiet);   // live updates stay silent
    setQuiet(false); setErr("");
    let cur = true;
    const byPaid = filter === "sold";
    // Every filter of this list, applied to a query of any size (the quick first 20 and the full page).
    const narrow = <Q extends { eq: any; neq: any; in: any; gte: any; lt: any; gt: any; or: any }>(qq: Q): Q => {
      let x: any = qq;
      if (filter !== "ids" && src === "import") x = x.eq("phone_number_id", "import");
      else if (filter !== "ids" && src === "live") x = x.neq("phone_number_id", "import");
      if (filter === "ids" && ids) x = x.in("id", ids);
      if (filter !== "ids" && period && !byPaid) x = x.gte("last_message_at", fromLocalInput(period.from + "T00:00")).lt("last_message_at", fromLocalInput(addDays(period.to, 1) + "T00:00"));
      if (filter === "not") x = x.eq("not_customer", true);
      else if (filter !== "ids") x = x.eq("not_customer", false);
      if (filter === "ids" || filter === "not" || filter === "all") { /* nothing more */ }
      else if (filter === "sold") x = x.gt("paid_orders", 0);   // Bought = a sale you recorded, nothing else
      else if (filter === "follow") x = x.neq("outcome", "sold").or("kito_temp.in.(hot,warm),and(kito_temp.is.null,warm.eq.true)");
      else if (filter === "signals") x = x.eq("paid_orders", 0).or("and(kito_outcome.eq.sold,or(kito_confidence.is.null,kito_confidence.neq.low)),outcome_override.eq.sold").or("override_by.is.null,outcome_override.eq.sold");
      else x = x.eq("outcome", filter);
      return x as Q;
    };
    const base = (n: number) => supabase.from("conversation_outcomes").select("*").eq("workspace_id", ws.id)
      .order(byPaid ? "last_paid_at" : "last_message_at", { ascending: false, nullsFirst: false }).limit(n);
    let q = narrow(base(limit));
    // Nothing to show yet: fetch the first 20 on their own and show them straight away; the full page follows.
    // (Not for searches, paid-date lists or the follow-up list, whose order is worked out after loading.)
    if (blank && !search && !(byPaid && period) && filter !== "follow") {
      narrow(base(20)).then(({ data, error }) => {
        if (!cur || error || !data?.length) return;
        setRows((r) => (shownKey.current === viewKey && r.length > 20 ? r : (data as Outcome[])));
        setLoading((l) => { if (l) shownKey.current = viewKey; return false; });
        setRefreshing(true);
      });
    }
    // Date range: chats with a message on those days (local days, East Africa time).
    // Bought is different: it lists the customers who PAID on those days (the payment day read from the chat),
    // not the day you confirmed the money or the day they last wrote.
    const fromTs = period ? fromLocalInput(period.from + "T00:00") : "";
    const toTs = period ? fromLocalInput(addDays(period.to, 1) + "T00:00") : "";
    const paidIds = period ? (async () => {
      const map: Record<string, string> = {};
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("orders").select("conversation_id,paid_at").eq("workspace_id", ws.id).eq("status", "paid")
          .not("conversation_id", "is", null).gte("paid_at", fromTs).lt("paid_at", toTs).order("paid_at", { ascending: false }).range(from, from + 999);
        if (error) break;
        for (const o of (data ?? []) as { conversation_id: string; paid_at: string }[]) if (!map[o.conversation_id]) map[o.conversation_id] = o.paid_at;
        if (!data || data.length < 1000) break;
      }
      return map;
    })() : Promise.resolve(null);
    paidIds.then(async (map) => {
      setPaidOn(map);
      if (!map) { setBoughtInRange(null); return; }
      const idsIn = Object.keys(map);
      if (!idsIn.length) { setBoughtInRange(0); return; }
      let n = 0;
      for (let i = 0; i < idsIn.length; i += 200) {
        let cq = supabase.from("conversation_outcomes").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)
          .in("id", idsIn.slice(i, i + 200)).gt("paid_orders", 0).eq("not_customer", false);
        if (src === "import") cq = cq.eq("phone_number_id", "import"); else if (src === "live") cq = cq.neq("phone_number_id", "import");
        const { count } = await cq; n += count ?? 0;
      }
      setBoughtInRange(n);
    });
    supabase.from("kito_runs").select("id,trigger,ran_at,checked,failed,remaining,note").eq("workspace_id", ws.id).order("ran_at", { ascending: false }).limit(20)
      .then(({ data }) => setRuns((data as Run[]) ?? []));
    // Tab counts are worked out in the database (the browser can only read 1,000 rows at a time).
    supabase.rpc("chat_counts", { p_ws: ws.id, p_src: src }).then(({ data, error }) => {
      if (!error && data) { setCounts(data as Record<string, number>); return; }
      setCounts(null);
      supabase.from("conversation_outcomes").select("id,outcome,kito_temp,warm,paid_orders,payment_signal,kito_outcome,kito_confidence,outcome_override,override_by,phone_number_id").eq("workspace_id", ws.id).limit(1000)
        .then(({ data }) => setLite((data as Lite[]) ?? []));
    });
    const searched = async () => {
      if (byPaid && period) {
        const ids = Object.keys((await paidIds) ?? {});
        q = q.in("id", ids.length ? ids.slice(0, 2000) : ["00000000-0000-0000-0000-000000000000"]);
      }
      if (filter === "ids" || !search) return q;
      const digits = search.replace(/\D/g, "");
      const like = `%${search.replace(/[%_,()]/g, "")}%`;
      if (digits.length >= 3) {
        const { data: cs } = await supabase.from("contacts").select("id").eq("workspace_id", ws.id).ilike("wa_id", `%${digits}%`).limit(200);
        const cids = (cs ?? []).map((x: any) => x.id);
        return cids.length ? q.or(`contact_name.ilike.${like},contact_id.in.(${cids.join(",")})`) : q.ilike("contact_name", like);
      }
      return q.ilike("contact_name", like);
    };
    Promise.all([
      searched(),
      supabase.from("ads").select("ad_id,name").eq("workspace_id", ws.id),
      supabase.from("follow_up_tasks").select("*").eq("workspace_id", ws.id).in("status", ["open", "snoozed"]),
    ]).then(async ([c, a, t]) => {
      if (!cur) return;   // a newer load (other tab, new search) has started: don't let this older one overwrite it
      if (c.error) { setErr(c.error.message); setRefreshing(false); }
      let list = (c.data as Outcome[]) ?? [];
      if (byPaid && period) {
        const m = (await paidIds) ?? {};
        list = [...list].sort((x, y) => Date.parse(m[y.id] ?? "") - Date.parse(m[x.id] ?? ""));
      }
      if (filter === "follow") {
        const rank = (r: Outcome) => (interest(r) === "hot" ? 0 : 1) * 10 + (r.last_dir === "in" && !r.last_in_closing ? 0 : 1);
        list = [...list].sort((x, y) => rank(x) - rank(y) || Date.parse(y.last_message_at ?? "") - Date.parse(x.last_message_at ?? ""));
      }
      const contactIds = [...new Set(list.map((r) => r.contact_id))];
      const { data: cts } = contactIds.length ? await supabase.from("contacts").select("id,wa_id").eq("workspace_id", ws.id).in("id", contactIds) : { data: [] };
      if (!cur) return;
      setPhones(Object.fromEntries((cts ?? []).map((x: any) => [x.id, x.wa_id])));
      // Don't push the list around while someone is reading it (Glide: "load new things below, and offer them
      // instead of pushing"). Scrolled down + a live update: existing cards update in place and keep their order;
      // chats that are new to the list wait behind a "N new" pill at the top.
      const listEl = document.querySelector<HTMLElement>(".chats .cc-list");
      const reading = liveUpdate && (window.scrollY > 160 || (listEl?.scrollTop ?? 0) > 160);
      if (reading) {
        setRows((prev) => {
          const fresh = new Map(list.map((x) => [x.id, x]));
          const have = new Set(prev.map((x) => x.id));
          const extra = list.filter((x) => !have.has(x.id));
          setHeld(extra.length ? list : null);
          return prev.filter((x) => fresh.has(x.id)).map((x) => fresh.get(x.id)!);
        });
      } else { setHeld(null); setRows(list); }
      if (filter === "ids" && list.length && list.length <= 3) setOpenId((cur) => { if (!cur) autoOpened.current = list[0].id; return cur ?? list[0].id; });
      setAdNames(Object.fromEntries((a.data ?? []).map((x: any) => [x.ad_id, x.name])));
      setTasks(Object.fromEntries(((t.data ?? []) as Task[]).map((task) => [task.conversation_id, task])));
      setLoading(false); setRefreshing(false); shownKey.current = viewKey;
      views.set(viewKey, { rows: list, phones: Object.fromEntries((cts ?? []).map((x: any) => [x.id, x.wa_id])), paidOn: byPaid && period ? ((await paidIds) ?? null) : null, boughtInRange: null });
      if (views.size > 24) views.delete(views.keys().next().value as string);
    });
    return () => { cur = false; };
  }, [ws.id, filter, ids, tick, src, limit, search, period?.from, period?.to]);

  // Remember what's on screen for the next visit to this tab.
  useEffect(() => {
    if (loading || filter === "ids") return;
    // Plain first pages are also saved on the phone, so the next open (even after the app was closed) shows them at once.
    setSnap({ ws: ws.id, key: viewKey, filter, src, rows, lite, counts, phones, adNames, tasks, runs, paidOn, boughtInRange }, !search && limit === PAGE && !refreshing);
  }, [loading, refreshing, viewKey, rows, lite, counts, phones, adNames, tasks, runs, paidOn, boughtInRange]);

  /** background = the automatic catch-up when Chats opens: nothing on screen changes until new labels arrive. */
  async function runKito(background = false) {
    if (background) {
      try {
        let total = 0;
        for (let i = 0; i < 10; i++) {
          // background: Kito skips chats still mid-conversation (they're read once they go quiet).
          const r = await callFn<{ checked: number; remaining: number }>("kito", { workspace_id: ws.id, background: true });
          total += r.checked;
          if (!r.remaining || !r.checked) break;
        }
        if (total) { setQuiet(true); refresh(); }
      } catch { /* the 15-minute background run will pick it up */ }
      return;
    }
    setRechecking(true); setNote(T("Kito is reading the chats…", "Kito anasoma chat…"));
    try {
      let total = 0;
      for (let i = 0; i < 10; i++) {
        const r = await callFn<{ checked: number; failed: number; remaining: number; last_error?: string }>("kito", { workspace_id: ws.id });
        total += r.checked;
        if (r.failed && r.last_error) { setNote(T(`Kito read ${total} chats, then stopped: ${r.last_error}`, `Kito amesoma chat ${total}, kisha akasimama: ${r.last_error}`)); refresh(); setRechecking(false); return; }
        if (!r.remaining || !r.checked) break;
        setNote(T(`Kito has read ${total} chats, ${r.remaining} to go…`, `Kito amesoma chat ${total}, zimebaki ${r.remaining}…`));
      }
      setNote(total ? T(`Kito read ${total} chats.`, `Kito amesoma chat ${total}.`) : T("Kito is up to date. No new messages.", "Kito yuko sawa. Hakuna ujumbe mpya.")); refresh();
    } catch (e) { setNote((e as Error).message); }
    setRechecking(false);
  }
  useEffect(() => {
    if (autoRan.has(ws.id)) return;
    autoRan.add(ws.id);
    (async () => {
      const { data } = await supabase.from("conversations").select("id,label,last_message_at,kito_checked_at").eq("workspace_id", ws.id).limit(1000);
      const all = data ?? [];
      try {
        if (all.some((c) => c.label == null && c.last_message_at)) { await callFn("chat-import", { workspace_id: ws.id, action: "reanalyze" }); setQuiet(true); refresh(); }
        if (all.some((c) => c.last_message_at && (!c.kito_checked_at || Date.parse(c.last_message_at) > Date.parse(c.kito_checked_at)))) await runKito(true);
      } catch { /* the 15-minute background run will pick it up */ }
    })();
  }, [ws.id]);
  async function recheck() {
    setRechecking(true); setNote("");
    try { const r = await callFn<{ reanalyzed: number }>("chat-import", { workspace_id: ws.id, action: "reanalyze" }); setNote(T(`Checked ${r.reanalyzed} chats again.`, `Chat ${r.reanalyzed} zimekaguliwa upya.`)); refresh(); }
    catch (e) { setNote((e as Error).message); }
    setRechecking(false);
  }
  async function deleteImported() {
    const { data: imp } = await supabase.from("conversations").select("id").eq("workspace_id", ws.id).eq("phone_number_id", "import").limit(1000);
    const list = (imp ?? []).map((r) => r.id as string);
    if (!list.length) return;
    if (!confirm(T(`Delete all ${list.length} imported chats and their messages? Recorded sales are kept. This cannot be undone.`,
      `Futa chat ${list.length} zote zilizoingizwa pamoja na ujumbe wake? Mauzo yaliyorekodiwa yatabaki. Haiwezi kurudishwa.`))) return;
    setDeleting(true); setErr("");
    const { data, error } = await supabase.rpc("delete_chats", { p_ws: ws.id, p_ids: list.slice(0, 1000), p_via: "chats_page", p_request: "Chats page: delete imported" });
    setDeleting(false);
    if (error) setErr(error.message);
    else { setNote(T(`Deleted ${(data as any).deleted} imported chats.`, `Chat ${(data as any).deleted} zilizoingizwa zimefutwa.`)); setSrc("any"); refresh(); }
  }

  // Solid top bar while on Chats (phone): a blurred bar over a scrolling list redraws on every frame.
  useEffect(() => { const h = document.documentElement; h.classList.add("on-chats"); return () => h.classList.remove("on-chats"); }, []);
  const animated = useRef(!!cached);   // a list shown from memory doesn't replay the row entrance
  const pageRef = usePageEnter<HTMLElement>((root) => {
    if (loading) return;
    if (animated.current) { animated.current = false; return; }
    enterRows(select(root, ".cc").slice(0, 8), { delay: 0.05, stagger: 0.03 }); // only what's on screen; the rest just appear
  }, [loading, filter]);

  const pick = (f: Filter) => { setIds(null); setFilter(f); setLimit(PAGE); if (location.hash !== "#chats") replaceEntry("#chats"); };
  const pool = lite.filter((r) => inSource(r, src));
  const count = (f: Filter) => f === "sold" && period && boughtInRange != null ? boughtInRange : counts ? Number(counts[f] ?? 0) : pool.filter((r) => inFilter(r, f)).length;
  const imported = counts ? Number(counts.imported ?? 0) : lite.filter((r) => (r as any).phone_number_id === "import").length;
  const total = counts ? Number(counts.all ?? 0) : lite.length;
  const shownTotal = filter === "ids" ? rows.length : count(filter);
  const tz = ws.timezone || "Africa/Dar_es_Salaam";
  // Keep the open chat open even when it leaves the current tab (e.g. you confirm a payment from "Check payment").
  const [openSnap, setOpenSnap] = useState<Outcome | null>(null);
  const found = openId ? rows.find((x) => x.id === openId) ?? null : null;
  useEffect(() => { if (found) setOpenSnap(found); }, [found]);
  const openRow = found ?? (openSnap && openSnap.id === openId ? openSnap : null);
  // Phone: a closed chat slides away (like WhatsApp) instead of vanishing.
  const lastOpen = useRef<Outcome | null>(null);
  const leavingRef = useRef<{ row: Outcome; until: number } | null>(null);
  const [, redraw] = useState(0);
  if (openRow) { lastOpen.current = openRow; leavingRef.current = null; }
  else if (lastOpen.current) {
    if (window.matchMedia("(max-width: 899px)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      leavingRef.current = { row: lastOpen.current, until: Date.now() + 220 };
    lastOpen.current = null;
  }
  const leavingRow = !openRow && leavingRef.current && leavingRef.current.until > Date.now() ? leavingRef.current.row : null;
  useEffect(() => {
    if (!leavingRow) return;
    const t = window.setTimeout(() => { leavingRef.current = null; redraw((n) => n + 1); }, 220);
    return () => window.clearTimeout(t);
  }, [leavingRow?.id]);
  const paneRow = openRow ?? leavingRow;
  // The open chat left the list (e.g. you just marked it "not a customer"): reload it so the panel shows the change.
  useEffect(() => {
    if (!openId || found) return;
    let off = false;
    supabase.from("conversation_outcomes").select("*").eq("workspace_id", ws.id).eq("id", openId).maybeSingle()
      .then(({ data }) => { if (!off && data) setOpenSnap(data as Outcome); });
    return () => { off = true; };
  }, [openId, found, rows, ws.id]);
  // Keep the address in step with the open chat (23 Nov 2026). Opening a chat from the list now ADDS one
  // history step, so the phone's Back gesture closes the chat and shows the list again, instead of jumping
  // past Chats to the page before it. Switching chats replaces that step (no pile-up); closing with the
  // arrow steps back over it. The existing history state (e.g. itaFromHome) is always kept.
  useEffect(() => {
    if (!location.hash.startsWith("#chats") || hashIds()) return;
    const want = openId ? "#chats/open=" + openId : "#chats";
    if (location.hash === want) return;
    const st = (history.state ?? {}) as { itaChat?: boolean };
    if (openId && !hashOpen()) pushEntry(want, { itaChat: true });
    else if (!openId && st.itaChat) history.back(); // fires hashchange → list shows
    else replaceEntry(want);
  }, [openId]);
  // After a reload the open chat may not be in the first page of the list: fetch it on its own.
  useEffect(() => {
    if (!openId || loading || found || (openSnap && openSnap.id === openId)) return;
    let gone = false;
    supabase.from("conversation_outcomes").select("*").eq("workspace_id", ws.id).eq("id", openId).maybeSingle().then(async ({ data }) => {
      if (gone) return;
      if (!data) { setOpenId(null); return; }
      const row = data as Outcome;
      const { data: ct } = await supabase.from("contacts").select("id,wa_id").eq("workspace_id", ws.id).eq("id", row.contact_id).maybeSingle();
      if (gone) return;
      if (ct) setPhones((p) => ({ ...p, [(ct as any).id]: (ct as any).wa_id }));
      setOpenSnap(row);
    });
    return () => { gone = true; };
  }, [openId, loading, found, ws.id]);
  // After a change in the open chat, refresh in place: no loading skeleton, the list keeps its scroll position.
  const refreshQuiet = () => { setQuiet(true); refresh(); };
  // Pull-to-refresh: reload the list quietly, keeping the open chat and filters (pullRefresh.ts tags new rows).
  const pullRef = useRef(refreshQuiet); pullRef.current = refreshQuiet;
  useEffect(() => { const f = () => pullRef.current(); window.addEventListener("itaos-refresh", f); return () => window.removeEventListener("itaos-refresh", f); }, []);
  const tabs: [Filter, string, string][] = [
    ["all", T("All", "Wote"), T("Every customer", "Wateja wote")],
    ["follow", T("Follow up", "Wafuatilie"), T("Interested — talk to them again", "Wana hamu — waongeleshe tena")],
    ["signals", T("Check payment", "Hakiki malipo"), T("Said they paid — confirm the money came in", "Wamesema wamelipa — hakikisha pesa imeingia")],
    ["open", T("Still talking", "Bado mnaongea"), T("No decision yet", "Bado hawajaamua")],
    ["sold", T("Bought", "Wamenunua"), T("Paid and recorded", "Wamelipa na imerekodiwa")],
    ["lost", T("Didn't buy", "Hawakununua"), T("Went quiet or said no", "Wamekaa kimya au wamekataa")],
    ["not", T("Not customers", "Si wateja"), T("Delivery, suppliers, staff, family: kept out of your numbers", "Usafirishaji, wasambazaji, wafanyakazi, familia: hawahesabiwi")],
  ];
  // Chats in this list where the customer wrote last: the empty panel offers to open the newest one.
  const waitingRows = rows.filter((r) => statusOf(r, T, ws.currency).key === "waiting");
  // No chat opens by itself (22 Nov 2026): switching to Chats shows the list and an empty right panel
  // (with its "open the newest waiting chat" button); a chat opens only when you pick one.
  const emptyText = filter === "follow" ? T("Nobody to follow up right now.", "Hakuna wa kufuatilia kwa sasa.")
    : filter === "signals" ? T("No payments to check.", "Hakuna malipo ya kuhakiki.")
    : T("No chats here yet.", "Hakuna chat hapa bado.");

  return (
    <section className="card chats" ref={pageRef}>
      {refreshing && <div className="chats-progress" role="progressbar" aria-label={T("Updating the chats", "Inasasisha chats")} />}
      <div className="chats-head">
        <div>
          <h2 style={{ margin: 0 }}>{T("Customers", "Wateja")} <span className="muted chats-total">{fmt(total)}</span>{live && <span className="live-dot" title={T("Live: updates by itself when a message arrives", "Hai: inajisasisha ujumbe ukiingia")}>{T("Live", "Hai")}</span>}</h2>
          <span className="small muted chats-sub">{T("Everyone who messaged you on WhatsApp, and where each one stands.", "Kila aliyekutumia ujumbe WhatsApp, na amefika wapi.")}</span>
        </div>
        <button className="small primary" onClick={() => runKito()} disabled={rechecking} title={T("Kito reads new messages and updates every card. It also does this by itself every 15 minutes.", "Kito anasoma ujumbe mpya na kusasisha kila kadi. Pia hufanya hivi mwenyewe kila dakika 15.")}>
          {rechecking ? <KitoLoader size="sm" /> : <KitoLogo size={18} />}{rechecking ? T("Kito is reading…", "Kito anasoma…") : T("Update with Kito", "Sasisha na Kito")}
        </button>
      </div>

      <div className="chats-tools">
      <div className="chats-bar">
        <div className="chips-tabs" role="tablist" aria-label={T("Show", "Onyesha")}>
          {tabs.filter(([f]) => f !== "not" || count("not") > 0 || filter === "not").map(([f, label, hint]) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => pick(f)} title={hint}>
              {label}<span className="cnt">{count(f)}</span>
            </button>
          ))}
        </div>
        <select className="chats-src" value={src} aria-label={T("Where from", "Wametoka wapi")} onChange={(e) => { setSrc(e.target.value as Source); setLimit(PAGE); if (filter === "ids") pick("all"); }}>
          <option value="any">{T("From: everywhere", "Kutoka: kote")}</option>
          <option value="live">{T("From: WhatsApp", "Kutoka: WhatsApp")}</option>
          <option value="import">{T(`From: uploaded files (${imported})`, `Kutoka: faili zilizopakiwa (${imported})`)}</option>
        </select>
      </div>
      {filter !== "ids" && (
        <div className="chats-find">
          <input type="search" className="chats-search" value={qText} onChange={(e) => setQText(e.target.value)} placeholder={T("Search name or phone…", "Tafuta jina au namba…")} aria-label={T("Search chats", "Tafuta chat")} />
          <DateRange value={range ?? { key: "all" }} onChange={(r) => setRange(r.key === "all" ? null : r)} today={todayChats} tz={tzChats} lang={lang} start={chatStart} />
        </div>
      )}
      </div>
      {filter !== "ids" && (search || period) && !loading && <p className="small" style={{ margin: 0 }}>{T(`${fmt(rows.length)}${rows.length >= limit ? "+" : ""} chats`, `Chat ${fmt(rows.length)}${rows.length >= limit ? "+" : ""}`)}{search ? T(` matching “${search}”`, ` zinazolingana na “${search}”`) : ""}{period && range ? (filter === "sold" ? T(` that paid ${presetLabel(range.key, "en").toLowerCase()}`, ` waliolipa ${presetLabel(range.key, "sw").toLowerCase()}`) : T(` with messages ${presetLabel(range.key, "en").toLowerCase()}`, ` zenye ujumbe ${presetLabel(range.key, "sw").toLowerCase()}`)) : ""} · <button className="linkish small" onClick={() => { setQText(""); setSearch(""); setRange(null); }}>{T("clear", "futa")}</button></p>}
      {filter !== "ids" && <p className="small muted chats-hint" style={{ margin: 0 }}>{tabs.find((t) => t[0] === filter)?.[2]}</p>}
      {filter === "ids" && ids && <p className="small" style={{ margin: 0 }}>{T(`Showing ${ids.length} customers Kito picked`, `Inaonyesha wateja ${ids.length} aliowachagua Kito`)} · <a href="#chats" onClick={() => pick("all")}>{T("show everyone", "onyesha wote")}</a></p>}
      {src === "import" && imported > 0 && canManage(ws) && (
        <div className="row small" style={{ gap: 8 }}>
          <span className="muted">{T("These came from chat files you uploaded, not live WhatsApp.", "Hizi zimetoka kwenye faili ulizopakia, si WhatsApp moja kwa moja.")}</span>
          <button className="small danger" disabled={deleting} onClick={deleteImported}>{deleting ? T("Deleting…", "Inafuta…") : T(`Delete all ${imported}`, `Futa zote ${imported}`)}</button>
        </div>
      )}
      {note && <p className="small muted" style={{ margin: 0 }}>{note}</p>}
      {err && <p className="err small" style={{ margin: 0 }}>{err}</p>}

      {loading ? <div className="cc-list" aria-busy="true">{[0, 1, 2, 3].map((i) => <div className="skeleton cc-skel" key={i} />)}</div>
        : rows.length === 0 ? <div className="empty">{err ? T("Couldn't load the chats. Try again in a moment.", "Imeshindwa kupakia chat. Jaribu tena baada ya muda.")
          : (search || period || filter !== "all" || src !== "any") ? (
            // A dead end should still lead somewhere: say what was searched and offer the ways out.
            <div className="dead-end">
              <b>{search ? T(`No chats match “${search}”`, `Hakuna chat inayolingana na “${search}”`) : emptyText}</b>
              <span className="small muted">{T("Try one of these:", "Jaribu mojawapo:")}</span>
              <div className="dead-acts">
                {period && <button type="button" className="small" onClick={() => setRange(null)}>{T("Search all dates", "Tafuta tarehe zote")}</button>}
                {filter !== "all" && filter !== "ids" && <button type="button" className="small" onClick={() => pick("all")}>{T("Look in All", "Angalia Zote")}</button>}
                {src !== "any" && <button type="button" className="small" onClick={() => setSrc("any")}>{T("From everywhere", "Kutoka kote")}</button>}
                {search && <button type="button" className="small" onClick={() => { setQText(""); setSearch(""); }}>{T("Clear the search", "Futa utafutaji")}</button>}
                {search && /\D/.test(search) && <span className="small muted">{T("or type part of their phone number", "au andika sehemu ya namba yake")}</span>}
              </div>
            </div>
          ) : emptyText}</div> : (
        <div className={"inbox frame" + (openRow ? " has-pane" : " no-pane")}>
        <div className="cc-list">
          {held && (() => {
            const have = new Set(rows.map((x) => x.id));
            const n = held.filter((x) => !have.has(x.id)).length;
            return n > 0 ? <button type="button" className="cc-held" onClick={() => {
              setRows(held); setHeld(null);
              const l = document.querySelector<HTMLElement>(".chats .cc-list"); if (l && l.scrollTop > 0) l.scrollTo({ top: 0, behavior: "smooth" });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}>↑ {n === 1 ? T("1 new chat", "Chat 1 mpya") : T(`${n} new chats`, `Chat ${n} mpya`)}</button> : null;
          })()}
          {rows.map((r, i) => {
            // Newest first, grouped by when they last wrote (the follow-up list is sorted by priority instead).
            // On Bought they are grouped by the day they paid.
            const when = (x: Outcome) => filter === "sold" ? (paidOn?.[x.id] ?? x.last_paid_at ?? x.last_message_at) : x.last_message_at;
            const g = filter === "follow" ? null : timeGroup(when(r), tz, T);
            const head = g && (i === 0 || timeGroup(when(rows[i - 1]), tz, T) !== g);
            return (
              <div key={r.id} style={{ display: "contents" }}>
                {head && <h3 className="cc-group">{g}</h3>}
                <Card r={r} ws={ws} T={T} adName={r.ad_id ? adNames[r.ad_id] : undefined} phone={phoneOf(phones[r.contact_id])}
                  task={tasks[r.id]} selected={openId === r.id} onOpen={(c) => { setOpenId(r.id); setOpenConfirm(!!c); }} onChange={refreshQuiet} />
              </div>
            );
          })}
          {filter !== "ids" && rows.length >= limit && rows.length < shownTotal && (
            <button className="cc-more" onClick={() => { setQuiet(true); setLimit((n) => n + PAGE); }}>
              {T(`Show ${Math.min(PAGE, shownTotal - rows.length)} more`, `Onyesha ${Math.min(PAGE, shownTotal - rows.length)} zaidi`)} <span className="muted">· {fmt(rows.length)} {T("of", "kati ya")} {fmt(shownTotal)}</span>
            </button>
          )}
        </div>
        {paneRow && <ChatPane key={paneRow.id} r={paneRow} leaving={!openRow} ws={ws} T={T} adName={paneRow.ad_id ? adNames[paneRow.ad_id] : undefined} phone={phoneOf(phones[paneRow.contact_id])}
          task={tasks[paneRow.id]} onChange={refreshQuiet} onClose={() => {
            if (!openRow) return;
            // Came here from Actions / After price / Kito …: go back to that page, not to the Chats list.
            if (backTo.current && (autoOpened.current === openRow.id || (ids && ids.length === 1))) {
              const to = backTo.current; backTo.current = null;
              if (history.length > 1) history.back(); else location.hash = to;
              return;
            }
            // Came here by an "Open chat →" link on another page (Buyers, Promises, Reorders …): the arrow goes
            // back to that page too, the same as the phone's Back gesture.
            const from = cameFrom();
            if (from && !from.startsWith("#chats") && hashOpen() === openRow.id) { history.back(); return; }
            setOpenId(null);
          }} startConfirm={openConfirm} />}
        {!openRow && (
          <div className="ib-empty" aria-hidden={false}>
            <KitoLogo size={44} />
            <b>{T("Pick a customer on the left", "Chagua mteja upande wa kushoto")}</b>
            <span className="small muted">{T("Their chat opens here, with what Kito knows about them on the right.", "Chat yake itafunguka hapa, na anachojua Kito kuhusu yeye upande wa kulia.")}</span>
            {waitingRows.length > 0 && (
              <button className="small primary" onClick={() => setOpenId(waitingRows[0].id)}>
                {waitingRows.length === 1 ? T("1 customer is waiting for your reply →", "Mteja 1 anasubiri umjibu →") : T(`${waitingRows.length} customers are waiting for your reply →`, `Wateja ${waitingRows.length} wanasubiri uwajibu →`)}
              </button>
            )}
            {filter !== "signals" && count("signals") > 0 && (
              <button className="small" onClick={() => pick("signals")}>{T(`Check payment · ${count("signals")}`, `Hakiki malipo · ${count("signals")}`)}</button>
            )}
          </div>
        )}
        </div>
      )}

      <details className="chats-how">
        <summary className="small muted">{T("How this page works", "Ukurasa huu unafanyaje kazi")}{runs[0] ? ` · ${T("Kito last updated", "Kito alisasisha")} ${when(runs[0].ran_at)}` : ""}</summary>
        <div className="small" style={{ display: "grid", gap: 6, marginTop: 8 }}>
          <span>{T("Kito, the assistant inside itaOS, reads every WhatsApp chat and writes what happened and what to do next. It updates by itself every 15 minutes.",
            "Kito, msaidizi ndani ya itaOS, anasoma kila chat ya WhatsApp na kuandika kilichotokea na hatua inayofuata. Anajisasisha mwenyewe kila dakika 15.")}</span>
          <span>{T("A customer only counts as \"Bought\" after you record the sale. If someone says they paid, check your M-Pesa / bank first, then press \"Yes, money received\".",
            "Mteja anahesabiwa \"Amenunua\" pale tu unaporekodi mauzo. Mtu akisema amelipa, angalia M-Pesa / benki kwanza, kisha bonyeza \"Ndiyo, pesa imeingia\".")}</span>
          <span className="row" style={{ gap: 6 }}>
            <button className="small" onClick={recheck} disabled={rechecking}>{T("Re-check all chats with the latest rules", "Kagua chat zote upya kwa kanuni mpya")}</button>
          </span>
          {runs.length > 0 && (
            <div className="scroll"><table>
              <thead><tr><th>{T("When", "Lini")}</th><th>{T("How", "Vipi")}</th><th className="n">{T("Chats read", "Chat zilizosomwa")}</th><th className="n">{T("Failed", "Zilizoshindwa")}</th><th>{T("Note", "Maelezo")}</th></tr></thead>
              <tbody>{runs.slice(0, 8).map((k) => (
                <tr key={k.id}><td className="small">{when(k.ran_at)}</td><td className="small">{k.trigger === "auto" ? T("By itself", "Mwenyewe") : T("Button", "Kitufe")}</td>
                  <td className="n">{k.checked}</td><td className="n">{k.failed || ""}</td><td className="small muted">{k.note ?? ""}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </details>
    </section>
  );
}

/** One customer in the list. Clicking it opens the chat on the right (full screen on a phone). */
function Card({ r, ws, T, adName, phone, task, selected, onOpen, onChange }: { r: Outcome; ws: Workspace; T: Tr; adName?: string; phone: string | null; task?: Task; selected: boolean; onOpen: (confirm?: boolean) => void; onChange: () => void }) {
  const editor = canEdit(ws);
  const st = statusOf(r, T, ws.currency);
  const temp = interest(r);
  const confirmed = Number(r.paid_orders) > 0;
  const name = nameOf(r, T);
  const why = r.kito_temp && !kitoStale(r) ? r.kito_blocker : (r.objections ?? [])[0] ?? null;
  const main = !editor ? null
    : st.key === "check" ? <button className="small primary" onClick={() => onOpen(true)}>{T("Check payment", "Hakiki malipo")}</button>
    : st.key === "bought" || st.key === "lost" ? null
    : phone ? <a className="btn small primary" href={waLink(phone)} target="_blank" rel="noopener noreferrer">{st.key === "waiting" ? T("Reply on WhatsApp ↗", "Mjibu WhatsApp ↗") : T("Message on WhatsApp ↗", "Mtumie ujumbe WhatsApp ↗")}</a>
    : null;
  return (
    <article className={"cc " + st.tone + (selected ? " sel" : "")} aria-current={selected || undefined} data-rid={r.id}>
      <div className="cc-top" onClick={() => onOpen()} onPointerDown={() => prefetchMsgs(r.id)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
        <div className="cc-avatar" aria-hidden>{name.slice(0, 1).toUpperCase()}</div>
        <div className="cc-main">
          <div className="cc-line1">
            <b className="cc-name">{name}</b>
            {r.source === "ad" && <span className="cc-adtag" title={fromOf(r, T, adName)}>{T("Ad", "Tangazo")}</span>}
            <span className="cc-time small muted">{agoT(r.last_message_at, T)}</span>
          </div>
          <div className="small muted cc-from">{fromOf(r, T, adName)}</div>
          <div className={"cc-status " + st.tone}>{st.icon === "●" ? <span className="cc-dot" /> : <span className="cc-ico">{st.icon}</span>}<span className="cc-st-text">{st.text}{st.key === "lost" && why ? ` · ${lostWhy(why, T)}` : ""}</span>
            {!confirmed && st.key !== "lost" && st.key !== "not_customer" && temp && <span className={"cc-heat " + temp}>{temp === "hot" ? T("Very interested", "Ana hamu sana") : temp === "warm" ? T("Interested", "Ana hamu") : T("Not very interested", "Hana hamu sana")}</span>}</div>
          {st.key !== "not_customer" && (kitoStale(r) ? <div className="cc-sum cc-reading">✦ {T("Kito is reading the new messages…", "Kito anasoma ujumbe mpya…")}</div>
            : r.kito_summary && <div className="cc-sum">{r.kito_summary}</div>)}
          {st.key !== "not_customer" && !kitoStale(r) && r.kito_next && st.key !== "bought" && <div className="cc-next"><b>{T("Next:", "Fanya:")}</b> {r.kito_next}</div>}
          {task && <div className="small cc-task">⏰ {T("Reminder set", "Kikumbusho kipo")}</div>}
          {editor && <PartyHint r={r} T={T} onChange={onChange} />}
        </div>
        <div className="cc-act" onClick={(e) => e.stopPropagation()}>
          {main}
          <button className="small" onClick={() => onOpen()}>{T("Open chat", "Fungua chat")}</button>
        </div>
      </div>
    </article>
  );
}
