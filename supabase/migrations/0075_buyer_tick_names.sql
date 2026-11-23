-- 23 Nov 2026 — Buyers saved to Google Contacts get a ✅ at the end of their name ("Black Songwe · Kayani✅").
-- New buyers get it when they are saved (google/index.ts). Buyers saved before today are put back on the
-- "check Buyers/Leads" list once, so the next sync adds their ✅ (up to 1,000 a run). Nothing else changes.
update public.contacts set google_kind = null where google_kind = 'buyer' and google_resource like 'people/%';
