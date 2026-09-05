-- =====================================================================
-- ATLAS  |  34_task_scope_repair.sql
--
-- FIXES: function sees_all_tasks() does not exist
--
-- Migration 30 was never run, so these were missing:
--
--   sees_all_tasks()    who sees every task
--   can_see_task()      the shared visibility check
--   can_work_task()     the shared "may act on it" check
--   can_edit_task()     the shared "may change it" check
--   edit_task()         used by the Manage screen
--   reschedule_task()   used by the Manage screen
--   read_tasks policy   admins seeing everything
--
-- This is migration 30 with one correction already applied: admin does
-- NOT get edit rights. Running the original 30 now would have undone
-- the change migration 31 made, and handed editing back to admin.
--
-- Run this INSTEAD of 30. Then run 33_pfd.sql.
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ONE ANSWER TO "CAN THIS PERSON SEE EVERYTHING"
-- ---------------------------------------------------------------------

create or replace function sees_all_tasks() returns boolean
language sql stable security definer set search_path = public as $$
  select am_md_office() or my_role() = 'admin'
$$;

grant execute on function sees_all_tasks() to authenticated;

-- ---------------------------------------------------------------------
-- 2. WHO SEES WHAT
--
-- Your own department's work, plus anything you raised or were named
-- on. Nothing else. Admin and MD Office see the lot.
-- ---------------------------------------------------------------------

drop policy if exists read_tasks on tasks;
create policy read_tasks on tasks for select to authenticated
  using (raised_by     = auth.uid()
      or assigned_to   = auth.uid()
      or from_dept     = any (my_departments())
      or to_dept       = any (my_departments())
      or disputed_from = any (my_departments())
      or is_task_support(id)
      or sees_all_tasks());

create or replace function can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
     where t.id = p_task
       and (   t.raised_by     = auth.uid()
            or t.assigned_to   = auth.uid()
            or t.from_dept     = any (my_departments())
            or t.to_dept       = any (my_departments())
            or t.disputed_from = any (my_departments())
            or exists (select 1 from task_departments td
                        where td.task_id = t.id
                          and td.department_id = any (my_departments()))
            or sees_all_tasks()))
$$;

create or replace function can_work_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
     where t.id = p_task
       and (   t.from_dept = any (my_departments())
            or t.to_dept   = any (my_departments())
            or t.raised_by = auth.uid()
            or t.assigned_to = auth.uid()
            or exists (select 1 from task_departments td
                        where td.task_id = t.id
                          and td.department_id = any (my_departments()))
            or sees_all_tasks()))
$$;

-- ---------------------------------------------------------------------
-- 3. CHANGING A TASK
--
-- can_work_task covers adding a note, ticking a sub-point, attaching a
-- photo — the things the people doing the work need. Editing the task
-- itself is separate and needs the right.
-- ---------------------------------------------------------------------

/* Note the difference from the original migration 30: admin is NOT
   here. Section 3 of the specification is explicit that admin monitors
   and MD Office modifies, and migration 31 already made that change.
   Repeating 30's version would have quietly undone it. */
create or replace function can_edit_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select am_md_office() or has_perm('tasks.edit')
$$;

grant execute on function can_edit_task(uuid) to authenticated;

drop policy if exists update_own_task on tasks;
create policy update_own_task on tasks for update to authenticated
  using (can_edit_task(id)) with check (can_edit_task(id));

-- ---------------------------------------------------------------------
-- 4. EDITING, PROPERLY, WITH A TRAIL
--
-- A silent edit to a task somebody is being measured on is worse than
-- no edit. Every change is written into the history with what changed.
-- ---------------------------------------------------------------------

create or replace function edit_task(
  p_task     uuid,
  p_title    text default null,
  p_details  text default null,
  p_priority text default null,
  p_due      date default null,
  p_assigned uuid default null,
  p_note     text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_name text;
  changes text[] := '{}';
begin
  if not can_edit_task(p_task) then
    raise exception 'Only MD Office or an admin can change a task. Add a note instead.';
  end if;

  select * into t from tasks where id = p_task;
  if t.id is null then raise exception 'No such task'; end if;
  if t.status in ('verified','cancelled') then
    raise exception 'This task is closed';
  end if;

  if p_title    is not null and p_title    is distinct from t.title then
    changes := changes || ('title: ' || t.title || ' → ' || p_title); end if;
  if p_priority is not null and p_priority is distinct from t.priority then
    changes := changes || ('priority: ' || t.priority || ' → ' || p_priority); end if;
  if p_due      is not null and p_due      is distinct from t.due_date then
    changes := changes || ('needed by: ' || coalesce(t.due_date::text,'none')
                           || ' → ' || p_due::text); end if;
  if p_details  is not null and p_details  is distinct from t.details then
    changes := changes || 'details changed'; end if;
  if p_assigned is not null and p_assigned is distinct from t.assigned_to then
    changes := changes || 'person changed'; end if;

  update tasks
     set title       = coalesce(p_title, title),
         details     = coalesce(p_details, details),
         priority    = coalesce(p_priority, priority),
         due_date    = coalesce(p_due, due_date),
         assigned_to = coalesce(p_assigned, assigned_to),
         updated_at  = now()
   where id = p_task;

  if array_length(changes, 1) is null and coalesce(trim(p_note),'') = '' then
    return;   -- nothing actually changed
  end if;

  select full_name into v_name from profiles where id = auth.uid();

  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'edited', t.status, t.status,
          coalesce(nullif(trim(p_note), '') || ' — ', '') ||
          coalesce(array_to_string(changes, '; '), 'no field changes'),
          v_name);
end $$;

grant execute on function edit_task(uuid, text, text, text, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. RESCHEDULING
--
-- Moving the promised finish date is the change most worth recording,
-- because it is the one that quietly turns a late task into an on-time
-- one. It gets its own function and its own history line.
-- ---------------------------------------------------------------------

create or replace function reschedule_task(
  p_task uuid, p_start date, p_finish date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_name text;
begin
  if not can_edit_task(p_task) then
    raise exception 'Only MD Office or an admin can move the dates';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'Say why the dates are moving';
  end if;

  select * into t from tasks where id = p_task;
  if t.id is null then raise exception 'No such task'; end if;
  if p_finish < p_start then raise exception 'Finish cannot be before start'; end if;

  select full_name into v_name from profiles where id = auth.uid();

  update tasks
     set planned_start  = p_start,
         planned_finish = p_finish,
         updated_at     = now()
   where id = p_task;

  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'rescheduled', t.status, t.status,
          'finish ' || coalesce(t.planned_finish::text, 'not set')
          || ' → ' || p_finish::text || '. ' || p_reason,
          v_name);
end $$;

grant execute on function reschedule_task(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------
--   select sees_all_tasks();
--   select count(*) from tasks;        -- as an executive: their own only
-- ---------------------------------------------------------------------
