-- =====================================================================
-- ATLAS  |  24_roles.sql
--
-- Two problems fixed:
--
--   1. Only five roles existed, and they were baked into a CHECK
--      constraint. There was no Sales Manager, no Inventory Manager,
--      no Showroom Manager.
--
--   2. Accounts could not see the Tasks module at all, because
--      20_role_defaults.sql narrowed them to purchase work only.
--
-- Now: roles live in a table you can add to, and every role can see
-- every module by default. You take rights away rather than hunting
-- for ones that were never granted.
--
-- Run after 19, 20, 22 and 23. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ROLES BECOME DATA
--
-- The awkward part: about twenty row-level-security policies written
-- across nine earlier files test role names literally —
-- my_role() in ('hod','admin') and so on. Rewriting all of them to add
-- one new role would be a lot of risk for a small change.
--
-- So every role carries a BASE ROLE: one of the original five, saying
-- how much authority it has in the database. Sales Manager has the base
-- role 'manager', so every existing policy already knows what to do
-- with it, and not one of them had to be touched.
--
--   profiles.role   the real role — drives what the app shows
--   roles.base_role the authority level — drives what the database allows
-- ---------------------------------------------------------------------

create table if not exists roles (
  code       text primary key,
  label      text not null,
  base_role  text not null
             check (base_role in ('executive','manager','hod','accounts','admin')),
  sort_order int not null default 100,
  built_in   boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

insert into roles (code, label, base_role, sort_order, built_in) values
  -- the original five, unchanged
  ('admin',               'Admin / MD',           'admin',      1,  true),
  ('hod',                 'Purchase HOD',         'hod',        20, true),
  ('manager',             'Purchase Manager',     'manager',    21, true),
  ('executive',           'Purchase Executive',   'executive',  22, true),
  ('accounts',            'Accounts',             'accounts',   40, true),

  -- new
  ('md_office',           'MD Office',            'admin',      2,  false),
  ('accounts_manager',    'Accounts Manager',     'manager',    41, false),
  ('sales_hod',           'Sales HOD',            'hod',        30, false),
  ('sales_manager',       'Sales Manager',        'manager',    31, false),
  ('sales_executive',     'Sales Executive',      'executive',  32, false),
  ('showroom_manager',    'Showroom Manager',     'manager',    33, false),
  ('inventory_manager',   'Inventory Manager',    'manager',    50, false),
  ('inventory_executive', 'Inventory Executive',  'executive',  51, false),
  ('godown_manager',      'Godown Manager',       'manager',    52, false),
  ('transport_manager',   'Transport Manager',    'manager',    60, false),
  ('hr_manager',          'HR Manager',           'manager',    70, false),
  ('marketing_manager',   'Marketing Manager',    'manager',    71, false),
  ('audit_manager',       'Audit Manager',        'manager',    72, false),
  ('operations_manager',  'Operations Manager',   'manager',    73, false)
on conflict (code) do update
  set label = excluded.label, sort_order = excluded.sort_order, active = true;

-- ---------------------------------------------------------------------
-- 2. LET PROFILES AND role_permissions USE THEM
-- ---------------------------------------------------------------------

alter table profiles drop constraint if exists profiles_role_check;
alter table role_permissions drop constraint if exists role_permissions_role_check;

-- anything already saved that is not in the table gets added, so the
-- foreign keys below cannot fail on live data
insert into roles (code, label, base_role, sort_order)
select distinct p.role, initcap(replace(p.role, '_', ' ')), 'executive', 900
  from profiles p where p.role is not null
   and not exists (select 1 from roles r where r.code = p.role)
on conflict (code) do nothing;

delete from role_permissions rp
 where not exists (select 1 from roles r where r.code = rp.role);

alter table profiles drop constraint if exists profiles_role_fkey;
alter table profiles add constraint profiles_role_fkey
  foreign key (role) references roles(code) on update cascade;

alter table role_permissions drop constraint if exists role_permissions_role_fkey;
alter table role_permissions add constraint role_permissions_role_fkey
  foreign key (role) references roles(code) on update cascade on delete cascade;

-- ---------------------------------------------------------------------
-- 3. my_role() NOW ANSWERS WITH THE BASE ROLE
--
-- This is the line that lets twenty existing policies keep working
-- untouched. A Sales Manager reports as 'manager' to the database.
-- ---------------------------------------------------------------------

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(r.base_role, p.role)
    from profiles p
    left join roles r on r.code = p.role
   where p.id = auth.uid()
$$;

-- the real role, when you actually want it
create or replace function my_role_code() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

grant execute on function my_role_code() to authenticated;

-- ---------------------------------------------------------------------
-- 4. RIGHTS FOLLOW THE REAL ROLE, NOT THE BASE ROLE
--
-- Otherwise every manager-based role would share one set of rights and
-- the whole point would be lost.
-- ---------------------------------------------------------------------

create or replace function my_permissions() returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_role  text;
  v_base  text;
  v_grant text[];
  v_deny  text[];
  v_out   text[];
  v_on    boolean;
begin
  select p.role, coalesce(r.base_role, p.role), p.perm_grant, p.perm_deny, p.active
    into v_role, v_base, v_grant, v_deny, v_on
    from profiles p
    left join roles r on r.code = p.role
   where p.id = auth.uid();

  if v_role is null or v_on is not true then
    return '{}';
  end if;

  -- anything with admin authority has every right, always
  if v_base = 'admin' then
    select coalesce(array_agg(code), '{}') into v_out from permissions where active;
    return v_out;
  end if;

  select coalesce(array_agg(distinct code), '{}') into v_out
    from (
      select rp.permission_code as code
        from role_permissions rp
       where rp.role = v_role
      union
      select unnest(coalesce(v_grant, '{}'::text[]))
    ) s
   where s.code <> all (coalesce(v_deny, '{}'::text[]))
     and exists (select 1 from permissions p where p.code = s.code and p.active);

  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 5. EVERY ROLE SEES EVERY MODULE
--
-- 20_role_defaults.sql took the opposite approach — start narrow, widen
-- where needed. That is why Accounts lost the Tasks module.
--
-- This reverses it. Every role can now open every module and read what
-- is there. Doing things — approving, editing masters, importing sales,
-- managing users — still has to be granted.
--
-- Take rights away on Masters → Roles where a role should not have them.
-- Removing is easier than hunting for something that was never granted.
-- ---------------------------------------------------------------------

-- (a) everyone can look at everything
insert into role_permissions (role, permission_code)
select r.code, p.code
  from roles r
  cross join permissions p
 where r.active
   and (select base_role from roles where code = r.code) <> 'admin'
   and p.active
   and p.code in (
     'po.view', 'compare.view', 'reports.view', 'insights.view',
     'inventory.view', 'godown.view', 'transfers.view',
     'sales.view', 'sales.branches', 'sales.salesmen', 'sales.targets.view',
     'tasks.view', 'tasks.create', 'tasks.reports'
   )
on conflict do nothing;

-- (b) doing things, by what the role is actually for
do $$
declare
  r record;
  extra text[];
begin
  for r in select code, base_role from roles where active and base_role <> 'admin' loop
    extra := '{}';

    -- raising and sending purchase orders
    if r.code in ('executive','manager','hod','sales_executive','sales_manager',
                  'sales_hod','showroom_manager','inventory_manager',
                  'inventory_executive','godown_manager','operations_manager') then
      extra := extra || array['po.create','po.submit','po.send'];
    end if;

    -- approving them
    if r.base_role in ('manager','hod') and r.code in ('manager','hod') then
      extra := extra || array['po.approve','po.rate_edit'];
    end if;

    -- stock movement
    if r.code in ('hod','inventory_manager','inventory_executive','godown_manager',
                  'showroom_manager','operations_manager') then
      extra := extra || array['transfers.create'];
    end if;
    if r.code in ('hod','inventory_manager','godown_manager') then
      extra := extra || array['godown.edit','transfers.approve'];
    end if;

    -- sales
    if r.code in ('sales_hod','sales_manager','showroom_manager') then
      extra := extra || array['sales.import'];
    end if;
    if r.code in ('sales_hod') then
      extra := extra || array['sales.targets.edit'];
    end if;

    -- tasks: everyone verifies their own department's work
    extra := extra || array['tasks.verify'];
    if r.base_role in ('hod','manager') then
      extra := extra || array['tasks.schedules'];
    end if;

    -- the masters belong to HODs
    if r.base_role = 'hod' then
      extra := extra || array['suppliers.view','suppliers.edit','items.view','items.edit'];
    else
      extra := extra || array['suppliers.view','items.view'];
    end if;

    insert into role_permissions (role, permission_code)
    select r.code, x from unnest(extra) x
     where exists (select 1 from permissions p where p.code = x and p.active)
    on conflict do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. MANAGING ROLES
-- ---------------------------------------------------------------------

alter table roles enable row level security;

drop policy if exists read_roles on roles;
create policy read_roles on roles for select to authenticated using (true);

drop policy if exists write_roles on roles;
create policy write_roles on roles for all to authenticated
  using (has_perm('roles.manage')) with check (has_perm('roles.manage'));

-- a built-in role must never be deleted — policies depend on the five
create or replace function guard_role_delete()
returns trigger language plpgsql as $$
begin
  if old.built_in then
    raise exception 'This is a built-in role and cannot be deleted. Switch it off instead.';
  end if;
  if exists (select 1 from profiles where role = old.code) then
    raise exception 'Somebody still has this role. Move them to another role first.';
  end if;
  return old;
end $$;

drop trigger if exists trg_guard_role_delete on roles;
create trigger trg_guard_role_delete before delete on roles
  for each row execute function guard_role_delete();

-- ---------------------------------------------------------------------
-- 7. CHECK IT
--
--   select r.code, r.label, r.base_role, count(rp.permission_code) as rights
--     from roles r
--     left join role_permissions rp on rp.role = r.code
--    group by 1,2,3 order by r.sort_order;
--
-- Admin and MD Office show 0 rights in that list, which is correct —
-- anything with the admin base role gets everything without needing rows.
--
-- Accounts should now show the Tasks module again. If it does not,
-- sign out and back in: rights are read once when you sign in.
-- ---------------------------------------------------------------------
