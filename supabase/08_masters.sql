-- =====================================================================
-- ATLAS PURCHASE  |  08_masters.sql
-- Makes the masters match what your billing software actually exports.
-- Run once in Supabase → SQL Editor. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ITEMS — unit, HSN and GST rate come straight from your export
-- ---------------------------------------------------------------------

alter table items add column if not exists unit          text default 'Nos';
alter table items add column if not exists hsn           text;
alter table items add column if not exists tax_rate      numeric(5,2);   -- the VAT column
alter table items add column if not exists division      text;           -- DiviName

create index if not exists idx_items_division on items (division);
create index if not exists idx_items_hsn      on items (hsn);

-- ---------------------------------------------------------------------
-- SUPPLIERS — your export has two address lines and a place
-- ---------------------------------------------------------------------

alter table suppliers add column if not exists address2 text;
alter table suppliers add column if not exists place    text;

create index if not exists idx_suppliers_place on suppliers (place);

-- ---------------------------------------------------------------------
-- An item's own GST rate becomes the default on a new order line,
-- overriding the order default. Saris at 5%, household at 18% —
-- automatically, without anyone choosing.
-- ---------------------------------------------------------------------

create or replace function fill_tax_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tax_rate is null and new.item_id is not null then
    select tax_rate into new.tax_rate from items where id = new.item_id;
  end if;
  if new.tax_rate is null then
    select tax_rate into new.tax_rate from purchase_orders where id = new.po_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_fill_tax on po_items;
create trigger trg_fill_tax before insert on po_items
  for each row execute function fill_tax_rate();

notify pgrst, 'reload schema';

-- Verify:
-- select column_name from information_schema.columns
--  where table_name='items' and column_name in ('unit','hsn','tax_rate','division');
