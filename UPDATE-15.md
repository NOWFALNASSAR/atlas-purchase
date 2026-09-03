# Update 15 — The dashboard is now the landing page

Signing in used to drop you on a purchase dashboard whatever your job was.
An accounts clerk saw "My drafts". A sales manager saw supplier rates. Now
the dashboard assembles itself from what you are allowed to see, and it is
the one screen everybody starts on.

## What each role lands on

| Role | Dashboard shows | Menu |
|---|---|---|
| Purchase Executive | Purchase | Dashboard, Purchase |
| Purchase Manager | Purchase | Dashboard, Purchase |
| Purchase HOD | Purchase, Stock, Tasks | Dashboard, Purchase, Stock, Tasks, Masters |
| Accounts | Purchase | Dashboard, Purchase |
| Admin / MD | Purchase, Stock, Sales, Tasks, Setup | everything |

A Purchase Manager now sees purchase and orders and nothing else, as asked.
The MD sees all five sections and clicks any figure through to its detail
page.

## The sections

**Waiting for your approval** sits above everything, and only appears if
there is something waiting. It shows the value held up and flags anything
over two days old in red, because an order sitting unapproved for a week is
the most expensive thing on the screen.

**Purchase** — bought this month, pending, approved, drafts, value split by
entity, and your own recent orders.

**Stock** — stock value and pieces, anything held over 180 days, a red band
if transfers were sent but never received, and the top divisions by value.

**Sales** — sold today against yesterday, month to date against target with
a progress bar, and the branches that are behind.

**Tasks** — open, overdue, not yet accepted, and the four that need
attention first.

**Setup** — plain links for the admin. Deliberately quiet; it is not
something you look at daily.

Every figure links through. Nothing is a dead end.

## How it loads

Each section fetches its own data, and only if it is shown. A purchase
manager therefore makes one query on sign-in, not five. Sections load
independently, so a slow sales view never holds up the purchase figures.

If a section's database views are missing — the sales tables have not been
created, or the nightly sync has never run — that section says so instead of
showing zeroes that look like real numbers.

## The Dashboard left the Purchase menu

It used to be the first page inside Purchase. It is now its own top-level
item, so somebody with only Sales rights no longer sees an empty Purchase
menu containing one dashboard.

On a phone the bottom bar now works in two levels: on the dashboard it jumps
between modules, and inside a module it moves between that module's pages.
Home is always the first tab, so there is one fixed way back.

## Install

Run `supabase/20_role_defaults.sql` in Supabase → SQL Editor, then deploy.

**Read the warning at the top of that file first.** It rewrites the role
settings from scratch. If you have already tuned roles on the Roles page and
are happy with them, do not run it — change what you want on the Roles page
instead. Personal exceptions on individual people are never touched by it.

Check it afterwards:

```sql
select role, count(*) from role_permissions group by role order by role;
```

Expected: accounts 3, executive 6, hod 23, manager 9.

## One decision worth knowing about

Executives, managers and accounts no longer get `suppliers.view` or
`items.view`. Those rights open the supplier and item **master pages**,
which belong to the HOD who owns that data.

Picking a supplier or an item while raising an order still works for
everyone — that reads the tables directly and is unaffected.

## If a role needs more

Do not edit the SQL. Two ways, both in the app:

- **Everyone on a role** — Masters → Roles, pick the role, tick it, save.
- **One person only** — Masters → Users, pick them, Rights tab, tick it.
  That becomes a personal exception and survives later changes to the role.

Giving one manager the Sales section is about four taps.

## Test it

| # | Test | Must happen |
|---|---|---|
| 1 | Sign in as a manager | Dashboard shows Purchase only; menu has Dashboard and Purchase |
| 2 | Sign in as admin | All five sections; every figure clicks through |
| 3 | Tick Sales for one manager on the Rights tab | Only that manager gets the Sales section, next sign-in |
| 4 | Sign in as accounts | No New order button anywhere |
| 5 | Open the dashboard on a phone | Bottom bar lists modules; open Purchase, it lists purchase pages |
| 6 | Sign in as a brand-new user with no role set | "Nothing switched on yet" card, no crash |

Test 6 is the one that used to throw an error.
