-- =====================================================================
-- ATLAS  |  16_all_inventory.sql
-- Everything from scripts 13, 14 and 15 in dependency order, with the
-- loop that was killing the earlier runs replaced by plain statements.
--
-- RUN THIS IN SUPABASE. Run each STEP separately: select the lines of
-- one step, press Run, check it succeeded, then move to the next.
-- =====================================================================


-- ============ STEP 1 — TABLES ========================================

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

create table if not exists salesmen (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  location_code text,
  branch_id     uuid references branches(id),
  active        boolean not null default true,
  synced_at     timestamptz not null default now()
);

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

create table if not exists godown_stock (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid references branches(id) on delete cascade,
  location_code  text not null default '001',
  item_code      text not null,
  item_name      text,
  division       text,
  category       text,
  sub_category   text,
  brand          text,
  colour         text,
  size           text,
  hsn            text,
  tax_rate       numeric(5,2),
  supplier_code  text,
  supplier_name  text,
  qty            numeric(14,2) not null default 0,
  purchase_rate  numeric(12,2),
  cost_rate      numeric(12,2),
  selling_rate   numeric(12,2),
  first_purchase date,
  last_purchase  date,
  purchase_value numeric(14,2) generated always as (qty * coalesce(purchase_rate,0)) stored,
  cost_value     numeric(14,2) generated always as (qty * coalesce(cost_rate,0)) stored,
  selling_value  numeric(14,2) generated always as (qty * coalesce(selling_rate,0)) stored,
  margin_pct     numeric(6,2)  generated always as (
                   case when coalesce(selling_rate,0) > 0
                     then round((selling_rate - coalesce(cost_rate,0)) / selling_rate * 100, 2)
                     else 0 end) stored,
  synced_at      timestamptz not null default now(),
  unique (branch_id, location_code, item_code)
);

create table if not exists godown_purchases (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid references branches(id) on delete cascade,
  purch_no       text not null,
  purch_date     date not null,
  line_no        int  not null default 1,
  bill_no        text,
  bill_date      date,
  supplier_code  text,
  supplier_name  text,
  item_code      text not null,
  item_name      text,
  division       text,
  category       text,
  sub_category   text,
  brand          text,
  colour         text,
  size           text,
  hsn            text,
  qty            numeric(14,2) not null default 0,
  free_qty       numeric(14,2) default 0,
  purchase_rate  numeric(12,2),
  cost_rate      numeric(12,2),
  selling_rate   numeric(12,2),
  discount       numeric(14,2) default 0,
  tax_rate       numeric(5,2),
  tax_amount     numeric(14,2) default 0,
  line_value     numeric(14,2) not null default 0,
  synced_at      timestamptz not null default now(),
  unique (branch_id, purch_no, line_no)
);


-- extra columns used by the transfer reconciliation
alter table stock_movements add column if not exists ref_doc_no      text;
alter table stock_movements add column if not exists ref_branch_code text;
alter table stock_movements add column if not exists received_at     date;

-- CHECK: should return 11
-- select count(*) from information_schema.tables where table_name in
--  ('branches','sync_state','sales_daily','sales_salesman_daily','sales_item_daily',
--   'stock_balance','stock_movements','salesmen','targets','godown_stock','godown_purchases');


-- ============ STEP 2 — INDEXES =======================================

create unique index if not exists uq_one_master
  on branches (is_master) where is_master;
create index if not exists idx_branches_entity on branches (entity_id);
create index if not exists idx_sync_state_branch on sync_state (branch_id);
create index if not exists idx_sales_daily_date on sales_daily (sale_date desc);
create index if not exists idx_sales_daily_branch_date on sales_daily (branch_id, sale_date desc);
create index if not exists idx_sman_daily on sales_salesman_daily (branch_id, sale_date desc);
create index if not exists idx_sman_code on sales_salesman_daily (salesman_code);
create index if not exists idx_item_daily on sales_item_daily (branch_id, sale_date desc);
create index if not exists idx_item_daily_item on sales_item_daily (item_code);
create index if not exists idx_item_daily_div on sales_item_daily (division);
create index if not exists idx_stock_branch on stock_balance (branch_id);
create index if not exists idx_stock_item on stock_balance (item_code);
create index if not exists idx_mov_branch_date on stock_movements (branch_id, doc_date desc);
create index if not exists idx_mov_item on stock_movements (item_code);
create index if not exists idx_targets_period on targets (period_start, period_end);
create index if not exists idx_targets_branch on targets (branch_id);
create index if not exists idx_gs_division  on godown_stock (division);
create index if not exists idx_gs_category  on godown_stock (category);
create index if not exists idx_gs_brand     on godown_stock (brand);
create index if not exists idx_gs_supplier  on godown_stock (supplier_code);
create index if not exists idx_gs_colour    on godown_stock (colour);
create index if not exists idx_gs_selling   on godown_stock (selling_rate);
create index if not exists idx_gs_last_pur  on godown_stock (last_purchase);
create index if not exists idx_gs_item      on godown_stock (item_code);
create index if not exists idx_gp_date     on godown_purchases (purch_date desc);
create index if not exists idx_gp_supplier on godown_purchases (supplier_code);
create index if not exists idx_gp_item     on godown_purchases (item_code);
create index if not exists idx_gp_division on godown_purchases (division);
create index if not exists idx_gp_brand    on godown_purchases (brand);


-- ============ STEP 3 — SECURITY ======================================
-- Written out one by one. The loop that was here before is what made
-- the whole script roll back silently.

alter table branches             enable row level security;
alter table sync_state           enable row level security;
alter table sales_daily          enable row level security;
alter table sales_salesman_daily enable row level security;
alter table sales_item_daily     enable row level security;
alter table stock_balance        enable row level security;
alter table stock_movements      enable row level security;
alter table salesmen             enable row level security;
alter table targets              enable row level security;
alter table godown_stock         enable row level security;
alter table godown_purchases     enable row level security;

drop policy if exists read_branches on branches;
create policy read_branches on branches for select to authenticated using (true);

drop policy if exists admin_branches on branches;
create policy admin_branches on branches for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists read_sync_state on sync_state;
create policy read_sync_state on sync_state for select to authenticated using (true);

drop policy if exists read_sales_daily on sales_daily;
create policy read_sales_daily on sales_daily for select to authenticated using (true);

drop policy if exists read_sales_salesman_daily on sales_salesman_daily;
create policy read_sales_salesman_daily on sales_salesman_daily for select to authenticated using (true);

drop policy if exists read_sales_item_daily on sales_item_daily;
create policy read_sales_item_daily on sales_item_daily for select to authenticated using (true);

drop policy if exists read_stock_balance on stock_balance;
create policy read_stock_balance on stock_balance for select to authenticated using (true);

drop policy if exists read_stock_movements on stock_movements;
create policy read_stock_movements on stock_movements for select to authenticated using (true);

drop policy if exists read_salesmen on salesmen;
create policy read_salesmen on salesmen for select to authenticated using (true);

drop policy if exists read_targets on targets;
create policy read_targets on targets for select to authenticated using (true);

drop policy if exists write_targets on targets;
create policy write_targets on targets for all to authenticated
  using (my_role() in ('hod','admin')) with check (my_role() in ('hod','admin'));

drop policy if exists read_godown_stock on godown_stock;
create policy read_godown_stock on godown_stock for select to authenticated using (true);

drop policy if exists read_godown_purchases on godown_purchases;
create policy read_godown_purchases on godown_purchases for select to authenticated using (true);


-- ============ STEP 4 — INVENTORY VIEWS ===============================

create or replace view v_stock_aged as
select
  g.*,
  (current_date - coalesce(g.last_purchase, g.first_purchase))::int as days_held,
  case
    when g.last_purchase is null then 'unknown'
    when current_date - g.last_purchase <=  30 then '0-30 days'
    when current_date - g.last_purchase <=  60 then '31-60 days'
    when current_date - g.last_purchase <=  90 then '61-90 days'
    when current_date - g.last_purchase <= 180 then '91-180 days'
    when current_date - g.last_purchase <= 365 then '181-365 days'
    else 'over a year'
  end as age_bucket,
  case
    when coalesce(g.selling_rate,0) <  300 then 'under 300'
    when g.selling_rate <  500 then '300-499'
    when g.selling_rate <  800 then '500-799'
    when g.selling_rate < 1200 then '800-1199'
    when g.selling_rate < 2000 then '1200-1999'
    when g.selling_rate < 5000 then '2000-4999'
    else '5000+'
  end as price_band
from godown_stock g
where g.qty > 0;

-- ---------------------------------------------------------------------
-- 5. ONE VIEW PER REPORT DIMENSION
--    All identical in shape, so the app can render any of them the
--    same way and drill from one into the next.
-- ---------------------------------------------------------------------

create or replace view v_stock_by_division as
select coalesce(nullif(trim(division),''),'Uncategorised') as label,
       count(*) as items, sum(qty) as qty,
       sum(purchase_value) as purchase_value,
       sum(cost_value) as cost_value,
       sum(selling_value) as selling_value,
       round(avg(margin_pct),1) as avg_margin
from godown_stock where qty > 0 group by 1;

create or replace view v_stock_by_category as
select coalesce(nullif(trim(category),''),'Uncategorised') as label,
       count(*) as items, sum(qty) as qty,
       sum(purchase_value) as purchase_value,
       sum(cost_value) as cost_value,
       sum(selling_value) as selling_value,
       round(avg(margin_pct),1) as avg_margin
from godown_stock where qty > 0 group by 1;

create or replace view v_stock_by_brand as
select coalesce(nullif(trim(brand),''),'No brand') as label,
       count(*) as items, sum(qty) as qty,
       sum(purchase_value) as purchase_value,
       sum(cost_value) as cost_value,
       sum(selling_value) as selling_value,
       round(avg(margin_pct),1) as avg_margin
from godown_stock where qty > 0 group by 1;

create or replace view v_stock_by_colour as
select coalesce(nullif(trim(colour),''),'Not specified') as label,
       count(*) as items, sum(qty) as qty,
       sum(purchase_value) as purchase_value,
       sum(cost_value) as cost_value,
       sum(selling_value) as selling_value,
       round(avg(margin_pct),1) as avg_margin
from godown_stock where qty > 0 group by 1;

create or replace view v_stock_by_supplier as
select coalesce(nullif(trim(supplier_name),''),'Unknown') as label,
       count(*) as items, sum(qty) as qty,
       sum(purchase_value) as purchase_value,
       sum(cost_value) as cost_value,
       sum(selling_value) as selling_value,
       round(avg(margin_pct),1) as avg_margin
from godown_stock where qty > 0 group by 1;

create or replace view v_stock_by_price_band as
select price_band as label,
       count(*) as items, sum(qty) as qty,
       sum(purchase_value) as purchase_value,
       sum(cost_value) as cost_value,
       sum(selling_value) as selling_value,
       round(avg(margin_pct),1) as avg_margin
from v_stock_aged group by 1;

create or replace view v_stock_by_age as
select age_bucket as label,
       count(*) as items, sum(qty) as qty,
       sum(purchase_value) as purchase_value,
       sum(cost_value) as cost_value,
       sum(selling_value) as selling_value,
       round(avg(margin_pct),1) as avg_margin
from v_stock_aged group by 1;

-- ---------------------------------------------------------------------
-- 6. SUPPLIERS — active means bought from in the last 3 months
-- ---------------------------------------------------------------------

create or replace view v_supplier_activity as
with p as (
  select supplier_code, supplier_name,
         count(distinct purch_no) as purchases,
         sum(line_value)          as purchase_value,
         sum(qty)                 as qty,
         min(purch_date)          as first_purchase,
         max(purch_date)          as last_purchase
  from godown_purchases
  group by supplier_code, supplier_name
)
select
  p.*,
  (current_date - p.last_purchase)::int as days_since_last,
  case when p.last_purchase >= current_date - 90 then true else false end as is_active,
  coalesce(s.qty_in_stock, 0)     as qty_in_stock,
  coalesce(s.stock_value, 0)      as stock_value
from p
left join (
  select supplier_code, sum(qty) as qty_in_stock, sum(cost_value) as stock_value
  from godown_stock where qty > 0 group by supplier_code
) s on s.supplier_code = p.supplier_code;

create or replace view v_active_suppliers as
select * from v_supplier_activity where is_active order by purchase_value desc;

-- ---------------------------------------------------------------------
-- 7. PURCHASES BY DIMENSION
-- ---------------------------------------------------------------------

create or replace view v_purchase_by_item as
select item_code, item_name, division, category, brand,
       count(*)                as purchase_lines,
       sum(qty)                as qty,
       sum(line_value)         as purchase_value,
       round(avg(purchase_rate),2) as avg_purchase_rate,
       round(min(purchase_rate),2) as lowest_rate,
       round(max(purchase_rate),2) as highest_rate,
       round(avg(selling_rate),2)  as avg_selling_rate,
       max(purch_date)         as last_purchased,
       count(distinct supplier_code) as suppliers
from godown_purchases group by item_code, item_name, division, category, brand;

create or replace view v_purchase_by_month as
select date_trunc('month', purch_date)::date as month,
       count(distinct purch_no) as purchases,
       count(distinct supplier_code) as suppliers,
       sum(qty) as qty,
       sum(line_value) as purchase_value,
       sum(tax_amount) as tax
from godown_purchases group by 1 order by 1 desc;

-- ---------------------------------------------------------------------
-- 8. THE ONE THAT MATTERS MOST
--    Money sitting still: old stock, by value.
-- ---------------------------------------------------------------------

create or replace view v_dead_stock as
select item_code, item_name, division, category, brand, supplier_name,
       qty, cost_rate, selling_rate, cost_value, selling_value,
       last_purchase, days_held, age_bucket, price_band
from v_stock_aged
where days_held > 180 and qty > 0
order by cost_value desc;



-- ============ STEP 5 — TRANSFER VIEWS ================================

create or replace view v_transfer_lines as
with sent as (
  select
    m.doc_no, m.doc_date, m.item_code, m.item_name,
    m.to_location, m.branch_id as from_branch_id,
    sum(m.qty) as qty_sent,
    max(m.rate) as rate
  from stock_movements m
  where m.direction = 'out'
  group by m.doc_no, m.doc_date, m.item_code, m.item_name, m.to_location, m.branch_id
),
received as (
  select
    m.ref_doc_no as doc_no, m.item_code,
    m.branch_id as to_branch_id,
    sum(m.qty)  as qty_received,
    min(m.doc_date) as received_on
  from stock_movements m
  where m.direction = 'in' and m.ref_doc_no is not null
  group by m.ref_doc_no, m.item_code, m.branch_id
)
select
  s.doc_no, s.doc_date, s.item_code, s.item_name, s.rate,
  fb.code as from_branch, tb.code as to_branch,
  s.to_location,
  s.qty_sent,
  coalesce(r.qty_received, 0) as qty_received,
  coalesce(r.qty_received, 0) - s.qty_sent as difference,
  round((coalesce(r.qty_received, 0) - s.qty_sent) * coalesce(s.rate, 0)) as value_difference,
  r.received_on,
  case
    when r.qty_received is null then 'not received'
    when r.qty_received = s.qty_sent then 'matched'
    when r.qty_received < s.qty_sent then 'short'
    else 'excess'
  end as status,
  extract(day from now() - s.doc_date)::int as days_since_dispatch
from sent s
left join received r on r.doc_no = s.doc_no and r.item_code = s.item_code
left join branches fb on fb.id = s.from_branch_id
left join branches tb on tb.id = r.to_branch_id;

-- ---------------------------------------------------------------------
-- 3. DOCUMENT LEVEL — one row per dispatch note
-- ---------------------------------------------------------------------

create or replace view v_transfer_docs as
select
  doc_no, doc_date, from_branch, to_branch, to_location,
  count(*)                                   as lines,
  sum(qty_sent)                              as sent,
  sum(qty_received)                          as received,
  sum(difference)                            as difference,
  sum(value_difference)                      as value_difference,
  count(*) filter (where status = 'short')   as short_lines,
  count(*) filter (where status = 'excess')  as excess_lines,
  count(*) filter (where status = 'not received') as missing_lines,
  max(days_since_dispatch)                   as days_since_dispatch,
  case
    when count(*) filter (where status = 'not received') = count(*) then 'not received'
    when count(*) filter (where status <> 'matched') = 0            then 'matched'
    else 'discrepancy'
  end as status
from v_transfer_lines
group by doc_no, doc_date, from_branch, to_branch, to_location;

-- ---------------------------------------------------------------------
-- 4. STILL IN TRANSIT — sent, not acknowledged, and getting old
-- ---------------------------------------------------------------------

create or replace view v_in_transit as
select *
from v_transfer_docs
where status in ('not received', 'discrepancy')
  and days_since_dispatch >= 2
order by days_since_dispatch desc;

-- ---------------------------------------------------------------------
-- 5. BY BRANCH — who loses stock in transit
-- ---------------------------------------------------------------------

create or replace view v_transfer_variance_by_branch as
select
  coalesce(to_branch, to_location, 'unknown') as branch,
  count(distinct doc_no)                      as documents,
  sum(qty_sent)                               as sent,
  sum(qty_received)                           as received,
  sum(difference)                             as difference,
  sum(value_difference)                       as value_difference,
  round(
    case when sum(qty_sent) > 0
      then sum(difference)::numeric / sum(qty_sent) * 100
      else 0 end, 2)                          as variance_pct
from v_transfer_lines
where doc_date >= now() - interval '90 days'
group by 1
order by abs(sum(value_difference)) desc nulls last;

-- ---------------------------------------------------------------------
-- 6. THE ITEMS THAT GO MISSING MOST
-- ---------------------------------------------------------------------

create or replace view v_transfer_variance_by_item as
select
  item_code, item_name,
  count(*)              as transfers,
  sum(qty_sent)         as sent,
  sum(qty_received)     as received,
  sum(difference)       as difference,
  sum(value_difference) as value_difference
from v_transfer_lines
where doc_date >= now() - interval '90 days'
  and status <> 'matched'
group by item_code, item_name
having sum(difference) <> 0
order by abs(sum(value_difference)) desc;



-- ============ STEP 6 — BRANCH VIEWS + CACHE RELOAD ===================

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

-- FINAL CHECK: should be about 17
-- select count(*) from information_schema.views where table_name like 'v_stock%'
--    or table_name like 'v_transfer%' or table_name like 'v_%branch%'
--    or table_name in ('v_active_suppliers','v_dead_stock','v_supplier_activity',
--                      'v_purchase_by_item','v_purchase_by_month','v_in_transit');
