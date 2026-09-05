-- =====================================================================
-- ATLAS  |  40_unify_masters.sql
--
-- One item master and one supplier master, used everywhere.
--
-- WHICH WAY THE MERGE GOES, AND WHY
--
-- The uploaded data goes INTO `items` and `suppliers`, not the other
-- way round. Those two tables are referenced by po_items.item_id and
-- purchase_orders.supplier_id — every order you have ever raised points
-- at them. Pointing the order screens at a different table instead
-- would orphan all of it.
--
-- So `items` and `suppliers` stay as the single master. item_master and
-- supplier_master become what they always should have been: the landing
-- area for an import, which this file then folds in.
--
-- Existing rows are matched by name and updated, not duplicated. An
-- item already used on an order keeps its id, so the order keeps
-- working.
--
-- Run after 38 and the import. Safe to re-run — running it again after
-- the next import folds in whatever is new.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ROOM FOR WHAT THE BILLING EXPORT CARRIES
-- ---------------------------------------------------------------------

alter table items add column if not exists division_code int references divisions(code);
alter table items add column if not exists unit          text default 'Nos';
alter table items add column if not exists tax_pct       numeric(5,2) default 0;
alter table items add column if not exists cess_pct      numeric(5,2) default 0;
alter table items add column if not exists hsn           text;
alter table items add column if not exists billing_code  int;      -- ItemCode from the billing software
alter table items add column if not exists source        text default 'atlas';

alter table suppliers add column if not exists place        text;
alter table suppliers add column if not exists billing_code int;
alter table suppliers add column if not exists source       text default 'atlas';

create index if not exists idx_items_billing_code on items (billing_code);
create index if not exists idx_items_name_lower   on items (lower(btrim(name)));
create index if not exists idx_suppliers_billing  on suppliers (billing_code);
create index if not exists idx_suppliers_name_low on suppliers (lower(btrim(name)));

-- ---------------------------------------------------------------------
-- 2. ITEMS
--
-- items.code is unique and not null, but 8,102 of the imported items
-- have no code from the billing software — they have never been in
-- stock. Those get a code built from the name, so the column stays
-- honest and the item is still usable on an order.
-- ---------------------------------------------------------------------

-- update the ones already here, matched on name
update items i
   set division_code = coalesce(m.division_code, i.division_code),
       unit          = coalesce(m.unit, i.unit),
       tax_pct       = coalesce(m.tax_pct, i.tax_pct),
       cess_pct      = coalesce(m.cess_pct, i.cess_pct),
       billing_code  = coalesce(m.code, i.billing_code),
       source        = 'billing'
  from item_master m
 where lower(btrim(i.name)) = lower(btrim(m.name));

-- add the ones that are new
insert into items (code, name, category, unit, tax_pct, cess_pct,
                   division_code, billing_code, source, active)
select
  -- A code that is unique and readable: BILL-31235 where the billing
  -- software has one, otherwise built from the name plus 8 hex
  -- characters of its hash. Four characters collided three times across
  -- 11,585 names, and `on conflict do nothing` would have silently
  -- dropped those items.
  case when m.code is not null then 'BILL-' || m.code
       else 'IM-' || upper(regexp_replace(left(btrim(m.name), 12), '[^A-Za-z0-9]', '', 'g'))
            || '-' || left(md5(btrim(m.name)), 8)
  end,
  btrim(m.name),
  d.name,
  coalesce(m.unit, 'Nos'),
  coalesce(m.tax_pct, 0),
  coalesce(m.cess_pct, 0),
  m.division_code,
  m.code,
  'billing',
  true
  from item_master m
  left join divisions d on d.code = m.division_code
 where not exists (
   select 1 from items i where lower(btrim(i.name)) = lower(btrim(m.name)))
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 3. SUPPLIERS
-- ---------------------------------------------------------------------

update suppliers s
   set place        = coalesce(m.place, s.place),
       address      = coalesce(s.address, m.address),
       mobile       = coalesce(nullif(btrim(s.mobile), ''), nullif(btrim(m.mobile), '')),
       billing_code = coalesce(m.code, s.billing_code),
       source       = 'billing'
  from supplier_master m
 where lower(btrim(s.name)) = lower(btrim(m.name));

insert into suppliers (code, name, place, address, mobile, billing_code, source, active)
select
  case when m.code is not null then 'BILL-' || m.code
       else 'SM-' || upper(regexp_replace(left(btrim(m.name), 12), '[^A-Za-z0-9]', '', 'g'))
            || '-' || left(md5(m.match_key), 8)
  end,
  btrim(m.name),
  m.place,
  nullif(btrim(coalesce(m.address, '') || ' ' || coalesce(m.address2, '')), ''),
  nullif(btrim(m.mobile), ''),
  m.code,
  'billing',
  true
  from supplier_master m
 where not exists (
   select 1 from suppliers s where lower(btrim(s.name)) = lower(btrim(m.name)))
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 4. TIE THE STOCK TO THE UNIFIED MASTER
--
-- So a stock report and a purchase order are talking about the same
-- item row, not two rows that happen to share a name.
-- ---------------------------------------------------------------------

alter table barcodes    add column if not exists item_id     uuid references items(id);
alter table barcodes    add column if not exists supplier_id uuid references suppliers(id);
alter table stock_lines add column if not exists item_id     uuid references items(id);

create index if not exists idx_barcodes_item_id on barcodes (item_id);
create index if not exists idx_stock_lines_item_id on stock_lines (item_id);

update barcodes b set item_id = i.id
  from items i
 where b.item_id is null
   and (i.billing_code = b.item_code
     or lower(btrim(i.name)) = lower(btrim(b.item_name)));

update barcodes b set supplier_id = s.id
  from suppliers s
 where b.supplier_id is null
   and s.billing_code = b.supplier_code;

update stock_lines l set item_id = i.id
  from items i
 where l.item_id is null
   and (i.billing_code = l.item_code
     or lower(btrim(i.name)) = lower(btrim(l.item_name)));

-- ---------------------------------------------------------------------
-- 5. THE STOCK VIEWS NOW READ THE UNIFIED MASTER
-- ---------------------------------------------------------------------

drop view if exists v_loss_making_batches cascade;
drop view if exists v_price_spread        cascade;
drop view if exists v_fast_movers         cascade;
drop view if exists v_slow_movers         cascade;
drop view if exists v_dead_barcodes       cascade;
drop view if exists v_stock_anomalies     cascade;
drop view if exists v_stock_by_supplier_now cascade;
drop view if exists v_stock_by_purchase_type cascade;
drop view if exists v_stock_by_division_now cascade;
drop view if exists v_stock_ageing        cascade;
drop view if exists v_stock_by_shop       cascade;
drop view if exists v_stock_current       cascade;

create or replace view v_stock_current as
with latest as (
  select distinct on (coalesce(shop_id, '00000000-0000-0000-0000-000000000000'::uuid))
         id, shop_id, shop_code, taken_on
    from stock_snapshots
   order by coalesce(shop_id, '00000000-0000-0000-0000-000000000000'::uuid),
            taken_on desc, created_at desc
)
select l.*,
       lt.taken_on, lt.shop_code as snapshot_shop,
       d.name  as division_name,
       i.name  as item_master_name, i.tax_pct, i.category,
       s.name  as supplier_name, s.place as supplier_place,
       sh.name as shop_name
  from stock_lines l
  join latest lt on lt.id = l.snapshot_id
  left join divisions d on d.code = l.division_code
  left join items i on i.id = l.item_id                    -- the unified master
  left join suppliers s on s.billing_code = l.supplier_code
  left join shops sh on sh.id = l.shop_id;

create or replace view v_stock_by_shop as
select coalesce(shop_name, 'All shops') as shop, shop_id,
       count(*)::int as barcodes, sum(qty_on_hand) as pieces,
       sum(value_at_cost) as value, round(avg(sell_through), 1) as avg_sell_through
  from v_stock_current group by 1, 2;

create or replace view v_stock_ageing as
select
  case when days_held <= 30 then '0-30 days' when days_held <= 60 then '31-60 days'
       when days_held <= 90 then '61-90 days' when days_held <= 180 then '91-180 days'
       when days_held <= 365 then '181-365 days' else 'over a year' end as bucket,
  case when days_held <= 30 then 1 when days_held <= 60 then 2
       when days_held <= 90 then 3 when days_held <= 180 then 4
       when days_held <= 365 then 5 else 6 end as sort_order,
  count(*)::int as barcodes, sum(qty_on_hand) as pieces, sum(value_at_cost) as value,
  round(100 * sum(value_at_cost) / nullif(sum(sum(value_at_cost)) over (), 0), 1) as share_pct
from v_stock_current group by 1, 2;

create or replace view v_stock_by_division_now as
select coalesce(division_name, 'Unclassified') as division,
       count(*)::int as barcodes, sum(qty_received) as purchased,
       sum(qty_on_hand) as in_stock, sum(value_at_cost) as value,
       round(avg(sell_through), 1) as avg_sell_through
  from v_stock_current group by 1;

create or replace view v_stock_by_purchase_type as
select purchase_type, count(*)::int as barcodes, sum(qty_received) as purchased,
       sum(qty_on_hand) as in_stock, sum(value_at_cost) as value,
       round(avg(sell_through), 1) as avg_sell_through, min(arrival_date) as oldest_arrival
  from v_stock_current group by 1;

create or replace view v_stock_by_supplier_now as
select coalesce(supplier_name, 'Unknown') as supplier, supplier_code,
       count(*)::int as barcodes, sum(qty_on_hand) as pieces,
       sum(value_at_cost) as value, round(avg(sell_through), 1) as avg_sell_through,
       min(arrival_date) as oldest_arrival
  from v_stock_current group by 1, 2;

create or replace view v_stock_anomalies as
select barcode, item_name, supplier_name, qty_received, qty_on_hand,
       round(stock_pct, 1) as stock_pct, value_at_cost, arrival_date
  from v_stock_current where qty_on_hand > qty_received
 order by qty_on_hand - qty_received desc;

create or replace view v_dead_barcodes as
select * from v_stock_current
 where qty_sold <= 0 and qty_on_hand > 0 and qty_on_hand <= qty_received;

create or replace view v_slow_movers as
select * from v_stock_current
 where days_held > 90 and sell_through < 25 and qty_on_hand > 0;

create or replace view v_fast_movers as
select * from v_stock_current where sell_through > 75;

create or replace view v_price_spread as
select item_code, item_name, count(distinct sale_price)::int as price_points,
       min(sale_price) as lowest, max(sale_price) as highest,
       sum(qty_on_hand) as pieces, sum(value_at_cost) as value
  from v_stock_current group by 1, 2 having count(distinct sale_price) > 1;

create or replace view v_loss_making_batches as
select * from v_stock_current where unit_cost >= sale_price and sale_price > 0;

-- ---------------------------------------------------------------------
-- 6. WHAT YOU HAVE NOW
-- ---------------------------------------------------------------------

select 'items total'          as figure, count(*)::text from items
union all select 'items from billing',   count(*)::text from items where source = 'billing'
union all select 'items with a billing code', count(*)::text from items where billing_code is not null
union all select 'suppliers total',      count(*)::text from suppliers
union all select 'suppliers from billing', count(*)::text from suppliers where source = 'billing'
union all select 'barcodes linked to an item', count(*)::text from barcodes where item_id is not null
union all select 'barcodes not linked',   count(*)::text from barcodes where item_id is null
union all select 'stock lines linked',    count(*)::text from stock_lines where item_id is not null;

-- Expect roughly 11,600 items and 1,910 suppliers, and nearly every
-- barcode linked. Anything unlinked is an item name in the stock file
-- that is not in the item master export — worth a look, but it does not
-- break anything: the stock row keeps its own item_name.
