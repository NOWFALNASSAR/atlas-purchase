# Update 18 — Task module rebuild: the database

This is the foundation for everything you asked for. It is one file,
`supabase/21_tasks_v2.sql`, and it is built on top of `18_tasks.sql`
rather than replacing it — existing tasks, events and attachments carry
over untouched.

## The decision that made the rest easy

**Showrooms are departments.** A showroom raises tasks, receives tasks,
has members, escalates to MD Office and gets measured on response time.
That is the same list of behaviours a department has.

So rather than build a parallel system for shops, the ten showrooms are
inserted into `departments` with `kind = 'showroom'`. Every function,
policy, view and screen written for departments works on them from the
moment they exist. Showroom to department, department to showroom, and
showroom to showroom all work with no extra code.

The ten: Perinthalmanna, Nilambur, Koduvally, Kadakkal, Kollam, Dandhi
Square, KADS, Muvattupuzha, Perumbavoor, Kothamangalam.

## What is now in the database

**Multi-department tasks.** `tasks.to_dept` stays the single **answerable**
department — only they can accept, start and complete, exactly as before.
Supporting departments go in `task_departments`. They see the task and can
add notes, but the responsibility is not split, so nobody can hide behind
"we thought they were doing it".

**Disputes.** A department that thinks a task is not theirs calls
`dispute_task(id, reason)` with a reason. Status becomes `disputed`, the
task moves to MD Office, and the original department is remembered. MD
Office calls `md_assign_task(id, dept, note)` to settle it — the note is
required. The whole argument is on the record in `task_events`.

**Sub-points.** `task_checklist` — a task is usually a list, not a
sentence. Ticking them one by one is how you know work was done rather
than merely marked done.

**Notes that carry forward.** `task_notes` holds what you wrote. The view
`v_task_previous` reaches back through the schedule to the previous
occurrence and hands you its notes. So the person doing the P&L on the 5th
of next month opens the task and reads what happened on the 5th of this
month.

**Recurring tasks.** `task_schedules` holds the template — title, details,
which department, how often, a checklist, how many days until due. Two
patterns are supported:

- `monthly` on a day of the month — P&L on the 5th, vehicles on the 10th
- `interval` every N days — inventory check every 10 days

A schedule with `scope = 'each_showroom'` generates one task per showroom,
so one inventory schedule covers all ten branches.

`run_task_schedules()` creates whatever is due. It is safe to run twice —
a unique index stops duplicates.

**Notifications.** `notifications` plus triggers. When a task is raised,
everyone in the receiving department is told, plus the named person if
there is one. When it is completed or closed, the department that asked is
told. In-app only for now; WhatsApp needs the Business API and Meta
template approval, which is a separate job.

**Performance.** `v_dept_performance` gives per department: received,
closed, open, overdue, disputed, reissues, average hours to accept,
average days to close, and closed percentage. Showrooms appear in it
alongside departments, so you can compare Nilambur against Accounts on the
same terms.

**End of day.** `v_task_eod` gives one row per day for the last 60 days:
raised, accepted, completed, closed, and how many were overdue at day end.

## Your three schedules are already set up

Seeded, with checklists, ready to edit or delete:

| Schedule | When | Department | Sub-points |
|---|---|---|---|
| Monthly P&L | 5th of each month | Accounts | 5 |
| Vehicle inspection | 10th of each month | Operations | 5 |
| Showroom inventory check | every 10 days, all 10 showrooms | Inventory | 5 |

## Make it run daily

Supabase includes pg_cron. Two statements, once:

```sql
create extension if not exists pg_cron;

select cron.schedule('atlas-task-schedules', '30 0 * * *',
                     $$select run_task_schedules()$$);
```

00:30 UTC is 6:00am India time. The app also calls the function when MD
Office opens the Recurring tasks screen, so nothing is lost if you skip
this.

## How it was checked

Every statement was parsed with the real PostgreSQL grammar, and all
eleven function bodies were parsed with the real PL/pgSQL parser. No
syntax errors. That is not the same as saying the logic is perfect — run
it on your database and test the flows.

## What is NOT built yet

This update is the database only. The screens that use it are the next
piece of work:

1. **Recurring tasks** — a screen for MD Office to add and edit schedules
2. **Raise task** — rewritten for showrooms, multiple departments and
   sub-points
3. **Task detail** — checklist, notes, last time's notes, dispute button,
   MD Office assign
4. **Department performance** — the report, with showrooms included
5. **Notification bell** in the header
6. **PDF and end-of-day export**
7. **Separate MD dashboards** per module with drill-down

Until those exist, the new tables are populated by triggers and schedules
but there is no screen to see them on. Run this SQL whenever you like —
it changes nothing on screen and breaks nothing — then tell me which of
the seven to build first.
