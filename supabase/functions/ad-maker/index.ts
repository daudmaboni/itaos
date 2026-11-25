// Auto ads (25 Nov 2026). itaOS is the interface; Claude writes the words; Meta gets a PAUSED copy.
//
//   draft    Claude writes new text for a click-to-WhatsApp ad from the business's best ad
//            (its words, what customers ask in the chats it brought, the products). Saved as a draft.
//   save     Owner edits the text. If the ad already exists (paused) in Meta, its text is swapped too.
//   create   Copies the best ad's campaign + ad set (audience, budget, WhatsApp destination) as PAUSED,
//            reuses its photo/video, and adds a new ad with the new words. Nothing spends money.
//   turn_on  Owner said yes: campaign, ad set and ad go ACTIVE. Meta then reviews the ad.
//   pause    Stops it again.
//   delete   Deletes the new campaign in Meta (and everything in it). The draft is kept as "deleted".
//   refresh  Reads Meta's status (in review, rejected, running) for the business's drafts.
//   from_post Draft that runs one of the business's own Facebook/Instagram posts (Posts page), with the best
//            ad's audience, budget and WhatsApp destination. create then uses the post itself (or a copy).
//
// Nothing here guesses Meta IDs: the page, WhatsApp destination and media come from the copied ad.
import { admin, userClient, readToken, json, cors, GRAPH } from "../_shared/db.ts";

/** Graph call that keeps Meta's own explanation (error_user_title / error_user_msg) and names the step. */
let step = "";
async function graph(path: string, token: string, init: RequestInit = {}) {
  const url = path.startsWith("http") ? path : `${GRAPH}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.error) {
    const e = b.error ?? {};
    const human = [e.error_user_title, e.error_user_msg].filter(Boolean).join(": ");
    console.error("ad-maker graph", step, path.split("?")[0], JSON.stringify(e).slice(0, 800));
    throw new Error(`${step ? step + ": " : ""}${human || e.message || "Meta request failed"} (code ${e.code ?? "?"}${e.error_subcode ? "/" + e.error_subcode : ""})`);
  }
  return b;
}
import { claude } from "../_shared/claude.ts";
import { policyWarnings } from "./policy.ts";

const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("AD_WRITER_MODEL") ?? "claude-sonnet-5-5";
const NEED_PERMS = ["ads_management"];
const WA_CTA = { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } };

type Db = ReturnType<typeof admin>;

async function adsConnection(db: Db, ws: string) {
  const { data } = await db.from("connections").select("*").eq("workspace_id", ws).eq("provider", "meta_ads").in("status", ["active", "error"]).order("created_at").limit(1).maybeSingle();
  if (!data) throw new Error("Connect your Meta ad account first (Connections).");
  return { conn: data, token: await readToken(db, data.token_secret_id) };
}

/** True when the saved Meta login may create ads. */
async function canWrite(token: string) {
  const p = await graph("me/permissions", token);
  const granted = new Set((p.data ?? []).filter((x: any) => x.status === "granted").map((x: any) => x.permission));
  return NEED_PERMS.every((x) => granted.has(x));
}

async function post(path: string, token: string, body: Record<string, unknown>) {
  return graph(path, token, { method: "POST", body: JSON.stringify(body) });
}

/** The ad being copied, with what is needed to rebuild it. */
async function sourceAd(token: string, adId: string) {
  const ad = await graph(`${adId}?fields=name,adset_id,campaign_id,account_id,creative{body,title,object_story_spec,object_story_id,effective_object_story_id,video_id,image_hash,image_url,thumbnail_url,object_type}`, token);
  const adset = await graph(`${ad.adset_id}?fields=promoted_object,destination_type,daily_budget`, token);
  const camp = await graph(`${ad.campaign_id}?fields=daily_budget,objective`, token);
  return { ad, adset, camp };
}

function pageIdOf(src: Awaited<ReturnType<typeof sourceAd>>) {
  return src.adset.promoted_object?.page_id ?? src.ad.creative?.object_story_spec?.page_id ?? null;
}

/** Media of the copied ad as something a new creative can use. Photos are re-uploaded into the account's image library. */
async function mediaOf(token: string, account: string, cr: any): Promise<{ video_id?: string; image_hash?: string; thumb?: string }> {
  const spec = cr?.object_story_spec ?? {};
  const video = cr?.video_id ?? spec.video_data?.video_id;
  if (video) {
    let thumb = spec.video_data?.image_url ?? cr?.thumbnail_url;
    if (!thumb) thumb = (await graph(`${video}?fields=picture`, token).catch(() => ({})))?.picture;
    return { video_id: String(video), thumb };
  }
  const hash = cr?.image_hash ?? spec.link_data?.image_hash ?? spec.photo_data?.image_hash;
  if (hash) return { image_hash: hash, thumb: cr?.image_url ?? cr?.thumbnail_url };
  const url = cr?.image_url ?? spec.link_data?.picture ?? spec.photo_data?.url ?? cr?.thumbnail_url;
  if (!url) throw new Error("Couldn't find the photo or video of the ad being copied.");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't download the photo of the ad being copied.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const up = await post(`${account}/adimages`, token, { bytes: btoa(bin) });
  const first: any = Object.values(up.images ?? {})[0];
  if (!first?.hash) throw new Error("Meta didn't accept the photo upload.");
  return { image_hash: first.hash, thumb: url };
}

/** Preview picture of the copied ad, without uploading anything (used for drafts). */
function thumbOf(cr: any): string | null {
  const spec = cr?.object_story_spec ?? {};
  return cr?.thumbnail_url ?? cr?.image_url ?? spec.video_data?.image_url ?? spec.link_data?.picture ?? null;
}

/** Ready-made first message the customer sends (the business's own "from an ad" text, else a plain one). */
async function autofillOf(db: Db, ws: string) {
  const { data } = await db.from("workspaces").select("rule_ad_texts,language").eq("id", ws).single();
  return (data?.rule_ad_texts ?? [])[0] ?? (data?.language === "en" ? "Hello, I'd like more details" : "Habari, naomba maelezo zaidi");
}

/** Meta budgets are in the currency's smallest unit; these currencies have none. */
const NO_CENTS = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);

/**
 * New PAUSED ad set in `campaignId` with the source ad set's settings (audience, placements, goal, WhatsApp destination).
 * Built field by field rather than with /copies, so settings Meta no longer accepts (an old attribution window,
 * read-only targeting fields) can be dropped and retried instead of failing the whole ad.
 */
async function copyAdSet(token: string, account: string, adsetId: string, campaignId: string): Promise<string> {
  const a = await graph(`${adsetId}?fields=name,optimization_goal,billing_event,destination_type,promoted_object,targeting,bid_strategy,bid_amount,daily_budget,lifetime_budget,attribution_spec,is_dynamic_creative`, token);
  const targeting = { ...(a.targeting ?? {}) };
  delete targeting.age_range; // read-only echo of age_min/age_max
  const body: Record<string, unknown> = {
    name: `${a.name ?? "Ad set"} - itaOS`, campaign_id: campaignId, status: "PAUSED",
    optimization_goal: a.optimization_goal, billing_event: a.billing_event, destination_type: a.destination_type,
    promoted_object: a.promoted_object, targeting,
  };
  if (a.bid_strategy) body.bid_strategy = a.bid_strategy;
  if (a.bid_amount) body.bid_amount = a.bid_amount;
  if (Number(a.daily_budget) > 0) body.daily_budget = a.daily_budget;          // only when the budget sits on the ad set
  if (Number(a.lifetime_budget) > 0) body.lifetime_budget = a.lifetime_budget;
  if (a.is_dynamic_creative) body.is_dynamic_creative = true;
  if (a.attribution_spec) body.attribution_spec = a.attribution_spec;
  if (body.promoted_object && typeof body.promoted_object === "object") delete (body.promoted_object as any).smart_pse_enabled;
  // Meta drops options over time; each retry removes one optional setting it complained about.
  for (let i = 0; i < 4; i++) {
    try { return (await post(`${account}/adsets`, token, body)).id as string; }
    catch (e) {
      const m = (e as Error).message;
      if (/attribution/i.test(m) && body.attribution_spec) { delete body.attribution_spec; continue; }
      if (/smart_pse|promoted_object/i.test(m) && (body.promoted_object as any)?.smart_pse_enabled !== undefined) { delete (body.promoted_object as any).smart_pse_enabled; continue; }
      if (/bid/i.test(m) && (body.bid_amount || body.bid_strategy)) { delete body.bid_amount; delete body.bid_strategy; continue; }
      throw e;
    }
  }
  throw new Error("Meta kept refusing the ad set settings.");
}

/** Text of the Page post an ad was made from. Tries the user's login, then the Page's own token. */
async function postText(token: string, storyId: string, pageId: string | null): Promise<string | null> {
  const read = async (t: string) => (await graph(`${storyId}?fields=message`, t))?.message ?? null;
  try { return await read(token); } catch { /* fall through */ }
  if (!pageId) return null;
  try {
    const pt = (await graph(`${pageId}?fields=access_token`, token))?.access_token;
    return pt ? await read(pt) : null;
  } catch { return null; }
}

/** Language the CUSTOMERS write in (the owner's app language can differ). */
const SW = /\b(habari|naomba|nataka|bei|ngapi|mnapatikana|wapi|karibu|sawa|asante|mambo|shikamoo|naweza|kupata|dawa|bidhaa|hii|hiyo|nini|je)\b/i;
function customerLanguage(firsts: string[], fallback: string) {
  if (!firsts.length) return fallback;
  const sw = firsts.filter((f) => SW.test(f)).length;
  return sw / firsts.length >= 0.3 ? "Swahili" : "English";
}

/** Meta's click-to-WhatsApp greeting format: the business's greeting plus a ready-made first message. */
function welcome(greeting: string, autofill: string) {
  return JSON.stringify({
    type: "VISUAL_EDITOR", version: 2, landing_screen_type: "welcome_message", media_type: "text",
    text_format: { customer_action_type: "autofill_message", message: { text: greeting, autofill_message: { content: autofill } } },
  });
}

/** New creative with the draft's words on the copied ad's media. Retries without the greeting if Meta refuses that part. */
async function makeCreative(token: string, account: string, pageId: string, media: Awaited<ReturnType<typeof mediaOf>>, d: any, autofill: string) {
  const build = (withGreeting: boolean) => {
    const extra = withGreeting && d.greeting ? { page_welcome_message: welcome(d.greeting, autofill) } : {};
    const story = media.video_id
      ? { page_id: pageId, video_data: { video_id: media.video_id, message: d.primary_text, title: d.headline ?? undefined, image_url: media.thumb, call_to_action: WA_CTA, ...extra } }
      : { page_id: pageId, link_data: { image_hash: media.image_hash, message: d.primary_text, name: d.headline ?? undefined, link: "https://api.whatsapp.com/send", call_to_action: WA_CTA, ...extra } };
    return { name: `itaOS · ${d.headline ?? "new ad"} · ${new Date().toISOString().slice(0, 10)}`, object_story_spec: story };
  };
  try {
    return { id: (await post(`${account}/adcreatives`, token, build(true))).id as string, greetingDropped: false };
  } catch (e) {
    if (!d.greeting || !/welcome|page_welcome_message|code 100\b/i.test((e as Error).message)) throw e;
    return { id: (await post(`${account}/adcreatives`, token, build(false))).id as string, greetingDropped: true };
  }
}

// ---------- ads from an existing post ----------

/** The Page's own token (some Page posts and videos can only be read with it). */
async function pageToken(token: string, pageId: string): Promise<string> {
  try { return (await graph(`${pageId}?fields=access_token`, token))?.access_token ?? token; } catch { return token; }
}

/**
 * Creative that runs the business's own post. First the post itself with a WhatsApp button (likes and comments
 * stay on it). If Meta won't run that post that way, a copy: same picture or video and the same words.
 */
async function postCreative(db: Db, ws: string, token: string, account: string, pageId: string, d: any): Promise<{ id: string; mode: "as_is" | "copy"; why?: string }> {
  const { data: p } = await db.from("social_posts").select("*").eq("workspace_id", ws).eq("id", d.source_post_id).maybeSingle();
  if (!p) throw new Error("This post isn't in itaOS any more. Open Posts to refresh it.");
  const { data: w } = await db.from("workspaces").select("social_ig_id").eq("id", ws).single();
  const name = `itaOS · post · ${new Date().toISOString().slice(0, 10)}`;
  const tries: Record<string, unknown>[] = p.platform === "facebook"
    ? [{ name, object_story_id: p.id, call_to_action: WA_CTA }]
    : [
        { name, object_id: pageId, instagram_user_id: w?.social_ig_id, source_instagram_media_id: p.id, call_to_action: WA_CTA },
        { name, object_id: pageId, instagram_actor_id: w?.social_ig_id, source_instagram_media_id: p.id, call_to_action: WA_CTA },
      ];
  let why = "";
  for (const b of tries) {
    try { return { id: (await post(`${account}/adcreatives`, token, b)).id as string, mode: "as_is" }; }
    catch (e) { why = (e as Error).message; }
  }
  // A copy of the post on the same picture/video.
  let cr: any;
  if (p.platform === "facebook") {
    const pt = await pageToken(token, pageId);
    const full = await graph(`${p.id}?fields=full_picture,attachments{media_type,target{id}}`, pt).catch(() => ({}));
    const at = full?.attachments?.data?.[0];
    if (at && /video/i.test(at.media_type ?? "") && at.target?.id) cr = { video_id: at.target.id, thumbnail_url: full.full_picture ?? p.media_url };
    else cr = { image_url: full?.full_picture ?? p.media_url };
  } else {
    if (/video|reel/i.test(p.media_type ?? "")) throw new Error(`Meta wouldn't run this Instagram video as an ad with a WhatsApp button (${why}). Try a photo post, or the same video posted on Facebook.`);
    cr = { image_url: p.media_url };
  }
  if (!cr.video_id && !cr.image_url) throw new Error(`Meta wouldn't run this post as it is (${why}), and it has no picture to copy.`);
  step = "Copying the post's picture or video";
  const media = await mediaOf(token, account, cr);
  const c = await makeCreative(token, account, pageId, media, { primary_text: p.caption ?? "", headline: null, greeting: null }, "");
  return { id: c.id, mode: "copy", why };
}

/** Best ad = most paid sales in the last 60 days, then most revenue (same numbers as Ad money). */
async function bestAdId(uc: ReturnType<typeof userClient>, ws: string): Promise<string | null> {
  const { data: m, error } = await uc.rpc("ad_money", { p_ws: ws, p_days: 60 });
  if (error) throw new Error(error.message);
  const best = ((m as any)?.ads ?? []).filter((a: any) => Number(a.sales) > 0)
    .sort((a: any, b: any) => Number(b.sales) - Number(a.sales) || Number(b.revenue) - Number(a.revenue))[0];
  return best ? String(best.ad_id) : null;
}

// ---------- writing ----------

const SYSTEM = `You write Facebook/Instagram click-to-WhatsApp ads for a small Tanzanian business. The ad's button opens WhatsApp.
Rules you never break (Meta advertising policy):
- Never say or hint that a product treats, cures, heals, prevents or removes any illness. No disease names. No "dawa".
- Never ask the reader about their own body or health ("Je, una…?", "Unasumbuliwa na…?"). Talk about the product, not the reader's problems.
- No guarantees, no "100%", no "results in X days", no before/after, no sexual wording, no fake testimonials, no doctor claims.
- Prices only if given in the facts. Never invent facts, offers, prices or delivery promises.
Style: write in the language given (it is the language the customers write in). For Swahili, write like a real Dar es Salaam business owner talks on WhatsApp: short, warm, natural, not a translation, no stiff formal words. One or two emojis at most.
Shape: primary text 2–4 short lines ending with a clear "tap to chat on WhatsApp" style line; headline under 40 characters; greeting = the first WhatsApp message the customer sees from the business (under 120 characters, friendly, invites them to ask).`;

const TOOL = {
  name: "save_ads", description: "Save three different ad versions.",
  input_schema: {
    type: "object", required: ["ads"],
    properties: {
      ads: {
        type: "array", minItems: 3, maxItems: 3, items: {
          type: "object", required: ["primary_text", "headline", "greeting", "angle"],
          properties: {
            primary_text: { type: "string" }, headline: { type: "string" }, greeting: { type: "string" },
            angle: { type: "string", description: "One short line in English: what this version leans on." },
          },
        },
      },
    },
  },
};

async function facts(db: Db, ws: string, adId: string, adName: string | null, srcText: string | null, product: string | null) {
  const { data: w } = await db.from("workspaces").select("name,language,brand_town,currency").eq("id", ws).single();
  const { data: prods } = await db.from("products").select("name,price,notes").eq("workspace_id", ws).eq("active", true).order("sort").limit(12);
  // What customers from this ad actually ask: their first messages and the objections Kito found.
  const { data: convs } = await db.from("conversations").select("id,kito_objections,paid_orders").eq("workspace_id", ws).eq("ad_id", adId).order("started_at", { ascending: false }).limit(60);
  const ids = (convs ?? []).map((c: any) => c.id);
  const firsts: string[] = [];
  if (ids.length) {
    const { data: msgs } = await db.from("messages").select("conversation_id,body,sent_at").in("conversation_id", ids).eq("direction", "in").not("body", "is", null).order("sent_at").limit(600);
    const seen = new Set<string>();
    for (const m of msgs ?? []) {
      if (seen.has(m.conversation_id)) continue;
      seen.add(m.conversation_id);
      const b = String(m.body).trim().slice(0, 120);
      if (b) firsts.push(b);
    }
  }
  // Too few chats from this ad? Judge the language from the business's latest customer messages instead.
  let recent: string[] = [];
  if (firsts.length < 5) {
    const { data: cv } = await db.from("conversations").select("id").eq("workspace_id", ws).order("last_message_at", { ascending: false }).limit(80);
    const cids = (cv ?? []).map((c: any) => c.id);
    if (cids.length) {
      const { data: rm } = await db.from("messages").select("body").in("conversation_id", cids).eq("direction", "in").not("body", "is", null).order("sent_at", { ascending: false }).limit(200);
      recent = (rm ?? []).map((m: any) => String(m.body)).filter((b) => b.trim().length > 2);
    }
  }
  const objections = new Map<string, number>();
  for (const c of convs ?? []) for (const o of (c as any).kito_objections ?? []) objections.set(o, (objections.get(o) ?? 0) + 1);
  const buyers = (convs ?? []).filter((c: any) => Number(c.paid_orders ?? 0) > 0).length;
  return {
    language: customerLanguage(firsts.length >= 5 ? firsts : recent, "Swahili"),
    text: [
      `Business: ${w?.name}${w?.brand_town ? `, ${w.brand_town}` : ""}, Tanzania.`,
      product ? `Product to advertise: ${product}.` : `Advertise the SAME product as the ad being replaced (its name is "${adName ?? "?"}"; its text and the customers' messages show which product). The new ad reuses that ad's video/photo, so the words must match it. Do not advertise the whole range.`,
      `Products (name, price ${w?.currency ?? "TZS"}, notes):\n${(prods ?? []).map((p: any) => `- ${p.name}${p.price ? `, ${p.price}` : ""}${p.notes ? `, ${String(p.notes).slice(0, 160)}` : ""}`).join("\n") || "- (none listed)"}`,
      `Text of the ad being replaced (it works: ${ids.length} recent chats, ${buyers} paid):\n${srcText || "(not available)"}`,
      `First messages customers sent from that ad:\n${firsts.slice(0, 25).map((f) => `- ${f}`).join("\n") || "- (none)"}`,
      `What held customers back (count): ${[...objections.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none recorded"}.`,
      `Note: the source ad text may itself break the rules above. Do not copy any claim from it that breaks them.`,
    ].filter(Boolean).join("\n\n"),
  };
}

// ---------- server ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  const ws = String(body.workspace_id ?? "");
  if (!ws) return json({ error: "workspace_id required" }, 400);
  const uc = userClient(req);
  const { data: u } = await uc.auth.getUser();
  if (!u?.user) return json({ error: "Sign in again." }, 401);
  const action = String(body.action ?? "");
  step = "";
  // Writing and editing need edit rights; anything that touches Meta needs an owner/admin.
  const metaAction = ["create", "turn_on", "pause", "delete"].includes(action) || (action === "save" && body.push_to_meta);
  const { data: allowed } = await uc.rpc(metaAction ? "can_manage" : action === "refresh" ? "is_member" : "can_edit", { ws });
  if (!allowed) return json({ error: metaAction ? "Only an owner or admin can change ads in Meta." : "You can't edit ads for this business." }, 403);
  const db = admin();

  const loadDraft = async () => {
    const { data } = await db.from("ad_drafts").select("*").eq("id", body.draft_id).eq("workspace_id", ws).maybeSingle();
    if (!data) throw new Error("Draft not found.");
    return data;
  };
  const touch = (id: string, patch: Record<string, unknown>) =>
    db.from("ad_drafts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();

  try {
    // ---- write a new draft ----
    if (action === "draft") {
      if (!KEY) return json({ error: "The AI key is not set." }, 500);
      let adId = String(body.source_ad_id ?? "");
      if (!adId) {
        adId = (await bestAdId(uc, ws)) ?? "";
        if (!adId) return json({ error: "No ad has brought a paid sale in the last 60 days yet, so there's nothing proven to copy." }, 400);
      }
      const { data: known } = await db.from("ads").select("ad_id,name").eq("workspace_id", ws).eq("ad_id", adId).maybeSingle();
      if (!known) return json({ error: "That ad isn't in this business's ad account." }, 400);
      const { token } = await adsConnection(db, ws);
      const src = await sourceAd(token, adId);
      const cr = src.ad.creative ?? {};
      let srcText: string | null = cr.body ?? cr.object_story_spec?.video_data?.message ?? cr.object_story_spec?.link_data?.message ?? null;
      const story = cr.effective_object_story_id ?? cr.object_story_id;
      if (!srcText && story) srcText = await postText(token, String(story), pageIdOf(src));
      const f = await facts(db, ws, adId, known.name ?? src.ad.name ?? null, srcText, body.product ? String(body.product).slice(0, 80) : null);
      const { ok, body: out } = await claude(KEY, {
        model: MODEL, max_tokens: 4000, system: SYSTEM, tools: [TOOL],
        messages: [{ role: "user", content: `Language: ${f.language}\n\n${f.text}\n\nWrite three different versions and save them with the save_ads tool.${body.hint ? `\nOwner's note: ${String(body.hint).slice(0, 300)}` : ""}` }],
      }, { feature: "ad_writing", workspaceId: ws });
      if (!ok) throw new Error(out?.error?.message ?? "The AI couldn't write the ad. Try again.");
      // This model can't be forced to use the tool, so also accept the versions as JSON in plain text.
      let ads: any[] = out.content?.find((c: any) => c.type === "tool_use")?.input?.ads ?? [];
      if (!ads.length) {
        const text = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
        const m = text.match(/\{[\s\S]*"ads"[\s\S]*\}/);
        try { ads = m ? JSON.parse(m[0]).ads ?? [] : []; } catch { ads = []; }
      }
      ads = ads.filter((a) => a && typeof a.primary_text === "string" && a.primary_text.trim());
      if (!ads.length) throw new Error("The AI didn't return an ad. Try again.");
      const opts = ads.map((a) => ({ ...a, warnings: policyWarnings(a.headline, a.primary_text, a.greeting) }));
      // Lead with the cleanest version.
      opts.sort((a, b) => a.warnings.length - b.warnings.length);
      const [first, ...rest] = opts;
      const budget = Number(src.camp.daily_budget ?? src.adset.daily_budget ?? 0);
      const currency = (await graph(`act_${src.ad.account_id}?fields=currency`, token).catch(() => ({})))?.currency ?? null;
      const { data: row, error } = await db.from("ad_drafts").insert({
        workspace_id: ws, created_by: u.user.id, source_ad_id: adId, source_ad_name: known.name ?? src.ad.name,
        product_name: body.product ?? null, primary_text: first.primary_text, headline: first.headline, greeting: first.greeting,
        options: rest, warnings: first.warnings, media_url: thumbOf(cr),
        daily_budget: budget ? budget / (currency && NO_CENTS.has(currency) ? 1 : 100) : null, budget_currency: currency,
      }).select("*").single();
      if (error) throw new Error(error.message);
      return json({ draft: row, angle: first.angle });
    }

    // ---- an ad that runs an existing post (Posts page → Make this an ad) ----
    if (action === "from_post") {
      const { data: p } = await db.from("social_posts").select("*").eq("workspace_id", ws).eq("id", String(body.post_id ?? "")).maybeSingle();
      if (!p) return json({ error: "Post not found. Refresh Posts." }, 404);
      // Audience, budget and WhatsApp destination come from the business's best-selling ad.
      const adId = await bestAdId(uc, ws);
      if (!adId) return json({ error: "itaOS copies the audience and budget of your best-selling ad, and no ad has brought a paid sale in the last 60 days yet." }, 400);
      const { data: known } = await db.from("ads").select("ad_id,name").eq("workspace_id", ws).eq("ad_id", adId).maybeSingle();
      const { token } = await adsConnection(db, ws);
      const src = await sourceAd(token, adId);
      const budget = Number(src.camp.daily_budget ?? src.adset.daily_budget ?? 0);
      const currency = (await graph(`act_${src.ad.account_id}?fields=currency`, token).catch(() => ({})))?.currency ?? null;
      const caption = String(p.caption ?? "").trim();
      const { data: row, error } = await db.from("ad_drafts").insert({
        workspace_id: ws, created_by: u.user.id, source_ad_id: adId, source_ad_name: known?.name ?? src.ad.name,
        source_post_id: p.id, source_post_platform: p.platform,
        primary_text: caption || (p.platform === "instagram" ? "(Instagram post)" : "(Facebook post)"), headline: null, greeting: null,
        options: [], warnings: policyWarnings(caption), media_url: p.media_url,
        daily_budget: budget ? budget / (currency && NO_CENTS.has(currency) ? 1 : 100) : null, budget_currency: currency,
      }).select("*").single();
      if (error) throw new Error(error.message);
      return json({ draft: row });
    }

    // ---- edit the words ----
    if (action === "next_version") {
      // Swap in the next version Claude wrote; the current one goes to the back of the line.
      const d = await loadDraft();
      if (d.source_post_id) return json({ error: "This ad runs your post as it is, so it has no other versions." }, 400);
      if (d.meta_ad_id) return json({ error: "This ad is already in Meta. Edit its words instead." }, 400);
      const [o, ...rest] = (d.options ?? []) as any[];
      if (!o) return json({ error: "No other version." }, 400);
      const cur = { primary_text: d.primary_text, headline: d.headline, greeting: d.greeting, warnings: d.warnings };
      const { data } = await touch(d.id, {
        primary_text: o.primary_text, headline: o.headline, greeting: o.greeting,
        warnings: policyWarnings(o.headline, o.primary_text, o.greeting), options: [...rest, cur], status: "draft", last_error: null,
      });
      return json({ draft: data });
    }

    if (action === "save") {
      const d = await loadDraft();
      if (d.source_post_id) return json({ error: "This ad runs your post as it is. To change the words, edit the post on Facebook or Instagram." }, 400);
      const patch = {
        primary_text: String(body.primary_text ?? d.primary_text).slice(0, 2000),
        headline: body.headline == null ? d.headline : String(body.headline).slice(0, 255),
        greeting: body.greeting == null ? d.greeting : String(body.greeting).slice(0, 500),
      };
      if (!patch.primary_text.trim()) return json({ error: "The ad text can't be empty." }, 400);
      const warnings = policyWarnings(patch.headline, patch.primary_text, patch.greeting);
      if (d.meta_ad_id && !body.push_to_meta) return json({ error: "This ad is in Meta, so its words must be updated there too." }, 400);
      if (d.meta_ad_id) {
        // A Meta creative can't be edited: make a new one with the new words and point the ad at it.
        const { token } = await adsConnection(db, ws);
        const src = await sourceAd(token, d.source_ad_id);
        const account = `act_${src.ad.account_id}`;
        const media = await mediaOf(token, account, src.ad.creative);
        const c = await makeCreative(token, account, pageIdOf(src)!, media, { ...d, ...patch }, await autofillOf(db, ws));
        await post(d.meta_ad_id, token, { creative: { creative_id: c.id } });
        const { data } = await touch(d.id, { ...patch, warnings, meta_creative_id: c.id, last_error: null });
        return json({ draft: data, greeting_dropped: c.greetingDropped });
      }
      const { data } = await touch(d.id, { ...patch, warnings });
      return json({ draft: data });
    }

    // ---- create as PAUSED in Meta ----
    if (action === "create") {
      const d = await loadDraft();
      if (d.meta_ad_id && d.status !== "deleted") return json({ draft: d });
      const { token } = await adsConnection(db, ws);
      step = "Checking permission";
      if (!(await canWrite(token))) return json({ error: "itaOS can read your ads but not create them yet. Reconnect your ad account (Connections → Add / reconnect ad account) and allow ad management.", need_reconnect: true }, 400);
      await touch(d.id, { status: "creating", last_error: null });
      step = "Reading your best ad";
      const src = await sourceAd(token, d.source_ad_id).catch(async (e) => { await touch(d.id, { status: "failed", last_error: (e as Error).message.slice(0, 400) }); throw e; });
      const account = `act_${src.ad.account_id}`;
      const pageId = pageIdOf(src);
      if (!pageId) throw new Error("Couldn't find the Facebook Page of the ad being copied.");
      let campaignId: string | null = null;
      try {
        step = "Getting the video/photo";
        const media = d.source_post_id ? null : await mediaOf(token, account, src.ad.creative);
        // 1) campaign (objective, budget) and 2) ad set (audience, placements, WhatsApp destination), both paused.
        step = "Copying the campaign";
        const cc = await post(`${src.ad.campaign_id}/copies`, token, { deep_copy: false, status_option: "PAUSED", rename_options: { rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: " - itaOS" } });
        campaignId = cc.copied_campaign_id;
        step = "Copying the ad set";
        const adsetId = await copyAdSet(token, account, src.ad.adset_id, campaignId!);
        // 3) new words on the same media, 4) the ad, paused.
        let c: { id: string; greetingDropped?: boolean; mode?: "as_is" | "copy"; why?: string };
        if (d.source_post_id) {
          step = "Using your post";
          c = await postCreative(db, ws, token, account, pageId, d);
        } else {
          step = "Making the ad's words and video";
          c = await makeCreative(token, account, pageId, media!, d, await autofillOf(db, ws));
        }
        step = "Creating the ad";
        const ad = await post(`${account}/ads`, token, { name: `itaOS · ${d.headline ?? (d.source_post_id ? "post" : "new ad")}`, adset_id: adsetId, creative: { creative_id: c.id }, status: "PAUSED" });
        const { data } = await touch(d.id, {
          status: "paused", meta_campaign_id: campaignId, meta_adset_id: adsetId, meta_creative_id: c.id, meta_ad_id: ad.id, meta_status: "PAUSED",
          post_mode: c.mode ?? null,
          last_error: c.greetingDropped ? "Meta didn't accept the WhatsApp greeting, so it uses your usual one."
            : c.mode === "copy" ? "Meta wouldn't run the post itself with a WhatsApp button, so this ad is a copy of it (same picture and words). Its likes and comments don't carry over." : null,
        });
        return json({ draft: data, greeting_dropped: !!c.greetingDropped, post_mode: c.mode ?? null });
      } catch (e) {
        // Don't leave half an ad in the account.
        if (campaignId) await graph(campaignId, token, { method: "DELETE" }).catch(() => {});
        await touch(d.id, { status: "failed", last_error: (e as Error).message.slice(0, 400), meta_campaign_id: null, meta_adset_id: null, meta_ad_id: null });
        throw e;
      }
    }

    // ---- turn on / pause / delete ----
    if (action === "turn_on" || action === "pause") {
      const d = await loadDraft();
      if (!d.meta_ad_id) return json({ error: "Create the ad in Meta first." }, 400);
      const { token } = await adsConnection(db, ws);
      const status = action === "turn_on" ? "ACTIVE" : "PAUSED";
      // Ad first when pausing, campaign first when turning on, so nothing spends half-set.
      const order = status === "ACTIVE" ? [d.meta_campaign_id, d.meta_adset_id, d.meta_ad_id] : [d.meta_ad_id, d.meta_adset_id, d.meta_campaign_id];
      for (const id of order) if (id) await post(id, token, { status });
      const { data } = await touch(d.id, { status: status === "ACTIVE" ? "active" : "paused", meta_status: status === "ACTIVE" ? "PENDING_REVIEW" : "PAUSED" });
      return json({ draft: data });
    }
    if (action === "delete") {
      const d = await loadDraft();
      if (d.meta_campaign_id) {
        const { token } = await adsConnection(db, ws);
        await graph(d.meta_campaign_id, token, { method: "DELETE" }).catch((e) => { if (!/does not exist|code 100\b/i.test((e as Error).message)) throw e; });
      }
      const { data } = await touch(d.id, { status: "deleted", meta_status: d.meta_campaign_id ? "DELETED" : null });
      return json({ draft: data });
    }

    // ---- Meta's review status ----
    if (action === "refresh") {
      const { data: rows } = await db.from("ad_drafts").select("id,meta_ad_id").eq("workspace_id", ws).in("status", ["paused", "active"]).not("meta_ad_id", "is", null).limit(20);
      if (!rows?.length) return json({ ok: true });
      const { token } = await adsConnection(db, ws);
      for (const r of rows) {
        const a = await graph(`${r.meta_ad_id}?fields=effective_status,ad_review_feedback`, token).catch(() => null);
        if (!a) continue;
        const fb = a.ad_review_feedback?.global ? Object.values(a.ad_review_feedback.global).join(" ").slice(0, 400) : null;
        await touch(r.id, { meta_status: a.effective_status ?? null, ...(fb ? { last_error: fb } : {}) });
      }
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    const msg = (e as Error).message ?? "failed";
    return json({ error: /code 190/.test(msg) ? "Your Meta login expired. Reconnect your ad account in Connections." : msg }, 500);
  }
});

