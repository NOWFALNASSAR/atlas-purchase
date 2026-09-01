-- =====================================================================
-- ATLAS PURCHASE  |  11_lists.sql
-- Small helper views so the filter dropdowns don't have to read
-- 69,000 rows to find out which divisions exist.
-- Run once in Supabase → SQL Editor.
-- =====================================================================

create or replace view v_item_divisions as
select coalesce(nullif(trim(division), ''), 'Uncategorised') as division,
       count(*) as items
from items
where active
group by 1
order by 2 desc;

create or replace view v_supplier_places as
select coalesce(nullif(trim(place), ''), 'Not set') as place,
       count(*) as suppliers
from suppliers
where active
group by 1
order by 2 desc;

-- searching 69,000 items by name needs an index, or every keystroke
-- makes Postgres read the whole table
create extension if not exists pg_trgm;
create index if not exists idx_items_name_trgm on items using gin (name gin_trgm_ops);
create index if not exists idx_items_code_trgm on items using gin (code gin_trgm_ops);
create index if not exists idx_suppliers_name_trgm on suppliers using gin (name gin_trgm_ops);

notify pgrst, 'reload schema';
