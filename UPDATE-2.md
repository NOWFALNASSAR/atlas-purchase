# Update 2 — how to apply it

Three changes are live in this version. Follow these steps in order.

---

## Step 1 — Run the new SQL (5 minutes)

Supabase → **SQL Editor** → **New query** → paste all of `supabase/04_update.sql` → **Run**.

Run it **once**. If you see "already exists", it's already done — move on.

## Step 2 — Update the code files in GitHub

These files changed. For each one: github.com → your repo → open the file →
**pencil icon** → select all → paste the new version → **Commit changes**.

| File | What changed |
|---|---|
| `src/pages/NewPO.jsx` | purchase type buttons, entity locked for staff |
| `src/pages/PODetail.jsx` | shop-wise distribution table, type shown |
| `src/pages/POList.jsx` | type shown on each order |
| `src/components/ItemEditor.jsx` | quantity now comes from the shop split |
| `src/lib/pdf.js` | shop split and type on the supplier PDF |
| `src/App.jsx` | Reports and Settings menu items |

These are **new files** — use **Add file → Create new file** and type the full path:

| New file |
|---|
| `src/components/ShopSplit.jsx` |
| `src/pages/Reports.jsx` |
| `src/pages/Settings.jsx` |

Vercel rebuilds itself after the last commit. Wait 2 minutes, then hard-refresh
with Ctrl + Shift + R.

## Step 3 — Lock your staff to their entity

Supabase → SQL Editor. For each executive who must only see one entity:

```sql
update profiles
   set entity_ids = array[(select id from entities where code = 'E1')]
 where full_name = 'Name of the executive';
```

For yourself, the HOD, and anyone who needs mixed reports across all entities:

```sql
update profiles set entity_ids = '{}' where role in ('admin','hod');
```

Empty means all entities. That's the rule: **empty = everything, one entry = locked to it.**

You can also do this from the app — **Users** → tap the person → tick the entities.

## Step 4 — Set up your purchase types

Open **Settings** in the app menu (admin only). The starting list is
CC, Non CC, PMNA Fest, Onam, Wedding, Regular, Replenishment.

Delete what you don't use, add what you do. Every order must carry one, which is
what makes the type-wise reports work.

---

# What changed, in plain terms

### 1. Entity is fixed for staff
If a user has one entity assigned, the new order screen shows it as fixed text —
they cannot pick another one, and they cannot see other entities' orders anywhere
in the app. This is enforced in the database, not just hidden on the screen.

You and the HOD keep an empty entity list, which means all entities, and the
Reports page gives you an "All entities (mixed)" option that staff never see.

### 2. Purchase type on every order
CC / Non CC / PMNA Fest and whatever else you add. It's on the order header,
shows on the PDF the supplier receives, appears on the orders list, and is a
filter and a grouping in Reports.

### 3. Shop split — one item across up to 10 shops
This is the big one. **The quantity field is gone.** Instead:

```
Item: Ladies Kurti Cotton
Purchase ₹450   Selling ₹699

Shop split                      100 pcs
  S06  Perinthalmanna            10
  S12  Vaikom                    10
  S01  Thodupuzha Wedding Centre 30
  S18  Chalakudy                 50
  + Add shop
```

The total is calculated from the rows. Nobody types 100 and then splits it wrong —
the split *is* the quantity, so the two can never disagree.

Ten shops is the hard limit per item, enforced in the database.

An order cannot be submitted if any item hasn't been split. The error names the
items that are missing.

### 4. Reports page (new)
Date range, entity, purchase type as filters. Then group by shop, supplier, type,
category, entity or item. Export the whole thing to Excel.

Shop-wise is the one you'll use most — it answers "what did Perinthalmanna
actually get this month, and what did it cost".

### 5. Settings page (new, admin only)
Add and remove purchase types. Edit the company name, address and phone that
print on the supplier PDF.

---

# Test these before letting staff in

1. Create an order, tick PMNA Fest, add one item, split 100 across 4 shops → the line shows 100
2. Try to submit an order with an unsplit item → blocked, with the item named
3. Try to add an 11th shop to one item → blocked
4. Log in as an executive locked to E1 → the entity is fixed text, and E2 orders are invisible
5. Reports → by shop → the numbers match what you split
6. Download the PDF → shop split column and a shop summary table at the bottom
