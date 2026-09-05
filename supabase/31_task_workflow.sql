-- =====================================================================
-- ATLAS  |  31_task_workflow.sql
--
-- Phase 1 of the specification. Four things, all in the database so
-- they hold whatever the screen does:
--
--   §3   Admin monitors, MD Office modifies
--   §11  Step-by-step progress updates
--   §12  Photo or voice evidence before a task can be marked done
--   §39  Full recurrence — daily, weekly, monthly, quarterly, yearly
--
-- Run after 30. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. §3 — ADMIN IS A MONITORING ROLE
--
-- Correcting something from migration 30, where admin could edit and
-- cancel. The specification is explicit that admin sees everything and
-- changes nothing: editing, cancelling and reassigning stay with MD
-- Office.
--
-- Admin keeps full VISIBILITY — sees_all_tasks is unchanged.
-- ---------------------------------------------------------------------

create or replace function can_edit_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select am_md_office() or has_perm('tasks.edit')
$$;

-- The right still exists, so you can hand editing to a specific person
-- on Masters → Users if you ever need to. It is granted to nobody by
-- default, and admin no longer gets it automatically.
delete from role_permissions
 where permission_code in ('tasks.edit', 'tasks.cancel', 'tasks.reassign');

-- ---------------------------------------------------------------------
-- 2. §11 — STEP-BY-STEP PROGRESS
--
-- A sub-point is a plan written when the task is raised. A step is what
-- actually happened, written as the work goes along. Both are needed:
-- the first says what was asked for, the second says what was done.
-- ---------------------------------------------------------------------

create table if not exists task_steps (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references tasks(id) on delete cascade,
  seq          int  not null,
  note         text not null,
  status       text not null default 'completed'
               check (status in ('completed','in_progress','blocked')),
  by_profile   uuid references profiles(id) default auth.uid(),
  by_dept      uuid references departments(id),
  attachment   uuid references task_attachments(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_steps_task on task_steps (task_id, seq);

alter table task_steps enable row level security;

drop policy if exists read_steps on task_steps;
create policy read_steps on task_steps for select to authenticated
  using (can_see_task(task_id));

drop policy if exists write_steps on task_steps;
create policy write_steps on task_steps for all to authenticated
  using (can_work_task(task_id)) with check (can_work_task(task_id));

create or replace function add_task_step(
  p_task uuid, p_note text, p_status text default 'completed',
  p_attachment uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_seq int; v_dept uuid; v_id uuid; v_name text;
begin
  if not can_work_task(p_task) then
    raise exception 'This task is not yours to update';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Say what was done';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq from task_steps where task_id = p_task;
  select to_dept into v_dept from tasks where id = p_task;
  select full_name into v_name from profiles where id = auth.uid();

  insert into task_steps (task_id, seq, note, status, by_dept, attachment)
  values (p_task, v_seq, trim(p_note), p_status, v_dept, p_attachment)
  returning id into v_id;

  -- a step means work has started
  update tasks
     set status = case when status = 'acknowledged' then 'in_progress' else status end,
         started_at = coalesce(started_at, now()),
         actual_start = coalesce(actual_start, current_date),
         updated_at = now()
   where id = p_task and status in ('acknowledged','in_progress');

  insert into task_events (task_id, action, note, actor_name)
  values (p_task, 'step_' || p_status, 'Step ' || v_seq || ': ' || trim(p_note), v_name);

  return v_id;
end $$;

grant execute on function add_task_step(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. §12 — EVIDENCE BEFORE DONE
--
-- Enforced here rather than in the screen. A hidden button is a
-- suggestion; a database rule is a rule. Someone calling the API
-- directly gets the same refusal.
-- ---------------------------------------------------------------------

create or replace function task_has_evidence(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from task_attachments
     where task_id = p_task and kind in ('photo', 'voice'))
$$;

grant execute on function task_has_evidence(uuid) to authenticated;

create or replace function complete_task(p_task uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_to uuid; v_name text; v_status text;
begin
  select to_dept, status into v_to, v_status from tasks
   where id = p_task and status in ('acknowledged','in_progress');
  if not found then raise exception 'This task is not open'; end if;

  if not (v_to = any(my_departments()) or am_md_office()) then
    raise exception 'Only the receiving department can complete this task';
  end if;

  if not task_has_evidence(p_task) then
    raise exception 'Add a photo or a voice note before marking this done';
  end if;

  select full_name into v_name from profiles where id = auth.uid();

  update tasks set status = 'completed', actual_finish = current_date,
    actual_start = coalesce(actual_start, current_date),
    completed_at = now(), updated_at = now() where id = p_task;

  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'completed', v_status, 'completed', p_note, v_name);
end $$;

-- ---------------------------------------------------------------------
-- 4. §39 — EVERY RECURRENCE PATTERN
--
-- Was monthly-on-a-day and every-N-days. Now daily, weekly, monthly,
-- quarterly, yearly and custom, which covers the daily cash report, the
-- weekly outstanding review and the yearly audit alike.
-- ---------------------------------------------------------------------

alter table task_schedules add column if not exists day_of_week  int check (day_of_week between 0 and 6);
alter table task_schedules add column if not exists month_of_year int check (month_of_year between 1 and 12);
alter table task_schedules add column if not exists starts_on    date;
alter table task_schedules add column if not exists ends_on      date;

alter table task_schedules drop constraint if exists task_schedules_frequency_check;
alter table task_schedules add constraint task_schedules_frequency_check
  check (frequency in ('daily','weekly','monthly','quarterly','yearly','interval'));

create or replace function schedule_next_date(
  p_freq text, p_dom int, p_every int, p_from date,
  p_dow int default null, p_moy int default null)
returns date language plpgsql immutable as $$
declare v date; m int;
begin
  case p_freq

    when 'daily' then
      return p_from + 1;

    when 'weekly' then
      -- next occurrence of that weekday, never today
      v := p_from + 1;
      while extract(dow from v)::int <> coalesce(p_dow, 1) loop
        v := v + 1;
      end loop;
      return v;

    when 'monthly' then
      v := date_trunc('month', p_from)::date + (coalesce(p_dom, 1) - 1);
      if v <= p_from then
        v := (date_trunc('month', p_from) + interval '1 month')::date
             + (coalesce(p_dom, 1) - 1);
      end if;
      return v;

    when 'quarterly' then
      -- first month of the next quarter that has not yet passed
      v := date_trunc('quarter', p_from)::date + (coalesce(p_dom, 1) - 1);
      if v <= p_from then
        v := (date_trunc('quarter', p_from) + interval '3 months')::date
             + (coalesce(p_dom, 1) - 1);
      end if;
      return v;

    when 'yearly' then
      m := coalesce(p_moy, 1);
      v := make_date(extract(year from p_from)::int, m, coalesce(p_dom, 1));
      if v <= p_from then
        v := make_date(extract(year from p_from)::int + 1, m, coalesce(p_dom, 1));
      end if;
      return v;

    else   -- 'interval'
      return p_from + coalesce(p_every, 1);

  end case;
end $$;

-- the generator has to pass the two new columns through
create or replace function run_task_schedules()
returns int language plpgsql security definer set search_path = public as $$
declare
  s record; v_dept uuid; v_task uuid; v_made int := 0; v_due date;
begin
  for s in select * from task_schedules where active loop

    -- not started yet, or finished
    continue when s.starts_on is not null and current_date < s.starts_on;
    continue when s.ends_on   is not null and current_date > s.ends_on;

    if s.next_run is null then
      update task_schedules
         set next_run = schedule_next_date(s.frequency, s.day_of_month, s.every_days,
                          coalesce(s.starts_on, current_date) - 1,
                          s.day_of_week, s.month_of_year)
       where id = s.id;
      continue;
    end if;

    continue when current_date < s.next_run - s.lead_days;

    v_due := s.next_run + s.due_in_days;

    for v_dept in
      select case when s.scope = 'each_showroom' then d.id else s.to_dept end
        from departments d
       where (s.scope = 'each_showroom' and d.kind = 'showroom' and d.active)
          or (s.scope = 'single' and d.id = s.to_dept)
    loop
      begin
        insert into tasks (title, details, from_dept, to_dept, raised_by,
                           assigned_to, priority, due_date, schedule_id, occurrence_date)
        values (s.title, s.details, s.from_dept, v_dept, s.created_by,
                s.assigned_to, s.priority, v_due, s.id, s.next_run)
        returning id into v_task;

        insert into task_checklist (task_id, sort_order, label)
        select v_task, sort_order, label
          from task_schedule_checklist where schedule_id = s.id;

        v_made := v_made + 1;
      exception when unique_violation then
        null;
      end;
    end loop;

    update task_schedules
       set last_run = s.next_run,
           next_run = schedule_next_date(s.frequency, s.day_of_month, s.every_days,
                        s.next_run, s.day_of_week, s.month_of_year)
     where id = s.id;

  end loop;

  return v_made;
end $$;

grant execute on function run_task_schedules() to authenticated;

-- ---------------------------------------------------------------------
-- 5. §7 — THE TASK TYPES THE SPECIFICATION LISTS
-- ---------------------------------------------------------------------

alter table tasks drop constraint if exists tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check
  check (task_type in ('general','purchase','sales','accounts','hr','stock',
                       'customer','marketing','maintenance','audit','report',
                       'complaint','mrf','other'));

-- ---------------------------------------------------------------------
-- 6. WHAT THE SCREENS READ
-- ---------------------------------------------------------------------

create or replace view v_task_steps as
select s.*, p.full_name as by_name, d.name as by_dept_name,
       a.kind as attachment_kind, a.path as attachment_path
  from task_steps s
  left join profiles p on p.id = s.by_profile
  left join departments d on d.id = s.by_dept
  left join task_attachments a on a.id = s.attachment;

-- ---------------------------------------------------------------------
-- CHECK
--
--   select schedule_next_date('daily',     null, null, current_date);
--   select schedule_next_date('weekly',    null, null, current_date, 1);
--   select schedule_next_date('monthly',   5,    null, current_date);
--   select schedule_next_date('quarterly', 5,    null, current_date);
--   select schedule_next_date('yearly',    1,    null, current_date, null, 4);
--
--   select task_has_evidence('<a task id>');
-- ---------------------------------------------------------------------
