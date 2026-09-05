-- =====================================================================
-- ATLAS  |  44_fix_margin_pct.sql
--
-- FIXES: numeric field overflow, precision 7 scale 2
--
-- sales_barcode_daily.margin_pct was numeric(7,2), which stops at
-- 99,999.99. One row in the real day sold for 1 paisa against a cost
-- of 225 — a margin of -2,249,900%.
--
-- Widening rather than clamping. The number is extreme because
-- something went wrong at the till, and rounding it to -100% would
-- hide the only clue.
--
-- Run before the sales day import. Safe to re-run.
-- =====================================================================

drop view if exists v_sales_below_cost cascade;
drop view if exists v_sales_returns    cascade;
drop view if exists v_sales_by_barcode cascade;
drop view if exists v_sales_division   cascade;
drop view if exists v_sales_supplier   cascade;

alter table sales_barcode_daily
  alter column margin_pct type numeric(12,2);

-- put them back
create or replace view v_sales_by_barcode as
select barcode, max(item_name) as item_name,
       min(sale_date) as first_sold, max(sale_date) as last_sold,
       sum(qty) as qty, sum(value_extax) as value_extax,
       sum(cost) as cost, sum(margin) as margin, sum(discount) as discount,
       case when sum(value_extax) <> 0
         then round(sum(margin) / sum(value_extax) * 100, 2) end as margin_pct
  from sales_barcode_daily group by 1;

create or replace view v_sales_division as
select coalesce(d.name, 'Unclassified') as division, s.division_code,
       sum(s.qty) as qty, sum(s.value_extax) as value_extax,
       sum(s.cost) as cost, sum(s.margin) as margin,
       case when sum(s.value_extax) <> 0
         then round(sum(s.margin) / sum(s.value_extax) * 100, 2) end as margin_pct
  from sales_barcode_daily s
  left join divisions d on d.code = s.division_code
 group by 1, 2;

create or replace view v_sales_supplier as
select coalesce(sup.name, 'Unclassified') as supplier, s.supplier_code,
       sum(s.qty) as qty, sum(s.value_extax) as value_extax,
       sum(s.cost) as cost, sum(s.margin) as margin,
       case when sum(s.value_extax) <> 0
         then round(sum(s.margin) / sum(s.value_extax) * 100, 2) end as margin_pct
  from sales_barcode_daily s
  left join suppliers sup on sup.billing_code = s.supplier_code
 group by 1, 2;

create or replace view v_sales_below_cost as
select sale_date, branch_code, barcode, item_name, qty,
       value_extax, cost, margin, margin_pct
  from sales_barcode_daily
 where qty > 0 and cost > 0 and value_extax <= cost
 order by margin;

create or replace view v_sales_returns as
select sale_date, branch_code, barcode, item_name,
       qty, value_extax, cost, margin
  from sales_barcode_daily where qty < 0;

-- and re-apply the read policy the recreated views inherit nothing from
-- (views do not carry policies; the underlying table does, and that is
-- unchanged — this is just a reminder that nothing else needs redoing)

select 'margin_pct is now' as what,
       (select data_type || '(' || numeric_precision || ',' || numeric_scale || ')'
          from information_schema.columns
         where table_name = 'sales_barcode_daily' and column_name = 'margin_pct') as type;
