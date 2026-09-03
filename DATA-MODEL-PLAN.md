# The data model, and what to fetch

## What your report told us

| | |
|---|---|
| Purchases, year to date | ₹53.06 Cr |
| **Balance stock** | **₹11.04 Cr**, 13.22 lakh pieces |
| Average value per piece | ₹83.50 |

The ₹53 Cr we spent a day chasing was purchases, not stock. Balance is ₹11 Cr.

**The formula, confirmed on LADIES WEAR to the rupee:**

```
opening + purchase − sales + otherAdj  =  balance
456,779 + 972,727 −  2,702 − 880,759   =  546,045
```

`OtherAdj` is transfer out. Purchase returns are already netted inside the
purchase figure — subtracting them again gives the wrong answer.

**So balance is calculated, not stored.** Neither `qty` nor `avlQty` in
`STOCKMST001` is the balance, which is why nothing we read ever matched. Any
figure the app shows has to be computed the same way your report computes it.

---

## Two levels of data, and both are needed

Your screenshots show the structure clearly.

**Item master** — created once per product. Holds item name, HSN, tax rate,
Section/Division, unit, and the classification frame (Size, Colour, Design,
Class4–7, plus G1–G5 groups).

**Barcode** — created at each purchase arrival. Holds brand, barcode, the item
it belongs to, design, colour, size, purchase rate, quantity, VAT, cost rate,
and sale price.

So one item has many barcodes, and **the price, brand and purchase details live
on the barcode, not the item**. The same DENIM SKIRT GIRLS bought twice at
different rates is two barcodes.

That is why some screens work with items and others need barcodes:

| Screen | Grain | Why |
|---|---|---|
| Purchase order | **item** | you order a product, not a specific barcode |
| Item picker | **item** | 5,800 products, not 69,000 barcodes |
| Inventory reports | **barcode** | rates and stock differ per barcode |
| Sales reports | **barcode** | margin depends on which batch sold |
| Ageing | **barcode** | age is per arrival, not per product |

**The rule: store at barcode level, group to item level for display.** You can
always aggregate barcodes up to an item; you can never split an item back down.

---

## One thing worth naming

On the pricing screen, **Colour is set to "CASH AND CARRY"** — you are using
that field to record the purchase type. That is what you meant by "payment type
wise (colour)".

It works, and reports can group by it. But be aware the field is labelled
Colour everywhere in the billing software, so anyone else reading the data will
misinterpret it. In our app I will label it **Purchase type** and keep the real
colour separate if you ever start using it properly.

---

## What the sync should fetch

**Barcode-level stock**, one row per barcode, with:

- barcode, item code, item name
- brand, design, colour (purchase type), size
- division/section, category, sub category, HSN, tax rate
- purchase rate, cost rate, selling rate
- opening quantity as at 1 April 2026
- purchases, sales, transfers out since then
- **balance computed**, not read

**Purchase lines** since 1 April 2026 — already working.

**Transfers out** since 1 April 2026 — already working.

**Sales lines** since 1 April 2026, at barcode level, with cost — this gives
margin per barcode, per item, per division.

Everything before 1 April 2026 is ignored. You said the data is unreliable
before then, and mixing it in would pollute every report. Opening stock at that
date is taken as given.

---

## What this changes in the app

The Inventory page keeps its drill-down, but each level now aggregates barcodes:

```
Division → Category → Brand → Item → Barcode
```

Tapping through to an item shows its barcodes with their individual rates and
ages, which is what tells you that the same shirt sits in your godown at three
different costs from three arrivals.

The Purchase module stays at item level. Nothing changes there.

---

## What I still need

**1. Where is opening stock as at 1 April 2026?**

`opstock` in `STOCKMST001` is a candidate, but its total is 692,995 pieces
against your report's 946,556. Either it is a different date, or opening lives
elsewhere. If your billing software has a year-opening table, that is the one.

**2. Which table holds the item master?**

`STOCKMST001` is barcode-level. The Item Master screen you showed — with
Section/Division, HSN and classification — writes somewhere else. Try:

```sql
select name from MAHA002_001.sys.tables
 where name like '%ITEM%' or name like '%PRODUCT%' or name like '%MASTER%'
 order by name;
```

**3. How does DiviCode map to division names?**

Your report has DiviCode 2 = LADIES WEAR, 3 = KIDS WEAR, 6 = GENTS WEAR. In
`STOCKMST001`, `DIVISION` is blank and `groupcode` holds GIRLS, BOYS, SHIRTS —
which is the level below. The mapping table is probably `LOOKUP`:

```sql
select typ, count(*) from MAHA002_001.dbo.LOOKUP group by typ;
select * from MAHA002_001.dbo.LOOKUP where typ = 'Division';
```

**4. Which report produced the spreadsheet?**

Its exact name in the billing menu, and the date range you ran it for. If I can
see the report the app should match, I can reconcile against it precisely rather
than by inference.

---

## Order of work

1. Answer the four questions above
2. Rewrite the stock sync to compute balance from opening plus transactions
3. Reconcile one division to the rupee before touching the others
4. Then all 13 divisions
5. Then extend to the other 20 locations for the group picture
6. Then sales at barcode level, which gives margin per batch

**Step 3 is the one that matters.** One division matching exactly proves the
whole method. Building all the reports first and reconciling afterwards is how
you end up with a system nobody trusts.
