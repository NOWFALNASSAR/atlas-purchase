-- =====================================================================
-- ATLAS  |  48_upload_note.sql
--
-- A day always uploads. If the two files disagree, the difference is
-- written on the record rather than the upload being refused.
--
-- The earlier version blocked anything over a thousand rupees. That is
-- the wrong trade: a blocked upload means no figures at all for the
-- day, which is worse than figures with a known gap written against
-- them. Recording it and moving on is the better answer — as long as
-- the gap is visible afterwards and not buried.
--
-- Run after 47. Safe to re-run.
-- =====================================================================

alter table sales_uploads add column if not exists note        text;
alter table sales_uploads add column if not exists note_by     uuid references profiles(id);
alter table sales_uploads add column if not exists variance_pct numeric(8,3);

-- so a day with a gap can be found later without reading every row
create index if not exists idx_uploads_variance on sales_uploads (abs(variance) desc)
  where variance is not null and variance <> 0;

-- ---------------------------------------------------------------------
-- WHAT THE SCREEN AND THE REPORTS READ
--
-- Dropped first, not replaced. Migration 47 created v_upload_status
-- with a different set of columns, and `create or replace` cannot add
-- a column in the middle or rename one — it can only change the body.
-- Dropping loses nothing: a view is a saved query, and the data is in
-- sales_uploads.
-- ---------------------------------------------------------------------

drop view if exists v_upload_variances cascade;
drop view if exists v_upload_status    cascade;

create or replace view v_upload_status as
select u.sale_date, u.branch_code, u.bills, u.amount, u.taxable, u.margin,
       u.reconciled, u.variance, u.variance_pct, u.note, u.locked, u.created_at,
       p.full_name  as uploaded_by_name,
       np.full_name as note_by_name,
       case
         when u.variance is null or abs(u.variance) <= 1 then 'exact'
         when abs(u.variance) <= 1000                    then 'small'
         else                                                 'large'
       end as gap,
       (select count(*) from sales_barcode_daily s
         where s.branch_code = u.branch_code and s.sale_date = u.sale_date) as barcode_rows,
       (select count(*) from sales_person_daily s
         where s.branch_code = u.branch_code and s.sale_date = u.sale_date) as person_rows
  from sales_uploads u
  left join profiles p  on p.id = u.uploaded_by
  left join profiles np on np.id = u.note_by;

-- Days where the files did not agree, worst first. Worth a look at
-- month end — a branch that is always a few thousand out is exporting
-- its files too early, every day.
create or replace view v_upload_variances as
select sale_date, branch_code, taxable, variance, variance_pct, note,
       uploaded_by_name, note_by_name
  from v_upload_status
 where gap <> 'exact'
 order by abs(variance) desc;

-- ---------------------------------------------------------------------
--   select * from v_upload_variances;
-- ---------------------------------------------------------------------
