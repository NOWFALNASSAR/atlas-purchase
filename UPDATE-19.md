# Update 19 — The rest of the plan

Four things finished: reports, notifications, exports, and the MD's
separate dashboards.

## Task reports

**Masters is not where this lives — it is Tasks → Performance.** Three
views of the same work, with a period switch across the top and a
department / showroom filter under it.

**Performance** — per department and per showroom: how many arrived, how
many closed, how many are still open, how many are late, how many were
sent back, how many were disputed, average hours to accept, average days
to close, and an on-time percentage colour-coded green, amber, red.

Showrooms sit in the same table as departments and are measured on the
same terms, so you can compare Nilambur against Accounts directly.

**Register** — every task, raised to closed, one flat row each. Title,
who asked, who is responsible, raised date, due date, closed date, days
taken, sub-points completed, reissues, disputes. Filterable by status.
Each row links straight to the task.

**End of day** — one row per day for the last thirty: raised, accepted,
completed, closed, and how many were overdue when the day ended.

## Exports

**Excel** — one workbook, three sheets: Performance, Register, End of day.
Everything, including the notes column.

**Performance PDF** — landscape table of every department and showroom,
for circulating.

**End of day PDF** — today's figures, then the forty open tasks with the
late ones marked in red, then the last fourteen days. This is the one to
send round at close of business.

All three carry the company name and the time they were generated, so
nobody argues about which version they are holding.

## Notifications

A bell in the header, on every page and every screen size. The count is
unread only.

The database already writes these on a trigger — when a task is raised,
disputed, completed or closed. The bell just reads them. Clicking one
marks it read and opens the task.

It checks every sixty seconds rather than holding a live socket open. On
shop wifi a dropped socket that silently stops delivering is worse than a
check that is up to a minute late.

If the notifications table is not there yet, the bell hides itself rather
than putting an error in the header of every page.

## Separate dashboards

**Purchase now has its own dashboard** at Purchase → Purchase dashboard,
separate from the home page summary. One, three, six or twelve months:

- bought, awaiting approval with the value held up, approved, rejected
- **waiting for approval**, oldest first, with who is sitting on it and
  for how many days — anything over three days in red
- month by month
- where the money went, top ten suppliers with their share
- who is raising the orders, by person
- the latest ten orders

The home page keeps its short summary of every module, and each section
heading now links through to that module's own dashboard. So the MD
lands on one page, sees everything at a glance, and clicks into whichever
one he wants.

Sales, Stock and Tasks already had their own dashboards. Purchase was the
one that did not.

## Install

Run `supabase/25_task_reports.sql`. It adds two columns to the
performance function — whether a row is a department or a showroom, and
the dispute count — and creates the register view.

Then upload the files.

## Test

| # | Test | Must happen |
|---|---|---|
| 1 | Tasks → Performance | Showrooms and departments both listed |
| 2 | Switch to Showrooms | Only the ten branches |
| 3 | End of day PDF | Downloads, late tasks in red |
| 4 | Excel | Three sheets, notes column filled |
| 5 | Raise a task to another department | Bell shows a count for someone in that department |
| 6 | Click the notification | Opens the task, count drops |
| 7 | Purchase → Purchase dashboard | Waiting-for-approval table, oldest first |
| 8 | Home, click a section heading | Opens that module's dashboard |

Test 5 needs a second account — notifications are never sent to the
person who caused them.
