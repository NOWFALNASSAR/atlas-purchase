# Uploading every shop's stock

## Short answer

Yes, do it. It will close most of the gap, and it costs nothing but the
uploads.

It will not close all of it, and it is worth knowing which part is left
before you build a daily habit around it.

---

## Why it helps

A barcode sold in Nilambur on Thursday usually still has stock
somewhere — the godown, or another shop. One file from one location
misses it; ten files from ten locations find it.

The barcodes table keeps every barcode it has ever seen, from any
file. So each shop you add makes the classification better for **every**
shop, permanently. Nilambur's file classifies Perinthalmanna's sales.

---

## The part it will not fix

Every one of these exports filters out zero stock. So a barcode where
the **last piece in the company** sold today is in no file anywhere by
tomorrow morning.

That is the residual gap. It is much smaller than the 79% you have now,
but it is not zero, and it will be worst on fast-moving lines — which
are the ones you most want to see.

I cannot tell you the size from here. Upload a few shops and look at
`v_sales_unclassified`; that number is the answer.

The only thing that makes it truly zero is one of:

- the godown export with its stock filter removed, or
- `DiviCode` and `SupCode` added to the ITEMWISE sales export

Both are ten-minute changes at the vendor's end. See
`VENDOR-REQUEST.md`.

---

## One thing I had to fix first

Every shop file would have been stored as "no shop". They all collide
on the one-snapshot-per-day rule, so **each upload would have silently
deleted the one before it.** Ten shops, one survivor, and no error
message.

The importer now takes the shop:

```bash
node scripts/import-masters.mjs NILAMBUR_STOCK.xlsx --shop NILAMBUR
node scripts/import-masters.mjs PMNA_STOCK.xlsx     --shop PERINTHALMANNA
```

Leave `--shop` off only for the godown or a company-wide file. Each
shop gets its own snapshot, its own stock figures, and none of them
disturb the others.

---

## The routine, once a day

Morning, before the shops open:

1. Export stock from each location
2. Run the importer once per file, with `--shop`
3. Run the parts it writes
4. Upload yesterday's sales on **Sales → Upload BILLWISE + ITEMWISE**

The sales upload calls `relink_sales()` on its own, so anything the
morning's stock files taught the system gets applied to older sales
straight away.

### Watch it work

```sql
select * from v_sales_unclassified order by sale_date desc;
select * from v_stock_by_shop;
```

`pct_value` on the first is the number that matters. It should fall
sharply as you add shops, then flatten — and where it flattens is the
size of the residual gap described above.

---

## Two things to keep an eye on

**Stock totals now add up across shops.** If the godown file and the
shop files both contain the same goods, company stock will be
overstated. Check `v_stock_by_shop` after the first full round and tell
me if the total looks too high — the fix is to decide which files are
authoritative for stock, separately from which are used for
classification.

**Cost and price come from the most recent file.** If two shops hold the
same barcode at different prices, the last file loaded wins. That is
almost always right, but worth knowing.
