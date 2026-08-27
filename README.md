# Atlas Purchase — build it yourself, step by step

A working purchase management system for a multi-entity, multi-shop textile group.
Runs on any phone browser and on laptops. One codebase, one database.

**What is already built here**

- Login with roles: Purchase Executive, Manager, HOD, Accounts, Admin/MD
- Entity → Shop → User hierarchy, with entity-level access control
- Supplier master and Item master, both with Excel import
- Create purchase order: multiple items, shop per line, quantity, purchase rate,
  selling rate, automatic margin, item remarks, multiple photos per item
- Automatic PO number (`ATL/E1/PO/26-27/00125`) generated on submit
- Approval chain driven by amount slabs, with per-user approval limits
- Full audit trail: every rate change, quantity change, approval and rejection
- PO PDF, WhatsApp send, email send
- Supplier comparison: what each supplier charged for the same item, and when
- Dashboard: pending approvals, month value, entity split

**What is deliberately not built yet** — goods receipt (GRN), payments,
supplier self-confirmation portal, automated WhatsApp API sending, stock.
Add them after the pilot works. Do not add them before.

---

## Part 1 — What you need (about 2 hours, no coding)

| Thing | Where | Cost |
|---|---|---|
| Supabase account | supabase.com | Free to start |
| Vercel account | vercel.com | Free |
| GitHub account | github.com | Free |
| Node.js 20 | nodejs.org | Free |
| Code editor | VS Code, or Cursor | Free |

Supabase gives you the database, login system and photo storage in one place.
Vercel puts the app on the internet. That is the entire infrastructure.

**Cost reality:** free tiers will carry you through the pilot. For 24 shops with
photos, expect to move to Supabase Pro (about $25/month) within a few months,
mostly because of photo storage. Budget for it; it is still far cheaper than
building your own servers.

---

## Part 2 — Set up the database (30 minutes)

1. Go to supabase.com → **New project**.
   - Name: `atlas-purchase`
   - Region: **Mumbai (ap-south-1)** — closest to Kerala, keeps the app fast
   - Set a strong database password and **save it somewhere safe**
2. Wait for the project to finish setting up (2 minutes).
3. Open **SQL Editor → New query**. Paste the whole of `supabase/01_schema.sql`, press **Run**.
4. New query again. Paste `supabase/02_rls.sql`, press **Run**.
5. Open `supabase/03_seed.sql` in your editor first and **replace the entity names
   and the 24 shop names with your real ones**. Then paste it and **Run**.
6. Go to **Storage → New bucket**.
   - Name: `po-photos`
   - **Public bucket: OFF** (photos must stay private)
7. Go to **Project Settings → API** and copy two values:
   - Project URL
   - `anon` `public` key

If any script shows an error, read the message — it names the line. Fix and re-run.
Scripts are safe to re-run only after you drop what they created, so it is easier to
delete the project and start again if you get badly stuck early.

---

## Part 3 — Run it on your laptop (20 minutes)

```bash
# in the project folder
npm install

# create your local settings file
cp .env.example .env
```

Open `.env` and paste your two values:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Then:

```bash
npm run dev
```

Open the address it prints (usually `http://localhost:5173`).

1. Click **Create an account** and sign up with your own email.
2. Go back to Supabase → SQL Editor and make yourself admin:

```sql
update profiles
   set role = 'admin', full_name = 'Nowfal', approval_limit = 0
 where id = (select id from auth.users where email = 'your@email.com');
```

3. Refresh the app. You now see Suppliers, Items and Users in the menu.

**Turn off email confirmation while testing:** Supabase → Authentication →
Providers → Email → switch off "Confirm email". Turn it back on before go-live,
or keep it off and create accounts yourself — for staff logins, off is simpler.

---

## Part 4 — Put it on the internet (20 minutes)

```bash
git init
git add .
git commit -m "Atlas Purchase v1"
```

Create an empty repository on GitHub named `atlas-purchase`, then follow the two
push commands GitHub shows you.

On Vercel:
1. **Add New → Project → Import** your GitHub repo
2. Framework preset: **Vite** (it detects this automatically)
3. **Environment Variables** — add the same two:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
4. **Deploy**

You get a URL like `atlas-purchase.vercel.app`. That is your live app.

Add your own domain later: Vercel → Settings → Domains → `purchase.atlasmaharani.com`.

**Make it feel like an app on phones:** open the URL in Chrome on Android →
menu → *Add to Home screen*. On iPhone, Safari → Share → *Add to Home Screen*.
Staff get an icon; you never deal with Play Store or App Store.

---

## Part 5 — Load your real data (this takes the longest — start now)

Do this in this order. Everything downstream depends on it.

### 5.1 Entities and shops
Already loaded by `03_seed.sql` if you edited it. If not, fix names directly in
Supabase → Table Editor → `shops`.

### 5.2 Suppliers
Make one Excel file with these exact column headers:

```
Supplier Name | Company Name | GSTIN | Contact Person | Mobile | WhatsApp | Email | Address | Credit Days | Category
```

Rules before you import:
- One row per supplier. Merge "ABC Textile" and "ABC Textiles" into one row.
- Verify every GSTIN on the GST portal.
- WhatsApp number: 10 digits, no +91, no spaces. Send a test message to each.

Then in the app: **Suppliers → Import Excel**. It shows you how many rows are
bad or duplicate *before* importing anything.

### 5.3 Items
Column headers:

```
Item Code | Item Name | Category | Sub Category | Model | Fabric | Brand | Selling Rate
```

Item code format — decide once and never change:
`LAD-KUR-00125` (category–subcategory–serial).

Start with the 500–1,000 items you actually repeat-purchase. Do not try to load
20,000 items before going live. New items get added as you go.

### 5.4 Users
Each person signs up on the login screen themselves. Then you open **Users**,
set their role, approval limit and entity access. Nobody can do anything until
you set their role.

Suggested limits:

| Role | Approval limit |
|---|---|
| Purchase Executive | not an approver |
| Purchase Manager | ₹50,000 |
| Purchase HOD | ₹2,00,000 |
| Admin / MD | 0 = no limit |

### 5.5 Approval slabs
Change them any time without touching code — Supabase → Table Editor →
`settings` → row `approval_slabs`:

```json
[{"upto":50000,"chain":["manager"]},
 {"upto":200000,"chain":["manager","hod"]},
 {"upto":500000,"chain":["manager","hod","admin"]},
 {"upto":null,"chain":["manager","hod","admin"]}]
```

Also edit the `company` row with your real name, address, phone and email —
that is what prints on the supplier PDF.

---

## Part 6 — Test it before anyone else touches it

Run all of these yourself. Every one must pass.

| # | Test | Must happen |
|---|---|---|
| 1 | Create a PO with 10 items, 3 photos each, on a phone | Saves without crashing |
| 2 | Submit it | PO number appears, status becomes pending |
| 3 | Log in as Manager, approve | Moves to HOD, or to approved |
| 4 | Log in as Executive, try to approve your own PO | Blocked with a message |
| 5 | Manager changes a rate while pending | History shows old → new, with name and time |
| 6 | Reject with a reason | Creator can reopen, fix and resubmit |
| 7 | Manager with ₹50,000 limit approves a ₹2,00,000 order | Blocked |
| 8 | Download the PDF | Correct items, quantities, totals, supplier details |
| 9 | Send on WhatsApp | Correct number opens with the message ready |
| 10 | Executive of Entity A opens the orders list | Sees no Entity B orders |
| 11 | Compare page after 3 approved POs of the same item | Shows the rate history |
| 12 | Turn phone data to 2G/slow, upload a photo | Uploads (compressed), does not lose the order |

Test 4, 7 and 10 are the important ones. They prove the database is enforcing the
rules, not just the screens. If someone can bypass them, stop and fix before go-live.

---

## Part 7 — Pilot (4 weeks)

Switch on **3 shops only**: the Thodupuzha wedding centre, one strong budget
showroom, one with weak internet. Plus the full central purchase team.

- Train in Malayalam, 2 hours for the purchase team, 1 hour for approvers.
- Record a 10-minute phone video and share it in the team WhatsApp group.
- Run the old method in parallel for 3 weeks. Every Friday, compare the app total
  with the manual total. If they differ, find out why before continuing.

**Move to full rollout only when all of these are true:**

- [ ] 100% of pilot POs went through the app for 2 straight weeks
- [ ] App totals match manual totals exactly
- [ ] No serious bug in the last 2 weeks
- [ ] The purchase team prefers the app to the old way
- [ ] At least 20 suppliers received a PO through the system
- [ ] Approvals reach your phone within a minute

If any box is unticked, extend the pilot by 2 weeks. Do not roll out to 24 shops
to meet a date.

---

## Part 8 — Full rollout

| Wave | Shops | Week |
|---|---|---|
| Wave 1 | 6 shops nearest to head office | 1–2 |
| Wave 2 | 8 shops | 3–4 |
| Wave 3 | remaining 7 | 5–6 |

Per wave, before switch-on: users created with correct entity access, shop manager
trained, login tested on their actual phone, cheat sheet shared.

**The rule that makes it stick:** announce that from a fixed date, Accounts will
not process any supplier payment without an approved PO number from the system.
Enforcement does more than training.

---

## Part 9 — Keep it running

**Backups.** Supabase keeps daily backups on paid plans. Additionally, once a
month: Table Editor → each table → Export as CSV, keep it in Google Drive.
Do this on day one, not after the first scare.

**One data owner.** Only the HOD creates suppliers and item codes. Everyone else
requests. Without this rule you will have three spellings of every supplier again
within six months.

**Monthly, 30 minutes with the purchase team:**
- % of purchases going through the system (target 100%)
- average approval time
- rate movement on your top 50 repeat items
- margin by category
- POs rejected or revised — where training is needed

**Feature freeze.** Add nothing new for the first 3 months after go-live. Collect
requests in a list, review them in month 4. Constant changes during adoption
destroy staff confidence.

---

## Part 10 — When you want to extend it

The order to add things, once the basics are solid:

1. **Goods receipt (GRN)** — table `po_receipts`, quantity received per line,
   short/excess against ordered. This closes the loop.
2. **Supplier confirmation** — the `po_confirmations` table already exists; add a
   screen where the purchase team records what the supplier confirmed.
3. **Automated WhatsApp** — through a Business API provider (Interakt, AiSensy,
   Gupshup, WATI). Message templates need Meta approval, which takes 1–2 weeks.
   Until then the current wa.me link works fine — it just needs one tap.
4. **Reports export** — the views `v_item_rate_history`, `v_supplier_summary`
   already exist; add a page that pulls them into Excel with the `xlsx` library
   that is already installed.
5. **Push notifications** for pending approvals.

---

## File map

```
supabase/01_schema.sql   tables, workflow functions, audit triggers, PO numbering
supabase/02_rls.sql      who can read and write what — the real security layer
supabase/03_seed.sql     your entities, shops, sample suppliers and items
src/lib/db.js            database connection, money formatting, photo compression
src/lib/pdf.js           the supplier PO PDF and WhatsApp message
src/App.jsx              login gate, navigation, routes
src/pages/NewPO.jsx      start an order
src/pages/PODetail.jsx   items, submit, approve, reject, send, history
src/pages/Compare.jsx    supplier and rate comparison
src/pages/Suppliers.jsx  supplier master + Excel import
src/pages/Items.jsx      item master + Excel import
src/pages/Users.jsx      roles, approval limits, entity access
src/components/ItemEditor.jsx  one order line, with past-rate lookup
src/components/PhotoStrip.jsx  photo upload, compressed on the phone
```

## Two things not to change

**The workflow functions** (`submit_po`, `approve_po`, `reject_po`) live in the
database, not in the app. That is deliberate — it means nobody can skip an
approval by calling the API directly from a browser console.

**The RLS policies.** They are the security. If you ever find yourself turning RLS
off to make something work, you have made the whole system open to anyone who has
the anon key — which is in the browser and therefore public by design.
