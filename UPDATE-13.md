# Update 13 — Users, rights and roles

Until now a person's role was fixed in the code. If you wanted one executive
to approve small orders, or one manager who must not see margins, you could
not do it without editing files. Now you can, from the app, in ten seconds.

## How it works

Three layers, applied in this order:

1. **Permission catalogue** — 31 things a person can do, grouped by module.
2. **Role defaults** — what each role can do. Editable on the new Roles page.
3. **Personal exceptions** — one person added to or removed from their role,
   on the Rights tab of the Users page.

Effective rights = role defaults + personal grants − personal denies.

**Admin always has everything and this cannot be edited.** That is on purpose.
It is the only thing stopping you from locking yourself out of your own system.

## Install

Run `supabase/19_permissions.sql` in Supabase → SQL Editor. It is safe to
re-run. It seeds sensible defaults matching how the app already behaved, so
nothing changes for anyone until you start editing.

Then deploy the app as usual. If you deploy the app before running the SQL,
nothing breaks — it falls back to the old role rules and logs a warning.

## New screens

**Masters → Users** — search, then edit. Two tabs now:
- *Details* — name, code, phone, role, approval limit, entity access, active
- *Rights* — every permission, ticked from their role. Untick one and it shows
  a red "removed" tag. Tick an extra and it shows a green "added" tag. The
  "Reset" link puts them back on plain role behaviour.

**Masters → Roles** — pick a role, tick what it can do, save. The count next to
each role tells you how many active people you are about to affect.

## One security hole closed

`02_rls.sql` lets a person update their own profile row so they can fix their
name. That also meant they could have set their own `role` to `admin` from the
browser console. A trigger now blocks any non-admin from changing role, rights,
approval limit, entity access or active status — including on their own row.

Worth knowing: this was live before this update.

## What rights do and do not control

Rights control **what people see** — menus, pages, buttons.

Rights do not yet control **what the database allows**. That is still RLS
testing `my_role()`, and it is still the real security. Section 7 of the
migration shows how to move one table at a time onto `has_perm()` instead.

Do it one table per evening, testing each. Leave `approve_po` until last —
that one moves money.

## Test before you trust it

| # | Test | Must happen |
|---|---|---|
| 1 | Untick "Approve and reject" for a manager | Approve buttons disappear on their next sign-in |
| 2 | Give an executive "Insights" as a personal grant | Only that executive sees the Insights tab |
| 3 | Remove every Sales right from a role | The whole Sales module tab disappears for them |
| 4 | Change a role default | Everyone on that role changes, except people with a personal exception |
| 5 | Sign in as an executive, type `/users` in the address bar | Polite "not available to you" page |
| 6 | As a non-admin, run `update profiles set role='admin' where id=auth.uid()` in the browser console | Rejected by the trigger |

Test 6 is the important one.

## Still by role, not by rights

Custom roles beyond the five are not possible yet. Every RLS policy names the
roles literally, so adding a sixth means touching all of them. The five roles
with fully editable rights covers what you need for now — revisit only if you
actually hit the wall.
