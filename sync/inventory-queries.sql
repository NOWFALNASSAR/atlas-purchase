/* =====================================================================
   ATLAS — GODOWN SOURCE QUERIES  (corrected, real column names)
   Run in SSMS against MAHA002_001. These are what the agent will run.

   Corrections from the first attempt:
     PURCHASE001 joins on ORDERNO, not PURCHNO
     header date is DATE, not DATE1
     invoice is INVNO / INVDATE, not BILLNO / BILLDATE
     PITEM001 has its own GROUPCODE, SUBGROUP, BRAND — no join needed
     transoutitem001 carries FROM_BRANCH and FROM_ORDERNO
   ===================================================================== */

use MAHA002_001;
go


/* ---------------------------------------------------------------------
   1. GODOWN STOCK
       Cprice     -> cost (landed)
       Purchprice -> purchase rate (supplier invoice)
       RPrice     -> selling rate (tag)
   --------------------------------------------------------------------- */
select
  ltrim(rtrim(s.itemcode))              as item_code,
  ltrim(rtrim(s.itemname))              as item_name,
  ltrim(rtrim(isnull(s.DIVISION,'')))   as division,
  ltrim(rtrim(isnull(s.groupcode,'')))  as category,
  ltrim(rtrim(isnull(s.subgroup,'')))   as sub_category,
  ltrim(rtrim(isnull(s.brand,'')))      as brand,
  s.HSNCODE                             as hsn,
  s.IGST                                as tax_rate,
  s.suppcode                            as supplier_code,
  a.HEAD                                as supplier_name,
  s.qty                                 as qty,
  s.Purchprice                          as purchase_rate,
  s.Cprice                              as cost_rate,
  s.RPrice                              as selling_rate,
  p.first_purchase,
  p.last_purchase
from dbo.STOCKMST001 s
left join dbo.ACCOUNTS001 a on a.CODE = s.suppcode
left join (
  select i.ITEMCODE,
         min(h.[DATE]) as first_purchase,
         max(h.[DATE]) as last_purchase
    from dbo.PITEM001 i
    join dbo.PURCHASE001 h on h.ORDERNO = i.ORDERNO
   group by i.ITEMCODE
) p on p.ITEMCODE = s.itemcode
where isnull(s.BLOCK, 0) = 0
  and s.itemname is not null
  and ltrim(rtrim(s.itemname)) <> ''
  and s.qty <> 0;


/* ---------------------------------------------------------------------
   2. PURCHASE LINES
       PRICE  -> purchase rate      LC     -> landed cost
       SPRICE -> selling rate       RPRICE -> retail
   --------------------------------------------------------------------- */
select
  h.ORDERNO                             as purch_no,
  i.RECNO                               as line_no,
  cast(h.[DATE] as date)                as purch_date,
  h.INVNO                               as bill_no,
  cast(h.INVDATE as date)               as bill_date,
  h.SUPPCODE                            as supplier_code,
  h.SUPPNAME                            as supplier_name,
  ltrim(rtrim(i.ITEMCODE))              as item_code,
  ltrim(rtrim(i.ITEMNAME))              as item_name,
  ltrim(rtrim(isnull(i.GROUPCODE,'')))  as category,
  ltrim(rtrim(isnull(i.SUBGROUP,'')))   as sub_category,
  ltrim(rtrim(isnull(i.BRAND,'')))      as brand,
  ltrim(rtrim(isnull(i.COMPANY,'')))    as division,
  i.HSNCODE                             as hsn,
  i.QTY                                 as qty,
  i.FOC                                 as free_qty,
  i.PRICE                               as purchase_rate,
  i.LC                                  as cost_rate,
  i.SPRICE                              as selling_rate,
  i.DISCAMT                             as discount,
  i.TAXPER                              as tax_rate,
  i.TAXAMT                              as tax_amount,
  i.NETAMT                              as line_value
from dbo.PITEM001 i
join dbo.PURCHASE001 h on h.ORDERNO = i.ORDERNO
where h.[DATE] >= dateadd(year, -2, getdate());
-- agent appends:  and h.[DATE] > @watermark


/* ---------------------------------------------------------------------
   3. DISPATCH OUT OF THE GODOWN
   --------------------------------------------------------------------- */
select
  h.ORDERNO                             as doc_no,
  i.SLNO                                as line_no,
  cast(h.DATE1 as date)                 as doc_date,
  '001'                                 as from_location,
  isnull(h.SITE, h.CUSTCODE)            as to_location,
  h.CUSTNAME                            as to_name,
  ltrim(rtrim(i.ITEMCODE))              as item_code,
  ltrim(rtrim(i.ITEMNAME))              as item_name,
  i.QTY                                 as qty,
  i.RATE                                as rate,
  i.LC                                  as cost_rate,
  i.PRICE                               as selling_rate
from dbo.transoutitem001 i
join dbo.transout001 h on h.ORDERNO = i.ORDERNO
where h.DATE1 >= dateadd(month, -6, getdate());


/* ---------------------------------------------------------------------
   4. SANITY CHECK — do these match your own reports?
       Run this before trusting anything above.
   --------------------------------------------------------------------- */
select
  count(*)                              as stock_lines,
  sum(qty)                              as total_pieces,
  sum(qty * Cprice)                     as cost_value,
  sum(qty * RPrice)                     as selling_value
from dbo.STOCKMST001
where isnull(BLOCK,0) = 0 and qty > 0;

select
  year(h.[DATE]) as yr, month(h.[DATE]) as mth,
  count(distinct h.ORDERNO) as purchases,
  sum(i.QTY)     as qty,
  sum(i.NETAMT)  as value
from dbo.PITEM001 i
join dbo.PURCHASE001 h on h.ORDERNO = i.ORDERNO
where h.[DATE] >= dateadd(year, -1, getdate())
group by year(h.[DATE]), month(h.[DATE])
order by yr desc, mth desc;


/* ---------------------------------------------------------------------
   5. WHERE DOES DISPATCHED STOCK GO?
       SITE, CUSTCODE and CUSTNAME are the candidates for destination.
       Whichever names the branch is the one the agent will use.
   --------------------------------------------------------------------- */
select top 20
  h.ORDERNO, cast(h.DATE1 as date) as doc_date,
  h.SITE, h.CUSTCODE, h.CUSTNAME, h.FROM_BRANCH, h.BILLAMT
from dbo.transout001 h
order by h.DATE1 desc;

select distinct SITE from dbo.transout001 where SITE is not null;
select distinct CUSTCODE, CUSTNAME from dbo.transout001;
