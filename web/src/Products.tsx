// My products: what the business sells (name, other names, selling price, cost per unit, photos),
// plus the paid orders that still have no cost, so the owner can say what was in them.
// The cost of an order = Σ qty × unit cost of the products picked. It is filled in, never forced:
// the owner can still type a different number. Nothing is assumed for a new business.
// Everything here belongs to one business (workspace): its products, its photos, its sales. Switching
// business shows that business's list; nothing is shared between businesses.
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageViewer } from "./ImageViewer";
import DateRange from "./DateRange";
import { enterCards, enterRows, enterTiles, growBars, countTo, shake, usePageEnter, select } from "./motion";
import { supabase, Workspace, amt, money, fmt, when, orderNet, canEdit, moneyInput, moneyText, localDay } from "./lib";
import { RangeSel, resolveRange, presetLabel, rangeText, loadRange, saveRange, addDays } from "./ranges";
import { useKept } from "./keep";

export type Product = {
  id: string; workspace_id: string; name: string; aliases: string[]; price: number | null; cost: number | null;
  photos: string[]; notes: string | null; active: boolean; sort: number;
};
/** One line of an order: what was sold and, at that moment, what it cost and sold for. */
export type Item = { product_id: string | null; name: string; qty: number; unit_cost: number | null; unit_price: number | null };

const num = (s: string) => { const t = s.replace(/[^\d.]/g, ""); return t === "" ? null : Number(t); };
/** Cost of the picked items, or null if any picked product has no cost yet. */
export const itemsCost = (items: Item[]) =>
  items.length && items.every((i) => i.unit_cost != null) ? items.reduce((s, i) => s + i.qty * Number(i.unit_cost), 0) : null;
export const itemsLabel = (items: Item[]) => items.map((i) => (i.qty > 1 ? `${i.qty}× ` : "") + i.name).join(", ");

/** The workspace's products (active first, in the owner's order). */
export function useProducts(wsId: string, tick = 0) {
  const [list, setList] = useState<Product[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    supabase.from("products").select("*").eq("workspace_id", wsId).order("sort").order("name")
      .then(({ data, error }) => { if (!live) return; if (error) setErr(error.message); setList((data as Product[]) ?? []); });
    return () => { live = false; };
  }, [wsId, tick]);
  return { products: list, err };
}

/** Tap a product to tick it, tap again to untick; + and − change how many. Shows the total cost of what's picked. */
export function ProductPicker({ ws, products, items, onChange, T }: {
  ws: Workspace; products: Product[]; items: Item[]; onChange: (items: Item[]) => void; T: (en: string, sw: string) => string;
}) {
  const active = products.filter((p) => p.active);
  if (!active.length) return null;
  const add = (p: Product) => {
    const i = items.findIndex((x) => x.product_id === p.id);
    if (i >= 0) onChange(items.filter((_, k) => k !== i));   // tap again = untick; use + for more
    else onChange([...items, { product_id: p.id, name: p.name, qty: 1, unit_cost: p.cost != null ? Number(p.cost) : null, unit_price: p.price != null ? Number(p.price) : null }]);
  };
  const setQty = (k: number, q: number) => onChange(q <= 0 ? items.filter((_, j) => j !== k) : items.map((x, j) => (j === k ? { ...x, qty: q } : x)));
  const total = itemsCost(items);
  return (
    <div className="pp">
      <span className="small muted">{T("What did they buy? Tap to pick, tap again to remove. Use + for more than one.", "Amenunua nini? Gusa kuchagua, gusa tena kuondoa. Tumia + kwa zaidi ya moja.")}</span>
      <div className="pp-chips">
        {active.map((p) => {
          const n = items.find((x) => x.product_id === p.id)?.qty ?? 0;
          return <button type="button" key={p.id} className={"pp-chip" + (n ? " on" : "")} aria-pressed={n > 0} onClick={() => add(p)}>{n ? "✓ " : ""}{p.name}{n > 1 ? <b> ×{n}</b> : null}</button>;
        })}
      </div>
      {items.length > 0 && (
        <div className="pp-lines">
          {items.map((x, k) => (
            <div key={(x.product_id ?? x.name) + k} className="pp-line">
              <span className="pp-name">{x.name}</span>
              <span className="pp-qty">
                <button type="button" aria-label={T("one less", "punguza moja")} onClick={() => setQty(k, x.qty - 1)}>−</button>
                <b>{x.qty}</b>
                <button type="button" aria-label={T("one more", "ongeza moja")} onClick={() => setQty(k, x.qty + 1)}>+</button>
              </span>
              <span className="pp-cost small muted">{x.unit_cost != null ? money(x.qty * x.unit_cost, ws.currency) : T("no cost set", "gharama haijawekwa")}</span>
            </div>
          ))}
          <span className="pp-total small">{total != null ? <>{T("Cost of these", "Gharama ya hizi")}: <b>{money(total, ws.currency)}</b></> : <span className="warnt">{T("Some products have no cost yet. Add it in My products, or type the cost below.", "Baadhi ya bidhaa hazina gharama. Iweke kwenye Bidhaa zangu, au andika gharama hapa chini.")}</span>}</span>
        </div>
      )}
    </div>
  );
}

/** Shrink a phone photo before upload (max 1280 px, JPEG ~85%) so it stays small and fast. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
    return b ?? file;
  } catch { return file; }
}

function usePhotoUrls(paths: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join("|");
  useEffect(() => {
    const need = paths.filter((p) => !urls[p]);
    if (!need.length) return;
    supabase.storage.from("product-photos").createSignedUrls(need, 3600).then(({ data }) => {
      const add: Record<string, string> = {};
      (data ?? []).forEach((d) => { if (d.path && d.signedUrl) add[d.path] = d.signedUrl; });
      setUrls((u) => ({ ...u, ...add }));
    });
  }, [key]);
  return urls;
}

const pctOf = (profit: number, price: number) => (price > 0 ? Math.round((profit / price) * 100) : null);

function ProductForm({ ws, p, onDone, onCancel, T }: { ws: Workspace; p: Product | null; onDone: () => void; onCancel: () => void; T: (en: string, sw: string) => string }) {
  const [name, setName] = useState(p?.name ?? "");
  const [aliases, setAliases] = useState((p?.aliases ?? []).join(", "));
  const [price, setPrice] = useState(moneyText(p?.price));
  const [cost, setCost] = useState(moneyText(p?.cost));
  const [notes, setNotes] = useState(p?.notes ?? "");
  const [photos, setPhotos] = useState<string[]>(p?.photos ?? []);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const urls = usePhotoUrls(photos);
  const id = useMemo(() => p?.id ?? crypto.randomUUID(), [p?.id]);
  const box = useRef<HTMLFormElement>(null);
  // Bring the form into view when it opens (on phones it can open below the fold).
  useEffect(() => { box.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); box.current?.querySelector<HTMLInputElement>("input[name=pname]")?.focus({ preventScroll: true }); }, []);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (photos.length + files.length > 6) return setErr(T("Up to 6 photos per product.", "Hadi picha 6 kwa kila bidhaa."));
    setBusy(true); setErr("");
    const added: string[] = [];
    for (const f of Array.from(files)) {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) { setErr(T("Only photos (JPG, PNG, WebP).", "Picha tu (JPG, PNG, WebP).")); continue; }
      const blob = await shrink(f);
      const path = `${ws.id}/${id}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("product-photos").upload(path, blob, { contentType: blob.type || "image/jpeg" });
      if (error) setErr(error.message); else added.push(path);
    }
    setPhotos((x) => [...x, ...added]);
    setBusy(false);
  }
  async function removePhoto(path: string) {
    setPhotos((x) => x.filter((y) => y !== path));
    await supabase.storage.from("product-photos").remove([path]);
  }
  /** Make this photo the cover (the first one is what the product card shows). */
  const makeCover = (path: string) => setPhotos((x) => [path, ...x.filter((y) => y !== path)]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr(T("Give the product a name.", "Ipe bidhaa jina."));
    const pr = num(price), c = num(cost);
    if ((pr != null && !isFinite(pr)) || (c != null && !isFinite(c))) return setErr(T("Price and cost must be numbers.", "Bei na gharama ziwe namba."));
    const row = {
      workspace_id: ws.id, name: n, price: pr, cost: c, notes: notes.trim() || null, photos,
      aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean).slice(0, 20),
    };
    setBusy(true); setErr("");
    const { error } = p
      ? await supabase.from("products").update(row).eq("id", p.id).eq("workspace_id", ws.id)
      : await supabase.from("products").insert({ id, ...row, sort: 999 });
    setBusy(false);
    if (error) { setErr(error.code === "23505" ? T("You already have a product with this name.", "Tayari una bidhaa yenye jina hili.") : error.message); shake(box.current); }
    else { forgetPhotosReady(ws.id); onDone(); }
  }
  const pr = num(price), c = num(cost);
  const margin = pr != null && c != null ? pr - c : null;
  const mp = margin != null && pr != null ? pctOf(margin, pr) : null;
  return (
    <form className="card prod-form" onSubmit={save} ref={box}>
      <div className="row between"><b>{p ? T(`Edit ${p.name}`, `Hariri ${p.name}`) : T("Add a product", "Ongeza bidhaa")}</b>
        <span className="small muted">{ws.name}</span></div>
      <div className="map">
        <label style={{ gridColumn: "1 / -1" }}>{T("Name", "Jina")}<input name="pname" required value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={T("The name you use for it, e.g. with size or pack", "Jina unalotumia, mf. pamoja na ukubwa au pakiti")} /></label>
        <label>{T("Selling price", "Bei ya kuuza")} ({ws.currency})<input inputMode="decimal" value={price} onChange={moneyInput(setPrice)} placeholder={T("what customers pay", "anacholipa mteja")} /></label>
        <label>{T("What one costs you", "Gharama ya moja kwako")} ({ws.currency})<input inputMode="decimal" value={cost} onChange={moneyInput(setCost)} placeholder={T("product + delivery", "bidhaa + usafiri")} /></label>
      </div>
      {margin != null && (
        <div className={"prod-live" + (margin < 0 ? " neg" : "")}>
          <span>{T("Profit on each one", "Faida kwa kila moja")}</span>
          <b>{money(margin, ws.currency)}{mp != null && <span className="small"> · {mp}%</span>}</b>
        </div>
      )}
      <div className="map">
        <label style={{ gridColumn: "1 / -1" }}>{T("Other names customers use (comma separated)", "Majina mengine wanayotumia wateja (tenganisha kwa koma)")}
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder={T("short names, nicknames, spellings customers write", "majina mafupi, ya utani, au jinsi wateja wanavyoandika")} />
          <span className="small muted">{T("itaOS uses these to spot the product in your chats.", "itaOS inayatumia kutambua bidhaa kwenye chats zako.")}</span></label>
        <label style={{ gridColumn: "1 / -1" }}>{T("Note (optional)", "Maelezo (si lazima)")}<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={T("size, pack, how it's used…", "ukubwa, pakiti, matumizi…")} /></label>
      </div>
      {view && <ImageViewer src={view} alt="" sw={ws.language === "sw"} onClose={() => setView(null)} />}
      <div className="prod-photos">
        {photos.map((ph, i) => (
          <span key={ph} className={"prod-ph" + (i === 0 ? " cover" : "")}>
            {urls[ph] ? <img src={urls[ph]} alt="" onClick={() => setView(urls[ph])} style={{ cursor: "zoom-in" }} /> : <span className="prod-ph-empty" />}
            {i === 0 ? <span className="prod-ph-tag">{T("Cover", "Kuu")}</span>
              : <button type="button" className="prod-ph-star" title={T("Make this the cover photo", "Fanya hii picha kuu")} aria-label={T("Make this the cover photo", "Fanya hii picha kuu")} onClick={() => makeCover(ph)}>★</button>}
            <button type="button" aria-label={T("Remove photo", "Ondoa picha")} onClick={() => removePhoto(ph)}>×</button>
          </span>
        ))}
        {photos.length < 6 && (
          <label className="prod-ph prod-add">
            <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => { upload(e.target.files); e.currentTarget.value = ""; }} />
            <span>{busy ? <span className="kito-spin sm" aria-hidden /> : "+"} {T("Photo", "Picha")}</span>
          </label>
        )}
      </div>
      <span className="small muted">{T(`Add 3–4 clear photos: the front with the label, the back, and one taken on a phone like customers do. When a customer sends a photo in your chats, itaOS compares it only with ${ws.name}'s own products and suggests which one it is.`, `Weka picha 3–4 zinazoonekana vizuri: mbele na lebo, nyuma, na moja iliyopigwa kwa simu kama wateja wanavyopiga. Mteja akituma picha kwenye chats zako, itaOS inailinganisha na bidhaa za ${ws.name} pekee na kupendekeza ni ipi.`)}</span>
      {err && <span className="err small">{err}</span>}
      <div className="row"><button className="primary small" disabled={busy}>{busy ? <span className="kito-spin sm" aria-hidden /> : null}{T("Save product", "Hifadhi bidhaa")}</button><button type="button" className="small" onClick={onCancel}>{T("Cancel", "Ghairi")}</button></div>
    </form>
  );
}

/** What one product did in the chosen period (from the products picked on paid orders). */
type Sold = { units: number; sales: number; cost: number; costKnown: boolean; orders: number; named: number };

function ProductCard({ ws, p, editor, sold, spotted, best, rank, period, canMove, onMove, onEdit, onChange, T }: {
  ws: Workspace; p: Product; editor: boolean; sold: Sold | undefined; spotted: number; best: number; rank: number | null; period: string;
  canMove: { up: boolean; down: boolean } | null; onMove: (dir: -1 | 1) => void; onEdit: () => void; onChange: () => void; T: (en: string, sw: string) => string;
}) {
  const urls = usePhotoUrls(p.photos.slice(0, 1));
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const s = sold ?? { units: 0, sales: 0, cost: 0, costKnown: true, orders: 0, named: 0 };
  // No fixed price (prices vary per customer)? Use the average actually paid in the period.
  const unitPrice = p.price != null ? Number(p.price) : s.units > 0 ? s.sales / s.units : null;
  const margin = unitPrice != null && p.cost != null ? unitPrice - Number(p.cost) : null;
  const mp = margin != null && unitPrice != null ? pctOf(margin, unitPrice) : null;
  const cover = p.photos[0] ? urls[p.photos[0]] : undefined;
  async function toggle() {
    setBusy(true);
    const { error } = await supabase.from("products").update({ active: !p.active }).eq("id", p.id).eq("workspace_id", ws.id);
    setBusy(false); if (error) setErr(error.message); else { forgetPhotosReady(ws.id); onChange(); }
  }
  async function remove() {
    if (!confirm(T(`Delete ${p.name}? Orders that already used it keep their cost.`, `Futa ${p.name}? Oda zilizokwisha itumia zinabaki na gharama yake.`))) return;
    setBusy(true);
    if (p.photos.length) await supabase.storage.from("product-photos").remove(p.photos);
    const { error } = await supabase.from("products").delete().eq("id", p.id).eq("workspace_id", ws.id);
    setBusy(false); if (error) setErr(error.message); else { forgetPhotosReady(ws.id); onChange(); }
  }
  const share = best > 0 && s.sales > 0 ? Math.max(0.04, s.sales / best) : 0;
  return (
    <div className={"card prod-card" + (p.active ? "" : " off")}>
      {view && <ImageViewer src={view} alt={p.name} sw={ws.language === "sw"} onClose={() => setView(null)} />}
      <div className={"prod-cover" + (cover ? "" : " none")} onClick={() => cover && setView(cover)} role={cover ? "button" : undefined} aria-label={cover ? T(`Photo of ${p.name}`, `Picha ya ${p.name}`) : undefined}>
        {cover ? <img src={cover} alt={p.name} loading="lazy" className="fade-in" onLoad={(e) => e.currentTarget.classList.add("loaded")} /> : p.photos.length ? <span className="prod-ph-empty" /> : (
          <span className="prod-cover-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8" /></svg>
            <span className="small">{T("No photos yet", "Bado hakuna picha")}</span>
          </span>)}
        {rank != null && <span className="prod-rank">#{rank}</span>}
        {p.photos.length > 1 && <span className="prod-count">{p.photos.length} {T("photos", "picha")}</span>}
        {!p.active && <span className="prod-hidden">{T("Hidden", "Imefichwa")}</span>}
      </div>
      <div className="prod-body">
        <h3>{p.name}</h3>
        {p.aliases.length > 0 && <div className="prod-alias">{p.aliases.slice(0, 6).map((a) => <span key={a} className="chip">{a}</span>)}{p.aliases.length > 6 && <span className="chip">+{p.aliases.length - 6}</span>}</div>}
        <div className="prod-nums">
          {p.price == null && s.units > 0
            ? <span><span className="small muted">{T("Average paid", "Wastani wa malipo")}</span><b>{money(s.sales / s.units, ws.currency)}</b></span>
            : <span><span className="small muted">{T("Sells for", "Inauzwa")}</span><b>{p.price != null ? money(Number(p.price), ws.currency) : "–"}</b></span>}
          <span><span className="small muted">{T("Costs you", "Inakugharimu")}</span><b className={p.cost == null ? "warnt" : ""}>{p.cost != null ? money(Number(p.cost), ws.currency) : T("not set", "haijawekwa")}</b></span>
          <span><span className="small muted">{T("Profit each", "Faida kila moja")}</span><b className={margin != null && margin < 0 ? "err" : margin != null ? "goodt" : ""}>{margin != null ? money(margin, ws.currency) : "–"}{mp != null && <span className={"pct" + (mp < 0 ? " neg" : "")}>{mp}%</span>}</b></span>
        </div>
        <div className="prod-sold">
          <div className="row between small">
            <span>{s.units > 0 ? <><b>{s.units}</b> {T("sold", "zimeuzwa")} · {money(s.sales, ws.currency)}</> : <span className="muted">{T("None picked on a sale", "Haijachaguliwa kwenye mauzo")}</span>}</span>
            <span className="muted">{period}</span>
          </div>
          <span className="prod-bar" aria-hidden>{share > 0 && <i style={{ width: `${Math.round(share * 100)}%` }} />}</span>
          {s.named > 0 && <span className="small muted">{T(`Named in ${s.named} more paid ${s.named === 1 ? "order" : "orders"} where nothing was picked`, `Imetajwa kwenye oda ${s.named} zaidi zilizolipwa bila kuchagua bidhaa`)}</span>}
        </div>
        {p.photos.length > 0 && p.active && (
          <div className="prod-match small">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" /><circle cx="12" cy="13" r="3.5" /></svg>
            <span>{spotted > 0
              ? T(`Recognised in ${spotted} customer ${spotted === 1 ? "photo" : "photos"} in your chats`, `Imetambuliwa kwenye picha ${spotted} za wateja kwenye chats zako`)
              : T("Customer photos in your chats are checked against this product", "Picha za wateja kwenye chats zako zinalinganishwa na bidhaa hii")}</span>
          </div>
        )}
        {(p.cost == null || !p.photos.length) && (
          <div className="prod-needs">
            {p.cost == null && <span className="chip warn">{T("No cost", "Hakuna gharama")}</span>}
            {!p.photos.length && <span className="chip">{T("No photos", "Hakuna picha")}</span>}
          </div>
        )}
        {p.notes && <span className="small muted">{p.notes}</span>}
        {err && <span className="err small">{err}</span>}
        {editor && (
          <div className="prod-acts">
            <button className="small" onClick={onEdit}>{T("Edit", "Hariri")}</button>
            <button className="small" disabled={busy} onClick={toggle}>{p.active ? T("Hide", "Ficha") : T("Show", "Onyesha")}</button>
            <button className="small linkish danger-text" disabled={busy} onClick={remove}>{T("Delete product", "Futa bidhaa")}</button>
            {canMove && (
              <span className="prod-move">
                <button className="small" disabled={!canMove.up} aria-label={T("Move up", "Panda juu")} title={T("Move up", "Panda juu")} onClick={() => onMove(-1)}>↑</button>
                <button className="small" disabled={!canMove.down} aria-label={T("Move down", "Shuka chini")} title={T("Move down", "Shuka chini")} onClick={() => onMove(1)}>↓</button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type NoCost = { id: string; amount: number; discount: number; refund_amount: number; currency: string; paid_at: string | null; conversation_id: string | null; name?: string | null };

/** Paid orders with no cost: pick what was in each one (or type the cost) and save. */
function MissingCosts({ ws, products, editor, T }: { ws: Workspace; products: Product[]; editor: boolean; T: (en: string, sw: string) => string }) {
  const [rows, setRows] = useState<NoCost[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.from("orders").select("id,amount,discount,refund_amount,currency,paid_at,conversation_id")
        .eq("workspace_id", ws.id).eq("status", "paid").is("cost", null).order("paid_at", { ascending: false }).limit(300);
      if (!live) return;
      if (error) { setErr(error.message); setRows([]); return; }
      const list = (data as NoCost[]) ?? [];
      const ids = [...new Set(list.map((o) => o.conversation_id).filter(Boolean))] as string[];
      const names: Record<string, string | null> = {};
      for (let i = 0; i < ids.length; i += 100) {
        const { data: cs } = await supabase.from("conversation_outcomes").select("id,contact_name").in("id", ids.slice(i, i + 100));
        (cs ?? []).forEach((c: any) => { names[c.id] = c.contact_name; });
      }
      if (live) setRows(list.map((o) => ({ ...o, name: o.conversation_id ? names[o.conversation_id] : null })));
    })();
    return () => { live = false; };
  }, [ws.id, tick]);
  useEffect(() => { const c = itemsCost(items); if (c != null) setCost(moneyText(c)); }, [items]);
  function start(o: NoCost) { setOpen(o.id); setItems([]); setCost(""); setErr(""); }
  async function save(o: NoCost) {
    const c = num(cost);
    if (c == null || !isFinite(c)) return setErr(T("Pick the products or type the cost.", "Chagua bidhaa au andika gharama."));
    setBusy(true); setErr("");
    const patch: Record<string, unknown> = { cost: c };
    if (items.length) { patch.items = items; patch.product = itemsLabel(items); }
    const { error } = await supabase.from("orders").update(patch).eq("id", o.id).eq("workspace_id", ws.id);
    setBusy(false);
    if (error) setErr(error.message); else { setOpen(null); setTick((t) => t + 1); }
  }
  if (!rows) return null;
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <section className="card" id="no-cost">
      <div className="row between">
        <div style={{ display: "grid", gap: 2 }}>
          <h2>{T("Sales with no cost yet", "Mauzo yasiyo na gharama")} {rows.length > 0 && <span className="chip">{rows.length}</span>}</h2>
          <span className="small muted">{rows.length === 0
            ? T("Every paid order has a cost. Your profit is exact.", "Kila oda iliyolipwa ina gharama. Faida yako ni kamili.")
            : ws.unit_cost != null
              ? T(`Until you fill these in, profit counts each at your default cost (${money(Number(ws.unit_cost), ws.currency)}).`, `Hadi uzijaze, faida inahesabu kila moja kwa gharama ya kawaida (${money(Number(ws.unit_cost), ws.currency)}).`)
              : T("Your profit can't be shown until these have a cost. Pick what was in each one.", "Faida haiwezi kuonyeshwa hadi hizi ziwe na gharama. Chagua kilichokuwa kwenye kila moja.")}</span>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="nc-list">
          {shown.map((o) => (
            <div key={o.id} className={"nc-row" + (open === o.id ? " open" : "")}>
              <div className="row between">
                <span><b>{o.name || T("Customer", "Mteja")}</b> <span className="small muted">· {o.paid_at ? when(o.paid_at) : "–"}</span></span>
                <span className="row" style={{ gap: 8 }}>
                  <b>{amt(orderNet(o), o.currency)} {o.currency}</b>
                  {o.conversation_id && <a className="small" href={"#chats/ids=" + o.conversation_id}>{T("Chat", "Chat")}</a>}
                  {editor && open !== o.id && <button className="small" onClick={() => start(o)}>{T("Add cost", "Weka gharama")}</button>}
                </span>
              </div>
              {open === o.id && (
                <div className="nc-edit">
                  <ProductPicker ws={ws} products={products} items={items} onChange={setItems} T={T} />
                  <div className="row" style={{ alignItems: "end" }}>
                    <label className="small" style={{ display: "grid", gap: 3 }}>{T("Cost of this order", "Gharama ya oda hii")} ({ws.currency})
                      <input inputMode="decimal" style={{ width: 160 }} value={cost} onChange={moneyInput(setCost)} placeholder={T("product + delivery", "bidhaa + usafiri")} /></label>
                    <button className="primary small" disabled={busy} onClick={() => save(o)}>{busy ? "…" : T("Save", "Hifadhi")}</button>
                    <button className="small" onClick={() => setOpen(null)}>{T("Cancel", "Ghairi")}</button>
                  </div>
                  {err && <span className="err small">{err}</span>}
                </div>
              )}
            </div>
          ))}
          {rows.length > 12 && <button className="small" onClick={() => setAll(!all)}>{all ? T("Show fewer", "Onyesha chache") : T(`Show all ${rows.length}`, `Onyesha zote ${rows.length}`)}</button>}
        </div>
      )}
    </section>
  );
}

type SaleRow = { id: string; paid_at: string | null; items: Item[] | null; product: string | null; amount: number; discount: number; refund_amount: number; currency: string };

/** An amount in the business currency (TZS↔USD with the stored rate), or null if it can't be converted. */
const toWs = (ws: Workspace, n: number, cur: string) => {
  if (!cur || cur === ws.currency) return n;
  const r = ws.fx_rate ? Number(ws.fx_rate) : 0;
  if (!r) return null;
  if (cur === "USD" && ws.currency === "TZS") return n * r;
  if (cur === "TZS" && ws.currency === "USD") return n / r;
  return null;
};
type Filter = "all" | "selling" | "hidden" | "needs";
type Order_ = "mine" | "best" | "profit" | "name";

/** Paid orders in the period, turned into what each product sold. Products picked on the order count
 *  exactly; orders with nothing picked but a product name (or other name) in their text are counted
 *  separately as "named", never mixed into the sold numbers.
 *  Sales = what the customer actually paid for the order (amount − discount − refund). When an order has
 *  several products the money is shared between them by their prices (or by quantity if a product has no
 *  price), so a business that doesn't keep fixed prices still sees its real sales. */
function useSold(ws: Workspace, products: Product[] | null, from: string, to: string) {
  const tz = ws.timezone || "Africa/Dar_es_Salaam";
  const [rows, setRows] = useKept<SaleRow[] | null>(`products-sold:${ws.id}:${from}:${to}`, null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    (async () => {
      // A day of slack on both ends, then keep only the local days in range (time zones).
      const lo = addDays(from, -1) + "T00:00:00Z", hi = addDays(to, 2) + "T00:00:00Z";
      const out: SaleRow[] = [];
      for (let off = 0; off < 20000; off += 1000) {
        const { data, error } = await supabase.from("orders").select("id,paid_at,items,product,amount,discount,refund_amount,currency")
          .eq("workspace_id", ws.id).eq("status", "paid").gte("paid_at", lo).lt("paid_at", hi).order("paid_at").range(off, off + 999);
        if (!live) return;
        if (error) { setErr(error.message); break; }
        out.push(...((data as SaleRow[]) ?? []));
        if ((data ?? []).length < 1000) break;
      }
      if (live) { setErr(""); setRows(out.filter((o) => o.paid_at && (() => { const d = localDay(o.paid_at!, tz); return d >= from && d <= to; })())); }
    })();
    return () => { live = false; };
  }, [ws.id, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const sold = useMemo(() => {
    const m = new Map<string, Sold>();
    if (!rows || !products) return { by: m, paid: 0, picked: 0 };
    const get = (id: string) => { let s = m.get(id); if (!s) m.set(id, (s = { units: 0, sales: 0, cost: 0, costKnown: true, orders: 0, named: 0 })); return s; };
    const byId = new Map(products.map((p) => [p.id, p]));
    const words = products.map((p) => ({ id: p.id, w: [p.name, ...p.aliases].map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3) }));
    let picked = 0;
    for (const o of rows) {
      const items = Array.isArray(o.items) ? o.items.filter((i) => i && i.product_id && byId.has(i.product_id)) : [];
      if (items.length) {
        picked++;
        const seen = new Set<string>();
        const lines = items.map((i) => { const p = byId.get(i.product_id!)!; return { p, q: Number(i.qty) || 1, price: i.unit_price ?? p.price, cost: i.unit_cost ?? p.cost }; });
        const paid = toWs(ws, orderNet(o), o.currency);
        const priced = lines.every((l) => l.price != null && Number(l.price) > 0);
        const weight = (l: (typeof lines)[number]) => (priced ? l.q * Number(l.price) : l.q);
        const total = lines.reduce((a, l) => a + weight(l), 0) || 1;
        for (const l of lines) {
          const s = get(l.p.id);
          s.units += l.q;
          s.sales += paid != null ? (paid * weight(l)) / total : l.q * Number(l.price ?? 0);
          if (l.cost == null) s.costKnown = false; else s.cost += l.q * Number(l.cost);
          if (!seen.has(l.p.id)) { s.orders++; seen.add(l.p.id); }
        }
      } else if (o.product) {
        const t = o.product.toLowerCase();
        for (const x of words) if (x.w.some((w) => t.includes(w))) get(x.id).named++;
      }
    }
    return { by: m, paid: rows.length, picked };
  }, [rows, products]);
  return { ...sold, loading: !rows, err };
}

/** Customer photos in this business's chats that itaOS matched to each product in the period
 *  (medium or high confidence). Matching only ever compares with this business's own products. */
function useSpotted(ws: Workspace, from: string, to: string) {
  const [by, setBy] = useKept<Record<string, number> | null>(`products-spotted:${ws.id}:${from}:${to}`, null);
  useEffect(() => {
    let live = true;
    supabase.from("messages").select("sent_at,pm:media->product_match").eq("workspace_id", ws.id).eq("direction", "in")
      .not("media->product_match", "is", null).gte("sent_at", addDays(from, -1) + "T00:00:00Z").lt("sent_at", addDays(to, 2) + "T00:00:00Z").limit(5000)
      .then(({ data }) => {
        if (!live) return;
        const tz = ws.timezone || "Africa/Dar_es_Salaam", out: Record<string, number> = {};
        for (const r of (data ?? []) as { sent_at: string; pm: ProductMatch | null }[]) {
          const d = localDay(r.sent_at, tz);
          if (d < from || d > to || !r.pm?.product_id || r.pm.confidence === "low") continue;
          out[r.pm.product_id] = (out[r.pm.product_id] ?? 0) + 1;
        }
        setBy(out);
      });
    return () => { live = false; };
  }, [ws.id, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  return by ?? {};
}

/** A KPI tile that counts up to its number, like the dashboard's. */
function Tile({ k, n, f, v, s, cls = "" }: { k: string; n: number | null; f: (x: number) => string; v?: string; s?: string; cls?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (n != null && isFinite(n)) countTo(ref.current, n, f, { duration: 1.1, delay: 0.25 }); else if (ref.current) ref.current.textContent = v ?? "–"; }, [n, v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={"kpi " + cls}>
      <span className="k"><span className="kt">{k}</span></span>
      <span className="kv"><span className="v" ref={ref}>{n != null ? f(n) : v ?? "–"}</span></span>
      {s && <span className="s" title={s}>{s}</span>}
    </div>
  );
}

export default function Products({ ws }: { ws: Workspace }) {
  const lang = ws.language; const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const tz = ws.timezone || "Africa/Dar_es_Salaam";
  const [tick, setTick] = useState(0);
  const { products: fresh, err } = useProducts(ws.id, tick);
  // Kept per business: coming back shows the list at once, and one business never sees another's.
  const [kept, setKept] = useKept<Product[] | null>("products:" + ws.id, null);
  useEffect(() => { if (fresh) setKept(fresh); }, [fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const products = fresh ?? kept;
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [order, setOrder] = useState<Order_>("mine");
  const [moving, setMoving] = useState(false);
  useEffect(() => { setEditing(null); setQ(""); setFilter("all"); }, [ws.id]);
  const editor = canEdit(ws);

  const today = localDay(new Date(), tz);
  const [range, setRangeState] = useState<RangeSel>(() => loadRange("products", { key: "last_30" }));
  const setRange = (r: RangeSel) => { setRangeState(r); saveRange("products", r); };
  // First paid sale of this business: turns on "All time" in the date picker.
  const [start, setStart] = useKept<string | null>("products-start:" + ws.id, null);
  useEffect(() => {
    supabase.from("orders").select("paid_at").eq("workspace_id", ws.id).eq("status", "paid").not("paid_at", "is", null).order("paid_at").limit(1)
      .then(({ data }) => { const d = (data as { paid_at: string }[] | null)?.[0]?.paid_at; setStart(d ? localDay(d, tz) : today); });
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const period = resolveRange(range, today, start);
  const sold = useSold(ws, products, period.from, period.to);
  const spotted = useSpotted(ws, period.from, period.to);
  const periodShort = range.key === "custom" ? rangeText(period, lang) : presetLabel(range.key, lang);

  const totals = useMemo(() => {
    let units = 0, sales = 0, cost = 0, costKnown = true;
    sold.by.forEach((s) => { units += s.units; sales += s.sales; cost += s.cost; if (!s.costKnown && s.units) costKnown = false; });
    return { units, sales, profit: costKnown ? sales - cost : null };
  }, [sold.by]);
  const list = products ?? [];
  const counts = useMemo(() => ({
    all: list.length, selling: list.filter((p) => p.active).length, hidden: list.filter((p) => !p.active).length,
    needs: list.filter((p) => p.cost == null || !p.photos.length).length,
    noCost: list.filter((p) => p.active && p.cost == null).length, noPhoto: list.filter((p) => p.active && !p.photos.length).length,
  }), [list]);
  const ranks = useMemo(() => {
    const r = new Map<string, number>();
    [...sold.by.entries()].filter(([, s]) => s.units > 0).sort((a, b) => b[1].sales - a[1].sales || b[1].units - a[1].units).slice(0, 3).forEach(([id], i) => r.set(id, i + 1));
    return r;
  }, [sold.by]);
  const best = useMemo(() => Math.max(0, ...[...sold.by.values()].map((s) => s.sales)), [sold.by]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    let xs = list.filter((p) => filter === "all" ? true : filter === "selling" ? p.active : filter === "hidden" ? !p.active : (p.cost == null || !p.photos.length));
    if (t) xs = xs.filter((p) => [p.name, ...p.aliases, p.notes ?? ""].some((x) => x.toLowerCase().includes(t)));
    const S = (p: Product) => sold.by.get(p.id);
    const profitOf = (p: Product) => { const s = S(p); return s && s.costKnown ? s.sales - s.cost : -Infinity; };
    if (order === "best") xs = [...xs].sort((a, b) => (S(b)?.sales ?? 0) - (S(a)?.sales ?? 0) || (S(b)?.units ?? 0) - (S(a)?.units ?? 0));
    else if (order === "profit") xs = [...xs].sort((a, b) => profitOf(b) - profitOf(a));
    else if (order === "name") xs = [...xs].sort((a, b) => a.name.localeCompare(b.name));
    else xs = [...xs].sort((a, b) => Number(b.active) - Number(a.active));
    return xs;
  }, [list, q, filter, order, sold.by]);
  const canReorder = editor && order === "mine" && !q.trim() && filter === "all";

  /** Swap a product with its neighbour and save the whole order (lists are small). */
  async function move(p: Product, dir: -1 | 1) {
    const xs = [...shown]; const i = xs.findIndex((x) => x.id === p.id), j = i + dir;
    if (i < 0 || j < 0 || j >= xs.length || xs[j].active !== p.active) return;
    [xs[i], xs[j]] = [xs[j], xs[i]];
    setMoving(true);
    setKept(xs.map((x, k) => ({ ...x, sort: k })));
    await Promise.all(xs.map((x, k) => (x.sort === k ? null : supabase.from("products").update({ sort: k }).eq("id", x.id).eq("workspace_id", ws.id))));
    setMoving(false); setTick((t) => t + 1);
  }

  const ready = !!products;
  const pageRef = usePageEnter<HTMLDivElement>((root) => {
    if (!ready) return;
    enterRows(select(root, ".hero > *"), { y: 10, stagger: 0.08 });
    enterCards(select(root, ".kpis > .kpi, :scope > .card, :scope > .finding"), { stagger: 0.06, delay: 0.1 });
    enterTiles(select(root, ".prod-grid > .card"), { delay: 0.2, stagger: 0.05 });
    growBars(select(root, ".prod-bar > i"), { axis: "x", delay: 0.55, stagger: 0.04 });
  }, [ready, period.from, period.to, filter, order]);
  const done = () => { setEditing(null); setTick((t) => t + 1); };
  const f = (x: number) => money(x, ws.currency);

  return (
    <div className="shell-grid products dash-ia" ref={pageRef}>
      <div className="hero">
        <div style={{ display: "grid", gap: 4 }}>
          <h2>{T("My products", "Bidhaa zangu")}</h2>
          <div className="sub"><span>{T(`What ${ws.name} sells, what each one costs you and what it sells for. Used to work out the profit on every sale.`, `Anachouza ${ws.name}, kila kimoja kinakugharimu kiasi gani na kinauzwa kwa bei gani. Inatumika kukokotoa faida ya kila mauzo.`)}</span></div>
        </div>
        <div className="row">
          {fresh == null && kept && <span className="small muted" aria-live="polite"><span className="kito-spin sm" aria-hidden /> {T("Updating…", "Inasasisha…")}</span>}
          <DateRange value={range} onChange={setRange} today={today} tz={tz} lang={lang} start={start} />
          {editor && editing !== "new" && list.length > 0 && <button className="primary" onClick={() => setEditing("new")}>+ {T("Add product", "Ongeza bidhaa")}</button>}
        </div>
      </div>
      {err && <div className="card"><span className="err">{err}</span></div>}
      {sold.err && <div className="finding bad small">{sold.err}</div>}

      {!products ? (
        <div className="skeletons" aria-busy="true" aria-label="Loading">
          <div className="kpis">{[0, 1, 2, 3].map((i) => <div className="skeleton" key={i} />)}</div>
          <div className="prod-grid">{[0, 1, 2].map((i) => <div className="skeleton" key={i} style={{ minHeight: 320 }} />)}</div>
        </div>
      ) : (<>
        {list.length > 0 && (
          <div className="kpis prod-kpis">
            <Tile k={T("Selling now", "Zinauzwa sasa")} n={counts.selling} f={(x) => String(Math.round(x))} s={counts.hidden ? T(`${counts.hidden} hidden`, `${counts.hidden} zimefichwa`) : T(`of ${counts.all} products`, `kati ya bidhaa ${counts.all}`)} />
            <Tile k={T("Units sold", "Vipande vilivyouzwa")} n={sold.loading ? null : totals.units} v={sold.loading ? "…" : undefined} f={(x) => fmt(x)} s={sold.loading ? periodShort : T(`${periodShort} · on ${sold.picked} of ${sold.paid} paid orders`, `${periodShort} · kwenye oda ${sold.picked} kati ya ${sold.paid} zilizolipwa`)} />
            <Tile k={T("Sales from products", "Mauzo ya bidhaa")} n={sold.loading ? null : totals.sales} v={sold.loading ? "…" : undefined} f={f} s={T("What customers paid for these products", "Walicholipa wateja kwa bidhaa hizi")} cls="ok" />
            <Tile k={T("Profit from products", "Faida ya bidhaa")} n={sold.loading ? null : totals.profit} v={sold.loading ? "…" : totals.profit == null ? T("Needs costs", "Inahitaji gharama") : undefined} f={f}
              s={totals.profit == null ? T("Some products sold have no cost yet", "Baadhi ya bidhaa zilizouzwa hazina gharama") : totals.sales > 0 ? T(`${pctOf(totals.profit, totals.sales)}% of sales, before ads`, `${pctOf(totals.profit, totals.sales)}% ya mauzo, kabla ya matangazo`) : T("Before ad spend", "Kabla ya matangazo")}
              cls={totals.profit == null ? "warn" : totals.profit < 0 ? "bad" : ""} />
          </div>
        )}
        {editor && (counts.noCost > 0 || counts.noPhoto > 0) && (
          <div className="finding warn prod-todo">
            <b>{T("To finish setting up", "Kumalizia kuweka")}</b>
            <span className="small">
              {counts.noCost > 0 && <button type="button" className="linkish small" onClick={() => { setFilter("needs"); setOrder("mine"); }}>{T(`${counts.noCost} without a cost`, `${counts.noCost} bila gharama`)}</button>}
              {counts.noCost > 0 && counts.noPhoto > 0 && " · "}
              {counts.noPhoto > 0 && <button type="button" className="linkish small" onClick={() => { setFilter("needs"); setOrder("mine"); }}>{T(`${counts.noPhoto} without photos`, `${counts.noPhoto} bila picha`)}</button>}
              <span className="muted"> — {T("costs make the profit exact; photos let itaOS recognise a product a customer sends.", "gharama zinafanya faida iwe kamili; picha zinaisaidia itaOS kutambua bidhaa mteja anayotuma.")}</span>
            </span>
          </div>
        )}
        {editing === "new" && <ProductForm ws={ws} p={null} onDone={done} onCancel={() => setEditing(null)} T={T} />}
        {list.length === 0 && editing !== "new" && (
          <div className="card prod-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8" /></svg>
            <b>{T(`No products for ${ws.name} yet`, `Bado hakuna bidhaa za ${ws.name}`)}</b>
            <span className="small muted">{T("Add what you sell with what one costs you. When you record a sale you just tap what the customer bought, and the cost and profit fill in by themselves.", "Ongeza unachouza pamoja na gharama ya kimoja. Ukirekodi mauzo unagusa tu alichonunua mteja, na gharama na faida zinajaa zenyewe.")}</span>
            <ol className="prod-steps small">
              <li>{T("Name, selling price and what one costs you", "Jina, bei ya kuuza na gharama ya kimoja")}</li>
              <li>{T("Other names customers use in chats", "Majina mengine wanayotumia wateja kwenye chats")}</li>
              <li>{T("3–4 photos", "Picha 3–4")}</li>
            </ol>
            {editor && <button className="primary" onClick={() => setEditing("new")}>+ {T("Add your first product", "Ongeza bidhaa yako ya kwanza")}</button>}
          </div>
        )}
        {list.length > 0 && (
          <div className="prod-tools">
            <label className="prod-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T("Search name or other name", "Tafuta jina au jina jingine")} aria-label={T("Search products", "Tafuta bidhaa")} />
            </label>
            <div className="seg" role="radiogroup" aria-label={T("Show", "Onyesha")}>
              {([["all", T("All", "Zote"), counts.all], ["selling", T("Selling", "Zinauzwa"), counts.selling], ["hidden", T("Hidden", "Zimefichwa"), counts.hidden], ["needs", T("Needs info", "Zinahitaji taarifa"), counts.needs]] as [Filter, string, number][])
                .filter(([k, , n]) => k === "all" || n > 0 || filter === k)
                .map(([k, label, n]) => <button key={k} type="button" role="radio" aria-checked={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label} <span className="muted">{n}</span></button>)}
            </div>
            <label className="prod-sort small">{T("Sort", "Panga")}
              <select value={order} onChange={(e) => setOrder(e.target.value as Order_)}>
                <option value="mine">{T("Your order", "Mpangilio wako")}</option>
                <option value="best">{T("Best sellers", "Zinazouzwa zaidi")}</option>
                <option value="profit">{T("Most profit", "Faida zaidi")}</option>
                <option value="name">{T("Name A–Z", "Jina A–Z")}</option>
              </select>
            </label>
          </div>
        )}
        {list.length > 0 && shown.length === 0 && <div className="empty">{q ? T(`Nothing matches “${q}”.`, `Hakuna kinacholingana na “${q}”.`) : T("Nothing here.", "Hakuna kitu hapa.")}</div>}
        {shown.length > 0 && (
          <div className="prod-grid">
            {shown.map((p, i) => editing && editing !== "new" && editing.id === p.id
              ? <ProductForm key={p.id} ws={ws} p={p} onDone={done} onCancel={() => setEditing(null)} T={T} />
              : <ProductCard key={p.id} ws={ws} p={p} editor={editor} sold={sold.by.get(p.id)} spotted={spotted[p.id] ?? 0} best={best} rank={ranks.get(p.id) ?? null} period={periodShort}
                  canMove={canReorder && !moving ? { up: i > 0 && shown[i - 1].active === p.active, down: i < shown.length - 1 && shown[i + 1].active === p.active } : null}
                  onMove={(d) => move(p, d)} onEdit={() => setEditing(p)} onChange={() => setTick((t) => t + 1)} T={T} />)}
          </div>
        )}
        <MissingCosts ws={ws} products={list} editor={editor} T={T} />
      </>)}
    </div>
  );
}
/** What itaOS thinks is in a customer's photo (saved by the product-match function). A suggestion only. */
export type ProductMatch = {
  product_id: string | null; name: string | null; confidence: "high" | "medium" | "low";
  alternatives: { product_id: string; name: string }[]; is_product_photo: boolean; notes: string | null; checked_at: string;
};
const ready: Record<string, Promise<boolean>> = {};
/** Does this business have at least one active product with photos? (Cached per page load.) */
/** Call after products or their photos change, so open chats start matching photos without a reload. */
export function forgetPhotosReady(wsId: string) { delete ready[wsId]; }
export function productPhotosReady(wsId: string): Promise<boolean> {
  return (ready[wsId] ??= Promise.resolve(supabase.from("products").select("id", { count: "exact", head: true }).eq("workspace_id", wsId).eq("active", true).neq("photos", "{}"))
    .then(({ count }) => (count ?? 0) > 0, () => false));
}
/** Items to pre-pick from photos in a chat that itaOS matched with good confidence. */
export function itemsFromMatches(matches: ProductMatch[], products: Product[]): Item[] {
  const out: Item[] = [];
  for (const m of matches) {
    if (!m.product_id || m.confidence === "low" || out.some((x) => x.product_id === m.product_id)) continue;
    const p = products.find((x) => x.id === m.product_id && x.active);
    if (p) out.push({ product_id: p.id, name: p.name, qty: 1, unit_cost: p.cost != null ? Number(p.cost) : null, unit_price: p.price != null ? Number(p.price) : null });
  }
  return out;
}
