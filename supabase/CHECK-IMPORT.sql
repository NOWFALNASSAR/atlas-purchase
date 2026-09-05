-- =====================================================================
-- ATLAS  |  Did the import actually land?
--
-- Read-only. Run this before anything else — the answer decides
-- whether the problem is the data or the screens.
-- =====================================================================

select 'item_master'      as table_name, count(*) as rows,
       'expect 11,585'    as expected from item_master
union all
select 'supplier_master', count(*), 'expect 1,907'      from supplier_master
union all
select 'barcodes',        count(*), 'expect 30,883'     from barcodes
union all
select 'stock_snapshots', count(*), 'expect 1'          from stock_snapshots
union all
select 'stock_lines',     count(*), 'expect 30,883'     from stock_lines
union all
select 'divisions',       count(*), 'expect 14'         from divisions
union all
select 'purchase_types',  count(*), 'expect 20 or more' from purchase_types;

-- If stock_lines is 0, the import did not finish. Run the parts again.
-- If it is 30,883, the data is in and the problem is that nothing in
-- the app reads these tables yet.

select 'total stock value' as figure,
       to_char(sum(value_at_cost), 'FM99,99,99,999') as value
  from stock_lines
union all
select 'pieces on hand', to_char(sum(qty_on_hand), 'FM99,99,99,999') from stock_lines;

-- Expect around 10,93,71,844 and 13,35,697.

select * from v_stock_ageing order by sort_order;
