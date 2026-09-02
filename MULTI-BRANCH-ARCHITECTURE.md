# Multi-branch architecture

Every showroom has its own server. The masters on them are identical; the
transactions are not. That single fact drives every decision below.

```
Showroom A server  ─┐
Showroom B server  ─┤   each runs the same agent,
Showroom C server  ─┼─→ different config      ─→  Supabase  ─→  your app
   ...             ─┤   outbound only
Head office server ─┘   ONE of them also sends masters
```

---

## Rule 1 — Masters come from one branch only

Items, suppliers, salesmen and categories are the same everywhere. If every
branch pushed them you would get 24 agents writing 69,000 identical rows over
each other every hour: wasted bandwidth, and a race over which version wins.

So exactly one branch is marked `is_master = true`. Only that agent syncs
masters. The others skip them entirely.

The database enforces this — a unique index allows only one master branch to
exist. You cannot accidentally configure two.

**If the master branch is offline**, masters simply don't update that day.
Nothing breaks; item names rarely change hourly.

## Rule 2 — Transactions carry their branch

Sales, stock and movements are always tagged with `branch_id`. Two branches
selling the same item on the same day are two separate rows, never merged.

Every transaction table has a **natural key**:

| Table | Key |
|---|---|
| `sales_daily` | branch + date + location |
| `sales_salesman_daily` | branch + date + location + salesman |
| `sales_item_daily` | branch + date + location + item |
| `stock_balance` | branch + location + item |
| `stock_movements` | branch + direction + document + line |

This is what makes the sync safe to re-run. Send the same day twice and the
second write updates the first rather than adding to it. Your sales cannot
double, which is section 7 of your sales spec, solved structurally rather than
by checking for duplicates.

## Rule 3 — Each branch keeps its own watermark

`sync_state` holds one row per branch per stream, with the last date and record
number successfully sent.

The agent asks its local server for everything after that point. So:

- A normal run moves a few hundred rows
- A branch offline for a week catches up on the next run, automatically
- Nobody has to notice or intervene

**One branch failing does not affect the others.** They are independent by
design — this is the main advantage of an agent per branch over one central
puller.

## Rule 4 — Aggregate at the branch, not in the cloud

The agent runs `group by` on the local SQL Server and sends the result. A
branch with 200,000 line items a year sends a few hundred rows a day.

Raw bill lines are never sent for old periods. Only a rolling window of item
detail, because that is the only part anyone acts on. The branch server keeps
everything and remains the system of record.

This matters for cost as much as speed: your whole group fits comfortably
inside a $25 Supabase plan instead of outgrowing it in a year.

## Rule 5 — Targets live only in the app

Targets do not exist in the billing software, so nothing syncs them and nothing
can overwrite them. The `targets` table also never updates a row — a changed
target inserts a new one and points the old at it through `superseded_by`, so
you keep the history of what was agreed and when.

---

## What each branch agent does

Same program, different `config.json`:

```json
{
  "branch_code": "TDP",
  "is_master": false,
  "billing": { "server": "localhost\\SQLEXPRESS", "database": "MAHA002_001" },
  "supabase": { "url": "...", "service_key": "..." }
}
```

On each run:

1. Read its watermark from Supabase
2. Run the aggregation queries against its local server for anything newer
3. Push results, keyed so re-runs are safe
4. Update the watermark and the health record
5. If it is the master branch, sync items, suppliers and salesmen too

Failures are recorded per branch per stream, so `v_branch_health` shows you at a
glance which showroom stopped reporting and when.

---

## Monitoring

```sql
select * from v_branch_health;
```

`hours_since_ok` above 24 for any branch means that showroom's server is off,
its internet is down, or the task stopped. With 24 branches this becomes a
daily glance, and it's the reason the health table exists at all.

---

## What this does NOT do, deliberately

**No writing back to branch servers.** The agents read only. A bug in this
system can never damage billing data at a showroom.

**No live connection between branches.** Nothing depends on all servers being
up at once. A branch with no internet for three days still bills customers
normally and catches up afterwards.

**No raw bill storage.** If you ever need a specific old bill, it is on the
branch server where it was created.

---

## What I still need before writing the agent

**The branch mapping.** Which showroom is which, and what number identifies it
inside its database. Something like:

```
Thodupuzha    → MAHA002_001, location 014
Perinthalmanna→ MAHA002_001, location 006
```

**Whether MAHA002_001 holds several locations or one.** The stock check showed
113 pieces at 014 and zero at 001 and 006 — separate stock, so that one
database is tracking multiple places. Either the head office server holds data
for several showrooms, or those numbers are floors and sections within one
showroom. Your answer changes whether `location_code` is a real dimension or
always '000'.

**How many servers exist today.** You said each branch has its own. If so, how
do the numbered tables inside each branch's database work — does each branch
see only its own, or a copy of everything?

Once those are answered the agent is a day's work, because everything else —
column names, cost price, the salesman link — is already decoded.

---

## Order of building

| Stage | What |
|---|---|
| **Now** | Run `13_branches.sql`. The structure exists and can be reviewed. |
| Next | Register branches once the mapping is known |
| Next | Extend the agent with branch awareness and watermarks |
| Then | One branch syncing sales, verified against its own billing reports to the rupee |
| Then | Roll out to the rest, one at a time |
| Then | Dashboard, targets, salesman ranking |

**Verify one branch completely before connecting a second.** A wrong sign or a
missed discount column repeated across 24 branches is a painful thing to unpick,
and much easier to catch when there's a single day's figures to compare against
a report you already trust.
