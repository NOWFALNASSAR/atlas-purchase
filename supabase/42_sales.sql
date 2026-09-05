-- =====================================================================
-- ATLAS  |  42_sales.sql
--
-- Daily sales from the four exports: BILLWISE, ITEMWISE, SALESMANWISE
-- and the day summary.
--
-- Everything is keyed on (branch, date) so one branch's upload never
-- disturbs another's, and re-uploading a day replaces it rather than
-- doubling it. That matters more than it sounds: a file exported at
-- 4pm and again at closing must not add up to two days of trading.
--
-- Targets and incentives run on the value WITHOUT tax, which is the
-- figure all three files agree on.
--
-- Run after 41. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BILLS
-- ---------------------------------------------------------------------

create table if not exists sales_bills (
  id            uuid primary key default gen_random_uuid(),
  bill_date     date not null,
  bill_time     timestamptz,
  branch_code   text not null,
  branch_id     uuid references branches(id),
  bill_no       text not null,
  invoice_no    text,
  form          text,

  customer_raw  text,          -- 'raheena-9747805085' as exported
  customer_name text,
  customer_phone text,

  amount        numeric(14,2) not null default 0,   -- including tax
  taxable       numeric(14,2) not null default 0,   -- excluding tax
  tax_total     numeric(14,2) not null default 0,
  exempted      numeric(14,2) default 0,

  -- the slab split, kept because a GST return needs it
  amt3   numeric(14,2) default 0, vat3  numeric(14,2) default 0,
  amt5   numeric(14,2) default 0, vat5  numeric(14,2) default 0,
  amt12  numeric(14,2) default 0, vat12 numeric(14,2) default 0,
  amt18  numeric(14,2) default 0, vat18 numeric(14,2) default 0,
  amt28  numeric(14,2) default 0, vat28 numeric(14,2) default 0,
  amt40  numeric(14,2) default 0, vat40 numeric(14,2) default 0,

  cancelled     boolean not null default false,
  user_code     text,
  created_at    timestamptz not null default now(),

  unique (branch_code, bill_date, bill_no)
);

create index if not exists idx_bills_date   on sales_bills (bill_date desc, branch_code);
create index if not exists idx_bills_phone  on sales_bills (customer_phone)
  where customer_phone is not null;

-- ---------------------------------------------------------------------
-- 2. WHAT SOLD, BY BARCODE
-- ---------------------------------------------------------------------

create table if not exists sales_barcode_daily (
  id            uuid primary key default gen_random_uuid(),
  sale_date     date not null,
  branch_code   text not null,
  branch_id     uuid references branches(id),
  barcode       text not null,

  qty           numeric(14,3) not null default 0,
  value_extax   numeric(14,2) not null default 0,   -- SalesValue
  cost          numeric(14,2) not null default 0,   -- PurchValue
  margin        numeric(14,2) not null default 0,
  discount      numeric(14,2) not null default 0,

  -- resolved from the barcodes table when it is known, so division and
  -- supplier reporting works for whatever we have seen
  item_id       uuid references items(id),
  item_name     text,
  division_code int references divisions(code),
  supplier_code int,

  -- Wide, because a real row in the data sold for 1 paisa against a
  -- cost of 225, which is a margin of -2,249,900%. numeric(7,2) stops
  -- at 99,999.99 and the import fails on it. See v_sales_below_cost.
  margin_pct    numeric(12,2) generated always as
                  (case when value_extax <> 0
                    then round(margin / value_extax * 100, 2) end) stored,
  is_return     boolean generated always as (qty < 0) stored,

  unique (branch_code, sale_date, barcode)
);

create index if not exists idx_sbd_date on sales_barcode_daily (sale_date desc, branch_code);
create index if not exists idx_sbd_bc   on sales_barcode_daily (barcode);
create index if not exists idx_sbd_divi on sales_barcode_daily (division_code);
create index if not exists idx_sbd_sup  on sales_barcode_daily (supplier_code);

-- ---------------------------------------------------------------------
-- 3. WHO SOLD IT
-- ---------------------------------------------------------------------

create table if not exists sales_person_daily (
  id           uuid primary key default gen_random_uuid(),
  sale_date    date not null,
  branch_code  text not null,
  branch_id    uuid references branches(id),
  person_code  text not null,
  person_name  text,

  qty          numeric(14,3) not null default 0,
  value_extax  numeric(14,2) not null default 0,
  bills        int not null default 0,

  -- 'SM-1' carries the day's returns, not a person's selling
  is_returns_counter boolean not null default false,

  unique (branch_code, sale_date, person_code)
);

create index if not exists idx_spd_date on sales_person_daily (sale_date desc, branch_code);
create index if not exists idx_spd_code on sales_person_daily (person_code);

-- ---------------------------------------------------------------------
-- 4. THE UPLOAD ITSELF
--
-- Recorded so you can see which branch has sent which day, and whether
-- the three files agreed when they arrived.
-- ---------------------------------------------------------------------

create table if not exists sales_uploads (
  id              uuid primary key default gen_random_uuid(),
  sale_date       date not null,
  branch_code     text not null,
  bills           int,
  amount          numeric(14,2),
  taxable         numeric(14,2),
  tax_total       numeric(14,2),
  cost            numeric(14,2),
  margin          numeric(14,2),
  discount        numeric(14,2),
  qty             numeric(14,3),
  -- do the item file and the bill file agree on the ex-tax figure
  reconciled      boolean,
  variance        numeric(14,2),
  uploaded_by     uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (branch_code, sale_date)
);

-- ---------------------------------------------------------------------
-- 5. TARGETS AND INCENTIVE
--
-- On the value WITHOUT tax, as you asked. A slab table rather than one
-- percentage, so an incentive can step up once someone passes target.
-- ---------------------------------------------------------------------

create table if not exists sales_targets (
  id           uuid primary key default gen_random_uuid(),
  period       date not null,                 -- first of the month
  scope        text not null check (scope in ('branch','person')),
  branch_code  text,
  person_code  text,
  target_extax numeric(14,2) not null default 0,
  note         text,
  set_by       uuid references profiles(id) default auth.uid(),
  updated_at   timestamptz not null default now(),
  check ((scope = 'branch' and branch_code is not null and person_code is null)
      or (scope = 'person' and person_code is not null))
);

create unique index if not exists uq_sales_target_branch on sales_targets
  (period, branch_code) where scope = 'branch';
create unique index if not exists uq_sales_target_person on sales_targets
  (period, person_code, coalesce(branch_code, '')) where scope = 'person';

create table if not exists incentive_slabs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  from_pct     numeric(6,2) not null,      -- achievement % from
  to_pct       numeric(6,2),               -- null = and above
  pct_of_sales numeric(6,3) not null default 0,
  flat_amount  numeric(12,2) not null default 0,
  active       boolean not null default true,
  sort_order   int not null default 0
);

insert into incentive_slabs (name, from_pct, to_pct, pct_of_sales, flat_amount, sort_order)
values ('Below target',        0,   90,   0,     0, 1),
       ('Reached 90%',         90,  100,  0.25,  0, 2),
       ('Reached target',      100, 110,  0.50,  0, 3),
       ('Over 110%',           110, null, 0.75,  0, 4)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 6. THE REPORTS
-- ---------------------------------------------------------------------

-- the day, per branch
create or replace view v_sales_day as
select
  b.bill_date                                   as sale_date,
  b.branch_code,
  count(*) filter (where not b.cancelled)::int  as bills,
  sum(b.amount)    filter (where not b.cancelled) as amount_inc_tax,
  sum(b.taxable)   filter (where not b.cancelled) as sales_extax,
  sum(b.tax_total) filter (where not b.cancelled) as tax,
  round(sum(b.amount) filter (where not b.cancelled)
        / nullif(count(*) filter (where not b.cancelled), 0), 2) as basket_value,
  count(*) filter (where b.cancelled)::int      as cancelled_bills,
  count(distinct b.customer_phone)              as customers
from sales_bills b
group by 1, 2;

-- the day with cost and margin folded in from the item file
create or replace view v_sales_day_full as
select d.*,
       i.cost, i.margin, i.discount, i.qty as pieces,
       case when d.sales_extax <> 0
         then round(i.margin / d.sales_extax * 100, 2) end as margin_pct
  from v_sales_day d
  left join lateral (
    select sum(cost) as cost, sum(margin) as margin,
           sum(discount) as discount, sum(qty) as qty
      from sales_barcode_daily s
     where s.sale_date = d.sale_date and s.branch_code = d.branch_code
  ) i on true;

-- salesman performance, with target and incentive
create or replace view v_salesman_performance as
select
  p.sale_date, p.branch_code, p.person_code, p.person_name,
  p.qty, p.value_extax, p.bills,
  round(p.value_extax / nullif(p.bills, 0), 2) as value_per_bill,
  t.target_extax,
  case when t.target_extax > 0
    then round(p.value_extax / t.target_extax * 100, 1) end as achievement_pct,
  s.name as incentive_slab,
  round(coalesce(s.pct_of_sales, 0) * p.value_extax / 100
        + coalesce(s.flat_amount, 0), 2) as incentive
from sales_person_daily p
left join sales_targets t
  on t.scope = 'person' and t.person_code = p.person_code
 and t.period = date_trunc('month', p.sale_date)::date
left join incentive_slabs s
  on s.active
 and t.target_extax > 0
 and (p.value_extax / nullif(t.target_extax, 0) * 100) >= s.from_pct
 and (s.to_pct is null or (p.value_extax / nullif(t.target_extax, 0) * 100) < s.to_pct)
where not p.is_returns_counter;

-- month to date per salesman
create or replace view v_salesman_month as
select
  date_trunc('month', sale_date)::date as period,
  branch_code, person_code,
  max(person_name)      as person_name,
  sum(qty)              as qty,
  sum(value_extax)      as value_extax,
  sum(bills)            as bills,
  count(*)              as days_worked,
  round(sum(value_extax) / nullif(sum(bills), 0), 2) as value_per_bill
from sales_person_daily
where not is_returns_counter
group by 1, 2, 3;

-- what sold, by barcode
create or replace view v_sales_by_barcode as
select barcode, max(item_name) as item_name,
       min(sale_date) as first_sold, max(sale_date) as last_sold,
       sum(qty) as qty, sum(value_extax) as value_extax,
       sum(cost) as cost, sum(margin) as margin, sum(discount) as discount,
       case when sum(value_extax) <> 0
         then round(sum(margin) / sum(value_extax) * 100, 2) end as margin_pct
  from sales_barcode_daily group by 1;

-- Division and supplier, for the barcodes we can resolve.
--
-- Named v_sales_division, not v_sales_by_division: that name is already
-- taken by 17_sales.sql, which the existing Sales dashboard reads. Its
-- columns are different, so `create or replace` refuses — and replacing
-- it would break that screen anyway. Two sources, two views, no
-- collision.
create or replace view v_sales_division as
select coalesce(d.name, 'Unclassified') as division,
       s.division_code,
       sum(s.qty) as qty, sum(s.value_extax) as value_extax,
       sum(s.cost) as cost, sum(s.margin) as margin,
       case when sum(s.value_extax) <> 0
         then round(sum(s.margin) / sum(s.value_extax) * 100, 2) end as margin_pct
  from sales_barcode_daily s
  left join divisions d on d.code = s.division_code
 group by 1, 2;

create or replace view v_sales_supplier as
select coalesce(sup.name, 'Unclassified') as supplier,
       s.supplier_code,
       sum(s.qty) as qty, sum(s.value_extax) as value_extax,
       sum(s.cost) as cost, sum(s.margin) as margin,
       case when sum(s.value_extax) <> 0
         then round(sum(s.margin) / sum(s.value_extax) * 100, 2) end as margin_pct
  from sales_barcode_daily s
  left join suppliers sup on sup.billing_code = s.supplier_code
 group by 1, 2;

-- tax, ready for a return
create or replace view v_sales_tax as
select bill_date as sale_date, branch_code,
       sum(amt3) as taxable_3,  sum(vat3)  as tax_3,
       sum(amt5) as taxable_5,  sum(vat5)  as tax_5,
       sum(amt12) as taxable_12, sum(vat12) as tax_12,
       sum(amt18) as taxable_18, sum(vat18) as tax_18,
       sum(amt28) as taxable_28, sum(vat28) as tax_28,
       sum(exempted) as exempted,
       sum(taxable) as taxable_total, sum(tax_total) as tax_total
  from sales_bills where not cancelled
 group by 1, 2;

-- the customers hiding in the bill file
create or replace view v_customers as
select customer_phone,
       max(customer_name)   as name,
       count(*)::int        as visits,
       min(bill_date)       as first_seen,
       max(bill_date)       as last_seen,
       sum(amount)          as spent,
       round(avg(amount), 2) as avg_bill,
       (current_date - max(bill_date)) as days_since
  from sales_bills
 where customer_phone is not null and not cancelled
 group by 1;

-- Sold at or below what it cost. The first one found was a barcode
-- billed at 1 paisa against a 225 cost — almost certainly a keying
-- mistake at the till, and exactly the sort of thing nobody notices
-- until someone looks.
create or replace view v_sales_below_cost as
select sale_date, branch_code, barcode, item_name, qty,
       value_extax, cost, margin, margin_pct
  from sales_barcode_daily
 where qty > 0 and cost > 0 and value_extax <= cost
 order by margin;

-- returns
create or replace view v_sales_returns as
select sale_date, branch_code, barcode, item_name,
       qty, value_extax, cost, margin
  from sales_barcode_daily where qty < 0;

-- ---------------------------------------------------------------------
-- 7. SECURITY AND RIGHTS
-- ---------------------------------------------------------------------

alter table sales_bills          enable row level security;
alter table sales_barcode_daily  enable row level security;
alter table sales_person_daily   enable row level security;
alter table sales_uploads        enable row level security;
alter table sales_targets        enable row level security;
alter table incentive_slabs      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sales_bills','sales_barcode_daily','sales_person_daily',
                           'sales_uploads','sales_targets','incentive_slabs'] loop
    execute format('drop policy if exists read_%1$s on %1$I', t);
    execute format('create policy read_%1$s on %1$I for select to authenticated
                    using (has_perm(''sales.view'') or my_role() = ''admin'')', t);
    execute format('drop policy if exists write_%1$s on %1$I', t);
    execute format('create policy write_%1$s on %1$I for all to authenticated
                    using (has_perm(''sales.import'') or my_role() = ''admin'')
                    with check (has_perm(''sales.import'') or my_role() = ''admin'')', t);
  end loop;
end $$;

-- only MD Office sets a sales target, same rule as purchase targets
drop policy if exists write_sales_targets on sales_targets;
create policy write_sales_targets on sales_targets for all to authenticated
  using (am_md_office()) with check (am_md_office());

insert into permissions (code, module, label, hint, sort_order) values
  ('sales.reports', 'sales', 'Sales reports',
   'Daily sales, salesman performance, item, division and tax', 270),
  ('sales.targets', 'sales', 'Sales targets and incentive',
   'See targets and incentive. Only MD Office can change a target.', 280)
on conflict (code) do update
  set label = excluded.label, hint = excluded.hint, active = true;

insert into role_permissions (role, permission_code)
select r.code, p.code from roles r
 cross join (values ('sales.reports'), ('sales.targets')) p(code)
 where r.active and r.base_role in ('hod','manager')
   and exists (select 1 from role_permissions rp
                where rp.role = r.code and rp.permission_code = 'sales.view')
on conflict do nothing;

-- ---------------------------------------------------------------------
--   select * from v_sales_day_full order by sale_date desc;
--   select * from v_salesman_performance order by value_extax desc;
--   select * from v_sales_division order by value_extax desc;
--   select * from v_customers order by spent desc limit 20;
-- ---------------------------------------------------------------------
