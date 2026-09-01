/* =====================================================================
   ATLAS — SALES DISCOVERY
   Run in SSMS. All read-only. Send me the results.
   Run each numbered block on its own (highlight it, press F5).
   ===================================================================== */


/* ---------------------------------------------------------------------
   1. Column names — the bill header
   --------------------------------------------------------------------- */
select c.name as column_name, ty.name as data_type
  from MAHA002_001.sys.columns c
  join MAHA002_001.sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('MAHA002_001.dbo.SALES014')
 order by c.column_id;


/* ---------------------------------------------------------------------
   2. Column names — the bill lines
   --------------------------------------------------------------------- */
select c.name as column_name, ty.name as data_type
  from MAHA002_001.sys.columns c
  join MAHA002_001.sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('MAHA002_001.dbo.SITEM014')
 order by c.column_id;


/* ---------------------------------------------------------------------
   3. Which shop is which number?
   --------------------------------------------------------------------- */
select * from MAHA002_001.dbo.SITE_ADDRESS001;


/* ---------------------------------------------------------------------
   4. Salesmen, and which shop they belong to
   --------------------------------------------------------------------- */
select top 30 * from MAHA002_001.dbo.LOOKUP where LTYPE = 'Salesman';

/* if LTYPE is not the right column name, look at the whole table instead: */
-- select top 30 * from MAHA002_001.dbo.LOOKUP;


/* ---------------------------------------------------------------------
   5. How much data are we dealing with, per shop, per year?
   Change SALES014 / SITEM014 to a couple of other shop numbers too.
   --------------------------------------------------------------------- */
select year(BILLDATE) as yr,
       count(*)       as bills,
       sum(NETAMOUNT) as sales
  from MAHA002_001.dbo.SALES014
 group by year(BILLDATE)
 order by yr desc;
/* If BILLDATE / NETAMOUNT are named differently, query 1 will tell us —
   run this one after we have the real names. */


/* ---------------------------------------------------------------------
   6. Which shop numbers actually exist?
   --------------------------------------------------------------------- */
select s.name as [table], p.rows
  from MAHA002_001.sys.tables t
  join MAHA002_001.sys.schemas sc on sc.schema_id = t.schema_id
  join MAHA002_001.sys.partitions p on p.object_id = t.object_id and p.index_id in (0,1)
  cross apply (select t.name) s(name)
 where t.name like 'SALES0%' and p.rows > 0
 order by t.name;


/* ---------------------------------------------------------------------
   7. One real bill, header and lines, so the columns make sense
   --------------------------------------------------------------------- */
select top 3 * from MAHA002_001.dbo.SALES014 order by 1 desc;
select top 5 * from MAHA002_001.dbo.SITEM014 order by 1 desc;
