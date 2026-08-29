-- =====================================================================
-- ATLAS PURCHASE  |  03_seed.sql   (run THIRD)
-- Edit the names below to your real entities and shops before running.
-- =====================================================================

insert into entities (code, name) values
  ('E1', 'Atlas Maharani — Entity 1'),
  ('E2', 'Atlas Maharani — Entity 2'),
  ('E3', 'Atlas Maharani — Entity 3');

-- Shops. Replace names/locations with your real 24.
with e as (select id, code from entities)
insert into shops (entity_id, code, name, shop_type, location)
select e.id, s.code, s.name, s.shop_type, s.location
from (values
  ('E1','S01','Thodupuzha Wedding Centre','premium','Thodupuzha'),
  ('E1','S02','Showroom 02','budget','Erattupetta'),
  ('E1','S03','Showroom 03','budget','Pala'),
  ('E1','S04','Showroom 04','budget','Muvattupuzha'),
  ('E1','S05','Showroom 05','budget','Kothamangalam'),
  ('E1','S06','Showroom 06','budget','Perinthalmanna'),
  ('E1','S07','Showroom 07','budget','Kattappana'),
  ('E1','S08','Showroom 08','budget','Adimali'),
  ('E2','S09','Showroom 09','budget','Kanjirappally'),
  ('E2','S10','Showroom 10','budget','Ponkunnam'),
  ('E2','S11','Showroom 11','budget','Erumely'),
  ('E2','S12','Showroom 12','budget','Vaikom'),
  ('E2','S13','Showroom 13','budget','Ettumanoor'),
  ('E2','S14','Showroom 14','budget','Changanassery'),
  ('E2','S15','Showroom 15','budget','Kaduthuruthy'),
  ('E2','S16','Showroom 16','budget','Ramapuram'),
  ('E3','S17','Showroom 17','budget','Thrissur'),
  ('E3','S18','Showroom 18','budget','Chalakudy'),
  ('E3','S19','Showroom 19','budget','Angamaly'),
  ('E3','S20','Showroom 20','budget','Aluva'),
  ('E3','S21','Showroom 21','budget','Perumbavoor'),
  ('E3','S22','Showroom 22','budget','Kalady'),
  ('E3','S23','Showroom 23','budget','Wadakkanchery'),
  ('E3','S24','Showroom 24','budget','Kunnamkulam')
) as s(ent, code, name, shop_type, location)
join e on e.code = s.ent;

-- A few sample suppliers and items so you can test on day one.
insert into suppliers (code, name, company_name, mobile, whatsapp, credit_days, category) values
  ('SUP001','ABC Textiles','ABC Textiles Pvt Ltd','9000000001','9000000001',30,'Ladies'),
  ('SUP002','Surat Silk House','Surat Silk House','9000000002','9000000002',45,'Sarees'),
  ('SUP003','Tirupur Knits','Tirupur Knits & Co','9000000003','9000000003',15,'Gents');

insert into items (code, name, category, sub_category, model_no, std_selling) values
  ('LAD-KUR-00001','Ladies Kurti Cotton','Ladies','Kurti','K101',699),
  ('LAD-SAR-00001','Silk Saree Premium','Ladies','Saree','S202',2499),
  ('GNT-SHT-00001','Gents Formal Shirt','Gents','Shirt','SH303',799),
  ('KID-FRK-00001','Kids Frock Party','Kids','Frock','F404',899);

-- ---------------------------------------------------------------------
-- AFTER you sign up your own login in the app, make yourself admin:
--
--   update profiles
--      set role = 'admin', full_name = 'Nowfal', approval_limit = 0
--    where id = (select id from auth.users where email = 'you@example.com');
--
-- approval_limit 0 means "no limit". Set a number for managers/HOD.
-- ---------------------------------------------------------------------
