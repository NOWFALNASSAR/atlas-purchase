-- =====================================================================
-- ATLAS  |  47_sales_upload_lock.sql
--
-- Locking a day once it has been uploaded.
--
-- A day that is already in should not be loadable again by accident —
-- that is how a month's figures quietly double. So the upload screen
-- locks a day the moment it lands, and unlocking is a separate,
-- deliberate act that only MD Office can do.
--
-- Run after 46. Safe to re-run.
-- =====================================================================

alter table sales_uploads add column if not exists locked      boolean not null default true;
alter table sales_uploads add column if not exists locked_at   timestamptz default now();
alter table sales_uploads add column if not exists unlocked_by uuid references profiles(id);
alter table sales_uploads add column if not exists source      text default 'app';

-- everything already loaded counts as locked
update sales_uploads set locked = true where locked is null;

-- ---------------------------------------------------------------------
-- UNLOCKING
--
-- Deliberate, recorded, and MD Office only. Deletes the day's rows so a
-- fresh upload starts clean rather than half-replacing.
-- ---------------------------------------------------------------------

create or replace function unlock_sales_day(p_branch text, p_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (am_md_office() or my_role() = 'admin') then
    raise exception 'Only MD Office can unlock a day that has been uploaded';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why this day is being uploaded again';
  end if;

  delete from sales_bills         where branch_code = p_branch and bill_date = p_date;
  delete from sales_barcode_daily where branch_code = p_branch and sale_date = p_date;
  delete from sales_person_daily  where branch_code = p_branch and sale_date = p_date;
  delete from sales_uploads       where branch_code = p_branch and sale_date = p_date;
end $$;

grant execute on function unlock_sales_day(text, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- WHAT HAS BEEN UPLOADED, AND WHAT HAS NOT
--
-- The screen reads this to draw the green switches.
-- ---------------------------------------------------------------------

create or replace view v_upload_status as
select u.sale_date, u.branch_code, u.bills, u.amount, u.taxable, u.margin,
       u.reconciled, u.variance, u.locked, u.created_at,
       p.full_name as uploaded_by_name,
       (select count(*) from sales_barcode_daily s
         where s.branch_code = u.branch_code and s.sale_date = u.sale_date) as barcode_rows,
       (select count(*) from sales_person_daily s
         where s.branch_code = u.branch_code and s.sale_date = u.sale_date) as person_rows
  from sales_uploads u
  left join profiles p on p.id = u.uploaded_by;

-- ---------------------------------------------------------------------
--   select * from v_upload_status order by sale_date desc;
-- ---------------------------------------------------------------------
