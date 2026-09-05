# Before you go live

The cleanup script is the easy part. These are the things that cause
trouble in week one.

---

## 1. Back up first, and check the backup exists

Supabase → Database → Backups. Confirm one from **today**.

On the free plan backups are limited — if you are on it, take a manual
dump before the cleanup. Everything else on this list can be redone.
Deleted data cannot.

---

## 2. Run the cleanup, then check the counts

`GO-LIVE-CLEANUP.sql` prints a table at the end. Everything above the
divider must be **0**. Everything below must match what you set up.

If a "kept" number is 0 when it should not be, stop and restore the
backup.

---

## 3. Clear the storage buckets

The script does not delete files — only the rows pointing at them.
Supabase → Storage → `task-media` and `po-pdfs` → select all → delete.

Do this after you are happy the cleanup worked.

---

## 4. Every person has a username and a department

```sql
select full_name, username, role,
       (select count(*) from department_members m
         where m.profile_id = p.id and m.active) as departments
  from profiles p
 where active
 order by full_name;
```

Anyone with **0 departments cannot raise or receive a task**. That is
the single most common "the app is broken" call. Fix it on
Masters → Users, Departments tab.

Also check nobody is left with a test username like `test1`.

---

## 5. MD Office has real members

```sql
select p.full_name from department_members m
  join profiles p on p.id = m.profile_id
  join departments d on d.id = m.department_id
 where d.is_md_office and m.active;
```

If this is empty, disputes go nowhere and nobody can edit a task. It
must have at least two people — one being away should not stop the
company.

---

## 6. WhatsApp numbers on every department

```sql
select code, name, whatsapp from departments
 where active and whatsapp is null order by sort_order;
```

Anything listed cannot be sent a task by WhatsApp. Ten digits, no +91.
Send yourself a test message on each before trusting it.

---

## 7. Recurring schedules point at the right departments

```sql
select s.name, s.frequency, s.day_of_month, s.every_days,
       d.name as answerable, s.next_run, s.active
  from task_schedules s join departments d on d.id = s.to_dept
 order by s.name;
```

Check the three seeded ones — Monthly P&L, Vehicle inspection, Showroom
inventory check — go to the departments you actually want, and switch
off any you do not need. They will start generating from the next due
date.

---

## 8. Turn on the daily generator

```sql
create extension if not exists pg_cron;
select cron.schedule('atlas-task-schedules', '30 0 * * *',
                     $$select run_task_schedules()$$);
```

00:30 UTC is 6:00am India time. Without this, recurring tasks appear
only when somebody opens the Recurring tasks screen.

---

## 9. Set this month's purchase targets

Purchase → Targets. Until a target exists, achievement shows against
zero and the figures look wrong. Set CC and Non-CC at minimum.

---

## 10. Check the permissions actually bite

Not by looking at the screen — by trying to break it. Sign in as a
Sales Executive and:

- Open `/users` by typing it in the address bar → must be refused
- Open a task belonging to another department → must not be visible
- Try to mark a task done with no photo → must be refused

If any of those succeed, do not go live. The whole design assumes the
database refuses, not that the buttons are hidden.

---

## 11. Tell people the three things that will surprise them

- **Marking a task done needs a photo or a voice note.** Refused
  without one.
- **Only MD Office can edit, cancel or reassign a task.** Everyone else
  raises an issue and MD Office decides.
- **Sign in with a username, not an email.** There is no forgotten
  password link — an admin sets a new one on Masters → Users.

A five-line WhatsApp message to the HOD group the evening before saves
a morning of calls.

---

## 12. Start small

Do not switch on eleven departments and ten showrooms at once. Pick two
departments that already talk to each other — Purchase and Accounts —
and run them for a week. Fix what they complain about, then add the
rest.

The system works. Whether people use it is a separate problem, and it
is the harder one.

---

## After a week, look at these

```sql
-- is anyone actually planning their day
select name, planned_pct from v_pfd_compliance order by planned_pct;

-- is work being accepted, or just sitting
select * from v_task_counts;

-- what management is sitting on
select kind, count(*) from v_management_queue group by kind;
```

If PFD compliance is near zero after a fortnight, the habit is not
forming and no amount of further features will fix that. That is worth
knowing early.
