# itaOS — go-live setup (Kayani pilot)

The existing pilot has a live web app and Supabase project. Repository changes are not automatically deployed; apply the new migration and deploy the updated Edge Functions and web app before using the features described here.

**Existing pilot endpoints**
- Web app: https://itaos.netlify.app (privacy policy: `/privacy.html`)
- Database + server functions: Supabase project ref `jrdxeagnmunmatxtgmpk` (Frankfurt; the project itself is still named `growthos` in the Supabase dashboard)
- WhatsApp webhook URL: `https://jrdxeagnmunmatxtgmpk.supabase.co/functions/v1/wa-webhook`
- Ads sync runs every 3 hours automatically once an ad account is connected
- The scheduled all-workspace `ads-sync` request must include `{"action":"sync_all","days":30}` and the current `x-cron-secret` header. Each scheduled run also retries up to 50 saved WhatsApp events that are pending or failed.

## Deploy repository updates

The web app deploys itself (Netlify, on every push to main). Edge Functions deploy themselves too once the `SUPABASE_ACCESS_TOKEN` repository secret is set (`.github/workflows/deploy-functions.yml`: a changed function, or all of them when `_shared` changes; Actions → "Deploy Supabase functions" → Run workflow deploys by hand). Database migrations are still applied by hand.

Before that secret existed, nothing in this repository deployed itself. To put the MVP live (after review):

1. **Database** — apply migrations in order, skipping versions already recorded by the project. `0011_kito_ask.sql` adds Ask Kito (the `kito` schema of read-only views, `public.kito_query`, the `kito_asks` log); it changes no existing data. `0010_growth_mvp.sql` is new: it copies existing `sales` rows into `orders` and renames the old table to `sales_legacy_v01` (kept for verification; drop it later by hand if you want). Back up first (Database → Backups) and apply on a branch/staging project before production.
   ```
   supabase link --project-ref <ref>
   supabase db push            # or paste the file into the SQL editor
   ```
2. **Edge Functions** — deploy the changed and new functions. `wa-webhook` must stay public to Meta (no JWT check); the others keep the default JWT check.
   ```
   supabase functions deploy wa-webhook --no-verify-jwt
   supabase functions deploy ads-sync meta-connect kito kito-ask csv-import chat-import d360-connect dualhook-connect
   supabase functions delete sales-import     # replaced by csv-import
   ```
   Ask Kito uses the same `ANTHROPIC_API_KEY` secret. Optional: `KITO_ASK_MODEL` (default `claude-sonnet-5-5`) and `KITO_ASK_HOURLY` (questions per person per hour, default 40).
3. **Web app** — `cd web && npm ci && npm run build`, then deploy `web/dist` to Netlify (or link the site to the repo with base directory `web`).
4. Confirm the scheduled `ads-sync` job sends `{"action":"sync_all","days":30}` with the `x-cron-secret` header (see the security section below). Each scheduled run also retries up to 50 saved WhatsApp events that are pending or failed.

### Roles after migration 0010
Existing members keep their `memberships.role`. Owners/admins can change settings, connect accounts and replay webhook events; analysts can record orders, import CSVs, work tasks and edit the business profile; viewers read only. Check `select user_id, role from memberships;` after migrating.

---

## 1. Supabase: sign-in link and secrets (5 min)

**Authentication → URL Configuration**
- Site URL: `https://itaos.netlify.app`
- Redirect URLs: add `https://itaos.netlify.app/**`

**Edge Functions → Secrets** (generate fresh values for the first two; never commit them. The last two come from step 2.)

| Name | Value |
|---|---|
| `CRON_SECRET` | Generate a new high-entropy value; store only in Supabase secrets and the scheduled job configuration. The previously committed value must be rotated. |
| `META_VERIFY_TOKEN` | Generate a new high-entropy value; store in Supabase and enter the same value in Meta Webhooks. The previously committed value must be rotated. |
| `META_APP_ID` | App ID from step 2 |
| `META_APP_SECRET` | App Secret from step 2 |

## 2. Create the Meta app in Kayani's business portfolio (15 min)

You need to be an admin of the Kayani Herbs Business Portfolio.

1. Go to developers.facebook.com → **My Apps → Create App**.
2. Use case: **Other** → app type **Business**. Name: `itaOS`. Business portfolio: **Kayani Herbs**.
   (Don't put "WhatsApp" or "Facebook" in the name.)
3. **Add products:** WhatsApp, Facebook Login for Business, Marketing API.
4. **App settings → Basic**
   - App domains: `itaos.netlify.app`
   - Privacy policy URL: `https://itaos.netlify.app/privacy.html`
   - Category: Business and pages. Add an icon.
   - Copy **App ID** and **App Secret** → put them in Supabase secrets (step 1).
5. **Facebook Login for Business → Settings**
   - Valid OAuth redirect URIs: `https://itaos.netlify.app/`
   - Allowed domains for the JavaScript SDK: `https://itaos.netlify.app`
   - Login with the JavaScript SDK: **Yes**
6. **Facebook Login for Business → Configurations → Create** (two configurations)
   - **"itaOS Ads"**: login variation *General*, token type *User access token*, permissions `ads_read`, `business_management`. Copy its **Configuration ID**.
   - **"itaOS WhatsApp"**: login variation *WhatsApp Embedded Signup*, permissions `whatsapp_business_management`, `whatsapp_business_messaging`. Copy its **Configuration ID**.
7. **WhatsApp → Configuration → Webhook**
   - Callback URL: `https://jrdxeagnmunmatxtgmpk.supabase.co/functions/v1/wa-webhook`
   - Verify token: the newly generated `META_VERIFY_TOKEN` value saved in Supabase (do not copy it into repository files).
   - Click **Verify and save**. (Secrets from step 1 must already be saved.)
   - Subscribe these fields: `messages`, `history`, `smb_app_state_sync`, `smb_message_echoes`.
8. **App roles:** while the app is in development mode, only people with a role on the app can connect.
   Add the Kayani owner as **Tester** if they will connect WhatsApp themselves.

**Send me the App ID and the two Configuration IDs.** (They aren't secret.) I'll add them to the site and redeploy.

## 3. Connect Kayani (10 min, after the redeploy)

1. Open https://itaos.netlify.app → enter your email → open the sign-in link.
2. Create the workspace: `Kayani Herbs`.
3. **Connections → Connect ad account** → log in → pick the Kayani ad account.
   The last 30 days of ads load within a minute.
4. **Connections → Connect WhatsApp** → follow Meta's window → choose **"Connect your existing WhatsApp Business App"**
   → scan the QR code with the phone that runs Kayani's WhatsApp Business app → **allow sharing chat history**.
   - The phone must run WhatsApp Business app version 2.24.17 or newer, and the number must have been in use for at least 7 days.
   - The history import can only happen once, within 24 hours of connecting. Don't skip it.
   - WhatsApp Web / Desktop on other devices gets logged out once. Link them again from the phone.
   - The phone keeps working exactly as before. itaOS only reads.
5. Wait a few hours for the 6-month history to arrive. Then open **Dashboard** and **Chats**.

## 3a. Bridge: connect WhatsApp through Dualhook (chosen bridge, while Pondi's Meta verification is pending)

Dualhook is a Meta Tech Provider with Coexistence (the WhatsApp Business app keeps working on the phone) and **Webhook Override**: Meta itself sends `messages`, `smb_message_echoes`, `history` and `smb_app_state_sync` to our URL in Meta's normal format, so ad referrals (`ctwa_clid`) and the 6-month history arrive exactly as with our own app. Dualhook doesn't store message content. Developer plan: $12/month for 1 number (14-day free trial); Team $25/month for 5.

Meta signs override traffic with Dualhook's app secret, which we don't have, so the URL itself carries a per-workspace secret: `…/functions/v1/wa-webhook/dh/<64-hex secret>`, plus a separate verify token for Meta's GET challenge. Only SHA-256 hashes of both are stored.

1. Deploy `wa-webhook` (still `--no-verify-jwt`) and `dualhook-connect` (normal JWT check). No new secrets or migrations.
2. If the number is connected to 360dialog, disconnect it first (WhatsApp Business app → Settings → Account → Business Platform → Disconnect).
3. itaOS → Connect → WhatsApp Business → **Use Dualhook**. Copy the webhook URL and verify token shown (shown once; "New webhook URL" rotates both and the old URL stops working).
4. Sign up at dualhook.com (Developer plan trial). Start a connection, choose Webhook Override and paste the URL + verify token **before** opening Meta's signup window. Order matters: Meta sends the one-time history only to the URL set when the number connects.
5. In Meta's window choose **"Connect your existing WhatsApp Business app"**, scan the QR on the phone, **allow chat history sharing**.
6. Send a test message and click a Click-to-WhatsApp ad from another phone. The number appears on the Connect page after the first event.
7. Open the WhatsApp Business app on the phone at least every ~13 days, or Meta disconnects Coexistence.

**Leaving the bridge later:** disconnect from Dualhook the same way as in step 2, then use **Connect WhatsApp** (Embedded Signup) once Pondi is a Tech Provider.

## 3b. Bridge: connect WhatsApp through 360dialog (while Pondi's Meta verification is pending)

Meta refuses Embedded Signup until the itaOS business is a verified Tech Provider. Until then, a number can come in through 360dialog, a Meta partner that supports Coexistence (the WhatsApp Business app keeps working on the phone; history sync, message echoes and ad referrals with `ctwa_clid` arrive the same way).

1. Deploy `wa-webhook` (still `--no-verify-jwt`) and `d360-connect` (normal JWT check). No new secrets or migrations.
2. Kayani (the number's owner) signs up at app.360dialog.com, Regular plan (about €49 per number per month, Meta fees passed through), and adds the number with **"Yes, Business app" → "Connect your existing WhatsApp Business app"**. Scan the QR on the phone and **allow chat history sharing**. The number must have been active on the Business app for at least 7 days. 360dialog says history sync for direct clients may need their support to switch on: message support before onboarding and ask for Coexistence history sync to be enabled.
3. In the 360dialog hub, generate an API key for the number.
4. itaOS → Connect → WhatsApp Business → **Use 360dialog** → paste the key. itaOS sets the number's webhook to `wa-webhook` with a secret `x-itaos-token` header (only its hash is stored; the API key goes to Vault). Don't change the webhook in 360dialog afterwards; pasting the key again rotates the secret.
5. Send a test message to the number, and click a Click-to-WhatsApp ad from another phone. The number appears on the Connect page after the first event; the ad chat should show its ad on the dashboard.

**Leaving the bridge later:** once Pondi is a Tech Provider, disconnect the number from 360dialog (WhatsApp Business app → Settings → Account → Business Platform → Disconnect), then use **Connect WhatsApp** (Embedded Signup). Chats already in itaOS stay; Meta allows the 6-month history sync once per onboarding, so expect to re-request it.

## Known limits of v0.1
- Only people with a role on the Meta app can connect (development mode). Opening to other businesses needs Meta App Review + Tech Provider verification later.
- Payments are *detected* from messages ("nimetuma", M-Pesa confirmations, screenshots) and by Kito, but only count as sales once an order is recorded in **Chats** or imported by CSV.
- Chats from before an ad referral existed (old history) show as source "unknown". Per-ad cost per sale is accurate for chats started after connecting.
- The weekly diagnosis is rule-based, not AI-written. Not built yet: sending sales back to Meta (Conversions API), inviting team members from the UI (add rows to `memberships` for now), Facebook/Instagram content insights (needs extra Meta permissions and App Review; manual post records work today).

## Security follow-up after the public release

The prior `CRON_SECRET` and `META_VERIFY_TOKEN` values were committed to this repository while it was public. Removing them from the current files does **not** remove them from Git history, forks or clones: treat both as compromised.

**Rotate `CRON_SECRET`**
1. Generate a new value on your own machine: `openssl rand -hex 32`. Do not paste it into GitHub, chat, screenshots or logs.
2. Supabase → Edge Functions → Secrets → set `CRON_SECRET` to the new value (or `supabase secrets set CRON_SECRET=...` from a terminal whose history you then clear).
3. Update every scheduled request that sends `x-cron-secret`: Supabase → Integrations → Cron (or `select jobid, jobname, schedule from cron.job;` in the SQL editor). For each job calling `ads-sync`, `kito` or `chat-import`, edit it so the header uses the new value. If the job reads the value from Vault (`vault.decrypted_secrets`), update that Vault secret instead. The `ads-sync` body must be `{"action":"sync_all","days":30}`.
4. Verify: in SQL run `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;` after the next run, or trigger once by hand with `curl -X POST <project-url>/functions/v1/ads-sync -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" -d '{"action":"sync_all","days":1}'` (expect `{"synced":[...]}`), and confirm **Connections** shows a new "Last successful sync". A request with the old value must now get 401/403.

**Rotate `META_VERIFY_TOKEN`**
1. Generate a new value (`openssl rand -hex 32`) and set it in Supabase Edge Function secrets as `META_VERIFY_TOKEN`.
2. Meta App Dashboard → WhatsApp → Configuration → Webhook → Edit → paste the same new value as the Verify token → **Verify and save**. Meta calls `wa-webhook` with a GET; success means the function returned the challenge.
3. Verify: `curl "<project-url>/functions/v1/wa-webhook?hub.mode=subscribe&hub.verify_token=<old value>&hub.challenge=x"` must return 403, and the new value must return `x`. Then send a test WhatsApp message to the connected number and confirm **Connections → Webhook events** shows a new `processed` event.

**Also worth checking**: rotating `META_APP_SECRET` (App Dashboard → Settings → Basic → Reset) if you have any doubt it was ever shared, and reviewing GitHub → Settings → Secret scanning alerts. Do not rewrite public Git history without deciding that deliberately; it does not un-leak a value that was already public.
