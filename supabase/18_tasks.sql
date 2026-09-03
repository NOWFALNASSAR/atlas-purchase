-- =====================================================================
-- ATLAS  |  18_tasks.sql
-- Task management across departments.
--
-- A task moves through a fixed path, and every step is stamped:
--
--   raised → acknowledged → started → completed → verified → closed
--                                          ↓
--                                      reissued (back to acknowledged)
--
-- The receiving department sets its own planned dates. The raising
-- department decides whether the work is acceptable. MD Office sees
-- everything, always.
--
-- Run in Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DEPARTMENTS
-- ---------------------------------------------------------------------

create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null,
  is_md_office boolean not null default false,
  escalates_to uuid references departments(id),
  active      boolean not null default true,
  sort_order  int default 0,
  created_at  timestamptz not null default now()
);

insert into departments (code, name, is_md_office, sort_order) values
  ('MD',      'MD Office',    true,  1),
  ('ADMIN',   'Admin',        false, 2),
  ('OPS',     'Operations',   false, 3),
  ('PUR',     'Purchase',     false, 4),
  ('INV',     'Inventory',    false, 5),
  ('SALES',   'Sales',        false, 6),
  ('MKT',     'Marketing',    false, 7),
  ('SOCIAL',  'Social Media', false, 8),
  ('ACC',     'Accounts',     false, 9),
  ('AUDIT',   'Audit',        false, 10),
  ('HR',      'HR',           false, 11)
on conflict (code) do nothing;

-- everything escalates to MD Office unless told otherwise
update departments set escalates_to = (select id from departments where code = 'MD')
 where escalates_to is null and code <> 'MD';

-- ---------------------------------------------------------------------
-- 2. WHO IS IN WHICH DEPARTMENT
--    A person can sit in more than one, and can be a showroom manager
--    attached to a shop rather than a department.
-- ---------------------------------------------------------------------

create table if not exists department_members (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  post          text not null default 'executive'
                check (post in ('hod','executive','manager')),
  shop_id       uuid references shops(id),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (department_id, profile_id)
);

create index if not exists idx_dm_profile on department_members (profile_id);
create index if not exists idx_dm_dept on department_members (department_id);

-- helper: which departments am I in
create or replace function my_departments() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(department_id), '{}')
    from department_members where profile_id = auth.uid() and active
$$;

create or replace function am_md_office() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from department_members m
    join departments d on d.id = m.department_id
    where m.profile_id = auth.uid() and m.active and d.is_md_office)
$$;

create or replace function am_hod(p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from department_members
    where profile_id = auth.uid() and department_id = p_dept
      and post = 'hod' and active)
$$;

-- ---------------------------------------------------------------------
-- 3. TASKS
-- ---------------------------------------------------------------------

create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  task_no       text unique,
  title         text not null,
  details       text,
  from_dept     uuid not null references departments(id),
  to_dept       uuid not null references departments(id),
  raised_by     uuid not null references profiles(id) default auth.uid(),
  assigned_to   uuid references profiles(id),
  shop_id       uuid references shops(id),
  priority      text not null default 'normal'
                check (priority in ('low','normal','high','urgent')),
  due_date      date,

  status        text not null default 'raised'
                check (status in ('raised','acknowledged','in_progress',
                                  'completed','verified','reissued','cancelled')),

  planned_start  date,
  planned_finish date,
  actual_start   date,
  actual_finish  date,

  acknowledged_at timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  verified_at     timestamptz,
  closed_at       timestamptz,

  reissue_count int not null default 0,
  reissue_note  text,
  escalated     boolean not null default false,
  escalated_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_tasks_to on tasks (to_dept, status);
create index if not exists idx_tasks_from on tasks (from_dept, status);
create index if not exists idx_tasks_due on tasks (due_date);
create index if not exists idx_tasks_raised on tasks (raised_by);

-- ---------------------------------------------------------------------
-- 4. ATTACHMENTS — photos and voice notes
-- ---------------------------------------------------------------------

create table if not exists task_attachments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  kind        text not null check (kind in ('photo','voice','file')),
  path        text not null,
  caption     text,
  seconds     int,
  uploaded_by uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_ta_task on task_attachments (task_id);

-- ---------------------------------------------------------------------
-- 5. EVERY STEP RECORDED
-- ---------------------------------------------------------------------

create table if not exists task_events (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  action     text not null,
  note       text,
  from_status text,
  to_status  text,
  actor_id   uuid references profiles(id) default auth.uid(),
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_te_task on task_events (task_id, created_at desc);

-- ---------------------------------------------------------------------
-- 6. TASK NUMBER — TSK/26-27/00042
-- ---------------------------------------------------------------------

create table if not exists task_counter (
  fy text primary key,
  last_no int not null default 0
);

create or replace function next_task_no() returns text
language plpgsql security definer set search_path = public as $$
declare v_fy text; v_no int; y int; m int;
begin
  y := extract(year from now()); m := extract(month from now());
  if m >= 4 then v_fy := right(y::text,2) || '-' || right((y+1)::text,2);
  else            v_fy := right((y-1)::text,2) || '-' || right(y::text,2); end if;

  insert into task_counter (fy, last_no) values (v_fy, 1)
  on conflict (fy) do update set last_no = task_counter.last_no + 1
  returning last_no into v_no;

  return 'TSK/' || v_fy || '/' || lpad(v_no::text, 5, '0');
end $$;

create or replace function set_task_no()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.task_no is null then new.task_no := next_task_no(); end if;
  select full_name into v_name from profiles where id = auth.uid();
  insert into task_events (task_id, action, to_status, note, actor_name)
  values (new.id, 'raised', 'raised', new.title, v_name);
  return new;
end $$;

drop trigger if exists trg_task_no on tasks;
create trigger trg_task_no before insert on tasks
  for each row execute function set_task_no();

-- the trigger above cannot insert an event before the row exists,
-- so split it: number on before, event on after
create or replace function set_task_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.task_no is null then new.task_no := next_task_no(); end if;
  return new;
end $$;

create or replace function log_task_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select full_name into v_name from profiles where id = auth.uid();
  insert into task_events (task_id, action, to_status, note, actor_name)
  values (new.id, 'raised', 'raised', new.title, v_name);
  return null;
end $$;

drop trigger if exists trg_task_created on tasks;
create trigger trg_task_created after insert on tasks
  for each row execute function log_task_created();

-- ---------------------------------------------------------------------
-- 7. THE WORKFLOW
--    Each step lives in the database, so the rules cannot be skipped
--    by calling the API directly.
-- ---------------------------------------------------------------------

create or replace function acknowledge_task(
  p_task uuid, p_start date, p_finish date, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_to uuid; v_name text; v_status text;
begin
  select to_dept, status into v_to, v_status from tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  if v_status not in ('raised','reissued') then
    raise exception 'This task has already been accepted';
  end if;
  if not (v_to = any(my_departments()) or am_md_office()) then
    raise exception 'Only the receiving department can accept this task';
  end if;
  if p_start is null or p_finish is null then
    raise exception 'Give a planned start and finish date';
  end if;
  if p_finish < p_start then raise exception 'Finish cannot be before start'; end if;

  select full_name into v_name from profiles where id = auth.uid();

  update tasks set status = 'acknowledged', planned_start = p_start,
    planned_finish = p_finish, acknowledged_at = coalesce(acknowledged_at, now()),
    updated_at = now()
  where id = p_task;

  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'acknowledged', v_status, 'acknowledged',
          'Planned ' || p_start || ' to ' || p_finish ||
          coalesce(' — ' || p_note, ''), v_name);
end $$;

create or replace function start_task(p_task uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_to uuid; v_name text;
begin
  select to_dept into v_to from tasks where id = p_task and status = 'acknowledged';
  if not found then raise exception 'Accept the task before starting it'; end if;
  if not (v_to = any(my_departments()) or am_md_office()) then
    raise exception 'Only the receiving department can start this task';
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  update tasks set status = 'in_progress', actual_start = current_date,
    started_at = now(), updated_at = now() where id = p_task;
  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'started', 'acknowledged', 'in_progress', p_note, v_name);
end $$;

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

  select full_name into v_name from profiles where id = auth.uid();
  update tasks set status = 'completed', actual_finish = current_date,
    actual_start = coalesce(actual_start, current_date),
    completed_at = now(), updated_at = now() where id = p_task;
  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'completed', v_status, 'completed', p_note, v_name);
end $$;

create or replace function verify_task(p_task uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_from uuid; v_name text;
begin
  select from_dept into v_from from tasks where id = p_task and status = 'completed';
  if not found then raise exception 'This task is not waiting for verification'; end if;
  if not (v_from = any(my_departments()) or am_md_office()) then
    raise exception 'Only the department that raised this task can accept the work';
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  update tasks set status = 'verified', verified_at = now(),
    closed_at = now(), updated_at = now() where id = p_task;
  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'verified', 'completed', 'verified', p_note, v_name);
end $$;

create or replace function reissue_task(p_task uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_from uuid; v_name text;
begin
  select from_dept into v_from from tasks where id = p_task and status = 'completed';
  if not found then raise exception 'This task is not waiting for verification'; end if;
  if not (v_from = any(my_departments()) or am_md_office()) then
    raise exception 'Only the department that raised this task can reissue it';
  end if;
  if coalesce(trim(p_note),'') = '' then
    raise exception 'Say what is not acceptable';
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  update tasks set status = 'reissued', reissue_count = reissue_count + 1,
    reissue_note = p_note, completed_at = null, actual_finish = null,
    updated_at = now() where id = p_task;
  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'reissued', 'completed', 'reissued', p_note, v_name);
end $$;

create or replace function cancel_task(p_task uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_from uuid; v_name text;
begin
  select from_dept into v_from from tasks where id = p_task
   and status not in ('verified','cancelled');
  if not found then raise exception 'This task cannot be cancelled'; end if;
  if not (v_from = any(my_departments()) or am_md_office()) then
    raise exception 'Only the raising department can cancel';
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  update tasks set status = 'cancelled', closed_at = now(), updated_at = now()
   where id = p_task;
  insert into task_events (task_id, action, to_status, note, actor_name)
  values (p_task, 'cancelled', 'cancelled', p_note, v_name);
end $$;

-- ---------------------------------------------------------------------
-- 8. SECURITY
--    You see a task if you raised it, if it is addressed to your
--    department, or if you are MD Office.
-- ---------------------------------------------------------------------

alter table departments        enable row level security;
alter table department_members enable row level security;
alter table tasks              enable row level security;
alter table task_attachments   enable row level security;
alter table task_events        enable row level security;

drop policy if exists read_departments on departments;
create policy read_departments on departments for select to authenticated using (true);

drop policy if exists admin_departments on departments;
create policy admin_departments on departments for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists read_members on department_members;
create policy read_members on department_members for select to authenticated using (true);

drop policy if exists admin_members on department_members;
create policy admin_members on department_members for all to authenticated
  using (my_role() = 'admin' or am_md_office())
  with check (my_role() = 'admin' or am_md_office());

drop policy if exists read_tasks on tasks;
create policy read_tasks on tasks for select to authenticated
  using (raised_by = auth.uid()
      or assigned_to = auth.uid()
      or from_dept = any(my_departments())
      or to_dept   = any(my_departments())
      or am_md_office());

drop policy if exists create_tasks on tasks;
create policy create_tasks on tasks for insert to authenticated
  with check (raised_by = auth.uid() and from_dept = any(my_departments()));

drop policy if exists update_own_task on tasks;
create policy update_own_task on tasks for update to authenticated
  using (raised_by = auth.uid() and status in ('raised','reissued'))
  with check (raised_by = auth.uid());

drop policy if exists read_attachments on task_attachments;
create policy read_attachments on task_attachments for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and (
      t.raised_by = auth.uid() or t.from_dept = any(my_departments())
      or t.to_dept = any(my_departments()) or am_md_office())));

drop policy if exists write_attachments on task_attachments;
create policy write_attachments on task_attachments for all to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and (
      t.from_dept = any(my_departments()) or t.to_dept = any(my_departments())
      or am_md_office())))
  with check (exists (select 1 from tasks t where t.id = task_id and (
      t.from_dept = any(my_departments()) or t.to_dept = any(my_departments())
      or am_md_office())));

drop policy if exists read_events on task_events;
create policy read_events on task_events for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and (
      t.raised_by = auth.uid() or t.from_dept = any(my_departments())
      or t.to_dept = any(my_departments()) or am_md_office())));
-- no insert policy: only the workflow functions write events

-- storage for photos and voice notes
insert into storage.buckets (id, name, public)
values ('task-media', 'task-media', false)
on conflict (id) do nothing;

drop policy if exists "task media read" on storage.objects;
create policy "task media read" on storage.objects for select to authenticated
  using (bucket_id = 'task-media');
drop policy if exists "task media write" on storage.objects;
create policy "task media write" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-media');
drop policy if exists "task media delete" on storage.objects;
create policy "task media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'task-media');

-- ---------------------------------------------------------------------
-- 9. THE VIEW EVERYTHING READS
--    Lateness is worked out here, once, so every screen agrees.
-- ---------------------------------------------------------------------

create or replace view v_tasks as
select
  t.*,
  fd.name as from_dept_name, fd.code as from_dept_code,
  td.name as to_dept_name,   td.code as to_dept_code,
  rp.full_name as raised_by_name,
  ap.full_name as assigned_to_name,
  sh.name as shop_name,

  -- how long to accept the task
  case when t.acknowledged_at is not null
    then round(extract(epoch from t.acknowledged_at - t.created_at) / 3600.0, 1)
    else round(extract(epoch from now() - t.created_at) / 3600.0, 1) end as hours_to_ack,

  (t.acknowledged_at is null and t.status in ('raised','reissued')
     and now() - t.created_at > interval '24 hours')          as ack_overdue,

  (t.due_date is not null and t.due_date < current_date
     and t.status not in ('completed','verified','cancelled')) as overdue,

  (t.actual_finish is not null and t.planned_finish is not null
     and t.actual_finish > t.planned_finish)                   as finished_late,

  case when t.actual_finish is not null and t.planned_finish is not null
    then t.actual_finish - t.planned_finish else null end      as days_late,

  case when t.closed_at is not null
    then (t.closed_at::date - t.created_at::date) else null end as days_to_close,

  (select count(*) from task_attachments a where a.task_id = t.id) as attachments
from tasks t
join departments fd on fd.id = t.from_dept
join departments td on td.id = t.to_dept
left join profiles rp on rp.id = t.raised_by
left join profiles ap on ap.id = t.assigned_to
left join shops sh on sh.id = t.shop_id;

-- ---------------------------------------------------------------------
-- 10. NEEDS ESCALATING
--     Not accepted in a day, or past its due date.
-- ---------------------------------------------------------------------

create or replace view v_task_escalations as
select v.*, d.escalates_to,
  (select name from departments e where e.id = d.escalates_to) as escalate_to_name,
  case
    when v.ack_overdue and v.overdue then 'not accepted and overdue'
    when v.ack_overdue then 'not accepted'
    when v.overdue then 'past due date'
  end as reason
from v_tasks v
join departments d on d.id = v.to_dept
where (v.ack_overdue or v.overdue)
  and v.status not in ('verified','cancelled');

-- ---------------------------------------------------------------------
-- 11. DEPARTMENT PERFORMANCE
--     One row per department per period.
-- ---------------------------------------------------------------------

create or replace function dept_performance(p_from date, p_to date)
returns table (
  department      text,
  dept_code       text,
  received        bigint,
  accepted        bigint,
  completed       bigint,
  verified        bigint,
  reissued        bigint,
  still_open      bigint,
  overdue         bigint,
  accepted_on_time bigint,
  finished_on_time bigint,
  avg_hours_to_accept numeric,
  avg_days_to_close   numeric,
  on_time_pct     numeric,
  quality_pct     numeric
)
language sql stable security definer set search_path = public as $$
  select
    d.name, d.code,
    count(t.id),
    count(*) filter (where t.acknowledged_at is not null),
    count(*) filter (where t.status in ('completed','verified')),
    count(*) filter (where t.status = 'verified'),
    sum(t.reissue_count),
    count(*) filter (where t.status not in ('verified','cancelled')),
    count(*) filter (where t.due_date < current_date
                       and t.status not in ('completed','verified','cancelled')),
    count(*) filter (where t.acknowledged_at is not null
                       and t.acknowledged_at - t.created_at <= interval '24 hours'),
    count(*) filter (where t.actual_finish is not null and t.planned_finish is not null
                       and t.actual_finish <= t.planned_finish),
    round(avg(extract(epoch from t.acknowledged_at - t.created_at) / 3600.0)
          filter (where t.acknowledged_at is not null), 1),
    round(avg(t.closed_at::date - t.created_at::date)
          filter (where t.closed_at is not null), 1),
    round(100.0 * count(*) filter (where t.actual_finish is not null
            and t.planned_finish is not null and t.actual_finish <= t.planned_finish)
          / nullif(count(*) filter (where t.actual_finish is not null), 0), 1),
    round(100.0 * count(*) filter (where t.status = 'verified' and t.reissue_count = 0)
          / nullif(count(*) filter (where t.status = 'verified'), 0), 1)
  from departments d
  left join tasks t on t.to_dept = d.id
       and t.created_at::date between p_from and p_to
  where d.active
  group by d.name, d.code, d.sort_order
  order by d.sort_order;
$$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 12. PUT YOURSELF IN MD OFFICE so you can see everything
--
--   insert into department_members (department_id, profile_id, post)
--   values ((select id from departments where code = 'MD'),
--           (select id from auth.users where email = 'your@email.com'),
--           'hod');
-- ---------------------------------------------------------------------
