-- =====================================================================
-- ATLAS  |  Which migrations have actually run
--
-- Paste this into Supabase → SQL Editor whenever something says a
-- function or table "does not exist". It checks for one thing each
-- migration creates, so a "missing" row tells you exactly which file
-- to run.
--
-- Read-only. Changes nothing.
-- =====================================================================

with expected(migration, kind, object_name) as (values
  ('19_permissions',        'table',    'permissions'),
  ('19_permissions',        'function', 'my_permissions'),
  ('21_tasks_v2',           'table',    'task_schedules'),
  ('21_tasks_v2',           'table',    'task_checklist'),
  ('21_tasks_v2',           'table',    'notifications'),
  ('22_task_rights',        'other',    'tasks.schedules right'),
  ('23_fix_task_rls',       'function', 'can_see_task'),
  ('24_roles',              'table',    'roles'),
  ('25_task_reports',       'view',     'v_task_register'),
  ('26_role_scope_login',   'function', 'email_for_login'),
  ('27_no_email_login',     'function', 'admin_set_password'),
  ('28_dept_activity',      'table',    'task_mrf'),
  ('28_dept_activity',      'table',    'task_day_marks'),
  ('28_dept_activity',      'view',     'v_dept_overview'),
  ('29_mrf_report',         'view',     'v_mrf_report'),
  ('31_task_workflow',      'table',    'task_steps'),
  ('31_task_workflow',      'function', 'task_has_evidence'),
  ('34_task_scope_repair',  'function', 'sees_all_tasks'),
  ('34_task_scope_repair',  'function', 'edit_task'),
  ('33_pfd',                'table',    'pfd_days'),
  ('33_pfd',                'view',     'v_pfd')
)
select
  e.migration,
  e.kind,
  e.object_name,
  case
    when e.kind = 'function' then
      case when exists (select 1 from pg_proc p
                         join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and p.proname = e.object_name)
        then 'present' else 'MISSING — run this file' end
    when e.kind in ('table','view') then
      case when exists (select 1 from information_schema.tables
                        where table_schema = 'public' and table_name = e.object_name)
        then 'present' else 'MISSING — run this file' end
    else
      case when exists (select 1 from permissions where code = 'tasks.schedules')
        then 'present' else 'MISSING — run this file' end
  end as status
from expected e
order by e.migration, e.object_name;

-- Anything saying MISSING: run that file, in the order listed.
