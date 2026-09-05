# The four sales files

All four are the same day — Nilambur, 4 September 2026. They are four
views of one day's trading, and they reconcile exactly.

---

## What each one is

### BILLWISE.xlsx — 208 rows, one per bill

The transaction record. Date and time, bill number, customer, amount
including tax, then the value and tax split across every GST slab
(3, 5, 12, 18, 28, 40), the cancelled flag, invoice number and branch.

**Customer is captured on 20 of 208 bills** — about one in ten — as
`name-phone`, like `raheena-9747805085`. The other 186 say `General`,
which is the till's word for a walk-in, not somebody's name. The
importer treats General as no customer; storing 186 people called
General would ruin every customer report.

One in ten is thin for CRM, but it is not nothing: 20 real names and
mobile numbers a day is roughly 600 a month, and it costs you nothing
to collect. If the counter staff asked for a number more often, this
becomes genuinely useful within a quarter.

`UserCode` is 250 on every row. That is the till, not the salesman.

### ITEMWISE_SALES.xls — 519 barcodes

Per barcode: quantity, sales value, **purchase value**, margin, margin
percentages and discount.

**The purchase value is the important column.** It means margin per
item is already in the file — you do not need to look anything up to
know what a day's trading earned.

Returns appear as negative rows. Thirteen of them that day.

### SALESMANWISE.xls — 40 salesmen

Quantity, value and bill count per person. One row is negative — code
`1 SM-1`, quantity −24, value −13,946.67. That is the returns counter,
not a salesman.

### Book1.xlsx — one row

The day summarised: total, the slab split, bill count, average bill. It
is derived from BILLWISE, so it is worth keeping as a cross-check but
carries nothing new.

---

## The numbers tie

| | |
|---|---|
| Bills | 208 |
| Sales including tax | ₹3,11,235.00 |
| **Sales without tax** | **₹2,96,336.13** |
| Tax collected | ₹14,898.85 |
| Cost of goods sold | ₹1,92,636.70 |
| **Margin** | **₹1,03,699.45 — 35.0%** |
| Discount given | ₹6,773.75 |
| Pieces sold | 720.75 |
| Average bill | ₹1,496.32 |

The item file, the salesman file and the bill file all agree on
₹2,96,336.13 without tax. That is the figure your targets and
incentives run on, and it is the one the system will use.

---

## Two things about the files worth knowing

**Every export ends with a totals row that is shifted one column left.**
The last row of ITEMWISE has `720.75` sitting in the Description column
where a barcode should be. Read naively it adds 296,336 to the quantity
total. The importer drops the last row by position, not by looking for
the word "Total" — some of your barcodes are plain numbers like
`503377` and would be mistaken for it.

**A bill can be credited to more than one salesman.** BILLWISE counts
208 bills; the salesman file's bill counts add to 384. So a salesman's
"bills" is lines they served, not whole bills. Worth agreeing internally
which one an incentive is paid on.

---

## The one limitation, and how to remove it

Division-wise and supplier-wise sales need the barcode to tell us which
division and which supplier. That mapping lives in the stock master.

**Only 110 of the 519 barcodes sold that day are in the stock file — 21%.**
Not a matching problem: the stock export only lists barcodes that still
have stock left, so a batch sold out that day is simply not in it.

Three ways forward, in order of how well they work:

1. **Ask your billing vendor to add DiviCode and SupCode to the itemwise
   export.** One column each, and division and supplier reporting becomes
   complete and permanent. This is the right fix.
2. Upload the stock master daily as well. Coverage improves but never
   reaches 100%, because sold-out batches still vanish.
3. Accept partial coverage and report the rest as "unclassified".

The importer keeps every barcode it has ever seen, so coverage builds
over time either way. But option 1 solves it properly and costs your
vendor ten minutes.

---

## Reports this supports, from tomorrow

**Daily, per branch**

- Sales with tax, without tax, tax collected
- Number of bills, average bill (basket value)
- Margin in rupees and percent
- Discount given
- Pieces sold, returns

**Salesman**

- Value without tax, quantity, bills served
- Against target, with incentive calculated
- Ranking, and day-on-day movement

**Item and barcode**

- Top and bottom sellers by value, quantity and margin
- Loss-making sales — where cost was above the selling price
- Discount by item

**Tax**

- Slab-wise taxable value and tax, ready for a GST return

**Customer** — from the phone numbers on the bills, where they were
captured

- Repeat customers, how often, how much
- Best customers by value
- Customers not seen for 60 days

Thin at one bill in ten, but it grows on its own the more the counter
staff ask.

**Over time, once a few days are loaded**

- Daily and monthly trend, branch against branch
- This period against last
- Which divisions and suppliers actually sell, once the codes are in

---

## What I suggest

Upload all four files each morning for the previous day. The importer
reads them together, reconciles them, and refuses the load if they
disagree — that check is worth having, because a file exported
mid-transaction will otherwise quietly understate the day.

Once it is running daily and you trust the numbers, move to pulling from
the billing database or an API. The table shapes will not change when
you do; only where the rows come from.
