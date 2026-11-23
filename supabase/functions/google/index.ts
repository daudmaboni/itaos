// Google connection for a business (Connections page): one Google account per workspace.
//  - Promises → Google Tasks: every confirmed promise becomes a task in a list "itaOS · <business>"; the task
//    moves when the day changes and is ticked off when the promise is paid, done or dismissed.
//  - Contacts → Google Contacts: paying buyers (and, if chosen, recent chats) are saved under the label "itaOS"
//    as "Name · Business · Region". Phones the owner already has in Google are left alone. Google caps an
//    account at 25,000 contacts, so we stop at 24,500.
// The refresh token is stored in Vault; the browser only ever sees the email, switches and counts.
//
// Called by:
//  - the browser (user JWT): status, start, settings, disconnect, sync (one workspace)
//  - Google (GET ?code&state): the sign-in callback, then redirects back to itaos.app
//  - pg_cron every 5 min (x-cron-secret): sync every active link
// Deployed with --no-verify-jwt because Google's redirect carries no Supabase JWT; every POST action checks
// the caller itself (is_member / can_manage), and the callback checks a signed, 10-minute state.
import { admin, userClient, storeToken, readToken, json, cors } from "../_shared/db.ts";

const CID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CSECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const CRON = Deno.env.get("CRON_SECRET") ?? "";
// Google sends the owner back to itaos.app/google/callback, which Netlify passes to this function (web/netlify.toml).
const REDIRECT = Deno.env.get("GOOGLE_REDIRECT_URI") ?? "https://itaos.app/google/callback";
const APP = Deno.env.get("APP_URL") ?? "https://itaos.app";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/tasks", "https://www.googleapis.com/auth/contacts"];
const TASKS = "https://tasks.googleapis.com/tasks/v1";
const PEOPLE = "https://people.googleapis.com/v1";
const GOOGLE_CAP = 24_500;
const configured = () => !!(CID && CSECRET);

// ---------- signed state (workspace + user, 10 minutes) ----------
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("itaos-google-state:" + CSECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}
async function signState(p: { w: string; u: string }) {
  const body = b64u(new TextEncoder().encode(JSON.stringify({ ...p, e: Date.now() + 10 * 60e3, n: crypto.randomUUID() })));
  return body + "." + (await hmac(body));
}
async function readState(s: string): Promise<{ w: string; u: string } | null> {
  const [body, sig] = s.split(".");
  if (!body || !sig || (await hmac(body)) !== sig) return null;
  const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
  return p.e > Date.now() ? p : null;
}

// ---------- Google HTTP ----------
class GoogleError extends Error { constructor(msg: string, public status: number, public reason = "") { super(msg); } }
async function gfetch(url: string, token: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (res.status === 204) return {};
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(`Google ${res.status}: ${b.error?.message ?? b.error_description ?? "request failed"}`.slice(0, 300), res.status, b.error?.status ?? b.error ?? "");
  return b;
}
async function tokenCall(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CID, client_secret: CSECRET, ...params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(b.error_description ?? b.error ?? "token request failed", res.status, b.error ?? "");
  return b as { access_token: string; refresh_token?: string; id_token?: string; scope?: string };
}

type Link = {
  workspace_id: string; email: string | null; token_secret_id: string | null; status: string; tasks_on: boolean; tasklist_id: string | null;
  tasks_synced: number; contacts_on: boolean; contacts_days: number; contact_group: string | null; contacts_synced: number;
  contacts_skipped: number; contacts_full: boolean; contacts_checked_at: string | null; contacts_google_total: number | null;
  buyers_group: string | null; leads_group: string | null;
};

const back = (q: string) => Response.redirect(`${APP}/app?google=${q}#connect`, 303);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();

  // ---------- Google sends the owner back here after they allow access ----------
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("error")) return back(encodeURIComponent(u.searchParams.get("error") === "access_denied" ? "cancelled" : "error"));
    const code = u.searchParams.get("code"), state = await readState(u.searchParams.get("state") ?? "");
    if (!code || !state || !configured()) return back("error");
    try {
      const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: REDIRECT });
      if (!t.refresh_token) return back("norefresh");
      const granted = (t.scope ?? "").split(" ");
      const email = t.id_token ? JSON.parse(new TextDecoder().decode(unb64u(t.id_token.split(".")[1]))).email ?? null : null;
      const secret = await storeToken(db, `google:${state.w}`, t.refresh_token);
      const { data: prev } = await db.from("google_links").select("email").eq("workspace_id", state.w).maybeSingle();
      const sameAccount = prev?.email && prev.email === email;
      const { error } = await db.from("google_links").upsert({
        workspace_id: state.w, email, token_secret_id: secret, scopes: granted, status: "active", last_error: null,
        connected_by: state.u, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        // A different Google account starts clean: new task list, new label, re-check existing contacts.
        ...(sameAccount ? {} : { tasklist_id: null, contact_group: null, buyers_group: null, leads_group: null, tasks_synced: 0, contacts_synced: 0, contacts_skipped: 0, contacts_full: false, contacts_checked_at: null }),
      }, { onConflict: "workspace_id" });
      if (error) throw new Error(error.message);
      if (!sameAccount) {
        await db.from("follow_up_tasks").update({ google_task_id: null, google_synced_at: null }).eq("workspace_id", state.w).not("google_task_id", "is", null);
        await db.from("contacts").update({ google_resource: null, google_kind: null }).eq("workspace_id", state.w).not("google_resource", "is", null);
      }
      // First sync right away (tasks first; contacts follow on the 5-minute job).
      // @ts-ignore EdgeRuntime is provided by Supabase
      EdgeRuntime.waitUntil(syncOne(db, state.w, { tasks: true, contacts: true }).catch((e) => console.error("first sync", String(e).slice(0, 200))));
      const missing = SCOPES.slice(2).filter((s) => !granted.includes(s));
      return back(missing.length ? "partial" : "ok");
    } catch (e) {
      console.error("google callback", String((e as Error).message).slice(0, 300));
      return back("error");
    }
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const isCron = !!CRON && req.headers.get("x-cron-secret") === CRON;

  // ---------- pg_cron: every active link ----------
  if (isCron) {
    if (!configured()) return json({ skipped: "not configured" });
    const { data: links } = await db.from("google_links").select("workspace_id").eq("status", "active");
    const out: Record<string, unknown> = {};
    for (const l of links ?? []) out[l.workspace_id] = await syncOne(db, l.workspace_id, { tasks: true, contacts: true }).catch((e) => String(e).slice(0, 200));
    return json({ ok: true, out });
  }

  if (action === "status") return json({ configured: configured(), redirect_uri: REDIRECT });

  const ws = String(body.workspace_id ?? "");
  if (!ws) return json({ error: "workspace_id required" }, 400);
  const user = userClient(req);
  const { data: member } = await user.rpc("is_member", { ws });
  if (!member) return json({ error: "Not a member of this business." }, 403);

  // Anyone in the business can ask for a sync (the Promises page does after each change).
  if (action === "sync") {
    if (!configured()) return json({ ok: false, skipped: "not configured" });
    const r = await syncOne(db, ws, { tasks: body.only !== "contacts", contacts: body.only !== "tasks" }).catch((e) => ({ error: String((e as Error).message).slice(0, 300) }));
    return json(r);
  }

  const { data: manager } = await user.rpc("can_manage", { ws });
  if (!manager) return json({ error: "Only the business owner or an admin can change the Google connection." }, 403);

  if (action === "start") {
    if (!configured()) return json({ error: "Google is not set up yet. Pondi needs to add the Google keys first." }, 503);
    const { data: who } = await user.auth.getUser();
    if (!who?.user) return json({ error: "Sign in again." }, 401);
    const q = new URLSearchParams({
      client_id: CID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES.join(" "),
      access_type: "offline", prompt: "consent", include_granted_scopes: "true",
      state: await signState({ w: ws, u: who.user.id }),
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
  }

  if (action === "settings") {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.tasks_on === "boolean") patch.tasks_on = body.tasks_on;
    if (typeof body.contacts_on === "boolean") patch.contacts_on = body.contacts_on;
    if (Number.isInteger(body.contacts_days) && body.contacts_days >= 0 && body.contacts_days <= 36500) patch.contacts_days = body.contacts_days;
    // Widening who to save means more contacts to check against the owner's Google list: re-check on the next run.
    if ("contacts_days" in patch || body.contacts_on === true) patch.contacts_checked_at = null;
    const { error } = await db.from("google_links").update(patch).eq("workspace_id", ws);
    if (error) return json({ error: error.message }, 500);
    // @ts-ignore EdgeRuntime is provided by Supabase
    EdgeRuntime.waitUntil(syncOne(db, ws, { tasks: true, contacts: true }).catch(() => {}));
    return json({ ok: true });
  }

  if (action === "disconnect") {
    const { data: link } = await db.from("google_links").select("token_secret_id").eq("workspace_id", ws).maybeSingle();
    if (link?.token_secret_id) {
      const rt = await readToken(db, link.token_secret_id).catch(() => "");
      if (rt) await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: rt }) }).catch(() => {});
      await storeToken(db, `google:${ws}`, "revoked").catch(() => {});
    }
    // Tasks and contacts already in Google stay there (they're the owner's now); itaOS just stops syncing.
    await db.from("google_links").delete().eq("workspace_id", ws);
    await db.from("follow_up_tasks").update({ google_task_id: null, google_synced_at: null }).eq("workspace_id", ws).not("google_task_id", "is", null);
    await db.from("contacts").update({ google_resource: null, google_kind: null }).eq("workspace_id", ws).not("google_resource", "is", null);
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
});

// =====================================================================================================
async function syncOne(db: ReturnType<typeof admin>, ws: string, what: { tasks: boolean; contacts: boolean }) {
  const { data: link } = await db.from("google_links").select("*").eq("workspace_id", ws).maybeSingle<Link>();
  if (!link || link.status !== "active" || !link.token_secret_id) return { ok: false, skipped: "not connected" };
  const { data: w } = await db.from("workspaces").select("name,language,timezone").eq("id", ws).single();
  const name = String(w?.name ?? "itaOS"), sw = w?.language === "sw", tz = String(w?.timezone || "Africa/Dar_es_Salaam");

  let token: string;
  try {
    token = (await tokenCall({ grant_type: "refresh_token", refresh_token: await readToken(db, link.token_secret_id) })).access_token;
  } catch (e) {
    const expired = e instanceof GoogleError && e.reason === "invalid_grant";
    await db.from("google_links").update({
      status: expired ? "expired" : "error",
      last_error: expired ? "Google sign-in expired or was removed. Reconnect Google." : String((e as Error).message).slice(0, 300),
      updated_at: new Date().toISOString(),
    }).eq("workspace_id", ws);
    return { ok: false, error: "token" };
  }

  const out: Record<string, unknown> = {};
  let lastError: string | null = null;
  if (what.tasks && link.tasks_on) {
    try { out.tasks = await syncTasks(db, link, token, name, sw, tz); } catch (e) { lastError = "Tasks: " + String((e as Error).message).slice(0, 250); }
  }
  // A full Google account is still re-checked once a day, so it resumes if the owner makes room.
  if (what.contacts && link.contacts_on) {
    try { out.contacts = await syncContacts(db, link, token, name); } catch (e) { lastError = (lastError ? lastError + " · " : "") + "Contacts: " + String((e as Error).message).slice(0, 250); }
  }
  await db.from("google_links").update({ last_sync_at: new Date().toISOString(), last_error: lastError, updated_at: new Date().toISOString() }).eq("workspace_id", ws);
  return { ok: !lastError, ...out, error: lastError ?? undefined };
}

// ---------- Promises → Google Tasks ----------
const KIND: Record<string, [string, string]> = {
  pay: ["will pay", "atalipa"], call: ["call them", "apigiwe simu"], collect: ["will collect", "atachukua"], come_back: ["will come back", "atarudi"], other: ["promise", "ahadi"],
};
/** Google Tasks keeps the day only: the promise's East Africa date at midnight UTC. */
const eatDay = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600e3).toISOString().slice(0, 10) + "T00:00:00.000Z";

async function syncTasks(db: ReturnType<typeof admin>, link: Link, token: string, wsName: string, sw: boolean, tz = "Africa/Dar_es_Salaam") {
  const ws = link.workspace_id;
  // Customers kept aside to measure what itaOS adds (migration 0070) get no reminder anywhere, Google included.
  const { data: kept } = await db.rpc("svc_atrisk_hidden", { p_ws: ws });
  const aside = new Set(((kept ?? []) as { conversation_id: string }[]).map((x) => x.conversation_id));
  // Google Tasks keeps only the date, so the hour goes in the title.
  const hhmm = (iso: string) => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)); } catch { return ""; } };
  let list = link.tasklist_id;
  const makeList = async () => {
    const l = await gfetch(`${TASKS}/users/@me/lists`, token, { method: "POST", body: JSON.stringify({ title: `itaOS · ${wsName}` }) });
    await db.from("google_links").update({ tasklist_id: l.id }).eq("workspace_id", ws);
    return l.id as string;
  };
  if (!list) list = await makeList();

  const { data: rows, error } = await db.from("follow_up_tasks")
    .select("id,status,kind,due_at,snoozed_until,promise_text,conversation_id,google_task_id,google_synced_at,updated_at,conversations(kito_summary,contacts(name,full_name))")
    .eq("workspace_id", ws).eq("source", "kito_promise").in("status", ["open", "snoozed", "done", "dismissed"])
    .order("updated_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const todo = (rows ?? []).filter((r: any) => {
    if (r.google_synced_at && Date.parse(r.google_synced_at) >= Date.parse(r.updated_at)) return false;
    const live = r.status === "open" || r.status === "snoozed";
    if (live && aside.has(r.conversation_id) && !r.google_task_id) return false;
    return live ? !!(r.status === "snoozed" && r.snoozed_until ? r.snoozed_until : r.due_at) : !!r.google_task_id;
  }).slice(0, 40);

  let created = 0, updated = 0, ticked = 0;
  for (const r of todo as any[]) {
    const live = r.status === "open" || r.status === "snoozed";
    let id: string | null = r.google_task_id;
    if (live) {
      const due = r.status === "snoozed" && r.snoozed_until ? r.snoozed_until : r.due_at;
      const c = r.conversations?.contacts;
      const who = c?.full_name || c?.name || (sw ? "Mteja" : "Customer");
      const k = KIND[r.kind ?? "other"] ?? KIND.other;
      const task = {
        title: `${who} — ${sw ? k[1] : k[0]}${due && hhmm(due) ? ` · ${sw ? "saa" : "at"} ${hhmm(due)}` : ""}`,
        notes: [r.promise_text ? `“${r.promise_text}”` : "", r.conversations?.kito_summary ?? "", `${sw ? "Fungua chat kwenye itaOS" : "Open the chat in itaOS"}: ${APP}/#chats/open=${r.conversation_id}`].filter(Boolean).join("\n\n").slice(0, 8000),
        due: eatDay(due), status: "needsAction",
      };
      try {
        if (id) { await gfetch(`${TASKS}/lists/${list}/tasks/${id}`, token, { method: "PATCH", body: JSON.stringify(task) }); updated++; }
        else throw new GoogleError("new", 404);
      } catch (e) {
        if (!(e instanceof GoogleError && e.status === 404)) throw e;
        // New, or the owner deleted it in Google (or deleted the whole list): create it again.
        try { id = (await gfetch(`${TASKS}/lists/${list}/tasks`, token, { method: "POST", body: JSON.stringify(task) })).id; }
        catch (e2) {
          if (!(e2 instanceof GoogleError && e2.status === 404)) throw e2;
          list = await makeList();
          id = (await gfetch(`${TASKS}/lists/${list}/tasks`, token, { method: "POST", body: JSON.stringify(task) })).id;
        }
        created++;
      }
    } else if (id) {
      // Paid, talked to them, not interested, dismissed: tick it off in Google.
      try { await gfetch(`${TASKS}/lists/${list}/tasks/${id}`, token, { method: "PATCH", body: JSON.stringify({ status: "completed" }) }); ticked++; }
      catch (e) { if (!(e instanceof GoogleError && e.status === 404)) throw e; }
    }
    const { error: markErr } = await db.rpc("svc_mark_google_task", { p_id: r.id, p_task: id });
    if (markErr) throw new Error(markErr.message);
  }
  if (created) await db.from("google_links").update({ tasks_synced: link.tasks_synced + created }).eq("workspace_id", ws);
  return { created, updated, ticked, waiting: Math.max(0, todo.length - created - updated - ticked) };
}

// ---------- Contacts → Google Contacts ----------
const last9 = (p: string) => p.replace(/\D/g, "").slice(-9);

/** Find or create a Google contact label by name; remembers it on google_links[col]. */
async function ensureGroup(db: ReturnType<typeof admin>, ws: string, token: string, name: string, known: string | null, col: string) {
  if (known) return known;
  const gs = await gfetch(`${PEOPLE}/contactGroups?pageSize=1000`, token);
  let rn: string | null = (gs.contactGroups ?? []).find((g: any) => g.groupType === "USER_CONTACT_GROUP" && g.name === name)?.resourceName ?? null;
  if (!rn) rn = (await gfetch(`${PEOPLE}/contactGroups`, token, { method: "POST", body: JSON.stringify({ contactGroup: { name } }) })).resourceName;
  await db.from("google_links").update({ [col]: rn }).eq("workspace_id", ws);
  return rn as string;
}

/** A buyer's saved name ends with ✅ ("Black Songwe · Kayani ✅" → "Black Songwe · Kayani✅"); a lead's never does. */
export function withTick(name: string, buyer: boolean) {
  const bare = name.replace(/\s*✅+\s*$/u, "");
  return buyer ? bare + "✅" : bare;
}

/** Add or remove the ✅ on contacts already in Google. Keeps whatever the owner split into first/last name. */
async function tickNames(token: string, resources: string[], buyer: boolean) {
  for (let i = 0; i < resources.length; i += 200) {
    const part = resources.slice(i, i + 200);
    const got = await gfetch(`${PEOPLE}/people:batchGet?personFields=names&${part.map((r) => "resourceNames=" + encodeURIComponent(r)).join("&")}`, token);
    const contacts: Record<string, unknown> = {};
    for (const r of got.responses ?? []) {
      const person = r.person;
      const n = person?.names?.[0];
      if (!person?.resourceName || !person.etag || !n) continue;
      const fixed = n.familyName ? { givenName: n.givenName, familyName: withTick(n.familyName, buyer) } : { givenName: withTick(n.givenName ?? "", buyer) };
      if (fixed.givenName === n.givenName && (fixed as any).familyName === n.familyName) continue;   // already right
      contacts[person.resourceName] = { etag: person.etag, names: [{ ...fixed, ...(n.middleName ? { middleName: n.middleName } : {}) }] };
    }
    if (Object.keys(contacts).length)
      await gfetch(`${PEOPLE}/people:batchUpdateContacts`, token, { method: "POST", body: JSON.stringify({ contacts, updateMask: "names", readMask: "names" }) });
  }
}

async function syncContacts(db: ReturnType<typeof admin>, link: Link, token: string, wsName: string) {
  const ws = link.workspace_id;
  // 1. Labels: "itaOS" on every saved contact, plus "itaOS Buyers" (has paid) or "itaOS Leads" (everyone else).
  const group = await ensureGroup(db, ws, token, "itaOS", link.contact_group, "contact_group");
  const buyers = await ensureGroup(db, ws, token, "itaOS Buyers", link.buyers_group, "buyers_group");
  const leads = await ensureGroup(db, ws, token, "itaOS Leads", link.leads_group, "leads_group");
  const kindGroup = (k: string) => (k === "buyer" ? buyers : leads);

  // 2. Keep Buyers / Leads right for contacts already saved (a lead who paid moves to Buyers). Up to 1,000 a run.
  let relabelled = 0;
  {
    const { data: todo } = await db.rpc("svc_google_label_todo", { p_ws: ws, p_limit: 1000 });
    const rows = (todo ?? []) as { id: string; resource: string; kind: "buyer" | "lead" }[];
    for (const kind of ["buyer", "lead"] as const) {
      const list = rows.filter((r) => r.kind === kind);
      if (!list.length) continue;
      const add = kindGroup(kind), remove = kindGroup(kind === "buyer" ? "lead" : "buyer");
      const res = list.map((r) => r.resource);
      await gfetch(`${PEOPLE}/${add}/members:modify`, token, { method: "POST", body: JSON.stringify({ resourceNamesToAdd: res }) });
      await gfetch(`${PEOPLE}/${remove}/members:modify`, token, { method: "POST", body: JSON.stringify({ resourceNamesToRemove: res }) }).catch(() => {});
      // Buyers get a ✅ at the end of their saved name (a lead who paid gains it; a refunded buyer loses it).
      await tickNames(token, res, kind === "buyer").catch((e) => console.error("contact names", String((e as Error)?.message ?? e).slice(0, 200)));
      await db.rpc("svc_mark_google_kind", { p_ids: list.map((r) => r.id), p_kinds: list.map(() => kind) });
      relabelled += list.length;
    }
  }

  // 3. Once a day: read the owner's Google contacts, so phones they already have are skipped, and count them.
  let total = link.contacts_google_total ?? 0;
  const stale = !link.contacts_checked_at || Date.now() - Date.parse(link.contacts_checked_at) > 24 * 3600e3;
  if (link.contacts_full && !stale) return { created: 0, relabelled, full: true, google_total: total };
  if (stale) {
    const have = new Set<string>();
    let page = "";
    for (let i = 0; i < 30; i++) {
      const r = await gfetch(`${PEOPLE}/people/me/connections?personFields=phoneNumbers&pageSize=1000${page ? `&pageToken=${page}` : ""}`, token);
      total = r.totalItems ?? r.totalPeople ?? total;
      for (const p of r.connections ?? []) for (const n of p.phoneNumbers ?? []) { const k = last9(n.canonicalForm ?? n.value ?? ""); if (k.length === 9) have.add(k); }
      page = r.nextPageToken ?? "";
      if (!page) break;
    }
    // Mark every waiting itaOS contact whose phone the owner already has, so we never create a duplicate.
    const { data: waiting } = await db.rpc("svc_google_contacts_todo", { p_ws: ws, p_days: link.contacts_days, p_limit: 50000 });
    const dup = ((waiting ?? []) as any[]).filter((c) => have.has(last9(c.wa_id)));
    for (let i = 0; i < dup.length; i += 1000) {
      const part = dup.slice(i, i + 1000);
      await db.rpc("svc_mark_google_contacts", { p_ids: part.map((c) => c.id), p_res: part.map(() => "skip:existing") });
    }
    const full = total >= GOOGLE_CAP;
    await db.from("google_links").update({ contacts_checked_at: new Date().toISOString(), contacts_skipped: link.contacts_skipped + dup.length, contacts_full: full, contacts_google_total: total }).eq("workspace_id", ws);
    if (full) return { created: 0, relabelled, skipped: dup.length, full: true, google_total: total };
  }

  // 4. Up to 200 new contacts per run (Google's batch size): buyers first, then the most recent chats.
  const room = GOOGLE_CAP - total;
  const { data: todo, error } = await db.rpc("svc_google_contacts_todo", { p_ws: ws, p_days: link.contacts_days, p_limit: Math.max(0, Math.min(200, room)) });
  if (error) throw new Error(error.message);
  if (!todo?.length) return { created: 0, relabelled };
  const short = wsName.split(/\s+/)[0] || wsName;
  const people = (todo as any[]).map((c) => ({
    contactPerson: {
      names: [{ givenName: withTick([c.full_name || c.name || "Customer", short, c.region].filter(Boolean).join(" · ").slice(0, 199), !!c.buyer) }],
      phoneNumbers: [{ value: "+" + String(c.wa_id).replace(/\D/g, ""), type: "mobile" }],
      memberships: [
        { contactGroupMembership: { contactGroupResourceName: group } },
        { contactGroupMembership: { contactGroupResourceName: kindGroup(c.buyer ? "buyer" : "lead") } },
      ],
    },
  }));
  const r = await gfetch(`${PEOPLE}/people:batchCreateContacts`, token, { method: "POST", body: JSON.stringify({ contacts: people, readMask: "names" }) });
  const made = (r.createdPeople ?? []) as { person?: { resourceName?: string } }[];
  const ids: string[] = [], res: string[] = [], kinds: string[] = [];
  (todo as any[]).forEach((c, i) => { const rn = made[i]?.person?.resourceName; if (rn) { ids.push(c.id); res.push(rn); kinds.push(c.buyer ? "buyer" : "lead"); } });
  if (ids.length) {
    await db.rpc("svc_mark_google_contacts", { p_ids: ids, p_res: res });
    await db.rpc("svc_mark_google_kind", { p_ids: ids, p_kinds: kinds });
  }
  const synced = link.contacts_synced + ids.length;
  total += ids.length;
  await db.from("google_links").update({ contacts_synced: synced, contacts_google_total: total, contacts_full: total >= GOOGLE_CAP }).eq("workspace_id", ws);
  return { created: ids.length, relabelled };
}
