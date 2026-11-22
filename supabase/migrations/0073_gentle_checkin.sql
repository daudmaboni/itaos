-- 0073_gentle_checkin — customers waiting for money get a soft check-in, not a push (22 Nov 2026).
-- "Nasubiri hela", "nikipata mshahara", "hela ikiingia": itaOS sets a quiet reminder for the owner 3 days later
-- (09:00–12:00; for salary, the 1st of next month if later), and the message it suggests asks how they are and
-- leaves the door open — it never asks when they will pay. The customer is never asked for a date.
alter table public.follow_up_tasks add column if not exists gentle boolean not null default false;
comment on column public.follow_up_tasks.gentle is 'Soft check-in for a customer waiting for money (0073): warm message, no push to pay.';
