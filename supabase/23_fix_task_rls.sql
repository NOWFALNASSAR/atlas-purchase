-- =====================================================================
-- ATLAS  |  23_fix_task_rls.sql
--
-- FIXES: infinite recursion detected in policy for relation "tasks"
--
-- What went wrong in 21_tasks_v2.sql:
--
--   Reading tasks            → policy checks task_departments
--   Reading task_departments → policy checks tasks
--   Reading tasks            → policy checks task_departments
--   ...
--
-- Postgres spots the loop and refuses. Both policies were correct on
-- their own; together they were a circle.
--
-- The fix is the pattern 18_tasks.sql already used for my_departments()
-- and am_md_office(): put the cross-table lookup inside a SECURITY
-- DEFINER function. Such a function runs as the table owner, so row
-- level security does not apply inside it, and the circle is broken at
-- exactly one point.
--
-- This changes WHERE the check happens, not WHAT it allows. Who can see
-- which task is unchanged.
--
-- Run after 21_tasks_v2.sql. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE TWO LOOKUPS, MOVED OUT OF THE POLICIES
-- ---------------------------------------------------------------------

-- Am I in a department that is supporting this task?
create or replace function is_task_support(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from task_departments td
     where td.task_id = p_task
       and td.department_id = any (my_departments()))
$$;

-- Am I allowed to see this task at all? One place, one answer, used by
-- every table that hangs off a task.
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
            or am_md_office()))
$$;

-- Can I act on this task — raise against it, tick it, note on it?
create or replace function can_work_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
     where t.id = p_task
       and (   t.from_dept = any (my_departments())
            or t.to_dept   = any (my_departments())
            or exists (select 1 from task_departments td
                        where td.task_id = t.id
                          and td.department_id = any (my_departments()))
            or am_md_office()))
$$;

grant execute on function is_task_support(uuid) to authenticated;
grant execute on function can_see_task(uuid)    to authenticated;
grant execute on function can_work_task(uuid)   to authenticated;

-- ---------------------------------------------------------------------
-- 2. TASKS — no longer reaches into task_departments directly
-- ---------------------------------------------------------------------

drop policy if exists read_tasks on tasks;
create policy read_tasks on tasks for select to authenticated
  using (raised_by     = auth.uid()
      or assigned_to   = auth.uid()
      or from_dept     = any (my_departments())
      or to_dept       = any (my_departments())
      or disputed_from = any (my_departments())
      or is_task_support(id)          -- definer: breaks the circle
      or am_md_office());

-- ---------------------------------------------------------------------
-- 3. EVERYTHING THAT HANGS OFF A TASK — one shared check
-- ---------------------------------------------------------------------

drop policy if exists read_task_depts on task_departments;
create policy read_task_depts on task_departments for select to authenticated
  using (department_id = any (my_departments()) or can_see_task(task_id));

drop policy if exists write_task_depts on task_departments;
create policy write_task_depts on task_departments for all to authenticated
  using (can_work_task(task_id)) with check (can_work_task(task_id));

drop policy if exists read_checklist on task_checklist;
create policy read_checklist on task_checklist for select to authenticated
  using (can_see_task(task_id));

drop policy if exists write_checklist on task_checklist;
create policy write_checklist on task_checklist for all to authenticated
  using (can_work_task(task_id)) with check (can_work_task(task_id));

drop policy if exists read_task_notes on task_notes;
create policy read_task_notes on task_notes for select to authenticated
  using (can_see_task(task_id));

drop policy if exists write_task_notes on task_notes;
create policy write_task_notes on task_notes for insert to authenticated
  with check (author_id = auth.uid() and can_work_task(task_id));

drop policy if exists read_attachments on task_attachments;
create policy read_attachments on task_attachments for select to authenticated
  using (can_see_task(task_id));

drop policy if exists write_attachments on task_attachments;
create policy write_attachments on task_attachments for all to authenticated
  using (can_work_task(task_id)) with check (can_work_task(task_id));

drop policy if exists read_events on task_events;
create policy read_events on task_events for select to authenticated
  using (can_see_task(task_id));

-- ---------------------------------------------------------------------
-- 4. tick_checklist used the old helper; point it at the new one
-- ---------------------------------------------------------------------

create or replace function tick_checklist(p_item uuid, p_done boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_task uuid;
begin
  select task_id into v_task from task_checklist where id = p_item;
  if v_task is null then raise exception 'No such sub-point'; end if;

  if not can_work_task(v_task) then
    raise exception 'This task is not yours to tick';
  end if;

  update task_checklist
     set done    = p_done,
         done_by = case when p_done then auth.uid() else null end,
         done_at = case when p_done then now() else null end,
         note    = coalesce(p_note, note)
   where id = p_item;
end $$;

-- ---------------------------------------------------------------------
-- 5. CHECK IT WORKED
--
-- Signed in as any user, this should return rows rather than an error:
--
--   select id, task_no, title, status from tasks limit 5;
--   select * from v_task_full limit 5;
--
-- If you still see a recursion error, list what is actually on the
-- table and send it to me:
--
--   select tablename, policyname, qual
--     from pg_policies
--    where tablename in ('tasks','task_departments','task_checklist',
--                        'task_notes','task_attachments','task_events')
--    order by tablename, policyname;
-- ---------------------------------------------------------------------
