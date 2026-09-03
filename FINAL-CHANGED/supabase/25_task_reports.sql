-- =====================================================================
-- ATLAS  |  25_task_reports.sql
--
-- Two small additions so the reports screen can do its job:
--
--   1. dept_performance() now says whether a row is a department or a
--      showroom, and counts disputes. Same function, same date range,
--      two more columns.
--
--   2. A register view: every task, raised to closed, with the detail
--      the MD office asks for.
--
-- Run after 21. Safe to re-run.
-- =====================================================================

drop function if exists dept_performance(date, date);

create or replace function dept_performance(p_from date, p_to date)
returns table (
  department          text,
  dept_code           text,
  kind                text,
  received            bigint,
  accepted            bigint,
  completed           bigint,
  verified            bigint,
  reissued            bigint,
  disputed            bigint,
  still_open          bigint,
  overdue             bigint,
  accepted_on_time    bigint,
  finished_on_time    bigint,
  avg_hours_to_accept numeric,
  avg_days_to_close   numeric,
  on_time_pct         numeric,
  quality_pct         numeric,
  closed_pct          numeric
)
language sql stable security definer set search_path = public as $$
  select
    d.name, d.code, d.kind,
    count(t.id),
    count(*) filter (where t.acknowledged_at is not null),
    count(*) filter (where t.status in ('completed','verified')),
    count(*) filter (where t.status = 'verified'),
    coalesce(sum(t.reissue_count), 0),
    coalesce(sum(t.dispute_count), 0),
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
    -- finished by the date they promised
    case when count(*) filter (where t.actual_finish is not null
                                 and t.planned_finish is not null) > 0
      then round(100.0 * count(*) filter (where t.actual_finish is not null
              and t.planned_finish is not null and t.actual_finish <= t.planned_finish)
            / count(*) filter (where t.actual_finish is not null
                                 and t.planned_finish is not null), 1) end,
    -- accepted first time, not sent back
    case when count(t.id) > 0
      then round(100.0 * count(*) filter (where coalesce(t.reissue_count,0) = 0)
            / count(t.id), 1) end,
    -- how much of what arrived actually got closed
    case when count(t.id) > 0
      then round(100.0 * count(*) filter (where t.status = 'verified')
            / count(t.id), 1) end
  from departments d
  left join tasks t
    on t.to_dept = d.id
   and t.created_at::date between p_from and p_to
  where d.active
  group by d.id, d.name, d.code, d.kind, d.sort_order
  order by d.sort_order, d.name
$$;

grant execute on function dept_performance(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- THE REGISTER — every task, raised to closed, in one flat row
-- ---------------------------------------------------------------------

create or replace view v_task_register as
select
  t.task_no,
  t.title,
  fd.name  as raised_by_dept,
  td.name  as responsible_dept,
  td.kind  as responsible_kind,
  rp.full_name as raised_by,
  ap.full_name as assigned_to,
  t.priority,
  t.status,
  t.created_at::date        as raised_on,
  t.acknowledged_at::date   as accepted_on,
  t.due_date,
  t.planned_finish,
  t.actual_finish,
  t.closed_at::date         as closed_on,
  t.reissue_count,
  t.dispute_count,
  dd.name as disputed_from,
  sc.name as schedule_name,

  case when t.acknowledged_at is not null
    then round(extract(epoch from t.acknowledged_at - t.created_at)/3600.0, 1) end
                            as hours_to_accept,
  case when t.closed_at is not null
    then (t.closed_at::date - t.created_at::date) end
                            as days_to_close,
  case when t.closed_at is null
    then (current_date - t.created_at::date) end
                            as days_open,

  (t.due_date is not null and t.due_date < current_date
     and t.status not in ('completed','verified','cancelled')) as overdue,
  (t.actual_finish is not null and t.planned_finish is not null
     and t.actual_finish > t.planned_finish)                   as finished_late,

  (select count(*) from task_checklist c where c.task_id = t.id)            as points,
  (select count(*) from task_checklist c where c.task_id = t.id and c.done) as points_done,
  (select string_agg(n.note, ' | ' order by n.created_at)
     from task_notes n where n.task_id = t.id)                              as notes,
  t.id
from tasks t
join departments fd on fd.id = t.from_dept
join departments td on td.id = t.to_dept
left join departments dd on dd.id = t.disputed_from
left join profiles rp on rp.id = t.raised_by
left join profiles ap on ap.id = t.assigned_to
left join task_schedules sc on sc.id = t.schedule_id;
