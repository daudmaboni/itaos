// Pure rules behind the newer staff-admin views (Performance, AI usage, Data quality, onboarding
// follow-through, connection recovery). No React, no network: unit-tested in test/adminInsights.test.ts.
// Data comes from admin_performance / admin_api_usage / admin_onboarding / admin_data_quality (0031).

/* ---------------- performance ---------------- */
export type PerfPeriod = {
  chats: number; replied: number; qualified: number; signals: number; unconfirmed: number;
  orders: number; revenue: number; other_currency_orders: number; unlinked_orders: number; orders_no_cost: number;
  unanswered: number; slow: number; median_frt: number | null; silent_after_price: number; pay_details: number;
  awaiting_payment: number; warm: number; warm_no_follow: number; ad_chats: number; known_source: number; kito_read: number;
  spend: number | null; spend_currency: string | null;
};
export type PerfWs = {
  id: string; name: string; currency: string; fx_rate: number | null; status: string;
  cur: PerfPeriod; prev: PerfPeriod; refunds: number; profile_set: boolean; meta_connected: boolean; wa_live: boolean;
};
export type Performance = {
  days: number; from: string; prev_from: string; to: string; workspaces: PerfWs[];
  daily: { days: string[]; chats: number[]; replied: number[]; qualified: number[]; signals: number[]; orders: number[] };
  generated_at: string;
};

export type FunnelKey = 'chats' | 'replied' | 'qualified' | 'signals' | 'orders';
export const FUNNEL: { key: FunnelKey; label: string; kind: 'observed' | 'inferred' | 'confirmed'; hint: string }[] = [
  { key: 'chats', label: 'Chats', kind: 'observed', hint: 'Chats started in the period (people marked "not a customer" left out)' },
  { key: 'replied', label: 'Replied', kind: 'observed', hint: 'The business sent at least one message' },
  { key: 'qualified', label: 'Qualified', kind: 'inferred', hint: 'A price was shared in the chat' },
  { key: 'signals', label: 'Payment signals', kind: 'inferred', hint: 'Payment words, screenshot, Kito or ✅: not confirmed' },
  { key: 'orders', label: 'Confirmed orders', kind: 'confirmed', hint: 'Recorded paid orders, by paid date' },
];

/** Change vs previous period. null when there is no base to compare with. */
export function delta(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0;
  return (cur - prev) / prev;
}

export function sumPeriods(list: PerfPeriod[], key: keyof PerfPeriod): number {
  return list.reduce((s, p) => s + (typeof p?.[key] === 'number' ? (p[key] as number) : 0), 0);
}

export type Severity = 'bad' | 'warn' | 'info' | 'good';
export type PerfFinding = { kind: string; severity: Severity; title: string; detail: string; action: string; score: number };

/** Rule-based summary of where one business's chats stall, mirroring web/src/diagnosis.ts thresholds
 *  (simplified to counts: staff see the pattern, the owner's own Diagnosis page has the chats). */
export function diagnoseWs(w: PerfWs): PerfFinding[] {
  const c = w.cur, N = c.chats, out: PerfFinding[] = [];
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');
  if (N && c.unanswered >= Math.max(2, N * 0.1)) out.push({ kind: 'unanswered', severity: c.unanswered / N >= 0.25 ? 'bad' : 'warn', score: 90 * (c.unanswered / N) + c.unanswered,
    title: `${c.unanswered} chats never got a reply`, detail: `${pct(c.unanswered, N)} of ${N} chats have no message from the business.`,
    action: 'Call the owner: agree a daily inbox time and show them the Actions queue.' });
  const replied = c.replied;
  if (c.median_frt != null && replied >= 3 && (c.median_frt > 1800 || c.slow >= Math.max(3, replied * 0.2))) out.push({ kind: 'slow_reply', severity: c.median_frt > 3600 ? 'bad' : 'warn', score: 60 * (c.slow / replied) + c.slow,
    title: 'First replies are slow', detail: `Median first reply ${Math.round(c.median_frt / 60)} min; ${c.slow} of ${replied} waited over an hour.`,
    action: 'Suggest a 15-minute reply target during ad hours and saved replies for the first message.' });
  if (c.qualified >= 5 && c.silent_after_price / c.qualified >= 0.3) out.push({ kind: 'price', severity: c.silent_after_price / c.qualified >= 0.5 ? 'bad' : 'warn', score: 70 * (c.silent_after_price / c.qualified),
    title: `${c.silent_after_price} customers went quiet after the price`, detail: `${pct(c.silent_after_price, c.qualified)} of chats where a price was shared.`,
    action: 'Review their price message with them: value first, then price with a question.' });
  if (c.warm_no_follow >= 3) out.push({ kind: 'no_follow_up', severity: 'bad', score: 80 * (c.warm ? c.warm_no_follow / c.warm : 0) + c.warm_no_follow,
    title: `${c.warm_no_follow} warm customers waiting on a follow-up`, detail: `Of ${c.warm} warm chats, ${c.warm_no_follow} ended on the customer's message.`,
    action: 'Walk the owner through the follow-up queue and Kito drafts.' });
  if (c.pay_details >= 4 && c.awaiting_payment / c.pay_details >= 0.4) out.push({ kind: 'payment_friction', severity: 'warn', score: 65 * (c.awaiting_payment / c.pay_details),
    title: `${c.awaiting_payment} got payment details and didn't pay`, detail: `${pct(c.awaiting_payment, c.pay_details)} of chats that reached payment instructions.`,
    action: 'Suggest one reminder 24 h after payment details, and pay-on-delivery where possible.' });
  if (c.unconfirmed >= 1) out.push({ kind: 'unconfirmed', severity: c.unconfirmed >= 5 ? 'warn' : 'info', score: 20 + c.unconfirmed,
    title: `${c.unconfirmed} payments detected but not recorded`, detail: 'Revenue and cost per sale leave these out until the owner confirms them.',
    action: 'Ask the owner to confirm or dismiss them in Chats (Bought / Payment detected).' });
  if (w.refunds >= 1) out.push({ kind: 'fulfilment', severity: w.refunds >= 2 ? 'bad' : 'warn', score: 15 * w.refunds,
    title: `${w.refunds} refunds or returns`, detail: 'Orders refunded or returned in this period.', action: 'Ask what went wrong with delivery or the product.' });
  const gaps = dataGaps(w);
  if (gaps.length) out.push({ kind: 'data_gap', severity: 'info', score: 5, title: 'Some figures are incomplete', detail: `Missing: ${gaps.join('; ')}.`,
    action: 'Help the owner fill these in (Settings, Connections, or when confirming payments).' });
  if (N > 0 && !out.some((f) => f.severity === 'bad' || f.severity === 'warn')) out.push({ kind: 'healthy', severity: 'good', score: 0,
    title: 'No major leak found', detail: `${N} chats, ${c.orders} confirmed orders.`, action: 'Nothing to chase. A short check-in keeps them engaged.' });
  return out.sort((a, b) => b.score - a.score);
}

/** What limits the numbers for one business (source health and coverage). */
export function dataGaps(w: PerfWs): string[] {
  const c = w.cur, g: string[] = [];
  if (!w.wa_live) g.push('WhatsApp not live');
  if (c.chats >= 5 && c.kito_read / c.chats < 0.7) g.push(`Kito has read ${Math.round((c.kito_read / c.chats) * 100)}% of chats`);
  if (c.chats >= 5 && c.known_source / c.chats < 0.5) g.push('most chats have no known source (ad vs organic)');
  if (!w.meta_connected) g.push('no ad account, so no spend or cost per sale');
  else if (c.spend_currency && c.spend_currency !== w.currency && w.fx_rate == null) g.push('exchange rate');
  if (c.orders_no_cost > 0) g.push(`${c.orders_no_cost} orders without a cost`);
  if (c.other_currency_orders > 0) g.push(`${c.other_currency_orders} orders in another currency (left out of revenue)`);
  if (!w.profile_set) g.push('business profile (Kito drafts are less grounded)');
  return g;
}

/** Coverage 0..1 of the period's chats Kito has read and whose source is known (null when no chats). */
export function coverage(w: PerfWs): { kito: number | null; source: number | null } {
  const N = w.cur.chats;
  return { kito: N ? w.cur.kito_read / N : null, source: N ? w.cur.known_source / N : null };
}

/** The single next thing staff should do for this business. */
export function nextSupportAction(w: PerfWs): { tone: Severity; text: string } {
  if (w.status === 'suspended') return { tone: 'info', text: 'Suspended. Nothing to do unless they come back.' };
  if (!w.wa_live) return { tone: 'warn', text: 'Help them connect WhatsApp: nothing can be measured until it is live.' };
  if (w.cur.chats === 0) return { tone: w.prev.chats > 0 ? 'bad' : 'warn', text: w.prev.chats > 0 ? 'Chats stopped this period. Check their WhatsApp connection and ads.' : 'No chats yet. Check their ads are running and pointing to WhatsApp.' };
  const top = diagnoseWs(w)[0];
  return top ? { tone: top.severity, text: top.action } : { tone: 'good', text: 'Running well.' };
}

/* ---------------- AI usage & cost ---------------- */
export type ApiBudget = { monthly_usd: number | null; daily_usd: number | null; spike_multiplier: number | null };
export type ApiUsage = {
  days: number; from: string;
  totals: { calls: number; errors: number; retries: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost: number; unpriced: number };
  today: { calls: number; cost: number; errors: number };
  month: { calls: number; cost: number; from: string; day_of_month: number; days_in_month: number };
  baseline: { avg_cost: number; avg_calls: number; n_days?: number };
  today_hourly?: { cost: number[]; calls: number[]; errors: number[]; by_feature: Record<string, number[]>;
    features: { feature: string; calls: number; errors: number; cost: number; last_error: string | null; last_ok?: boolean }[] };
  daily: { days: string[]; cost: number[]; calls: number[]; errors: number[] };
  by_feature: { feature: string; calls: number; errors: number; retries: number; input_tokens: number; output_tokens: number; cost: number }[];
  by_model: { model: string; priced: boolean; calls: number; errors: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost: number }[];
  by_workspace: { workspace_id: string | null; name: string | null; calls: number; errors: number; input_tokens: number; output_tokens: number; cost: number; cost_today: number; by_feature: Record<string, number> }[];
  recent_errors: { at: string; feature: string; model: string; status: number | null; error: string | null; attempt: number; workspace_name: string | null }[];
  pricing: { model: string; input_per_mtok: number; output_per_mtok: number; cache_read_per_mtok: number; cache_write_per_mtok: number; long_over_tokens: number | null; long_multiplier: number; updated_at: string; updated_by_email: string | null }[];
  budget: ApiBudget | null; first_logged_at: string | null; generated_at: string;
};

export const FEATURE_LABEL: Record<string, string> = {
  ask_kito: 'Ask Kito', chat_analysis: 'Chat analysis (Kito labels)', reply_draft: 'Reply drafts',
  content_ideas: 'Content ideas', receipt_reading: 'Payment screenshots', product_matching: 'Product photos', voice_transcription: 'Voice notes to text', name_reading: 'Buyer names for receipts',
};

/** Straight-line month-end projection from spend so far. */
export function projectMonth(costSoFar: number, dayOfMonth: number, daysInMonth: number): number {
  if (dayOfMonth <= 0) return costSoFar;
  return (costSoFar / dayOfMonth) * daysInMonth;
}

export type UsageAlert = { tone: 'bad' | 'warn' | 'info'; text: string };
export function usageAlerts(u: ApiUsage): UsageAlert[] {
  const out: UsageAlert[] = [];
  const b = u.budget ?? { monthly_usd: null, daily_usd: null, spike_multiplier: 3 };
  const proj = projectMonth(u.month.cost, u.month.day_of_month, u.month.days_in_month);
  if (b.monthly_usd) {
    if (u.month.cost >= b.monthly_usd) out.push({ tone: 'bad', text: `Over the monthly budget: ${usd(u.month.cost)} of ${usd(b.monthly_usd)} spent this month.` });
    else if (proj >= b.monthly_usd) out.push({ tone: 'warn', text: `On track to pass the monthly budget: about ${usd(proj)} by month end (budget ${usd(b.monthly_usd)}).` });
    else if (u.month.cost >= b.monthly_usd * 0.8) out.push({ tone: 'warn', text: `${Math.round((u.month.cost / b.monthly_usd) * 100)}% of the monthly budget used.` });
  }
  if (b.daily_usd && u.today.cost >= b.daily_usd) out.push({ tone: 'bad', text: `Today's estimated cost ${usd(u.today.cost)} is over the daily alert of ${usd(b.daily_usd)}.` });
  const mult = b.spike_multiplier ?? 3;
  if (u.baseline.avg_cost > 0 && u.today.cost > u.baseline.avg_cost * mult && u.today.cost >= 0.05)
    out.push({ tone: 'warn', text: `Unusually high usage today: ${usd(u.today.cost)} vs about ${usd(u.baseline.avg_cost)} on a normal day.` });
  for (const w of u.by_workspace) {
    const share = u.today.cost > 0 ? w.cost_today / u.today.cost : 0;
    if (w.cost_today >= 0.25 && share >= 0.6 && u.by_workspace.length > 1) out.push({ tone: 'info', text: `${w.name ?? 'Unlinked calls'} is ${Math.round(share * 100)}% of today's cost.` });
  }
  if (u.totals.calls >= 10 && u.totals.errors / u.totals.calls >= 0.1) out.push({ tone: 'warn', text: `${Math.round((u.totals.errors / u.totals.calls) * 100)}% of API calls failed in this period.` });
  if (u.totals.unpriced > 0) out.push({ tone: 'info', text: `${u.totals.unpriced} calls used a model with no price set, so they count as $0. Add its price below.` });
  return out;
}

/* Plain-language explanation of today's spend, with advice. Uses today's hourly cost per feature to tell
 * one-off bursts (Kito re-reading every chat after a rule change, a voice-note catch-up) from normal use. */
export type TodayLine = { feature: string; title: string; cost: number; calls: number; burstHour: number | null; burstCost: number; why: string; advice: string | null; tone: 'info' | 'warn' | 'bad' };
export type TodayExplain = { headline: string; caveat: string | null; lines: TodayLine[]; withoutBursts: number | null; verdict: string };
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
export function explainToday(u: ApiUsage): TodayExplain | null {
  const th = u.today_hourly;
  if (!th) return null;
  const base = u.baseline.avg_cost, nDays = u.baseline.n_days ?? 14, today = u.today.cost;
  const ratio = base > 0 ? today / base : null;
  const headline = today === 0 ? 'No AI calls yet today.'
    : ratio == null ? `Today so far: ${usd(today)}. There's no earlier day to compare with yet.`
    : `Today so far: ${usd(today)}, against about ${usd(base)} on a normal day (${ratio >= 1 ? `${ratio.toFixed(1)}×` : `${Math.round(ratio * 100)}%`}).`;
  const caveat = nDays > 0 && nDays < 5 ? `"Normal day" is the average of only ${nDays} day${nDays === 1 ? '' : 's'} of full logging, so treat it as rough for now.` : null;
  let bursts = 0;
  const lines: TodayLine[] = th.features.filter((f) => f.cost > 0 || f.errors > 0).map((f) => {
    const hrs = th.by_feature[f.feature] ?? [];
    let bh = -1, bc = 0;
    hrs.forEach((c, h) => { if (c > bc) { bc = c; bh = h; } });
    const burst = bh >= 0 && bc >= 0.1 && bc >= f.cost * 0.4;
    if (burst) bursts += bc;
    const title = FEATURE_LABEL[f.feature] ?? f.feature;
    const at = burst ? ` Most of it (${usd(bc)}) came in one burst around ${hh(bh)}.` : '';
    let why = `${f.calls.toLocaleString()} calls.${at}`, advice: string | null = null, tone: TodayLine['tone'] = 'info';
    switch (f.feature) {
      case 'chat_analysis':
        why += burst ? ' A burst like this is Kito re-labelling many chats at once: it happens after a change to Kito\'s labelling rules (every chat is read again) or when many chats gain new text at once, such as voice notes turning into words.'
                     : ' Kito labelling new messages as they arrive. It grows with the number of chats.';
        advice = burst ? 'One-off, nothing to fix. To keep it down, bundle Kito rule changes into one release a day instead of several.' : null;
        break;
      case 'voice_transcription':
        why += burst ? ' Voice notes being turned into text. The first runs catch up on the past 7 days of saved voice notes, so this settles once the backlog is done.'
                     : ' Voice notes being turned into text as customers send them.';
        advice = 'Each transcribed voice note also makes Kito re-read that chat, which adds a little to Chat analysis.';
        break;
      case 'ask_kito':
        why += ` Questions asked to Kito use the larger model, about ${usd(f.calls ? f.cost / f.calls : 0)} per question.`;
        advice = f.cost > 0.5 ? 'Long questions over big date ranges cost the most; shorter ranges are cheaper.' : null;
        break;
      case 'receipt_reading': why += ' Payment screenshots read to confirm sales. It scales with sales, which is good spend.'; break;
      case 'name_reading': why += ' Kito reading each paying customer\'s chat once for their real name, so receipts don\'t print contact tags. It scales with sales.'; break;
      case 'product_matching': why += ' Product photos matched to your products.'; break;
      case 'reply_draft': why += ' Reply drafts written for owners.'; break;
      case 'content_ideas': why += ' Content ideas generated.'; break;
    }
    if (f.errors > 0) {
      const e = f.last_error ?? '';
      const provider = /^soniox/i.test(e) ? 'Soniox' : 'Anthropic';
      tone = 'warn';
      why += ` ${f.errors} failed${e ? `: "${e.length > 90 ? e.slice(0, 90) + '…' : e}"` : ''}.`;
      if (f.last_ok) { why += ' Calls are working again now.'; tone = 'info'; }
      else if (/balance|credit|exhausted|billing|payment required|quota/i.test(e)) { tone = 'bad'; advice = `Top up the ${provider} account or turn on auto-pay. Failed calls cost nothing, but the work waits until there's credit.`; }
      else if (/rate|429|overloaded|529/i.test(e)) advice = 'The provider was busy; itaOS retries on its own. Nothing to do unless it keeps happening.';
    }
    return { feature: f.feature, title, cost: f.cost, calls: f.calls, burstHour: burst ? bh : null, burstCost: burst ? bc : 0, why, advice, tone };
  });
  const withoutBursts = bursts > 0 ? today - bursts : null;
  const verdict = today === 0 ? 'Nothing to worry about.'
    : withoutBursts != null && base > 0 && withoutBursts <= base * 1.5 ? `Without the one-off burst${lines.filter((l) => l.burstHour != null).length > 1 ? 's' : ''}, today would be about ${usd(withoutBursts)}, a normal day. No action needed beyond the advice below.`
    : ratio != null && ratio <= 1.5 ? 'A normal day.'
    : ratio != null ? 'Higher than normal without a clear one-off cause. Check which business and feature grew in the breakdown below; a business with many new chats is the usual reason.'
    : 'Not enough history to judge yet.';
  return { headline, caveat, lines, withoutBursts, verdict };
}

export function usd(v: number | null | undefined): string {
  if (v == null) return '–';
  if (v === 0) return '$0';
  if (Math.abs(v) < 0.01) return '<$0.01';
  return `$${v.toFixed(v < 10 ? 2 : v < 1000 ? 1 : 0)}`;
}

/* ---------------- onboarding follow-through ---------------- */
export type OnboardingRow = {
  workspace_id: string; joined_at: string; wa_at: string | null; first_chat_at: string | null; meta_at: string | null;
  first_sale_at: string | null; last_owner_sign_in: string | null; open_tasks: number; overdue_tasks: number;
  next_task: string | null; next_due: string | null;
};

/** How long a business has sat on its current step: time since it finished the step before
 *  (or since joining). `step` is the index into the admin board's STEPS (0 = WhatsApp, 1 = first chat,
 *  2 = Meta Ads, 3 = first sale, 4 = done). Uses the latest reached milestone when timestamps are missing. */
export function daysOnStep(o: OnboardingRow | undefined, step: number, now = Date.now()): number | null {
  if (!o || step >= 4) return null;
  const marks = [o.joined_at, o.wa_at, o.first_chat_at, o.meta_at];
  let since: string | null = null;
  for (let i = step; i >= 0 && !since; i--) since = marks[i] ?? null;
  if (!since) return null;
  return Math.max(0, Math.floor((now - Date.parse(since)) / 86400e3));
}

const STEP_ACTION = [
  'Book a 15-minute call to connect their WhatsApp number through Dualhook (Coexistence).',
  'WhatsApp is connected but no customer chat has arrived. Check the webhook and send a test message.',
  'Help them link the Meta ad account so spend and cost per sale show.',
  'Show them how to confirm a payment in Chats (or send ✅) so sales start counting.',
];
export function stepAction(step: number, days: number | null): { tone: 'bad' | 'warn' | 'info'; text: string } | null {
  if (step >= 4) return null;
  const tone = days == null ? 'info' : days >= 14 ? 'bad' : days >= 5 ? 'warn' : 'info';
  return { tone, text: STEP_ACTION[step]! };
}

/* ---------------- connection recovery ---------------- */
export type Recovery = { cause: string; steps: string[] };
const RECOVERY: { test: RegExp; r: Recovery }[] = [
  // Kito's own AI request bugs come first: their text contains words ("signature", "AI 400") that the
  // webhook and credit rules below would otherwise claim.
  { test: /hex escape|not valid JSON/i,
    r: { cause: 'A chat had an emoji cut in half, which made the request to the AI invalid. Fixed in Kito on 18 Nov (broken emoji halves are now removed).',
         steps: ['Entries from before 18 Nov are history and need nothing.', 'If a new one appears, the kito function is running old code: redeploy it.'] } },
  { test: /thinking. block|block is bound|thinking block/i,
    r: { cause: 'Ask Kito resent its earlier reasoning after the instructions changed between steps, and the AI refused it. Fixed in Kito Ask on 18 Nov (instructions are built once per question).',
         steps: ['Entries from before 18 Nov are history and need nothing.', 'If a new one appears, the kito-ask function is running old code: redeploy it.'] } },
  { test: /code 190|access token|session has expired|token (has )?expired|invalid oauth|error validating access token|token unavailable/i,
    r: { cause: 'The Meta access token expired or was revoked (password change, removed app, or 60-day expiry).',
         steps: ['Ask the owner to open Connections and reconnect Meta Ads.', 'If it fails again, check the itaOS app still has access in their Business Settings → Integrations.', 'Then retry the sync.'] } },
  { test: /code (10|200|294)\b|permission|not authorized|\(#10\)|\(#200\)|ads_read|ads_management/i,
    r: { cause: 'The connected Facebook user lacks a permission on the ad account (ads_read) or the app was not granted it.',
         steps: ['Confirm the person who connected is an admin/analyst on the ad account.', 'Reconnect Meta Ads and tick every permission on the Facebook screen.'] } },
  { test: /code (4|17|32|613)\b|rate limit|too many calls|request limit/i,
    r: { cause: 'Meta rate limit hit.', steps: ['Nothing to do now: the next scheduled sync usually succeeds.', 'If it repeats daily, reduce manual syncs for this business.'] } },
  { test: /code 100\b|unsupported get request|does not exist|cannot be loaded due to missing permissions|unknown path/i,
    r: { cause: 'The ad account or WhatsApp number id is wrong, deleted, or not shared with the connecting user.',
         steps: ['Check the account still exists in Ads Manager / WhatsApp Manager.', 'Disconnect and reconnect so the right account is picked.'] } },
  { test: /dualhook|dh_live|api key|401|unauthori[sz]ed/i,
    r: { cause: 'Dualhook rejected the API key (wrong, rotated, or the plan/trial ended).',
         steps: ['Ask the owner to copy a fresh Outbound API key from Dualhook and save it on Connections.', 'Check their Dualhook plan is active.'] } },
  { test: /signature|verify|hmac/i,
    r: { cause: 'Webhook signature check failed: the app secret used to sign events does not match.',
         steps: ['Compare the Meta app secret set on the wa-webhook function with the app in Meta.', 'Retry the failed events after fixing it.'] } },
  { test: /not linked to any workspace|unrouted/i,
    r: { cause: 'Events are arriving for a WhatsApp number that is not linked to any business.',
         steps: ['Find which business owns the number and reconnect it there.', 'If it is an old test number, remove the webhook subscription for it.'] } },
  { test: /never finished|stuck|timeout|timed out|worker/i,
    r: { cause: 'Processing stopped mid-way (function timeout or a crash).',
         steps: ['Use Retry: it sends the events back to the queue.', 'If they get stuck again, check the wa-webhook logs for that time.'] } },
  { test: /failed after \d+ attempts|webhook:/i,
    r: { cause: 'The event kept failing to process.',
         steps: ['Retry once from the business drawer.', 'If it fails again, check the wa-webhook logs for the error.'] } },
  { test: /download|link expired|could not store|unsupported type/i,
    r: { cause: 'A customer photo or PDF could not be downloaded or saved.',
         steps: ['If they use Dualhook, make sure the API key is saved (downloads go through it).', 'Media links expire after a while; newer photos will work once fixed.'] } },
  { test: /AI 400(?!.*credit)/i,   // a 400 about credit balance falls through to the credit rule below
    r: { cause: 'The AI rejected the request itaOS sent (a bug in how the request was built, not credit or load). The error text says what was wrong.',
         steps: ['Read the error text and send it to the developer with the time it happened.', 'Kito retries on its next run, but the same chat will keep failing until the code is fixed.'] } },
  { test: /AI \d+|anthropic|overloaded|credit|rate_limit_error|529/i,
    r: { cause: 'The Anthropic API refused or failed the call (overloaded, rate limit, or credit).',
         steps: ['Check the AI usage page for a spike and the Anthropic console for credit.', 'Kito retries on its next run every 15 minutes.'] } },
];
/** Likely cause and recovery steps for an error (by its source and text), or null when unknown. */
export function recoveryFor(source: string, detail: string): Recovery | null {
  const text = `${source} ${detail}`;
  if (/^connection:whatsapp/.test(source) && /status (disconnected|error|inactive)/i.test(detail))
    return { cause: 'The WhatsApp connection is not active.', steps: ['Ask the owner to reconnect WhatsApp on Connections (Dualhook, Coexistence).', 'Send a test message to confirm events arrive.'] };
  for (const x of RECOVERY) if (x.test.test(text)) return x.r;
  return null;
}
