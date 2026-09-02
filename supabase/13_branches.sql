-- =====================================================================
-- ATLAS  |  13_branches.sql
-- Multi-branch architecture.
--
-- Each showroom runs its own SQL Server. Masters are identical across
-- all of them, transactions are not. So:
--
--   MASTERS      pulled from ONE branch only. Never duplicated.
--   TRANSACTIONS pulled from every branch, tagged with which one.
--
-- Every table below can be written to repeatedly without creating
-- duplicates, because each has a natural key. A branch can sync the
-- same day twice, or catch up after a week offline, and the numbers
-- stay correct.
--
-- Run once in Supabase → SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BRANCH REGISTRY
--    One row per showroom that has a server pushing data.
-- ---------------------------------------------------------------------

create table if not exists branches (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,          -- 'TDP', 'PMNA' — your choice
  name          text not null,
  entity_id     uuid references entities(id),
  shop_id       uuid references shops(id),     -- links to the purchase module
  db_name       text,                          -- MAHA002_001
  location_code text,                          -- the 0xx suffix inside that db
  is_master     boolean not null default false,-- the one masters come from
  active        boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- exactly one branch may be the master source
create unique index if not exists uq_one_master
  on branches (is_master) where is_master;

create index if not exists idx_branches_entity on branches (entity_id);

-- ---------------------------------------------------------------------
-- 2. SYNC STATE — one row per branch per data stream
--    The watermark is what makes catching up cheap: the agent asks for
--    everything after the last row it successfully sent, not everything.
-- ---------------------------------------------------------------------

create table if not exists sync_state (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references branches(id) on delete cascade,
  stream          text not null,               -- items, sales_daily, stock, transfers
  watermark_date  date,
  watermark_recno bigint,
  last_run_at     timestamptz,
  last_ok_at      timestamptz,
  rows_last_run   int default 0,
  status          text default 'never_run',    -- ok | failed | running | never_run
  message         text,
  unique (branch_id, stream)
);

create index if not exists idx_sync_state_branch on sync_state (branch_id);

-- ---------------------------------------------------------------------
-- 3. SALES — DAILY PER BRANCH PER LOCATION
--    Small. Two years of every branch is a few tens of thousands of rows.
--    This powers dashboards, targets, comparisons, trends.
-- ---------------------------------------------------------------------

create table if not exists sales_daily (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references branches(id) on delete cascade,
  sale_date      date not null,
  location_code  text not null default '000',
  bills          int  not null default 0,
  qty            numeric(14,2) not null default 0,
  gross          numeric(14,2) not null default 0,
  discount       numeric(14,2) not null default 0,
  tax            numeric(14,2) not null default 0,
  net_sales      numeric(14,2) not null default 0,
  cost           numeric(14,2) not null default 0,
  margin         numeric(14,2) generated always as (net_sales - cost) stored,
  margin_pct     numeric(6,2)  generated always as (
                   case when net_sales > 0
                     then round((net_sales - cost) / net_sales * 100, 2)
                     else 0 end) stored,
  basket_value   numeric(12,2) generated always as (
                   case when bills > 0 then round(net_sales / bills, 2) else 0 end) stored,
  items_per_bill numeric(8,2)  generated always as (
                   case when bills > 0 then round(qty / bills, 2) else 0 end) stored,
  synced_at      timestamptz not null default now(),
  unique (branch_id, sale_date, location_code)
);

create index if not exists idx_sales_daily_date on sales_daily (sale_date desc);
create index if not exists idx_sales_daily_branch_date on sales_daily (branch_id, sale_date desc);

-- ---------------------------------------------------------------------
-- 4. SALES — DAILY PER SALESMAN
-- ---------------------------------------------------------------------

create table if not exists sales_salesman_daily (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  sale_date     date not null,
  location_code text not null default '000',
  salesman_code text not null,
  salesman_name text,
  bills         int not null default 0,
  qty           numeric(14,2) not null default 0,
  net_sales     numeric(14,2) not null default 0,
  cost          numeric(14,2) not null default 0,
  synced_at     timestamptz not null default now(),
  unique (branch_id, sale_date, location_code, salesman_code)
);

create index if not exists idx_sman_daily on sales_salesman_daily (branch_id, sale_date desc);
create index if not exists idx_sman_code on sales_salesman_daily (salesman_code);

-- ---------------------------------------------------------------------
-- 5. SALES — DAILY PER ITEM, RECENT ONLY
--    Rolling window. Older detail stays on the branch server, which is
--    still the system of record.
-- ---------------------------------------------------------------------

create table if not exists sales_item_daily (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  sale_date     date not null,
  location_code text not null default '000',
  item_code     text not null,
  item_name     text,
  division      text,
  brand         text,
  qty           numeric(14,2) not null default 0,
  net_sales     numeric(14,2) not null default 0,
  cost          numeric(14,2) not null default 0,
  synced_at     timestamptz not null default now(),
  unique (branch_id, sale_date, location_code, item_code)
);

create index if not exists idx_item_daily on sales_item_daily (branch_id, sale_date desc);
create index if not exists idx_item_daily_item on sales_item_daily (item_code);
create index if not exists idx_item_daily_div on sales_item_daily (division);

-- ---------------------------------------------------------------------
-- 6. STOCK ON HAND — latest snapshot per branch per item
--    Overwritten each sync. No history kept here; that is what the
--    daily sales and transfer tables are for.
-- ---------------------------------------------------------------------

create table if not exists stock_balance (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  location_code text not null default '000',
  item_code     text not null,
  item_name     text,
  qty           numeric(14,2) not null default 0,
  cost_rate     numeric(12,2),
  sell_rate     numeric(12,2),
  stock_value   numeric(14,2) generated always as (qty * coalesce(cost_rate,0)) stored,
  as_of         timestamptz not null default now(),
  unique (branch_id, location_code, item_code)
);

create index if not exists idx_stock_branch on stock_balance (branch_id);
create index if not exists idx_stock_item on stock_balance (item_code);

-- ---------------------------------------------------------------------
-- 7. STOCK MOVEMENT — what left one place and arrived at another
-- ---------------------------------------------------------------------

create table if not exists stock_movements (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references branches(id) on delete cascade,
  direction      text not null check (direction in ('out','in')),
  doc_no         text not null,
  doc_date       date not null,
  line_no        int  not null default 1,
  from_location  text,
  to_location    text,
  item_code      text not null,
  item_name      text,
  qty            numeric(14,2) not null default 0,
  rate           numeric(12,2),
  synced_at      timestamptz not null default now(),
  unique (branch_id, direction, doc_no, line_no)
);

create index if not exists idx_mov_branch_date on stock_movements (branch_id, doc_date desc);
create index if not exists idx_mov_item on stock_movements (item_code);

-- ---------------------------------------------------------------------
-- 8. SALESMEN — from the master branch only, like other masters
-- ---------------------------------------------------------------------

create table if not exists salesmen (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  location_code text,
  branch_id     uuid references branches(id),
  active        boolean not null default true,
  synced_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 9. TARGETS — these do not exist in the billing software.
--    Entered in the app, never overwritten by a sync.
-- ---------------------------------------------------------------------

create table if not exists targets (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('branch','salesman','entity','group')),
  branch_id     uuid references branches(id),
  salesman_code text,
  entity_id     uuid references entities(id),
  period_start  date not null,
  period_end    date not null,
  amount        numeric(14,2) not null,
  note          text,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  superseded_by uuid references targets(id)
);

create index if not exists idx_targets_period on targets (period_start, period_end);
create index if not exists idx_targets_branch on targets (branch_id);

-- ---------------------------------------------------------------------
-- 10. SECURITY
-- ---------------------------------------------------------------------

alter table branches             enable row level security;
alter table sync_state           enable row level security;
alter table sales_daily          enable row level security;
alter table sales_salesman_daily enable row level security;
alter table sales_item_daily     enable row level security;
alter table stock_balance        enable row level security;
alter table stock_movements      enable row level security;
alter table salesmen             enable row level security;
alter table targets              enable row level security;

-- everyone signed in may read what belongs to their entities
drop policy if exists read_branches on branches;
create policy read_branches on branches for select to authenticated
  using (entity_id is null or can_see_entity(entity_id));

drop policy if exists admin_branches on branches;
create policy admin_branches on branches for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists read_sync_state on sync_state;
create policy read_sync_state on sync_state for select to authenticated
  using (my_role() in ('hod','admin'));

drop policy if exists read_salesmen on salesmen;
create policy read_salesmen on salesmen for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['sales_daily','sales_salesman_daily','sales_item_daily',
                           'stock_balance','stock_movements']
  loop
    execute format('drop policy if exists read_%I on %I', t, t);
    execute format($f$
      create policy read_%I on %I for select to authenticated
      using (exists (select 1 from branches b
                     where b.id = %I.branch_id
                       and (b.entity_id is null or can_see_entity(b.entity_id))))
    $f$, t, t, t);
  end loop;
end $$;

drop policy if exists read_targets on targets;
create policy read_targets on targets for select to authenticated using (true);

drop policy if exists write_targets on targets;
create policy write_targets on targets for all to authenticated
  using (my_role() in ('hod','admin')) with check (my_role() in ('hod','admin'));

-- ---------------------------------------------------------------------
-- 11. READING VIEWS
-- ---------------------------------------------------------------------

create or replace view v_sales_by_branch as
select
  b.id as branch_id, b.code as branch_code, b.name as branch_name,
  b.entity_id, e.name as entity_name,
  d.sale_date, d.location_code,
  d.bills, d.qty, d.net_sales, d.cost, d.margin, d.margin_pct,
  d.basket_value, d.items_per_bill
from sales_daily d
join branches b on b.id = d.branch_id
left join entities e on e.id = b.entity_id;

create or replace view v_branch_health as
select
  b.code, b.name, b.active,
  s.stream, s.status, s.last_ok_at,
  extract(hour from now() - s.last_ok_at)::int as hours_since_ok,
  s.rows_last_run, left(coalesce(s.message,''), 200) as message
from branches b
left join sync_state s on s.branch_id = b.id
order by b.code, s.stream;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 12. REGISTER YOUR BRANCHES
--     Edit and run once you know which showroom is which.
--
-- insert into branches (code, name, db_name, location_code, is_master, entity_id)
-- values ('HO',   'Head Office Godown', 'MAHA002_001', '001', true,
--         (select id from entities where code = 'E1')),
--        ('TDP',  'Thodupuzha',         'MAHA002_001', '014', false,
--         (select id from entities where code = 'E1'));
-- ---------------------------------------------------------------------
