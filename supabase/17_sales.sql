-- =====================================================================
-- ATLAS  |  17_sales.sql
-- Sales module: analytics views and target maths.
--
-- Reads the tables created by 16_all_inventory.sql:
--   sales_daily, sales_salesman_daily, sales_item_daily, targets, branches
--
-- Run in Supabase after 16.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TODAY AND MONTH TO DATE, PER BRANCH
-- ---------------------------------------------------------------------

create or replace view v_sales_today as
select
  b.id as branch_id, b.code as branch_code, b.name as branch_name,
  b.entity_id,
  coalesce(t.bills, 0)        as bills,
  coalesce(t.qty, 0)          as qty,
  coalesce(t.net_sales, 0)    as net_sales,
  coalesce(t.cost, 0)         as cost,
  coalesce(t.net_sales - t.cost, 0) as margin,
  coalesce(t.basket_value, 0) as basket_value,
  coalesce(y.net_sales, 0)    as yesterday_sales,
  coalesce(lw.net_sales, 0)   as same_day_last_week
from branches b
left join sales_daily t  on t.branch_id = b.id and t.sale_date = current_date
left join sales_daily y  on y.branch_id = b.id and y.sale_date = current_date - 1
left join sales_daily lw on lw.branch_id = b.id and lw.sale_date = current_date - 7
where b.active;

create or replace view v_sales_mtd as
select
  b.id as branch_id, b.code as branch_code, b.name as branch_name,
  b.entity_id,
  count(distinct d.sale_date)         as trading_days,
  coalesce(sum(d.bills), 0)           as bills,
  coalesce(sum(d.qty), 0)             as qty,
  coalesce(sum(d.net_sales), 0)       as net_sales,
  coalesce(sum(d.cost), 0)            as cost,
  coalesce(sum(d.net_sales - d.cost), 0) as margin,
  case when sum(d.net_sales) > 0
    then round(sum(d.net_sales - d.cost) / sum(d.net_sales) * 100, 2) else 0 end as margin_pct,
  case when sum(d.bills) > 0
    then round(sum(d.net_sales) / sum(d.bills), 2) else 0 end as basket_value,
  case when sum(d.bills) > 0
    then round(sum(d.qty) / sum(d.bills), 2) else 0 end as items_per_bill
from branches b
left join sales_daily d
  on d.branch_id = b.id and d.sale_date >= date_trunc('month', current_date)
where b.active
group by b.id, b.code, b.name, b.entity_id;

-- ---------------------------------------------------------------------
-- 2. TARGET VS ACHIEVEMENT
--    Required daily sales assumes every remaining day of the month
--    is a trading day. Adjust the interval if you close weekly.
-- ---------------------------------------------------------------------

create or replace view v_target_progress as
with period as (
  select date_trunc('month', current_date)::date            as month_start,
         (date_trunc('month', current_date) + interval '1 month - 1 day')::date as month_end
),
tgt as (
  select t.branch_id, sum(t.amount) as target
    from targets t, period p
   where t.scope = 'branch'
     and t.superseded_by is null
     and t.period_start <= p.month_end
     and t.period_end   >= p.month_start
   group by t.branch_id
)
select
  m.branch_id, m.branch_code, m.branch_name, m.entity_id,
  coalesce(g.target, 0)     as target,
  m.net_sales               as achieved,
  m.bills, m.qty, m.basket_value, m.items_per_bill, m.margin, m.margin_pct,
  greatest(coalesce(g.target,0) - m.net_sales, 0) as balance,
  case when coalesce(g.target,0) > 0
    then round(m.net_sales / g.target * 100, 1) else null end as achievement_pct,
  (select month_end from period) - current_date + 1 as days_left,
  case when coalesce(g.target,0) > m.net_sales
        and ((select month_end from period) - current_date + 1) > 0
    then round((g.target - m.net_sales) /
               ((select month_end from period) - current_date + 1)) else 0 end as required_daily,
  case
    when coalesce(g.target,0) = 0 then 'no target'
    when m.net_sales >= g.target then 'achieved'
    when m.net_sales / g.target * 100 >= 85 then 'on track'
    when m.net_sales / g.target * 100 >= 70 then 'attention'
    else 'critical'
  end as status
from v_sales_mtd m
left join tgt g on g.branch_id = m.branch_id;

-- ---------------------------------------------------------------------
-- 3. SALESMAN PERFORMANCE, MONTH TO DATE
-- ---------------------------------------------------------------------

create or replace view v_salesman_mtd as
select
  s.branch_id, b.code as branch_code, b.name as branch_name,
  s.salesman_code,
  coalesce(max(s.salesman_name), s.salesman_code) as salesman_name,
  sum(s.bills)      as bills,
  sum(s.qty)        as qty,
  sum(s.net_sales)  as net_sales,
  sum(s.cost)       as cost,
  sum(s.net_sales - s.cost) as margin,
  case when sum(s.net_sales) > 0
    then round(sum(s.net_sales - s.cost) / sum(s.net_sales) * 100, 2) else 0 end as margin_pct,
  case when sum(s.bills) > 0
    then round(sum(s.net_sales) / sum(s.bills), 2) else 0 end as basket_value,
  case when sum(s.bills) > 0
    then round(sum(s.qty) / sum(s.bills), 2) else 0 end as items_per_bill,
  count(distinct s.sale_date) as days_worked
from sales_salesman_daily s
join branches b on b.id = s.branch_id
where s.sale_date >= date_trunc('month', current_date)
group by s.branch_id, b.code, b.name, s.salesman_code;

create or replace view v_salesman_ranked as
select
  v.*,
  coalesce(t.amount, 0) as target,
  case when coalesce(t.amount,0) > 0
    then round(v.net_sales / t.amount * 100, 1) else null end as achievement_pct,
  rank() over (order by v.net_sales desc)    as rank_by_sales,
  rank() over (order by v.basket_value desc) as rank_by_basket,
  rank() over (order by v.bills desc)        as rank_by_bills
from v_salesman_mtd v
left join (
  select salesman_code, sum(amount) as amount
    from targets
   where scope = 'salesman' and superseded_by is null
     and period_start <= current_date and period_end >= current_date
   group by salesman_code
) t on t.salesman_code = v.salesman_code;

-- ---------------------------------------------------------------------
-- 4. TREND — daily, last 60 days, whole group
-- ---------------------------------------------------------------------

create or replace view v_sales_trend as
select
  d.sale_date,
  sum(d.bills)     as bills,
  sum(d.qty)       as qty,
  sum(d.net_sales) as net_sales,
  sum(d.cost)      as cost,
  sum(d.net_sales - d.cost) as margin,
  case when sum(d.bills) > 0
    then round(sum(d.net_sales) / sum(d.bills), 2) else 0 end as basket_value
from sales_daily d
where d.sale_date >= current_date - 60
group by d.sale_date
order by d.sale_date;

-- ---------------------------------------------------------------------
-- 5. THIS MONTH AGAINST LAST MONTH AND LAST YEAR
-- ---------------------------------------------------------------------

create or replace view v_sales_comparison as
with p as (
  select
    date_trunc('month', current_date)::date as this_start,
    current_date                            as this_end,
    (date_trunc('month', current_date) - interval '1 month')::date as last_start,
    (date_trunc('month', current_date) - interval '1 month' +
     (current_date - date_trunc('month', current_date)))::date     as last_end,
    (date_trunc('month', current_date) - interval '1 year')::date  as ly_start,
    (date_trunc('month', current_date) - interval '1 year' +
     (current_date - date_trunc('month', current_date)))::date     as ly_end
)
select
  b.id as branch_id, b.code as branch_code, b.name as branch_name,
  coalesce(sum(d.net_sales) filter (where d.sale_date between p.this_start and p.this_end), 0) as this_month,
  coalesce(sum(d.net_sales) filter (where d.sale_date between p.last_start and p.last_end), 0) as last_month,
  coalesce(sum(d.net_sales) filter (where d.sale_date between p.ly_start   and p.ly_end),   0) as last_year,
  coalesce(sum(d.bills)     filter (where d.sale_date between p.this_start and p.this_end), 0) as bills_this,
  coalesce(sum(d.bills)     filter (where d.sale_date between p.last_start and p.last_end), 0) as bills_last
from branches b
cross join p
left join sales_daily d on d.branch_id = b.id
where b.active
group by b.id, b.code, b.name;

-- ---------------------------------------------------------------------
-- 6. WHAT IS SELLING — item and category, last 30 days
-- ---------------------------------------------------------------------

create or replace view v_sales_by_item as
select
  i.item_code,
  coalesce(max(i.item_name), i.item_code) as item_name,
  max(i.division) as division,
  max(i.brand)    as brand,
  sum(i.qty)       as qty,
  sum(i.net_sales) as net_sales,
  sum(i.cost)      as cost,
  sum(i.net_sales - i.cost) as margin,
  case when sum(i.net_sales) > 0
    then round(sum(i.net_sales - i.cost) / sum(i.net_sales) * 100, 2) else 0 end as margin_pct,
  count(distinct i.branch_id) as branches
from sales_item_daily i
where i.sale_date >= current_date - 30
group by i.item_code;

create or replace view v_sales_by_division as
select
  coalesce(nullif(trim(i.division), ''), 'Uncategorised') as division,
  sum(i.qty)       as qty,
  sum(i.net_sales) as net_sales,
  sum(i.cost)      as cost,
  sum(i.net_sales - i.cost) as margin,
  case when sum(i.net_sales) > 0
    then round(sum(i.net_sales - i.cost) / sum(i.net_sales) * 100, 2) else 0 end as margin_pct
from sales_item_daily i
where i.sale_date >= current_date - 30
group by 1;

notify pgrst, 'reload schema';

-- Verify: should return 9
-- select count(*) from information_schema.views
--  where table_name like 'v_sales%' or table_name like 'v_salesman%'
--     or table_name = 'v_target_progress';
