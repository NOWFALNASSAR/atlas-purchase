/* =====================================================================
   ATLAS — BILLING DATABASE DISCOVERY
   Run these in SQL Server Management Studio against the billing database.
   Every query here is READ ONLY. Nothing is changed or deleted.
   Copy the results and send them back.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. Which databases are on this server?
   Find the billing one — usually named after the software or company.
   --------------------------------------------------------------------- */
select d.name as database_name,
       d.create_date,
       cast(sum(f.size) * 8.0 / 1024 as decimal(10,1)) as size_mb
  from sys.databases d
  join sys.master_files f on f.database_id = d.database_id
 where d.database_id > 4
 group by d.name, d.create_date
 order by size_mb desc;

/* Then, in SSMS, switch the dropdown to that database before running the rest. */


/* ---------------------------------------------------------------------
   2. Every table, with row counts. This is the map.
   --------------------------------------------------------------------- */
select s.name as [schema], t.name as [table], p.rows as row_count
  from sys.tables t
  join sys.schemas s on s.schema_id = t.schema_id
  join sys.partitions p on p.object_id = t.object_id and p.index_id in (0,1)
 where p.rows > 0
 order by p.rows desc;


/* ---------------------------------------------------------------------
   3. Which table holds the ITEMS?
   Searches every text column for an item name you know exists.
   Change 'TOP LADIES' if you prefer another item.
   --------------------------------------------------------------------- */
declare @find nvarchar(200) = 'TOP LADIES';
declare @sql nvarchar(max) = '';

select @sql = @sql +
  'select ''' + s.name + '.' + t.name + ''' as tbl, ''' + c.name + ''' as col,
          count(*) as hits from [' + s.name + '].[' + t.name + ']
    where cast([' + c.name + '] as nvarchar(max)) like ''%' + @find + '%''
   having count(*) > 0 union all '
from sys.columns c
join sys.tables t  on t.object_id = c.object_id
join sys.schemas s on s.schema_id = t.schema_id
join sys.types ty  on ty.user_type_id = c.user_type_id
where ty.name in ('varchar','nvarchar','char','nchar','text','ntext');

set @sql = left(@sql, len(@sql) - 10);
exec sp_executesql @sql;


/* ---------------------------------------------------------------------
   4. Which table holds the SUPPLIERS?
   Same search with a supplier name you know.
   --------------------------------------------------------------------- */
declare @sup nvarchar(200) = 'A K FASHION';
declare @sql2 nvarchar(max) = '';

select @sql2 = @sql2 +
  'select ''' + s.name + '.' + t.name + ''' as tbl, ''' + c.name + ''' as col,
          count(*) as hits from [' + s.name + '].[' + t.name + ']
    where cast([' + c.name + '] as nvarchar(max)) like ''%' + @sup + '%''
   having count(*) > 0 union all '
from sys.columns c
join sys.tables t  on t.object_id = c.object_id
join sys.schemas s on s.schema_id = t.schema_id
join sys.types ty  on ty.user_type_id = c.user_type_id
where ty.name in ('varchar','nvarchar','char','nchar','text','ntext');

set @sql2 = left(@sql2, len(@sql2) - 10);
exec sp_executesql @sql2;


/* ---------------------------------------------------------------------
   5. Columns of the tables you found.
   Replace the names with what queries 3 and 4 returned.
   --------------------------------------------------------------------- */
select c.name as column_name, ty.name as data_type, c.max_length, c.is_nullable
  from sys.columns c
  join sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('dbo.ItemMaster')      -- <-- change this
 order by c.column_id;

select c.name as column_name, ty.name as data_type, c.max_length, c.is_nullable
  from sys.columns c
  join sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('dbo.SupplierMaster')  -- <-- change this
 order by c.column_id;


/* ---------------------------------------------------------------------
   6. A few real rows, so the columns can be understood.
   --------------------------------------------------------------------- */
select top 5 * from dbo.ItemMaster;       -- <-- change
select top 5 * from dbo.SupplierMaster;   -- <-- change


/* ---------------------------------------------------------------------
   7. Where are the SALES? Look for these patterns in the query 2 list:
      invoice / bill / sales / trans / voucher  — header tables
      ...detail / ...item / ...line            — item tables
   Then look at one:
   --------------------------------------------------------------------- */
select top 5 * from dbo.SalesInvoice;         -- <-- change
select top 5 * from dbo.SalesInvoiceDetail;   -- <-- change


/* ---------------------------------------------------------------------
   8. Is there a "last modified" column anywhere?
   If yes, syncing only changed rows becomes possible, which is far faster.
   --------------------------------------------------------------------- */
select s.name + '.' + t.name as [table], c.name as [column]
  from sys.columns c
  join sys.tables t  on t.object_id = c.object_id
  join sys.schemas s on s.schema_id = t.schema_id
 where c.name like '%modif%' or c.name like '%updat%'
    or c.name like '%edit%'  or c.name like '%timestamp%'
 order by 1;
