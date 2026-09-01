/* =====================================================================
   ATLAS — STOCK MOVEMENT DISCOVERY
   Godown dispatch and shop receipt. All read-only.
   Run each block on its own (highlight, F5) and send the results.
   ===================================================================== */


/* ---------------------------------------------------------------------
   1. Which shop is which number?  ← the most important one
   Without this every report shows right numbers, wrong shop name.
   --------------------------------------------------------------------- */
select * from MAHA002_001.dbo.SITE_ADDRESS001;


/* ---------------------------------------------------------------------
   2. Dispatch from godown — header and lines
   --------------------------------------------------------------------- */
select c.name as column_name, ty.name as data_type
  from MAHA002_001.sys.columns c
  join MAHA002_001.sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('MAHA002_001.dbo.transout001')
 order by c.column_id;

select c.name as column_name, ty.name as data_type
  from MAHA002_001.sys.columns c
  join MAHA002_001.sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('MAHA002_001.dbo.transoutitem001')
 order by c.column_id;


/* ---------------------------------------------------------------------
   3. Receipt at a shop — header and lines
   Using shop 014, your busiest.
   --------------------------------------------------------------------- */
select c.name as column_name, ty.name as data_type
  from MAHA002_001.sys.columns c
  join MAHA002_001.sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('MAHA002_001.dbo.transin014')
 order by c.column_id;

select c.name as column_name, ty.name as data_type
  from MAHA002_001.sys.columns c
  join MAHA002_001.sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('MAHA002_001.dbo.transinitem014')
 order by c.column_id;


/* ---------------------------------------------------------------------
   4. Real rows, so the columns make sense
   --------------------------------------------------------------------- */
select top 3 * from MAHA002_001.dbo.transout001 order by 1 desc;
select top 5 * from MAHA002_001.dbo.transoutitem001 order by 1 desc;
select top 3 * from MAHA002_001.dbo.transin014 order by 1 desc;
select top 5 * from MAHA002_001.dbo.transinitem014 order by 1 desc;


/* ---------------------------------------------------------------------
   5. Purchase lines — to join purchase → dispatch → sale by item code
   --------------------------------------------------------------------- */
select c.name as column_name, ty.name as data_type
  from MAHA002_001.sys.columns c
  join MAHA002_001.sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('MAHA002_001.dbo.PITEM001')
 order by c.column_id;

select c.name as column_name, ty.name as data_type
  from MAHA002_001.sys.columns c
  join MAHA002_001.sys.types ty on ty.user_type_id = c.user_type_id
 where c.object_id = object_id('MAHA002_001.dbo.PURCHASE001')
 order by c.column_id;


/* ---------------------------------------------------------------------
   6. Current stock per shop — is STOCKMST0xx per-shop stock?
   Same item in two shops should show different quantities.
   --------------------------------------------------------------------- */
select 'shop 001' as src, itemcode, itemname, qty
  from MAHA002_001.dbo.STOCKMST001 where itemcode = 504955
union all
select 'shop 014', itemcode, itemname, qty
  from MAHA002_001.dbo.STOCKMST014 where itemcode = 504955;


/* ---------------------------------------------------------------------
   7. Does the second entity work the same way?
   --------------------------------------------------------------------- */
select name from MAHA001_001.sys.tables
 where name like 'transout%' or name like 'transin%' or name like 'PURCHASE%'
 order by name;
