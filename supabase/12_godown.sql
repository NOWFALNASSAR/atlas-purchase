-- =====================================================================
-- ATLAS PURCHASE  |  12_godown.sql
--
-- Two things this adds:
--   1. Stock can be sent from the godown LATER — days or weeks after the
--      order, as many times as you like, until the balance is zero.
--   2. Some purchases go straight to a shop and never touch the godown.
--
-- Run once in Supabase → SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. WHERE DOES THIS ORDER LAND?
-- ---------------------------------------------------------------------

alter table purchase_orders add column if not exists receipt_mode text
  not null default 'godown' check (receipt_mode in ('godown','direct_shop'));

alter table purchase_orders add column if not exists direct_shop_id uuid references shops(id);

-- a direct purchase must name the shop it goes to
alter table purchase_orders drop constraint if exists chk_direct_shop;
alter table purchase_orders add constraint chk_direct_shop check (
  receipt_mode = 'godown' or direct_shop_id is not null
);

-- ---------------------------------------------------------------------
-- 2. EVERY DISPATCH IS DATED
--    An allocation row is now "stock sent to this shop on this date".
--    Several rows per item over time is normal.
-- ---------------------------------------------------------------------

alter table po_item_allocations add column if not exists dispatched_at timestamptz default now();
alter table po_item_allocations add column if not exists note text;
alter table po_item_allocations add column if not exists dispatched_by uuid references profiles(id);

-- the same shop can now receive the same item more than once, on
-- different dates, so the old one-row-per-shop rule has to go
alter table po_item_allocations drop constraint if exists po_item_allocations_po_item_id_shop_id_key;

create index if not exists idx_alloc_dispatched on po_item_allocations (dispatched_at desc);

-- ---------------------------------------------------------------------
-- 3. NEVER SEND MORE THAN WAS BOUGHT
-- ---------------------------------------------------------------------

create or replace function check_alloc_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_qty int; v_used int;
begin
  select qty into v_qty from po_items where id = new.po_item_id;
  select coalesce(sum(qty),0) into v_used from po_item_allocations
   where po_item_id = new.po_item_id and id is distinct from new.id;

  if v_used + new.qty > v_qty then
    raise exception 'Only % pieces left in godown for this item', greatest(v_qty - v_used, 0);
  end if;
  return new;
end; $$;

drop trigger if exists trg_alloc_total on po_item_allocations;
create trigger trg_alloc_total before insert or update on po_item_allocations
  for each row execute function check_alloc_total();

-- the 10-shop cap only ever made sense for one-time splitting; with
-- repeat dispatches over months it gets in the way
drop trigger if exists trg_alloc_limit on po_item_allocations;

-- ---------------------------------------------------------------------
-- 4. DIRECT-TO-SHOP PURCHASES ALLOCATE THEMSELVES
--    Nothing sits in a godown it never entered.
-- ---------------------------------------------------------------------

create or replace function auto_allocate_direct()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_mode text; v_shop uuid; v_existing uuid;
begin
  select receipt_mode, direct_shop_id into v_mode, v_shop
    from purchase_orders where id = new.po_id;

  if v_mode <> 'direct_shop' or v_shop is null then return new; end if;

  select id into v_existing from po_item_allocations
   where po_item_id = new.id and shop_id = v_shop limit 1;

  if v_existing is null then
    insert into po_item_allocations (po_id, po_item_id, shop_id, qty, note)
    values (new.po_id, new.id, v_shop, new.qty, 'Direct purchase to shop');
  else
    update po_item_allocations set qty = new.qty where id = v_existing;
  end if;

  return new;
end; $$;

drop trigger if exists trg_auto_direct on po_items;
create trigger trg_auto_direct after insert or update of qty on po_items
  for each row execute function auto_allocate_direct();

-- ---------------------------------------------------------------------
-- 5. DISPATCH HAPPENS AFTER APPROVAL
--    The old rule only allowed allocations while the order was a draft.
--    Sending stock out weeks later has to be possible.
-- ---------------------------------------------------------------------

drop policy if exists write_alloc on po_item_allocations;
create policy write_alloc on po_item_allocations for all to authenticated
  using (exists (select 1 from purchase_orders p where p.id = po_id and (
            (p.created_by = auth.uid() and p.status in ('draft','rejected'))
         or (my_role() in ('executive','manager','hod','admin')
             and p.status in ('pending','approved','sent','confirmed','partial'))
       ) and can_see_entity(p.entity_id)))
  with check (exists (select 1 from purchase_orders p where p.id = po_id and (
            (p.created_by = auth.uid() and p.status in ('draft','rejected'))
         or (my_role() in ('executive','manager','hod','admin')
             and p.status in ('pending','approved','sent','confirmed','partial'))
       ) and can_see_entity(p.entity_id)));

-- ---------------------------------------------------------------------
-- 6. WHAT IS STILL IN THE GODOWN, RIGHT NOW
-- ---------------------------------------------------------------------

create or replace view v_godown_stock as
select
  pi.id            as po_item_id,
  p.id             as po_id,
  p.po_no,
  p.entity_id,
  e.code           as entity_code,
  p.purchase_type,
  s.name           as supplier_name,
  pi.item_id, pi.item_code, pi.item_name, pi.category_snapshot,
  pi.colour, pi.size, pi.model_no,
  pi.purchase_rate, pi.selling_rate,
  pi.qty           as bought,
  coalesce(a.sent, 0) as sent,
  pi.qty - coalesce(a.sent, 0) as in_godown,
  (pi.qty - coalesce(a.sent, 0)) * pi.purchase_rate as value_in_godown,
  p.created_at,
  p.approved_at,
  extract(day from now() - coalesce(p.approved_at, p.created_at))::int as days_held,
  a.last_dispatch
from po_items pi
join purchase_orders p on p.id = pi.po_id
join entities e  on e.id = p.entity_id
join suppliers s on s.id = p.supplier_id
left join (
  select po_item_id, sum(qty) as sent, max(dispatched_at) as last_dispatch
    from po_item_allocations group by po_item_id
) a on a.po_item_id = pi.id
where p.receipt_mode = 'godown'
  and p.status in ('approved','sent','confirmed','partial','closed')
  and pi.qty - coalesce(a.sent, 0) > 0;

-- ---------------------------------------------------------------------
-- 7. WHAT EACH SHOP HAS RECEIVED
-- ---------------------------------------------------------------------

create or replace view v_shop_receipts as
select
  a.id, a.dispatched_at, a.note,
  sh.id as shop_id, sh.code as shop_code, sh.name as shop_name,
  p.id as po_id, p.po_no, p.purchase_type, p.receipt_mode,
  p.entity_id, e.code as entity_code,
  s.name as supplier_name,
  pi.item_code, pi.item_name, pi.category_snapshot,
  a.qty, pi.purchase_rate, pi.selling_rate, pi.margin_pct,
  (a.qty * pi.purchase_rate) as receipt_value
from po_item_allocations a
join po_items pi       on pi.id = a.po_item_id
join purchase_orders p on p.id  = a.po_id
join shops sh          on sh.id = a.shop_id
join entities e        on e.id  = p.entity_id
join suppliers s       on s.id  = p.supplier_id;

-- keep the reporting view in step
create or replace view v_shop_allocation as
select
  a.shop_id, sh.code as shop_code, sh.name as shop_name, sh.shop_type,
  p.id as po_id, p.po_no, p.status, p.purchase_type, p.entity_id,
  e.code as entity_code, e.name as entity_name,
  p.created_at, p.approved_at,
  s.id as supplier_id, s.name as supplier_name,
  pi.id as po_item_id, pi.item_id, pi.item_code, pi.item_name,
  pi.category_snapshot, a.qty,
  pi.purchase_rate, pi.selling_rate, pi.margin_pct,
  (a.qty * pi.purchase_rate) as alloc_purchase,
  (a.qty * pi.selling_rate)  as alloc_sales
from po_item_allocations a
join po_items pi       on pi.id = a.po_item_id
join purchase_orders p on p.id  = a.po_id
join shops sh          on sh.id = a.shop_id
join entities e        on e.id  = p.entity_id
join suppliers s       on s.id  = p.supplier_id;

notify pgrst, 'reload schema';

-- Verify:
--   select count(*) from v_godown_stock;
--   select column_name from information_schema.columns
--    where table_name='purchase_orders' and column_name in ('receipt_mode','direct_shop_id');
