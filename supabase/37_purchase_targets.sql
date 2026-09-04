-- =====================================================================
-- ATLAS  |  37_purchase_targets.sql
--
-- Phase 5 — purchasers, purchase types and targets.  §30–§34
--
-- Built on what is already there. purchase_orders.purchase_type has
-- been a free text column since migration 04, with the list of values
-- in settings. Replacing it would mean migrating live orders for no
-- gain, so the column stays exactly as it is and a proper table is
-- added alongside, keyed by the same text.
--
-- §33 is the part that matters: only MD Office may touch a target, and
-- every change keeps its history. A target that can be quietly lowered
-- at month end is not a target.
--
-- Run after 36. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PURCHASE TYPES  (§31)
-- ---------------------------------------------------------------------

create table if not exists purchase_types (
  code       text primary key,
  label      text not null,
  active     boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

-- the three the specification names
insert into purchase_types (code, label, sort_order) values
  ('CC',         'CC',          1),
  ('Non CC',     'Non-CC',      2),
  ('CC Bedsheet','CC Bedsheet', 3)
on conflict (code) do update set label = excluded.label, active = true;

-- plus whatever is already in use, so nothing in the existing orders
-- becomes an orphan
insert into purchase_types (code, label, sort_order)
select distinct p.purchase_type, p.purchase_type, 50
  from purchase_orders p
 where nullif(trim(p.purchase_type), '') is not null
on conflict (code) do nothing;

-- and anything the settings list mentioned
insert into purchase_types (code, label, sort_order)
select distinct v.value #>> '{}', v.value #>> '{}', 60
  from settings s, jsonb_array_elements(s.value) v
 where s.key = 'purchase_types' and jsonb_typeof(s.value) = 'array'
on conflict (code) do nothing;

alter table purchase_types enable row level security;

drop policy if exists read_purchase_types on purchase_types;
create policy read_purchase_types on purchase_types for select to authenticated using (true);

drop policy if exists write_purchase_types on purchase_types;
create policy write_purchase_types on purchase_types for all to authenticated
  using (am_md_office() or my_role() = 'admin')
  with check (am_md_office() or my_role() = 'admin');

-- ---------------------------------------------------------------------
-- 2. PURCHASERS  (§30)
--
-- Linked to a login where there is one, but not requiring it — a
-- purchaser who never signs in still needs a target and a figure.
-- ---------------------------------------------------------------------

create table if not exists purchasers (
  id         uuid primary key default gen_random_uuid(),
  code       text unique,
  name       text not null,
  profile_id uuid references profiles(id),
  entity_id  uuid references entities(id),
  phone      text,
  active     boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_purchaser_profile
  on purchasers (profile_id) where profile_id is not null;

alter table purchase_orders add column if not exists purchaser_id uuid references purchasers(id);
create index if not exists idx_po_purchaser on purchase_orders (purchaser_id);

alter table purchasers enable row level security;

drop policy if exists read_purchasers on purchasers;
create policy read_purchasers on purchasers for select to authenticated using (true);

drop policy if exists write_purchasers on purchasers;
create policy write_purchasers on purchasers for all to authenticated
  using (am_md_office() or my_role() = 'admin')
  with check (am_md_office() or my_role() = 'admin');

-- Anyone who has actually raised an order becomes a purchaser, so the
-- figures are populated from day one rather than starting empty.
insert into purchasers (name, profile_id, sort_order)
select p.full_name, p.id, 10
  from profiles p
 where exists (select 1 from purchase_orders o where o.created_by = p.id)
   and not exists (select 1 from purchasers x where x.profile_id = p.id)
on conflict do nothing;

update purchase_orders o
   set purchaser_id = pu.id
  from purchasers pu
 where pu.profile_id = o.created_by
   and o.purchaser_id is null;

-- keep it filled in automatically from here on
create or replace function set_po_purchaser()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.purchaser_id is null then
    select id into new.purchaser_id from purchasers
     where profile_id = new.created_by and active limit 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_po_purchaser on purchase_orders;
create trigger trg_po_purchaser before insert on purchase_orders
  for each row execute function set_po_purchaser();

-- ---------------------------------------------------------------------
-- 3. TARGETS  (§32)
--
-- One row per month per thing being targeted. Scope says whether the
-- target belongs to a purchase type or to a purchaser.
-- ---------------------------------------------------------------------

create table if not exists purchase_targets (
  id         uuid primary key default gen_random_uuid(),
  period     date not null,                  -- always the 1st of the month
  scope      text not null check (scope in ('type','purchaser')),
  type_code  text references purchase_types(code),
  purchaser_id uuid references purchasers(id),
  entity_id  uuid references entities(id),
  amount     numeric(14,2) not null check (amount >= 0),
  note       text,
  set_by     uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  check ((scope = 'type'      and type_code is not null and purchaser_id is null)
      or (scope = 'purchaser' and purchaser_id is not null and type_code is null))
);

create unique index if not exists uq_target_type on purchase_targets
  (period, type_code, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where scope = 'type';

create unique index if not exists uq_target_purchaser on purchase_targets
  (period, purchaser_id, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where scope = 'purchaser';

-- ---------- the audit trail (§33) ----------

create table if not exists purchase_target_history (
  id         uuid primary key default gen_random_uuid(),
  target_id  uuid references purchase_targets(id) on delete cascade,
  period     date not null,
  scope      text not null,
  subject    text not null,          -- what was targeted, in words
  old_amount numeric(14,2),
  new_amount numeric(14,2) not null,
  direction  text not null check (direction in ('created','increased','reduced','unchanged')),
  reason     text not null,
  changed_by uuid references profiles(id) default auth.uid(),
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_target_history on purchase_target_history (period desc, created_at desc);

alter table purchase_targets        enable row level security;
alter table purchase_target_history enable row level security;

drop policy if exists read_targets on purchase_targets;
create policy read_targets on purchase_targets for select to authenticated using (true);

-- §33: only MD Office. Not admin, not a manager, not anyone with a
-- convincing argument at month end.
drop policy if exists write_targets on purchase_targets;
create policy write_targets on purchase_targets for all to authenticated
  using (am_md_office()) with check (am_md_office());

drop policy if exists read_target_history on purchase_target_history;
create policy read_target_history on purchase_target_history
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 4. SETTING A TARGET
--
-- The only way in. A reason is required, and the history is written in
-- the same statement, so a target cannot move without a record of who
-- moved it and why.
-- ---------------------------------------------------------------------

create or replace function set_purchase_target(
  p_period    date,
  p_scope     text,
  p_type      text default null,
  p_purchaser uuid default null,
  p_entity    uuid default null,
  p_amount    numeric default 0,
  p_reason    text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_period)::date;
  v_old numeric; v_id uuid; v_subject text; v_name text; v_dir text;
begin
  if not am_md_office() then
    raise exception 'Only MD Office can set a purchase target';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why this target is being set or changed';
  end if;
  if p_amount < 0 then
    raise exception 'A target cannot be negative';
  end if;

  if p_scope = 'type' then
    if p_type is null then raise exception 'Which purchase type?'; end if;
    select label into v_subject from purchase_types where code = p_type;
    v_subject := coalesce(v_subject, p_type);

    select id, amount into v_id, v_old from purchase_targets
     where scope = 'type' and period = v_month and type_code = p_type
       and coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(p_entity, '00000000-0000-0000-0000-000000000000'::uuid);

  elsif p_scope = 'purchaser' then
    if p_purchaser is null then raise exception 'Which purchaser?'; end if;
    select name into v_subject from purchasers where id = p_purchaser;
    v_subject := coalesce(v_subject, 'purchaser');

    select id, amount into v_id, v_old from purchase_targets
     where scope = 'purchaser' and period = v_month and purchaser_id = p_purchaser
       and coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(p_entity, '00000000-0000-0000-0000-000000000000'::uuid);
  else
    raise exception 'Scope must be type or purchaser';
  end if;

  if v_id is null then
    insert into purchase_targets (period, scope, type_code, purchaser_id, entity_id, amount, note)
    values (v_month, p_scope, p_type, p_purchaser, p_entity, p_amount, p_reason)
    returning id into v_id;
  else
    update purchase_targets
       set amount = p_amount, note = p_reason, set_by = auth.uid(), updated_at = now()
     where id = v_id;
  end if;

  v_dir := case
    when v_old is null        then 'created'
    when p_amount > v_old     then 'increased'
    when p_amount < v_old     then 'reduced'
    else                           'unchanged'
  end;

  select full_name into v_name from profiles where id = auth.uid();

  insert into purchase_target_history
    (target_id, period, scope, subject, old_amount, new_amount, direction, reason, actor_name)
  values (v_id, v_month, p_scope, v_subject, v_old, p_amount, v_dir, p_reason, v_name);

  return v_id;
end $$;

grant execute on function set_purchase_target(date, text, text, uuid, uuid, numeric, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 5. TARGET AGAINST ACHIEVEMENT  (§34)
--
-- Achievement counts orders that are actually committed — approved and
-- onwards. A draft is an intention, not a purchase.
-- ---------------------------------------------------------------------

create or replace view v_purchase_by_type as
select
  date_trunc('month', p.created_at)::date        as period,
  coalesce(nullif(trim(p.purchase_type), ''), 'Unclassified') as type_code,
  p.entity_id,
  count(*)::int                                   as orders,
  coalesce(sum(p.total_purchase), 0)              as value
from purchase_orders p
where p.status in ('approved','sent','confirmed','partial','closed')
group by 1, 2, 3;

create or replace view v_purchase_by_purchaser as
select
  date_trunc('month', p.created_at)::date as period,
  p.purchaser_id,
  p.entity_id,
  count(*)::int                            as orders,
  coalesce(sum(p.total_purchase), 0)       as value,
  coalesce(sum(p.total_purchase) filter (
    where nullif(trim(p.purchase_type),'') = 'CC'), 0)     as cc_value,
  coalesce(sum(p.total_purchase) filter (
    where nullif(trim(p.purchase_type),'') = 'Non CC'), 0) as noncc_value
from purchase_orders p
where p.status in ('approved','sent','confirmed','partial','closed')
  and p.purchaser_id is not null
group by 1, 2, 3;

create or replace function purchase_achievement(p_period date, p_entity uuid default null)
returns table (
  scope       text,
  ref         text,
  name        text,
  target      numeric,
  achieved    numeric,
  balance     numeric,
  pct         numeric,
  orders      int
)
language sql stable security definer set search_path = public as $$
with month as (select date_trunc('month', p_period)::date as m)

select 'type', t.code, t.label,
       coalesce(tg.amount, 0),
       coalesce(a.value, 0),
       greatest(coalesce(tg.amount, 0) - coalesce(a.value, 0), 0),
       case when coalesce(tg.amount, 0) > 0
         then round(100 * coalesce(a.value, 0) / tg.amount, 1) end,
       coalesce(a.orders, 0)
  from purchase_types t
  cross join month
  left join purchase_targets tg
    on tg.scope = 'type' and tg.type_code = t.code and tg.period = month.m
   and coalesce(tg.entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_entity, '00000000-0000-0000-0000-000000000000'::uuid)
  left join lateral (
    select sum(value) as value, sum(orders)::int as orders
      from v_purchase_by_type v
     where v.type_code = t.code and v.period = month.m
       and (p_entity is null or v.entity_id = p_entity)
  ) a on true
 where t.active

union all

select 'purchaser', p.id::text, p.name,
       coalesce(tg.amount, 0),
       coalesce(a.value, 0),
       greatest(coalesce(tg.amount, 0) - coalesce(a.value, 0), 0),
       case when coalesce(tg.amount, 0) > 0
         then round(100 * coalesce(a.value, 0) / tg.amount, 1) end,
       coalesce(a.orders, 0)
  from purchasers p
  cross join month
  left join purchase_targets tg
    on tg.scope = 'purchaser' and tg.purchaser_id = p.id and tg.period = month.m
   and coalesce(tg.entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_entity, '00000000-0000-0000-0000-000000000000'::uuid)
  left join lateral (
    select sum(value) as value, sum(orders)::int as orders
      from v_purchase_by_purchaser v
     where v.purchaser_id = p.id and v.period = month.m
       and (p_entity is null or v.entity_id = p_entity)
  ) a on true
 where p.active

order by 1, 4 desc, 3
$$;

grant execute on function purchase_achievement(date, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. THE RIGHT
-- ---------------------------------------------------------------------

insert into permissions (code, module, label, hint, sort_order) values
  ('purchase.targets', 'purchase', 'Purchase targets',
   'See targets against achievement. Only MD Office can change a target.', 95)
on conflict (code) do update
  set label = excluded.label, hint = excluded.hint,
      sort_order = excluded.sort_order, active = true;

insert into role_permissions (role, permission_code)
select r.code, 'purchase.targets' from roles r
 where r.active and r.base_role in ('hod', 'manager')
   and exists (select 1 from role_permissions rp
                where rp.role = r.code and rp.permission_code = 'po.view')
on conflict do nothing;

-- ---------------------------------------------------------------------
--   select * from purchase_achievement(current_date);
--   select subject, old_amount, new_amount, direction, reason, actor_name
--     from purchase_target_history order by created_at desc;
-- ---------------------------------------------------------------------
