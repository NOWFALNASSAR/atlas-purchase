-- =====================================================================
-- ATLAS PURCHASE  |  09_insights.sql
-- Small, named views that answer business questions.
-- These are what the AI reads — never the raw tables. Each returns a
-- handful of rows, so the numbers in an AI answer and the numbers on
-- your dashboard always come from the same place.
-- Run once in Supabase → SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THIS MONTH, IN ONE ROW PER ENTITY
-- ---------------------------------------------------------------------

create or replace view v_ai_month_summary as
select
  e.name as entity,
  p.purchase_type,
  count(distinct p.id)                as orders,
  count(distinct p.supplier_id)       as suppliers,
  sum(p.total_qty)                    as pieces,
  sum(p.total_purchase)               as purchase_value,
  sum(p.total_tax)                    as tax,
  sum(p.total_sales)                  as expected_sales,
  round(case when sum(p.total_sales) > 0
    then (sum(p.total_sales) - sum(p.total_purchase)) / sum(p.total_sales) * 100
    else 0 end, 1)                    as margin_pct
from purchase_orders p
join entities e on e.id = p.entity_id
where p.status in ('approved','sent','confirmed','partial','closed')
  and p.created_at >= date_trunc('month', now())
group by e.name, p.purchase_type;

-- ---------------------------------------------------------------------
-- 2. RATE WENT UP — the same item costing more than last time
-- ---------------------------------------------------------------------

create or replace view v_ai_rate_alerts as
with ranked as (
  select item_id, item_name, supplier_name, purchase_rate, qty, created_at,
         row_number() over (partition by item_id order by created_at desc) as rn
  from v_item_rate_history
)
select
  c.item_name,
  c.supplier_name              as now_supplier,
  c.purchase_rate              as now_rate,
  p.supplier_name              as before_supplier,
  p.purchase_rate              as before_rate,
  round((c.purchase_rate - p.purchase_rate) / nullif(p.purchase_rate,0) * 100, 1) as increase_pct,
  round((c.purchase_rate - p.purchase_rate) * c.qty) as extra_cost,
  c.created_at
from ranked c
join ranked p on p.item_id = c.item_id and p.rn = 2
where c.rn = 1
  and c.purchase_rate > p.purchase_rate * 1.05
order by extra_cost desc nulls last;

-- ---------------------------------------------------------------------
-- 3. THIN MARGIN — bought at a price that leaves little room
-- ---------------------------------------------------------------------

create or replace view v_ai_margin_alerts as
select
  p.po_no, s.name as supplier, pi.item_name,
  pi.purchase_rate, pi.selling_rate, pi.margin_pct,
  pi.qty, pi.line_purchase, p.created_at
from po_items pi
join purchase_orders p on p.id = pi.po_id
join suppliers s on s.id = p.supplier_id
where p.status in ('approved','sent','confirmed','partial','closed')
  and pi.selling_rate > 0
  and pi.margin_pct < 25
  and p.created_at >= now() - interval '90 days'
order by pi.line_purchase desc;

-- ---------------------------------------------------------------------
-- 4. SITTING IN THE GODOWN — bought but never sent to a shop
-- ---------------------------------------------------------------------

create or replace view v_ai_godown_alerts as
select
  g.item_name, g.po_no, g.in_godown, g.purchase_rate,
  round(g.in_godown * g.purchase_rate) as value_stuck,
  g.created_at,
  extract(day from now() - g.created_at)::int as days_old
from v_godown_balance g
where g.in_godown > 0
  and g.status in ('approved','sent','confirmed','partial','closed')
  and g.created_at < now() - interval '14 days'
order by value_stuck desc;

-- ---------------------------------------------------------------------
-- 5. STUCK IN APPROVAL — waiting too long for someone to act
-- ---------------------------------------------------------------------

create or replace view v_ai_pending_alerts as
select
  p.po_no, s.name as supplier, e.code as entity,
  p.pending_role, p.total_purchase, p.submitted_at,
  extract(day from now() - p.submitted_at)::int as days_waiting
from purchase_orders p
join suppliers s on s.id = p.supplier_id
join entities e on e.id = p.entity_id
where p.status = 'pending'
order by p.submitted_at;

-- ---------------------------------------------------------------------
-- 6. SUPPLIER CONCENTRATION — how much rides on each supplier
-- ---------------------------------------------------------------------

create or replace view v_ai_supplier_share as
select
  s.name as supplier,
  count(distinct p.id) as orders,
  sum(p.total_purchase) as value,
  round(sum(p.total_purchase) * 100.0 /
        nullif(sum(sum(p.total_purchase)) over (), 0), 1) as share_pct,
  max(p.created_at) as last_order
from purchase_orders p
join suppliers s on s.id = p.supplier_id
where p.status in ('approved','sent','confirmed','partial','closed')
  and p.created_at >= now() - interval '90 days'
group by s.name
order by value desc;

notify pgrst, 'reload schema';
