-- =====================================================================
-- ATLAS  |  27_no_email_login.sql
--
-- No email addresses anywhere. People sign up with a name they choose
-- and sign in with that name or their employee ID.
--
-- How it works underneath: Supabase Auth is built on an email address
-- and that cannot be turned off. So the app makes one up —
-- nowfal@atlas.internal — and nobody ever sees it or types it. It is a
-- key in a table, not a way of contacting anyone.
--
-- THE TRADE. No email means no "forgot my password" link, because there
-- is nowhere to send it. Section 4 gives admins a Set password button
-- instead. That is the honest exchange: staff never deal with email,
-- and in return somebody with the users right resets passwords.
--
-- BEFORE YOU RUN THIS: Supabase → Authentication → Providers → Email →
-- switch OFF "Confirm email". Sign-up will fail otherwise, because
-- Supabase will try to send a confirmation to an address that does not
-- exist. Your README already recommends this.
--
-- Run after 26. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE INTERNAL DOMAIN
--
-- .internal is reserved and unroutable by design, so one of these
-- addresses can never accidentally reach a real inbox.
-- ---------------------------------------------------------------------

insert into settings (key, value)
values ('login_domain', '"atlas.internal"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. EMPLOYEE ID BECOMES A LOGIN
--
-- Two people with the same employee ID would make a login ambiguous.
-- This reports the clash rather than failing the whole migration.
-- ---------------------------------------------------------------------

do $$
declare v_dupes text;
begin
  select string_agg(emp_code || ' (' || n || ')', ', ')
    into v_dupes
    from (select lower(emp_code) as emp_code, count(*) n
            from profiles where nullif(trim(emp_code),'') is not null
           group by 1 having count(*) > 1) d;

  if v_dupes is not null then
    raise warning 'Employee IDs used more than once, so they cannot be used to sign in: %', v_dupes;
    raise warning 'Fix them on Masters -> Users, then run this file again.';
  else
    create unique index if not exists uq_profiles_emp_code
      on profiles (lower(emp_code)) where nullif(trim(emp_code),'') is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. THE LOOKUP — username OR employee ID
--
-- Runs before anyone is signed in, so it has to be callable by anon.
-- It answers exactly one question and returns nothing for a wrong name.
-- ---------------------------------------------------------------------

create or replace function email_for_login(p_login text) returns text
language sql stable security definer set search_path = public as $$
  select u.email
    from profiles p
    join auth.users u on u.id = p.id
   where p.active
     and (lower(p.username) = lower(trim(p_login))
       or lower(nullif(trim(p.emp_code),'')) = lower(trim(p_login)))
   order by (lower(p.username) = lower(trim(p_login))) desc   -- username wins
   limit 1
$$;

grant execute on function email_for_login(text) to anon, authenticated;

-- is this name free? checked while someone types, before they sign up
create or replace function username_available(p_login text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from profiles
     where lower(username) = lower(trim(p_login))
        or lower(nullif(trim(emp_code),'')) = lower(trim(p_login)))
   and length(trim(p_login)) >= 3
$$;

grant execute on function username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. ADMINS RESET PASSWORDS
--
-- This is what replaces the forgot-password email. pgcrypto is already
-- installed by 01_schema.sql, and Supabase stores passwords as bcrypt,
-- so writing one here is the same thing Supabase itself does.
-- ---------------------------------------------------------------------

create or replace function admin_set_password(p_profile uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (has_perm('users.manage') or my_role() = 'admin') then
    raise exception 'Only an admin can set somebody else''s password';
  end if;

  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Password must be at least 6 characters';
  end if;

  if not exists (select 1 from profiles where id = p_profile) then
    raise exception 'No such user';
  end if;

  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')),
         updated_at = now()
   where id = p_profile;

  if not found then
    raise exception 'That user has no sign-in account';
  end if;
end $$;

revoke all on function admin_set_password(uuid, text) from public, anon;
grant execute on function admin_set_password(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. SIGN-UP KEEPS THE NAME THE PERSON CHOSE
--
-- The app sends username@atlas.internal as the address. Strip it back
-- off for the username, unless one was passed explicitly.
-- ---------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user text; v_emp text;
begin
  v_user := nullif(trim(new.raw_user_meta_data->>'username'), '');
  v_emp  := nullif(trim(new.raw_user_meta_data->>'emp_code'), '');

  if v_user is null then
    v_user := split_part(new.email, '@', 1);
  end if;

  if exists (select 1 from profiles where lower(username) = lower(v_user)) then
    v_user := v_user || left(replace(new.id::text, '-', ''), 4);
  end if;

  if v_emp is not null and exists (
       select 1 from profiles where lower(emp_code) = lower(v_emp)) then
    v_emp := null;    -- taken; an admin sorts it out
  end if;

  insert into profiles (id, full_name, username, emp_code)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), v_user),
          v_user, v_emp)
  on conflict (id) do nothing;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6. CHECK IT
--
--   select full_name, username, emp_code from profiles order by full_name;
--   select email_for_login('nowfal');       -- returns the internal address
--   select username_available('nowfal');    -- false, it is taken
--
-- Give everyone their username before you deploy. Anyone who signed up
-- earlier with a real email keeps that address underneath — they just
-- type their username now instead.
-- ---------------------------------------------------------------------
