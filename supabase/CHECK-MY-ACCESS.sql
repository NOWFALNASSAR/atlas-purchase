-- =====================================================================
-- ATLAS  |  Why can I not see a menu item?
--
-- Read-only. Run it while signed in as the person who cannot see it.
-- =====================================================================

-- 1. WHO AM I, AND WHAT ROLE
select p.full_name, p.username, p.role,
       (select string_agg(d.name, ', ') from department_members m
          join departments d on d.id = m.department_id
         where m.profile_id = p.id and m.active) as departments
  from profiles p where p.id = auth.uid();

-- 2. DO THE RIGHTS EXIST AT ALL
select code, module, label, active
  from permissions
 where code in ('stock.import','stock.reports','sales.import','sales.reports')
 order by code;

-- 3. IS MY ROLE GRANTED THEM
select rp.permission_code, rp.role
  from role_permissions rp
 where rp.permission_code in ('stock.import','stock.reports','sales.import','sales.reports')
   and rp.role = (select role from profiles where id = auth.uid())
 order by rp.permission_code;

-- 4. WHAT THE APP ACTUALLY SEES FOR ME
--    my_permissions() returns a text ARRAY, not a table — so it is
--    unnested here rather than selected from. This is the list the menu
--    is built from: if stock.import is not in it, the item is hidden
--    however the tables above look.
select unnest(my_permissions()) as i_have
 order by 1;

-- and the direct answer
select 'stock.import' as needed_for_the_upload_menu,
       ('stock.import' = any (my_permissions())) as do_i_have_it,
       ('stock.reports' = any (my_permissions())) as can_i_see_stock_reports,
       ('sales.import' = any (my_permissions())) as can_i_upload_sales;

-- ---------------------------------------------------------------------
-- READING IT
--
-- Query 2 empty      -> run 43_sales_stock_access.sql
-- Query 3 empty      -> your role was never granted it; the fix is below
-- Query 4 missing it -> sign out and back in; rights are read at sign-in
-- All four fine      -> the code is not deployed. Check that App.jsx and
--                       StockUpload.jsx are in GitHub and Vercel says Ready.
-- ---------------------------------------------------------------------

-- IF QUERY 3 CAME BACK EMPTY, this grants it to the senior roles:
--
-- insert into role_permissions (role, permission_code)
-- select r.code, p.code
--   from roles r
--  cross join (values ('stock.import'), ('stock.reports'),
--                     ('sales.import'), ('sales.reports')) p(code)
--  where r.active and r.base_role in ('admin', 'md_office')
-- on conflict do nothing;
--
-- Then sign out and back in.
