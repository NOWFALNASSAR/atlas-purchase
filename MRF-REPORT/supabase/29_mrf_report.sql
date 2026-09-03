-- =====================================================================
-- ATLAS  |  29_mrf_report.sql
--
-- A manpower request has a life of its own. It is raised, HR shortlists,
-- interviews happen, somebody is offered the job, somebody joins. Until
-- now the task only knew "open" or "closed", which cannot answer the
-- question that matters: where is this one stuck, and for how long.
--
-- Run after 28. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. WHERE HAS IT GOT TO
-- ---------------------------------------------------------------------

alter table task_mrf add column if not exists stage text not null default 'requested';

alter table task_mrf drop constraint if exists task_mrf_stage_check;
alter table task_mrf add constraint task_mrf_stage_check
  check (stage in ('requested','approved','sourcing','shortlisted',
                   'interviewing','offered','joined','on_hold','cancelled'));

alter table task_mrf add column if not exists candidate     text;
alter table task_mrf add column if not exists joined_on     date;
alter table task_mrf add column if not exists filled_count  int not null default 0;
alter table task_mrf add column if not exists last_action   text;
alter table task_mrf add column if not exists last_action_at timestamptz;
alter table task_mrf add column if not exists closed_reason text;

-- ---------------------------------------------------------------------
-- 2. RECORDING AN ACTION
--
-- Every move writes to task_events as well, so the action sits in the
-- same history as everything else on the task rather than in a place
-- only this report knows about.
-- ---------------------------------------------------------------------

create or replace function set_mrf_stage(
  p_task uuid, p_stage text, p_note text default null,
  p_candidate text default null, p_joined date default null, p_filled int default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_old text;
begin
  if not can_work_task(p_task) then
    raise exception 'This request is not yours to update';
  end if;

  select stage into v_old from task_mrf where task_id = p_task;
  if v_old is null then raise exception 'That task has no manpower request on it'; end if;

  select full_name into v_name from profiles where id = auth.uid();

  update task_mrf
     set stage          = p_stage,
         candidate      = coalesce(nullif(trim(p_candidate), ''), candidate),
         joined_on      = coalesce(p_joined, joined_on),
         filled_count   = coalesce(p_filled, filled_count),
         last_action    = coalesce(nullif(trim(p_note), ''),
                                   replace(initcap(p_stage), '_', ' ')),
         last_action_at = now()
   where task_id = p_task;

  insert into task_events (task_id, action, from_status, to_status, note, actor_name)
  values (p_task, 'mrf_' || p_stage, v_old, p_stage,
          coalesce(nullif(trim(p_note), ''), null), v_name);
end $$;

grant execute on function set_mrf_stage(uuid, text, text, text, date, int) to authenticated;

-- ---------------------------------------------------------------------
-- 3. THE REPORT
--
-- One row per request: how many positions, when it opened, when it is
-- needed, how long it has been open, where it has got to, what HR did
-- last and when, and how long it took to fill.
-- ---------------------------------------------------------------------

create or replace view v_mrf_report as
select
  t.id                       as task_id,
  t.task_no,
  t.title,
  t.status                   as task_status,
  t.priority,

  m.position,
  m.headcount,
  m.filled_count,
  greatest(m.headcount - m.filled_count, 0) as still_open,
  m.employment,
  m.stage,
  m.candidate,
  m.qualification,
  m.experience,
  m.replacing,
  m.reason,
  m.closed_reason,

  fd.name                    as raised_by_dept,
  td.name                    as with_dept,
  coalesce(wd.name, fd.name) as for_dept,
  rp.full_name               as raised_by,

  m.salary_min, m.salary_max, m.salary_period,

  t.created_at::date         as opened_on,
  m.expected_by              as needed_by,
  m.joined_on,
  t.closed_at::date          as closed_on,

  -- how long it has been open, or how long it took
  coalesce(m.joined_on, t.closed_at::date, current_date) - t.created_at::date
                             as days_open,
  case when m.joined_on is not null
    then m.joined_on - t.created_at::date end            as days_to_fill,

  -- late against the date the department asked for
  (m.expected_by is not null
     and m.expected_by < current_date
     and m.stage not in ('joined','cancelled'))          as overdue,
  case when m.expected_by is not null and m.stage not in ('joined','cancelled')
    then current_date - m.expected_by end                as days_past_needed,

  m.last_action,
  m.last_action_at,
  case when m.last_action_at is not null
    then (current_date - m.last_action_at::date) end     as days_since_action,

  (m.stage in ('joined','cancelled'))                    as is_closed
from task_mrf m
join tasks t        on t.id = m.task_id
join departments fd on fd.id = t.from_dept
join departments td on td.id = t.to_dept
left join departments wd on wd.id = m.for_department
left join profiles rp on rp.id = t.raised_by;

-- ---------------------------------------------------------------------
-- 4. THE HEADLINES
-- ---------------------------------------------------------------------

create or replace view v_mrf_summary as
select
  count(*)                                                as requests,
  coalesce(sum(headcount), 0)                             as positions,
  coalesce(sum(filled_count), 0)                          as filled,
  coalesce(sum(still_open) filter (where not is_closed), 0) as open_positions,
  count(*) filter (where not is_closed)                   as open_requests,
  count(*) filter (where overdue)                         as overdue,
  count(*) filter (where stage = 'joined')                as joined,
  count(*) filter (where stage = 'cancelled')             as cancelled,
  round(avg(days_to_fill) filter (where days_to_fill is not null), 1) as avg_days_to_fill,
  round(avg(days_open) filter (where not is_closed), 1)   as avg_days_open,
  count(*) filter (where not is_closed and coalesce(days_since_action, 999) > 7)
                                                          as untouched_over_a_week
from v_mrf_report;

-- ---------------------------------------------------------------------
-- 5. THE RIGHT TO SEE IT
-- ---------------------------------------------------------------------

insert into permissions (code, module, label, hint, sort_order) values
  ('tasks.mrf', 'tasks', 'Manpower report',
   'Positions asked for, how long they stay open, and what HR did about them', 390)
on conflict (code) do update
  set label = excluded.label, hint = excluded.hint,
      sort_order = excluded.sort_order, active = true;

-- HR and anyone who already sees task reports
insert into role_permissions (role, permission_code)
select r.code, 'tasks.mrf' from roles r
 where r.active and r.base_role <> 'admin'
   and (r.code like 'hr%' or exists (
        select 1 from role_permissions rp
         where rp.role = r.code and rp.permission_code = 'tasks.reports'))
on conflict do nothing;

-- ---------------------------------------------------------------------
--   select * from v_mrf_summary;
--   select position, opened_on, needed_by, days_open, stage, last_action
--     from v_mrf_report order by opened_on desc;
-- ---------------------------------------------------------------------
