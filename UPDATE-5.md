# Update 5 — godown first, then send to shops

## Why the box was empty

The `po_item_allocations` table never got created — the same reason `purchase_type`
was missing. Part of `04_update.sql` failed partway through. `05_update.sql`
creates everything that is missing and is safe to run whether or not it exists.

## Step 1 — SQL (2 minutes)

Supabase → SQL Editor → New query → paste all of `supabase/05_update.sql` → **Run**.

Then check all four pieces are in place:

```sql
select 'purchase_type' as item, count(*) from information_schema.columns
 where table_name='purchase_orders' and column_name='purchase_type'
union all
select 'allocations table', count(*) from information_schema.tables
 where table_name='po_item_allocations'
union all
select 'shop view', count(*) from information_schema.views
 where table_name='v_shop_allocation'
union all
select 'godown view', count(*) from information_schema.views
 where table_name='v_godown_balance';
```

All four must be 1. If any is 0, tell me which.

## Step 2 — two files in GitHub

| File | What changed |
|---|---|
| `src/components/ShopSplit.jsx` | godown balance, 10 shop slots, over-send warning |
| `src/components/ItemEditor.jsx` | total quantity field is back |

Pencil icon → select all → paste → Commit. Vercel rebuilds itself.

---

# How item entry works now

```
Item              Ladies Kurti Cotton
Total quantity    100
Purchase ₹450     Selling ₹699

┌───────────┬───────────┬────────────┐
│  Bought   │ To shops  │ In godown  │
│    100    │    20     │     80     │
└───────────┴───────────┴────────────┘

  1  S06  Perinthalmanna        10  ×
  2  S12  Vaikom                10  ×

  Send to shop 3 of 10
  [ Choose shop        ▼ ]
  [ Qty (max 80) ] [ Send ]
```

**You type the total once.** All 100 pieces land in the godown.

**Then send what you want to shops.** Each one you add comes off the godown
balance, and the maximum shown in the quantity box updates as you go.

**Leftover in the godown is normal.** Buy 100, send 20, leave 80 in the godown —
the order submits fine. Allocation is optional now, not compulsory.

**Over-sending is blocked.** Try to send 90 when only 80 are left and you get
"Only 80 pieces left in the godown". The database enforces this too, so it cannot
be worked around from the browser.

**Ten shops maximum per item**, numbered as you add them.

## What changed from before

| Before | Now |
|---|---|
| No quantity field — total came from the shop rows | Type the total quantity yourself |
| Every item had to be split before submitting | Splitting is optional; the rest is godown stock |
| No idea what was left over | Running godown balance on screen |

## Test it

1. Add an item, quantity 100 → godown shows 100
2. Send 10 to a shop → to shops 10, godown 90, and the qty box now says max 90
3. Try to send 200 → blocked with the pieces-left message
4. Change the total to 50 while 20 are already sent → godown shows 30
5. Submit with stock still in the godown → goes through, no error
6. Collapse the item → the line reads "20 to shops · 80 in godown"
