-- =====================================================================
-- ATLAS PURCHASE  |  04_update.sql
-- Run this in Supabase → SQL Editor AFTER 01, 02 and 03.
-- Safe to run once. Adds:
--   1. Purchase type on the order (CC / Non CC / PMNA Fest / ...)
--   2. Shop-wise split of one item across up to 10 shops
--   3. Entity locking for staff
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PURCHASE TYPE
-- ---------------------------------------------------------------------

alter table purchase_orders add column if not exists purchase_type text;
create index if not exists idx_po_type on purchase_orders (purchase_type);

insert into settings (key, value) values
  ('purchase_types', '["CC","Non CC","PMNA Fest","Onam","Wedding","Regular","Replenishment"]'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. SHOP-WISE ALLOCATION
--    One item, 100 pieces → 10 to PMNA, 10 to Kadakal, 10 to Shop 05 ...
--    The line quantity is now the SUM of its allocations, never typed.
-- ---------------------------------------------------------------------

create table if not exists po_item_allocations (
  id         uuid primary key default gen_random_uuid(),
  po_item_id uuid not null references po_items(id) on delete cascade,
  po_id      uuid not null references purchase_orders(id) on delete cascade,
  shop_id    uuid not null references shops(id),
  qty        int  not null check (qty > 0),
  created_at timestamptz not null default now(),
  unique (po_item_id, shop_id)
);
create index if not exists idx_alloc_item on po_item_allocations (po_item_id);
create index if not exists idx_alloc_shop on po_item_allocations (shop_id);

-- maximum 10 shops per item line
create or replace function check_alloc_limit()
returns trigger language plpgsql as $$
begin
  if (select count(*) from po_item_allocations where po_item_id = new.po_item_id) > 10 then
    raise exception 'One item can be split across a maximum of 10 shops';
  end if;
  return new;
end; $$;

drop trigger if exists trg_alloc_limit on po_item_allocations;
create trigger trg_alloc_limit after insert on po_item_allocations
  for each row execute function check_alloc_limit();

-- line quantity always equals the sum of its shop allocations
create or replace function sync_item_qty()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_item uuid; v_sum int;
begin
  v_item := coalesce(new.po_item_id, old.po_item_id);
  select coalesce(sum(qty),0) into v_sum from po_item_allocations where po_item_id = v_item;
  if v_sum > 0 then update po_items set qty = v_sum where id = v_item; end if;
  return null;
end; $$;

drop trigger if exists trg_sync_qty on po_item_allocations;
create trigger trg_sync_qty after insert or update or delete on po_item_allocations
  for each row execute function sync_item_qty();

-- ---------------------------------------------------------------------
-- 3. SUBMIT RULE — every item must be allocated to at least one shop
-- ---------------------------------------------------------------------

create or replace function submit_po(p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_chain text[]; v_slabs jsonb; s jsonb;
        v_entity uuid; v_name text; v_missing text;
begin
  select total_purchase, entity_id into v_total, v_entity
    from purchase_orders where id = p_po and status = 'draft' and created_by = auth.uid();
  if not found then raise exception 'Only your own draft can be submitted'; end if;
  if v_total <= 0 then raise exception 'Add at least one item before submitting'; end if;

  select string_agg(pi.item_name, ', ') into v_missing
  from po_items pi
  where pi.po_id = p_po
    and not exists (select 1 from po_item_allocations a where a.po_item_id = pi.id);
  if v_missing is not null then
    raise exception 'Split these items across shops first: %', v_missing;
  end if;

  select value into v_slabs from settings where key = 'approval_slabs';
  for s in select * from jsonb_array_elements(v_slabs) loop
    if (s->>'upto') is null or v_total <= (s->>'upto')::numeric then
      select array_agg(x) into v_chain from jsonb_array_elements_text(s->'chain') x;
      exit;
    end if;
  end loop;

  select full_name into v_name from profiles where id = auth.uid();

  update purchase_orders set
    po_no          = coalesce(po_no, next_po_no(v_entity)),
    status         = 'pending',
    approval_chain = v_chain,
    pending_role   = v_chain[1],
    submitted_at   = now()
  where id = p_po;

  insert into po_history (po_id, action, from_status, to_status, actor_name)
  values (p_po, 'submitted', 'draft', 'pending', v_name);
end; $$;

-- ---------------------------------------------------------------------
-- 4. RLS for allocations (same rules as the item lines)
-- ---------------------------------------------------------------------

alter table po_item_allocations enable row level security;

drop policy if exists read_alloc on po_item_allocations;
create policy read_alloc on po_item_allocations for select to authenticated
  using (exists (select 1 from purchase_orders p where p.id = po_id
                 and (p.created_by = auth.uid() or can_see_entity(p.entity_id))));

drop policy if exists write_alloc on po_item_allocations;
create policy write_alloc on po_item_allocations for all to authenticated
  using (exists (select 1 from purchase_orders p where p.id = po_id and (
            (p.created_by = auth.uid() and p.status in ('draft','rejected'))
         or (my_role() in ('manager','hod','admin') and p.status = 'pending'))))
  with check (exists (select 1 from purchase_orders p where p.id = po_id and (
            (p.created_by = auth.uid() and p.status in ('draft','rejected'))
         or (my_role() in ('manager','hod','admin') and p.status = 'pending'))));

-- ---------------------------------------------------------------------
-- 5. REPORT VIEWS — shop-wise, type-wise
-- ---------------------------------------------------------------------

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
join po_items pi        on pi.id = a.po_item_id
join purchase_orders p  on p.id  = a.po_id
join shops sh           on sh.id = a.shop_id
join entities e         on e.id  = p.entity_id
join suppliers s        on s.id  = p.supplier_id;

-- category is handy on the line for reports; fill it from the item master
alter table po_items add column if not exists category_snapshot text;

create or replace function fill_category()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is not null and new.category_snapshot is null then
    select category into new.category_snapshot from items where id = new.item_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_fill_category on po_items;
create trigger trg_fill_category before insert or update on po_items
  for each row execute function fill_category();

update po_items pi set category_snapshot = i.category
  from items i where i.id = pi.item_id and pi.category_snapshot is null;

-- ---------------------------------------------------------------------
-- 6. ENTITY LOCK
--    Staff get exactly one entity in entity_ids → they can only see and
--    create orders in that entity. Admin/HOD keep entity_ids empty = all.
--    Example, after your users have signed up:
--
--    update profiles set entity_ids = array[(select id from entities where code='E1')]
--     where full_name = 'Purchase Executive Name';
--
--    update profiles set entity_ids = '{}'      -- all entities, mixed reports
--     where role in ('admin','hod');
-- ---------------------------------------------------------------------
