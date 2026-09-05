-- =====================================================================
-- ATLAS  |  Is the sales data there, and can I see it?
--
-- Read-only. Answers the two different questions that both look like
-- an empty screen.
-- =====================================================================

-- 1. WHAT IS ACTUALLY IN THE TABLES
--    This runs as the owner, so row level security does not apply.
--    These are the true counts.

select 'sales_uploads'       as table_name, count(*) as rows,
       'expect 1 per branch per day' as note from sales_uploads
union all select 'sales_bills',         count(*), 'expect 208 for Nilambur 4 Sep' from sales_bills
union all select 'sales_barcode_daily', count(*), 'expect 519'                    from sales_barcode_daily
union all select 'sales_person_daily',  count(*), 'expect 40'                     from sales_person_daily;

-- 2. WHAT THE DAY LOOKS LIKE

select sale_date, branch_code, bills, taxable as without_tax, amount as with_tax,
       margin, reconciled, variance
  from sales_uploads order by sale_date desc, branch_code;

-- 3. WHO CAN SEE IT
--    If the counts above are non-zero but the app says "No sales
--    uploaded yet", the answer is here.

select r.code as role, r.label,
       bool_or(rp.permission_code = 'sales.view')    as can_see_sales,
       bool_or(rp.permission_code = 'sales.reports') as can_open_reports,
       bool_or(rp.permission_code = 'stock.reports') as can_open_stock
  from roles r
  left join role_permissions rp on rp.role = r.code
 where r.active
 group by r.code, r.label
 order by r.code;

-- Any role with false against can_open_reports will see an empty
-- screen. Run 43_sales_stock_access.sql, then sign out and back in —
-- rights are read at sign-in, so an open session keeps the old ones.
