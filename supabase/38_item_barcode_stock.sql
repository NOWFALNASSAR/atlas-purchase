-- =====================================================================
-- ATLAS  |  38_item_barcode_stock.sql
--
-- The masters, the barcode, and the stock snapshot.
--
-- Shaped from the three files, not from a template. The one decision
-- everything follows from:
--
--   THE BARCODE IS THE STOCK-KEEPING UNIT, NOT THE ITEM.
--
-- One item in your data carries up to 745 barcodes, each a separate
-- purchase batch with its own cost, its own sale price and its own
-- arrival date. Treat the item as the stock unit and you can never
-- answer "what did this piece cost" or "how old is it".
--
-- Stock is held as SNAPSHOTS, not a running balance. Your billing
-- software is the system of record; this reads it. Maintaining a second
-- live balance guarantees the two disagree within a week, and then
-- nobody trusts either.
--
-- Run after 37. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DIVISIONS  (13, from the second sheet)
-- ---------------------------------------------------------------------

create table if not exists divisions (
  code       int primary key,
  name       text not null,
  active     boolean not null default true,
  sort_order int not null default 100
);

-- The DIVISION CODE sheet lists 13 codes, but the stock data uses a
-- code the sheet does not have: 14, on perfume and body spray. The
-- sheet says 13 is PERFUME; the data says 14. Both are seeded — 13
-- because the sheet claims it, 14 because the data uses it.
--
-- The importer also inserts any further unknown codes it meets, so a
-- future export cannot fail on this again.
insert into divisions (code, name, sort_order) values
  (1,'General',1), (2,'Ladies Wear',2), (3,'Kids Wear',3), (4,'Household',4),
  (6,'Gentswear',6), (7,'Footwear',7), (8,'Home Decore',8), (9,'New Born',9),
  (11,'Non Saleable',11), (12,'Footwear Online',12),
  (13,'Perfume (unused)',13), (14,'Perfume',14),
  (15,'Sunglass',15), (16,'School Accessories',16)
on conflict (code) do update set name = excluded.name;

-- Every purchase type the stock master actually uses, so the foreign
-- key above holds on import. 'Non CC' already exists from migration 37.
insert into purchase_types (code, label, sort_order) values
  ('CASH AND CARRY',      'Cash and Carry',        10),
  ('CC SCHOOL',           'CC School',             11),
  ('CC 30 DAYS',          'CC 30 days',            12),
  ('CC 45 DAYS',          'CC 45 days',            13),
  ('CC 60 DAYS',          'CC 60 days',            14),
  ('CC FOOTWEAR',         'CC Footwear',           15),
  ('CC TOYS',             'CC Toys',               16),
  ('CC SUNGLASS',         'CC Sunglass',           17),
  ('CC BELT',             'CC Belt',               18),
  ('CC BEDSHEET',         'CC Bedsheet',           19),
  ('CC CAP',              'CC Cap',                20),
  ('CC PERFUME',          'CC Perfume',            21),
  ('CC BAG',              'CC Bag',                22),
  ('CC SOCKS',            'CC Socks',              23),
  ('CC RAMZAN',           'CC Ramzan',             24),
  ('TIRUPPUR OLD',        'Tiruppur old',          30),
  ('TIRUPUR GARMENTS CC', 'Tirupur Garments CC',   31),
  ('NEW TIRUPUR CC',      'New Tirupur CC',        32),
  ('PMNA FEST',           'PMNA Fest',             40)
on conflict (code) do update set label = excluded.label, active = true;

create table if not exists brands (
  code   int primary key,
  name   text not null,
  active boolean not null default true
);

-- ---------------------------------------------------------------------
-- 2. ITEM MASTER
--
-- Separate from the existing `items` table, which the purchase-order
-- module uses. Merging them now would break working screens. They can
-- be reconciled once the billing export carries item codes.
--
-- code is nullable because the export does not include one — items are
-- matched by name until it does. 100% of stock items matched on name
-- when tested, but a rename in the billing software breaks the link
-- silently, which is why the code column is here waiting.
-- ---------------------------------------------------------------------

create table if not exists item_master (
  id            uuid primary key default gen_random_uuid(),
  code          int unique,
  name          text not null,
  name_key      text generated always as (upper(btrim(name))) stored,
  division_code int references divisions(code),
  unit          text default 'Nos',
  tax_pct       numeric(5,2) default 0,
  cess_pct      numeric(5,2) default 0,
  hsn           text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- The join key while there is no item code — and unique, so that a
-- second import updates rather than duplicating. Without this,
-- "on conflict do nothing" has no conflict to detect and quietly
-- inserts 11,585 items again.
create unique index if not exists uq_item_master_name on item_master (name_key);
create index if not exists idx_item_master_divi on item_master (division_code);

-- ---------------------------------------------------------------------
-- 3. SUPPLIER MASTER
--
-- Also separate from `suppliers`. The stock export identifies a supplier
-- as 'NAME,PLACE' — that composite is the join key, and it matched
-- 98.4% when tested.
-- ---------------------------------------------------------------------

create table if not exists supplier_master (
  id         uuid primary key default gen_random_uuid(),
  code       int unique,
  name       text not null,
  place      text,
  match_key  text generated always as (upper(btrim(name || ',' || coalesce(place,'')))) stored,
  address    text,
  address2   text,
  phone      text,
  mobile     text,
  gstin      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_supplier_master_key on supplier_master (match_key);

-- ---------------------------------------------------------------------
-- 4. BARCODES — the centre of everything
-- ---------------------------------------------------------------------

create table if not exists barcodes (
  id             uuid primary key default gen_random_uuid(),
  barcode        text not null,
  item_code      int,
  item_name      text not null,
  item_name_key  text generated always as (upper(btrim(item_name))) stored,
  supplier_code  int,
  supplier_label text,                       -- 'NAME,PLACE' as exported
  division_code  int references divisions(code),
  brand_code     int,
  brand_name     text,
  purchase_ref   int,                        -- PurRefNo, the purchase entry
  arrival_date   date,

  qty_received   numeric(14,2),              -- Qty
  unit_cost      numeric(14,4),              -- Amount ÷ Stock at import
  sale_price     numeric(14,2),
  sale_price_disc numeric(14,2),

  size           text,

  -- The billing software stores the PURCHASE TYPE in the column its
  -- export labels "Colour": CASH AND CARRY, CC SCHOOL, CC 30 DAYS,
  -- PMNA FEST and so on.
  --
  -- Anything that is not one of those — blank, or the two stray real
  -- colours CREAM and DARK CREAM — is a Non CC purchase. So every row
  -- ends up classified and nothing lands in an "Unclassified" bucket
  -- that then gets ignored.
  purchase_type  text not null default 'Non CC' references purchase_types(code),
  design         text,

  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),

  -- 124 barcodes repeat in the export, so barcode alone is not unique.
  -- The batch is identified by the barcode plus which purchase brought
  -- it in.
  unique (barcode, purchase_ref)
);

create index if not exists idx_barcode_code     on barcodes (barcode);
create index if not exists idx_barcode_item     on barcodes (item_code);
create index if not exists idx_barcode_itemname on barcodes (item_name_key);
create index if not exists idx_barcode_supplier on barcodes (supplier_code);
create index if not exists idx_barcode_division on barcodes (division_code);
create index if not exists idx_barcode_arrival  on barcodes (arrival_date);
create index if not exists idx_barcode_purtype  on barcodes (purchase_type);

-- ---------------------------------------------------------------------
-- 5. STOCK SNAPSHOTS
--
-- One row per upload, so this week can be compared with last week.
-- ---------------------------------------------------------------------

create table if not exists stock_snapshots (
  id            uuid primary key default gen_random_uuid(),
  taken_on      date not null default current_date,
  source_file   text,
  entity_id     uuid references entities(id),

  -- Shop-wise stock is the next export. A snapshot belongs to one shop,
  -- or to none when it is the whole company. Without this the second
  -- upload would overwrite the first and nobody would notice.
  shop_id       uuid references shops(id),
  shop_code     text,
  rows_loaded   int not null default 0,
  total_pieces  numeric(16,2),
  total_value   numeric(16,2),
  uploaded_by   uuid references profiles(id) default auth.uid(),
  note          text,
  created_at    timestamptz not null default now()
);

create table if not exists stock_lines (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references stock_snapshots(id) on delete cascade,
  barcode       text not null,
  purchase_ref  int,
  item_code     int,
  item_name     text,
  supplier_code int,
  division_code int,

  shop_id       uuid references shops(id),
  shop_code     text,

  qty_received  numeric(14,2),      -- Qty
  qty_on_hand   numeric(14,2),      -- Stock
  -- StockPer as exported. Wide, because 58 rows in the real file show
  -- more stock on hand than was ever purchased — one has Qty 1 and
  -- Stock 136, which is 13,600%. numeric(6,2) stops at 9999.99 and the
  -- import fails. See v_stock_anomalies below.
  stock_pct     numeric(12,2),
  value_at_cost numeric(16,2),      -- Amount
  unit_cost     numeric(14,4),
  sale_price    numeric(14,2),
  arrival_date  date,
  days_held     int,                -- NoofDays
  purchase_type text not null default 'Non CC',   -- see barcodes

  -- derived once at import so every report does not recompute them
  qty_sold      numeric(14,2) generated always as
                  (greatest(coalesce(qty_received,0) - coalesce(qty_on_hand,0), 0)) stored,
  sell_through  numeric(6,2) generated always as
                  (case when coalesce(qty_received,0) > 0
                    then least(greatest((coalesce(qty_received,0) - coalesce(qty_on_hand,0))
                         / qty_received * 100, 0), 100) end) stored
);

create index if not exists idx_stock_lines_snap on stock_lines (snapshot_id);
create index if not exists idx_stock_lines_bc   on stock_lines (barcode);
create index if not exists idx_stock_lines_item on stock_lines (item_code);
create index if not exists idx_stock_lines_divi on stock_lines (division_code);
create index if not exists idx_stock_lines_days on stock_lines (days_held);
create index if not exists idx_stock_lines_shop on stock_lines (shop_id);
create index if not exists idx_stock_lines_ptype on stock_lines (purchase_type);

-- one snapshot per shop per day, so re-uploading replaces rather than doubles
create unique index if not exists uq_snapshot_day_shop on stock_snapshots
  (taken_on, coalesce(shop_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------
-- 6. SALES, WAITING
--
-- No sales data has been supplied yet, so nothing fills this. The shape
-- follows the barcode, which is how a sale ties back to what it cost.
-- ---------------------------------------------------------------------

create table if not exists sales_lines (
  id            uuid primary key default gen_random_uuid(),
  bill_no       text,
  bill_date     date not null,
  branch_code   text,
  branch_id     uuid references branches(id),
  barcode       text,
  item_code     int,
  item_name     text,
  division_code int references divisions(code),
  qty           numeric(14,2) not null default 0,
  rate          numeric(14,2),
  discount      numeric(14,2) default 0,
  tax_pct       numeric(5,2),
  tax_amount    numeric(14,2) default 0,
  net_amount    numeric(14,2),
  cost_amount   numeric(14,2),       -- filled from the barcode, for margin
  salesman_code text,
  customer_name text,
  is_return     boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_sales_lines_date on sales_lines (bill_date);
create index if not exists idx_sales_lines_bc   on sales_lines (barcode);
create index if not exists idx_sales_lines_item on sales_lines (item_code);

-- ---------------------------------------------------------------------
-- 7. THE TWELVE REPORTS THAT WORK TODAY
-- ---------------------------------------------------------------------

-- the newest snapshot, so every view below reads one consistent set
-- The latest snapshot FOR EACH SHOP, not just the latest overall.
-- Once shop-wise stock arrives, "the newest row" would otherwise show
-- one shop and silently hide the rest.
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
       im.name as item_master_name, im.tax_pct,
       sm.name as supplier_name, sm.place as supplier_place,
       sh.name as shop_name
  from stock_lines l
  join latest lt on lt.id = l.snapshot_id
  left join divisions d on d.code = l.division_code
  left join item_master im on im.code = l.item_code
  left join supplier_master sm on sm.code = l.supplier_code
  left join shops sh on sh.id = l.shop_id;

-- shop by shop, once that export arrives
create or replace view v_stock_by_shop as
select coalesce(shop_name, 'All shops') as shop,
       shop_id,
       count(*)::int      as barcodes,
       sum(qty_on_hand)   as pieces,
       sum(value_at_cost) as value,
       round(avg(sell_through), 1) as avg_sell_through
  from v_stock_current group by 1, 2;

-- ageing, in the buckets the analysis used
create or replace view v_stock_ageing as
select
  case
    when days_held <= 30  then '0-30 days'
    when days_held <= 60  then '31-60 days'
    when days_held <= 90  then '61-90 days'
    when days_held <= 180 then '91-180 days'
    when days_held <= 365 then '181-365 days'
    else                       'over a year'
  end as bucket,
  case
    when days_held <= 30 then 1 when days_held <= 60 then 2
    when days_held <= 90 then 3 when days_held <= 180 then 4
    when days_held <= 365 then 5 else 6 end as sort_order,
  count(*)::int          as barcodes,
  sum(qty_on_hand)       as pieces,
  sum(value_at_cost)     as value,
  round(100 * sum(value_at_cost) / nullif(sum(sum(value_at_cost)) over (), 0), 1) as share_pct
from v_stock_current
group by 1, 2;

create or replace view v_stock_by_division_now as
select coalesce(division_name, 'Unclassified') as division,
       count(*)::int      as barcodes,
       sum(qty_received)  as purchased,
       sum(qty_on_hand)   as in_stock,
       sum(value_at_cost) as value,
       round(avg(sell_through), 1) as avg_sell_through
  from v_stock_current group by 1;

-- Stock by purchase type. This is the join that connects the stock
-- master to the purchase targets from migration 37 — the same CC and
-- Non CC that targets are set against.
create or replace view v_stock_by_purchase_type as
select purchase_type,
       count(*)::int      as barcodes,
       sum(qty_received)  as purchased,
       sum(qty_on_hand)   as in_stock,
       sum(value_at_cost) as value,
       round(avg(sell_through), 1) as avg_sell_through,
       min(arrival_date)  as oldest_arrival
  from v_stock_current group by 1;

create or replace view v_stock_by_supplier_now as
select coalesce(supplier_name, 'Unknown') as supplier,
       supplier_code,
       count(*)::int      as barcodes,
       sum(qty_on_hand)   as pieces,
       sum(value_at_cost) as value,
       round(avg(sell_through), 1) as avg_sell_through,
       min(arrival_date)  as oldest_arrival
  from v_stock_current group by 1, 2;

-- Rows where the stock on hand is greater than the quantity ever
-- purchased. That cannot be true, so it is a data problem in the
-- billing software — a stock adjustment posted without a purchase, or a
-- barcode reused across batches.
--
-- It matters because these rows show qty_sold of zero, which drops them
-- into the dead-stock report and overstates it. Worth someone checking.
create or replace view v_stock_anomalies as
select barcode, item_name, supplier_name, qty_received, qty_on_hand,
       round(stock_pct, 1) as stock_pct, value_at_cost, arrival_date
  from v_stock_current
 where qty_on_hand > qty_received
 order by qty_on_hand - qty_received desc;

-- never sold a single piece
create or replace view v_dead_barcodes as
select * from v_stock_current
 where qty_sold <= 0 and qty_on_hand > 0
   and qty_on_hand <= qty_received;   -- the anomalies above are not dead stock

-- bought a while ago and barely moving
create or replace view v_slow_movers as
select * from v_stock_current
 where days_held > 90 and sell_through < 25 and qty_on_hand > 0;

create or replace view v_fast_movers as
select * from v_stock_current where sell_through > 75;

-- the same product sitting at several prices
create or replace view v_price_spread as
select item_code, item_name,
       count(distinct sale_price)::int as price_points,
       min(sale_price) as lowest,
       max(sale_price) as highest,
       sum(qty_on_hand) as pieces,
       sum(value_at_cost) as value
  from v_stock_current
 group by 1, 2
having count(distinct sale_price) > 1;

-- batches where cost is at or above the selling price
create or replace view v_loss_making_batches as
select * from v_stock_current
 where unit_cost >= sale_price and sale_price > 0;

-- ---------------------------------------------------------------------
-- 8. SECURITY
-- ---------------------------------------------------------------------

alter table divisions       enable row level security;
alter table brands          enable row level security;
alter table item_master     enable row level security;
alter table supplier_master enable row level security;
alter table barcodes        enable row level security;
alter table stock_snapshots enable row level security;
alter table stock_lines     enable row level security;
alter table sales_lines     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['divisions','brands','item_master','supplier_master',
                           'barcodes','stock_snapshots','stock_lines','sales_lines'] loop
    execute format('drop policy if exists read_%1$s on %1$I', t);
    execute format('create policy read_%1$s on %1$I for select to authenticated
                    using (has_perm(''inventory.view'') or my_role() = ''admin'')', t);

    execute format('drop policy if exists write_%1$s on %1$I', t);
    execute format('create policy write_%1$s on %1$I for all to authenticated
                    using (has_perm(''stock.import'') or my_role() = ''admin'')
                    with check (has_perm(''stock.import'') or my_role() = ''admin'')', t);
  end loop;
end $$;

insert into permissions (code, module, label, hint, sort_order) values
  ('stock.import',  'stock', 'Upload stock and sales',
   'Import the stock master and sales export from the billing software', 170),
  ('stock.reports', 'stock', 'Stock reports',
   'Ageing, dead stock, sell-through, price spread', 180)
on conflict (code) do update
  set label = excluded.label, hint = excluded.hint, active = true;

insert into role_permissions (role, permission_code)
select r.code, p.code from roles r cross join (values ('stock.reports')) p(code)
 where r.active and r.base_role in ('hod','manager')
on conflict do nothing;

-- ---------------------------------------------------------------------
--   select * from v_stock_ageing order by sort_order;
--   select * from v_stock_by_division_now order by value desc;
--   select count(*), sum(value_at_cost) from v_dead_barcodes;
-- ---------------------------------------------------------------------
