# Connecting your billing database

Your billing software runs SQL Server on a local machine, and the vendor won't
help. That's fine — it's your data and you can read it yourself.

**Time: about half a day, spread over two sessions.**

---

## How it will work

```
Billing SQL Server          Sync agent               Supabase (cloud)
 (your office PC)    →    (same or nearby PC)   →    (Mumbai)
                          reads, every 30 min         your app reads
   READ ONLY                outbound only              from here
```

Nothing is opened on your firewall. The agent makes outbound connections only,
exactly like a browser does. The billing database is never exposed to the
internet, and the agent has no code that can write to it.

---

# PART A — Find out what's in the billing database

You cannot sync what you can't name. This part is discovery.

## A1. Install SQL Server Management Studio

On the billing server, or any office PC that can reach it.

Search for **SSMS download** on Microsoft's site. It's free. Install with the
defaults, about 10 minutes.

## A2. Connect

Open SSMS. In the connect box:

- **Server name**: `localhost\SQLEXPRESS` if you're on the billing server itself.
  From another PC, `SERVERNAME\SQLEXPRESS` or the server's IP.
- **Authentication**: try **Windows Authentication** first. If that's refused,
  you need the `sa` password — the billing vendor set it during installation,
  and it's often in their setup notes or written on the install sheet.

If you cannot connect at all, stop here and tell me the error message.

## A3. Run the discovery queries

Open `sync/discover.sql`, run the queries one at a time.

**Every query in that file is read-only.** Nothing is changed.

Query 1 lists the databases — the billing one is usually the largest and named
after the software or your company. Switch SSMS to that database using the
dropdown at the top.

Query 2 lists every table with its row count. This is your map. Tables with
around 11,500 rows are probably items; around 1,800 rows, suppliers.

Queries 3 and 4 are the clever ones. They search every text column in the whole
database for a value you already know — "TOP LADIES" for items, "A K FASHION"
for suppliers — and tell you exactly which table and column holds it. You don't
have to guess at table names.

Queries 5 and 6 show you the columns and a few real rows of those tables.

Query 7 finds the sales tables, for later.

Query 8 checks for a "last modified" column. If one exists, syncing gets much
faster because only changed rows need reading.

## A4. Send me the results

Copy the output of queries 2, 5, 6 and 8. From that I'll write your exact
config — the real table names, the real column names.

**Careful with query 6:** it shows real data. Blank out anything you don't want
to share; I only need the column names and the shape of the values.

---

# PART B — A read-only login

Never let the sync agent use the `sa` account. Make it its own login that can
only read.

In SSMS, **New Query**, and run this against the billing database:

```sql
-- change the password
create login atlas_readonly with password = 'Choose-A-Strong-Password-123!';

use [YOUR_BILLING_DATABASE];   -- the name from query 1
create user atlas_readonly for login atlas_readonly;
alter role db_datareader add member atlas_readonly;
```

`db_datareader` means read every table, write nothing. Even if the agent had a
bug, or the password leaked, nobody could damage your billing data with it.

Test it: File → Connect, sign in as `atlas_readonly`, and try
`select top 5 * from dbo.ItemMaster`. Reading should work. Try
`delete from dbo.ItemMaster` — it must be refused. If a delete succeeds, the
permissions are wrong, so stop and fix it.

---

# PART C — Prepare Supabase

Run `supabase/10_sync.sql`. It adds `external_id` to items and suppliers — the
billing software's own code, which is what will let purchase and sales data
match later — plus a `sync_log` table so you can see whether the sync is
running.

Then get the **service role** key: Supabase → Settings → API → `service_role`.

**This key bypasses all security.** It goes in one file on one office PC and
nowhere else. Never in GitHub, never in the app, never in a WhatsApp message.

---

# PART D — Install the agent

On the office PC that will run the sync. It must be on and connected during
working hours; the billing server itself is the obvious choice.

## D1. Python

Download from **python.org/downloads**. During installation, tick
**"Add Python to PATH"** — easy to miss, and nothing works without it.

Check it worked. Open Command Prompt:

```
python --version
```

## D2. The database driver

```
pip install pyodbc
```

If that errors, you also need Microsoft's **ODBC Driver 17 for SQL Server** —
search that name, download, install, then run the pip command again.

## D3. The files

Make a folder `C:\atlas-sync` and put in it:

- `sync.py`
- `config.example.json`
- `run-sync.bat`

Copy `config.example.json` to `config.json` and fill in:

- your billing server name, database name, and the `atlas_readonly` password
- your Supabase URL and service role key
- **the table and column names from Part A**

The `query` lines are ordinary SQL. Once you know the real names, they look
something like:

```json
"query": "select ItemCode, ItemName, DiviName, HSN, Unit, VAT from dbo.ItemMaster"
```

## D4. First run

```
cd C:\atlas-sync
python sync.py
```

You should see it connect, read, and push. Then check in the app: Items and
Suppliers should now show your real billing codes.

Check the log in Supabase too:

```sql
select * from v_sync_status;
```

---

# PART E — Make it automatic

Windows **Task Scheduler** → Create Basic Task:

- Name: `Atlas billing sync`
- Trigger: Daily, repeat every 30 minutes for 12 hours
- Action: Start a program → `C:\atlas-sync\run-sync.bat`
- Tick **Run whether user is logged on or not**

Masters change rarely, so every 30 minutes is generous. Hourly is fine too.

---

# PART F — Watch it

The agent writes to `sync.log` in its folder, and to `sync_log` in Supabase.

Check weekly:

```sql
select * from v_sync_status;
```

`hours_ago` above 24 means it has stopped. Usual causes: the PC was switched
off, Windows updated and rebooted, the password changed, or the internet was
down at the time.

---

# What can go wrong, and what it means

| Problem | Cause |
|---|---|
| `Login failed for user` | wrong password, or the login wasn't created in the right database |
| `Data source name not found` | ODBC Driver 17 isn't installed |
| `Invalid object name 'dbo.ItemMaster'` | wrong table name — recheck Part A |
| `HTTP 401` | wrong Supabase service key |
| `HTTP 409` | a duplicate code in the billing data; the agent skips these |
| Runs but nothing appears | the `query` returned no rows — run it in SSMS to see |
| Stopped after a vendor update | the vendor renamed a column; rerun Part A |

That last one is worth expecting. Reading a vendor's tables directly means their
updates can break your sync without warning. It's not fragile day to day, but
check the sync after any billing software update.

---

# What to sync, in order

**1. Items and suppliers.** What the agent does now. The real item codes are the
prize here — your Excel export doesn't have them, and without them purchase and
sales data can never be matched.

**2. Sales invoices.** The same agent, more tables, once your sales module
exists. Design the sync now and you get the sales module far cheaper later.

**3. Nothing else.** Don't sync stock, ledgers or customers until you have a
module that uses them. Data with no purpose is just something else that breaks.

---

# One decision to make now

**Do the items in your billing software have one code per item, or one per HSN?**

Your Excel export showed "TOP LADIES" 120 times. If the database has 120 rows
with 120 different codes, they are genuinely separate items to the billing
software, and your purchase dropdown will have 11,500 entries.

If so, we sync all of them but group them for the buyer — one line to choose,
with the HSN variants underneath.

Query 6 in the discovery file will tell us. Send the results and I'll design
around whatever is actually there.
