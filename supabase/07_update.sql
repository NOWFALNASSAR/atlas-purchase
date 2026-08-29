-- =====================================================================
-- ATLAS PURCHASE  |  07_update.sql
--   1. Report views (including godown stock, which is why reports were blank)
--   2. A place to store PO PDFs so suppliers can be sent a real file
-- Run once in Supabase → SQL Editor. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SHOP-WISE VIEW
-- ---------------------------------------------------------------------

create or replace view v_shop_allocation as
select
  a.shop_id, sh.code as shop_code, sh.name as shop_name, sh.shop_type,
  p.id as po_id, p.po_no, p.status, p.purchase_type, p.entity_id,
  e.code as entity_code, e.name as entity_name,
  p.created_at, p.approved_at,
  s.id as supplier_id, s.name as supplier_name,
  pi.id as po_item_id, pi.item_id, pi.item_code, pi.item_name,
  pi.category_snapshot, a.qty,
  pi.purchase_rate, pi.selling_rate, pi.margin_pct,
  (a.qty * pi.purchase_rate) as alloc_purchase,
  (a.qty * pi.selling_rate)  as alloc_sales
from po_item_allocations a
join po_items pi        on pi.id = a.po_item_id
join purchase_orders p  on p.id  = a.po_id
join shops sh           on sh.id = a.shop_id
join entities e         on e.id  = p.entity_id
join suppliers s        on s.id  = p.supplier_id;

-- ---------------------------------------------------------------------
-- 2. GODOWN BALANCE
-- ---------------------------------------------------------------------

create or replace view v_godown_balance as
select
  pi.id as po_item_id, pi.po_id, p.po_no, p.entity_id, p.purchase_type,
  pi.item_code, pi.item_name, pi.qty as bought,
  coalesce((select sum(qty) from po_item_allocations a where a.po_item_id = pi.id), 0) as sent_to_shops,
  pi.qty - coalesce((select sum(qty) from po_item_allocations a where a.po_item_id = pi.id), 0) as in_godown,
  pi.purchase_rate, p.created_at, p.status
from po_items pi
join purchase_orders p on p.id = pi.po_id;

-- ---------------------------------------------------------------------
-- 3. THE VIEW REPORTS ACTUALLY USES
--    Everything bought: what went to shops, plus what is still in the godown.
--    Without this, an order with all stock in the godown showed as nothing.
-- ---------------------------------------------------------------------

create or replace view v_purchase_lines as
-- what went to shops
select
  sh.code as shop_code, sh.name as shop_name,
  p.id as po_id, p.po_no, p.status, p.purchase_type,
  p.entity_id, e.name as entity_name,
  p.created_at, s.name as supplier_name,
  pi.item_id, pi.item_code, pi.item_name, pi.category_snapshot,
  a.qty, pi.purchase_rate, pi.selling_rate, pi.margin_pct, pi.tax_rate,
  (a.qty * pi.purchase_rate) as line_value,
  (a.qty * pi.selling_rate)  as line_sales
from po_item_allocations a
join po_items pi       on pi.id = a.po_item_id
join purchase_orders p on p.id  = a.po_id
join shops sh          on sh.id = a.shop_id
join entities e        on e.id  = p.entity_id
join suppliers s       on s.id  = p.supplier_id

union all

-- what stayed in the godown
select
  'GODOWN', 'Godown (not sent yet)',
  p.id, p.po_no, p.status, p.purchase_type,
  p.entity_id, e.name,
  p.created_at, s.name,
  pi.item_id, pi.item_code, pi.item_name, pi.category_snapshot,
  pi.qty - coalesce((select sum(qty) from po_item_allocations a where a.po_item_id = pi.id), 0),
  pi.purchase_rate, pi.selling_rate, pi.margin_pct, pi.tax_rate,
  (pi.qty - coalesce((select sum(qty) from po_item_allocations a where a.po_item_id = pi.id), 0)) * pi.purchase_rate,
  (pi.qty - coalesce((select sum(qty) from po_item_allocations a where a.po_item_id = pi.id), 0)) * pi.selling_rate
from po_items pi
join purchase_orders p on p.id = pi.po_id
join entities e        on e.id = p.entity_id
join suppliers s       on s.id = p.supplier_id
where pi.qty - coalesce((select sum(qty) from po_item_allocations a where a.po_item_id = pi.id), 0) > 0;

-- ---------------------------------------------------------------------
-- 4. STORAGE FOR PO PDFs
--    Public so a supplier can open the link from WhatsApp without a login.
--    Filenames contain a random id, so they cannot be guessed.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('po-pdfs', 'po-pdfs', true)
on conflict (id) do update set public = true;

drop policy if exists "po pdf write"  on storage.objects;
create policy "po pdf write" on storage.objects for insert to authenticated
  with check (bucket_id = 'po-pdfs');

drop policy if exists "po pdf read" on storage.objects;
create policy "po pdf read" on storage.objects for select to public
  using (bucket_id = 'po-pdfs');

drop policy if exists "po pdf update" on storage.objects;
create policy "po pdf update" on storage.objects for update to authenticated
  using (bucket_id = 'po-pdfs');

-- remember the last PDF sent for each order
alter table purchase_orders add column if not exists pdf_url text;

notify pgrst, 'reload schema';
