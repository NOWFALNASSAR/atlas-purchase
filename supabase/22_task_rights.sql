-- =====================================================================
-- ATLAS  |  22_task_rights.sql
--
-- One new right, for the Recurring tasks screen.
-- Run after 21_tasks_v2.sql. Safe to re-run.
-- =====================================================================

insert into permissions (code, module, label, hint, sort_order) values
  ('tasks.schedules', 'tasks', 'Recurring tasks',
   'Set up jobs that come round on their own, like the monthly P&L', 350)
on conflict (code) do update
  set module = excluded.module, label = excluded.label,
      hint = excluded.hint, sort_order = excluded.sort_order, active = true;

-- HOD gets it by default. Admin and MD Office always have everything.
-- Give it to anyone else on Masters → Users, Rights tab.
insert into role_permissions (role, permission_code)
values ('hod', 'tasks.schedules')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Writing a schedule is still restricted at the database level to MD
-- Office and admin, from 21_tasks_v2.sql. The right above controls who
-- can SEE the screen. If you want a HOD to actually create schedules,
-- add them to MD Office under department members, or widen the policy:
--
--   drop policy if exists write_schedules on task_schedules;
--   create policy write_schedules on task_schedules for all to authenticated
--     using (has_perm('tasks.schedules')) with check (has_perm('tasks.schedules'));
--
-- Do that only if you are comfortable that anyone with the right should
-- be able to create work for other departments automatically.
-- ---------------------------------------------------------------------
