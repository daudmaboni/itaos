// Posts (25 Nov 2026), next to Ads. The business's Facebook and Instagram posts ranked by what they SOLD:
// paid sales and chats from the ads that run each post, plus chats from the post's own WhatsApp link.
// "Make this an ad" puts the post in Meta as a PAUSED click-to-WhatsApp ad (ad-maker from_post + create),
// with the audience and budget of the best-selling ad. It appears under Ads → New ads to turn on.
// Server: supabase/functions/posts (reads Meta), public.post_money (numbers).
import { useEffect, useMemo, useState } from "react";
import { supabase, callFn, Workspace, money, fmt, ago, converter, displayCurrency } from "./lib";
import { errText } from "./errText";
import { askConfirm } from "./confirmAsk";
import CopyBtn from "./CopyBtn";

type Post = {
  id: string; platform: "facebook" | "instagram"; caption: string | null; media_type: string | null; media_url: string | null;
  permalink: string | null; posted_at: string | null; likes: number; comments: number; shares: number; views: number | null;
  ad_ids: string[]; wa_code: string | null;
};
type Money = { id: string; ad_spend: number; ad_chats: number; ad_sales: number; ad_revenue: number; link_chats: number; link_sales: number; link_revenue: number };
type Info = { social_page_name: string | null; social_ig_username: string | null; social_synced_at: string | null; social_note: string | null };
type Filter = "all" | "facebook" | "instagram";

export default function Posts({ ws }: { ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const manager = ws.role === "owner" || ws.role === "admin";
  const editor = manager || ws.role === "analyst";
  const cur = displayCurrency(ws);
  const cv = converter(ws);
  const W = (n: number) => cv(n, ws.currency) ?? n;
  const wcur = cv(1, ws.currency) != null ? cur : ws.currency;

  const [posts, setPosts] = useState<Post[] | null>(null);
  const [nums, setNums] = useState<Record<string, Money>>({});
  const [info, setInfo] = useState<Info | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [days, setDays] = useState<30 | 90>(30);
  const [filter, setFilter] = useState<Filter>("all");
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string; reconnect?: boolean; postId?: string }>({});
  const [open, setOpen] = useState<string | null>(null);   // post whose WhatsApp link box is open
  const [more, setMore] = useState(false);

  const load = async (d = days) => {
    const [p, m, w, n] = await Promise.all([
      supabase.from("social_posts").select("id,platform,caption,media_type,media_url,permalink,posted_at,likes,comments,shares,views,ad_ids,wa_code").eq("workspace_id", ws.id).order("posted_at", { ascending: false }).limit(300),
      supabase.rpc("post_money", { p_ws: ws.id, p_days: d }),
      supabase.from("workspaces").select("social_page_name,social_ig_username,social_synced_at,social_note").eq("id", ws.id).single(),
      supabase.from("wa_numbers").select("display_phone").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (p.error) { setMsg({ err: errText(p.error) }); return; }
    setPosts(p.data as Post[]);
    setNums(Object.fromEntries((((m.data as any)?.posts ?? []) as Money[]).map((x) => [x.id, x])));
    setInfo((w.data as Info) ?? null);
    setPhone(((n.data as any)?.display_phone ?? "").replace(/\D/g, "") || null);
  };

  const sync = async () => {
    setSyncing(true);
    try { await callFn("posts", { action: "sync", workspace_id: ws.id }); await load(); }
    catch (e) { const m = errText(e); setMsg({ err: m, reconnect: /reconnect|connect your meta/i.test(m) }); }
    finally { setSyncing(false); }
  };

  useEffect(() => { setPosts(null); load().then(sync); }, [ws.id]);
  useEffect(() => { if (posts) load(days); }, [days]);

  // Ranked by paid sales, then money, then chats; posts nobody bought from fall back to likes + comments + shares.
  const ranked = useMemo(() => {
    const score = (p: Post) => {
      const n = nums[p.id];
      return { sales: (n?.ad_sales ?? 0) + (n?.link_sales ?? 0), revenue: (n?.ad_revenue ?? 0) + (n?.link_revenue ?? 0), chats: (n?.ad_chats ?? 0) + (n?.link_chats ?? 0), buzz: p.likes + p.comments * 2 + p.shares * 3 };
    };
    return (posts ?? []).filter((p) => filter === "all" || p.platform === filter)
      .map((p) => ({ p, s: score(p) }))
      .sort((a, b) => b.s.sales - a.s.sales || b.s.revenue - a.s.revenue || b.s.chats - a.s.chats || b.s.buzz - a.s.buzz);
  }, [posts, nums, filter]);
  const selling = ranked.filter((r) => r.s.sales > 0 || r.s.chats > 0);
  const rest = ranked.filter((r) => !(r.s.sales > 0 || r.s.chats > 0));
  const shown = more ? [...selling, ...rest] : [...selling, ...rest.slice(0, Math.max(0, 8 - selling.length))];

  const waText = (code: string) => T(`Hello, I saw your post. I'd like more details (${code})`, `Habari, nimeona post yenu. Naomba maelezo zaidi (${code})`);
  const waLink = (code: string) => phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waText(code))}` : null;

  const makeLink = async (p: Post) => {
    setOpen(p.id);
    if (p.wa_code) return;
    setBusy("link" + p.id); setMsg({});
    try { const r = await callFn<{ code: string }>("posts", { action: "link", workspace_id: ws.id, post_id: p.id }); setPosts((xs) => xs?.map((x) => x.id === p.id ? { ...x, wa_code: r.code } : x) ?? xs); }
    catch (e) { setMsg({ err: errText(e), postId: p.id }); }
    finally { setBusy(""); }
  };

  const makeAd = async (p: Post) => {
    setBusy("ad" + p.id); setMsg({});
    try {
      const r = await callFn<{ draft: { id: string; warnings: string[]; daily_budget: number | null; budget_currency: string | null; source_ad_name: string | null } }>("ad-maker", { action: "from_post", workspace_id: ws.id, post_id: p.id });
      const d = r.draft;
      const budget = d.daily_budget ? money(d.daily_budget, d.budget_currency ?? ws.currency) : null;
      const yes = await askConfirm({
        title: T("Put this post in Meta as an ad?", "Uweke post hii Meta kama tangazo?"),
        body: [
          T(`It gets the audience, WhatsApp button${budget ? ` and budget (about ${budget} a day)` : " and budget"} of "${d.source_ad_name ?? "your best ad"}". It's created switched off, so nothing spends until you turn it on under Ads → New ads.`,
            `Inapata walengwa, kitufe cha WhatsApp${budget ? ` na bajeti (takriban ${budget} kwa siku)` : " na bajeti"} za "${d.source_ad_name ?? "tangazo lako bora"}". Inatengenezwa ikiwa imezimwa, kwa hiyo haitumii pesa mpaka uiwashe kwenye Matangazo → Matangazo mapya.`),
          ...(d.warnings.length ? ["", T("Words Meta may reject:", "Maneno ambayo Meta inaweza kukataa:"), ...d.warnings] : []),
        ].join("\n"),
        warn: d.warnings.length ? T("Meta may reject this post as an ad. A post without these words is safer.", "Meta inaweza kukataa post hii kama tangazo. Post isiyo na maneno haya ni salama zaidi.") : undefined,
        yes: T("Create it, switched off", "Tengeneza, ikiwa imezimwa"), no: T("Not now", "Si sasa"),
      });
      if (!yes) { await callFn("ad-maker", { action: "delete", workspace_id: ws.id, draft_id: d.id }).catch(() => {}); return; }
      const c = await callFn<{ post_mode?: "as_is" | "copy" }>("ad-maker", { action: "create", workspace_id: ws.id, draft_id: d.id });
      setMsg({ postId: p.id, ok: c.post_mode === "copy"
        ? T("Created in Meta, switched off. Meta wouldn't run the post itself with a WhatsApp button, so the ad is a copy (same picture and words). Turn it on under Ads → New ads.", "Limetengenezwa Meta, limezimwa. Meta haikuruhusu post yenyewe na kitufe cha WhatsApp, kwa hiyo tangazo ni nakala (picha na maneno yale yale). Liwashe kwenye Matangazo → Matangazo mapya.")
        : T("Created in Meta, switched off, using your post as it is (its likes and comments stay). Turn it on under Ads → New ads.", "Limetengenezwa Meta, limezimwa, likitumia post yako kama ilivyo (likes na comments zinabaki). Liwashe kwenye Matangazo → Matangazo mapya.") });
    } catch (e) {
      const m = errText(e);
      setMsg({ err: m, reconnect: /reconnect/i.test(m), postId: p.id });
    } finally { setBusy(""); }
  };

  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(ws.language === "sw" ? "sw-TZ" : "en-GB", { day: "numeric", month: "short" }) : "";
  const kind = (p: Post) => {
    const t = (p.media_type ?? "").replace("_", " ");
    return `${p.platform === "instagram" ? "Instagram" : "Facebook"}${t && t !== "text" ? " · " + t : ""}`;
  };

  return (
    <section className="card posts autoads">
      <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
        <div>
          <h2>{T("Posts that sell", "Post zinazouza")}</h2>
          <span className="small muted">
            {T("Your Facebook and Instagram posts, ranked by paid sales and WhatsApp chats, not likes.", "Post zako za Facebook na Instagram, zimepangwa kwa mauzo yaliyolipwa na chats za WhatsApp, si likes.")}
            {info?.social_page_name && <> {T("Page", "Ukurasa")}: {info.social_page_name}{info.social_ig_username ? ` · @${info.social_ig_username}` : ""}.</>}
          </span>
        </div>
        <div className="seg" role="tablist" aria-label={T("Period", "Kipindi")}>
          {([30, 90] as const).map((d) => <button key={d} type="button" className={days === d ? "on" : ""} aria-selected={days === d} onClick={() => setDays(d)}>{T(`${d} days`, `Siku ${d}`)}</button>)}
        </div>
      </div>

      <div className="row between posts-bar">
        <div className="seg" role="tablist" aria-label={T("Show", "Onyesha")}>
          {([["all", T("All", "Zote")], ["facebook", "Facebook"], ["instagram", "Instagram"]] as [Filter, string][]).map(([k, l]) =>
            <button key={k} type="button" className={filter === k ? "on" : ""} aria-selected={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        <span className="small muted">{syncing ? T("Updating from Meta…", "Inasasisha kutoka Meta…") : info?.social_synced_at ? T(`Updated ${ago(info.social_synced_at)}`, `Imesasishwa ${ago(info.social_synced_at)}`) : ""}
          {!syncing && <> · <button className="linkish small" onClick={sync}>{T("Refresh", "Sasisha")}</button></>}</span>
      </div>

      {info?.social_note && <p className="small muted posts-note">{info.social_note} {/reconnect/i.test(info.social_note) && <a href="#connect/setup">{T("Reconnect", "Unganisha upya")}</a>}</p>}
      {msg.err && !msg.postId && <p className="err small">{msg.err}{msg.reconnect && <> <a href="#connect/setup">{T("Reconnect the ad account", "Unganisha upya akaunti ya matangazo")}</a></>}</p>}

      {posts == null ? <div className="skeleton" style={{ minHeight: 120 }} /> : ranked.length === 0 ? (
        <p className="small muted">{syncing ? T("Reading your posts…", "Inasoma post zako…") : T("No posts found in the last 120 days.", "Hakuna post zilizopatikana siku 120 zilizopita.")}</p>
      ) : (
        <>
          {selling.length === 0 && <p className="small muted">{T("No post has a WhatsApp chat or sale in this period yet. Give your best posts their own WhatsApp link, or make one an ad, and they'll show here.", "Hakuna post yenye chat ya WhatsApp au mauzo kipindi hiki. Zipe post zako bora link yao ya WhatsApp, au fanya moja kuwa tangazo, zitaonekana hapa.")}</p>}
          <div className="aa-rows">
            {shown.map(({ p, s }, i) => {
              const n = nums[p.id];
              const isOpen = open === p.id;
              const link = p.wa_code ? waLink(p.wa_code) : null;
              return (
                <article className="aa-row" key={p.id}>
                  {p.media_url ? <img className="aa-media" src={p.media_url} alt="" loading="lazy" /> : <div className="aa-media posts-noimg" aria-hidden="true">{p.platform === "instagram" ? "IG" : "FB"}</div>}
                  <div className="aa-body">
                    <div className="row between" style={{ gap: 8 }}>
                      <span className="small muted">{kind(p)} · {fmtDate(p.posted_at)}</span>
                      {i === 0 && s.sales > 0 && <span className="chip ok">{T("Best seller", "Inauza zaidi")}</span>}
                    </div>
                    {p.caption ? <p className="aa-text posts-cap">{p.caption}</p> : <p className="small muted">{T("No words on this post", "Post hii haina maneno")}</p>}
                    <div className="posts-nums">
                      {s.sales > 0 ? <b className="good">{fmt(s.sales)} {T(s.sales === 1 ? "paid sale" : "paid sales", "mauzo")} · {money(W(s.revenue), wcur)}</b> : <b className="muted">{T("No paid sale yet", "Bado hakuna mauzo")}</b>}
                      <span className="small">{fmt(s.chats)} {T("WhatsApp chats", "chats za WhatsApp")}</span>
                    </div>
                    <span className="small muted">
                      {fmt(p.likes)} {p.platform === "instagram" ? "likes" : T("reactions", "reactions")} · {fmt(p.comments)} comments{p.shares ? ` · ${fmt(p.shares)} shares` : ""}{p.views ? ` · ${fmt(p.views)} views` : ""}
                      {n && (n.ad_chats > 0 || n.ad_sales > 0) && <> · {T("from ads", "kutoka matangazo")}: {fmt(n.ad_chats)} chats, {fmt(n.ad_sales)} {T("sales", "mauzo")}</>}
                      {n && (n.link_chats > 0 || n.link_sales > 0) && <> · {T("from its link", "kutoka link yake")}: {fmt(n.link_chats)} chats, {fmt(n.link_sales)} {T("sales", "mauzo")}</>}
                      {p.ad_ids.length > 0 && !(n && (n.ad_chats || n.ad_sales)) && <> · {T("runs as an ad", "ni tangazo")}</>}
                    </span>

                    {isOpen && (
                      <div className="posts-link small">
                        {busy === "link" + p.id ? <span className="muted">{T("Making the link…", "Inatengeneza link…")}</span>
                          : !phone ? <span className="muted">{T("Connect your WhatsApp number first (Connections).", "Unganisha namba yako ya WhatsApp kwanza (Miunganisho).")}</span>
                          : link ? <>
                            <span>{T("Put this link in the post's words (or the first comment). Chats that start from it are counted for this post.", "Weka link hii kwenye maneno ya post (au comment ya kwanza). Chats zinazoanza nayo zinahesabiwa kwa post hii.")}</span>
                            <code className="posts-url">{link}</code>
                            <span className="row" style={{ gap: 12 }}><CopyBtn text={link} T={T} className="btn" /><button className="linkish small" onClick={() => setOpen(null)}>{T("Close", "Funga")}</button></span>
                          </> : null}
                      </div>
                    )}
                    {msg.postId === p.id && msg.err && <p className="err small">{msg.err}{msg.reconnect && <> <a href="#connect/setup">{T("Reconnect the ad account", "Unganisha upya akaunti ya matangazo")}</a></>}</p>}
                    {msg.postId === p.id && msg.ok && <p className="small good">{msg.ok} <a href="#ads">{T("Open Ads", "Fungua Matangazo")}</a></p>}

                    <div className="row aa-act">
                      {manager && <button className={i === 0 ? "primary" : "btn"} disabled={!!busy} onClick={() => makeAd(p)}>{busy === "ad" + p.id ? T("Creating…", "Inatengeneza…") : T("Make this an ad", "Fanya tangazo")}</button>}
                      {editor && !isOpen && <button className="linkish small" disabled={!!busy} onClick={() => makeLink(p)}>{p.wa_code ? T("WhatsApp link", "Link ya WhatsApp") : T("Get a WhatsApp link", "Pata link ya WhatsApp")}</button>}
                      {p.permalink && <a className="linkish small" href={p.permalink} target="_blank" rel="noreferrer">{T("Open post", "Fungua post")}</a>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {!more && rest.length > shown.length - selling.length && <button className="linkish small posts-more" onClick={() => setMore(true)}>{T(`Show all ${ranked.length} posts`, `Onyesha post zote ${ranked.length}`)}</button>}
        </>
      )}
    </section>
  );
}
