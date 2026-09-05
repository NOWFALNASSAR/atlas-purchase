-- =====================================================================
-- ATLAS  |  Why is a sale unclassified?
--
-- Read-only. A sale gets its division and supplier through three hops:
--
--   sales_barcode_daily.barcode
--        -> barcodes.barcode            (loaded from the godown master)
--        -> barcodes.division_code / supplier_code
--        -> divisions / suppliers.billing_code   (for the name)
--
-- Any hop can be the broken one and they all look the same on screen.
-- This says which.
-- =====================================================================

-- HOP 1 — is the sold barcode in the godown master at all?
select 'sold barcodes'                    as step, count(*)::text as value from sales_barcode_daily
union all
select 'of those, found in barcodes',
       count(*)::text from sales_barcode_daily s
        where exists (select 1 from barcodes b where b.barcode = s.barcode)
union all
select 'NOT found in barcodes',
       count(*)::text from sales_barcode_daily s
        where not exists (select 1 from barcodes b where b.barcode = s.barcode)
union all
select 'value not found',
       to_char(coalesce(sum(value_extax),0), 'FM99,99,999') from sales_barcode_daily s
        where not exists (select 1 from barcodes b where b.barcode = s.barcode)

-- HOP 2 — does the barcodes row carry a division and supplier?
union all
select '---', '---'
union all
select 'barcodes rows total',            count(*)::text from barcodes
union all
select 'barcodes with a division',       count(*)::text from barcodes where division_code is not null
union all
select 'barcodes with a supplier code',  count(*)::text from barcodes where supplier_code is not null
union all
select 'barcodes with a supplier label', count(*)::text from barcodes where supplier_label is not null

-- HOP 3 — can the supplier code be turned into a name?
union all
select '---', '---'
union all
select 'suppliers rows',                 count(*)::text from suppliers
union all
select 'suppliers with billing_code',    count(*)::text from suppliers where billing_code is not null
union all
select 'divisions rows',                 count(*)::text from divisions

-- WHERE THE SALES ROWS STAND NOW
union all
select '---', '---'
union all
select 'sales rows with a division',     count(*)::text from sales_barcode_daily where division_code is not null
union all
select 'sales rows WITHOUT a division',  count(*)::text from sales_barcode_daily where division_code is null
union all
select 'sales rows with a supplier',     count(*)::text from sales_barcode_daily where supplier_code is not null;

-- ---------------------------------------------------------------------
-- HOW TO READ IT
--
-- "NOT found in barcodes" is high
--     the godown master still has the stock filter on it, or the new
--     import parts were never run. Nothing else will help until this
--     number is small.
--
-- found in barcodes, but "sales rows WITHOUT a division" is still high
--     the link was never made. Run:  select * from relink_sales();
--
-- "suppliers with billing_code" is 0
--     migration 40 was not run, so a supplier code cannot be turned
--     into a name. Run 40_unify_masters.sql, or 46 below which reads
--     the name straight from the godown master instead.
-- ---------------------------------------------------------------------
