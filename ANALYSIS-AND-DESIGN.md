# The three files, and what they tell us

Read before any code is written. The design that follows comes out of
what is actually in the data, not what a stock system usually looks
like.

---

## 1. What each file contains

### STOCK MASTER — 30,904 rows, 23 columns

This is the important one. It is not a list of items. **It is a list of
barcodes**, and a barcode is one batch of one item bought at one price.

| Column | What it is |
|---|---|
| `BarCode` | the stock-keeping unit — `CC2614660`, `A0113655`, `518081` |
| `Item` | the product name, repeated across every barcode of that product |
| `ItemCode` | numeric key to the item master |
| `Qty` | pieces originally received in this batch |
| `Stock` | pieces still on hand |
| `StockPer` | `Stock ÷ Qty × 100` — confirmed against the data |
| `Amount` | **value of the remaining stock at cost**, not a unit price |
| `SalePrice` | selling price for this batch |
| `SelRateAfterDisc` | discounted price, set on only 641 of 30,904 |
| `Arrival` / `NoofDays` | when the batch arrived, and its age today |
| `Supplier` / `SupCode` | who supplied it |
| `PurRefNo` | the purchase entry it came from — 7,257 distinct |
| `DiviCode` | division, keys to the second sheet |
| `BrandName` / `BrandCode` | filled on 2,342 rows |
| `Size` / `Design` | barely used — 39 and 387 rows |
| `Colour` | **not a colour — it holds the purchase type**, see below |

**Unit cost = `Amount ÷ Stock`.** Checked against `SalePrice` across all
30,904 rows: median margin 36.5%, mean 37.5%. That is a believable
garment margin, so the interpretation holds. 78 rows show cost above
sale price, which is worth someone looking at.

### The column labelled Colour is the purchase type

Of its 22 distinct values, 20 are purchase types — `CASH AND CARRY`,
`CC SCHOOL`, `CC 30 DAYS`, `CC BEDSHEET`, `PMNA FEST`, `TIRUPPUR OLD`
and so on. Only `CREAM` and `DARK CREAM` are real colours, on 2 rows out
of 30,904.

So the field is imported as `purchase_type`. Blanks and those two stray
colours become **Non CC**, so every barcode is classified and nothing
lands in an "Unclassified" bucket that then gets ignored.

What that produces:

| Purchase type | Barcodes | Value | Share |
|---|---|---|---|
| Non CC | 26,697 | ₹922.6 L | 84.4% |
| CC School | 810 | ₹53.9 L | 4.9% |
| Cash and Carry | 1,447 | ₹45.9 L | 4.2% |
| PMNA Fest | 138 | ₹23.7 L | 2.2% |
| New Tirupur CC | 137 | ₹17.8 L | 1.6% |
| the other 15 types | 1,675 | ₹29.8 L | 2.7% |

**₹171.1 L — 15.6% — is CC and named types; the rest is Non CC.**

This matters beyond stock reporting: it is the same `purchase_types`
table the purchase targets use, so target against achievement now works
on real classified stock rather than on types nobody had filled in.

Second sheet is 13 divisions: General, Ladies Wear, Kids Wear,
Household, Gentswear, Footwear, Home Decore, New Born, Non Saleable,
Footwear Online, Perfume, Sunglass, School Accessories.

### ITEM MASTER — 11,641 items

Item name, unit, tax %, cess, division. Tax rates in use: 0, 5, 18, 28.

**This export has no item code column** — but the codes are not lost.
The stock master carries `ItemCode` next to the item name, so the code
is recovered from there on import. There are also 56 duplicate names in
the export.

### SUPPLIER MASTER — 1,907 suppliers

Name, two address lines, place, phone, mobile, registration number.

**No supplier code column either**, and again it is recovered from
`SupCode` in the stock master. Only 156 have a mobile number and **none
has a GST number**.

---

## 2. The one design decision everything hangs on

**The barcode is the stock-keeping unit. The item is only the product
name.**

One item carries many barcodes — the worst case in your data has **745
barcodes on a single item**, each a separate purchase batch with its own
cost, its own sale price and its own arrival date. Here is one item:

| BarCode | Qty | Stock | Arrival | SalePrice |
|---|---|---|---|---|
| 544242 | 96 | 3 | 27 Apr 2024 | 249 |
| 514423 | 192 | 5 | 27 Apr 2024 | 499 |
| 515424 | 60 | 23 | 27 Apr 2024 | 299 |

Same product name, three different prices. Any design that treats the
*item* as the stock unit throws that away and can never answer "what did
this piece cost" or "how old is this piece".

So: **Item → Barcode (batch) → Stock → Sale**. The barcode sits in the
middle and everything joins through it.

---

## 3. What is missing, and what that costs

**There is no sales data in these three files.** They are masters plus a
stock snapshot. Every report in section 4 of your brief that needs a
sale — daily sales, salesperson, discount, GST output, sales return,
top-selling — cannot be built from what has been sent.

I can build the tables ready for it, but I would rather say so plainly
now than build a Sales screen that shows nothing.

Also absent, and each has a consequence:

| Missing | Consequence |
|---|---|
| GST numbers on suppliers | no supplier-wise GST reporting |
| HSN codes | GST returns cannot be produced from this |
| Customer data | no CRM, no customer-wise sales |
| Purchase invoice values | purchase-vs-sales needs the invoice, not the batch |

### Recovering the codes

The two master exports have no code column, but the **stock master has
both** `ItemCode` and `SupCode` alongside the names. So the codes come
from there, and the import fills them in.

Checked in the data:

- **No item code carries two names.** The code is authoritative.
- **12 item names carry two or more codes.** `MAT 57021000` has three:
  1654, 6294 and 4029.
- **5 supplier names carry more than one code.**

For those 17, matching on name would assign one of several possible
codes at random — and a wrong code joins silently to the wrong product,
which is worse than no code at all. The import fills in only names that
map to exactly one code and leaves the rest null, then reports how many
it skipped.

What actually gets filled:

| | Rows | Get a code | No code |
|---|---|---|---|
| Item master | 11,641 | 3,539 | 8,102 |
| Supplier master | 1,908 | 1,098 | 810 |

The 8,102 items with no code have simply never been in stock. They pick
up a code the first time they appear in a stock export, so this
resolves itself as more data arrives.

---

## 4. What this data already tells you

These are not hypothetical reports. Every figure below is computed from
the file you sent.

**Stock: ₹10.94 crore across 1,335,697 pieces.**

By division:

| Division | Value | Sell-through |
|---|---|---|
| Ladies Wear | ₹529.8 L | 46.3% |
| Gentswear | ₹220.2 L | 46.7% |
| Kids Wear | ₹186.6 L | 41.7% |
| School Accessories | ₹65.0 L | 59.6% |
| Household | ₹30.5 L | 59.2% |
| Home Decore | ₹28.6 L | 67.6% |

**Ageing — this is the finding worth acting on:**

| Age | Value | Share |
|---|---|---|
| 0–30 days | ₹76.4 L | 7.0% |
| 31–90 days | ₹74.1 L | 6.8% |
| 91–365 days | ₹105.4 L | 9.6% |
| **Over a year** | **₹837.8 L** | **76.6%** |

**Three quarters of your stock value has been sitting for more than a
year.** And 14,508 barcodes — ₹4.98 crore — have not sold a single
piece since arriving.

Some of that is the `Own,Thodupuzha` supplier: 13,238 barcodes, ₹241.7 L,
4.8% sell-through. If that is internal manufacturing or transfers rather
than bought stock, it should be classified separately or the ageing
report will keep pointing at it.

---

## 5. The database design

### Masters

```
divisions        code, name                              13 rows
brands           code, name                              128
item_master      code, name, division, unit, tax_pct,
                 cess_pct, hsn                           11,641
supplier_master  code, name, place, address, phone,
                 mobile, gstin                           1,907
```

Kept separate from the existing `items` and `suppliers` tables, which
serve the purchase-order module. Merging them now would break working
screens; they can be reconciled later once codes exist on both sides.

### The centre

```
barcodes         barcode          the SKU
                 item_code        → item_master
                 supplier_code    → supplier_master
                 division_code    → divisions
                 brand_code       → brands
                 purchase_ref     the purchase entry
                 arrival_date
                 qty_received     as purchased
                 unit_cost        Amount ÷ Stock at import
                 sale_price
                 sale_price_disc
                 size, colour, design
```

### Movement

```
stock_snapshots  one row per import — so you can compare
                 this week against last
stock_lines      snapshot_id, barcode, qty_on_hand,
                 value_at_cost, days_held
sales_lines      ready for the sales import: bill_no, date,
                 branch, barcode, qty, rate, discount, tax,
                 salesman
```

Stock is a **snapshot**, not a running balance. Your billing software is
the system of record for stock; this app reads it. Trying to maintain a
second live balance would guarantee the two disagree within a week, and
then nobody trusts either.

---

## 6. Reports

**Buildable today, from the stock master alone:**

1. Stock value by division, supplier, brand, item
2. Stock ageing — the six buckets above
3. Dead stock — never sold a piece, by value
4. Slow movers — under 25% sold after 90 days
5. Fast movers — over 75% sold
6. Sell-through by supplier — who sells and who fills the godown
7. Purchase quantity against remaining quantity, per item
8. Cost against sale price, and the 78 loss-making batches
9. Barcode-wise stock and value
10. Price spread — the same item at several prices
11. Batch ageing by arrival date
12. Discounted lines — the 641 with a reduced rate

**Needs the sales export before they can be built:**

Daily and monthly sales, item-wise, barcode-wise, salesperson-wise,
branch comparison, gross against net, discount analysis, GST output,
sales returns, profit and margin per sale, stock-versus-sales, opening
plus purchase minus sales equals closing.

**Needs data nobody has sent yet:**

Customer reports and CRM. Purchase returns. Tally or accounts
integration — that needs the purchase invoice, not the batch record.

---

## 7. What I suggest, in order

**First — the receiving module.** Section 1 of your brief does not
depend on any of this. It builds on approved purchase orders, which
already work. Self-contained and useful immediately.

**Second — import these three files.** Masters and the stock snapshot,
with the twelve stock reports. That turns a spreadsheet nobody opens
into something the MD can look at on a phone. The ageing figure alone
justifies it.

**Third — the sales import**, once you send a sales export. Same shape
as the stock import: upload, match on barcode, report.

**Fourth — barcode generation on purchase entry**, so new purchases
create their own batches and the app stops depending on an export from
the billing software.

One thing worth asking your billing vendor: **can the master exports
include ItemCode and SupCode directly?** The import recovers them from
the stock master today, but only for items that have been in stock. With
the code on the master export, all 11,641 items would be keyed properly
from day one — and the 17 ambiguous names would resolve too.

### Shop-wise stock and sales

Both are handled. `stock_snapshots` and `stock_lines` carry a shop, and
there is one snapshot per shop per day, so uploading Nilambur does not
overwrite Perinthalmanna. `v_stock_current` takes the newest snapshot
**for each shop** rather than the newest overall — without that, the
second upload would silently hide the first.

`v_stock_by_shop` gives value, pieces and sell-through per shop as soon
as that export arrives. `sales_lines` already carries branch, salesman,
discount and tax, so the sales export drops straight in.
