# Setting up the sync — your actual steps

Discovery is done. Your database is `MAHA002_001`, your item master is
`STOCKMST001`. This is the setup.

**About an hour.** Do it on the billing server itself.

---

## STEP 1 — Confirm the supplier table (5 minutes)

The items half is ready. The suppliers half is still a guess, so check it first.

In SSMS, run the four queries in `sync/suppliers-discover.sql`.

You are looking for:
- the real column names in `ACCOUNTS001` (my guesses were `acccode`, `accname`,
  `place`, `phone`, `gstno` — they may differ)
- whether accounts 170000–179999 really are your suppliers, showing names like
  ROOPA TEX and MAKER FASHION

**Send me those results** and I'll correct the config. Or, if the column names
match my guesses, carry straight on.

---

## STEP 2 — Read-only login (10 minutes)

Never let the sync use `sa`.

In SSMS, New Query, run this. Change the password first:

```sql
create login atlas_readonly with password = 'Atlas#Sync2026!Strong';

use MAHA002_001;
create user atlas_readonly for login atlas_readonly;
alter role db_datareader add member atlas_readonly;
```

If you also want the second entity later:

```sql
use MAHA001_001;
create user atlas_readonly for login atlas_readonly;
alter role db_datareader add member atlas_readonly;
```

**Test that it cannot write.** File → Connect Object Explorer → SQL Server
Authentication → `atlas_readonly`. Then:

```sql
select top 5 itemcode, itemname from MAHA002_001.dbo.STOCKMST001;   -- must work
delete from MAHA002_001.dbo.STOCKMST001 where itemcode = -999;      -- must be REFUSED
```

If that delete succeeds, the permissions are wrong. Stop and fix it before going
further.

---

## STEP 3 — Prepare Supabase (5 minutes)

1. Run `supabase/10_sync.sql` in the SQL Editor
2. Settings → API → copy the **service_role** key

That key bypasses every security rule. It goes in one file on one PC. Never in
GitHub, never in the app, never over WhatsApp.

---

## STEP 4 — Install Python (10 minutes)

On the billing server.

1. **python.org/downloads** → Download → run it
2. **Tick "Add Python to PATH"** on the first screen. Easy to miss, and nothing
   works without it.
3. Install

Open Command Prompt and check:

```
python --version
```

Then the database driver:

```
pip install pyodbc
```

If that fails, search for **ODBC Driver 17 for SQL Server**, install it from
Microsoft, and run the pip command again.

---

## STEP 5 — The sync folder (10 minutes)

Create `C:\atlas-sync` and put these in it from the zip:

- `sync.py`
- `run-sync.bat`
- `config.atlas.json` — **rename it to `config.json`**

Open `config.json` in Notepad and fill in four things:

| Line | What to put |
|---|---|
| `"server"` | `localhost\SQLEXPRESS`, or whatever worked in SSMS |
| `"password"` | the `atlas_readonly` password from Step 2 |
| `"url"` | your Supabase project URL |
| `"service_key"` | the service_role key from Step 3 |

Everything else — table names, column names — is already correct for your
database.

---

## STEP 6 — First run (5 minutes)

```
cd C:\atlas-sync
python sync.py
```

You should see:

```
Connected to MAHA002_001 (read only)
Reading items from billing
  69638 rows read
  69638 items to push
  items: 500/69638
  items: 1000/69638
  ...
```

It will take a few minutes on the first run. After that it is quick.

Then check in the app — Items should show your real billing codes, and in
Supabase:

```sql
select * from v_sync_status;
select count(*) from items;
select code, name, hsn, tax_rate, division from items limit 20;
```

---

## STEP 7 — Make it automatic (5 minutes)

Windows **Task Scheduler** → **Create Basic Task**

- Name: `Atlas billing sync`
- Trigger: **Daily**, start 9:00 AM
- Action: **Start a program** → `C:\atlas-sync\run-sync.bat`
- Finish, then **right-click the task → Properties**:
  - General tab → tick **Run whether user is logged on or not**
  - Triggers tab → Edit → tick **Repeat task every 1 hour** for **12 hours**

Masters barely change, so hourly is generous.

---

## STEP 8 — Check it weekly

```sql
select * from v_sync_status;
```

`hours_ago` above 24 means it stopped. Usually the PC was off, Windows rebooted
after an update, or the internet was down.

The agent also writes `sync.log` in its own folder, with the reason for any
failure.

---

# What will go wrong

| Message | Meaning |
|---|---|
| `Login failed for user 'atlas_readonly'` | wrong password, or the user wasn't created in MAHA002_001 |
| `Data source name not found` | ODBC Driver 17 not installed |
| `Invalid object name 'dbo.STOCKMST001'` | wrong database in the config |
| `HTTP 401` | wrong Supabase service key |
| `Invalid column name 'gstno'` | Step 1 wasn't done — the ACCOUNTS columns differ |
| Runs, pushes 0 rows | run the `query` line in SSMS and see what it returns |

---

# What happens to what you already have

The sync matches on `code`. Items you imported from the Excel file have
generated codes like `LAD-00001`; the sync brings in real codes like `504955`.
They will not collide — you will simply have both.

**Cleanest approach: clear the items you imported first**, so the billing codes
are the only ones. Only do this while no purchase order references them:

```sql
delete from items where code like 'LAD-%' or code like 'HSE-%'
   or code like 'KID-%' or code like 'GNT-%' or code like 'GEN-%'
   or code like 'HDC-%' or code like 'FTW-%' or code like 'SCH-%'
   or code like 'PRF-%' or code like 'SGL-%' or code like 'NBN-%'
   or code like 'NSL-%';
```

If an order already uses one, that delete will be refused — which is correct.
Leave those and let the two live side by side.

---

# Then what

Once items and suppliers sync every hour, the same agent extends to sales:
`SALES0xx` headers and `SITEM0xx` lines, per shop. Your `SITEM` rows carry cost
as well as selling price, so margin by bill, by item and by salesman comes
through without any extra work.

That's the sales module's hardest problem solved before it starts.
