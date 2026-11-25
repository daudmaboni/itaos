// Posts (25 Nov 2026). Reads the business's Facebook Page and Instagram posts into social_posts, and links each
// post to the ads that run it, so the Posts page can rank posts by paid sales (post_money) instead of likes.
//
//   sync   Any member. Uses the business's saved Meta login (the ad account connection).
//          Page = the Page the business's ads run from (most used), else its first Page.
//          Instagram = the account linked to that Page. Instagram needs instagram_basic; views need
//          instagram_manage_insights. Whatever Meta refuses is skipped and explained in workspaces.social_note.
//   link   Editors. Gives a post its WhatsApp link code (kept forever once made).
import { admin, userClient, readToken, json, cors, GRAPH } from "../_shared/db.ts";

type Db = ReturnType<typeof admin>;

async function graph(path: string, token: string) {
  const url = path.startsWith("http") ? path : `${GRAPH}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.error) {
    const e = b.error ?? {};
    throw new Error(`${e.error_user_msg || e.message || "Meta request failed"} (code ${e.code ?? "?"})`);
  }
  return b;
}

/** All pages of a Graph list, up to `max` items. */
async function all(path: string, token: string, max = 300) {
  const out: any[] = [];
  let next: string | null = path;
  while (next && out.length < max) {
    const page: any = await graph(next, token);
    out.push(...(page.data ?? []));
    next = page.paging?.next ?? null;
  }
  return out;
}

const ALL_STATUSES = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED",
  "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO", "IN_PROCESS", "WITH_ISSUES"];
const DAYS = 120;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

const perm = (m: string) => /code (10|200|190)\b|permission/i.test(m);

async function sync(db: Db, ws: string) {
  const { data: conn } = await db.from("connections").select("*").eq("workspace_id", ws).eq("provider", "meta_ads").in("status", ["active", "error"]).order("created_at").limit(1).maybeSingle();
  if (!conn) throw new Error("Connect your Meta ad account first (Connections).");
  const token = await readToken(db, conn.token_secret_id);
  const { data: w } = await db.from("workspaces").select("social_page_id").eq("id", ws).single();
  const notes: string[] = [];
  // What this login was actually given, so a "needs permission" note can say exactly what's missing.
  const granted = new Set<string>(((await graph("me/permissions", token).catch(() => ({ data: [] })))?.data ?? [])
    .filter((x: any) => x.status === "granted").map((x: any) => String(x.permission)));
  const why = (what: string, need: string, e: unknown) => {
    const m = (e as Error).message;
    console.error("posts", what, m.slice(0, 500));
    if (!granted.has(need)) return `${what} need the ${need} permission, and this Meta login doesn't have it: reconnect the ad account and allow it.`;
    return `${what}: Meta said "${m.slice(0, 200)}".`;
  };

  // Ads → the post each one runs (Facebook story id / Instagram media id).
  const params = new URLSearchParams({ fields: "id,creative{effective_object_story_id,effective_instagram_media_id,object_story_spec{page_id}}", limit: "200",
    filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ALL_STATUSES }]) });
  const ads = await all(`${conn.external_id}/ads?${params}`, token, 2000).catch((e) => { notes.push(`Couldn't read which ads run which post: ${(e as Error).message}`); return []; });
  const adsOf = new Map<string, string[]>();
  const pageVotes = new Map<string, number>();
  for (const a of ads) {
    const cr = a.creative ?? {};
    for (const key of [cr.effective_object_story_id, cr.effective_instagram_media_id]) {
      if (!key) continue;
      adsOf.set(String(key), [...(adsOf.get(String(key)) ?? []), String(a.id)]);
    }
    const pg = cr.object_story_spec?.page_id ?? String(cr.effective_object_story_id ?? "").split("_")[0];
    if (pg) pageVotes.set(pg, (pageVotes.get(pg) ?? 0) + 1);
  }

  // The business's Page (and its Page token, which reads posts and Instagram).
  const pages = await all("me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100", token, 200);
  if (!pages.length) throw new Error("This Meta login can't see any Facebook Page. Reconnect the ad account and allow the business's Page.");
  const voted = [...pageVotes.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const page = pages.find((p) => p.id === w?.social_page_id) ?? voted.map((v) => pages.find((p) => p.id === v)).find(Boolean) ?? pages[0];
  const pt: string = page.access_token ?? token;
  const ig = page.instagram_business_account ?? null;
  const since = Math.floor((Date.now() - DAYS * 864e5) / 1000);
  const rows: any[] = [];
  const now = new Date().toISOString();

  // Facebook posts.
  try {
    // Counting reactions/comments can need extra Page permissions; if Meta refuses, read the posts without them.
    const base = "id,message,created_time,permalink_url,full_picture,shares,attachments{media_type}";
    let fb: any[] = [];
    let firstErr: unknown = null;
    for (const fields of [`${base},reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)`, `${base},reactions.summary(total_count).limit(0)`, base, "id,message,created_time,permalink_url,full_picture"]) {
      try { fb = await all(`${page.id}/published_posts?fields=${fields}&since=${since}&limit=50`, pt, 200); firstErr = null; break; }
      catch (e) { firstErr ??= e; console.error("posts fb fields", fields.length, (e as Error).message.slice(0, 300)); }
    }
    if (firstErr) throw firstErr;
    for (const p of fb) {
      const mt = String(p.attachments?.data?.[0]?.media_type ?? (p.full_picture ? "photo" : "text")).toLowerCase();
      rows.push({
        id: p.id, workspace_id: ws, platform: "facebook", page_id: page.id, caption: p.message ?? null,
        media_type: mt, media_url: p.full_picture ?? null, permalink: p.permalink_url ?? null, posted_at: p.created_time,
        likes: p.reactions?.summary?.total_count ?? 0, comments: p.comments?.summary?.total_count ?? 0, shares: p.shares?.count ?? 0,
        ad_ids: adsOf.get(p.id) ?? [], synced_at: now,
      });
    }
  } catch (e) {
    notes.push(why("Facebook posts", "pages_read_engagement", e));
  }

  // Instagram posts.
  if (!ig) notes.push(`No Instagram account is linked to the Page "${page.name}".`);
  else {
    try {
      const media = await all(`${ig.id}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=50`, pt, 150);
      let viewsBlocked = false;
      for (const m of media) {
        if (Date.parse(m.timestamp) < since * 1000) continue;
        let views: number | null = null;
        if (!viewsBlocked) {
          try {
            const ins = await graph(`${m.id}/insights?metric=views,reach`, pt);
            const get = (n: string) => ins.data?.find((x: any) => x.name === n)?.values?.[0]?.value;
            views = Number(get("views") ?? get("reach") ?? 0) || null;
          } catch (e) { if (perm((e as Error).message)) viewsBlocked = true; }
        }
        rows.push({
          id: m.id, workspace_id: ws, platform: "instagram", page_id: page.id, caption: m.caption ?? null,
          media_type: String(m.media_product_type === "REELS" ? "reel" : m.media_type ?? "").toLowerCase(),
          media_url: m.thumbnail_url ?? m.media_url ?? null, permalink: m.permalink ?? null, posted_at: m.timestamp,
          likes: m.like_count ?? 0, comments: m.comments_count ?? 0, shares: 0, views,
          ad_ids: adsOf.get(m.id) ?? [], synced_at: now,
        });
      }
      if (viewsBlocked) notes.push("Instagram views need the instagram_manage_insights permission.");
    } catch (e) {
      notes.push(why("Instagram posts", "instagram_basic", e));
    }
  }

  // Save, keeping each post's WhatsApp code.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("social_posts").upsert(rows.slice(i, i + 200), { onConflict: "id", ignoreDuplicates: false });
    if (error) throw new Error(error.message);
  }
  await db.from("workspaces").update({
    social_page_id: page.id, social_page_name: page.name ?? null, social_ig_id: ig?.id ?? null, social_ig_username: ig?.username ?? null,
    social_synced_at: now, social_note: notes.join(" ") || null,
  }).eq("id", ws);
  return { posts: rows.length, page: page.name, instagram: ig?.username ?? null, notes };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  const ws = String(body.workspace_id ?? "");
  if (!ws) return json({ error: "workspace_id required" }, 400);
  const uc = userClient(req);
  const { data: u } = await uc.auth.getUser();
  if (!u?.user) return json({ error: "Sign in again." }, 401);
  const action = String(body.action ?? "");
  const { data: allowed } = await uc.rpc(action === "link" ? "can_edit" : "is_member", { ws });
  if (!allowed) return json({ error: "You can't do this for this business." }, 403);
  const db = admin();
  try {
    if (action === "sync") return json(await sync(db, ws));
    if (action === "link") {
      const { data: p } = await db.from("social_posts").select("id,wa_code").eq("workspace_id", ws).eq("id", String(body.post_id ?? "")).maybeSingle();
      if (!p) return json({ error: "Post not found." }, 404);
      if (p.wa_code) return json({ code: p.wa_code });
      for (let i = 0; i < 6; i++) {
        const r = crypto.getRandomValues(new Uint8Array(5));
        const code = "P" + [...r].slice(0, 4).map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
        const { error } = await db.from("social_posts").update({ wa_code: code }).eq("id", p.id).is("wa_code", null);
        if (!error) {
          const { data: again } = await db.from("social_posts").select("wa_code").eq("id", p.id).single();
          return json({ code: again?.wa_code ?? code });
        }
        if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message);
      }
      throw new Error("Couldn't make a link code. Try again.");
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    const msg = (e as Error).message ?? "failed";
    return json({ error: /code 190/.test(msg) ? "Your Meta login expired. Reconnect your ad account in Connections." : msg }, 500);
  }
});
