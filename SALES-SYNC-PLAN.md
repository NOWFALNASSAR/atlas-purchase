# Syncing sales — the plan

## The number that decides the design

`SITEM014` in MAHA002 holds **1,864,468 rows**. That is one shop's bill lines.
Across all shops you are generating well over 5 million line items a year.

For comparison, the item master we just synced was 69,000 rows and took 40
seconds. Sales is roughly a hundred times bigger, and it grows every day.

So sales cannot be synced the way the masters were. Three things would go wrong:

- **Storage.** 5 million rows a year is a few GB. The Supabase free tier is
  500 MB; Pro is 8 GB. You would outgrow it inside a year.
- **Speed.** A dashboard that scans 5 million rows to show today's total is slow
  no matter how well it's written.
- **Sync time.** Pushing millions of rows over your office internet every hour
  is not workable.

## What to sync instead

Three layers, each answering different questions.

### Layer 1 — Daily summary per shop (tiny, sync everything)

One row per shop per day:

```
date | shop | bills | qty | gross | discount | net_sales | cost | margin
```

24 shops × 365 days = **8,760 rows a year.** Nothing.

This alone powers most of your sales spec: daily monitoring, target vs
achievement, branch comparison, basket value, bill counts, growth, trends. All
of section 8 through 13 and 18 through 21.

### Layer 2 — Daily summary per salesman (small)

```
date | shop | salesman | bills | qty | net_sales | margin
```

Maybe 200 salesmen × 365 = **73,000 rows a year.** Still small.

Covers sections 16, 17 and 28 — salesman performance, ranking, executive
dashboard.

### Layer 3 — Item-level, recent only (moderate)

```
date | shop | item | qty | net_sales | cost | margin
```

Rolling 90 days only, refreshed daily. Older detail stays in the billing
database where it already lives. Roughly **1–2 million rows**, which Postgres
handles comfortably.

Covers item-wise and category-wise analysis for the period you actually act on.
Nobody makes a decision from item detail of 14 months ago — and if you ever
need it, we query the billing database directly for that one question.

## Why this is the right call

Your own spec asked for summary tables (section 35) and warned about performance
(section 34 and 48). This is that, done at the source. The aggregation happens in
SQL Server, where the data already sits, so only small results travel over the
internet.

It also means your dashboards read pre-computed numbers and answer instantly,
rather than scanning millions of rows on each load.

**The raw data is never lost.** It stays in the billing database, which is the
system of record. We are building a reporting layer, not a replacement.

---

# What I need from you

Run `sync/sales-discover.sql` in SSMS and send the results. Seven queries:

1. Column names of `SALES014` — the bill header
2. Column names of `SITEM014` — the bill lines
3. `SITE_ADDRESS001` — which shop is which number
4. `LOOKUP` salesman rows — salesman codes and their shops
5. Row counts by year — how far back the data goes
6. Which shop numbers exist
7. Three real bills, header and lines

Blank out anything sensitive. I need column names and the shape of the values,
not customer details.

**Question 3 matters most.** `SALES014` is by far your busiest shop. I need to
know whether 014 is Perinthalmanna, Thodupuzha, or somewhere else — otherwise
every report will show correct numbers against the wrong shop names.

---

# What gets built once I have that

**Step 1** — Tables in Supabase for the three layers, with indexes on
(date, shop) since that's the shape of nearly every query.

**Step 2** — The sync agent extended: it runs the aggregation queries in SQL
Server, pulls back small results, and upserts them. Same schedule, same file.

**Step 3** — A sales dashboard: today and MTD by shop, target vs achievement,
basket value, bill count, salesman ranking, category split.

**Step 4** — Targets. These do not exist in your billing software, so they get
entered in the app: monthly per shop, per salesman, and the required-daily-sales
calculation runs off Layer 1.

---

# One decision to make now

**How far back should the first sync go?**

- **This financial year only** — fastest, and enough for current performance
- **Two years** — lets you compare against last year, which your spec asks for
  in sections 18 and 20
- **Everything** — slowest first run, and older data rarely changes a decision

I would take two years for Layer 1 and Layer 2, since they are small, and 90 days
for Layer 3. That gives you year-on-year comparison without carrying the weight
of full item history.

---

# One more thing worth knowing

Your `SITEM` rows carry **cost as well as selling price** — the sample showed a
shirt at 699 selling, 485 cost. That means real gross margin per bill, per item,
per salesman, per shop, with no matching work.

Most retailers cannot do this without joining purchase and sales data manually.
You get it free because your billing software already records it. It is the most
valuable thing in this whole dataset, and it should be on the dashboard from
day one, not treated as an advanced feature.
