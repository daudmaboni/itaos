// New ads (25 Nov 2026), under Ad money. Claude writes a new click-to-WhatsApp ad from the business's
// best ad; itaOS puts it in Meta as PAUSED; the owner turns it on, edits it or deletes it. Nothing spends
// money until the owner taps Turn on. Server: supabase/functions/ad-maker.
import { useEffect, useState } from "react";
import { supabase, callFn, Workspace, money } from "./lib";
import { errText } from "./errText";
import { askConfirm } from "./confirmAsk";

type Draft = {
  id: string; source_ad_name: string | null; primary_text: string; headline: string | null; greeting: string | null;
  options: { primary_text: string; headline: string; greeting: string; angle?: string; warnings?: string[] }[];
  warnings: string[]; status: "draft" | "creating" | "paused" | "active" | "deleted" | "failed";
  meta_status: string | null; last_error: string | null; daily_budget: number | null; budget_currency: string | null;
  media_url: string | null; meta_ad_id: string | null; created_at: string;
  source_post_id?: string | null; source_post_platform?: string | null; post_mode?: string | null;
};

export default function AutoAds({ ws }: { ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const manager = ws.role === "owner" || ws.role === "admin";
  const editor = manager || ws.role === "analyst";
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string; reconnect?: boolean }>({});
  const [hint, setHint] = useState("");
  const [edit, setEdit] = useState<{ id: string; primary_text: string; headline: string; greeting: string } | null>(null);

  const load = async () => {
    const { data, error } = await supabase.from("ad_drafts").select("*").eq("workspace_id", ws.id).neq("status", "deleted").order("created_at", { ascending: false }).limit(10);
    if (error) setMsg({ err: errText(error) }); else setRows(data as Draft[]);
  };
  useEffect(() => {
    setRows(null); load();
    // Meta's review status, quietly, then reload.
    callFn("ad-maker", { action: "refresh", workspace_id: ws.id }).then(load).catch(() => {});
  }, [ws.id]);

  const run = async (key: string, body: Record<string, unknown>, ok?: string) => {
    setBusy(key); setMsg({});
    try {
      const r = await callFn<{ draft?: Draft; greeting_dropped?: boolean; need_reconnect?: boolean }>("ad-maker", { workspace_id: ws.id, ...body });
      await load();
      if (r.greeting_dropped) setMsg({ ok: T("Done. Meta didn't accept the new WhatsApp greeting, so this ad uses your usual one.", "Imekamilika. Meta haikukubali salamu mpya ya WhatsApp, kwa hiyo tangazo hili linatumia ya kawaida.") });
      else if (ok) setMsg({ ok });
      return r;
    } catch (e) {
      const m = errText(e);
      setMsg({ err: m, reconnect: /reconnect/i.test(m) });
      load();
      return null;
    } finally { setBusy(""); }
  };

  const write = () => run("new", { action: "draft", hint: hint.trim() || undefined }).then((r) => { if (r) setHint(""); });
  const create = async (d: Draft) => {
    if (d.warnings.length && !(await askConfirm({
      title: T("Create it with these warnings?", "Litengenezwe na tahadhari hizi?"),
      body: d.warnings.join("\n"), warn: T("Meta may reject the ad. Editing the words first is safer.", "Meta inaweza kulikataa tangazo. Ni salama zaidi kubadili maneno kwanza."),
      yes: T("Create anyway", "Tengeneza tu"), no: T("Edit first", "Badili kwanza"),
    }))) return;
    run(d.id, { action: "create", draft_id: d.id }, T("Created in Meta, paused. Nothing is spending yet.", "Limetengenezwa Meta, limezimwa. Hakuna pesa inayotumika bado."));
  };
  const turnOn = async (d: Draft) => {
    const budget = d.daily_budget ? money(d.daily_budget, d.budget_currency ?? ws.currency) : null;
    if (!(await askConfirm({
      title: T("Turn this ad on?", "Uwashe tangazo hili?"),
      body: budget ? T(`It starts spending up to about ${budget} a day (the same budget as "${d.source_ad_name}"). You can change it in Ads Manager.`, `Litaanza kutumia hadi takriban ${budget} kwa siku (bajeti ile ile ya "${d.source_ad_name}"). Unaweza kuibadili Ads Manager.`)
        : T(`It starts spending money with the same budget as "${d.source_ad_name}".`, `Litaanza kutumia pesa kwa bajeti ile ile ya "${d.source_ad_name}".`),
      warn: T("Meta reviews it first, usually within a day.", "Meta hulikagua kwanza, kwa kawaida ndani ya siku moja."),
      yes: T("Turn on and spend", "Washa, tumia pesa"), no: T("Keep paused", "Libaki limezimwa"),
    }))) return;
    run(d.id, { action: "turn_on", draft_id: d.id }, T("Turned on. Meta is reviewing it.", "Limewashwa. Meta inalikagua."));
  };
  const remove = async (d: Draft) => {
    if (!(await askConfirm({
      title: d.meta_ad_id ? T("Delete this ad from Meta?", "Ufute tangazo hili Meta?") : T("Delete this draft?", "Ufute rasimu hii?"),
      body: d.meta_ad_id ? T("Its new campaign is deleted in Meta. Your original ad isn't touched.", "Kampeni yake mpya inafutwa Meta. Tangazo lako la asili haliguswi.") : undefined,
      yes: T("Delete", "Futa"), no: T("Keep", "Acha"), danger: true,
    }))) return;
    run(d.id, { action: "delete", draft_id: d.id }, T("Deleted.", "Limefutwa."));
  };
  const another = (d: Draft) => run(d.id, { action: "next_version", draft_id: d.id });
  const saveEdit = () => {
    if (!edit) return;
    const d = rows?.find((x) => x.id === edit.id);
    run(edit.id, { action: "save", draft_id: edit.id, primary_text: edit.primary_text, headline: edit.headline, greeting: edit.greeting, push_to_meta: !!d?.meta_ad_id },
      d?.meta_ad_id ? T("Saved and updated in Meta.", "Imehifadhiwa na kubadilishwa Meta.") : T("Saved.", "Imehifadhiwa."))
      .then((r) => { if (r) setEdit(null); });
  };

  const statusChip = (d: Draft) => {
    const ms = d.meta_status ?? "";
    if (d.status === "draft") return <span className="chip">{T("Draft", "Rasimu")}</span>;
    if (d.status === "creating") return <span className="chip">{T("Creating…", "Inatengenezwa…")}</span>;
    if (d.status === "failed") return <span className="chip bad">{T("Didn't create", "Haikutengenezwa")}</span>;
    if (/DISAPPROVED/.test(ms)) return <span className="chip bad">{T("Rejected by Meta", "Meta imelikataa")}</span>;
    if (/PENDING_REVIEW|IN_PROCESS/.test(ms)) return <span className="chip warn">{T("Meta is reviewing", "Meta inakagua")}</span>;
    if (d.status === "active") return <span className="chip ok">{T("Running", "Linaendelea")}</span>;
    return <span className="chip">{T("Paused in Meta", "Limezimwa Meta")}</span>;
  };

  return (
    <section className="card autoads">
      <div className="row between">
        <div>
          <h2>{T("New ads", "Matangazo mapya")}</h2>
          <span className="small muted">{T("itaOS writes a new ad from your best-selling ad and puts it in Meta switched off. It spends nothing until you turn it on.",
            "itaOS inaandika tangazo jipya kutoka tangazo lako linalouza zaidi na kuliweka Meta likiwa limezimwa. Halitumii pesa mpaka uliwashe.")}</span>
        </div>
      </div>

      {editor && (
        <div className="aa-new">
          <input className="input" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={300}
            placeholder={T("Optional: anything to mention (e.g. free delivery in Dar)", "Hiari: chochote cha kutaja (mf. tunaleta bure Dar)")} />
          <button className="primary" disabled={!!busy} onClick={write}>{busy === "new" ? T("Writing…", "Inaandika…") : T("Write a new ad", "Andika tangazo jipya")}</button>
        </div>
      )}

      {msg.err && <p className="err small">{msg.err}{msg.reconnect && <> <a href="#connect/setup">{T("Reconnect the ad account", "Unganisha upya akaunti ya matangazo")}</a></>}</p>}
      {msg.ok && <p className="small good">{msg.ok}</p>}

      {rows == null ? <div className="skeleton" style={{ minHeight: 80 }} /> : rows.length === 0 ? (
        <p className="small muted">{T("No new ads yet.", "Bado hakuna matangazo mapya.")}</p>
      ) : (
        <div className="aa-rows">
          {rows.map((d) => {
            const editing = edit?.id === d.id;
            const locked = !!busy;
            return (
              <article className="aa-row" key={d.id}>
                {d.media_url && <img className="aa-media" src={d.media_url} alt="" loading="lazy" />}
                <div className="aa-body">
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="small muted">{d.source_post_id
                      ? T(`Your ${d.source_post_platform === "instagram" ? "Instagram" : "Facebook"} post${d.post_mode === "copy" ? " (copy)" : ""}, with the audience of "${d.source_ad_name ?? "your best ad"}"`, `Post yako ya ${d.source_post_platform === "instagram" ? "Instagram" : "Facebook"}${d.post_mode === "copy" ? " (nakala)" : ""}, na walengwa wa "${d.source_ad_name ?? "tangazo lako bora"}"`)
                      : T(`From "${d.source_ad_name ?? "your best ad"}"`, `Kutoka "${d.source_ad_name ?? "tangazo lako bora"}"`)}</span>
                    {statusChip(d)}
                  </div>
                  {editing ? (
                    <div className="aa-edit">
                      <label className="small">{T("Headline", "Kichwa")}<input className="input" value={edit.headline} maxLength={255} onChange={(e) => setEdit({ ...edit, headline: e.target.value })} /></label>
                      <label className="small">{T("Ad text", "Maneno ya tangazo")}<textarea className="input" rows={5} value={edit.primary_text} onChange={(e) => setEdit({ ...edit, primary_text: e.target.value })} /></label>
                      <label className="small">{T("First WhatsApp message they see", "Ujumbe wa kwanza wa WhatsApp wanaouona")}<textarea className="input" rows={2} value={edit.greeting} maxLength={500} onChange={(e) => setEdit({ ...edit, greeting: e.target.value })} /></label>
                    </div>
                  ) : (
                    <>
                      {d.headline && <b>{d.headline}</b>}
                      <p className="aa-text">{d.primary_text}</p>
                      {d.greeting && <p className="small muted aa-greet">💬 {d.greeting}</p>}
                    </>
                  )}
                  {d.warnings.length > 0 && !editing && (
                    <ul className="aa-warn small">{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  )}
                  {d.last_error && <p className="small err">{d.last_error}</p>}

                  {editing ? (
                    <div className="row" style={{ gap: 12 }}>
                      <button className="primary" disabled={locked} onClick={saveEdit}>{busy === d.id ? T("Saving…", "Inahifadhi…") : T("Save", "Hifadhi")}</button>
                      <button className="linkish small" onClick={() => setEdit(null)}>{T("Cancel", "Ghairi")}</button>
                    </div>
                  ) : (
                    <div className="row aa-act">
                      {(d.status === "draft" || d.status === "failed") && manager && <button className="primary" disabled={locked} onClick={() => create(d)}>{busy === d.id ? T("Creating…", "Inatengeneza…") : T("Put in Meta (paused)", "Weka Meta (limezimwa)")}</button>}
                      {d.status === "paused" && manager && <button className="primary" disabled={locked} onClick={() => turnOn(d)}>{busy === d.id ? T("Turning on…", "Inawasha…") : T("Turn on", "Washa")}</button>}
                      {d.status === "active" && manager && <button className="btn" disabled={locked} onClick={() => run(d.id, { action: "pause", draft_id: d.id }, T("Paused.", "Limezimwa."))}>{T("Pause", "Zima")}</button>}
                      {editor && !d.source_post_id && d.status !== "creating" && (d.status !== "paused" && d.status !== "active" || manager) && (
                        <button className="linkish small" disabled={locked} onClick={() => setEdit({ id: d.id, primary_text: d.primary_text, headline: d.headline ?? "", greeting: d.greeting ?? "" })}>{T("Edit words", "Badili maneno")}</button>
                      )}
                      {(d.status === "draft" || d.status === "failed") && d.options.length > 0 && editor && !d.source_post_id && (
                        <button className="linkish small" disabled={locked} onClick={() => another(d)}>{T("Try another version", "Jaribu toleo jingine")}</button>
                      )}
                      {(manager || (!d.meta_ad_id && editor)) && <button className="linkish small danger" disabled={locked} onClick={() => remove(d)}>{T("Delete", "Futa")}</button>}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
