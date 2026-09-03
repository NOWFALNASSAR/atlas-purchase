# Update 12 — Task management module

Eleven departments, cross-department requests, voice and photo, and a
performance report per department.

## Step 1 — SQL

Run `supabase/18_tasks.sql`. It creates the departments, membership, tasks,
attachments, the workflow functions, the escalation view and the performance
report. It also creates a private `task-media` storage bucket.

Check:

```sql
select code, name from departments order by sort_order;
select count(*) from information_schema.routines
 where routine_name in ('acknowledge_task','start_task','complete_task',
                        'verify_task','reissue_task','dept_performance');
```

Eleven departments, six functions.

## Step 2 — put yourself in MD Office

```sql
insert into department_members (department_id, profile_id, post)
values ((select id from departments where code = 'MD'),
        (select id from auth.users where email = 'your@email.com'),
        'hod');
```

MD Office sees every task in the group, automatically. Nobody has to copy you.

Then add your HODs and executives the same way, changing the code and post:

```sql
insert into department_members (department_id, profile_id, post)
values ((select id from departments where code = 'PUR'),
        (select id from auth.users where email = 'hod@example.com'),
        'hod');
```

Posts are `hod`, `executive` or `manager`. A showroom manager can also carry a
`shop_id`.

## Step 3 — files in GitHub

**New:**
```
src/components/TaskMedia.jsx
src/pages/Tasks.jsx
src/pages/NewTask.jsx
src/pages/TaskDetail.jsx
src/pages/TaskReports.jsx
```

**Replace:** `src/App.jsx`

---

# How a task moves

```
raised  →  accepted  →  started  →  done  →  checked  →  closed
                                       ↓
                                   reissued → back to accepted
```

**Raising.** Anyone in a department picks another department, writes what is
needed, sets a priority and a needed-by date. Optionally names a person and a
shop. After it is created, photos and voice notes can be added.

**Accepting.** The receiving department accepts and **sets its own start and
finish dates**. They cannot start work without doing this — which is the whole
point, because it turns "we'll get to it" into a date you can measure against.

**Doing.** Start, then mark done, with an optional note.

**Checking.** The raising department decides. Accept the work and it closes.
Not acceptable, and it goes back with a written reason — and the reissue is
counted permanently against that department.

**MD Office** can act at any step and sees everything.

Every step is stamped with who and when. The workflow lives in the database, so
nobody can skip a step by going round the app.

---

# Voice and photos

**Photos** are compressed on the phone before upload, as elsewhere in the app.

**Voice notes** record straight in the browser — tap, speak, tap to stop. It
asks for microphone permission the first time. Useful when explaining something
is faster spoken than typed, which for a shop floor problem is usually true.

Both work on the raise screen and on the task afterwards.

---

# Escalation

A task escalates when it is **not accepted within 24 hours** or **past its
needed-by date**. Both appear on the task itself in red, and on the performance
page under "to escalate", showing which department it goes up to.

Every department escalates to MD Office by default. To change that:

```sql
update departments set escalates_to = (select id from departments where code = 'OPS')
 where code = 'INV';
```

---

# The performance report

Today, this week, this month or this quarter. Per department:

| Column | Meaning |
|---|---|
| Got | tasks received |
| Done | completed |
| Open | still open, with how many are late |
| Accept | average hours to accept a task |
| On time | finished by the date **they themselves promised** |
| First time | closed without being reissued |

Those last two are the ones worth watching together. A department can score
well on time and badly on first time, which usually means dates are being met
by cutting the work short. Either number alone is easy to game; the pair is not.

Exports to Excel.

---

# Test it

1. Add yourself to MD Office and to one other department
2. Raise a task from your department to another
3. Add a photo and a voice note
4. Add a second user to the receiving department, sign in as them
5. Accept it, set dates, start, mark done
6. Back as the raiser — reissue it with a reason, then accept it the second time
7. Performance → the reissue shows in first-time-right
8. Raise one with yesterday's date as needed-by → it appears under escalations
