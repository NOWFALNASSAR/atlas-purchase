-- =====================================================================
-- ATLAS  |  43_sales_stock_access.sql
--
-- FIXES: "No sales uploaded yet" when the data is actually loaded.
--
-- The read policies I wrote on the sales and stock tables say:
--
--     using (has_perm('sales.view') or my_role() = 'admin')
--
-- MD Office is not in that list, and nothing grants sales.view to any
-- role. So the rows load fine — the SQL editor runs as the owner and
-- ignores row level security — and then the app, which does not, sees
-- nothing at all.
--
-- An empty screen because of a permission is the worst kind of bug:
-- it looks exactly like an empty database.
--
-- Run after 42. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MD OFFICE SEES EVERYTHING, AS IT DOES EVERYWHERE ELSE
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  -- sales
  foreach t in array array['sales_bills','sales_barcode_daily','sales_person_daily',
                           'sales_uploads','sales_targets','incentive_slabs'] loop
    if to_regclass('public.' || t) is null then continue; end if;

    execute format('drop policy if exists read_%1$s on %1$I', t);
    execute format('create policy read_%1$s on %1$I for select to authenticated
                    using (has_perm(''sales.view'')
                        or has_perm(''sales.reports'')
                        or am_md_office()
                        or my_role() = ''admin'')', t);

    execute format('drop policy if exists write_%1$s on %1$I', t);
    execute format('create policy write_%1$s on %1$I for all to authenticated
                    using (has_perm(''sales.import'') or am_md_office() or my_role() = ''admin'')
                    with check (has_perm(''sales.import'') or am_md_office() or my_role() = ''admin'')', t);
  end loop;

  -- stock, which has the same problem
  foreach t in array array['divisions','brands','item_master','supplier_master',
                           'barcodes','stock_snapshots','stock_lines','sales_lines'] loop
    if to_regclass('public.' || t) is null then continue; end if;

    execute format('drop policy if exists read_%1$s on %1$I', t);
    execute format('create policy read_%1$s on %1$I for select to authenticated
                    using (has_perm(''inventory.view'')
                        or has_perm(''stock.reports'')
                        or am_md_office()
                        or my_role() = ''admin'')', t);

    execute format('drop policy if exists write_%1$s on %1$I', t);
    execute format('create policy write_%1$s on %1$I for all to authenticated
                    using (has_perm(''stock.import'') or am_md_office() or my_role() = ''admin'')
                    with check (has_perm(''stock.import'') or am_md_office() or my_role() = ''admin'')', t);
  end loop;
end $$;

-- setting a sales target stays with MD Office only
drop policy if exists write_sales_targets on sales_targets;
create policy write_sales_targets on sales_targets for all to authenticated
  using (am_md_office()) with check (am_md_office());

-- ---------------------------------------------------------------------
-- 2. GRANT THE RIGHTS, WHICH NOTHING DID
-- ---------------------------------------------------------------------

insert into permissions (code, module, label, hint, sort_order) values
  ('sales.view',    'sales', 'See sales',        'Sales figures and reports',        260),
  ('sales.reports', 'sales', 'Sales reports',    'Daily sales, salesmen, item, tax', 270),
  ('sales.targets', 'sales', 'Sales targets',    'Targets and incentive',            280),
  ('sales.import',  'sales', 'Upload sales',     'Load the daily export',            290),
  ('stock.reports', 'stock', 'Stock reports',    'Ageing, dead stock, sell-through', 180),
  ('stock.import',  'stock', 'Upload stock',     'Load the stock master',            170)
on conflict (code) do update
  set label = excluded.label, hint = excluded.hint, active = true;

-- anyone senior enough to see purchase orders should see sales reports
insert into role_permissions (role, permission_code)
select r.code, p.code
  from roles r
 cross join (values ('sales.view'), ('sales.reports'), ('stock.reports')) p(code)
 where r.active and r.base_role in ('admin', 'md_office', 'hod', 'manager')
on conflict do nothing;

-- uploading is a narrower thing
insert into role_permissions (role, permission_code)
select r.code, p.code
  from roles r
 cross join (values ('sales.import'), ('stock.import'), ('sales.targets')) p(code)
 where r.active and r.base_role in ('admin', 'md_office')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. WHAT DO I ACTUALLY SEE
--
-- The counts below run as the owner, so they show what is really in the
-- tables regardless of policy. Compare them against what the app shows.
-- ---------------------------------------------------------------------

select 'sales_uploads'       as table_name, count(*) as rows from sales_uploads
union all select 'sales_bills',            count(*) from sales_bills
union all select 'sales_barcode_daily',    count(*) from sales_barcode_daily
union all select 'sales_person_daily',     count(*) from sales_person_daily
union all select 'stock_lines',            count(*) from stock_lines
union all select 'barcodes',               count(*) from barcodes;

-- If sales_uploads is 0, the generated import was never run — that is a
-- different problem and this file does not fix it.
--
-- If it is 1 or more and the app still said "No sales uploaded yet",
-- this file was the fix. Sign out and back in, because rights are read
-- at sign-in.
