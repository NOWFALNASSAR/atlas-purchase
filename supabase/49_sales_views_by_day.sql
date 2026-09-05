-- =====================================================================
-- ATLAS  |  49_sales_views_by_day.sql
--
-- FIXES: picking a shop or a day leaves Divisions, Suppliers and
--        Customers showing everything.
--
-- Those three views grouped by division, by supplier and by customer —
-- and by nothing else. No date, no branch. So there was nothing for the
-- pickers to filter on, and they quietly returned every day of every
-- shop while the rest of the screen showed one.
--
-- Worse than a wrong number: two numbers on one screen measuring
-- different things, with nothing to say so.
--
-- Now each carries sale_date and branch_code, and the screen filters
-- them like everything else.
--
-- Run after 48. Safe to re-run.
-- =====================================================================

drop view if exists v_sales_division cascade;
drop view if exists v_sales_supplier cascade;
drop view if exists v_customers      cascade;

-- ---------------------------------------------------------------------
-- DIVISION, PER DAY PER BRANCH
-- ---------------------------------------------------------------------

create or replace view v_sales_division as
select
  s.sale_date,
  s.branch_code,
  coalesce(d.name, s.division_name, 'Unclassified') as division,
  s.division_code,
  sum(s.qty)         as qty,
  sum(s.value_extax) as value_extax,
  sum(s.cost)        as cost,
  sum(s.margin)      as margin,
  case when sum(s.value_extax) <> 0
    then round(sum(s.margin) / sum(s.value_extax) * 100, 2) end as margin_pct
from sales_barcode_daily s
left join divisions d on d.code = s.division_code
group by 1, 2, 3, 4;

-- ---------------------------------------------------------------------
-- SUPPLIER, PER DAY PER BRANCH
--
-- The name comes from the godown master's own label first, because that
-- is always there. The suppliers table only tidies it up.
-- ---------------------------------------------------------------------

create or replace view v_sales_supplier as
select
  s.sale_date,
  s.branch_code,
  coalesce(sup.name,
           nullif(split_part(s.supplier_label, ',', 1), ''),
           s.supplier_label,
           'Unclassified')                              as supplier,
  nullif(split_part(s.supplier_label, ',', 2), '')      as place,
  s.supplier_code,
  sum(s.qty)         as qty,
  sum(s.value_extax) as value_extax,
  sum(s.cost)        as cost,
  sum(s.margin)      as margin,
  case when sum(s.value_extax) <> 0
    then round(sum(s.margin) / sum(s.value_extax) * 100, 2) end as margin_pct
from sales_barcode_daily s
left join suppliers sup on sup.billing_code = s.supplier_code
group by 1, 2, 3, 4, 5;

-- ---------------------------------------------------------------------
-- CUSTOMERS
--
-- A customer's history is not one day's business, so this stays across
-- all time — but it now carries the branch and the last date, so the
-- screen can narrow it to a shop, and to people seen on or before the
-- day being looked at.
-- ---------------------------------------------------------------------

create or replace view v_customers as
select
  customer_phone,
  branch_code,
  max(customer_name)    as name,
  count(*)::int         as visits,
  min(bill_date)        as first_seen,
  max(bill_date)        as last_seen,
  sum(amount)           as spent,
  round(avg(amount), 2) as avg_bill,
  (current_date - max(bill_date)) as days_since
from sales_bills
where customer_phone is not null and not cancelled
group by 1, 2;

-- ---------------------------------------------------------------------
-- ACROSS ALL DAYS, WHEN THAT IS WHAT YOU WANT
--
-- Kept separately rather than by dropping the date from the views
-- above. A report that ignores the picker should say so in its name.
-- ---------------------------------------------------------------------

create or replace view v_sales_division_all as
select division, division_code,
       sum(qty) as qty, sum(value_extax) as value_extax,
       sum(cost) as cost, sum(margin) as margin,
       case when sum(value_extax) <> 0
         then round(sum(margin) / sum(value_extax) * 100, 2) end as margin_pct
  from v_sales_division group by 1, 2;

create or replace view v_sales_supplier_all as
select supplier, place, supplier_code,
       sum(qty) as qty, sum(value_extax) as value_extax,
       sum(cost) as cost, sum(margin) as margin,
       case when sum(value_extax) <> 0
         then round(sum(margin) / sum(value_extax) * 100, 2) end as margin_pct
  from v_sales_supplier group by 1, 2, 3;

-- ---------------------------------------------------------------------
--   select * from v_sales_division where sale_date = '2026-09-04'
--     and branch_code = 'NILAMBUR' order by value_extax desc;
-- ---------------------------------------------------------------------
