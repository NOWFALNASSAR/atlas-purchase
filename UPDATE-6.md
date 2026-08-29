# Update 6 — tax, delivery address, transporter

## Step 1 — SQL

Supabase → SQL Editor → New query → paste all of `supabase/06_update.sql` → **Run**.

Then check:

```sql
select 'tax on order' as item, count(*)::text as found from information_schema.columns
 where table_name='purchase_orders' and column_name='tax_rate'
union all
select 'tax on item', count(*)::text from information_schema.columns
 where table_name='po_items' and column_name='tax_rate'
union all
select 'line_tax', count(*)::text from information_schema.columns
 where table_name='po_items' and column_name='line_tax'
union all
select 'grand_total', count(*)::text from information_schema.columns
 where table_name='purchase_orders' and column_name='grand_total'
union all
select 'tax rate list',
  coalesce((select jsonb_array_length(value)::text from settings where key='tax_rates'),'MISSING');
```

All should be 1, and the last one 5. **If any is 0, stop and tell me** — do not
update the code files, they will only error.

## Step 2 — four files in GitHub

| File | What changed |
|---|---|
| `src/pages/NewPO.jsx` | tax rate, delivery address, transporter |
| `src/components/ItemEditor.jsx` | tax % per item, line tax shown |
| `src/pages/PODetail.jsx` | tax and payable totals, delivery details |
| `src/lib/pdf.js` | tax column, payable total, transporter on the PDF |

---

# What you get

## Tax

**On the order**, after the supplier: a tax rate dropdown, default 5%.
Every item you add inherits it.

**On each item**, next to the rates: a Tax % box. Change it only for items that
differ — a saree at 12% in an order that is otherwise 5%.

The item line now shows three figures:

```
  Line value        Tax 5%        Margin
   ₹45,000          ₹2,250        35.6%
```

And the order header shows:

```
  Quantity 100   Purchase value ₹45,000   Tax (5% default) ₹2,250
  Payable to supplier ₹47,250   Expected sales ₹69,900   Margin 35.6%
```

**Payable to supplier** is what you actually owe — value plus tax. That's the
figure that should match the supplier's invoice.

Margin is still calculated on selling price as before, on the pre-tax purchase
rate. Adding tax doesn't change your margin figures.

To change which rates are available, edit `tax_rates` in Supabase → Table Editor
→ settings.

## Delivery address and transporter

On the new order screen there's a link: **+ Delivery address and transporter**.
It stays collapsed, so orders that go to the usual godown need no extra typing.

Open it and you get: deliver-to address, transporter name (with your usual ones
suggested), transporter phone, and LR / docket number.

All optional. Blank means the usual godown.

Anything you fill in prints on the supplier PDF — the transporter in the order
details block, the delivery address below the totals.

Your standing transporter list is in settings → `transporters`.

## Test it

1. New order → tax dropdown shows 5%
2. Add an item at ₹450 × 100 → tax shows ₹2,250, payable ₹47,250
3. Change one item to 12% → totals update, header tax follows
4. Open the delivery section, add an address and transporter → shows on the order
5. Download the PDF → tax column per line, Payable at the bottom, transporter in the header
6. Change a tax rate on a pending order → History records "tax changed 5% → 12%"
