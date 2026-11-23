// Team members and assignment: who on the business's team owns a chat or an order.
// Tasks already had an owner (Actions page); 0033 adds the same for chats and orders.
import { errText } from "./errText";
import { useEffect, useState } from "react";
import { supabase, Workspace, canEdit } from "./lib";

export type Member = { user_id: string; role: string; email: string };

const cache = new Map<string, Promise<{ members: Member[]; me: string }>>();
/** Members of the workspace and the signed-in user's id (loaded once per page load). */
export function useTeam(wsId: string) {
  const [t, setT] = useState<{ members: Member[]; me: string }>({ members: [], me: "" });
  useEffect(() => {
    let live = true;
    if (!cache.has(wsId)) cache.set(wsId, Promise.all([supabase.rpc("workspace_members", { p_ws: wsId }), supabase.auth.getUser()])
      .then(([m, u]) => ({ members: (m.data as Member[]) ?? [], me: u.data.user?.id ?? "" })));
    cache.get(wsId)!.then((v) => { if (live) setT(v); });
    return () => { live = false; };
  }, [wsId]);
  return t;
}

export const shortName = (email: string) => email.split("@")[0];

/** A small "Assigned to" picker. Hidden when the business has only one person. */
export function AssignSelect({ ws, value, onChange, busy, label = true }: {
  ws: Workspace; value: string | null | undefined; onChange: (user: string | null) => void; busy?: boolean; label?: boolean;
}) {
  const { members, me } = useTeam(ws.id);
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  if (members.length < 2 && !value) return null;
  return (
    <label className="assign small">
      {label && <span className="muted">{T("Assigned to", "Anayeshughulikia")}</span>}
      <select value={value ?? ""} disabled={busy || !canEdit(ws)} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{T("Nobody", "Hakuna")}</option>
        {members.map((m) => <option key={m.user_id} value={m.user_id}>{shortName(m.email)}{m.user_id === me ? T(" (me)", " (mimi)") : ""}</option>)}
      </select>
    </label>
  );
}

/** Chat assignment, saved through the assign_chat RPC (editors only, assignee must be on the team). */
export function AssignChat({ ws, conversationId }: { ws: Workspace; conversationId: string }) {
  const [value, setValue] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    supabase.from("conversations").select("assigned_to").eq("id", conversationId).maybeSingle()
      .then(({ data, error }) => { if (live) setValue(error ? undefined : ((data as any)?.assigned_to ?? null)); });
    return () => { live = false; };
  }, [conversationId]);
  if (value === undefined) return null;   // older database without 0032: nothing to show
  return (
    <div className="assign-row">
      <AssignSelect ws={ws} value={value} busy={busy} onChange={async (u) => {
        setBusy(true); setErr("");
        const { error } = await supabase.rpc("assign_chat", { p_conv: conversationId, p_user: u });
        setBusy(false);
        if (error) setErr(errText(error)); else setValue(u);
      }} />
      {err && <span className="err small">{err}</span>}
    </div>
  );
}
