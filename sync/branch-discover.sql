/* =====================================================================
   RUN THIS ON A **BRANCH** SERVER (not head office)
   Read-only. Send me the results.
   ===================================================================== */

/* 1. Which databases live on this branch server? */
select d.name as database_name,
       cast(sum(f.size) * 8.0 / 1024 as decimal(10,1)) as size_mb
  from sys.databases d
  join sys.master_files f on f.database_id = d.database_id
 where d.database_id > 4
 group by d.name order by size_mb desc;

/* 2. Switch to the billing database, then: which numbered tables exist? */
select t.name, p.rows
  from sys.tables t
  join sys.partitions p on p.object_id = t.object_id and p.index_id in (0,1)
 where (t.name like 'SALES0%' or t.name like 'transin%' or t.name like 'PURCHASE0%')
   and p.rows > 0
 order by t.name;

/* 3. Does the receipt table point back at the godown's dispatch note?
      Looking for FROM_BRANCH and FROM_ORDERNO. */
select c.name as column_name, ty.name as data_type
  from sys.columns c
  join sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('dbo.transin014')     -- change the number
 order by c.column_id;

select c.name as column_name, ty.name as data_type
  from sys.columns c
  join sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('dbo.transinitem014') -- change the number
 order by c.column_id;

/* 4. A few real receipts */
select top 3 * from dbo.transin014 order by 1 desc;
select top 5 * from dbo.transinitem014 order by 1 desc;

/* 5. And on the HEAD OFFICE server, the matching dispatch: */
-- select top 3 * from MAHA002_001.dbo.transout001 order by 1 desc;
-- select top 5 * from MAHA002_001.dbo.transoutitem001 order by 1 desc;
