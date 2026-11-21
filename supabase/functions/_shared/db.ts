import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { analyze, Msg, type Rules } from "./signals.ts";
import { confirmTicks, TickMsg } from "./ticks.ts";

export const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") ?? "v25.0"}`;

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}

export async function graph(path: string, token: string, init: RequestInit = {}) {
  const url = path.startsWith("http") ? path : `${GRAPH}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    throw new Error(`Graph ${res.status}: ${e.message ?? "request failed"} (code ${e.code ?? "?"}${e.error_subcode ? "/" + e.error_subcode : ""})`);
  }
  return body;
}

export async function readToken(db: SupabaseClient, secretId: string): Promise<string> {
  const { data, error } = await db.rpc("svc_read_token", { p_secret_id: secretId });
  if (error || !data) throw new Error("token unavailable");
  return data as string;
}

export async function storeToken(db: SupabaseClient, name: string, token: string): Promise<string> {
  const { data, error } = await db.rpc("svc_store_token", { p_name: name, p_token: token });
  if (error) throw new Error("could not store token: " + error.message);
  return data as string;
}

/** Recompute signals for conversations and save them. */
export async function reanalyze(db: SupabaseClient, conversationIds: string[]) {
  // Each business's own wording (Settings → How itaOS reads your chats), loaded once per business.
  const rulesOf = new Map<string, Rules>();
  for (const id of [...new Set(conversationIds)]) {
    const { data: msgs, error: readError } = await db.from("messages").select("id,direction,sent_at,body,type,media").eq("conversation_id", id).order("sent_at");
    if (readError) throw new Error(`could not load messages for analysis: ${readError.message}`);
    if (!msgs?.length) continue;
    const { data: cv } = await db.from("conversations").select("workspace_id, workspaces(rule_delivered_texts)").eq("id", id).maybeSingle();
    const wsId = (cv as any)?.workspace_id as string | undefined;
    if (wsId && !rulesOf.has(wsId)) rulesOf.set(wsId, { delivered: (cv as any)?.workspaces?.rule_delivered_texts ?? [] });
    const a = analyze(msgs as Msg[], Date.now(), (wsId && rulesOf.get(wsId)) || {});
    const { error: updateError } = await db.from("conversations").update({
      ...a,
      started_at: msgs[0].sent_at,
      last_message_at: msgs[msgs.length - 1].sent_at,
      last_dir: msgs[msgs.length - 1].direction,
      last_out_at: [...msgs].reverse().find((m) => m.direction === "out")?.sent_at ?? null,
      analyzed_at: new Date().toISOString(),
    }).eq("id", id);
    if (updateError) throw new Error(`could not save conversation analysis: ${updateError.message}`);
    // The owner's "175,000✅" reply becomes a confirmed paid order (see ticks.ts).
    // Never let this block message processing: a failure here is logged and retried on the next message.
    await confirmTicks(db, id, msgs as TickMsg[]).catch((e) => console.error("tick orders", String((e as Error)?.message ?? e).slice(0, 200)));
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors } });

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
