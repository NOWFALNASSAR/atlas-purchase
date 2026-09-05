# What to ask the billing vendor for

## One change to one export

The godown master export currently has a **stock greater than zero**
filter on it.

Proof from the file you sent: 30,904 rows, and the smallest stock value
is **0.01**. Not one row is at zero. A barcode that has left the godown
is simply not in the file.

**Ask for the same export with that filter removed.** Same columns, just
more rows — every barcode ever created, including those now at zero
stock.

In most billing systems this is a tick box like *include zero stock* or
*all items*, or removing a `Stock > 0` condition from the report
definition. It should take them minutes.

---

## Why it matters

A sale knows only its barcode. Division, supplier, brand and item name
all come from the godown master, because that is where barcodes are
created. When a barcode is missing from the export, the sale cannot be
classified.

On 4 September alone:

| | |
|---|---|
| Barcodes sold | 519 |
| Present in the export | 110 |
| **Missing — sold out, so filtered away** | **409** |
| **Sales value that could not be classified** | **₹2,51,042 of ₹2,96,336 — 85%** |

Those 409 are not unknown items. The godown created every one of them
and still holds their details. They are filtered out for having no stock
left.

---

## Already handled at this end

The importer is ready for the unfiltered file. Tested against a
simulated one:

- **every** barcode goes into the classification master, stock or not
- **only** rows with stock go into the stock snapshot

So a zero-stock barcode classifies its sales without dragging the stock
reports down with rows worth nothing. Stock value stayed exactly
₹10.94 crore across both versions of the file; the barcode count went
from 30,883 to 31,292.

It also warns you now if a file still has the filter on it:

```
every row has stock. If this is the full godown master, the export
still has a "stock greater than zero" filter on it — ask for it off,
or sold-out barcodes stay unclassified on the sales reports.
```

---

## While you wait

Run `relink_sales()` after each stock import. It goes back over older
sales rows and fills in whatever has since been learned, so nothing
stays unclassified once the information arrives.

## Worth asking at the same time

If the vendor can add **DiviCode** and **SupCode** to the ITEMWISE sales
export, none of this matters at all — the sale carries its own
classification and no lookup is needed. Two columns. Worth asking in the
same conversation.
