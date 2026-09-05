-- =====================================================================
-- ATLAS  |  Why is anything still unclassified, and what fixes it?
--
-- Read-only. Ends with a verdict naming the next action.
-- =====================================================================

do $$
declare
  v_sales int; v_no_div int; v_val numeric; v_val_no numeric;
  v_missing int; v_missing_val numeric;
  v_have_bc int; v_no_class int;
  v_shops int; v_shop_list text;
  v_zero int;
begin
  select count(*), count(*) filter (where division_code is null and supplier_label is null),
         coalesce(sum(value_extax),0),
         coalesce(sum(value_extax) filter (where division_code is null and supplier_label is null),0)
    into v_sales, v_no_div, v_val, v_val_no
    from sales_barcode_daily;

  -- of the unclassified, how many are simply not in the barcodes table
  select count(*), coalesce(sum(s.value_extax),0) into v_missing, v_missing_val
    from sales_barcode_daily s
   where s.division_code is null and s.supplier_label is null
     and not exists (select 1 from barcodes b where b.barcode = s.barcode);

  -- and how many ARE there but carry no classification
  select count(*) into v_no_class
    from sales_barcode_daily s
    join barcodes b on b.barcode = s.barcode
   where s.division_code is null and s.supplier_label is null;

  select count(*) into v_have_bc from barcodes;
  select count(*) into v_zero from barcodes where qty_received is not null and unit_cost = 0;

  select count(distinct shop_code), string_agg(distinct coalesce(shop_code,'godown'), ', ')
    into v_shops, v_shop_list from stock_snapshots;

  raise notice '';
  raise notice '=== SALES ===';
  raise notice 'rows              : %', v_sales;
  raise notice 'unclassified      : %  (% of value)', v_no_div,
               case when v_val > 0 then round(v_val_no / v_val * 100, 1)::text || '%%' else '-' end;
  raise notice '';
  raise notice '=== WHY ===';
  raise notice 'barcode not in the master at all : %  worth %', v_missing, round(v_missing_val);
  raise notice 'barcode present but no division  : %', v_no_class;
  raise notice '';
  raise notice '=== STOCK FILES LOADED ===';
  raise notice 'barcodes known    : %', v_have_bc;
  raise notice 'locations loaded  : %  (%)', v_shops, coalesce(v_shop_list, 'none');
  raise notice 'zero-stock rows   : %', v_zero;
  raise notice '';
  raise notice '=== WHAT TO DO ===';

  if v_no_div = 0 then
    raise notice 'Nothing is unclassified. No action needed.';

  elsif v_shops < 5 then
    raise notice 'Only % location(s) loaded. Upload the rest on Stock -> Upload', v_shops;
    raise notice 'stock. Tested against your files, loading all nine shops takes';
    raise notice 'classification from 21%% to 96%%. Do the shop that made the sales';
    raise notice 'first — it alone does most of the work.';

  elsif v_no_class > v_missing then
    raise notice 'Most of these barcodes ARE in the master but carry no division.';
    raise notice 'Run:  select * from relink_sales();';

  elsif v_zero = 0 then
    raise notice 'All % locations are loaded, but every stock file still has the', v_shops;
    raise notice '"stock greater than zero" filter on it. The % barcodes below', v_missing;
    raise notice 'sold out everywhere, so no file contains them.';
    raise notice '';
    raise notice 'Only your billing vendor can fix this. Send VENDOR-REQUEST.md:';
    raise notice '  - remove the stock filter from the stock export, OR';
    raise notice '  - add DiviCode and SupCode to the ITEMWISE sales export';

  else
    raise notice 'Files look complete. Run relink_sales(), then re-check. If it';
    raise notice 'stays, the remaining barcodes predate the oldest stock file';
    raise notice 'you have loaded.';
  end if;
  raise notice '';
end $$;

-- the actual barcodes still unclassified, worst first
select s.barcode, s.item_name, sum(s.qty) as qty, sum(s.value_extax) as value,
       (exists (select 1 from barcodes b where b.barcode = s.barcode)) as in_master
  from sales_barcode_daily s
 where s.division_code is null and s.supplier_label is null
 group by 1, 2
 order by value desc
 limit 30;
