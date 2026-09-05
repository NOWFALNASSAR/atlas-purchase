-- =====================================================================
-- ATLAS  |  45_relink_sales.sql
--
-- Fills in division and supplier on sales rows that were unclassified
-- when they were imported.
--
-- WHY THEY ARE UNCLASSIFIED
--
-- A sale knows only its barcode. Division and supplier come from the
-- stock master — and that export lists only barcodes that still have
-- stock. Checked against the real files: of 30,904 stock rows, not one
-- is at zero. So a batch that sold out on the 4th is missing from a
-- file exported on the 5th, and 79% of that day's sales had nothing to
-- match against.
--
-- WHAT FIXES IT
--
-- Upload the stock master in the MORNING, before the day's trading. A
-- barcode sold at 3pm had stock at 9am, so it is in that morning's
-- file. The barcodes table keeps every barcode it has ever seen, so
-- coverage compounds instead of resetting.
--
-- This file adds relink_sales(), which goes back over old sales rows
-- and fills in anything the barcodes table has learned since. Run it
-- after every stock import.
--
-- Run after 44. Safe to re-run.
-- =====================================================================

create or replace function relink_sales(p_from date default null)
returns table (rows_updated int, still_unclassified int, value_unclassified numeric)
language plpgsql security definer set search_path = public as $$
declare v_updated int;
begin
  update sales_barcode_daily s
     set item_id       = coalesce(s.item_id, b.item_id),
         item_name     = coalesce(s.item_name, b.item_name),
         division_code = coalesce(s.division_code, b.division_code),
         supplier_code = coalesce(s.supplier_code, b.supplier_code)
    from barcodes b
   where b.barcode = s.barcode
     and s.division_code is null
     and (p_from is null or s.sale_date >= p_from);

  get diagnostics v_updated = row_count;

  return query
  select v_updated,
         (select count(*)::int from sales_barcode_daily where division_code is null),
         (select coalesce(sum(value_extax), 0) from sales_barcode_daily where division_code is null);
end $$;

grant execute on function relink_sales(date) to authenticated;

-- ---------------------------------------------------------------------
-- HOW MUCH IS STILL UNCLASSIFIED, AND WHAT IT IS WORTH
--
-- Worth watching. If this stays high after you start uploading stock
-- each morning, the timing fix is not working and the real answer is to
-- get the codes onto the sales export.
-- ---------------------------------------------------------------------

create or replace view v_sales_unclassified as
select sale_date, branch_code,
       count(*)::int                                          as barcodes,
       count(*) filter (where division_code is null)::int      as no_division,
       round(100.0 * count(*) filter (where division_code is null)
             / nullif(count(*), 0), 1)                         as pct_barcodes,
       sum(value_extax)                                        as value_total,
       sum(value_extax) filter (where division_code is null)   as value_no_division,
       round(100.0 * sum(value_extax) filter (where division_code is null)
             / nullif(sum(value_extax), 0), 1)                 as pct_value
  from sales_barcode_daily
 group by 1, 2;

-- ---------------------------------------------------------------------
--   select * from relink_sales();
--   select * from v_sales_unclassified order by sale_date desc;
-- ---------------------------------------------------------------------
