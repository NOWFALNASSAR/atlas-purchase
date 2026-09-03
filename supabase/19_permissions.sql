-- =====================================================================
-- ATLAS  |  19_permissions.sql
-- User rights and roles, editable inside the app.
--
-- Three layers, in this order:
--
--   1. permissions       the full list of things a person can do
--   2. role_permissions  what each role can do by default   (admin edits)
--   3. profiles.perm_grant / perm_deny   per-person exceptions
--
-- Effective rights = role defaults + grants - denies.
-- Admin always has everything; that is deliberate and cannot be removed,
-- otherwise you could lock yourself out of your own system.
--
-- Safe to re-run.
-- Run in Supabase → SQL Editor → New query → Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE PERMISSION CATALOGUE
-- ---------------------------------------------------------------------

create table if not exists permissions (
  code        text primary key,          -- 'po.approve'
  module      text not null,             -- purchase | stock | sales | tasks | masters
  label       text not null,             -- what an admin reads on screen
  hint        text,                      -- one line of plain explanation
  sort_order  int  not null default 0,
  active      boolean not null default true
);

insert into permissions (code, module, label, hint, sort_order) values
  -- purchase ---------------------------------------------------------
  ('po.view',        'purchase', 'See purchase orders',   'Open the orders list and any order in their entity', 10),
  ('po.create',      'purchase', 'Create orders',         'Start a new order and edit it while it is a draft',  20),
  ('po.submit',      'purchase', 'Submit for approval',   'Send their own draft into the approval chain',       30),
  ('po.approve',     'purchase', 'Approve and reject',    'Still limited by their approval limit in rupees',    40),
  ('po.rate_edit',   'purchase', 'Change rates',          'Edit rate or quantity on an order already pending',  50),
  ('po.send',        'purchase', 'Send to supplier',      'Download the PDF, send on WhatsApp or email',        60),
  ('compare.view',   'purchase', 'Rate compare',          'See what each supplier charged and when',            70),
  ('reports.view',   'purchase', 'Order reports',         'Purchase reports and exports',                       80),
  ('insights.view',  'purchase', 'Insights',              'Margins, supplier behaviour, rate movement',         90),

  -- stock ------------------------------------------------------------
  ('inventory.view',    'stock', 'See inventory',      'Stock on hand across shops and godown',      110),
  ('godown.view',       'stock', 'See godown',         'Godown stock and movement',                  120),
  ('godown.edit',       'stock', 'Edit godown',        'Record godown inward and outward',           130),
  ('transfers.view',    'stock', 'See transfers',      'Shop to shop and godown transfers',          140),
  ('transfers.create',  'stock', 'Raise transfers',    'Request stock from another shop or godown',  150),
  ('transfers.approve', 'stock', 'Approve transfers',  'Release stock against a transfer request',   160),

  -- sales ------------------------------------------------------------
  ('sales.view',         'sales', 'Sales dashboard',    'Group and branch sales figures',            210),
  ('sales.branches',     'sales', 'Branch performance', 'Branch by branch comparison',               220),
  ('sales.salesmen',     'sales', 'Salesmen',           'Individual salesman performance',           230),
  ('sales.targets.view', 'sales', 'See targets',        'Targets and achievement',                   240),
  ('sales.targets.edit', 'sales', 'Set targets',        'Change monthly targets for branch or person', 250),
  ('sales.import',       'sales', 'Upload sales',       'Import the daily or monthly sales file',    260),

  -- tasks ------------------------------------------------------------
  ('tasks.view',    'tasks', 'See tasks',      'Tasks raised by or sent to their department',   310),
  ('tasks.create',  'tasks', 'Raise tasks',    'Send a task to another department',             320),
  ('tasks.verify',  'tasks', 'Verify and close', 'Accept or reissue completed work',            330),
  ('tasks.reports', 'tasks', 'Task performance', 'Department response and delay reports',       340),

  -- masters ----------------------------------------------------------
  ('suppliers.view', 'masters', 'See suppliers',   'Open the supplier master',                   410),
  ('suppliers.edit', 'masters', 'Edit suppliers',  'Add, change and import suppliers',           420),
  ('items.view',     'masters', 'See items',       'Open the item master',                       430),
  ('items.edit',     'masters', 'Edit items',      'Add, change and import items',               440),
  ('users.manage',   'masters', 'Manage users',    'Set roles, rights, limits and entity access', 450),
  ('roles.manage',   'masters', 'Manage roles',    'Change what each role can do by default',    460),
  ('settings.manage','masters', 'Settings',        'Approval slabs, company details, numbering', 470)
on conflict (code) do update
  set module = excluded.module,
      label  = excluded.label,
      hint   = excluded.hint,
      sort_order = excluded.sort_order,
      active = true;

-- ---------------------------------------------------------------------
-- 2. WHAT EACH ROLE CAN DO BY DEFAULT
-- Admin is not listed. Admin always has everything.
-- ---------------------------------------------------------------------

create table if not exists role_permissions (
  role            text not null
                  check (role in ('executive','manager','hod','accounts')),
  permission_code text not null references permissions(code) on delete cascade,
  primary key (role, permission_code)
);

-- seed defaults, but only on a first run — never overwrite an admin's edits
do $$
begin
  if not exists (select 1 from role_permissions) then

    insert into role_permissions (role, permission_code)
    select 'executive', code from permissions where code in (
      'po.view','po.create','po.submit','po.send','compare.view','reports.view',
      'inventory.view','godown.view','transfers.view','transfers.create',
      'sales.view','tasks.view','tasks.create','tasks.reports',
      'suppliers.view','items.view');

    insert into role_permissions (role, permission_code)
    select 'manager', code from permissions where code in (
      'po.view','po.create','po.submit','po.send','po.approve','po.rate_edit',
      'compare.view','reports.view','insights.view',
      'inventory.view','godown.view','godown.edit',
      'transfers.view','transfers.create','transfers.approve',
      'sales.view','sales.branches','sales.salesmen','sales.targets.view','sales.import',
      'tasks.view','tasks.create','tasks.verify','tasks.reports',
      'suppliers.view','items.view');

    insert into role_permissions (role, permission_code)
    select 'hod', code from permissions where code in (
      'po.view','po.create','po.submit','po.send','po.approve','po.rate_edit',
      'compare.view','reports.view','insights.view',
      'inventory.view','godown.view','godown.edit',
      'transfers.view','transfers.create','transfers.approve',
      'sales.view','sales.branches','sales.salesmen',
      'sales.targets.view','sales.targets.edit','sales.import',
      'tasks.view','tasks.create','tasks.verify','tasks.reports',
      'suppliers.view','suppliers.edit','items.view','items.edit');

    insert into role_permissions (role, permission_code)
    select 'accounts', code from permissions where code in (
      'po.view','compare.view','reports.view','insights.view',
      'inventory.view','sales.view','tasks.view',
      'suppliers.view','items.view');

  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. PER-PERSON EXCEPTIONS
-- One executive may approve; one manager may not see margins.
-- ---------------------------------------------------------------------

alter table profiles add column if not exists perm_grant text[] not null default '{}';
alter table profiles add column if not exists perm_deny  text[] not null default '{}';

-- ---------------------------------------------------------------------
-- 4. WHAT AM I ALLOWED TO DO
-- ---------------------------------------------------------------------

create or replace function my_permissions() returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_role  text;
  v_grant text[];
  v_deny  text[];
  v_out   text[];
  v_on    boolean;
begin
  select role, perm_grant, perm_deny, active
    into v_role, v_grant, v_deny, v_on
    from profiles where id = auth.uid();

  if v_role is null or v_on is not true then
    return '{}';
  end if;

  if v_role = 'admin' then
    select coalesce(array_agg(code), '{}') into v_out
      from permissions where active;
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

create or replace function has_perm(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_code = any (my_permissions())
$$;

-- ---------------------------------------------------------------------
-- 5. CLOSE THE DOOR
-- profiles already allows a person to update their own row so they can
-- fix their name. Without this trigger they could also hand themselves
-- perm_grant = '{po.approve}' from the browser console. Now they cannot.
-- ---------------------------------------------------------------------

create or replace function guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if my_role() = 'admin' then
    return new;
  end if;

  if new.role           is distinct from old.role
  or new.perm_grant     is distinct from old.perm_grant
  or new.perm_deny      is distinct from old.perm_deny
  or new.approval_limit is distinct from old.approval_limit
  or new.entity_ids     is distinct from old.entity_ids
  or new.active         is distinct from old.active then
    raise exception 'Only an admin can change roles, rights, limits or access';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_profile_update on profiles;
create trigger trg_guard_profile_update
  before update on profiles
  for each row execute function guard_profile_update();

-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- Everyone reads the catalogue — the app needs it to draw the menu.
-- Only admin changes it.
-- ---------------------------------------------------------------------

alter table permissions      enable row level security;
alter table role_permissions enable row level security;

drop policy if exists read_permissions on permissions;
create policy read_permissions on permissions
  for select to authenticated using (true);

drop policy if exists admin_write_permissions on permissions;
create policy admin_write_permissions on permissions
  for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists read_role_permissions on role_permissions;
create policy read_role_permissions on role_permissions
  for select to authenticated using (true);

drop policy if exists admin_write_role_permissions on role_permissions;
create policy admin_write_role_permissions on role_permissions
  for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- ---------------------------------------------------------------------
-- 7. USING RIGHTS AS REAL SECURITY, NOT JUST MENUS
--
-- Today your policies test my_role(). Rights drawn in the app control
-- what people SEE. To make a right control what people can DO in the
-- database as well, swap the role test for has_perm() one table at a
-- time, testing each before moving on. Two worked examples:
--
--   drop policy write_items on items;
--   create policy write_items on items for all to authenticated
--     using (has_perm('items.edit')) with check (has_perm('items.edit'));
--
--   drop policy write_suppliers on suppliers;
--   create policy write_suppliers on suppliers for all to authenticated
--     using (has_perm('suppliers.edit')) with check (has_perm('suppliers.edit'));
--
-- Do NOT do all of them in one evening. One table, test, next table.
-- Leave approve_po alone until last — that one is your money.
-- ---------------------------------------------------------------------
