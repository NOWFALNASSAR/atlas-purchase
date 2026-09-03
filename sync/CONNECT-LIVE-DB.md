# Connecting the live database to Supabase

Your live billing runs on **DBSERVER-ATLAS**, with masters in `Aiy_GBS_Tex`.
Everything below happens once; after that the sync runs by itself.

---

# PART A — On the server (30 minutes, one time)

Sit at the DBSERVER-ATLAS machine and log in as a Windows administrator.

## A1. Open SSMS there

Server name: `localhost`
Authentication: **Windows Authentication**

A local Windows admin can always get in, whatever the sa password is.

## A2. Find the database names

```sql
select name, create_date from sys.databases where database_id > 4 order by name;
```

You should see `Aiy_GBS_Tex` and a transaction database beside it. **Write both
names down** — you need the transaction one for the config.

Confirm it is the live data:

```sql
use [THE_TRANSACTION_DB];
select count(*) as barcodes, sum(Balance) as pieces from dbo.Stock where Balance <> 0;
select max(ArrDate) as last_arrival from dbo.PurchTemp1;
```

About 13.2 lakh pieces and a recent arrival date means this is the right one.

## A3. Allow SQL logins

Right-click the server name at the top of Object Explorer → **Properties** →
**Security** → **SQL Server and Windows Authentication mode** → OK.

Then right-click the server name → **Restart**. It does not take effect otherwise.

## A4. Create the read-only login

```sql
create login atlas_readonly with password = 'NOWFY50963',
  check_policy = off, check_expiration = off;
```

Then for **both** databases:

```sql
use Aiy_GBS_Tex;
create user atlas_readonly for login atlas_readonly;
alter role db_datareader add member atlas_readonly;

use [THE_TRANSACTION_DB];
create user atlas_readonly for login atlas_readonly;
alter role db_datareader add member atlas_readonly;
```

**Test that it cannot write.** Connect as `atlas_readonly` and try:

```sql
select top 5 BarCode, Balance from dbo.Stock;   -- must work
delete from dbo.Stock where BarCode = 'ZZZZ';   -- must be REFUSED
```

If that delete succeeds, stop and fix the permissions before going further.

---

# PART B — Install the agent (20 minutes)

**Run it on the server**, not your PC. It needs to run hourly whether or not
anyone is logged in, and the server is always on.

## B1. Python

python.org/downloads → tick **Add python.exe to PATH** → Install.

```
python --version
pip install pyodbc
```

## B2. The folder

Create `C:\atlas-sync` on the server and put in it:

- `sync_atlas.py`
- `config.atlas-live.json` — rename to `config.json`

## B3. Fill in two values

Open `config.json` in Notepad:

- `"database"` — the transaction database name from A2
- `"service_key"` — your Supabase service_role key

Everything else is already correct.

## B4. Test before pushing anything

```
cd C:\atlas-sync
python sync_atlas.py --test
```

This reads the data, prints the totals, and **sends nothing**. You should see:

```
Connected to DBSERVER-ATLAS / ... (read only)
Godown stock
  ..... barcodes read
  balance 1,322,433 pcs   cost 11.04 Cr   selling 22.xx Cr
```

**Compare those against your Excel report.** Balance was 13,22,433 pieces and
₹11.04 Cr. If they match, everything downstream is trustworthy. If they do not,
tell me both figures before running a real sync.

## B5. The real run

```
python sync_atlas.py --full
```

Then in Supabase:

```sql
select count(*) as items, sum(qty) as pieces,
       round(sum(cost_value)) as cost, round(sum(selling_value)) as selling
  from godown_stock;
```

## B6. Automate

`run-sync.bat` in the same folder:

```
@echo off
cd /d "%~dp0"
python sync_atlas.py >> sync.log 2>&1
```

Task Scheduler → Create Basic Task → Daily 9 AM → repeat every 1 hour for 12
hours → Start a program → `C:\atlas-sync\run-sync.bat` → tick **Run whether
user is logged on or not**.

---

# Working from your PC afterwards

Once Part A is done you can reach the server from your own machine for SSMS
work. On the server, open **SQL Server Configuration Manager**:

- Protocols → **TCP/IP** → Enable
- Services → **SQL Server Browser** → Automatic, then Start
- Services → **SQL Server** → Restart

Then Windows Firewall → Advanced → Inbound Rules → New Rule → Port → TCP →
**1433** → Allow.

From your PC: server `DBSERVER-ATLAS`, SQL Server Authentication,
`atlas_readonly` / `NOWFY50963`.

The agent itself does not need any of this — it runs on the server and only
makes outbound connections.

---

# What the agent reads

Built from your own report query, so the joins match how the billing software
actually works:

| Table | Used for |
|---|---|
| `Stock` | one row per barcode — Opening, Purchase, Sales, **Balance** |
| `PurchMain` | rates, brand, subclasses, sell rate |
| `PurchTemp1` | invoice number, invoice date, arrival date |
| `Aiy_GBS_Tex.Item` | item name, division, tax code |
| `Aiy_GBS_Tex.DiviMast` | division names |
| `Aiy_GBS_Tex.Brand` / `Supplier` / `Place` / `Tax` | the other masters |

`Balance` is taken as the billing software calculates it, so the app cannot
disagree with your reports. Barcodes starting `XX` are excluded, as in your
own query.

Three rates are carried through: **purchase** (`PurRate`), **cost**
(`NetAmt ÷ PurQty`, landed) and **selling** (`SelRate`).

---

# If something fails

| Message | Cause |
|---|---|
| `Login failed for user 'atlas_readonly'` | A3 restart skipped, or password mismatch |
| `Invalid object name 'dbo.Stock'` | wrong transaction database in config |
| `Invalid object name 'Aiy_GBS_Tex...'` | masters database named differently — check A2 |
| `Invalid column name` | a column differs — send me the name |
| `HTTP 401` | wrong Supabase service key |

Always run `--test` first after any config change. It costs nothing and tells
you whether the numbers are right before anything is written.
