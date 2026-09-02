-- =====================================================================
-- ATLAS  |  15_inventory.sql
-- Godown inventory and purchase analytics.
--
-- Two detail tables synced from the godown server, and every report
-- built as a view on top. Because the detail is here, any report can
-- be sliced by any dimension and drilled into item by item.
--
-- Every figure carries three rates:
--   purchase_rate  what the supplier invoiced
--   cost_rate      landed cost after freight and loading
--   selling_rate   the tag price
--
-- Run after 13_branches.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. GODOWN STOCK — one row per item, refreshed each sync
-- ---------------------------------------------------------------------

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

create index if not exists idx_gs_division  on godown_stock (division);
create index if not exists idx_gs_category  on godown_stock (category);
create index if not exists idx_gs_brand     on godown_stock (brand);
create index if not exists idx_gs_supplier  on godown_stock (supplier_code);
create index if not exists idx_gs_colour    on godown_stock (colour);
create index if not exists idx_gs_selling   on godown_stock (selling_rate);
create index if not exists idx_gs_last_pur  on godown_stock (last_purchase);
create index if not exists idx_gs_item      on godown_stock (item_code);

-- ---------------------------------------------------------------------
-- 2. PURCHASE DETAIL — one row per purchase line
-- ---------------------------------------------------------------------

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

create index if not exists idx_gp_date     on godown_purchases (purch_date desc);
create index if not exists idx_gp_supplier on godown_purchases (supplier_code);
create index if not exists idx_gp_item     on godown_purchases (item_code);
create index if not exists idx_gp_division on godown_purchases (division);
create index if not exists idx_gp_brand    on godown_purchases (brand);

-- ---------------------------------------------------------------------
-- 3. SECURITY
-- ---------------------------------------------------------------------

alter table godown_stock     enable row level security;
alter table godown_purchases enable row level security;

drop policy if exists read_godown_stock on godown_stock;
create policy read_godown_stock on godown_stock for select to authenticated using (true);

drop policy if exists read_godown_purchases on godown_purchases;
create policy read_godown_purchases on godown_purchases for select to authenticated
  using (my_role() in ('manager','hod','accounts','admin'));

-- ---------------------------------------------------------------------
-- 4. STOCK AGEING — how long has it been sitting
-- ---------------------------------------------------------------------

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

notify pgrst, 'reload schema';

-- Verify:
--   select count(*) from information_schema.views where table_name like 'v_stock%';
--   (should be 8)
