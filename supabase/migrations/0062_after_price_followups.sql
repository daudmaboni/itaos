-- Went quiet after the price (22 Nov 2026): Actions → After price lists customers who got a price,
-- didn't buy and haven't written for a day or more. "Sent" / "Not now" save a follow_up_tasks row with
-- source 'after_price' (status done / dismissed) so the list can hide them and show who replied or bought.
alter table public.follow_up_tasks drop constraint if exists follow_up_tasks_source_check;
alter table public.follow_up_tasks add constraint follow_up_tasks_source_check
  check (source in ('manual', 'queue', 'kito_promise', 'reorder', 'after_price'));
