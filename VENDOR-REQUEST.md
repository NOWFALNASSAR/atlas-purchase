# One request for the billing software vendor

Please send them this. It is one change and it unblocks the sales
reporting.

---

## The request

**The godown / stock master export has a "stock greater than zero"
filter on it. Please remove it, so the export includes every barcode
including those now at zero stock.**

Same columns, just more rows. Usually a tick box like *include zero
stock* or *all items*, or removing a `Stock > 0` condition from the
report definition.

---

## Evidence, if they ask

The file exported on 5 September has 30,904 rows. The smallest `Stock`
value in it is **0.01**. Not one row is at zero. That is a filter, not a
coincidence.

## What it costs us

On 4 September, Nilambur sold 519 barcodes. 110 were in the export. The
other **409 had sold out and were therefore filtered away**.

| | |
|---|---|
| Sales that day | ₹2,96,336 |
| Cannot be attributed to a division or supplier | **₹2,51,042 — 84.7%** |

Division-wise and supplier-wise sales are the reports we most need, and
they are 85% blank because of one filter.

---

## Alternative, if the filter cannot be removed

Add two columns — **DiviCode** and **SupCode** — to the **ITEMWISE**
sales export. Then each sale carries its own classification and no
lookup against the godown master is needed at all.

Either change solves it. The second is better.

---

## What we already checked

We did not ask before exhausting the alternatives:

- **Barcode prefix?** No. Prefix `A` is division 2 only 39% of the time,
  `CC` only 23%. Guessing would be worse than leaving it blank.
- **Barcode number range?** No. All 13 divisions overlap.
- **Another file?** No. BILLWISE has bill totals with no item detail,
  SALESMANWISE has no barcode, ITEMWISE has the barcode but no division
  or supplier.

There is genuinely nothing else to join on.

---

## What still works meanwhile

Everything except the two classification reports. For those 409
barcodes we have correct quantity, sales value, cost and margin — 34.7%
on that group. Day totals, salesman performance, item-wise sales, tax,
basket value, customers and below-cost are all complete and correct.

Only the division and supplier *labels* are missing.
