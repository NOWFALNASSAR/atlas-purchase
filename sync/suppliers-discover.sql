/* Which columns does ACCOUNTS001 actually have?
   Run this and send the result — the supplier sync needs the real names. */
select c.name as column_name, ty.name as data_type
  from MAHA002_001.sys.columns c
  join MAHA002_001.sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('MAHA002_001.dbo.ACCOUNTS001')
 order by c.column_id;

/* Are the 170000-range accounts your suppliers? This should show
   ROOPA TEX, STAR KIDS, MAKER FASHION and the rest. */
select top 20 * from MAHA002_001.dbo.ACCOUNTS001
 where acccode between 170000 and 179999;

/* How many are there? Your Excel had 1,871. */
select count(*) as supplier_count from MAHA002_001.dbo.ACCOUNTS001
 where acccode between 170000 and 179999;

/* Every supplier that appears on a purchase — the ones that actually matter */
select distinct suppcode, suppname
  from MAHA002_001.dbo.PURCHASE001
 order by suppname;
