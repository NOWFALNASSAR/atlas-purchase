# The daily routine, and why the order matters

## Why division and supplier show "Unclassified"

A sale knows only its barcode. Division and supplier come from the
stock master.

**The stock export only lists barcodes that still have stock.** Checked
against your real file: of 30,904 rows, not one is at zero. So a batch
that sells out on Monday is gone from a stock file exported on Tuesday.

Your stock file was taken on 5 September. The sales are from the 4th.
Every barcode that sold out during the 4th had already vanished.

The proof: **all 111 matched barcodes still hold stock. Not one match is
at zero.** The other 408 sold out.

| | |
|---|---|
| Barcodes sold 4 Sept | 519 |
| In the 5 Sept stock file | 111 — 21.3% |
| Value classified | ₹45,769 of ₹2,96,336 — 15.4% |

---

## The fix: change the order, not the code

**Export the stock master in the morning, before trading starts.**

A barcode sold at 3pm had stock at 9am, so it is in that morning's file.
The `barcodes` table keeps every barcode it has ever seen, so coverage
compounds rather than resetting each day.

Do that and classification should go from 21% to near complete within a
week.

### Each morning

1. Export **STOCK MASTER** — before the shops open
2. Export yesterday's **BILLWISE**, **ITEMWISE**, **SALESMANWISE**
3. `node scripts/import-masters.mjs STOCK_MASTER.xlsx`
   → run the parts it writes
4. `node scripts/import-sales.mjs BILLWISE.xlsx ITEMWISE.xls SALESMANWISE.xls`
   → run the file it writes
5. In Supabase: `select * from relink_sales();`

Step 5 goes back over every older sales row and fills in anything the
barcodes table has learned since. Yesterday's unclassified rows get
classified once today's stock file teaches the system what they were.

### Watch it improve

```sql
select * from v_sales_unclassified order by sale_date desc;
```

`pct_value` is the number that matters — unclassified rupees, not
unclassified rows. If it is still high after a week of morning stock
uploads, the timing fix is not working and the real answer is below.

---

## The proper fix, which costs your vendor ten minutes

Ask them to add **DiviCode** and **SupCode** to the ITEMWISE export.
Two columns.

Then a sale carries its own division and supplier and none of this
matters — no timing, no compounding, no unclassified. It is the right
answer and everything above is a workaround for not having it.

Worth asking before you build a habit around the workaround.
