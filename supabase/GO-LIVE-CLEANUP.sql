-- =====================================================================
-- ATLAS  |  GO-LIVE-CLEANUP.sql
--
-- Clears the test data and leaves everything you configured.
--
-- ⚠  TAKE A BACKUP FIRST.
--    Supabase → Database → Backups → confirm one exists TODAY.
--    This deletes rows permanently. There is no undo.
--
-- Runs in one transaction: if anything fails, nothing is deleted.
--
-- It skips tables that are not in your database rather than stopping.
-- Not every migration has been run here, so a fixed list of tables was
-- the wrong tool — this asks the database what exists and works with
-- the answer.
-- =====================================================================

-- ---------------------------------------------------------------------
-- DELETED — the day-to-day records
--   tasks and everything hanging off them
--   purchase orders, their items, photos and history
--   PFD days, notifications, day marks
--   stock movements, godown records, stock balances
--   sales figures, sync history
--   order and task numbering, so both start again at 1
--
-- KEPT — everything you set up
--   profiles, roles, role permissions, permissions
--   departments and their members
--   entities, shops, branches, salesmen
--   suppliers, items
--   purchase types, purchasers, purchase targets and their history
--   recurring task schedules and their checklists
--   performance weights, settings
-- ---------------------------------------------------------------------

do $$
declare
  -- order matters where a table is not set to cascade
  wipe text[] := array[
    'task_day_marks', 'task_steps', 'task_notes', 'task_checklist',
    'task_departments', 'task_attachments', 'task_events', 'task_mrf', 'tasks',
    'pfd_days', 'notifications',
    'po_item_allocations', 'po_item_photos', 'po_confirmations',
    'po_history', 'po_items', 'purchase_orders',
    'stock_movements', 'godown_purchases', 'godown_stock', 'stock_balance',
    'sales_item_daily', 'sales_salesman_daily', 'sales_daily',
    'sync_log', 'sync_state',
    'po_counters', 'task_counter'
  ];
  t text;
  n bigint;
  done text[] := '{}';
  skipped text[] := '{}';
begin
  foreach t in array wipe loop
    -- to_regclass returns null rather than raising when it is not there
    if to_regclass('public.' || t) is null then
      skipped := skipped || t;
      continue;
    end if;

    execute format('delete from public.%I', t);
    get diagnostics n = row_count;
    done := done || (t || ' (' || n || ')');
  end loop;

  -- schedules are kept, but their run dates are cleared so the first
  -- generation happens from today rather than trying to catch up on
  -- dates that passed during testing
  if to_regclass('public.task_schedules') is not null then
    execute 'update public.task_schedules set last_run = null, next_run = null';
  end if;

  raise notice 'Cleared: %', array_to_string(done, ', ');
  if array_length(skipped, 1) is not null then
    raise notice 'Not in this database, skipped: %', array_to_string(skipped, ', ');
  end if;
end $$;

-- =====================================================================
-- CHECK IT DID WHAT YOU EXPECTED
-- =====================================================================

select 'SHOULD BE ZERO' as section, '' as table_name, null::bigint as rows
union all select '', 'tasks',              (select count(*) from tasks)
union all select '', 'purchase_orders',    (select count(*) from purchase_orders)
union all select '', 'notifications',      (select count(*) from notifications)
union all select 'SHOULD MATCH YOUR SETUP', '', null
union all select '', 'profiles',           (select count(*) from profiles)
union all select '', 'departments',        (select count(*) from departments)
union all select '', 'department_members', (select count(*) from department_members)
union all select '', 'roles',              (select count(*) from roles)
union all select '', 'role_permissions',   (select count(*) from role_permissions)
union all select '', 'suppliers',          (select count(*) from suppliers)
union all select '', 'items',              (select count(*) from items)
union all select '', 'shops',              (select count(*) from shops)
union all select '', 'entities',           (select count(*) from entities)
union all select '', 'task_schedules',     (select count(*) from task_schedules);

-- =====================================================================
-- FILES ARE NOT DELETED BY THIS
--
-- Photos, voice notes and PDFs live in storage. The rows pointing at
-- them are gone, so nothing shows in the app, but the files remain and
-- you are still paying for them.
--
-- Supabase → Storage → open each bucket → select all → delete:
--   task-media   task photos and voice notes
--   po-pdfs      order PDFs, EOD and PFD reports
--
-- Do this only after you are happy the cleanup worked.
-- =====================================================================
