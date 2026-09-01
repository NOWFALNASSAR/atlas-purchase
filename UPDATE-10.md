# Update 10 — godown holding and direct-to-shop purchases

Two things you described that the app couldn't do:

1. Buy 100, send 30 now, hold 70 in the godown, send the rest whenever
2. Some purchases go straight to a shop and never touch the godown

## Step 1 — SQL

Run `supabase/12_godown.sql`, then check:

```sql
select 'receipt_mode' as item, count(*)::text as found from information_schema.columns
 where table_name='purchase_orders' and column_name='receipt_mode'
union all
select 'direct_shop_id', count(*)::text from information_schema.columns
 where table_name='purchase_orders' and column_name='direct_shop_id'
union all
select 'dispatched_at', count(*)::text from information_schema.columns
 where table_name='po_item_allocations' and column_name='dispatched_at'
union all
select 'godown view', count(*)::text from information_schema.views
 where table_name='v_godown_stock';
```

All four must be 1.

## Step 2 — files in GitHub

**New:** `src/pages/Godown.jsx`

**Replace:** `src/App.jsx`, `src/pages/NewPO.jsx`, `src/pages/PODetail.jsx`,
`src/components/ItemEditor.jsx`

---

# How it works now

## Buying into the godown

On a new order you now choose where the goods arrive:

```
Goods will arrive at
[ Godown              ]  [ Direct to shop      ]
  Send to shops later      Straight from supplier
```

Pick **Godown** and it behaves as before, with one change: sending stock to
shops at order time is now **optional**. Send what you want out immediately,
leave the rest. Nothing blocks the order.

## The Godown page

New menu item. Everything you have bought that hasn't reached a shop:

```
Pieces held 1,240    Value ₹4.82 L    Over 30 days 14

NEWBORN FROCK                              80
543185 · Blue · M                    of 100 bought
ATL/E1/PO/26-27/00042 · ROOPA TEX          ₹36,000
12 days in godown · 20 already sent   [Send to shop]
```

Tap **Send to shop**, choose the shop and quantity, add a note if useful. The
balance drops and the item stays listed until it reaches zero.

You can send the same item to four different shops on four different dates.
Every dispatch is dated and recorded.

**Sorted by oldest first by default**, because stock sitting 60 days is the
thing worth seeing. Anything over 30 days is flagged at the top with its value.

## Direct-to-shop purchases

Choose **Direct to shop**, pick the shop, and every item on that order is
automatically assigned there. No godown step, no splitting, nothing to
dispatch later. The item screen says so plainly instead of showing a split box.

These orders never appear on the Godown page, because that stock never entered
the godown.

## What changed from before

| Before | Now |
|---|---|
| Split the whole quantity at order time | Send some now, hold the rest |
| One row per shop per item | Same shop can receive again later |
| Maximum 10 shops per item | No limit — dispatches happen over months |
| Everything went through the godown | Direct-to-shop purchases supported |
| No way to see what was held | Godown page with age and value |

## Test it

1. New order → Godown → 100 pieces, send 20 to one shop → submit and approve
2. Godown page → the item shows 80 held → send 30 to another shop → 50 left
3. Send the last 50 → the item disappears from the list
4. New order → Direct to shop → pick a shop → the item shows no split box
5. That direct order does not appear on the Godown page
6. Try to send more than the balance → blocked with the pieces-left message

## What this sets up

Once the transfer tables are synced from your billing software, this page gains
a second column: what the app says was dispatched against what the billing
system recorded as received at the shop. Differences between the two are
exactly where stock goes missing.

That needs `transfers-discover.sql` run first — particularly query 1, the shop
number to shop name mapping.
