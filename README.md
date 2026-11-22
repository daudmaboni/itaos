# itaOS

Ads → WhatsApp → paid. itaOS reads a business's Meta ad spend and its WhatsApp chats (Coexistence or uploaded
exports), links chats to ad referrals where available, shows where conversations stall, and reports results using
**orders the business has confirmed or imported**, never inferred signals alone.

## What it does (MVP)
| View | What the owner gets |
|---|---|
| **Ask Kito** | Ask anything in Kiswahili or English ("who did I send Lipa namba to but hasn't paid?", "which ads bring paying customers?", "what do payers have in common?"). Kito writes read-only SQL over the `kito.*` views, the database computes every number, and the answer comes back with the chats (Open chat / WhatsApp / draft a follow-up), ads, tables and stats behind it; the queries it ran are shown to Pondi staff only. |
| **Dashboard** | **Money itaOS brought back** (the trial below), **Ad money manager** (which running ad to add money to, keep or stop, judged on paid sales), ad spend, Meta-reported chats, chats received, replies, price shared, payment signals (inferred), confirmed paid orders, revenue, cost per chat / qualified inquiry / attributed sale, matched return on ad spend, contribution (only when cost data exists), period-over-period deltas, source health and data coverage. Every figure is labelled with its source. |
| **Diagnosis** | Weekly, rule-based bottleneck findings (unanswered, slow reply, low intent, price, no follow-up, payment friction, unconfirmed payments, fulfilment, data gaps) with counts, sample size, confidence, observed facts vs hypothesis, missing data and links to the supporting chats/orders. |
| **Actions** | **Today** (default): one list of everyone worth contacting now, best first, each customer once: waiting for a reply, promises due, quiet after the price, past buyers due to buy again. Tabs for each list, the follow-up queue and tasks. Kito drafts replies in the customer's language from the chat and the business profile. The owner edits, then copies to WhatsApp or taps **Send from itaOS** (normal message inside WhatsApp's 24 hours, an approved template after). Nothing is sent without a tap. |
| **Receipts** | Find a payment (receipt number, M-Pesa code, name, phone, place, date) and **Check your M-Pesa**: paste payment SMS or upload the statement CSV to see which payments are not recorded as sales yet. |
| **Chats** | Why each chat is labelled (rules, Kito evidence quotes, owner corrections), record / correct / refund / cancel orders with a full audit trail, mark lost/open with a note. |
| **Connections** | Owners see Connected / Needs attention per WhatsApp number and ad account, with a "Message Pondi" button. Pondi does the setup: Dualhook webhook, API key and images in staff admin (/app/admin → business → WhatsApp setup); Facebook ad login at `#connect/setup` inside the business's own login. |
| **Settings** | Business, **business profile** (products, prices, delivery, payment, tone, FAQs, constraints), appearance, **rules & rates** (exchange rate, follow-up hours, conversion window, timezone, and "How itaOS reads your chats": the business's own ad opening message, location reply and after-payment message — see migration 0042), account. |

## Structure
- `web/` — Vite + React app (Netlify: itaos — custom domain itaos.app)
  - `src/metrics.ts` — **the** metric definitions (pure, deterministic, unit-tested)
  - `src/diagnosis.ts` — weekly diagnosis rules (pure, unit-tested)
  - `src/csv.ts` — CSV parsing, column mapping, templates
- `supabase/migrations/` — schema, RLS, roles, reporting functions (`0010_growth_mvp.sql` is this MVP)
- `supabase/functions/`
  - `ads-sync` — ad-level daily insights. Three explicit paths: scheduled `sync_all` (cron secret), one named workspace+connection (internal first sync), or a member's own workspace.
  - `meta-connect` — Facebook Login (ads) and Embedded Signup (WhatsApp). Owner/admin only; refuses accounts already connected to another workspace.
  - `wa-webhook` — stores each verified change before acknowledging, processes idempotently, bounded automatic retries, owner/admin replay.
  - `chat-import` — re-checks chats with the current rules (the old name is kept; uploads were removed 19 Nov 2026).
  - `kito-ask` — Ask Kito: Claude plans and runs read-only queries through `public.kito_query` with the user's own token (RLS + workspace pin + read-only transaction), returns a structured answer, logs it in `kito_asks`.
  - `kito` — AI labelling with evidence quotes; on-demand reply drafts (drafts only). Respects the per-business monthly AI limit (migration 0044).
  - `_shared/` — `signals.ts` (Kiswahili/English chat rules), `csv.ts`, `webhook.ts`, `db.ts`.
- `supabase/tests/` — SQL authorization tests run against a throwaway local Postgres.

## Local dev and checks
```
cd web && cp .env.example .env   # fill in public values
npm install
npm run dev
npm run build      # typecheck + production build
npm test           # metrics, diagnosis, CSV validation/dedupe, webhook identity/retry
npm run test:sql   # applies every migration to a temporary local Postgres and runs RLS/role tests
```
`test:sql` needs PostgreSQL server binaries (`initdb`, `pg_ctl`, `psql`) and must not run as root. It never touches Supabase. Known issue: migration 0020 fails on a fresh database (a view column rename), so the runner currently stops there.

## Data rules
- **Revenue comes only from `orders` with status `paid`.** Customer payment words, screenshots and Kito's reading are *signals* until someone records an order.
- One exception, opt-in per business: the owner's **own** ✅ price message or "money received" words (Settings → How itaOS reads your chats; empty by default) record a paid order automatically. Those orders carry `inferred_from = 'tick'` and a note quoting the message, and the money card always shows its figures **with and without** them.
- Orders keep provenance (`manual`, `csv_import`, `provider`, `inferred` + what was confirmed) and every insert/update is written to `order_events` by a trigger. Orders are corrected by status change (refund/cancel), never deleted by clients.
- Ad-to-sale figures are **attributed/matched estimates**: a paid order linked to a chat that carried a Meta ad referral, paid within the workspace conversion window (default 30 days). Not proof the ad caused the purchase.
- Chats are counted in the period they started, in the workspace timezone; revenue is counted by paid date.
- Money and metrics are computed in SQL/TypeScript rules, never by AI.
- Roles: `viewer` reads; `analyst`/`admin`/`owner` edit orders, tasks and the profile; `owner`/`admin` change settings, connect accounts and replay webhook events. Enforced by RLS and in Edge Functions.
- Tokens live only in Supabase Vault; token RPCs are executable by `service_role` only.
- `raw_events` is server-only. Webhook health is exposed to members as counts only.
- CSV phone numbers are used only to find a chat inside the same workspace; they are not stored.

## How "Money itaOS brought back" is measured (`recovered_sales`, migrations 0070, 0076)
The headline must not credit itaOS with sales that would have happened anyway, so it comes from a randomized trial, not from "we messaged them and they paid".
1. **Who is in it.** Customers slipping away are flagged (`atrisk_flags`): quiet 24 h after getting the price (window 14 days), a promise Kito found (until 14 days after the due date), or a past buyer 45–120 days on (30 days).
2. **Assignment.** Each customer is assigned **once** (per method version), at their first fresh flag, to *shown* or *kept aside* (`atrisk_assign`). Randomization is blocked within each flag type × Kito temperature: exactly one kept aside per block of 10 at 10%, at a hidden position. Staff set the share (Off/5/10/15/20%); a change only affects new customers.
3. **Kept aside means no nudges** for the whole window: no Actions/Today card, no queue follow-up, no promise card, no promise push, no briefing mention, no badge. Their chats stay in Chats and anyone waiting for a reply is always shown.
4. **Comparison as assigned.** When windows close, buying (paid, net > 0, across all the customer's chats) is compared between groups, counting everyone in their group whether or not the owner messaged them. **Contamination** (kept-aside customers the owner messaged anyway) stays in the kept-aside group, which can only shrink the difference; it is reported, in red above 15%.
5. **Statistics.** Wilson interval per group, Newcombe 95% interval for the difference in buying rate, Welch range for revenue per assigned customer; the money figure is that difference × customers shown in the period.
6. **Status.** `learning` until 30 kept aside and 100 shown have closed windows; then `estimate` ("could still be zero") or `clear` (the whole 95% range above zero). The "× its cost" badge needs `clear`.
7. **Context, never added in:** sales after follow-ups (messaged → replied → paid), sales with no message or after a new ad click, the business's own past rate, flagged customers nobody messaged, and how many shown customers were actually messaged (counted from real outgoing messages, including ones typed in the WhatsApp Business app, not from a "Sent" tap).
8. **Without auto-recorded sales (v2.1).** Every figure is also given without orders recorded from the owner's ✅ / "money received" messages.
9. **Across businesses (staff only, 0078).** `admin_pooled_trial` pools shops with a DerSimonian–Laird random-effects model on each shop's difference and shows each shop's estimate pulled toward the pooled one. Active from 3 shops with ≥20 shown and ≥5 kept-aside closed customers. Owners' cards keep using their own trial.

Known limits: at ~1% base rates a single shop needs months to reach `clear`; payments not recorded in itaOS are invisible (use Check your M-Pesa).

## Ad money manager (`ad_money`, migration 0075; `web/src/adMoney.ts`)
- Per ad over 7/14/30 days: spend and Meta chats (by day), chats itaOS saw (by start day), **paid** sales (by payment day, within the conversion window of the chat starting).
- Which ad a chat came from: Meta's referral tag when present. Ad chats that arrive **without** the tag (Dualhook often delivers the ad greeting card as an error) are shared between the ads that ran that day in proportion to Meta's chat count per ad; shown as "≈". One chat never counts more than once.
- Break-even per paid sale = average ad sale − product cost per order (Settings → Rates; the full price when unset, and the card says so).
- Each ad's cost per paid sale is blended with the business's own paying rate (30 "average" chats) so one lucky sale can't make a small ad a winner. Running ads only: **Stop** (spent a sale's worth with no sale, or costs more than break-even), **Add money** (≥2 sales, under half the break-even), **Getting costly** (1.5× the average), **Too early**, else **Keep going**. Up to 3 plain to-dos; changes are made by the owner in Ads Manager.

## Check your M-Pesa (migration 0077; `web/src/walletParse.ts`)
Owners paste payment SMS (M-Pesa, Mixx, Airtel Money, HaloPesa; Swahili or English) or upload the statement CSV. Only money received is kept, with the last 4 digits of the sender's number. Each payment is matched to a recorded sale by payment code, then by the same amount within 2 days; unrecorded ones get a suggested chat (screenshot code, then last 4 digits, then name; never when more than one customer fits). Recording is the owner's tap (`wallet_record`, `external_ref = wallet:<code>`).

See `SETUP.md` for going live and `web/public/privacy.html` for the privacy policy.
