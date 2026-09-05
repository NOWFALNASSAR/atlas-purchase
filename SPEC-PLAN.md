# The specification, against what exists

I went through all 58 sections against the code. This is where things
actually stand, so you can see what is already done and decide the order
for the rest.

## Already built

| § | Requirement | Where |
|---|---|---|
| 2, 3 | Roles, departments, MD Office and Admin separate | `roles`, `departments` |
| 4, 5, 6 | Two-page task structure, changes recorded | `TaskDetail` + `TaskManage` |
| 9 | Accept task, commit a date | `acknowledge_task` |
| 12 | Photo and voice upload | `TaskMedia` |
| 17 | Overdue detection and filtering | `v_task_full` |
| 21, 22 | EOD with marking | `Eod.jsx` |
| 24, 25, 26 | PDF and WhatsApp sharing | `SendPdfSheet` |
| 38, 40 | Recurring tasks | `task_schedules` |
| 42 | Department performance | `v_dept_performance` |
| 47, 48 | External vs own tasks | `DeptPerformance` |
| 49 | Notifications | `notifications` |
| 50 | Task audit history | `task_events` |
| 51 | Permissions in the database | 111 RLS policies |
| 53 | Works on phone, tablet, desktop | done in update 14 |

## This update — §3, §11, §12, §39

**§3 — Admin monitors, MD Office modifies.** Correcting migration 30,
where I gave admin edit and cancel. The specification is explicit that
admin sees everything and changes nothing. Admin keeps full visibility;
editing, cancelling and reassigning are MD Office only.

The rights still exist, so you can hand editing to one named person on
Masters → Users if you ever want to. Nobody has them by default.

**§11 — Step-by-step updates.** New `task_steps` table. A sub-point is
the plan, written when the task is raised. A step is what actually
happened, written as the work goes. Each step records who, which
department, when, its status, and an optional attachment. Adding the
first step moves the task to In progress on its own.

**§12 — Evidence before Done.** `complete_task` now refuses unless the
task has at least one photo or voice note. Enforced in the database, so
calling the API directly gets the same refusal:

> Add a photo or a voice note before marking this done

**§39 — Every recurrence pattern.** Was monthly-on-a-day and
every-N-days. Now daily, weekly, monthly, quarterly, yearly and custom,
with a start date and an end date. I tested the date arithmetic across a
year including quarter and year rollover.

## Still to build, in the order I would do it

**Phase 2 — PFD (§18–20, 23).** The Plan For the Day, department-wise,
collecting tasks due today, pending work, recurring tasks falling due
and management instructions. Connected so a recurring task appears in
PFD automatically and lands in EOD when finished. This is the biggest
missing piece and the one that changes daily behaviour most.

**Phase 3 — Task dashboard and department dashboards (§13, 27, 28, 29,
54, 55).** The card layout — My Tasks, For My Department, Raised By Me,
Pending, Overdue, PFD, EOD — and separate dashboards for a department
user, admin and MD Office.

**Phase 4 — Performance scoring (§43, 44, 45).** The score out of ten
from the seven weighted criteria, and the top five strengths and five
improvement areas generated from real figures rather than stock
sentences.

**Phase 5 — Purchase targets (§30–34).** Purchasers, purchase types
(CC, Non-CC, CC Bedsheet), targets at both levels, MD-Office-only
changes with an audit trail, and the purchase dashboard showing target
against achievement.

**Phase 6 — Task creation redesign and order module (§7, 35, 36).** The
card-per-field creation screen, and Add New Item without leaving the
order.

**Phase 7 — Performance and pagination (§52).** Paging and indexes
before the task count gets large. Worth doing before Phase 4, if the
tables are already growing.

## Honest note on size

Sections 18 to 55 are roughly the same amount of work again as
everything built so far. Trying to do it in one pass would produce
something that half-works everywhere, which is worse than something
that fully works in one place.

Phase 2 is the one I would do next. PFD is where the daily habit forms,
and once departments open it every morning the rest has somewhere to
live.

## Install

Run `supabase/31_task_workflow.sql`.

After running it, marking a task done will fail until a photo or voice
note is attached. That is intentional, but tell the departments before
you deploy it or you will get calls.
