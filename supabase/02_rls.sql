-- =====================================================================
-- ATLAS PURCHASE  |  02_rls.sql   (run SECOND)
-- Row Level Security is the real security boundary. The app just draws
-- the screens; the database decides who may read and write what.
-- =====================================================================

alter table entities        enable row level security;
alter table shops           enable row level security;
alter table profiles        enable row level security;
alter table suppliers       enable row level security;
alter table items           enable row level security;
alter table settings        enable row level security;
alter table purchase_orders enable row level security;
alter table po_items        enable row level security;
alter table po_item_photos  enable row level security;
alter table po_history      enable row level security;
alter table po_confirmations enable row level security;

-- ---------- MASTERS: everyone logged in can read ----------------------
create policy read_entities  on entities  for select to authenticated using (true);
create policy read_shops     on shops     for select to authenticated using (true);
create policy read_suppliers on suppliers for select to authenticated using (true);
create policy read_items     on items     for select to authenticated using (true);
create policy read_settings  on settings  for select to authenticated using (true);

-- ---------- MASTERS: only hod / admin may create or change ------------
create policy write_entities on entities for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

create policy write_shops on shops for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

create policy write_suppliers on suppliers for all to authenticated
  using (my_role() in ('hod','admin')) with check (my_role() in ('hod','admin'));

create policy write_items on items for all to authenticated
  using (my_role() in ('hod','admin')) with check (my_role() in ('hod','admin'));

create policy write_settings on settings for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- ---------- PROFILES --------------------------------------------------
create policy read_own_profile on profiles for select to authenticated
  using (id = auth.uid() or my_role() in ('manager','hod','admin'));

create policy update_own_name on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy admin_manage_profiles on profiles for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- ---------- PURCHASE ORDERS ------------------------------------------
-- read: your own, or anything in an entity you are assigned to
create policy read_po on purchase_orders for select to authenticated
  using (created_by = auth.uid() or can_see_entity(entity_id));

-- create: any active user, only as themselves, only as a draft
create policy create_po on purchase_orders for insert to authenticated
  with check (created_by = auth.uid() and status = 'draft' and can_see_entity(entity_id));

-- update: only your own DRAFT.  Status changes happen through the
-- submit/approve/reject functions, never by direct update.
create policy update_own_draft on purchase_orders for update to authenticated
  using (created_by = auth.uid() and status in ('draft','rejected'))
  with check (created_by = auth.uid() and status in ('draft','rejected'));

create policy delete_own_draft on purchase_orders for delete to authenticated
  using (created_by = auth.uid() and status = 'draft');

create policy admin_all_po on purchase_orders for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- ---------- PO ITEMS --------------------------------------------------
create policy read_po_items on po_items for select to authenticated
  using (exists (select 1 from purchase_orders p where p.id = po_id
                 and (p.created_by = auth.uid() or can_see_entity(p.entity_id))));

-- executives edit their own draft lines; manager/hod/admin may correct
-- rates while the order is still pending (every change is auto-logged)
create policy write_po_items on po_items for all to authenticated
  using (exists (select 1 from purchase_orders p where p.id = po_id and (
            (p.created_by = auth.uid() and p.status in ('draft','rejected'))
         or (my_role() in ('manager','hod','admin') and p.status = 'pending'))))
  with check (exists (select 1 from purchase_orders p where p.id = po_id and (
            (p.created_by = auth.uid() and p.status in ('draft','rejected'))
         or (my_role() in ('manager','hod','admin') and p.status = 'pending'))));

-- ---------- PHOTOS ----------------------------------------------------
create policy read_photos on po_item_photos for select to authenticated
  using (exists (select 1 from purchase_orders p where p.id = po_id
                 and (p.created_by = auth.uid() or can_see_entity(p.entity_id))));

create policy write_photos on po_item_photos for all to authenticated
  using (exists (select 1 from purchase_orders p where p.id = po_id
                 and p.created_by = auth.uid() and p.status in ('draft','rejected')))
  with check (exists (select 1 from purchase_orders p where p.id = po_id
                 and p.created_by = auth.uid() and p.status in ('draft','rejected')));

-- ---------- HISTORY: readable, never editable -------------------------
create policy read_history on po_history for select to authenticated
  using (exists (select 1 from purchase_orders p where p.id = po_id
                 and (p.created_by = auth.uid() or can_see_entity(p.entity_id))));
-- no insert/update/delete policy on purpose: only the SECURITY DEFINER
-- workflow functions write here, so the audit trail cannot be edited.

-- ---------- CONFIRMATIONS --------------------------------------------
create policy read_conf on po_confirmations for select to authenticated
  using (exists (select 1 from purchase_orders p where p.id = po_id
                 and (p.created_by = auth.uid() or can_see_entity(p.entity_id))));

create policy write_conf on po_confirmations for all to authenticated
  using (my_role() in ('executive','manager','hod','admin'))
  with check (my_role() in ('executive','manager','hod','admin'));

-- ---------- STORAGE (item photos) ------------------------------------
-- Create a PRIVATE bucket named  po-photos  in Storage first, then run:
create policy "photos read"  on storage.objects for select to authenticated
  using (bucket_id = 'po-photos');
create policy "photos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'po-photos');
create policy "photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'po-photos');
