-- =====================================================================
-- ATLAS PURCHASE  |  01_schema.sql
-- Run this FIRST in Supabase → SQL Editor → New query → Run
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. ORGANISATION MASTERS
-- ---------------------------------------------------------------------

create table entities (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,          -- E1, E2, E3
  name        text not null,
  gstin       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table shops (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references entities(id),
  code        text unique not null,          -- S01 ... S24
  name        text not null,
  shop_type   text not null default 'budget' check (shop_type in ('premium','budget')),
  location    text,
  manager     text,
  phone       text,
  address     text,
  gstin       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index on shops (entity_id);

-- ---------------------------------------------------------------------
-- 2. USERS
-- Supabase creates auth.users. This table holds role + access.
-- ---------------------------------------------------------------------

create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null default '',
  emp_code        text,
  phone           text,
  role            text not null default 'executive'
                  check (role in ('executive','manager','hod','accounts','admin')),
  entity_ids      uuid[] not null default '{}',   -- empty = all entities
  approval_limit  numeric(14,2) not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- auto-create a profile row whenever someone signs up
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- helper functions used by RLS
create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function my_entities() returns uuid[]
language sql stable security definer set search_path = public as $$
  select entity_ids from profiles where id = auth.uid()
$$;

create or replace function can_see_entity(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(array_length(my_entities(),1),0) = 0 or e = any(my_entities())
$$;

-- ---------------------------------------------------------------------
-- 3. SUPPLIER MASTER
-- ---------------------------------------------------------------------

create table suppliers (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,
  name           text not null,
  company_name   text,
  gstin          text,
  contact_person text,
  mobile         text,
  whatsapp       text,
  email          text,
  address        text,
  state          text default 'Kerala',
  payment_terms  text,
  credit_days    int default 0,
  category       text,
  rating         int default 0 check (rating between 0 and 5),
  bank_details   text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index on suppliers (lower(name));

-- ---------------------------------------------------------------------
-- 4. ITEM MASTER
-- ---------------------------------------------------------------------

create table items (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,        -- LAD-KUR-00125
  name           text not null,
  category       text,
  sub_category   text,
  model_no       text,
  fabric         text,
  brand          text,
  std_selling    numeric(12,2),               -- standard selling rate
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index on items (lower(name));
create index on items (category, sub_category);

-- ---------------------------------------------------------------------
-- 5. SETTINGS  (approval slabs, PO prefix — editable by admin, not hard-coded)
-- ---------------------------------------------------------------------

create table settings (
  key    text primary key,
  value  jsonb not null
);

insert into settings (key, value) values
 ('approval_slabs', '[
    {"upto": 50000,   "chain": ["manager"]},
    {"upto": 200000,  "chain": ["manager","hod"]},
    {"upto": 500000,  "chain": ["manager","hod","admin"]},
    {"upto": null,    "chain": ["manager","hod","admin"]}
  ]'::jsonb),
 ('po_prefix', '"ATL"'::jsonb),
 ('company',  '{"name":"Atlas Maharani Group","address":"Kerala","phone":"","email":""}'::jsonb);

-- ---------------------------------------------------------------------
-- 6. PURCHASE ORDER
-- ---------------------------------------------------------------------

create table purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  po_no          text unique,                 -- generated on submit, never typed
  entity_id      uuid not null references entities(id),
  supplier_id    uuid not null references suppliers(id),
  status         text not null default 'draft'
                 check (status in ('draft','pending','approved','rejected',
                                   'sent','confirmed','partial','closed','cancelled')),
  pending_role   text,                         -- who must act now
  approval_chain text[] not null default '{}',
  expected_date  date,
  remarks        text,
  total_qty      int  not null default 0,
  total_purchase numeric(14,2) not null default 0,
  total_sales    numeric(14,2) not null default 0,
  created_by     uuid not null references profiles(id) default auth.uid(),
  submitted_at   timestamptz,
  approved_at    timestamptz,
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on purchase_orders (entity_id, status);
create index on purchase_orders (supplier_id);
create index on purchase_orders (created_by);

create table po_items (
  id             uuid primary key default gen_random_uuid(),
  po_id          uuid not null references purchase_orders(id) on delete cascade,
  item_id        uuid references items(id),
  item_name      text not null,               -- snapshot, so reports survive master edits
  item_code      text,
  model_no       text,
  colour         text,
  size           text,
  shop_id        uuid references shops(id),   -- shop is per LINE, not per PO
  qty            int not null default 0,
  purchase_rate  numeric(12,2) not null default 0,
  selling_rate   numeric(12,2) not null default 0,
  remarks        text,
  line_purchase  numeric(14,2) generated always as (qty * purchase_rate) stored,
  line_sales     numeric(14,2) generated always as (qty * selling_rate) stored,
  margin_pct     numeric(6,2)  generated always as (
                   case when selling_rate > 0
                        then round(((selling_rate - purchase_rate) / selling_rate) * 100, 2)
                        else 0 end) stored,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create index on po_items (po_id);
create index on po_items (item_id);

create table po_item_photos (
  id          uuid primary key default gen_random_uuid(),
  po_item_id  uuid not null references po_items(id) on delete cascade,
  po_id       uuid not null references purchase_orders(id) on delete cascade,
  path        text not null,                  -- storage path, NOT the image itself
  label       text,                           -- front / back / label / packaging
  created_at  timestamptz not null default now()
);
create index on po_item_photos (po_item_id);

create table po_history (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references purchase_orders(id) on delete cascade,
  action      text not null,                  -- submitted / approved / rejected / rate_changed ...
  from_status text,
  to_status   text,
  note        text,
  actor_id    uuid references profiles(id) default auth.uid(),
  actor_name  text,
  created_at  timestamptz not null default now()
);
create index on po_history (po_id, created_at desc);

create table po_confirmations (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references purchase_orders(id) on delete cascade,
  po_item_id    uuid references po_items(id) on delete cascade,
  qty_confirmed int not null default 0,
  note          text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. TOTALS — recalculated automatically, never entered by hand
-- ---------------------------------------------------------------------

create or replace function recalc_po_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_po uuid;
begin
  v_po := coalesce(new.po_id, old.po_id);
  update purchase_orders p set
    total_qty      = coalesce((select sum(qty)            from po_items where po_id = v_po),0),
    total_purchase = coalesce((select sum(line_purchase)  from po_items where po_id = v_po),0),
    total_sales    = coalesce((select sum(line_sales)     from po_items where po_id = v_po),0),
    updated_at     = now()
  where p.id = v_po;
  return null;
end; $$;

create trigger trg_recalc_totals
  after insert or update or delete on po_items
  for each row execute function recalc_po_totals();

-- ---------------------------------------------------------------------
-- 8. AUDIT — record every rate / qty / supplier change on a live PO
-- ---------------------------------------------------------------------

create or replace function log_item_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select full_name into v_name from profiles where id = auth.uid();

  if new.purchase_rate is distinct from old.purchase_rate then
    insert into po_history (po_id, action, note, actor_name)
    values (new.po_id, 'rate_changed',
            new.item_name || ': purchase rate ' || old.purchase_rate || ' → ' || new.purchase_rate, v_name);
  end if;

  if new.qty is distinct from old.qty then
    insert into po_history (po_id, action, note, actor_name)
    values (new.po_id, 'qty_changed',
            new.item_name || ': qty ' || old.qty || ' → ' || new.qty, v_name);
  end if;

  return new;
end; $$;

create trigger trg_log_item_change
  after update on po_items
  for each row execute function log_item_change();

-- ---------------------------------------------------------------------
-- 9. PO NUMBER  — ATL/E1/PO/26-27/00125
-- ---------------------------------------------------------------------

create table po_counters (
  entity_code text not null,
  fy          text not null,
  last_no     int  not null default 0,
  primary key (entity_code, fy)
);

create or replace function next_po_no(p_entity uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text; v_fy text; v_no int; v_prefix text; y int; m int;
begin
  select code into v_code from entities where id = p_entity;
  select (value #>> '{}') into v_prefix from settings where key = 'po_prefix';

  y := extract(year from now()); m := extract(month from now());
  if m >= 4 then v_fy := to_char(y,'FM0000') || '-' || to_char(y+1,'FM0000');
  else            v_fy := to_char(y-1,'FM0000') || '-' || to_char(y,'FM0000'); end if;
  v_fy := right(split_part(v_fy,'-',1),2) || '-' || right(split_part(v_fy,'-',2),2);

  insert into po_counters (entity_code, fy, last_no) values (v_code, v_fy, 1)
  on conflict (entity_code, fy) do update set last_no = po_counters.last_no + 1
  returning last_no into v_no;

  return coalesce(v_prefix,'ATL') || '/' || v_code || '/PO/' || v_fy || '/' || lpad(v_no::text, 5, '0');
end; $$;

-- ---------------------------------------------------------------------
-- 10. SUBMIT / APPROVE / REJECT  — all workflow lives in the database,
--     so nobody can skip a step by calling the API directly.
-- ---------------------------------------------------------------------

create or replace function submit_po(p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_chain text[]; v_slabs jsonb; s jsonb; v_entity uuid; v_name text;
begin
  select total_purchase, entity_id into v_total, v_entity
    from purchase_orders where id = p_po and status = 'draft' and created_by = auth.uid();
  if not found then raise exception 'Only your own draft can be submitted'; end if;
  if v_total <= 0 then raise exception 'Add at least one item before submitting'; end if;

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

create or replace function approve_po(p_po uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_pending text; v_chain text[]; v_idx int; v_next text;
  v_name text; v_limit numeric; v_total numeric;
begin
  select role, full_name, approval_limit into v_role, v_name, v_limit
    from profiles where id = auth.uid();
  select pending_role, approval_chain, total_purchase into v_pending, v_chain, v_total
    from purchase_orders where id = p_po and status = 'pending';
  if not found then raise exception 'This order is not waiting for approval'; end if;

  -- admin may act at any stage; others must be the exact pending role
  if v_role <> 'admin' and v_role is distinct from v_pending then
    raise exception 'This order is waiting for the % to act', v_pending;
  end if;
  if v_limit > 0 and v_total > v_limit and v_role <> 'admin' then
    raise exception 'Amount is above your approval limit';
  end if;

  v_idx  := array_position(v_chain, v_pending);
  v_next := v_chain[v_idx + 1];
  -- if an admin jumps in early, finish the chain
  if v_role = 'admin' then v_next := null; end if;

  if v_next is null then
    update purchase_orders set status = 'approved', pending_role = null, approved_at = now()
      where id = p_po;
    insert into po_history (po_id, action, from_status, to_status, note, actor_name)
      values (p_po, 'approved', 'pending', 'approved', p_note, v_name);
  else
    update purchase_orders set pending_role = v_next where id = p_po;
    insert into po_history (po_id, action, from_status, to_status, note, actor_name)
      values (p_po, v_pending || '_approved', 'pending', 'pending', p_note, v_name);
  end if;
end; $$;

create or replace function reject_po(p_po uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_pending text; v_name text;
begin
  select role, full_name into v_role, v_name from profiles where id = auth.uid();
  select pending_role into v_pending from purchase_orders where id = p_po and status = 'pending';
  if not found then raise exception 'This order is not waiting for approval'; end if;
  if v_role <> 'admin' and v_role is distinct from v_pending then
    raise exception 'This order is waiting for the % to act', v_pending;
  end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'Give a reason for rejecting'; end if;

  update purchase_orders set status = 'rejected', pending_role = null where id = p_po;
  insert into po_history (po_id, action, from_status, to_status, note, actor_name)
  values (p_po, 'rejected', 'pending', 'rejected', p_note, v_name);
end; $$;

create or replace function reopen_po(p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select full_name into v_name from profiles where id = auth.uid();
  update purchase_orders set status = 'draft', pending_role = null
   where id = p_po and status = 'rejected' and created_by = auth.uid();
  if not found then raise exception 'Only your own rejected order can be reopened'; end if;
  insert into po_history (po_id, action, from_status, to_status, actor_name)
  values (p_po, 'reopened', 'rejected', 'draft', v_name);
end; $$;

create or replace function mark_sent(p_po uuid, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select full_name into v_name from profiles where id = auth.uid();
  update purchase_orders set status = 'sent', sent_at = now()
   where id = p_po and status in ('approved','sent');
  insert into po_history (po_id, action, note, actor_name)
  values (p_po, 'sent_supplier', p_channel, v_name);
end; $$;

-- ---------------------------------------------------------------------
-- 11. INTELLIGENCE — rate history + supplier comparison
-- ---------------------------------------------------------------------

create or replace view v_item_rate_history as
select
  pi.item_id, pi.item_code, pi.item_name, pi.model_no,
  p.id as po_id, p.po_no, p.approved_at, p.created_at,
  s.id as supplier_id, s.name as supplier_name,
  pi.qty, pi.purchase_rate, pi.selling_rate, pi.margin_pct, p.entity_id
from po_items pi
join purchase_orders p on p.id = pi.po_id
join suppliers s on s.id = p.supplier_id
where p.status in ('approved','sent','confirmed','partial','closed');

create or replace view v_supplier_item_best as
select item_id, supplier_id, supplier_name,
       min(purchase_rate) as best_rate,
       round(avg(purchase_rate),2) as avg_rate,
       max(created_at) as last_purchase,
       sum(qty) as total_qty
from v_item_rate_history
group by item_id, supplier_id, supplier_name;

create or replace view v_supplier_summary as
select s.id as supplier_id, s.name, s.category,
       count(distinct p.id) as po_count,
       coalesce(sum(p.total_purchase),0) as total_value,
       max(p.created_at) as last_po
from suppliers s
left join purchase_orders p
  on p.supplier_id = s.id and p.status in ('approved','sent','confirmed','partial','closed')
group by s.id, s.name, s.category;
