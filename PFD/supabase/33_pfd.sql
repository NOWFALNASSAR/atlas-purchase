-- =====================================================================
-- ATLAS  |  33_pfd.sql
--
-- PFD — Plan For the Day.  §18, §19, §20, §23, §48
--
-- The plan is not something anybody types. It is assembled from work
-- that already exists: what is due today, what is late, what the
-- recurring schedule has just raised, what is sitting unaccepted.
-- Typing it again would guarantee it drifts from reality.
--
-- What a department DOES add each morning is one line per task saying
-- what they intend to do about it today. That is the only new
-- information, and it is the thing the EOD reads back in the evening.
--
-- Reusing task_day_marks from migration 28 rather than a second table:
-- the morning writes the intention, the evening writes the outcome, on
-- the same row for the same day.
--
-- Run after 32. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DID THE DEPARTMENT PLAN ITS DAY
--
-- Without this there is no way to tell a department that planned and
-- had nothing to do from one that never opened the screen. That
-- difference is most of what compliance means.
-- ---------------------------------------------------------------------

create table if not exists pfd_days (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  day           date not null default current_date,
  submitted_at  timestamptz,
  submitted_by  uuid references profiles(id),
  note          text,                       -- anything the department wants to add
  task_count    int not null default 0,     -- how many were on the plan
  created_at    timestamptz not null default now(),
  unique (department_id, day)
);

create index if not exists idx_pfd_day on pfd_days (day, department_id);

alter table pfd_days enable row level security;

drop policy if exists read_pfd on pfd_days;
create policy read_pfd on pfd_days for select to authenticated
  using (department_id = any (my_departments()) or sees_all_tasks());

drop policy if exists write_pfd on pfd_days;
create policy write_pfd on pfd_days for all to authenticated
  using (department_id = any (my_departments()) or sees_all_tasks())
  with check (department_id = any (my_departments()) or sees_all_tasks());

-- ---------------------------------------------------------------------
-- 2. WHAT IS ON THE PLAN
--
-- Every open task the department is answerable for, sorted into the
-- buckets §48 asks for: its own regular work, work other departments
-- have sent it, and anything already late.
-- ---------------------------------------------------------------------

create or replace view v_pfd as
select
  t.id                as task_id,
  t.task_no,
  t.title,
  t.details,
  t.status,
  t.priority,
  t.task_type,
  t.due_date,
  t.planned_finish,
  t.schedule_id,
  t.occurrence_date,

  td.id               as department_id,
  td.name             as department_name,
  td.kind             as department_kind,
  fd.name             as from_dept_name,
  ap.full_name        as assigned_to_name,
  rp.full_name        as raised_by_name,
  sc.name             as schedule_name,

  -- where it came from
  case
    when t.schedule_id is not null       then 'regular'
    when t.from_dept <> t.to_dept        then 'external'
    else                                      'own'
  end                 as source,

  -- what to do about it today
  case
    when t.due_date is not null and t.due_date < current_date          then 'overdue'
    when t.status in ('raised','reissued')                             then 'accept'
    when t.due_date = current_date                                     then 'today'
    when t.occurrence_date = current_date                              then 'today'
    when t.status = 'completed'                                        then 'review'
    when t.status = 'in_progress'                                      then 'progress'
    else                                                                    'upcoming'
  end                 as bucket,

  (t.due_date is not null and t.due_date < current_date)  as overdue,
  (current_date - t.created_at::date)                     as days_open,

  (select count(*) from task_checklist c where c.task_id = t.id)            as points,
  (select count(*) from task_checklist c where c.task_id = t.id and c.done) as points_done,
  (select count(*) from task_steps s where s.task_id = t.id)                as steps,
  task_has_evidence(t.id)                                                   as has_evidence,

  m.mark,
  m.note              as today_action

from tasks t
join departments td on td.id = t.to_dept
join departments fd on fd.id = t.from_dept
left join profiles ap on ap.id = t.assigned_to
left join profiles rp on rp.id = t.raised_by
left join task_schedules sc on sc.id = t.schedule_id
left join task_day_marks m on m.task_id = t.id and m.day = current_date
where t.status not in ('verified','cancelled');

-- ---------------------------------------------------------------------
-- 3. THE MORNING SUMMARY, PER DEPARTMENT
-- ---------------------------------------------------------------------

create or replace view v_pfd_summary as
select
  d.id as department_id, d.code, d.name, d.kind, d.whatsapp, d.sort_order,
  count(p.task_id)                                          as tasks,
  count(*) filter (where p.bucket = 'overdue')              as overdue,
  count(*) filter (where p.bucket = 'accept')               as to_accept,
  count(*) filter (where p.bucket = 'today')                as due_today,
  count(*) filter (where p.bucket = 'progress')             as in_progress,
  count(*) filter (where p.bucket = 'review')               as awaiting_review,
  count(*) filter (where p.source = 'regular')              as regular,
  count(*) filter (where p.source = 'external')             as external,
  count(*) filter (where p.mark is not null)                as planned,
  count(*) filter (where p.priority in ('high','urgent'))   as important,
  pd.submitted_at,
  sb.full_name                                              as submitted_by_name
from departments d
left join v_pfd p on p.department_id = d.id
left join pfd_days pd on pd.department_id = d.id and pd.day = current_date
left join profiles sb on sb.id = pd.submitted_by
where d.active
group by d.id, d.code, d.name, d.kind, d.whatsapp, d.sort_order,
         pd.submitted_at, sb.full_name;

-- ---------------------------------------------------------------------
-- 4. SUBMITTING THE PLAN
-- ---------------------------------------------------------------------

create or replace function submit_pfd(p_dept uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_count int; v_unplanned int;
begin
  if not (p_dept = any (my_departments()) or sees_all_tasks()) then
    raise exception 'You can only submit the plan for your own department';
  end if;

  select count(*), count(*) filter (where mark is null)
    into v_count, v_unplanned
    from v_pfd where department_id = p_dept;

  insert into pfd_days (department_id, day, submitted_at, submitted_by, note, task_count)
  values (p_dept, current_date, now(), auth.uid(), p_note, v_count)
  on conflict (department_id, day) do update
    set submitted_at = now(), submitted_by = auth.uid(),
        note = coalesce(excluded.note, pfd_days.note),
        task_count = excluded.task_count;
end $$;

grant execute on function submit_pfd(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. COMPLIANCE — WHO IS PLANNING AND WHO IS NOT
--
-- §41 asks whether departments are keeping up with what they are meant
-- to do. This answers the daily half of that.
-- ---------------------------------------------------------------------

create or replace view v_pfd_compliance as
select
  d.id as department_id, d.code, d.name, d.kind,
  count(pd.id) filter (where pd.submitted_at is not null)          as days_planned,
  count(distinct dd.day)                                           as days_counted,
  round(100.0 * count(pd.id) filter (where pd.submitted_at is not null)
        / nullif(count(distinct dd.day), 0), 1)                    as planned_pct,
  max(pd.submitted_at)                                             as last_planned
from departments d
cross join (select generate_series(current_date - 29, current_date, interval '1 day')::date as day) dd
left join pfd_days pd on pd.department_id = d.id and pd.day = dd.day
where d.active
group by d.id, d.code, d.name, d.kind;

-- ---------------------------------------------------------------------
-- 6. THE RIGHT
-- ---------------------------------------------------------------------

insert into permissions (code, module, label, hint, sort_order) values
  ('tasks.pfd', 'tasks', 'Plan for the day',
   'Open the morning plan, mark what will be done and submit it', 345)
on conflict (code) do update
  set label = excluded.label, hint = excluded.hint,
      sort_order = excluded.sort_order, active = true;

-- everyone who can see tasks can plan their day
insert into role_permissions (role, permission_code)
select r.code, 'tasks.pfd' from roles r
 where r.active and r.base_role <> 'admin'
   and exists (select 1 from role_permissions rp
                where rp.role = r.code and rp.permission_code = 'tasks.view')
on conflict do nothing;

-- ---------------------------------------------------------------------
--   select name, tasks, overdue, due_today, planned
--     from v_pfd_summary where tasks > 0 order by sort_order;
--
--   select name, planned_pct from v_pfd_compliance order by planned_pct;
-- ---------------------------------------------------------------------
