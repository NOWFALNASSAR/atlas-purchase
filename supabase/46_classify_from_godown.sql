-- =====================================================================
-- ATLAS  |  46_classify_from_godown.sql
--
-- Take the division and supplier straight from the godown master.
--
-- WHAT WAS WRONG
--
-- The supplier name was looked up as:
--
--     sales -> supplier_code -> suppliers.billing_code -> name
--
-- That last hop only works if migration 40 has run and filled in
-- billing_code. If it has not, every sale shows Unclassified even
-- though the godown master told us the supplier perfectly well — it is
-- sitting in barcodes.supplier_label as 'ALL TEX GARMENTS,TIRUPPUR'.
--
-- Three lookups where one would do, and the two extra ones can each
-- fail silently.
--
-- Now: the name comes from the godown master, and the suppliers table
-- is only used to give it a tidier label when it happens to match.
--
-- Run after 45. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CARRY THE GODOWN'S OWN LABELS ONTO THE SALE
-- ---------------------------------------------------------------------

alter table sales_barcode_daily add column if not exists supplier_label text;
alter table sales_barcode_daily add column if not exists division_name  text;

create index if not exists idx_sbd_suplabel on sales_barcode_daily (supplier_label);

-- ---------------------------------------------------------------------
-- 2. RELINK, TAKING EVERYTHING THE GODOWN MASTER KNOWS
-- ---------------------------------------------------------------------

create or replace function relink_sales(p_from date default null)
returns table (rows_updated int, still_unclassified int, value_unclassified numeric)
language plpgsql security definer set search_path = public as $$
declare v_updated int;
begin
  update sales_barcode_daily s
     set item_id        = coalesce(s.item_id, b.item_id),
         item_name      = coalesce(s.item_name, b.item_name),
         division_code  = coalesce(s.division_code, b.division_code),
         supplier_code  = coalesce(s.supplier_code, b.supplier_code),
         -- the godown's own words, needing no further lookup
         supplier_label = coalesce(s.supplier_label, b.supplier_label),
         division_name  = coalesce(s.division_name, d.name)
    from barcodes b
    left join divisions d on d.code = b.division_code
   where b.barcode = s.barcode
     and (s.division_code is null or s.supplier_label is null)
     and (p_from is null or s.sale_date >= p_from);

  get diagnostics v_updated = row_count;

  return query
  select v_updated,
         (select count(*)::int from sales_barcode_daily
           where division_code is null and supplier_label is null),
         (select coalesce(sum(value_extax), 0) from sales_barcode_daily
           where division_code is null and supplier_label is null);
end $$;

grant execute on function relink_sales(date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. THE VIEWS, READING THE GODOWN MASTER FIRST
-- ---------------------------------------------------------------------

drop view if exists v_sales_division cascade;
drop view if exists v_sales_supplier cascade;

create or replace view v_sales_division as
select coalesce(d.name, s.division_name, 'Unclassified') as division,
       s.division_code,
       sum(s.qty)         as qty,
       sum(s.value_extax) as value_extax,
       sum(s.cost)        as cost,
       sum(s.margin)      as margin,
       case when sum(s.value_extax) <> 0
         then round(sum(s.margin) / sum(s.value_extax) * 100, 2) end as margin_pct
  from sales_barcode_daily s
  left join divisions d on d.code = s.division_code
 group by 1, 2;

create or replace view v_sales_supplier as
select
  -- the tidy name if we have one, otherwise the godown master's own
  -- label, which is 'NAME,PLACE' and perfectly readable
  coalesce(sup.name,
           nullif(split_part(s.supplier_label, ',', 1), ''),
           s.supplier_label,
           'Unclassified')                     as supplier,
  nullif(split_part(s.supplier_label, ',', 2), '') as place,
  s.supplier_code,
  sum(s.qty)         as qty,
  sum(s.value_extax) as value_extax,
  sum(s.cost)        as cost,
  sum(s.margin)      as margin,
  case when sum(s.value_extax) <> 0
    then round(sum(s.margin) / sum(s.value_extax) * 100, 2) end as margin_pct
  from sales_barcode_daily s
  left join suppliers sup on sup.billing_code = s.supplier_code
 group by 1, 2, 3;

-- ---------------------------------------------------------------------
-- 4. FILL IN WHAT IS ALREADY LOADED
-- ---------------------------------------------------------------------

select * from relink_sales();

select * from v_sales_unclassified order by sale_date desc;

-- ---------------------------------------------------------------------
-- If "value_no_division" is still large after this, the barcodes table
-- simply does not have those barcodes — the godown master export still
-- has its stock filter on. Run CHECK-CLASSIFICATION.sql to confirm.
-- ---------------------------------------------------------------------
