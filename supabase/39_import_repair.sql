-- =====================================================================
-- ATLAS  |  39_import_repair.sql
--
-- Run this if you ran an import part more than once.
--
-- WHAT WENT WRONG
--
-- item_master and supplier_master had no unique index on the name, so
-- `on conflict do nothing` had no conflict to detect. Re-running part 01
-- inserted every item and supplier a second time instead of skipping
-- them. And stock_snapshots DID have a unique index, which is why you
-- got the error — that one refused, the others did not.
--
-- This removes the duplicates, adds the missing indexes so it cannot
-- happen again, and clears today's snapshot so the import can be run
-- from the start cleanly.
--
-- Safe to re-run. Safe if you never duplicated anything.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. HOW BAD IS IT
-- ---------------------------------------------------------------------

do $$
declare
  v_items int; v_item_dupes int; v_sup int; v_sup_dupes int;
begin
  select count(*) into v_items from item_master;
  select count(*) - count(distinct upper(btrim(name))) into v_item_dupes from item_master;
  select count(*) into v_sup from supplier_master;
  select count(*) - count(distinct upper(btrim(name || ',' || coalesce(place,''))))
    into v_sup_dupes from supplier_master;

  raise notice 'item_master     : % rows, % duplicates', v_items, v_item_dupes;
  raise notice 'supplier_master : % rows, % duplicates', v_sup, v_sup_dupes;
end $$;

-- ---------------------------------------------------------------------
-- 2. KEEP THE FIRST OF EACH, DROP THE REST
--
-- Keeping the oldest row rather than the newest, because anything that
-- already points at an item_master row points at the first one.
-- ---------------------------------------------------------------------

delete from item_master a
 using item_master b
 where a.name_key = b.name_key
   and a.ctid > b.ctid;

delete from supplier_master a
 using supplier_master b
 where a.match_key = b.match_key
   and a.ctid > b.ctid;

-- ---------------------------------------------------------------------
-- 3. THE INDEXES THAT SHOULD HAVE BEEN THERE
-- ---------------------------------------------------------------------

drop index if exists idx_item_master_name;
create unique index if not exists uq_item_master_name on item_master (name_key);

drop index if exists idx_supplier_master_key;
create unique index if not exists uq_supplier_master_key on supplier_master (match_key);

-- ---------------------------------------------------------------------
-- 4. WIDEN stock_pct
--
-- It was numeric(6,2), which stops at 9999.99. 58 rows in the real file
-- have more stock on hand than was ever purchased — one shows Qty 1 and
-- Stock 136, which is 13,600% — and the import failed on them.
--
-- Widening rather than clamping, because the number is wrong in the
-- source data and hiding it would not make it right. v_stock_anomalies
-- lists them.
-- ---------------------------------------------------------------------

-- A column cannot be retyped while a view reads it, and twelve views
-- read this one. They are dropped here and recreated by re-running
-- 38_item_barcode_stock.sql afterwards — which is why 38 comes after
-- this file, not before.
--
-- Dropping a view destroys no data. Every one of these is a saved
-- query over stock_lines.

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

alter table stock_lines alter column stock_pct type numeric(12,2);

-- ---------------------------------------------------------------------
-- 5. CLEAR TODAY'S SNAPSHOT SO THE IMPORT CAN START AGAIN
--
-- stock_lines cascade from the snapshot, so this clears any partial
-- load. Barcodes are left alone — they upsert correctly on their own.
-- ---------------------------------------------------------------------

delete from stock_snapshots
 where taken_on = current_date and shop_id is null;

commit;

-- ---------------------------------------------------------------------
-- 6. WHERE YOU ARE NOW
-- ---------------------------------------------------------------------

select 'item_master'      as table_name, count(*) as rows from item_master
union all select 'supplier_master', count(*) from supplier_master
union all select 'barcodes',        count(*) from barcodes
union all select 'stock_snapshots', count(*) from stock_snapshots
union all select 'stock_lines',     count(*) from stock_lines;

-- Expected after this runs:
--   item_master      11,585
--   supplier_master   1,907
--   barcodes          0 or 30,904 depending on how far you got
--   stock_snapshots   0
--   stock_lines       0
--
-- NEXT, IN THIS ORDER:
--
--   1. this file                        (you have just run it)
--   2. 38_item_barcode_stock.sql        recreates the twelve views
--   3. import parts 01 to 12
--
-- Running 38 second is the part people get wrong. The views were
-- dropped above so the column could be retyped, and 38 is what puts
-- them back.
--
-- Items and suppliers will now skip correctly, barcodes update in
-- place, and the snapshot is created fresh.
-- ---------------------------------------------------------------------
