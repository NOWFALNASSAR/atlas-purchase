-- =====================================================================
-- ATLAS  |  21_tasks_v2.sql
--
-- Everything the task module was missing:
--
--   1. Showrooms take part like departments  — 10 shops, raise and receive
--   2. One responsible department, many supporting ones
--   3. Disputes go to MD Office, who reassigns with a note
--   4. Sub-points (a checklist) on every task
--   5. Notes that carry forward, so this month sees last month
--   6. Recurring tasks — P&L on the 5th, vehicles on the 10th, stock
--      check every 10 days
--   7. Notifications for the people who need to act
--   8. Department performance, raised against closed
--
-- Built on top of 18_tasks.sql. Nothing in that file is replaced, so
-- existing tasks, events and attachments carry over untouched.
--
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SHOWROOMS ARE DEPARTMENTS
--
-- A showroom raises tasks, receives tasks, has members, escalates to MD
-- Office and is measured on response time. That is the same list of
-- behaviours a department has.
--
-- So rather than build a parallel system, showrooms ARE departments,
-- marked with kind = 'showroom'. Every function, policy and view written
-- in 18_tasks.sql works on them from the moment they are inserted.
-- ---------------------------------------------------------------------

alter table departments add column if not exists kind text not null default 'department'
  check (kind in ('department', 'showroom'));

alter table departments add column if not exists shop_id uuid references shops(id);

insert into departments (code, name, kind, sort_order) values
  ('SR-PTM',  'Perinthalmanna',  'showroom', 101),
  ('SR-NLB',  'Nilambur',        'showroom', 102),
  ('SR-KDV',  'Koduvally',       'showroom', 103),
  ('SR-KDL',  'Kadakkal',        'showroom', 104),
  ('SR-KLM',  'Kollam',          'showroom', 105),
  ('SR-DSQ',  'Dandhi Square',   'showroom', 106),
  ('SR-KADS', 'KADS',            'showroom', 107),
  ('SR-MVP',  'Muvattupuzha',    'showroom', 108),
  ('SR-PBR',  'Perumbavoor',     'showroom', 109),
  ('SR-KTM',  'Kothamangalam',   'showroom', 110)
on conflict (code) do update set name = excluded.name, kind = 'showroom',
                                 sort_order = excluded.sort_order;

-- showrooms escalate to MD Office like everyone else
update departments set escalates_to = (select id from departments where code = 'MD')
 where escalates_to is null and code <> 'MD';

-- link each showroom to its shop row where the names match, so stock and
-- sales figures can be joined to it later
update departments d set shop_id = s.id
  from shops s
 where d.kind = 'showroom' and d.shop_id is null
   and lower(replace(s.name,' ','')) = lower(replace(d.name,' ',''));

-- ---------------------------------------------------------------------
-- 2. ONE RESPONSIBLE DEPARTMENT, MANY SUPPORTING
--
-- tasks.to_dept stays as it is — that is the ANSWERABLE department, and
-- every existing function already enforces that only they can accept,
-- start and complete. Supporting departments are listed separately: they
-- see the task and can add notes, but they are not on the hook for it.
-- ---------------------------------------------------------------------

create table if not exists task_departments (
  task_id       uuid not null references tasks(id) on delete cascade,
  department_id uuid not null references departments(id),
  role          text not null default 'support' check (role in ('support')),
  added_at      timestamptz not null default now(),
  primary key (task_id, department_id)
);

create index if not exists idx_td_dept on task_departments (department_id);

-- a supporting department must never also be the responsible one
create or replace function guard_support_dept()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from tasks where id = new.task_id and to_dept = new.department_id) then
    raise exception 'That department is already the responsible one';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_support_dept on task_departments;
create trigger trg_guard_support_dept before insert on task_departments
  for each row execute function guard_support_dept();

-- which departments can see a task: responsible + supporting
create or replace function task_visible_depts(p_task uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d), '{}') from (
    select to_dept as d from tasks where id = p_task
    union
    select from_dept from tasks where id = p_task
    union
    select department_id from task_departments where task_id = p_task
  ) s where d is not null
$$;

-- ---------------------------------------------------------------------
-- 3. SUB-POINTS
--
-- Most real tasks are a list, not a sentence. "Inventory check" is
-- twelve things. Ticking them one by one is how you know the work was
-- actually done rather than merely marked complete.
-- ---------------------------------------------------------------------

create table if not exists task_checklist (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  sort_order  int not null default 0,
  label       text not null,
  done        boolean not null default false,
  done_by     uuid references profiles(id),
  done_at     timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_tc_task on task_checklist (task_id, sort_order);

create or replace function tick_checklist(p_item uuid, p_done boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_task uuid;
begin
  select task_id into v_task from task_checklist where id = p_item;
  if v_task is null then raise exception 'No such sub-point'; end if;

  if not (exists (select 1 from unnest(task_visible_depts(v_task)) x
                   where x = any(my_departments())) or am_md_office()) then
    raise exception 'This task is not yours to tick';
  end if;

  update task_checklist
     set done = p_done,
         done_by = case when p_done then auth.uid() else null end,
         done_at = case when p_done then now() else null end,
         note = coalesce(p_note, note)
   where id = p_item;
end $$;

-- ---------------------------------------------------------------------
-- 4. NOTES, AND SEEING WHAT HAPPENED LAST TIME
--
-- The point of a monthly task is the memory. Whoever does the P&L on the
-- 5th of next month needs to read what was written on the 5th of this
-- month. Notes are attached to the task; the view below reaches back
-- through the schedule to the previous occurrence.
-- ---------------------------------------------------------------------

create table if not exists task_notes (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  note       text not null,
  author_id  uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_tn_task on task_notes (task_id, created_at desc);

-- ---------------------------------------------------------------------
-- 5. RECURRING TASKS
--
-- "P&L on the 5th of every month, Accounts."
-- "Vehicle inspection on the 10th, Transport."
-- "Inventory check every 10 days, Inventory, at each showroom."
--
-- A schedule is a template. A generated task is an ordinary task with a
-- schedule_id, so everything downstream — the workflow, the reports, the
-- performance figures — treats it exactly like any other task.
-- ---------------------------------------------------------------------

create table if not exists task_schedules (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                    -- 'Monthly P&L'
  title         text not null,                    -- becomes the task title
  details       text,
  from_dept     uuid not null references departments(id),   -- who is asking
  to_dept       uuid not null references departments(id),   -- who answers
  assigned_to   uuid references profiles(id),
  priority      text not null default 'normal'
                check (priority in ('low','normal','high','urgent')),

  -- 'monthly'  : on day_of_month
  -- 'interval' : every every_days days
  frequency     text not null check (frequency in ('monthly','interval')),
  day_of_month  int check (day_of_month between 1 and 28),
  every_days    int check (every_days between 1 and 365),

  due_in_days   int not null default 3,           -- days from raise to due
  lead_days     int not null default 0,           -- raise it this early

  -- when 'each showroom', one task is generated per showroom
  scope         text not null default 'single' check (scope in ('single','each_showroom')),

  active        boolean not null default true,
  last_run      date,
  next_run      date,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create table if not exists task_schedule_checklist (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references task_schedules(id) on delete cascade,
  sort_order  int not null default 0,
  label       text not null
);

alter table tasks add column if not exists schedule_id uuid references task_schedules(id);
alter table tasks add column if not exists occurrence_date date;

create index if not exists idx_tasks_schedule on tasks (schedule_id, occurrence_date desc);

-- ---------- when is this schedule next due -------------------------------

create or replace function schedule_next_date(p_freq text, p_dom int, p_every int, p_from date)
returns date language plpgsql immutable as $$
declare v date;
begin
  if p_freq = 'monthly' then
    v := date_trunc('month', p_from)::date + (p_dom - 1);
    if v <= p_from then
      v := (date_trunc('month', p_from) + interval '1 month')::date + (p_dom - 1);
    end if;
    return v;
  else
    return p_from + p_every;
  end if;
end $$;

-- ---------- generate whatever is due -------------------------------------
-- Idempotent: running it twice on the same day creates nothing extra,
-- because of the unique index below.

create unique index if not exists uq_task_occurrence
  on tasks (schedule_id, occurrence_date, to_dept)
  where schedule_id is not null;

create or replace function run_task_schedules()
returns int language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_dept uuid;
  v_task uuid;
  v_made int := 0;
  v_due date;
begin
  for s in select * from task_schedules where active loop

    -- first ever run: work out the next date from today
    if s.next_run is null then
      update task_schedules
         set next_run = schedule_next_date(s.frequency, s.day_of_month, s.every_days, current_date - 1)
       where id = s.id;
      continue;
    end if;

    -- not due yet, allowing for the lead time
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
                           assigned_to, priority, due_date,
                           schedule_id, occurrence_date)
        values (s.title, s.details, s.from_dept, v_dept, s.created_by,
                s.assigned_to, s.priority, v_due,
                s.id, s.next_run)
        returning id into v_task;

        insert into task_checklist (task_id, sort_order, label)
        select v_task, sort_order, label
          from task_schedule_checklist where schedule_id = s.id;

        v_made := v_made + 1;
      exception when unique_violation then
        -- already generated for this date and department
        null;
      end;
    end loop;

    update task_schedules
       set last_run = s.next_run,
           next_run = schedule_next_date(s.frequency, s.day_of_month, s.every_days, s.next_run)
     where id = s.id;

  end loop;

  return v_made;
end $$;

-- ---------------------------------------------------------------------
-- 6. DISPUTES — "this is not our job"
--
-- A department that believes a task belongs elsewhere does not simply
-- ignore it. They dispute it, with a reason. The task moves to MD Office,
-- who decides and reassigns with a note. Nothing is ever left in limbo,
-- and the argument is on the record.
-- ---------------------------------------------------------------------

alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('raised','acknowledged','in_progress','completed',
                    'verified','reissued','cancelled','disputed'));

alter table tasks add column if not exists disputed_from uuid references departments(id);
alter table tasks add column if not exists dispute_note text;
alter table tasks add column if not exists dispute_count int not null default 0;

create or replace function dispute_task(p_task uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_to uuid; v_md uuid; v_name text; v_status text;
begin
  select to_dept, status into v_to, v_status from tasks where id = p_task;
  if v_to is null then raise exception 'No such task'; end if;
  if v_status in ('verified','cancelled') then
    raise exception 'This task is already closed';
  end if;
  if not (v_to = any(my_departments()) or am_md_office()) then
    raise exception 'Only the department holding this task can dispute it';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'Say why this is not your department''s work';
  end if;

  select id into v_md from departments where is_md_office limit 1;
  select full_name into v_name from profiles where id = auth.uid();

  update tasks
     set status = 'disputed',
         disputed_from = v_to,
         to_dept = v_md,
         dispute_note = p_reason,
         dispute_count = dispute_count + 1,
         acknowledged_at = null, started_at = null,
         updated_at = now()
   where id = p_task;

  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'disputed', v_status, 'disputed', p_reason, v_name);
end $$;

-- MD Office settles it
create or replace function md_assign_task(p_task uuid, p_dept uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_old text;
begin
  if not am_md_office() then
    raise exception 'Only MD Office can settle a disputed task';
  end if;
  if coalesce(trim(p_note),'') = '' then
    raise exception 'Add a note saying why it goes to this department';
  end if;

  select status into v_old from tasks where id = p_task;
  select full_name into v_name from profiles where id = auth.uid();

  update tasks
     set to_dept = p_dept, status = 'raised',
         acknowledged_at = null, started_at = null,
         updated_at = now()
   where id = p_task;

  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'reassigned', v_old, 'raised',
          p_note || ' — assigned by MD Office', v_name);
end $$;

-- ---------------------------------------------------------------------
-- 7. NOTIFICATIONS
--
-- In-app only. WhatsApp needs the Business API and Meta template
-- approval, which is a separate job — see part 10 of the README.
-- ---------------------------------------------------------------------

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  kind        text not null,             -- task_new | task_due | task_done ...
  title       text not null,
  body        text,
  link        text,                      -- '/tasks/<id>'
  task_id     uuid references tasks(id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notif_person
  on notifications (profile_id, read_at, created_at desc);

-- tell everyone in a department, plus one named person
create or replace function notify_dept(
  p_dept uuid, p_person uuid, p_kind text, p_title text, p_body text, p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (profile_id, kind, title, body, link, task_id)
  select distinct m.profile_id, p_kind, p_title, p_body, '/tasks/' || p_task, p_task
    from department_members m
   where m.department_id = p_dept and m.active
     and m.profile_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  if p_person is not null then
    insert into notifications (profile_id, kind, title, body, link, task_id)
    select p_person, p_kind, p_title, p_body, '/tasks/' || p_task, p_task
    where not exists (
      select 1 from department_members
       where department_id = p_dept and profile_id = p_person and active);
  end if;
end $$;

create or replace function notify_on_task_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_to text; v_raiser uuid;
begin
  select name into v_to from departments where id = new.to_dept;

  if tg_op = 'INSERT' then
    perform notify_dept(new.to_dept, new.assigned_to, 'task_new',
      'New task: ' || new.title,
      case when new.due_date is null then null
           else 'Due ' || to_char(new.due_date, 'DD Mon') end,
      new.id);
    return new;
  end if;

  if new.status is distinct from old.status then
    -- the department now holding it
    if new.status in ('raised','reissued','disputed') then
      perform notify_dept(new.to_dept, new.assigned_to, 'task_' || new.status,
        case new.status when 'disputed' then 'Disputed: ' else 'Task: ' end || new.title,
        new.dispute_note, new.id);
    end if;

    -- and the department that asked for it
    if new.status in ('completed','verified') then
      perform notify_dept(new.from_dept, new.raised_by, 'task_' || new.status,
        (case new.status when 'completed' then 'Completed by ' else 'Closed: ' end)
          || coalesce(v_to, '') || ' — ' || new.title,
        null, new.id);
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_notify_task_insert on tasks;
create trigger trg_notify_task_insert after insert on tasks
  for each row execute function notify_on_task_change();

drop trigger if exists trg_notify_task_update on tasks;
create trigger trg_notify_task_update after update on tasks
  for each row execute function notify_on_task_change();

create or replace function mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where profile_id = auth.uid() and read_at is null
     and (p_ids is null or id = any(p_ids));
$$;

-- ---------------------------------------------------------------------
-- 8. SECURITY FOR THE NEW TABLES
-- ---------------------------------------------------------------------

alter table task_departments        enable row level security;
alter table task_checklist          enable row level security;
alter table task_notes              enable row level security;
alter table task_schedules          enable row level security;
alter table task_schedule_checklist enable row level security;
alter table notifications           enable row level security;

drop policy if exists read_task_depts on task_departments;
create policy read_task_depts on task_departments for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and (
      t.raised_by = auth.uid() or t.from_dept = any(my_departments())
      or t.to_dept = any(my_departments()) or am_md_office()))
     or department_id = any(my_departments()));

drop policy if exists write_task_depts on task_departments;
create policy write_task_depts on task_departments for all to authenticated
  using (exists (select 1 from tasks t where t.id = task_id
                  and (t.from_dept = any(my_departments()) or am_md_office())))
  with check (exists (select 1 from tasks t where t.id = task_id
                  and (t.from_dept = any(my_departments()) or am_md_office())));

drop policy if exists read_checklist on task_checklist;
create policy read_checklist on task_checklist for select to authenticated
  using (exists (select 1 from unnest(task_visible_depts(task_id)) x
                  where x = any(my_departments())) or am_md_office());

drop policy if exists write_checklist on task_checklist;
create policy write_checklist on task_checklist for all to authenticated
  using (exists (select 1 from unnest(task_visible_depts(task_id)) x
                  where x = any(my_departments())) or am_md_office())
  with check (exists (select 1 from unnest(task_visible_depts(task_id)) x
                  where x = any(my_departments())) or am_md_office());

drop policy if exists read_task_notes on task_notes;
create policy read_task_notes on task_notes for select to authenticated
  using (exists (select 1 from unnest(task_visible_depts(task_id)) x
                  where x = any(my_departments())) or am_md_office());

drop policy if exists write_task_notes on task_notes;
create policy write_task_notes on task_notes for insert to authenticated
  with check (author_id = auth.uid()
     and (exists (select 1 from unnest(task_visible_depts(task_id)) x
                   where x = any(my_departments())) or am_md_office()));

drop policy if exists read_schedules on task_schedules;
create policy read_schedules on task_schedules for select to authenticated using (true);

drop policy if exists write_schedules on task_schedules;
create policy write_schedules on task_schedules for all to authenticated
  using (am_md_office() or my_role() = 'admin')
  with check (am_md_office() or my_role() = 'admin');

drop policy if exists read_sched_checklist on task_schedule_checklist;
create policy read_sched_checklist on task_schedule_checklist
  for select to authenticated using (true);

drop policy if exists write_sched_checklist on task_schedule_checklist;
create policy write_sched_checklist on task_schedule_checklist for all to authenticated
  using (am_md_office() or my_role() = 'admin')
  with check (am_md_office() or my_role() = 'admin');

drop policy if exists read_own_notifications on notifications;
create policy read_own_notifications on notifications for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists update_own_notifications on notifications;
create policy update_own_notifications on notifications for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- supporting departments must be able to read the task itself
drop policy if exists read_tasks on tasks;
create policy read_tasks on tasks for select to authenticated
  using (raised_by = auth.uid()
      or assigned_to = auth.uid()
      or from_dept = any(my_departments())
      or to_dept   = any(my_departments())
      or disputed_from = any(my_departments())
      or exists (select 1 from task_departments td
                  where td.task_id = tasks.id
                    and td.department_id = any(my_departments()))
      or am_md_office());

-- ---------------------------------------------------------------------
-- 9. WHAT THE SCREENS READ
-- ---------------------------------------------------------------------

-- every task, with its people, its counts and its lateness
create or replace view v_task_full as
select
  t.*,
  fd.name as from_dept_name, fd.code as from_dept_code, fd.kind as from_dept_kind,
  td.name as to_dept_name,   td.code as to_dept_code,   td.kind as to_dept_kind,
  dd.name as disputed_from_name,
  rp.full_name as raised_by_name,
  ap.full_name as assigned_to_name,
  sc.name      as schedule_name,

  (select count(*) from task_checklist c where c.task_id = t.id)              as points,
  (select count(*) from task_checklist c where c.task_id = t.id and c.done)   as points_done,
  (select count(*) from task_notes n where n.task_id = t.id)                  as notes,
  (select count(*) from task_attachments a where a.task_id = t.id)            as attachments,
  (select coalesce(array_agg(d2.name order by d2.name), '{}')
     from task_departments x join departments d2 on d2.id = x.department_id
    where x.task_id = t.id)                                                   as support_depts,

  case when t.acknowledged_at is not null
    then round(extract(epoch from t.acknowledged_at - t.created_at)/3600.0, 1)
    else round(extract(epoch from now() - t.created_at)/3600.0, 1) end        as hours_to_ack,

  case when t.closed_at is not null
    then round(extract(epoch from t.closed_at - t.created_at)/86400.0, 1)
    else round(extract(epoch from now() - t.created_at)/86400.0, 1) end       as days_open,

  (t.acknowledged_at is null and t.status in ('raised','reissued')
     and now() - t.created_at > interval '24 hours')                          as ack_overdue,

  (t.due_date is not null and t.due_date < current_date
     and t.status not in ('completed','verified','cancelled'))                as overdue,

  (t.actual_finish is not null and t.planned_finish is not null
     and t.actual_finish > t.planned_finish)                                  as finished_late,

  (t.status in ('verified','cancelled'))                                      as is_closed

from tasks t
join departments fd on fd.id = t.from_dept
join departments td on td.id = t.to_dept
left join departments dd on dd.id = t.disputed_from
left join profiles rp on rp.id = t.raised_by
left join profiles ap on ap.id = t.assigned_to
left join task_schedules sc on sc.id = t.schedule_id;

-- what was written on this task last time round
create or replace view v_task_previous as
select
  t.id            as task_id,
  prev.id         as previous_task_id,
  prev.occurrence_date,
  prev.status     as previous_status,
  (select string_agg(n.note, E'\n' order by n.created_at)
     from task_notes n where n.task_id = prev.id) as previous_notes
from tasks t
join lateral (
  select p.* from tasks p
   where p.schedule_id = t.schedule_id
     and p.to_dept = t.to_dept
     and p.occurrence_date < t.occurrence_date
   order by p.occurrence_date desc
   limit 1
) prev on true
where t.schedule_id is not null;

-- department performance: raised against closed
create or replace view v_dept_performance as
with base as (
  select
    td.id as department_id, td.code, td.name, td.kind,
    t.id as task_id, t.status, t.created_at, t.closed_at,
    t.acknowledged_at, t.due_date, t.actual_finish, t.planned_finish,
    t.reissue_count, t.dispute_count,
    (t.status in ('verified','cancelled')) as closed,
    (t.due_date is not null and t.due_date < current_date
       and t.status not in ('completed','verified','cancelled')) as overdue,
    case when t.closed_at is not null
      then extract(epoch from t.closed_at - t.created_at)/86400.0 end as days_to_close,
    case when t.acknowledged_at is not null
      then extract(epoch from t.acknowledged_at - t.created_at)/3600.0 end as hours_to_ack
  from departments td
  left join tasks t on t.to_dept = td.id
  where td.active
)
select
  department_id, code, name, kind,
  count(task_id)                                          as received,
  count(*) filter (where closed)                          as closed,
  count(*) filter (where not closed and task_id is not null) as open,
  count(*) filter (where overdue)                         as overdue,
  count(*) filter (where status = 'disputed')             as disputed,
  sum(coalesce(reissue_count,0))                          as reissues,
  round(avg(hours_to_ack)::numeric, 1)                    as avg_hours_to_accept,
  round(avg(days_to_close)::numeric, 1)                   as avg_days_to_close,
  case when count(task_id) > 0
    then round(count(*) filter (where closed)::numeric / count(task_id) * 100, 1)
    end                                                   as closed_pct,
  count(*) filter (where actual_finish is not null and planned_finish is not null
                     and actual_finish > planned_finish)  as finished_late
from base
group by department_id, code, name, kind;

-- one row per day, for the end-of-day report
create or replace view v_task_eod as
select
  d::date as day,
  (select count(*) from tasks t where t.created_at::date = d::date)               as raised,
  (select count(*) from tasks t where t.acknowledged_at::date = d::date)          as accepted,
  (select count(*) from tasks t where t.completed_at::date = d::date)             as completed,
  (select count(*) from tasks t where t.closed_at::date = d::date)                as closed,
  (select count(*) from tasks t
    where t.due_date < d::date and t.status not in ('completed','verified','cancelled')) as overdue_at_eod
from generate_series(current_date - 60, current_date, interval '1 day') d;

-- ---------------------------------------------------------------------
-- 10. THE THREE SCHEDULES YOU ASKED FOR
--     Change or remove them on the Recurring tasks screen.
-- ---------------------------------------------------------------------

do $$
declare v_md uuid; v_acc uuid; v_inv uuid; v_ops uuid; v_sched uuid;
begin
  select id into v_md  from departments where code = 'MD';
  select id into v_acc from departments where code = 'ACC';
  select id into v_inv from departments where code = 'INV';
  select id into v_ops from departments where code = 'OPS';

  -- Profit and loss, 5th of every month, Accounts
  if not exists (select 1 from task_schedules where name = 'Monthly P&L') then
    insert into task_schedules (name, title, details, from_dept, to_dept,
                                frequency, day_of_month, due_in_days, lead_days)
    values ('Monthly P&L', 'Profit and loss statement',
            'Prepare and submit last month''s P&L to MD Office.',
            v_md, v_acc, 'monthly', 5, 3, 2)
    returning id into v_sched;

    insert into task_schedule_checklist (schedule_id, sort_order, label) values
      (v_sched, 1, 'Close last month''s ledgers'),
      (v_sched, 2, 'Reconcile bank statements'),
      (v_sched, 3, 'Branch-wise revenue and cost'),
      (v_sched, 4, 'Compare against the same month last year'),
      (v_sched, 5, 'Submit to MD Office');
  end if;

  -- Vehicle inspection, 10th of every month, Operations
  if not exists (select 1 from task_schedules where name = 'Vehicle inspection') then
    insert into task_schedules (name, title, details, from_dept, to_dept,
                                frequency, day_of_month, due_in_days, lead_days)
    values ('Vehicle inspection', 'Vehicle inspection report',
            'Inspect every vehicle and report condition, servicing due and documents.',
            v_md, coalesce(v_ops, v_md), 'monthly', 10, 3, 2)
    returning id into v_sched;

    insert into task_schedule_checklist (schedule_id, sort_order, label) values
      (v_sched, 1, 'Body and tyre condition'),
      (v_sched, 2, 'Service due, with odometer reading'),
      (v_sched, 3, 'Insurance and permit expiry dates'),
      (v_sched, 4, 'Pollution certificate'),
      (v_sched, 5, 'Photographs attached');
  end if;

  -- Inventory check, every 10 days, at every showroom
  if not exists (select 1 from task_schedules where name = 'Showroom inventory check') then
    insert into task_schedules (name, title, details, from_dept, to_dept,
                                frequency, every_days, due_in_days, scope)
    values ('Showroom inventory check', 'Inventory check',
            'Physical stock count against the system, with differences explained.',
            coalesce(v_inv, v_md), coalesce(v_inv, v_md),
            'interval', 10, 2, 'each_showroom')
    returning id into v_sched;

    insert into task_schedule_checklist (schedule_id, sort_order, label) values
      (v_sched, 1, 'Count physical stock section by section'),
      (v_sched, 2, 'Compare against system quantity'),
      (v_sched, 3, 'List every difference with the item code'),
      (v_sched, 4, 'Explain each difference'),
      (v_sched, 5, 'Damaged or soiled pieces listed separately');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 11. MAKE IT RUN EVERY DAY
--
-- Supabase includes pg_cron. Run these two statements once, in the SQL
-- Editor, and recurring tasks appear on their own at 6am India time.
--
--   create extension if not exists pg_cron;
--
--   select cron.schedule('atlas-task-schedules', '30 0 * * *',
--                        $$select run_task_schedules()$$);
--
-- 00:30 UTC is 6:00am IST. To check it is working:
--
--   select * from cron.job;
--   select run_task_schedules();          -- run it by hand any time
--
-- The app also calls run_task_schedules() when MD Office opens the
-- Recurring tasks screen, so nothing is lost if cron is not set up.
-- ---------------------------------------------------------------------

grant execute on function run_task_schedules() to authenticated;
