-- =====================================================================
-- ATLAS  |  35_dashboards.sql
--
-- Phase 3 — the numbers behind the dashboard cards.  §13, §27–29, §54, §55
--
-- Counted in the database, not in the browser. §52 says do not load the
-- whole task table to draw a dashboard, and on shop wifi that is not a
-- style preference — pulling two thousand rows to show the number 7 is
-- the difference between a screen that opens and one that spins.
--
-- Every view below reads `tasks`, so row level security applies to the
-- caller. The same view gives a Sales executive their own figures and
-- the MD the whole company. One definition, no branching.
--
-- Run after 33. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE CARDS  (§13, §54)
--
-- One row, for whoever is asking.
-- ---------------------------------------------------------------------

create or replace view v_task_counts as
select
  count(*) filter (where t.assigned_to = auth.uid()
                     and t.status not in ('verified','cancelled'))        as mine,

  count(*) filter (where t.to_dept = any (my_departments())
                     and t.status not in ('verified','cancelled'))        as for_my_dept,

  count(*) filter (where t.raised_by = auth.uid())                        as raised_by_me,

  count(*) filter (where t.status in ('raised','reissued'))               as to_accept,
  count(*) filter (where t.status in ('acknowledged','in_progress'))      as in_progress,
  count(*) filter (where t.status = 'completed')                          as awaiting_review,
  count(*) filter (where t.status = 'verified')                           as closed,
  count(*) filter (where t.status = 'disputed')                           as disputed,

  count(*) filter (where t.due_date < current_date
                     and t.status not in ('completed','verified','cancelled')) as overdue,

  count(*) filter (where t.due_date = current_date
                     and t.status not in ('verified','cancelled'))        as due_today,

  count(*) filter (where t.schedule_id is not null
                     and t.status not in ('verified','cancelled'))        as recurring_open,

  count(*) filter (where t.task_type = 'mrf'
                     and t.status not in ('verified','cancelled'))        as manpower_open,

  count(*) filter (where t.created_at::date = current_date)               as raised_today,
  count(*) filter (where t.closed_at::date = current_date)                as closed_today,

  count(*) filter (where t.status not in ('verified','cancelled'))        as open_total,
  count(*)                                                                as total
from tasks t;

-- ---------------------------------------------------------------------
-- 2. A DEPARTMENT'S DAY  (§48, §55)
--
-- What this department is expected to do today, split the way §48 asks:
-- its own regular work, what other departments have sent it, and what
-- is already late. Plus whether the plan and the day-end were done.
-- ---------------------------------------------------------------------

create or replace view v_dept_today as
select
  d.id as department_id, d.code, d.name, d.kind, d.whatsapp, d.sort_order,

  count(p.task_id)                                     as on_plan,
  count(*) filter (where p.source = 'regular')         as regular_tasks,
  count(*) filter (where p.source = 'external')        as external_tasks,
  count(*) filter (where p.source = 'own')             as own_tasks,
  count(*) filter (where p.bucket = 'overdue')         as overdue,
  count(*) filter (where p.bucket = 'accept')          as to_accept,
  count(*) filter (where p.bucket = 'today')           as due_today,
  count(*) filter (where p.bucket = 'progress')        as in_progress,
  count(*) filter (where p.bucket = 'review')          as awaiting_review,
  count(*) filter (where p.priority in ('high','urgent')) as important,
  count(*) filter (where p.today_action is not null)   as planned,

  (pd.submitted_at is not null)                        as pfd_done,
  pd.submitted_at                                      as pfd_at,

  (select count(*) from task_day_marks m
     join tasks t2 on t2.id = m.task_id
    where m.day = current_date and t2.to_dept = d.id)  as marked_today,

  (select count(*) from tasks t3
    where t3.to_dept = d.id and t3.closed_at::date = current_date) as closed_today

from departments d
left join v_pfd p on p.department_id = d.id
left join pfd_days pd on pd.department_id = d.id and pd.day = current_date
where d.active
group by d.id, d.code, d.name, d.kind, d.whatsapp, d.sort_order,
         pd.submitted_at;

-- ---------------------------------------------------------------------
-- 3. WHAT MANAGEMENT IS WAITING ON  (§28, §29)
--
-- The things that sit still unless somebody senior looks at them.
-- ---------------------------------------------------------------------

create or replace view v_management_queue as
select
  'dispute'                                as kind,
  t.id                                     as task_id,
  t.task_no,
  t.title,
  dd.name                                  as department_name,
  t.dispute_note                           as detail,
  t.updated_at                             as since,
  (current_date - t.updated_at::date)      as days_waiting,
  t.priority
from tasks t
left join departments dd on dd.id = t.disputed_from
where t.status = 'disputed'

union all

select
  'review', t.id, t.task_no, t.title, td.name,
  'Marked done by ' || td.name || ', waiting for ' || fd.name,
  t.completed_at, (current_date - t.completed_at::date), t.priority
from tasks t
join departments td on td.id = t.to_dept
join departments fd on fd.id = t.from_dept
where t.status = 'completed'

union all

select
  'unaccepted', t.id, t.task_no, t.title, td.name,
  'Not accepted after 24 hours', t.created_at,
  (current_date - t.created_at::date), t.priority
from tasks t
join departments td on td.id = t.to_dept
where t.status in ('raised','reissued')
  and now() - t.created_at > interval '24 hours'

union all

select
  'overdue', t.id, t.task_no, t.title, td.name,
  'Past ' || t.due_date::text, t.due_date::timestamptz,
  (current_date - t.due_date), t.priority
from tasks t
join departments td on td.id = t.to_dept
where t.due_date < current_date
  and t.status not in ('completed','verified','cancelled');

-- ---------------------------------------------------------------------
-- 4. HOW THE WHOLE COMPANY IS DOING TODAY  (§29)
-- ---------------------------------------------------------------------

create or replace view v_org_today as
select
  (select count(*) from departments where active and kind = 'department') as departments,
  (select count(*) from departments where active and kind = 'showroom')   as showrooms,
  (select count(*) from v_dept_today where pfd_done)                      as pfd_submitted,
  (select count(*) from v_dept_today where on_plan > 0)                   as depts_with_work,
  (select count(*) from v_management_queue where kind = 'dispute')        as disputes,
  (select count(*) from v_management_queue where kind = 'review')         as awaiting_review,
  (select count(*) from v_management_queue where kind = 'unaccepted')     as unaccepted,
  (select count(*) from v_management_queue where kind = 'overdue')        as overdue,
  (select count(*) from tasks where created_at::date = current_date)      as raised_today,
  (select count(*) from tasks where closed_at::date = current_date)       as closed_today;

-- ---------------------------------------------------------------------
-- 5. INDEXES  (§52)
--
-- The counts above filter on these columns every time a dashboard
-- opens. Cheap to add now, painful to add when the table is large and
-- everyone is waiting.
-- ---------------------------------------------------------------------

create index if not exists idx_tasks_status_due   on tasks (status, due_date);
create index if not exists idx_tasks_to_status    on tasks (to_dept, status);
create index if not exists idx_tasks_from_status  on tasks (from_dept, status);
create index if not exists idx_tasks_assigned     on tasks (assigned_to) where assigned_to is not null;
create index if not exists idx_tasks_raised_by    on tasks (raised_by);
create index if not exists idx_tasks_created_day  on tasks ((created_at::date));
create index if not exists idx_tasks_closed_day   on tasks ((closed_at::date)) where closed_at is not null;

-- ---------------------------------------------------------------------
--   select * from v_task_counts;
--   select name, on_plan, overdue, pfd_done from v_dept_today where on_plan > 0;
--   select kind, count(*) from v_management_queue group by kind;
--   select * from v_org_today;
-- ---------------------------------------------------------------------
