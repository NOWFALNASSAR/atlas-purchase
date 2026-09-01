-- =====================================================================
-- ATLAS PURCHASE  |  10_sync.sql
-- Prepares Supabase to receive data from the billing server.
-- Run once in Supabase → SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Remember the billing software's own id for every record.
--    This is what lets purchase data and sales data line up later.
-- ---------------------------------------------------------------------

alter table items     add column if not exists external_id text;
alter table items     add column if not exists synced_at   timestamptz;
alter table suppliers add column if not exists external_id text;
alter table suppliers add column if not exists synced_at   timestamptz;

create index if not exists idx_items_external on items (external_id);
create index if not exists idx_suppliers_external on suppliers (external_id);

-- the sync updates by code, so code must be unique (it already is,
-- but this makes the intent explicit and lets upserts work)
create unique index if not exists uq_items_code     on items (code);
create unique index if not exists uq_suppliers_code on suppliers (code);

-- ---------------------------------------------------------------------
-- 2. A record of every sync run, so failures are visible
-- ---------------------------------------------------------------------

create table if not exists sync_log (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  rows_read   int  default 0,
  rows_pushed int  default 0,
  status      text not null default 'ok',
  message     text,
  ran_at      timestamptz not null default now()
);
create index if not exists idx_sync_log_time on sync_log (ran_at desc);

alter table sync_log enable row level security;

drop policy if exists read_sync_log on sync_log;
create policy read_sync_log on sync_log for select to authenticated
  using (my_role() in ('hod','admin'));

-- ---------------------------------------------------------------------
-- 3. Is the sync healthy? Check this after every run.
-- ---------------------------------------------------------------------

create or replace view v_sync_status as
select
  source,
  max(ran_at)                                    as last_run,
  extract(hour from now() - max(ran_at))::int    as hours_ago,
  (array_agg(status order by ran_at desc))[1]    as last_status,
  (array_agg(rows_pushed order by ran_at desc))[1] as last_rows,
  (array_agg(message order by ran_at desc))[1]   as last_message
from sync_log
group by source;

notify pgrst, 'reload schema';

-- Verify:
--   select column_name from information_schema.columns
--    where table_name='items' and column_name in ('external_id','synced_at');
--   select count(*) from sync_log;
