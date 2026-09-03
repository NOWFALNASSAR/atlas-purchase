# Update 11 — modules separated, sales module built

## What changed

The app is now split into four modules, each with its own pages:

| Module | Pages |
|---|---|
| **Purchase** | Dashboard, Purchase orders, New order, Rate compare, Order reports, Insights |
| **Stock** | Inventory, Godown, Transfers |
| **Sales** | Sales dashboard, Branches, Salesmen, Targets, Upload sales |
| **Masters** | Suppliers, Items, Users, Settings |

The top row switches module; the row under it shows that module's pages. On a
phone the bottom bar changes with the module. Masters is HOD and admin only.

---

## Step 1 — SQL

Run `supabase/17_sales.sql`. Then check:

```sql
select count(*) from information_schema.views
 where table_name like 'v_sales%' or table_name like 'v_salesman%'
    or table_name = 'v_target_progress';
```

Expect 9.

## Step 2 — files in GitHub

**New:**
```
src/pages/SalesDashboard.jsx
src/pages/SalesBranches.jsx
src/pages/Salesmen.jsx
src/pages/Targets.jsx
src/pages/SalesImport.jsx
```

**Replace:** `src/App.jsx`

---

# The sales module

## Upload sales

Sales come in by Excel until the branch servers are connected. Three sheet
types, and the app works out which from the column headings:

- **Daily by branch** — Date, Branch, Bills, Qty, Gross, Discount, Tax, Net Sales, Cost
- **Daily by salesman** — Date, Branch, Salesman Code, Name, Bills, Qty, Net Sales, Cost
- **Daily by item** — Date, Branch, Item Code, Item Name, Division, Brand, Qty, Net Sales, Cost

**Download format** gives you a sheet with the right headings and one sample row.

Every upload shows what it found before writing anything: rows read, rows that
will import, rows rejected with the row number and reason, the date range, and
the total value. Branch names that don't match are listed so you can fix them.

**Re-uploading a corrected sheet replaces that day** rather than adding to it.
Sales cannot double, which is the one thing that ruins a sales system.

The Branch column accepts the branch code, its full name, or its location code.
The page lists exactly what it will recognise.

## Sales dashboard

Today's sales against yesterday, month to date against target, the gap and what
you need per day to close it, branches falling behind, a 30-day bar chart, and
what sold by division.

## Branches

Every branch against its target, sorted by whatever you choose — sales,
achievement, margin, bills, basket, or gap to target. Each row shows growth
against last month and how much per day is needed to catch up.

## Salesmen

Ranked, with a top three when ranked by sales. Rank by sales, achievement,
basket value, bills, items per bill or margin.

There's a note under the table worth reading: ranking by sales alone rewards
whoever works the busiest counter. Basket value and items per bill say more
about how well someone actually sells.

## Targets

Monthly target per branch, set individually or all at once. Achievement
everywhere else is measured against these.

**Targets are never overwritten.** Changing one inserts a new row and marks the
old one superseded, so you keep the history of what was agreed and when — and
History on each branch shows it.

HOD and admin can edit; everyone else can see.

---

## Test it

1. Settings → make sure your branches exist
2. Sales → Upload sales → Download format → fill in three days for two branches
3. Upload it → check the preview counts → Import
4. Sales dashboard → the figures appear
5. Targets → set targets for those branches
6. Sales dashboard → achievement, gap and required daily now show
7. Re-upload the same file with a changed number → the day updates, total does not double

That last one is the important test.
