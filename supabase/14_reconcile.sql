-- =====================================================================
-- ATLAS  |  14_reconcile.sql
--
-- The godown says it sent 50. The branch says it received 47.
-- Those two numbers sit on two different servers and have never been
-- compared. This is where they meet.
--
-- Run after 13_branches.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. LINK THE TWO SIDES
--    A receipt at a branch points back at the dispatch document from
--    the godown. Your billing tables already carry FROM_BRANCH and
--    FROM_ORDERNO, which is what the agent will map into these.
-- ---------------------------------------------------------------------

alter table stock_movements add column if not exists ref_doc_no     text;
alter table stock_movements add column if not exists ref_branch_code text;
alter table stock_movements add column if not exists received_at    date;

create index if not exists idx_mov_ref on stock_movements (ref_doc_no);
create index if not exists idx_mov_dir_date on stock_movements (direction, doc_date desc);

-- ---------------------------------------------------------------------
-- 2. LINE BY LINE: SENT vs RECEIVED
-- ---------------------------------------------------------------------

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

notify pgrst, 'reload schema';

-- Verify:
--   select table_name from information_schema.views
--    where table_name like 'v_transfer%' or table_name = 'v_in_transit';
--   (should return 6 rows)
