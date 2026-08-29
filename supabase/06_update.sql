-- =====================================================================
-- ATLAS PURCHASE  |  06_update.sql
-- Tax (order default, changeable per item), delivery address, transporter.
-- Run once in Supabase → SQL Editor. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ORDER HEADER — default tax, where it goes, who carries it
-- ---------------------------------------------------------------------

alter table purchase_orders add column if not exists tax_rate           numeric(5,2) default 5;
alter table purchase_orders add column if not exists delivery_address   text;
alter table purchase_orders add column if not exists transporter        text;
alter table purchase_orders add column if not exists transporter_phone  text;
alter table purchase_orders add column if not exists lr_no              text;
alter table purchase_orders add column if not exists total_tax          numeric(14,2) not null default 0;
alter table purchase_orders add column if not exists grand_total        numeric(14,2) not null default 0;

-- the tax rates you can pick from — edit this list any time
insert into settings (key, value) values
  ('tax_rates', '[0, 5, 12, 18, 28]'::jsonb)
on conflict (key) do nothing;

-- your usual transporters, so nobody types the name three different ways
insert into settings (key, value) values
  ('transporters', '["Own vehicle","Supplier delivery","Parcel service"]'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. ITEM LINE — its own rate when it differs from the order default
-- ---------------------------------------------------------------------

alter table po_items add column if not exists tax_rate numeric(5,2);

alter table po_items drop column if exists line_tax;
alter table po_items add column line_tax numeric(14,2)
  generated always as (round(qty * purchase_rate * coalesce(tax_rate,0) / 100, 2)) stored;

-- a new line inherits the order's rate unless one was typed
create or replace function fill_tax_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tax_rate is null then
    select tax_rate into new.tax_rate from purchase_orders where id = new.po_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_fill_tax on po_items;
create trigger trg_fill_tax before insert on po_items
  for each row execute function fill_tax_rate();

-- ---------------------------------------------------------------------
-- 3. TOTALS — now including tax and grand total
-- ---------------------------------------------------------------------

create or replace function recalc_po_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_po uuid;
begin
  v_po := coalesce(new.po_id, old.po_id);
  update purchase_orders p set
    total_qty      = coalesce((select sum(qty)           from po_items where po_id = v_po),0),
    total_purchase = coalesce((select sum(line_purchase) from po_items where po_id = v_po),0),
    total_sales    = coalesce((select sum(line_sales)    from po_items where po_id = v_po),0),
    total_tax      = coalesce((select sum(line_tax)      from po_items where po_id = v_po),0),
    grand_total    = coalesce((select sum(line_purchase) from po_items where po_id = v_po),0)
                   + coalesce((select sum(line_tax)      from po_items where po_id = v_po),0),
    updated_at     = now()
  where p.id = v_po;
  return null;
end; $$;

drop trigger if exists trg_recalc_totals on po_items;
create trigger trg_recalc_totals
  after insert or update or delete on po_items
  for each row execute function recalc_po_totals();

-- fill in the existing orders
update po_items pi set tax_rate = p.tax_rate
  from purchase_orders p where p.id = pi.po_id and pi.tax_rate is null;

update purchase_orders p set
  total_tax   = coalesce((select sum(line_tax)      from po_items where po_id = p.id),0),
  grand_total = coalesce((select sum(line_purchase) from po_items where po_id = p.id),0)
              + coalesce((select sum(line_tax)      from po_items where po_id = p.id),0);

-- ---------------------------------------------------------------------
-- 4. AUDIT — a tax change on a live order is recorded like a rate change
-- ---------------------------------------------------------------------

create or replace function log_item_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select full_name into v_name from profiles where id = auth.uid();

  if new.purchase_rate is distinct from old.purchase_rate then
    insert into po_history (po_id, action, note, actor_name)
    values (new.po_id, 'rate_changed',
            new.item_name || ': purchase rate ' || old.purchase_rate || ' → ' || new.purchase_rate, v_name);
  end if;

  if new.qty is distinct from old.qty then
    insert into po_history (po_id, action, note, actor_name)
    values (new.po_id, 'qty_changed',
            new.item_name || ': qty ' || old.qty || ' → ' || new.qty, v_name);
  end if;

  if new.tax_rate is distinct from old.tax_rate then
    insert into po_history (po_id, action, note, actor_name)
    values (new.po_id, 'tax_changed',
            new.item_name || ': tax ' || coalesce(old.tax_rate,0) || '% → ' || coalesce(new.tax_rate,0) || '%', v_name);
  end if;

  return new;
end; $$;

drop trigger if exists trg_log_item_change on po_items;
create trigger trg_log_item_change after update on po_items
  for each row execute function log_item_change();

notify pgrst, 'reload schema';
