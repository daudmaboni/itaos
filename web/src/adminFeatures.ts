// Admin: which business-app features a business has set up and is using (admin_feature_use, migration 0080).
// Pure, so the rules are tested: each feature gets ok / warn / off, one line of evidence and, when it isn't
// working for them, what Pondi staff can suggest.

export type FeatureUse = {
  id: string; name: string;
  followups_30d: number; sales_after_followup_30d: number;
  promises: { proposed: number; open: number; overdue: number } | null;
  reorder_on: boolean; reorder_marks_30d: number;
  send_on: boolean; itaos_sent_30d: number; templates: Record<string, number>;
  products: { active: number; priced: number; costed: number } | null; unit_cost_set: boolean;
  receipt_links: number; receipt_scans_30d: number;
  wallet: { lines: number; last_upload: string | null; not_recorded: number } | null;
  ads: { running: number; all: number } | null; ad_spend_14d: number; ad_last_day: string | null;
  pay_receivers: number; screenshots_30d: number; payments_to_check: number; fakes_caught: number;
  team: number; assigned_30d: number;
  push_devices: number; alerts_open: number; voice_30d: number; kito_read_30d: number;
  rules_reviewed_at: string | null; branded: boolean; proof_test: number | null;
};

export type FState = "ok" | "warn" | "off";
export type FRow = { key: string; group: string; label: string; state: FState; text: string; hint?: string };

const n = (x: number | null | undefined) => (x ?? 0).toLocaleString("en-US");
const s = (x: number, one: string, many = one + "s") => `${n(x)} ${x === 1 ? one : many}`;

export function featureRows(f: FeatureUse, now = Date.now()): FRow[] {
  const p = f.promises ?? { proposed: 0, open: 0, overdue: 0 };
  const pr = f.products ?? { active: 0, priced: 0, costed: 0 };
  const w = f.wallet ?? { lines: 0, last_upload: null, not_recorded: 0 };
  const ads = f.ads ?? { running: 0, all: 0 };
  const approved = f.templates?.approved ?? 0, pending = f.templates?.pending ?? 0, rejected = f.templates?.rejected ?? 0;
  const tplTotal = Object.values(f.templates ?? {}).reduce((a, b) => a + b, 0);
  const daysSince = (iso: string | null) => (iso ? Math.floor((now - Date.parse(iso)) / 864e5) : null);
  const walletAge = daysSince(w.last_upload);
  const rows: FRow[] = [
    // Follow-ups
    { key: "today", group: "Follow-ups", label: "Today / follow-ups",
      state: f.followups_30d >= 5 ? "ok" : f.followups_30d > 0 ? "warn" : "off",
      text: `${s(f.followups_30d, "follow-up")} done in 30 days · ${s(f.sales_after_followup_30d, "sale")} within 14 days after one`,
      hint: f.followups_30d < 5 ? "Show them Actions → Today: one list of who to contact now." : undefined },
    { key: "promises", group: "Follow-ups", label: "Ahadi (promises)",
      state: p.overdue > 10 || p.proposed > 30 ? "warn" : p.open + p.proposed > 0 ? "ok" : "off",
      text: `${s(p.proposed, "suggested promise")} waiting to confirm · ${n(p.open)} open · ${n(p.overdue)} overdue`,
      hint: p.overdue > 10 ? "Many promises are overdue: they aren't opening Ahadi. Remind them it reminds them on the day." : p.proposed > 30 ? "Kito suggested many promises nobody confirmed." : undefined },
    { key: "reorders", group: "Follow-ups", label: "Buy-again reminders",
      state: f.reorder_on ? (f.reorder_marks_30d > 0 ? "ok" : "warn") : "off",
      text: f.reorder_on ? `${s(f.reorder_marks_30d, "reminder")} handled in 30 days` : "Switched off",
      hint: !f.reorder_on ? "Turn on in Settings → Rules if their product runs out (e.g. a 30-day course)." : undefined },
    // Sending
    { key: "send", group: "Sending", label: "Send from itaOS",
      state: !f.send_on ? "off" : f.itaos_sent_30d > 0 ? "ok" : "warn",
      text: !f.send_on ? "Off (by the owner or by Pondi)" : `${s(f.itaos_sent_30d, "message")} sent from itaOS in 30 days`,
      hint: !f.send_on ? "Without it, Send from itaOS on Today and follow-ups can't work." : undefined },
    { key: "templates", group: "Sending", label: "Messages after 24 hours",
      state: approved > 0 ? "ok" : pending > 0 ? "warn" : "off",
      text: tplTotal ? `${n(approved)} approved · ${n(pending)} waiting · ${n(rejected)} rejected` : "None sent to WhatsApp for approval",
      hint: approved === 0 ? "They can only message quiet customers after 24 h with an approved template: Settings → Rules → Messages after 24 hours." : undefined },
    // Money
    { key: "products", group: "Money", label: "My products",
      state: pr.active === 0 ? "off" : pr.priced < pr.active || pr.costed < pr.active ? "warn" : "ok",
      text: pr.active ? `${n(pr.active)} active · ${n(pr.priced)} with a price · ${n(pr.costed)} with a cost` : "No products yet",
      hint: pr.active && pr.priced < pr.active ? "Products without a price: Kito can't check amounts or suggest the right price." : pr.active === 0 ? "Add products so sales get the right cost and profit." : undefined },
    { key: "receipts", group: "Money", label: "Receipts with QR code",
      state: f.receipt_links > 0 ? "ok" : "off",
      text: `${s(f.receipt_links, "receipt")} printed or shared · ${s(f.receipt_scans_30d, "customer scan")} in 30 days` },
    { key: "wallet", group: "Money", label: "Check your M-Pesa",
      state: w.lines === 0 ? "off" : walletAge != null && walletAge > 14 ? "warn" : "ok",
      text: w.lines ? `${s(w.lines, "payment")} pasted, last ${walletAge === 0 ? "today" : `${walletAge} days ago`} · ${n(w.not_recorded)} not recorded as sales` : "Never used",
      hint: w.lines === 0 ? "Pasting their M-Pesa SMS finds paid sales itaOS missed, and turns on the 'not in your M-Pesa' fake check." : walletAge != null && walletAge > 14 ? "Last paste is old: ask for this week's SMS." : undefined },
    // Ads
    { key: "ads", group: "Ads", label: "Ad money manager",
      state: ads.all === 0 ? "off" : ads.running === 0 ? "warn" : "ok",
      text: ads.all ? `${n(ads.running)} running of ${n(ads.all)} · spend ${n(Math.round(f.ad_spend_14d))} in 14 days · data to ${f.ad_last_day ?? "–"}` : "Meta Ads not connected",
      hint: ads.all === 0 ? "Connect Meta Ads from their own login at itaos.app/app#connect/setup." : ads.running === 0 ? "No ad is running, so the manager has nothing to judge." : ads.running === 1 ? "Only one ad running: the manager can't compare. Suggest a second ad." : undefined },
    // Guards
    { key: "fakes", group: "Guards", label: "Fake payment guard",
      state: f.screenshots_30d === 0 ? "off" : f.pay_receivers === 0 || f.payments_to_check > 0 ? "warn" : "ok",
      text: `${s(f.screenshots_30d, "payment screenshot")} in 30 days · ${n(f.payments_to_check)} to check · ${s(f.fakes_caught, "fake")} caught${f.pay_receivers ? "" : " · payment numbers not set"}`,
      hint: f.pay_receivers === 0 && f.screenshots_30d > 0 ? "Ask them to add their Lipa namba on Payment checks so 'paid to someone else' works." : f.payments_to_check > 0 ? "Screenshots are waiting for a decision on Payment checks." : undefined },
    { key: "team", group: "Guards", label: "Team and staff leak guard",
      state: f.team >= 2 ? (f.assigned_30d > 0 ? "ok" : "warn") : "off",
      text: `${s(f.team, "person", "people")} · ${s(f.assigned_30d, "chat")} assigned in 30 days`,
      hint: f.team < 2 ? "If staff answer chats, add them below (People) so each person's numbers show." : f.assigned_30d === 0 ? "Staff added, but no chats are assigned." : undefined },
    // App
    { key: "kito", group: "App", label: "Kito reading chats", state: f.kito_read_30d > 0 ? "ok" : "off", text: `${s(f.kito_read_30d, "chat")} read in 30 days` },
    { key: "push", group: "App", label: "Phone alerts", state: f.push_devices > 0 ? "ok" : "off", text: f.push_devices ? `${s(f.push_devices, "device")}` : "No phone gets alerts",
      hint: f.push_devices ? undefined : "Install the app on their phone and allow alerts (Settings → App & notifications)." },
    { key: "voice", group: "App", label: "Voice notes in Chats", state: f.voice_30d > 0 ? "ok" : "off", text: `${s(f.voice_30d, "voice note")} saved in 30 days` },
    { key: "rules", group: "App", label: "Rules and look",
      state: f.rules_reviewed_at && f.branded ? "ok" : f.rules_reviewed_at || f.branded ? "warn" : "off",
      text: `${f.rules_reviewed_at ? "Rules checked" : "Rules never checked"} · ${f.branded ? "receipt brand set" : "no brand on receipts"}${f.unit_cost_set ? "" : " · no default cost"}` },
    { key: "health", group: "App", label: "Connection health", state: f.alerts_open > 0 ? "warn" : "ok", text: f.alerts_open ? `${s(f.alerts_open, "open problem")}` : "No open problems" },
  ];
  return rows;
}

/** 0–100: share of features in use (ok = 1, warn = ½). For sorting and the grid's score column. */
export function adoption(rows: FRow[]): number {
  const v = rows.reduce((a, r) => a + (r.state === "ok" ? 1 : r.state === "warn" ? 0.5 : 0), 0);
  return Math.round((v / Math.max(1, rows.length)) * 100);
}
