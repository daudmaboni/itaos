// My products: what the business sells (name, other names, selling price, cost per unit, photos),
// plus the paid orders that still have no cost, so the owner can say what was in them.
// The cost of an order = Σ qty × unit cost of the products picked. It is filled in, never forced:
// the owner can still type a different number. Nothing is assumed for a new business.
import { useEffect, useMemo, useState } from "react";
import { enterCards, usePageEnter, select } from "./motion";
import { supabase, Workspace, amt, money, when, orderNet, canEdit, moneyInput, moneyText } from "./lib";

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

function ProductForm({ ws, p, onDone, onCancel, T }: { ws: Workspace; p: Product | null; onDone: () => void; onCancel: () => void; T: (en: string, sw: string) => string }) {
  const [name, setName] = useState(p?.name ?? "");
  const [aliases, setAliases] = useState((p?.aliases ?? []).join(", "));
  const [price, setPrice] = useState(moneyText(p?.price));
  const [cost, setCost] = useState(moneyText(p?.cost));
  const [notes, setNotes] = useState(p?.notes ?? "");
  const [photos, setPhotos] = useState<string[]>(p?.photos ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const urls = usePhotoUrls(photos);
  const id = useMemo(() => p?.id ?? crypto.randomUUID(), [p?.id]);

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
    if (error) setErr(error.code === "23505" ? T("You already have a product with this name.", "Tayari una bidhaa yenye jina hili.") : error.message);
    else onDone();
  }
  const margin = num(price) != null && num(cost) != null ? Number(num(price)) - Number(num(cost)) : null;
  return (
    <form className="card prod-form" onSubmit={save}>
      <b>{p ? T(`Edit ${p.name}`, `Hariri ${p.name}`) : T("Add a product", "Ongeza bidhaa")}</b>
      <div className="map">
        <label>{T("Name", "Jina")}<input required value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={T("e.g. Body lotion 200ml", "mf. Losheni 200ml")} /></label>
        <label>{T("Selling price", "Bei ya kuuza")} ({ws.currency})<input inputMode="decimal" value={price} onChange={moneyInput(setPrice)} placeholder={T("what customers pay", "anacholipa mteja")} /></label>
        <label>{T("What one costs you", "Gharama ya moja kwako")} ({ws.currency})<input inputMode="decimal" value={cost} onChange={moneyInput(setCost)} placeholder={T("product + delivery", "bidhaa + usafiri")} />
          {margin != null && <span className={"small " + (margin >= 0 ? "muted" : "err")}>{T("Profit per unit", "Faida kwa kimoja")}: {money(margin, ws.currency)}</span>}</label>
        <label style={{ gridColumn: "1 / -1" }}>{T("Other names customers use (comma separated)", "Majina mengine wanayotumia wateja (tenganisha kwa koma)")}<input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder={T("kaya power, dawa ya nguvu", "kaya power, dawa ya nguvu")} /></label>
        <label style={{ gridColumn: "1 / -1" }}>{T("Note (optional)", "Maelezo (si lazima)")}<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={T("size, pack, how it's used…", "ukubwa, pakiti, matumizi…")} /></label>
      </div>
      <div className="prod-photos">
        {photos.map((ph) => (
          <span key={ph} className="prod-ph">
            {urls[ph] ? <img src={urls[ph]} alt="" /> : <span className="prod-ph-empty" />}
            <button type="button" aria-label={T("Remove photo", "Ondoa picha")} onClick={() => removePhoto(ph)}>×</button>
          </span>
        ))}
        {photos.length < 6 && (
          <label className="prod-ph prod-add">
            <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => { upload(e.target.files); e.currentTarget.value = ""; }} />
            <span>+ {T("Photo", "Picha")}</span>
          </label>
        )}
      </div>
      <span className="small muted">{T("Add 3–4 clear photos: the front with the label, the back, and one taken on a phone like customers do. Later itaOS will use them to recognise the product when a customer sends a photo.", "Weka picha 3–4 zinazoonekana vizuri: mbele na lebo, nyuma, na moja iliyopigwa kwa simu kama wateja wanavyopiga. Baadaye itaOS itazitumia kutambua bidhaa mteja akituma picha.")}</span>
      {err && <span className="err small">{err}</span>}
      <div className="row"><button className="primary small" disabled={busy}>{busy ? "…" : T("Save product", "Hifadhi bidhaa")}</button><button type="button" className="small" onClick={onCancel}>{T("Cancel", "Ghairi")}</button></div>
    </form>
  );
}

function ProductCard({ ws, p, editor, onEdit, onChange, T }: { ws: Workspace; p: Product; editor: boolean; onEdit: () => void; onChange: () => void; T: (en: string, sw: string) => string }) {
  const urls = usePhotoUrls(p.photos);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const margin = p.price != null && p.cost != null ? Number(p.price) - Number(p.cost) : null;
  async function toggle() {
    setBusy(true);
    const { error } = await supabase.from("products").update({ active: !p.active }).eq("id", p.id).eq("workspace_id", ws.id);
    setBusy(false); if (error) setErr(error.message); else onChange();
  }
  async function remove() {
    if (!confirm(T(`Delete ${p.name}? Orders that already used it keep their cost.`, `Futa ${p.name}? Oda zilizokwisha itumia zinabaki na gharama yake.`))) return;
    setBusy(true);
    if (p.photos.length) await supabase.storage.from("product-photos").remove(p.photos);
    const { error } = await supabase.from("products").delete().eq("id", p.id).eq("workspace_id", ws.id);
    setBusy(false); if (error) setErr(error.message); else onChange();
  }
  return (
    <div className={"card prod-card" + (p.active ? "" : " off")}>
      <div className="prod-thumbs">
        {p.photos.length ? p.photos.slice(0, 3).map((ph) => (urls[ph] ? <img key={ph} src={urls[ph]} alt={p.name} /> : <span key={ph} className="prod-ph-empty" />))
          : <span className="prod-nophoto small muted">{T("No photos yet", "Bado hakuna picha")}</span>}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div className="row between"><h3>{p.name}</h3>{!p.active && <span className="chip">{T("Hidden", "Imefichwa")}</span>}</div>
        {p.aliases.length > 0 && <div>{p.aliases.map((a) => <span key={a} className="chip">{a}</span>)}</div>}
        <div className="prod-nums">
          <span><span className="small muted">{T("Sells for", "Inauzwa")}</span><b>{p.price != null ? money(Number(p.price), ws.currency) : "–"}</b></span>
          <span><span className="small muted">{T("Costs you", "Inakugharimu")}</span><b>{p.cost != null ? money(Number(p.cost), ws.currency) : "–"}</b></span>
          <span><span className="small muted">{T("Profit each", "Faida kila moja")}</span><b className={margin != null && margin < 0 ? "err" : ""}>{margin != null ? money(margin, ws.currency) : "–"}</b></span>
        </div>
        {p.notes && <span className="small muted">{p.notes}</span>}
        {err && <span className="err small">{err}</span>}
        {editor && (
          <div className="row" style={{ gap: 6 }}>
            <button className="small" onClick={onEdit}>{T("Edit", "Hariri")}</button>
            <button className="small" disabled={busy} onClick={toggle}>{p.active ? T("Hide", "Ficha") : T("Show", "Onyesha")}</button>
            <button className="small" disabled={busy} onClick={remove}>{T("Delete", "Futa")}</button>
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

export default function Products({ ws }: { ws: Workspace }) {
  const lang = ws.language; const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const [tick, setTick] = useState(0);
  const { products, err } = useProducts(ws.id, tick);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const editor = canEdit(ws);
  const pageRef = usePageEnter<HTMLDivElement>((root) => { if (products) enterCards(select(root, ":scope > .card, .hero"), { stagger: 0.05 }); }, [!!products]);
  const done = () => { setEditing(null); setTick((t) => t + 1); };
  return (
    <div className="shell-grid products" ref={pageRef}>
      <div className="hero">
        <div style={{ display: "grid", gap: 4 }}>
          <h2>{T("My products", "Bidhaa zangu")}</h2>
          <div className="sub"><span>{T("What you sell, what it costs you and what it sells for. Used to work out your profit on every sale.", "Unachouza, kinakugharimu kiasi gani na unakiuza kwa bei gani. Inatumika kukokotoa faida ya kila mauzo.")}</span></div>
        </div>
        {editor && !editing && <button className="primary" onClick={() => setEditing("new")}>+ {T("Add product", "Ongeza bidhaa")}</button>}
      </div>
      {err && <div className="card"><span className="err">{err}</span></div>}
      {editing === "new" && <ProductForm ws={ws} p={null} onDone={done} onCancel={() => setEditing(null)} T={T} />}
      {products && products.length === 0 && editing !== "new" && (
        <div className="card"><b>{T("No products yet", "Bado hakuna bidhaa")}</b>
          <span className="small muted">{T("Add what you sell with what one costs you. When you record a sale you just tap what the customer bought, and the cost and profit fill in by themselves.", "Ongeza unachouza pamoja na gharama ya kimoja. Ukirekodi mauzo unagusa tu alichonunua mteja, na gharama na faida zinajaa zenyewe.")}</span></div>
      )}
      {products && products.length > 0 && (
        <div className="prod-grid">
          {products.map((p) => editing && editing !== "new" && editing.id === p.id
            ? <ProductForm key={p.id} ws={ws} p={p} onDone={done} onCancel={() => setEditing(null)} T={T} />
            : <ProductCard key={p.id} ws={ws} p={p} editor={editor} onEdit={() => setEditing(p)} onChange={() => setTick((t) => t + 1)} T={T} />)}
        </div>
      )}
      {products && <MissingCosts ws={ws} products={products} editor={editor} T={T} />}
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
