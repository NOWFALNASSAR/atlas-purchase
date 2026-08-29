# Update 4 — purchase type dropdown, Non CC default, add types on the spot

Only one file changes. No new files.

## Step 1 — make sure "Non CC" is in the list

Supabase → SQL Editor → New query → Run:

```sql
select value from settings where key = 'purchase_types';
```

If "Non CC" is not in what comes back, set the list:

```sql
update settings
   set value = '["Non CC","CC","PMNA Fest","Onam","Wedding","Regular"]'::jsonb
 where key = 'purchase_types';
```

Spelling matters for the default to work — it must be `Non CC`, not `NonCC` or `NON CC`.
(The code is forgiving about spaces and capitals, but not about the letters.)

## Step 2 — update the one file

github.com → your repo → `src` → `pages` → `NewPO.jsx` → pencil icon →
select all → paste the new version → **Commit changes**.

Vercel rebuilds itself. Hard-refresh after 2 minutes with Ctrl + Shift + R.

## What changes

**Dropdown instead of buttons.** Purchase type is now a normal select box —
less space, and it works better on a phone with a long list of types.

**Non CC is pre-selected.** Every new order starts as Non CC. Change it only when
the order is something else, so the common case takes no taps at all.

**Add a type without leaving the order screen.** The last option in the dropdown
is `+ Add a new type…`. Pick it, type the name, and it is saved permanently and
selected for this order straight away.

That option only appears for **HOD and Admin**. Executives choose from the list
but cannot add to it — otherwise you end up with "PMNA fest", "Pmna Fest" and
"pmna" as three different types, and your reports split three ways.

The Settings page still works the same way for renaming or deleting types.

## Test it

1. New order → pick a supplier → the type box shows **Non CC** already selected
2. Open the dropdown → your other types are listed
3. As admin, pick `+ Add a new type…` → type something → it saves and gets selected
4. Reload the page → the new type is still in the list
5. Sign in as an executive → the dropdown works, but no `+ Add a new type…` option
