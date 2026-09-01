# Update 9 — full item and supplier lists

Your item master is now 69,640 rows. The old pages tried to load everything into
the browser, which is why they were slow or blank. They now fetch one page at a
time and let the database do the searching.

## Step 1 — SQL

Run `supabase/11_lists.sql`. It adds:

- a view listing your divisions with counts, for the filter dropdown
- a view listing supplier places with counts
- **search indexes** — without these, every keystroke makes Postgres read all
  69,640 rows

## Step 2 — three files in GitHub

| File | Change |
|---|---|
| `src/pages/Items.jsx` | paged list, database search, division filter |
| `src/pages/Suppliers.jsx` | paged list, database search, place filter |
| `src/components/Picker.jsx` | supports searching against the database |

---

# What you get

**Items** now shows the true count — "69,640 items" — with 50 per page and
Previous / Next. Search waits until you stop typing, then asks the database, so
it stays fast however large the master grows. It searches name, code and model
together, so `504955` and `FROCK` both work.

The division dropdown lists your real divisions with counts beside them:
`NEW BORN (2,341)`, `GIRLS (8,102)`.

Each line now shows the code, division, HSN and tax rate — the things that came
from your billing software.

**Suppliers** works the same way, with a place filter, so you can see everyone in
TIRUPPUR or SURAT at once.

---

# One thing worth watching

Your billing software creates a new item code for each purchase batch, so
`NEWBORN FROCK` exists as codes 543185 through 543190 — six identical names.

That is correct for billing and awkward for buying. Before changing anything,
create a few real purchase orders and see how it feels. Your buyers may search by
code anyway.

If it turns out to be painful, the fix is to group the picker by item name and
choose the code behind the scenes. Small change, but only worth making once you
know it's needed.
