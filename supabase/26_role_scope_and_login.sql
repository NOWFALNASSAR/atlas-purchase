-- =====================================================================
-- ATLAS  |  26_role_scope_and_login.sql
--
-- Three changes:
--
--   1. A role sees its own module and nothing else. Sales HOD gets
--      Sales. Purchase HOD gets Purchase. Everyone gets Tasks, because
--      tasks are how departments talk to each other. Anything more is
--      granted per person on Masters → Users.
--
--   2. Editing, reassigning and cancelling a task belongs to MD Office
--      and Admin. Everybody else raises an issue instead, and MD Office
--      decides. The rights exist, so you can hand them out if you want.
--
--   3. Sign in with a username instead of an email address.
--
-- Run after 24 and 25. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THREE NEW RIGHTS OVER TASKS
--
-- Until now anyone in the raising department could cancel a task or
-- send it back. That is too much authority for work that crosses
-- departments — the point of the task system is that neither side can
-- quietly make an awkward job disappear.
-- ---------------------------------------------------------------------

insert into permissions (code, module, label, hint, sort_order) values
  ('tasks.edit',     'tasks', 'Edit a raised task',
   'Change the title, details, due date or person after it has been raised', 360),
  ('tasks.reassign', 'tasks', 'Move a task to another department',
   'Settle a disputed task, or hand it to someone else', 370),
  ('tasks.cancel',   'tasks', 'Cancel a task',
   'Stop a task that should never have been raised', 380)
on conflict (code) do update
  set module = excluded.module, label = excluded.label,
      hint = excluded.hint, sort_order = excluded.sort_order, active = true;

-- Deliberately given to nobody. Admin and MD Office hold them anyway,
-- because anything with the admin base role has every right. Hand them
-- to a specific person on Masters → Users, Rights tab.
delete from role_permissions
 where permission_code in ('tasks.edit','tasks.reassign','tasks.cancel');

-- ---------------------------------------------------------------------
-- 2. ENFORCE THEM IN THE DATABASE, NOT JUST THE BUTTONS
-- ---------------------------------------------------------------------

create or replace function cancel_task(p_task uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not (has_perm('tasks.cancel') or am_md_office()) then
    raise exception 'Only MD Office can cancel a task. Raise an issue on it instead.';
  end if;
  if not exists (select 1 from tasks where id = p_task
                  and status not in ('verified','cancelled')) then
    raise exception 'This task cannot be cancelled';
  end if;
  if coalesce(trim(p_note),'') = '' then
    raise exception 'Say why it is being cancelled';
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  update tasks set status = 'cancelled', closed_at = now(), updated_at = now()
   where id = p_task;
  insert into task_events (task_id, action, to_status, note, actor_name)
  values (p_task, 'cancelled', 'cancelled', p_note, v_name);
end $$;

create or replace function md_assign_task(p_task uuid, p_dept uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_old text;
begin
  if not (has_perm('tasks.reassign') or am_md_office()) then
    raise exception 'Only MD Office can move a task to another department';
  end if;
  if coalesce(trim(p_note),'') = '' then
    raise exception 'Add a note saying why it goes to this department';
  end if;

  select status into v_old from tasks where id = p_task;
  if v_old is null then raise exception 'No such task'; end if;
  if v_old in ('verified','cancelled') then
    raise exception 'This task is already closed';
  end if;

  select full_name into v_name from profiles where id = auth.uid();

  update tasks
     set to_dept = p_dept, status = 'raised',
         acknowledged_at = null, started_at = null, updated_at = now()
   where id = p_task;

  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'reassigned', v_old, 'raised',
          p_note || ' — assigned by MD Office', v_name);
end $$;

-- editing a raised task now needs the right, not just having raised it
drop policy if exists update_own_task on tasks;
create policy update_own_task on tasks for update to authenticated
  using (has_perm('tasks.edit') or am_md_office())
  with check (has_perm('tasks.edit') or am_md_office());

-- ---------------------------------------------------------------------
-- 3. EVERY ROLE BACK INSIDE ITS OWN MODULE
--
-- 24_roles.sql opened everything to everyone so that Accounts could see
-- Tasks again. That went too far the other way. This is the middle:
-- your own module, plus Tasks, which everyone needs because tasks are
-- how departments talk to each other.
-- ---------------------------------------------------------------------

delete from role_permissions
 where role in (select code from roles where base_role <> 'admin');

do $$
declare
  r record;
  perms text[];

  -- module bundles
  c_tasks     text[] := array['tasks.view','tasks.create','tasks.verify','tasks.reports'];
  c_purchase  text[] := array['po.view','po.create','po.submit','po.send',
                              'compare.view','reports.view'];
  c_sales     text[] := array['sales.view','sales.branches','sales.salesmen',
                              'sales.targets.view'];
  c_stock     text[] := array['inventory.view','godown.view','transfers.view'];
  -- the supplier and item MASTER PAGES belong to the Purchase HOD who
  -- owns that data. Picking a supplier while raising an order still
  -- works for everyone — that reads the tables directly.
begin
  for r in select code, base_role from roles where active and base_role <> 'admin' loop
    perms := c_tasks;   -- everybody, always

    -- ---------- PURCHASE ----------
    if r.code in ('executive','manager','hod') then
      perms := perms || c_purchase;
      if r.code in ('manager','hod') then
        perms := perms || array['po.approve','po.rate_edit','insights.view'];
      end if;
      if r.code = 'hod' then
        perms := perms || array['suppliers.view','suppliers.edit',
                                'items.view','items.edit',
                                'inventory.view','tasks.schedules'];
      end if;

    -- ---------- SALES ----------
    elsif r.code in ('sales_executive','sales_manager','sales_hod','showroom_manager') then
      perms := perms || c_sales;
      if r.code in ('sales_manager','sales_hod','showroom_manager') then
        perms := perms || array['sales.import'];
      end if;
      if r.code = 'sales_hod' then
        -- not insights.view: that page is purchase margins, not sales
        perms := perms || array['sales.targets.edit','tasks.schedules'];
      end if;
      -- a showroom manager needs to see the stock standing in the shop
      if r.code = 'showroom_manager' then
        perms := perms || array['inventory.view','transfers.view','transfers.create'];
      end if;

    -- ---------- STOCK ----------
    elsif r.code in ('inventory_executive','inventory_manager','godown_manager') then
      perms := perms || c_stock;
      if r.code in ('inventory_manager','godown_manager') then
        perms := perms || array['godown.edit','transfers.create','transfers.approve'];
      end if;
      if r.code = 'inventory_manager' then
        perms := perms || array['tasks.schedules'];
      end if;

    -- ---------- ACCOUNTS ----------
    elsif r.code in ('accounts','accounts_manager') then
      perms := perms || array['po.view','reports.view','compare.view'];
      if r.code = 'accounts_manager' then
        perms := perms || array['insights.view'];   -- purchase margins
      end if;

    -- ---------- EVERYONE ELSE ----------
    -- Transport, HR, Marketing, Audit, Operations. They exist to send
    -- and receive tasks. Give them a module on the Roles page when they
    -- actually need one.
    else
      null;
    end if;

    insert into role_permissions (role, permission_code)
    select r.code, x from unnest(perms) x
     where exists (select 1 from permissions p where p.code = x and p.active)
    on conflict do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. SIGN IN WITH A USERNAME
--
-- Supabase authenticates on an email address and that does not change.
-- What changes is that a username can be typed instead: the app looks
-- up which email it belongs to, then signs in normally.
-- ---------------------------------------------------------------------

alter table profiles add column if not exists username text;

create unique index if not exists uq_profiles_username
  on profiles (lower(username)) where username is not null;

-- fill in a starting username from the email for anyone who has none,
-- so nobody is locked out the moment this runs
update profiles p
   set username = split_part(u.email, '@', 1)
  from auth.users u
 where u.id = p.id
   and p.username is null
   and not exists (
     select 1 from profiles x
      where lower(x.username) = lower(split_part(u.email, '@', 1)));

-- anyone still without one gets their employee code, then a fallback
update profiles set username = lower(emp_code)
 where username is null and emp_code is not null
   and not exists (select 1 from profiles x where lower(x.username) = lower(profiles.emp_code));

update profiles set username = 'user' || left(replace(id::text,'-',''), 8)
 where username is null;

-- ---------- the lookup ----------
-- SECURITY DEFINER because auth.users is not readable by normal users.
-- It answers one question and only one: which email does this username
-- belong to. Wrong username returns nothing.
create or replace function email_for_login(p_login text) returns text
language sql stable security definer set search_path = public as $$
  select u.email
    from profiles p
    join auth.users u on u.id = p.id
   where lower(p.username) = lower(trim(p_login))
     and p.active
   limit 1
$$;

grant execute on function email_for_login(text) to anon, authenticated;

-- ---------- keep it on signup ----------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user text;
begin
  v_user := nullif(trim(new.raw_user_meta_data->>'username'), '');

  -- a taken username must not block the account being created
  if v_user is not null and exists (
       select 1 from profiles where lower(username) = lower(v_user)) then
    v_user := v_user || left(replace(new.id::text,'-',''), 4);
  end if;

  insert into profiles (id, full_name, username)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          coalesce(v_user, split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------- only an admin changes somebody's username ----------
create or replace function guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if has_perm('users.manage') or my_role() = 'admin' then
    return new;
  end if;

  if new.role           is distinct from old.role
  or new.username       is distinct from old.username
  or new.perm_grant     is distinct from old.perm_grant
  or new.perm_deny      is distinct from old.perm_deny
  or new.approval_limit is distinct from old.approval_limit
  or new.entity_ids     is distinct from old.entity_ids
  or new.active         is distinct from old.active then
    raise exception 'Only an admin can change usernames, roles, rights or limits';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_profile_update on profiles;
create trigger trg_guard_profile_update
  before update on profiles
  for each row execute function guard_profile_update();

-- ---------------------------------------------------------------------
-- 5. CHECK IT
--
--   select r.label, count(rp.permission_code) as rights
--     from roles r left join role_permissions rp on rp.role = r.code
--    group by 1 order by 1;
--
--   select full_name, username, role from profiles order by full_name;
--
--   select email_for_login('nowfal');     -- should return the email
--
-- Tell everyone their username before you deploy this. Their email
-- still works as a login too, so nobody is stranded.
-- ---------------------------------------------------------------------
