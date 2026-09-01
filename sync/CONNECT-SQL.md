# Connecting to your billing SQL Server — step by step

Error 87 means SSMS couldn't understand the server name you typed. This guide
finds the correct one. Work through it in order and don't skip Part 1.

**Do all of this ON the billing server itself** — the machine where the billing
software is installed. Connecting from another PC needs extra firewall setup,
and there's no reason to fight that while you're just discovering the tables.

---

## PART 1 — Find the instance name (5 minutes)

You cannot type the server name correctly until you know this.

1. On the billing server, press **Windows key + R**
2. Type `services.msc` and press Enter
3. A list opens. Scroll down to the **S** entries
4. Look for anything starting **SQL Server**

You'll see something like `SQL Server (MSSQLSERVER)` or `SQL Server (SQLEXPRESS)`.
**The word in brackets is your instance name. Write it down.**

Also check the **Status** column next to it — it should say **Running**. If it's
blank, right-click the service → **Start**.

### What to type, based on what you found

| Service shows | Type this as the server name |
|---|---|
| `SQL Server (MSSQLSERVER)` | `localhost` — nothing else, no backslash |
| `SQL Server (SQLEXPRESS)` | `localhost\SQLEXPRESS` |
| `SQL Server (BILLING)` | `localhost\BILLING` |
| anything else in brackets | `localhost\WHATEVER_IS_IN_BRACKETS` |

`MSSQLSERVER` is the default instance and is the exception — it takes no
instance name at all. That catches most people out.

**It must be a backslash `\`, not a forward slash `/`, and no spaces around it.**

### If there is no SQL Server service at all

The database is on a different machine. Find out which PC the billing software
connects to, and do all of this there instead.

---

## PART 2 — Connect with SSMS (5 minutes)

1. Open **SQL Server Management Studio**
2. The Connect to Server box appears. Fill it in:

| Field | Value |
|---|---|
| Server type | Database Engine |
| Server name | what you worked out in Part 1 |
| Authentication | **Windows Authentication** |

3. Click **Connect**

If it connects, skip to Part 4.

---

## PART 3 — If Windows Authentication is refused

Some billing installations only allow SQL logins.

1. Change **Authentication** to **SQL Server Authentication**
2. Login: `sa`
3. Password: the one the billing vendor set during installation

**Where to find that password:**

- The vendor's installation sheet or handover notes
- Sometimes in the billing software's own config file — look in its install
  folder (usually `C:\Program Files\...` or `C:\SoftwareName\`) for a file named
  `config.ini`, `settings.ini`, `db.config` or similar. Open it in Notepad. The
  connection details are often sitting in plain text.
- The billing software must connect somehow, so the credentials exist somewhere
  on that machine.

If you truly cannot find it, one phone call to the vendor asking for read-only
database access is reasonable — you're not asking them to support anything, just
to let you read your own data.

---

## PART 4 — Confirm you're in the right database

Once connected, the left panel shows **Databases**. Expand it.

Run this in a **New Query** window to see them by size:

```sql
select d.name,
       cast(sum(f.size) * 8.0 / 1024 as decimal(10,1)) as mb
  from sys.databases d
  join sys.master_files f on f.database_id = d.database_id
 where d.database_id > 4
 group by d.name
 order by mb desc;
```

The billing database is usually the largest, and named after the software or
your company. Ignore `master`, `model`, `msdb` and `tempdb` — those are SQL
Server's own.

**Select it from the dropdown** at the top of the query window. Everything after
this runs against whatever is selected there, so getting it right matters.

### Prove it's the right one

```sql
select name from sys.tables order by name;
```

You should see table names that look like a billing system — items, suppliers,
invoices, stock. If you see nothing recognisable, try the next database down.

---

## PART 5 — Find your tables

Now open `sync/discover.sql` and run the queries.

Start with query 3, which searches every text column in the database for
`TOP LADIES`. It takes a minute or two on a large database. It returns the exact
table and column holding your items — no guessing.

Then query 4 does the same for `A K FASHION` and your suppliers.

**Every query in that file only reads. Nothing is changed.**

---

## Quick alternatives if Part 1 is unclear

**See every SQL service in one line.** Command Prompt:

```
sc query type= service state= all | findstr /I "SQL"
```

(The spaces after `type=` and `state=` are required — that's how `sc` works.)

**Ask the network what's out there:**

```
sqlcmd -L
```

**Look at what the billing software itself connects to.** Search its install
folder for `.ini`, `.config` or `.xml` files and open them in Notepad. A line
containing `Data Source=` or `Server=` tells you the exact server name the
software uses — which is guaranteed correct.

---

## Errors and what they mean

| Message | Cause | Fix |
|---|---|---|
| Error 87, "parameter is incorrect" | server name malformed | forward slash instead of backslash, or a space |
| "server was not found" | wrong instance name, or service stopped | redo Part 1 |
| "Login failed for user" | wrong password, or SQL logins disabled | try Windows Authentication |
| "not associated with a trusted connection" | Windows auth not allowed | use `sa`, Part 3 |
| Connects but no useful tables | wrong database selected | Part 4 |

---

## What to send me

Once you're in and `discover.sql` has run, send:

- Query 2 output — every table with row counts
- Query 3 and 4 output — which tables hold items and suppliers
- Query 5 output — the columns of those tables
- Query 8 output — whether there's a "last modified" column

From that I'll write your exact `config.json` with the real table and column
names, and the sync will be one command away.

Query 6 shows real data — blank out anything you'd rather not share. I only need
the column names and roughly what the values look like.
