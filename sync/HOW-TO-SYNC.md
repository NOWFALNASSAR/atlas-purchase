# How to sync the godown

## Before anything

Run `16_all_inventory.sql` in Supabase, all six steps. The tables must exist
before the agent can write to them.

## Step 1 — copy the file

Put `sync_inventory.py` in `C:\atlas-sync`, next to `sync.py` and `config.json`.

## Step 2 — add four lines to config.json

Open `notepad C:\atlas-sync\config.json` and add these just after the opening `{`:

```json
  "branch_code": "GODOWN",
  "branch_name": "Head Office Godown",
  "location_code": "001",
  "is_master": true,
```

Everything else stays as it is. The file should start like this:

```json
{
  "branch_code": "GODOWN",
  "branch_name": "Head Office Godown",
  "location_code": "001",
  "is_master": true,
  "billing": {
    ...
```

## Step 3 — run it

```
cd C:\atlas-sync
"C:\Users\Administrator\AppData\Local\Programs\Python\Python313\python.exe" sync_inventory.py
```

Expect:

```
Branch GODOWN registered
Connected to MAHA002_001 (read only)
Godown stock
  23674 rows read
  stock: 5000/23674
  ...
Purchases — first load from 2024-09-02
  89697 rows read
  purchases: 5000/89697
  ...
Dispatches — first load from 2026-03-06
Done. 23674 stock, 89697 purchase lines, 18862 dispatch lines.
```

The first run takes a few minutes. Later runs take seconds, because purchases
and dispatches only fetch what is newer than last time.

## Step 4 — check it landed

In Supabase:

```sql
select count(*) as stock_items, sum(qty) as pieces,
       sum(cost_value) as cost_value, sum(selling_value) as selling_value
  from godown_stock;

select count(*) as purchase_lines, min(purch_date) as from_date,
       max(purch_date) as to_date, sum(line_value) as value
  from godown_purchases;

select * from v_branch_health;
```

**Compare the cost and selling values against your billing stock report.**
If they differ, stop and tell me the two figures. Everything downstream depends
on these being right.

Then open **Inventory** in the app. It should show your godown grouped by
division, with all three rates.

## Step 5 — automate it

Edit `run-sync.bat` so both agents run:

```
@echo off
cd /d "%~dp0"
"C:\Users\Administrator\AppData\Local\Programs\Python\Python313\python.exe" sync.py >> sync.log 2>&1
"C:\Users\Administrator\AppData\Local\Programs\Python\Python313\python.exe" sync_inventory.py >> sync.log 2>&1
```

Task Scheduler then runs both hourly. Setup is Step 7 of SETUP-STEPS.md.

---

## Useful things to know

**Re-running is safe.** Every table has a natural key, so a second run updates
rather than duplicates. Run it as often as you like.

**Reload everything from scratch:**

```
python sync_inventory.py --full
```

Use this after changing a query, or if figures look wrong.

**Stock is a snapshot**, replaced each run — it is what you have now, not a
history. Purchases and dispatches accumulate.

---

## If it fails

| Message | Cause |
|---|---|
| `Invalid column name` | a column differs on your server — send me the name |
| `relation "godown_stock" does not exist` | `16_all_inventory.sql` Step 1 not run |
| `HTTP 401` | wrong service key in config.json |
| `Could not register the branch` | `branches` table missing, or Step 3 policies not run |
| `Login failed` | the read-only login password changed |

The agent stops on the first failure rather than writing half a picture.
