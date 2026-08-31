# Update 8 — masters that match your billing export

Your two files are Crystal Reports exports from the billing software. The app
now reads them as they are — no reformatting.

## What is in your files

**SUPPLIER_MASTER.xls** — 1,871 rows
`SUPPLIER NAME · ADDRESS · ADDRESS 2 · PLACE · Phone`
- 57 repeated names
- only 386 have a phone number (21%)
- no GSTIN, no email

**ITEM_MASTER.xls** — 11,591 rows
`ITEM NAME · Unit · VAT · DiviName · HSN`
- **no item code column**
- only 5,761 different names — "TOP LADIES" appears 120 times, once per HSN code
- VAT is the GST rate: 5% on garments, 18% on household
- 13 divisions, HOUSEHOLD the largest at 3,843

## Two decisions this forces

**1. Item codes have to be generated.** Your billing software keeps a code
internally but doesn't export it. The app now generates `LAD-00001`, `HSE-00001`
from the division. If you can re-export *with* the billing code, do it — matching
codes later will save real trouble when sales data arrives.

**2. The repeats need merging.** The same item under 120 HSN codes is right for
GST billing and unusable for purchasing — nobody picks from 120 identical lines.
The importer offers both, defaulting to merge: **5,887 items instead of 11,591**,
keeping the most common HSN and tax rate for each.

## Step 1 — SQL

Run `supabase/08_masters.sql`. It adds `unit`, `hsn`, `tax_rate` and `division`
to items, `address2` and `place` to suppliers.

It also makes an item's own GST rate fill in automatically on order lines. Buy a
household item at 18% inside a 5% order and it corrects itself.

```sql
select column_name from information_schema.columns
 where table_name='items' and column_name in ('unit','hsn','tax_rate','division');
```
Four rows expected.

## Step 2 — two files in GitHub

`src/pages/Items.jsx` and `src/pages/Suppliers.jsx`.

## Step 3 — upload

Items → **Import Excel** → pick your file → choose merge → Import.
Suppliers → same.

Both show a progress bar and import in batches, so 5,887 items won't hang the
browser.

**Two ready files are attached** — already cleaned, deduped and coded. Upload
those and skip straight to using the app. Or upload your original `.xls` files;
the importer handles them too.

## What you get from this

Every item now carries its GST rate, so purchase order tax fills itself in.
Divisions become categories, so reports group by HOUSEHOLD, LADIES WEAR and so on
without anyone typing a category.

## One thing to fix at the source

Only 21% of your suppliers have a phone number. WhatsApp sending needs one. The
import works regardless, but sending won't. Worth getting numbers for your top 50
suppliers by value before the pilot — that covers most of your ordering.
