import { describe, it, expect } from "vitest";
import { delta, diagnoseWs, dataGaps, nextSupportAction, projectMonth, usageAlerts, usd, daysOnStep, stepAction, recoveryFor, type PerfPeriod, type PerfWs, type ApiUsage } from "../src/adminInsights";
import { usageRow } from "../../supabase/functions/_shared/usage";

const period = (o: Partial<PerfPeriod> = {}): PerfPeriod => ({
  chats: 0, replied: 0, qualified: 0, signals: 0, unconfirmed: 0, orders: 0, revenue: 0, other_currency_orders: 0, unlinked_orders: 0,
  orders_no_cost: 0, unanswered: 0, slow: 0, median_frt: null, silent_after_price: 0, pay_details: 0, awaiting_payment: 0, warm: 0,
  warm_no_follow: 0, ad_chats: 0, known_source: 0, kito_read: 0, spend: null, spend_currency: null, ...o,
});
const ws = (cur: Partial<PerfPeriod> = {}, o: Partial<PerfWs> = {}): PerfWs => ({
  id: "w", name: "Biz", currency: "TZS", fx_rate: null, status: "active", cur: period(cur), prev: period(), refunds: 0,
  profile_set: true, meta_connected: true, wa_live: true, ...o,
});

describe("performance rules", () => {
  it("computes deltas safely", () => {
    expect(delta(15, 10)).toBeCloseTo(0.5);
    expect(delta(0, 0)).toBe(0);
    expect(delta(5, 0)).toBeNull();
  });
  it("flags unanswered chats and ranks them first", () => {
    const f = diagnoseWs(ws({ chats: 20, replied: 12, unanswered: 8, kito_read: 20, known_source: 20, unconfirmed: 1 }));
    expect(f[0]!.kind).toBe("unanswered");
    expect(f[0]!.severity).toBe("bad");
    expect(f.some((x) => x.kind === "unconfirmed")).toBe(true);
  });
  it("calls a clean business healthy", () => {
    const f = diagnoseWs(ws({ chats: 10, replied: 10, kito_read: 10, known_source: 10, median_frt: 60 }));
    expect(f.map((x) => x.kind)).toEqual(["healthy"]);
  });
  it("lists data gaps for coverage and settings", () => {
    const g = dataGaps(ws({ chats: 10, kito_read: 2, known_source: 2, spend_currency: "USD", orders_no_cost: 3 }, { profile_set: false }));
    expect(g.join("|")).toMatch(/Kito has read 20%/);
    expect(g.join("|")).toMatch(/exchange rate/);
    expect(g.join("|")).toMatch(/3 orders without a cost/);
    expect(g.join("|")).toMatch(/business profile/);
  });
  it("picks a next support action", () => {
    expect(nextSupportAction(ws({}, { wa_live: false })).text).toMatch(/connect WhatsApp/);
    expect(nextSupportAction({ ...ws(), prev: period({ chats: 9 }) }).tone).toBe("bad");
    expect(nextSupportAction(ws({ chats: 20, replied: 12, unanswered: 8, kito_read: 20, known_source: 20 })).text).toMatch(/inbox/);
  });
});

describe("AI usage", () => {
  const base = (o: Partial<ApiUsage> = {}): ApiUsage => ({
    days: 30, from: "", totals: { calls: 100, errors: 2, retries: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost: 5, unpriced: 0 },
    today: { calls: 10, cost: 0.2, errors: 0 }, month: { calls: 100, cost: 5, from: "", day_of_month: 10, days_in_month: 30 },
    baseline: { avg_cost: 0.2, avg_calls: 10 }, daily: { days: [], cost: [], calls: [], errors: [] },
    by_feature: [], by_model: [], by_workspace: [], recent_errors: [], pricing: [], budget: { monthly_usd: null, daily_usd: null, spike_multiplier: 3 },
    first_logged_at: null, generated_at: "", ...o,
  });
  it("projects month end", () => { expect(projectMonth(5, 10, 30)).toBe(15); });
  it("warns before the monthly budget is passed", () => {
    expect(usageAlerts(base({ budget: { monthly_usd: 12, daily_usd: null, spike_multiplier: 3 } }))[0]!.text).toMatch(/On track/);
    expect(usageAlerts(base({ budget: { monthly_usd: 4, daily_usd: null, spike_multiplier: 3 } }))[0]!.tone).toBe("bad");
    expect(usageAlerts(base())).toEqual([]);
  });
  it("flags spikes and daily overrun", () => {
    const a = usageAlerts(base({ today: { calls: 90, cost: 1.5, errors: 0 }, budget: { monthly_usd: null, daily_usd: 1, spike_multiplier: 3 } }));
    expect(a.map((x) => x.tone)).toEqual(["bad", "warn"]);
  });
  it("formats dollars", () => { expect(usd(0)).toBe("$0"); expect(usd(0.004)).toBe("<$0.01"); expect(usd(3.456)).toBe("$3.46"); });
  it("reads cache tokens and errors from an API response, never content", () => {
    const r = usageRow({ feature: "ask_kito", workspaceId: "w", attempt: 2 }, "claude-sonnet-5-5", 200, true,
      { model: "claude-sonnet-5-5", content: [{ type: "text", text: "secret" }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 } }, 12.4, "req_1");
    expect(r).toMatchObject({ input_tokens: 10, output_tokens: 5, cache_read_tokens: 100, cache_write_tokens: 7, attempt: 2, ok: true, error: null, duration_ms: 12 });
    expect(JSON.stringify(r)).not.toMatch(/secret/);
    expect(usageRow({ feature: "chat_analysis", workspaceId: null }, "m", 529, false, { error: { message: "Overloaded" } }, 1, null).error).toBe("Overloaded");
  });
});

describe("onboarding and recovery", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const o = { workspace_id: "w", joined_at: "2026-11-01T12:00:00Z", wa_at: "2026-11-10T12:00:00Z", first_chat_at: null, meta_at: null,
    first_sale_at: null, last_owner_sign_in: null, open_tasks: 0, overdue_tasks: 0, next_task: null, next_due: null };
  it("counts days since the previous step was done", () => {
    expect(daysOnStep(o, 0, now)).toBe(18);
    expect(daysOnStep(o, 1, now)).toBe(9);
    expect(daysOnStep(o, 2, now)).toBe(9); // first chat time unknown: falls back to WhatsApp
    expect(daysOnStep(o, 3, now)).toBe(9); // chat rules: no timestamp, falls back too
    expect(daysOnStep(o, 5, now)).toBeNull();
    expect(stepAction(1, 9)!.tone).toBe("warn");
    expect(stepAction(0, 20)!.tone).toBe("bad");
  });
  it("explains common connection errors", () => {
    expect(recoveryFor("connection:meta_ads", "Graph 400: Error validating access token (code 190/463)")!.cause).toMatch(/token expired/);
    expect(recoveryFor("webhook:unrouted", "Event for a number not linked to any workspace (messages)")!.cause).toMatch(/not linked/);
    expect(recoveryFor("stuck:messages", "Started processing 19 Nov 10:00 and never finished.")!.steps[0]).toMatch(/Retry/);
    expect(recoveryFor("kito-tag", "something novel")).toBeNull();
    // Kito's own AI request errors are not webhook or credit problems
    expect(recoveryFor("kito-run", "1 chat(s) failed: AI 400: The request body is not valid JSON: unexpected end of hex escape at line 1 column 2380")!.cause).toMatch(/emoji/);
    expect(recoveryFor("kito-ask", "AI 400: messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.")!.cause).toMatch(/reasoning/);
    expect(recoveryFor("kito-run", "1 chat(s) failed: AI 400: tools.0: unknown field")!.cause).toMatch(/bug/);
    expect(recoveryFor("kito-run", "1 chat(s) failed: AI 400: Your credit balance is too low")!.cause).toMatch(/credit/);
    expect(recoveryFor("kito-run", "1 chat(s) failed: AI 529: Overloaded")!.cause).toMatch(/overloaded/);
    expect(recoveryFor("webhook:messages", "signature mismatch")!.cause).toMatch(/Webhook signature/);
  });
});
