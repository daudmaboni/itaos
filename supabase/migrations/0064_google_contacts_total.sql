-- 0064 (22 Nov 2026): remember how many contacts the connected Google account has, so the Google card can
-- say "this account already has 24,9xx contacts (Google's limit is 25,000)" instead of just "full".
alter table public.google_links add column if not exists contacts_google_total int;
