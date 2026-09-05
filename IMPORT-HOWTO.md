# Loading the stock data

## This does not go in GitHub

The files in `supabase/` are schema — they belong in the repo, they get
reviewed, they run once per environment.

`import-2026-09-05-part*.sql` is 9 MB of your stock data, run once.
Committing it would bloat the repo and slow every clone for something
that is never read again. Download the files, run them, keep them
somewhere ordinary like Google Drive if you want a record.

Only `scripts/import-masters.mjs` belongs in the repo — that is the tool
that generates them, and you will use it again for the next export.

---

## If you have already tried an import

Run **`supabase/39_import_repair.sql`** before anything else.

Re-running part 01 duplicated the item and supplier masters, because
those tables had no unique index on the name and so
`on conflict do nothing` had nothing to detect. The repair removes the
duplicates, adds the indexes, and clears today's snapshot so the import
can start again cleanly.

It is safe to run even if nothing was duplicated.

---

## Order

**If you have run anything before, the order is 39 then 38, not 38 then
39.** The repair drops the twelve views so a column can be retyped, and
38 is what puts them back. Running 38 first just recreates views that
39 then has to drop again.

| | File | Why |
|---|---|---|
| 1 | `39_import_repair.sql` | only if you have already tried an import |
| 2 | `38_item_barcode_stock.sql` | creates tables, recreates the views |
| 3 | import parts 01 to 12 | the data |

**On a completely fresh database**, skip 39 and start at 38.

**2. Then the twelve parts, in order.**

Supabase → SQL Editor → New query → paste part 01 → Run. Then part 02.
And so on to part 12.

Each part is its own transaction, so a failure in part 7 leaves parts
1 to 6 safely loaded. You fix and rerun from 7, not from the start.

**Every part can now be run twice safely.** Items and suppliers update
in place, barcodes update in place, and part 01 clears today's snapshot
before making a new one. If you lose your place, start again from 01.

Why twelve files: the SQL editor is a browser text box, not a file
loader. Nine megabytes in one paste will hang it.

---

## One thing the import does to your data

**20 batches appear on more than one row** in the export — same barcode,
same purchase reference, same item, same price, same arrival, with the
quantity split across rows. Postgres will not update the same key twice
in one statement, and dropping the extra rows would lose 11,512 pieces
worth about ₹16 L.

So they are added together: quantities and value summed, unit cost and
stock percentage recomputed from the combined figures.

That is why the import loads **30,883 barcodes rather than 30,904**,
while the piece count and the total value stay exactly the same.

---

## What each part does

| Part | Contents |
|---|---|
| 01 | item master, suppliers, purchase types, the snapshot record |
| 01–06 | the 30,904 barcodes |
| 06–11 | the 30,904 stock lines |
| 12 | matches item and supplier codes onto the masters, then counts |

Part 12 prints a summary. Expect roughly:

| | |
|---|---|
| items | 11,585 |
| items with a code | ~3,539 |
| suppliers | 1,907 |
| suppliers with a code | ~1,098 |
| barcodes | 30,904 |
| stock lines | 30,904 |

Items and suppliers without a code have never appeared in a stock
export. They pick one up next time.

---

## Then check it

```sql
select * from v_stock_ageing order by sort_order;
select * from v_stock_by_purchase_type order by value desc;
select * from v_stock_by_division_now order by value desc;
select count(*), sum(value_at_cost) from v_dead_barcodes;
```

The ageing query should show around **₹837 L in the "over a year"
bucket, 76.6% of the total**. If it does, the load is correct.

---

## Faster, if you have a computer you can install things on

One command instead of twelve pastes:

```bash
psql "YOUR_SUPABASE_CONNECTION_STRING" -f import-2026-09-05-part01.sql
```

The connection string is under Supabase → Project Settings → Database →
Connection string → URI. Or loop the lot:

```bash
for f in import-2026-09-05-part*.sql; do
  echo "running $f"
  psql "YOUR_CONNECTION_STRING" -f "$f" || break
done
```

Worth the fifteen minutes to install psql if you will be importing stock
regularly, which you will.

---

## Next time

```bash
node scripts/import-masters.mjs NEW_STOCK.xlsx
```

The item and supplier files are optional after the first run — pass them
only when those masters have changed. Each stock upload creates a new
snapshot, so this week can be compared against last.
