-- =====================================================================
-- ATLAS PURCHASE  |  05_update.sql
-- Godown-first quantity model.
--   You buy 100 pieces  → 100 sits in the godown
--   Send 10 to PMNA     → godown 90
--   Send 10 to Kadakal  → godown 80
--   Whatever is left stays in the godown. That is normal, not an error.
-- Run once in Supabase → SQL Editor.
-- =====================================================================

-- Make sure everything from 04 actually exists (safe if it already does)
alter table purchase_orders add column if not exists purchase_type text;
alter table po_items       add column if not exists category_snapshot text;

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
-- 1. QUANTITY IS TYPED AGAIN, NOT DERIVED
--    Remove the trigger that overwrote it from the allocations.
-- ---------------------------------------------------------------------

drop trigger  if exists trg_sync_qty on po_item_allocations;
drop function if exists sync_item_qty();

-- ---------------------------------------------------------------------
-- 2. NEVER ALLOCATE MORE THAN WAS BOUGHT
-- ---------------------------------------------------------------------

create or replace function check_alloc_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_qty int; v_used int;
begin
  select qty into v_qty from po_items where id = new.po_item_id;

  select coalesce(sum(qty),0) into v_used
    from po_item_allocations
   where po_item_id = new.po_item_id
     and id is distinct from new.id;

  if v_used + new.qty > v_qty then
    raise exception 'Only % pieces left in godown for this item', greatest(v_qty - v_used, 0);
  end if;
  return new;
end; $$;

drop trigger if exists trg_alloc_total on po_item_allocations;
create trigger trg_alloc_total before insert or update on po_item_allocations
  for each row execute function check_alloc_total();

-- maximum 10 shops per item
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

-- ---------------------------------------------------------------------
-- 3. SUBMIT — allocation is now OPTIONAL. Unallocated stock is godown stock.
-- ---------------------------------------------------------------------

create or replace function submit_po(p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_chain text[]; v_slabs jsonb; s jsonb;
        v_entity uuid; v_name text; v_bad text;
begin
  select total_purchase, entity_id into v_total, v_entity
    from purchase_orders where id = p_po and status = 'draft' and created_by = auth.uid();
  if not found then raise exception 'Only your own draft can be submitted'; end if;
  if v_total <= 0 then raise exception 'Add at least one item before submitting'; end if;

  select string_agg(item_name, ', ') into v_bad
    from po_items where po_id = p_po and coalesce(qty,0) <= 0;
  if v_bad is not null then
    raise exception 'Enter a quantity for: %', v_bad;
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
-- 4. REPORT VIEW — includes what stayed in the godown
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

create or replace view v_godown_balance as
select
  pi.id as po_item_id, pi.po_id, p.po_no, p.entity_id, p.purchase_type,
  pi.item_code, pi.item_name, pi.qty as bought,
  coalesce((select sum(qty) from po_item_allocations a where a.po_item_id = pi.id), 0) as sent_to_shops,
  pi.qty - coalesce((select sum(qty) from po_item_allocations a where a.po_item_id = pi.id), 0) as in_godown,
  pi.purchase_rate, p.created_at, p.status
from po_items pi
join purchase_orders p on p.id = pi.po_id;

-- refresh the API cache so the app sees all of this immediately
notify pgrst, 'reload schema';
