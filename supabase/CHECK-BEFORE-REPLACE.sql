-- =====================================================================
-- ATLAS  |  Where am I, and can I replace the old masters?
--
-- Read-only. Works whether or not migration 40 has been run — it looks
-- at what actually exists rather than assuming.
-- =====================================================================

do $$
declare
  has_source   boolean;
  has_im       boolean;
  v_items      int; v_sups int;
  v_new_items  int := 0; v_new_sups int := 0;
  v_old_items  int := 0; v_old_sups int := 0;
  v_used_items int := 0; v_used_sups int := 0;
  v_im         int := 0; v_sm int := 0;
  v_orders     int;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'items' and column_name = 'source'
  ) into has_source;

  select to_regclass('public.item_master') is not null into has_im;

  select count(*) into v_items  from items;
  select count(*) into v_sups   from suppliers;
  select count(*) into v_orders from purchase_orders;

  if has_im then
    execute 'select count(*) from item_master'     into v_im;
    execute 'select count(*) from supplier_master' into v_sm;
  end if;

  raise notice '';
  raise notice '=== what is loaded ===';
  raise notice 'item_master (uploaded)     : %', case when has_im then v_im::text else 'table not created — run 38 first' end;
  raise notice 'supplier_master (uploaded) : %', case when has_im then v_sm::text else '-' end;
  raise notice 'items (used by orders)     : %', v_items;
  raise notice 'suppliers (used by orders) : %', v_sups;
  raise notice 'purchase orders            : %', v_orders;
  raise notice '';

  if not has_source then
    raise notice '=== migration 40 has NOT been run ===';
    raise notice 'The uploaded masters are still sitting in item_master and';
    raise notice 'supplier_master. Nothing has been copied into items or';
    raise notice 'suppliers yet, which is why the order screens still show';
    raise notice 'the old list.';
    raise notice '';
    raise notice 'Next: run 40_unify_masters.sql, then this check again.';
    return;
  end if;

  execute 'select count(*) from items where source = ''billing''' into v_new_items;
  execute 'select count(*) from items where coalesce(source,''atlas'') <> ''billing''' into v_old_items;
  execute 'select count(*) from suppliers where source = ''billing''' into v_new_sups;
  execute 'select count(*) from suppliers where coalesce(source,''atlas'') <> ''billing''' into v_old_sups;

  execute 'select count(distinct i.id) from items i join po_items p on p.item_id = i.id
            where coalesce(i.source,''atlas'') <> ''billing''' into v_used_items;
  execute 'select count(distinct s.id) from suppliers s join purchase_orders o on o.supplier_id = s.id
            where coalesce(s.source,''atlas'') <> ''billing''' into v_used_sups;

  raise notice '=== after migration 40 ===';
  raise notice 'items from the billing import : %', v_new_items;
  raise notice 'old items still there         : %', v_old_items;
  raise notice 'suppliers from the import     : %', v_new_sups;
  raise notice 'old suppliers still there     : %', v_old_sups;
  raise notice '';
  raise notice 'old items used on an order    : %', v_used_items;
  raise notice 'old suppliers used on an order: %', v_used_sups;
  raise notice '';

  if v_new_items = 0 then
    raise notice 'VERDICT: nothing imported yet. Run the import parts, then 40.';
  elsif v_used_items = 0 and v_used_sups = 0 then
    raise notice 'VERDICT: safe. Run 41_replace_masters.sql to remove the old rows.';
  else
    raise notice 'VERDICT: not safe yet. % old items and % old suppliers are on purchase orders.',
                 v_used_items, v_used_sups;
    raise notice 'Either clear those orders with GO-LIVE-CLEANUP.sql, or leave the';
    raise notice 'old rows in place — they do no harm alongside the imported ones.';
  end if;
end $$;
