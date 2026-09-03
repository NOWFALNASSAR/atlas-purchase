-- =====================================================================
-- ATLAS  |  28_dept_activity_mrf_eod.sql
--
--   1. Department activity — one window per department, everything it
--      does, not just its tasks
--   2. MRF — a manpower request is a form, not a paragraph
--   3. Today's marking — priority and skipped, before the day is sent
--   4. WhatsApp numbers on departments
--
-- Run after 27. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. WHERE TO SEND THINGS
-- ---------------------------------------------------------------------

alter table departments add column if not exists whatsapp text;
alter table departments add column if not exists hod_name text;

comment on column departments.whatsapp is
  '10 digits, no +91, no spaces. Used for the wa.me link when a task is sent.';

-- ---------------------------------------------------------------------
-- 2. TASK TYPES
--
-- Most tasks are a sentence. Some are a form. A manpower request needs
-- the position, the salary and the date — asking for that in free text
-- means it arrives incomplete and HR has to chase.
-- ---------------------------------------------------------------------

alter table tasks add column if not exists task_type text not null default 'general';

alter table tasks drop constraint if exists tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check
  check (task_type in ('general','mrf','purchase','maintenance','audit','report','complaint'));

create index if not exists idx_tasks_type on tasks (task_type);

-- ---------- the manpower request form ----------

create table if not exists task_mrf (
  task_id         uuid primary key references tasks(id) on delete cascade,
  position        text not null,
  for_department  uuid references departments(id),
  shop_id         uuid references shops(id),
  headcount       int not null default 1 check (headcount between 1 and 99),
  employment      text not null default 'full_time'
                  check (employment in ('full_time','part_time','contract','trainee')),
  salary_min      numeric(12,2),
  salary_max      numeric(12,2),
  salary_period   text not null default 'month'
                  check (salary_period in ('month','day','year')),
  expected_by     date,
  qualification   text,
  experience      text,
  reason          text,
  replacing       text,          -- who left, if it is a replacement
  created_at      timestamptz not null default now()
);

alter table task_mrf enable row level security;

drop policy if exists read_mrf on task_mrf;
create policy read_mrf on task_mrf for select to authenticated
  using (can_see_task(task_id));

drop policy if exists write_mrf on task_mrf;
create policy write_mrf on task_mrf for all to authenticated
  using (can_work_task(task_id)) with check (can_work_task(task_id));

-- ---------------------------------------------------------------------
-- 3. MARKING THE DAY
--
-- Before the end-of-day report goes out, somebody says which tasks
-- actually mattered today and which were deliberately left. Without
-- that, an EOD is just a list and the reader has to guess what to
-- worry about.
--
-- One mark per task per day. Marking again replaces the mark.
-- ---------------------------------------------------------------------

create table if not exists task_day_marks (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  day        date not null default current_date,
  mark       text not null check (mark in ('priority','skipped','done_today')),
  note       text,
  marked_by  uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (task_id, day)
);

create index if not exists idx_marks_day on task_day_marks (day, mark);

alter table task_day_marks enable row level security;

drop policy if exists read_marks on task_day_marks;
create policy read_marks on task_day_marks for select to authenticated
  using (can_see_task(task_id));

drop policy if exists write_marks on task_day_marks;
create policy write_marks on task_day_marks for all to authenticated
  using (can_work_task(task_id)) with check (can_work_task(task_id));

create or replace function mark_task_day(p_task uuid, p_mark text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_work_task(p_task) then
    raise exception 'This task is not yours to mark';
  end if;

  if p_mark is null then
    delete from task_day_marks where task_id = p_task and day = current_date;
    return;
  end if;

  insert into task_day_marks (task_id, day, mark, note)
  values (p_task, current_date, p_mark, p_note)
  on conflict (task_id, day) do update
    set mark = excluded.mark, note = excluded.note,
        marked_by = auth.uid(), created_at = now();
end $$;

grant execute on function mark_task_day(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. THE DEPARTMENT WINDOW
--
-- A department is not only its tasks. The purchase department raises
-- orders; a showroom sells. This pulls the strands together so one
-- screen can show everything a department does.
-- ---------------------------------------------------------------------

-- who is in what
create or replace view v_dept_people as
select m.department_id, m.profile_id, m.post, p.full_name, p.username, p.role
  from department_members m
  join profiles p on p.id = m.profile_id
 where m.active and p.active;

-- purchase orders, attributed to the department of whoever raised them
create or replace view v_dept_purchase as
select
  dp.department_id,
  count(distinct po.id)                                            as orders,
  count(distinct po.id) filter (where po.status = 'pending')       as pending,
  count(distinct po.id) filter (where po.status = 'draft')         as drafts,
  count(distinct po.id) filter (where po.status = 'rejected')      as rejected,
  coalesce(sum(po.total_purchase) filter (
    where po.status in ('approved','sent','confirmed','partial','closed')), 0) as value,
  coalesce(sum(po.total_purchase) filter (where po.status = 'pending'), 0)     as pending_value,
  max(po.created_at)                                               as last_order
from v_dept_people dp
join purchase_orders po on po.created_by = dp.profile_id
group by dp.department_id;

-- tasks, both directions
create or replace view v_dept_tasks as
select
  d.id as department_id,
  count(*) filter (where t.to_dept   = d.id)                       as received,
  count(*) filter (where t.from_dept = d.id)                       as raised,
  count(*) filter (where t.to_dept = d.id
                     and t.status not in ('verified','cancelled'))  as open,
  count(*) filter (where t.to_dept = d.id and t.due_date < current_date
                     and t.status not in ('completed','verified','cancelled')) as overdue,
  count(*) filter (where t.to_dept = d.id and t.status = 'disputed') as disputed,
  count(*) filter (where t.to_dept = d.id and t.status = 'verified') as closed,
  round(avg(extract(epoch from t.acknowledged_at - t.created_at)/3600.0)
        filter (where t.to_dept = d.id and t.acknowledged_at is not null), 1) as avg_hours_to_accept,
  round(avg(t.closed_at::date - t.created_at::date)
        filter (where t.to_dept = d.id and t.closed_at is not null), 1)       as avg_days_to_close
from departments d
left join tasks t on t.to_dept = d.id or t.from_dept = d.id
where d.active
group by d.id;

-- everything a department is, in one row
create or replace view v_dept_overview as
select
  d.id, d.code, d.name, d.kind, d.is_md_office, d.whatsapp, d.hod_name, d.sort_order,
  (select count(*) from v_dept_people x where x.department_id = d.id)      as people,
  coalesce(tk.received, 0)   as tasks_received,
  coalesce(tk.raised, 0)     as tasks_raised,
  coalesce(tk.open, 0)       as tasks_open,
  coalesce(tk.overdue, 0)    as tasks_overdue,
  coalesce(tk.disputed, 0)   as tasks_disputed,
  coalesce(tk.closed, 0)     as tasks_closed,
  tk.avg_hours_to_accept,
  tk.avg_days_to_close,
  coalesce(pu.orders, 0)     as po_orders,
  coalesce(pu.pending, 0)    as po_pending,
  coalesce(pu.drafts, 0)     as po_drafts,
  coalesce(pu.value, 0)      as po_value,
  coalesce(pu.pending_value, 0) as po_pending_value,
  pu.last_order
from departments d
left join v_dept_tasks    tk on tk.department_id = d.id
left join v_dept_purchase pu on pu.department_id = d.id
where d.active;

-- ---------------------------------------------------------------------
-- 5. TODAY, READY TO SEND
--
-- What the end-of-day message is built from.
-- ---------------------------------------------------------------------

create or replace view v_eod_today as
select
  t.id, t.task_no, t.title, t.status, t.priority, t.due_date, t.task_type,
  fd.name as from_dept_name,
  td.name as to_dept_name, td.id as to_dept_id, td.whatsapp as to_whatsapp,
  ap.full_name as assigned_to_name,
  m.mark, m.note as mark_note,
  (t.due_date is not null and t.due_date < current_date
     and t.status not in ('completed','verified','cancelled')) as overdue,
  (current_date - t.created_at::date) as days_open,
  (t.created_at::date  = current_date) as raised_today,
  (t.closed_at::date   = current_date) as closed_today,
  (t.completed_at::date = current_date) as completed_today
from tasks t
join departments td on td.id = t.to_dept
join departments fd on fd.id = t.from_dept
left join profiles ap on ap.id = t.assigned_to
left join task_day_marks m on m.task_id = t.id and m.day = current_date
where t.status not in ('cancelled')
  and (t.status not in ('verified')
    or t.closed_at::date = current_date);

-- ---------------------------------------------------------------------
-- 6. FILL IN THE WHATSAPP NUMBERS
--
-- Nothing can be sent until these are set. Do it on
-- Masters → Departments, or here:
--
--   update departments set whatsapp = '9847012345' where code = 'HR';
--   update departments set whatsapp = '9847012346' where code = 'ACC';
--
-- 10 digits, no +91, no spaces. Send yourself a test message on each
-- number before trusting it.
--
--   select code, name, whatsapp from departments where active order by sort_order;
-- ---------------------------------------------------------------------
