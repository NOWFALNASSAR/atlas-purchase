# Update 7 — reports fixed, real PDF sending, upload formats

## Step 1 — SQL

Supabase → SQL Editor → paste all of `supabase/07_update.sql` → **Run**. Then:

```sql
select 'purchase lines view' as item, count(*)::text as found
  from information_schema.views where table_name='v_purchase_lines'
union all
select 'shop view', count(*)::text from information_schema.views
 where table_name='v_shop_allocation'
union all
select 'pdf bucket', count(*)::text from storage.buckets where id='po-pdfs'
union all
select 'pdf_url column', count(*)::text from information_schema.columns
 where table_name='purchase_orders' and column_name='pdf_url';
```

All four must be 1.

## Step 2 — five files in GitHub

| File | What changed |
|---|---|
| `src/lib/pdf.js` | uploads the PDF and makes a supplier link |
| `src/pages/PODetail.jsx` | send PDF, copy link |
| `src/pages/Reports.jsx` | now includes godown stock — this was the blank report |
| `src/pages/Items.jsx` | See format button and format guide |
| `src/pages/Suppliers.jsx` | See format button and format guide |

---

# 1. Why reports were blank

Reports read from the shop allocations only. After Update 5, stock you buy sits
in the **godown** until you send it to a shop — so an order with everything in the
godown had no shop rows, and the report showed nothing.

Reports now read a view that covers both: what went to each shop, plus what is
still in the godown, listed as **Godown (not sent yet)**.

Two other reasons a report can look empty, both now handled:

- **Only approved orders count.** Drafts and pending orders are excluded, because
  they are not commitments yet. There's now a tick box — *Include drafts and
  orders awaiting approval* — when you want to see everything.
- **The date range** defaults to this month. Widen it if you're looking for older
  orders.

## 2. Sending the PDF to the supplier

**On a phone** the PO PDF now attaches itself to the message. Tap
**Send PDF on WhatsApp** → your phone's share sheet opens with the real PDF file →
pick the supplier → send. The supplier receives an actual PDF attachment.

**On a laptop** browsers cannot attach a file to WhatsApp Web. So the PDF is
uploaded and the message carries a link. The supplier taps it and the PDF opens.
Same result, one extra tap for them.

**Copy PDF link** gives you the link on its own, to paste anywhere — a supplier
group, an email, your own records.

The link stays valid, so a supplier can reopen the PO later. Filenames carry a
random id, so nobody can guess another supplier's PO link.

*Fully automatic sending — where the app sends the message itself with no tapping —
needs the WhatsApp Business API through a provider, with Meta-approved templates
and a per-message cost. That's a separate decision when you're ready.*

## 3. Upload formats

Both **Items** and **Suppliers** now have a **See format** button, and a
collapsible *Excel upload format* panel showing the exact column headings with a
sample row.

**Download blank format** gives you a real .xlsx with the correct headings and one
example row. Delete the example, fill in your data, upload it back. No guessing.

## Test it

1. Reports → this month → your approved orders appear, godown rows included
2. Tick "include drafts" → drafts appear too
3. Reports → by shop → a "Godown (not sent yet)" row for unallocated stock
4. Open an approved order on your phone → Send PDF on WhatsApp → share sheet with the PDF
5. Same on a laptop → message carries a working link
6. Items → See format → an Excel file downloads with the right headings
