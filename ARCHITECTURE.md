# Building this into a full business MIS
**Foundation decisions — what to do now, what to defer, what will actually break**

---

## First, the good news about scale

Your instinct is that a bigger app will get slow. For your numbers, it won't.

| Data | Per year | Postgres opinion |
|---|---|---|
| Purchase orders | ~5,000 | trivial |
| PO item lines | ~50,000 | trivial |
| Sales bills (24 shops) | ~350,000 | small |
| Sales item lines | ~1,000,000 | small |
| 5 years of everything | ~7 million rows | still comfortable |

Postgres handles hundreds of millions of rows on ordinary hardware. Supabase runs
real Postgres. At your volume, **the database will not be your problem** as long
as you index correctly and never pull raw rows into the browser.

What will actually cause you pain is not scale. It's the four things below.

---

## The four real risks

### 1. You are editing production directly

Right now: you paste a file into GitHub → it deploys straight to the app your
staff use. There's no safety net. The `copyLink is not defined` crash you just hit
would have been caught in ten seconds by a staging environment.

**Do this before the next module:**

- Create a **second Supabase project** called `atlas-staging`.
- In Vercel, your `main` branch stays production. Create a `dev` branch — Vercel
  gives it a preview URL automatically, pointed at the staging database.
- Build and test on `dev`. Merge to `main` only when it works.

Cost: one free Supabase project. Time: an hour. This is the single highest-value
change you can make.

### 2. Copy-pasting files in the GitHub web editor

Two of your last three bugs came from partial pastes. That failure mode gets worse
as files get longer and modules multiply.

**Better options, no laptop needed:**

- **github.dev** — open your repo and press `.` (full stop). A real editor opens in
  the browser. You can replace whole files, see all files at once, and search
  across them.
- **GitHub Codespaces** — a full development environment in the browser, free for
  60 hours a month. You can run the app and see changes before committing.

Codespaces is what I'd use once you have more than one module.

### 3. Migrations that silently roll back

You've lost hours to this already. Supabase runs a script as one transaction — one
bad line undoes the whole file, quietly.

**The rule from here on:**

1. Every migration is a numbered file kept in the repo: `08_sales_schema.sql`
2. Never edit a migration that has already run. Write a new one.
3. Every migration ends with its own verification query.
4. Run the verification **before** touching any code file.

Big schemas should be split: `08a_tables.sql`, `08b_indexes.sql`, `08c_rls.sql`,
`08d_views.sql`. Smaller pieces fail smaller.

### 4. Loading raw rows into the browser

This is the one thing that genuinely will make the app slow, and there's already
an example in your Reports page — it pulls up to 5,000 rows and groups them in
JavaScript.

Fine for purchase. **Fatal for sales**, where a month is 80,000 lines.

**The rule: the database does the maths, the browser draws the answer.** Never
`select *` a transaction table. Aggregate in SQL, return dozens of rows, not
thousands.

---

## How to structure it as it grows

### Separate schemas per module

Everything currently lives in `public`. With nine modules that becomes 150 tables
in one namespace.

```sql
create schema core;      -- entities, shops, profiles, audit, settings
create schema purchase;  -- what you have now
create schema sales;
create schema inventory;
create schema hr;
```

New modules go in their own schema from day one. Moving the existing purchase
tables can wait — do it when you next have a quiet week, not now.

**One shared core, always.** Entities, shops, users, roles and audit live once in
`core` and every module reads them. The moment sales has its own branch table
separate from purchase's shop table, your reports stop agreeing with each other
and no amount of work fixes it.

Note your own spec already hit this: the purchase module has 3 entities and 24
showrooms; the sales spec says 10 shops and 2 categories. Reconcile that into one
`core.shops` before building sales, or you will be reconciling it forever.

### Indexes — the only performance work that matters early

Every foreign key and every column you filter or sort by:

```sql
create index on sales.invoices (branch_id, invoice_date);
create index on sales.invoice_items (invoice_id);
create index on sales.invoice_items (item_id);
create index on sales.invoices (salesman_id, invoice_date);
```

Date-plus-branch is the shape of nearly every sales query you'll write. Index that
pair and most dashboards answer in milliseconds.

### Summary tables — later, and only when measured

Your sales spec asks for `daily_branch_sales` and similar. Don't build them yet.
They add complexity and a whole class of "the summary disagrees with the raw data"
bugs.

Build on raw tables with good indexes. When a dashboard actually takes more than
two seconds, run `explain analyze`, find the query, and add a materialised view
for that one thing. Optimise what's slow, not what might be.

At 1 million rows a year you are years away from needing this.

### Frontend structure

```
src/
  core/          shared: auth, entity context, layout, formatting
  components/    shared UI
  modules/
    purchase/    pages + components
    sales/
    inventory/
```

Route by module: `/purchase/orders`, `/sales/dashboard`. Lazy-load each module so
opening the app doesn't download nine modules' worth of code.

---

## AI integration — the part most people get wrong

The instinct is to connect an LLM to the database and let people ask questions.
That fails in a specific way: the model writes plausible SQL against tables it
half-understands, returns a confident wrong number, and someone makes a decision
on it. Wrong numbers delivered fluently are worse than no numbers.

**What works instead — a semantic layer.**

Build a set of read-only, well-named views that answer your actual business
questions, and let the AI use only those:

```sql
create view ai.branch_performance as
select branch_name, month, sales, target,
       round(sales/nullif(target,0)*100,1) as achievement_pct,
       bills, round(sales/nullif(bills,0)) as basket_value
from ...;
```

Then the AI queries `ai.branch_performance`, not fourteen joined tables. The
numbers it gives are the same numbers your dashboard gives, because both come
from the same view. That consistency is the whole point.

**Three AI features actually worth building, in order:**

1. **Daily narrative.** Every morning, feed yesterday's aggregates to the model and
   get four sentences: what moved, which branch slipped, what to look at. This is
   genuinely useful and low risk — it's summarising numbers you already trust.

2. **Ask a question.** Natural language over the semantic views only. Always show
   the numbers alongside the answer so it can be checked.

3. **Anomaly flagging.** "Perinthalmanna's basket value dropped 22% this week."
   Statistics find the anomaly; the model writes the sentence. Don't let the model
   decide what's anomalous.

**What not to do:** never give the model write access, never let it generate SQL
that runs unreviewed against raw tables, and never let AI output reach a supplier
or staff member without a person approving it.

**Practical note:** you can call Anthropic's or OpenAI's API from a Supabase Edge
Function, keeping the key server-side. Never put an API key in the React app — it
ships to every browser. Cost at your scale is a few dollars a month.

---

## The order I'd build in

| Stage | What | Why now |
|---|---|---|
| **Now** | Finish the purchase bug, get 3 shops using it | Nothing else matters until one module is real |
| **Now** | Staging project + dev branch | Stops you breaking production |
| **Next** | Reconcile shops/entities into one core definition | Blocks everything downstream |
| **Next** | Sales Phase 1: import, validation, duplicates | Your biggest data gap |
| **Then** | Sales dashboards on raw tables with indexes | Prove the data before building on it |
| **Then** | Move to schemas per module | Cheap now, expensive at module five |
| **Later** | Semantic views | Prerequisite for AI |
| **Later** | AI daily narrative | The genuinely valuable one |
| **Much later** | Summary tables, if measured slow | Probably never at your scale |

---

## Three things to decide before writing more code

**1. Does your billing software have an API, or only Excel export?**
If an API exists, the whole sales import module gets simpler and more reliable.
Ask the vendor before designing around Excel.

**2. Are the 10 sales shops the same as the 24 purchase showrooms?**
One shop list, or the two modules will never agree.

**3. Who else will touch this code?**
If it stays only you, the browser-based workflow is fine. If you'll hire a
developer, set up staging and Codespaces now — no professional will work safely
in the GitHub web editor.

---

## What not to worry about

- **Database size.** You are years from any limit.
- **Concurrent users.** Fifty staff is nothing for Postgres.
- **Query speed**, provided you index and aggregate in SQL.
- **Supabase limits.** The Pro plan at about $25/month covers your entire business.

The thing that kills projects like this is not performance. It's building nine
half-finished modules instead of two that people actually use every day.
