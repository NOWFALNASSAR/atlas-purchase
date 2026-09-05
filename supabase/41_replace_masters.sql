-- =====================================================================
-- ATLAS  |  41_replace_masters.sql
--
-- Throw away the old items and suppliers, keep only what was uploaded
-- from the billing software.
--
-- THE ONE THING THAT COULD GO WRONG
--
-- purchase_orders.supplier_id and po_items.item_id point at these rows.
-- Deleting a supplier that an order references would either fail on the
-- foreign key or, worse, leave an order pointing at nothing.
--
-- So this file CHECKS FIRST. If any order still references an old row
-- it stops and tells you, rather than half-deleting your masters. You
-- then either clear the test orders (GO-LIVE-CLEANUP.sql) or keep those
-- few rows.
--
-- Run after 40. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. WHAT IS THERE, AND WHAT IS IN USE
-- ---------------------------------------------------------------------

do $$
declare
  v_old_items  int; v_old_sups int;
  v_used_items int; v_used_sups int;
  v_new_items  int; v_new_sups int;
begin
  select count(*) into v_old_items from items     where coalesce(source,'atlas') <> 'billing';
  select count(*) into v_old_sups  from suppliers where coalesce(source,'atlas') <> 'billing';
  select count(*) into v_new_items from items     where source = 'billing';
  select count(*) into v_new_sups  from suppliers where source = 'billing';

  select count(distinct i.id) into v_used_items
    from items i join po_items p on p.item_id = i.id
   where coalesce(i.source,'atlas') <> 'billing';

  select count(distinct s.id) into v_used_sups
    from suppliers s join purchase_orders o on o.supplier_id = s.id
   where coalesce(s.source,'atlas') <> 'billing';

  raise notice '--------------------------------------------------';
  raise notice 'items     : % from billing, % old', v_new_items, v_old_items;
  raise notice 'suppliers : % from billing, % old', v_new_sups, v_old_sups;
  raise notice 'old items used on an order     : %', v_used_items;
  raise notice 'old suppliers used on an order : %', v_used_sups;
  raise notice '--------------------------------------------------';

  if v_new_items = 0 then
    raise exception 'No items from the billing software. Run 38, the import parts, then 40 before this.';
  end if;

  if v_used_items > 0 or v_used_sups > 0 then
    raise exception
      'Stopping. % old items and % old suppliers are still used by purchase orders. '
      'Deleting them would break those orders. Either clear the orders first with '
      'GO-LIVE-CLEANUP.sql, or leave the old rows in place — they are harmless.',
      v_used_items, v_used_sups;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. NOTHING IS USING THEM, SO REMOVE THEM
-- ---------------------------------------------------------------------

begin;

delete from items     where coalesce(source,'atlas') <> 'billing';
delete from suppliers where coalesce(source,'atlas') <> 'billing';

commit;

-- ---------------------------------------------------------------------
-- 3. RE-LINK, IN CASE ANYTHING POINTED AT A ROW THAT IS NOW GONE
-- ---------------------------------------------------------------------

update barcodes b set item_id = i.id
  from items i
 where b.item_id is null
   and (i.billing_code = b.item_code
     or lower(btrim(i.name)) = lower(btrim(b.item_name)));

update stock_lines l set item_id = i.id
  from items i
 where l.item_id is null
   and (i.billing_code = l.item_code
     or lower(btrim(i.name)) = lower(btrim(l.item_name)));

-- ---------------------------------------------------------------------
-- 4. WHAT YOU HAVE NOW
-- ---------------------------------------------------------------------

select 'items'     as table_name, count(*) as rows,
       count(*) filter (where billing_code is not null) as with_billing_code
  from items
union all
select 'suppliers', count(*), count(*) filter (where billing_code is not null)
  from suppliers;

-- Expect about 11,585 items and 1,872 suppliers, all from the billing
-- software, and nothing else.
--
-- The item and supplier pickers on New Order now show exactly these.
