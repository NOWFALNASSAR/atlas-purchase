-- =====================================================================
-- ATLAS  |  36_performance.sql
--
-- Phase 4 — department performance out of ten.  §42, §43, §44, §45
--
-- Two rules shape all of this:
--
--   §44 says the score must come from system data. So nobody types a
--   number anywhere. Every point is derived from something that
--   already happened — a timestamp, an attachment, a date met or
--   missed.
--
--   §45 asks for five strengths and five improvement areas. Generated
--   from the same figures, with the number in the sentence. "95% of
--   tasks accepted within a day" is worth reading; "good acceptance
--   discipline" is not.
--
-- A department is only scored on what it actually did. If nothing
-- recurring was due, recurring compliance is not counted against it —
-- the remaining weights are scaled back up to ten. Otherwise a quiet
-- month looks like a bad one.
--
-- Run after 35. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE WEIGHTS  (§43, configurable)
-- ---------------------------------------------------------------------

create table if not exists performance_weights (
  component  text primary key,
  label      text not null,
  weight     numeric(4,2) not null check (weight >= 0),
  hint       text,
  sort_order int not null default 0
);

insert into performance_weights (component, label, weight, hint, sort_order) values
  ('acceptance',  'Accepting work',      1, 'Task accepted within a day of arriving',        1),
  ('commitment',  'Committing a date',   1, 'A finish date promised when accepting',         2),
  ('updates',     'Progress updates',    2, 'At least one step recorded while working',      3),
  ('ontime',      'Finishing on time',   3, 'Finished by the date they promised',            4),
  ('evidence',    'Evidence attached',   1, 'A photo or voice note on completed work',        5),
  ('recurring',   'Recurring work',      1, 'Scheduled jobs closed by their due date',       6),
  ('response',    'First time right',    1, 'Not sent back for redoing',                     7)
on conflict (component) do update
  set label = excluded.label, hint = excluded.hint, sort_order = excluded.sort_order;

alter table performance_weights enable row level security;

drop policy if exists read_weights on performance_weights;
create policy read_weights on performance_weights for select to authenticated using (true);

drop policy if exists write_weights on performance_weights;
create policy write_weights on performance_weights for all to authenticated
  using (am_md_office() or my_role() = 'admin')
  with check (am_md_office() or my_role() = 'admin');

-- ---------------------------------------------------------------------
-- 2. THE BREAKDOWN, ONE DEPARTMENT
--
-- Returns a row per component so a screen can show the working, not
-- just the total. A score nobody can take apart is a score nobody
-- believes.
-- ---------------------------------------------------------------------

create or replace function dept_score_parts(p_dept uuid, p_from date, p_to date)
returns table (
  component   text,
  label       text,
  hint        text,
  weight      numeric,
  numerator   int,
  denominator int,
  rate        numeric,     -- 0..1, null when there was nothing to measure
  points      numeric,
  sort_order  int
)
language sql stable security definer set search_path = public as $$
with t as (
  select * from tasks
   where to_dept = p_dept
     and created_at::date between p_from and p_to
     and status <> 'cancelled'
),
raw as (
  select 'acceptance' as component,
         count(*) filter (where acknowledged_at is not null
                            and acknowledged_at - created_at <= interval '24 hours')::int as num,
         count(*)::int as den
    from t
  union all
  select 'commitment',
         count(*) filter (where planned_finish is not null)::int,
         count(*) filter (where acknowledged_at is not null)::int
    from t
  union all
  select 'updates',
         count(*) filter (where exists (select 1 from task_steps s where s.task_id = t.id))::int,
         count(*) filter (where status in ('in_progress','completed','verified'))::int
    from t
  union all
  select 'ontime',
         count(*) filter (where actual_finish <= coalesce(planned_finish, due_date))::int,
         count(*) filter (where actual_finish is not null
                            and coalesce(planned_finish, due_date) is not null)::int
    from t
  union all
  select 'evidence',
         count(*) filter (where task_has_evidence(t.id))::int,
         count(*) filter (where status in ('completed','verified'))::int
    from t
  union all
  select 'recurring',
         count(*) filter (where status = 'verified'
                            and (due_date is null or closed_at::date <= due_date))::int,
         count(*) filter (where schedule_id is not null)::int
    from t
  union all
  select 'response',
         count(*) filter (where coalesce(reissue_count, 0) = 0)::int,
         count(*)::int
    from t
)
select
  w.component, w.label, w.hint, w.weight,
  r.num, r.den,
  case when r.den > 0 then round(r.num::numeric / r.den, 4) end,
  case when r.den > 0 then round(w.weight * r.num::numeric / r.den, 3) else null end,
  w.sort_order
from performance_weights w
join raw r on r.component = w.component
order by w.sort_order
$$;

grant execute on function dept_score_parts(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. THE SCORE, EVERY DEPARTMENT
--
-- Weights for components with nothing to measure are dropped, and the
-- rest scaled to ten. A department that received four tasks and did
-- them all well scores like one that received forty.
-- ---------------------------------------------------------------------

create or replace function dept_scores(p_from date, p_to date)
returns table (
  department_id uuid,
  code          text,
  name          text,
  kind          text,
  tasks         int,
  score         numeric,
  measured      numeric,   -- how much of the ten could be measured
  band          text
)
language sql stable security definer set search_path = public as $$
select
  d.id, d.code, d.name, d.kind,
  (select count(*)::int from tasks t
    where t.to_dept = d.id and t.created_at::date between p_from and p_to
      and t.status <> 'cancelled') as tasks,
  case when s.total_weight > 0
    then round(10 * s.earned / s.total_weight, 1) end as score,
  s.total_weight,
  case
    when s.total_weight is null or s.total_weight = 0 then 'not measured'
    when 10 * s.earned / s.total_weight >= 8.5 then 'strong'
    when 10 * s.earned / s.total_weight >= 7   then 'steady'
    when 10 * s.earned / s.total_weight >= 5   then 'needs attention'
    else 'poor'
  end as band
from departments d
left join lateral (
  select sum(points) as earned, sum(weight) as total_weight
    from dept_score_parts(d.id, p_from, p_to)
   where points is not null
) s on true
where d.active
order by score desc nulls last, d.sort_order
$$;

grant execute on function dept_scores(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. FIVE STRENGTHS, FIVE THINGS TO FIX  (§45)
--
-- Written from the figures, with the figure in the sentence. Anything
-- at 85% or better is a strength; anything under 70% needs work. Plain
-- counts — tasks overdue, work sent back — are added on top, because
-- "three tasks went overdue" is more use than any percentage.
-- ---------------------------------------------------------------------

create or replace function dept_findings(p_dept uuid, p_from date, p_to date)
returns table (kind text, finding text, metric numeric, sort_order int)
language sql stable security definer set search_path = public as $$
with parts as (
  select * from dept_score_parts(p_dept, p_from, p_to)
),
counts as (
  select
    count(*) filter (where due_date < current_date
                       and status not in ('completed','verified','cancelled'))::int as overdue,
    count(*) filter (where coalesce(reissue_count,0) > 0)::int                       as sent_back,
    count(*) filter (where status = 'disputed')::int                                 as disputed,
    count(*) filter (where acknowledged_at is null
                       and status in ('raised','reissued')
                       and now() - created_at > interval '24 hours')::int            as unaccepted,
    count(*)::int                                                                    as total
  from tasks
  where to_dept = p_dept and created_at::date between p_from and p_to
    and status <> 'cancelled'
),
pfd as (
  select coalesce(planned_pct, 0) as planned_pct from v_pfd_compliance where department_id = p_dept
)
-- strengths
select 'strength',
       round(rate * 100)::text || '% — ' || lower(label) || ' (' || numerator || ' of ' || denominator || ')',
       rate, sort_order
  from parts where rate >= 0.85 and denominator > 0

union all
select 'strength', 'Plan for the day submitted on ' || round(planned_pct)::text || '% of the last 30 days',
       planned_pct / 100, 20
  from pfd where planned_pct >= 80

union all
select 'strength', 'Nothing overdue', 1, 21 from counts where overdue = 0 and total > 0

union all
select 'strength', 'No work sent back for redoing', 1, 22 from counts where sent_back = 0 and total > 0

-- improvements
union all
select 'improve',
       round(rate * 100)::text || '% — ' || lower(label) || ' (' || (denominator - numerator)
       || ' of ' || denominator || ' missed)',
       rate, sort_order
  from parts where rate < 0.70 and denominator > 0

union all
select 'improve', counts.overdue::text || ' task' || case when counts.overdue = 1 then '' else 's' end
       || ' overdue right now', counts.overdue, 30
  from counts where overdue > 0

union all
select 'improve', counts.sent_back::text || ' piece' || case when counts.sent_back = 1 then '' else 's' end
       || ' of work sent back for redoing', counts.sent_back, 31
  from counts where sent_back > 0

union all
select 'improve', counts.unaccepted::text || ' task' || case when counts.unaccepted = 1 then '' else 's' end
       || ' not accepted after a day', counts.unaccepted, 32
  from counts where unaccepted > 0

union all
select 'improve', counts.disputed::text || ' task' || case when counts.disputed = 1 then '' else 's' end
       || ' disputed and sitting with MD Office', counts.disputed, 33
  from counts where disputed > 0

union all
select 'improve', 'Plan for the day submitted on only ' || round(planned_pct)::text
       || '% of the last 30 days', planned_pct / 100, 34
  from pfd where planned_pct < 60
$$;

grant execute on function dept_findings(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 5. THE RIGHT
-- ---------------------------------------------------------------------

insert into permissions (code, module, label, hint, sort_order) values
  ('tasks.score', 'tasks', 'Performance scores',
   'Department score out of ten, with strengths and areas to improve', 395)
on conflict (code) do update
  set label = excluded.label, hint = excluded.hint,
      sort_order = excluded.sort_order, active = true;

insert into role_permissions (role, permission_code)
select r.code, 'tasks.score' from roles r
 where r.active and r.base_role in ('hod', 'manager')
on conflict do nothing;

-- ---------------------------------------------------------------------
--   select * from dept_scores(current_date - 30, current_date);
--   select * from dept_score_parts('<dept id>', current_date - 30, current_date);
--   select * from dept_findings('<dept id>', current_date - 30, current_date);
-- ---------------------------------------------------------------------
